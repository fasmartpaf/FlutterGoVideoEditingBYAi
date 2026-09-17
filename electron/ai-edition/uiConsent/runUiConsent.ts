/**
 * Main-process: mint consent + runConsentedApplyPreview for UI Consent Surface V1.
 * Never called from React tool executor.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { documentSchema } from "../../../src/lib/ai-edition/schema";
import {
	createApplyConsent,
	prepareApplyPreviewDiagnostics,
	runConsentedApplyPreview,
} from "../applyPreview";
import type { EditProposalV1 } from "../editProposal/types";
import { EDIT_PROPOSAL_V1_PROVIDER_ID } from "../editProposal/types";
import type { EditReviewPhase, UiConsentApplyRequest, UiConsentApplyResult } from "./types";

function isEditProposalV1(value: unknown): value is EditProposalV1 {
	if (!value || typeof value !== "object") return false;
	const v = value as EditProposalV1;
	return (
		v.version === 1 && v.providerId === EDIT_PROPOSAL_V1_PROVIDER_ID && Array.isArray(v.proposals)
	);
}

function userMessageFor(
	phase: EditReviewPhase,
	verificationStatus?: string,
): {
	userMessage: string;
	detailMessage?: string;
} {
	switch (phase) {
		case "verified":
			return {
				userMessage: "Edit applied and checked",
				detailMessage:
					"The change was kept. Surrounding video rendered correctly, and protected content remains intact.",
			};
		case "verified_with_warning":
			return {
				userMessage: "Edit applied with a warning",
				detailMessage:
					"The edit passed the safety checks, though OpenScreen noted a warning — for example a noticeable audio level change across the cut.",
			};
		case "rolled_back": {
			let detail =
				"OpenScreen detected a problem after applying the change, so the project was restored to its previous state.";
			if (verificationStatus?.includes("audio")) {
				detail =
					"OpenScreen detected an audio problem around the cut, so the project was restored to its previous state.";
			} else if (
				verificationStatus?.includes("compositor") ||
				verificationStatus?.includes("render")
			) {
				detail =
					"OpenScreen could not verify the rendered picture after the change, so the project was restored.";
			} else if (verificationStatus === "failed") {
				detail =
					"OpenScreen detected that protected content would be affected, so the project was restored.";
			}
			return { userMessage: "Edit wasn’t kept", detailMessage: detail };
		}
		case "apply_failed":
			return {
				userMessage: "The edit could not be applied. Your project was not changed.",
			};
		case "stale_blocked":
			return {
				userMessage: "The project changed since this edit was proposed.",
				detailMessage:
					"OpenScreen needs to review it again before applying. Your project was not changed.",
			};
		default:
			return { userMessage: "No change was made." };
	}
}

export async function runUiConsentedApply(
	request: UiConsentApplyRequest,
): Promise<UiConsentApplyResult> {
	const t0 = Date.now();
	const parsed = documentSchema.safeParse(request.document);
	if (!parsed.success) {
		return {
			success: false,
			phase: "apply_failed",
			mutationsApplied: 0,
			userMessage: "The edit could not be applied. Your project was not changed.",
			additionalModelCalls: 0,
			warnings: [],
			latencyMs: { preflightMs: 0, consentMintMs: 0, applyVerifyMs: 0, totalMs: Date.now() - t0 },
		};
	}
	const document: AxcutDocument = parsed.data;
	if (!isEditProposalV1(request.editProposalV1)) {
		return {
			success: false,
			phase: "apply_failed",
			mutationsApplied: 0,
			userMessage: "The edit could not be applied. Your project was not changed.",
			detailMessage: "The suggestion data was incomplete.",
			additionalModelCalls: 0,
			warnings: [],
			latencyMs: { preflightMs: 0, consentMintMs: 0, applyVerifyMs: 0, totalMs: Date.now() - t0 },
		};
	}

	const tPre = Date.now();
	const diag = prepareApplyPreviewDiagnostics({
		document,
		editProposalV1: request.editProposalV1,
		selectedProposalId: request.selectedProposalId,
		proposalDocumentFingerprint: request.proposalDocumentFingerprint,
	});
	const preflightMs = Date.now() - tPre;

	if (!diag.preflight.eligible) {
		const stale = diag.preflight.blockingReasons.includes("stale_proposal") || diag.preflight.stale;
		const phase: EditReviewPhase = stale ? "stale_blocked" : "apply_failed";
		const copy = userMessageFor(phase);
		return {
			success: false,
			phase,
			terminalStatus: stale ? "blocked_preflight" : "blocked_preflight",
			mutationsApplied: 0,
			stale,
			...copy,
			additionalModelCalls: 0,
			warnings: [],
			latencyMs: {
				preflightMs,
				consentMintMs: 0,
				applyVerifyMs: 0,
				totalMs: Date.now() - t0,
			},
		};
	}

	const tConsent = Date.now();
	const consent = createApplyConsent({
		proposalId: request.selectedProposalId,
		preflight: diag.preflight,
	});
	const consentMintMs = Date.now() - tConsent;

	const tApply = Date.now();
	const result = await runConsentedApplyPreview({
		document,
		editProposalV1: request.editProposalV1,
		selectedProposalId: request.selectedProposalId,
		preflight: diag.preflight,
		consent,
		proposalDocumentFingerprint: request.proposalDocumentFingerprint,
	});
	const applyVerifyMs = Date.now() - tApply;

	const receipt = result.receipt;
	const vs = receipt.verificationStatus;
	let phase: EditReviewPhase;
	if (result.mutatedAndVerified && receipt.terminalStatus === "verified") {
		phase =
			vs === "verified_single_trim_with_warnings" ||
			vs === "verified_single_zoom_with_warnings" ||
			vs === "verified_single_crop_with_warnings" ||
			vs === "verified_single_speed_with_warnings" ||
			vs === "verified_single_caption_with_warnings" ||
			vs === "verified_compositor_with_warnings" ||
			vs === "verified_render_with_warnings"
				? "verified_with_warning"
				: "verified";
	} else if (receipt.terminalStatus === "rolled_back") {
		phase = "rolled_back";
	} else if (
		receipt.terminalStatus === "blocked_preflight" ||
		receipt.terminalStatus === "blocked_no_consent"
	) {
		phase = receipt.verificationNotes.some((n) => /stale/i.test(n))
			? "stale_blocked"
			: "apply_failed";
	} else {
		phase = "apply_failed";
	}

	const copy = userMessageFor(phase, vs);
	const warnings = [
		...receipt.verificationNotes.filter((n) => /warning|rms_|near_speech/i.test(n)),
	].slice(0, 4);

	return {
		success: phase === "verified" || phase === "verified_with_warning",
		phase,
		terminalStatus: receipt.terminalStatus,
		verificationStatus: vs,
		mutationsApplied: receipt.mutationsApplied,
		document: result.mutatedAndVerified ? result.document : undefined,
		...copy,
		warnings,
		rollbackSucceeded: receipt.rollbackStatus === "succeeded",
		stale: phase === "stale_blocked",
		additionalModelCalls: 0,
		latencyMs: {
			preflightMs,
			consentMintMs,
			applyVerifyMs,
			totalMs: Date.now() - t0,
		},
	};
}
