/**
 * Consent + Apply Preview V1 orchestrator (+ Render Verification V1 stage).
 * 0 additional orchestration LLM calls.
 *
 * Flow: eligibility → preflight → consent → snapshot → single apply
 *     → structural/preservation → COMPOSITOR VERIFY → AUDIO VERIFY → accept|rollback
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { EditProposalItem } from "../editProposal/types";
import { applyApprovedProposal, capturePreApplySnapshot, restoreFromSnapshot } from "./apply";
import { validateConsent } from "./consent";
import { runFamilyVerificationStage } from "./familyVerifyStage";
import { fingerprintDocument } from "./fingerprint";
import { buildApplyPreflight, selectProposalForPreview } from "./preflight";
import {
	APPLY_PREVIEW_V1_PROVIDER_ID,
	type ApplyLifecycleState,
	type ApplyPreviewInput,
	type ApplyPreviewResult,
	type EditApplicationReceipt,
	MAX_MUTATIONS_PER_PREVIEW,
} from "./types";
import { verifyAfterApply } from "./verify";

function pushLifecycle(states: ApplyLifecycleState[], next: ApplyLifecycleState): void {
	const last = states[states.length - 1];
	if (last === next) return;
	states.push(next);
}

function emptyReceipt(
	partial: Partial<EditApplicationReceipt> & {
		proposalId: string;
		preflightId: string;
		terminalStatus: EditApplicationReceipt["terminalStatus"];
		lifecycle: ApplyLifecycleState[];
		beforeDocumentFingerprint: string;
		timestamps: EditApplicationReceipt["timestamps"];
		latencyMs: EditApplicationReceipt["latencyMs"];
	},
): EditApplicationReceipt {
	return {
		id: `ap_receipt_${partial.preflightId}`,
		consentId: null,
		providerId: APPLY_PREVIEW_V1_PROVIDER_ID,
		toolFamily: null,
		toolName: null,
		sanitizedArgs: null,
		afterDocumentFingerprint: null,
		mutationAttempted: false,
		mutationSucceeded: false,
		mutationsApplied: 0,
		affectedClipIds: [],
		affectedAssetIds: [],
		verificationStatus: "not_run",
		verificationNotes: [],
		preservationOk: null,
		structuralOk: null,
		rollbackStatus: "not_needed",
		rollbackFingerprintMatch: null,
		toolCalls: 0,
		additionalOrchestrationModelCalls: 0,
		...partial,
	};
}

function sanitizeArgs(proposal: EditProposalItem): Record<string, unknown> {
	const raw = { ...(proposal.proposedCall?.provisionalArgs ?? {}) };
	for (const key of Object.keys(raw)) {
		if (/path|secret|token|key|password/i.test(key)) delete raw[key];
	}
	return raw;
}

export async function runConsentedApplyPreview(
	input: ApplyPreviewInput,
): Promise<ApplyPreviewResult> {
	const startedAtIso = new Date().toISOString();
	const tTotal0 = Date.now();
	const lifecycle: ApplyLifecycleState[] = ["proposal_received"];

	const selected = input.selectedProposalId
		? (input.editProposalV1.proposals.find((p) => p.id === input.selectedProposalId) ?? null)
		: null;

	const currentFp = fingerprintDocument(input.document).value;
	let preflight = input.preflight;
	if (
		!preflight ||
		preflight.proposalId !== (selected?.id ?? "") ||
		preflight.documentFingerprint.value !== currentFp
	) {
		preflight = buildApplyPreflight({
			document: input.document,
			proposal: selected,
			proposalDocumentFingerprint: input.proposalDocumentFingerprint,
			mutationBudgetRemaining: MAX_MUTATIONS_PER_PREVIEW,
		});
	}

	const latencyBase = {
		preflightMs: preflight.preflightMs,
		snapshotMs: 0,
		applyMs: 0,
		structuralVerificationMs: 0,
		preservationVerificationMs: 0,
		renderVerificationMs: 0,
		audioVerificationMs: 0,
		rollbackMs: 0,
		totalMs: 0,
	};

	const finish = (
		doc: AxcutDocument,
		receipt: EditApplicationReceipt,
		consentAccepted: boolean,
		mutatedAndVerified: boolean,
	): ApplyPreviewResult => {
		receipt.latencyMs.totalMs = Date.now() - tTotal0;
		receipt.timestamps.finishedAtIso = new Date().toISOString();
		receipt.lifecycle = [...lifecycle];
		return {
			version: 1,
			providerId: APPLY_PREVIEW_V1_PROVIDER_ID,
			preflight,
			consentAccepted,
			receipt,
			document: doc,
			mutatedAndVerified,
		};
	};

	const doRollback = (
		snapshot: ReturnType<typeof capturePreApplySnapshot>["snapshot"],
		beforeFp: string,
		afterFp: string,
		baseReceiptFields: Record<string, unknown>,
		extraNotes: string[],
	): ApplyPreviewResult => {
		pushLifecycle(lifecycle, "verification_failed");
		pushLifecycle(lifecycle, "rolling_back");
		const tRb0 = Date.now();
		const restored = restoreFromSnapshot(snapshot);
		latencyBase.rollbackMs = Date.now() - tRb0;
		const restoredFp = fingerprintDocument(restored).value;
		const fpMatch = restoredFp === beforeFp;
		const priorStatus = baseReceiptFields.verificationStatus as
			| EditApplicationReceipt["verificationStatus"]
			| undefined;
		const verificationStatus =
			priorStatus === "render_unavailable" ||
			priorStatus === "render_verification_failed" ||
			priorStatus === "compositor_unavailable" ||
			priorStatus === "compositor_verification_failed" ||
			priorStatus === "audio_unavailable" ||
			priorStatus === "audio_verification_failed" ||
			priorStatus === "family_verification_failed"
				? priorStatus
				: "failed";
		const notes = [...((baseReceiptFields.verificationNotes as string[]) ?? []), ...extraNotes];
		if (!fpMatch) {
			pushLifecycle(lifecycle, "rollback_failed");
			return finish(
				restored,
				emptyReceipt({
					...baseReceiptFields,
					latencyMs: { ...latencyBase, totalMs: 0 },
					terminalStatus: "rollback_failed",
					verificationStatus,
					verificationNotes: notes,
					rollbackStatus: "failed",
					rollbackFingerprintMatch: false,
				} as Parameters<typeof emptyReceipt>[0]),
				true,
				false,
			);
		}
		pushLifecycle(lifecycle, "rolled_back");
		return finish(
			restored,
			emptyReceipt({
				...baseReceiptFields,
				afterDocumentFingerprint: afterFp,
				latencyMs: { ...latencyBase, totalMs: 0 },
				terminalStatus: "rolled_back",
				verificationStatus,
				verificationNotes: notes,
				rollbackStatus: "succeeded",
				rollbackFingerprintMatch: true,
				mutationsApplied: 0,
			} as Parameters<typeof emptyReceipt>[0]),
			true,
			false,
		);
	};

	if (!preflight.eligible || !selected) {
		pushLifecycle(lifecycle, "preflight_blocked");
		return finish(
			input.document,
			emptyReceipt({
				proposalId: preflight.proposalId || input.selectedProposalId || "",
				preflightId: preflight.id,
				terminalStatus: "blocked_preflight",
				lifecycle,
				beforeDocumentFingerprint: preflight.documentFingerprint.value,
				timestamps: { startedAtIso, finishedAtIso: "" },
				latencyMs: { ...latencyBase, totalMs: 0 },
				verificationNotes: preflight.blockingReasons,
			}),
			false,
			false,
		);
	}

	pushLifecycle(lifecycle, "preflight_passed");
	pushLifecycle(lifecycle, "awaiting_consent");

	const consentCheck = validateConsent({
		consent: input.consent,
		proposalId: selected.id,
		preflight,
		currentFingerprint: currentFp,
	});

	if (!consentCheck.ok) {
		return finish(
			input.document,
			emptyReceipt({
				proposalId: selected.id,
				preflightId: preflight.id,
				consentId: input.consent?.id ?? null,
				terminalStatus: "blocked_no_consent",
				lifecycle,
				beforeDocumentFingerprint: preflight.documentFingerprint.value,
				timestamps: { startedAtIso, finishedAtIso: "" },
				latencyMs: { ...latencyBase, totalMs: 0 },
				verificationNotes: [consentCheck.reason ?? "missing_consent"],
				toolFamily: selected.preferredStrategy,
				toolName: selected.proposedCall?.toolName ?? null,
			}),
			false,
			false,
		);
	}

	pushLifecycle(lifecycle, "consented");

	const { snapshot, snapshotMs } = capturePreApplySnapshot(input.document);
	latencyBase.snapshotMs = snapshotMs;
	const beforeFp = snapshot.fingerprint.value;

	pushLifecycle(lifecycle, "applying");
	const applied = applyApprovedProposal({
		document: input.document,
		proposal: selected,
		preflight,
		editsAllowed: input.editsAllowed,
	});
	latencyBase.applyMs = applied.applyMs;

	if (!applied.ok) {
		pushLifecycle(lifecycle, "apply_failed");
		return finish(
			input.document,
			emptyReceipt({
				proposalId: selected.id,
				preflightId: preflight.id,
				consentId: input.consent!.id,
				terminalStatus: "apply_failed",
				lifecycle,
				beforeDocumentFingerprint: beforeFp,
				timestamps: { startedAtIso, finishedAtIso: "" },
				latencyMs: { ...latencyBase, totalMs: 0 },
				mutationAttempted: true,
				mutationSucceeded: false,
				toolCalls: applied.toolCalls,
				toolFamily: selected.preferredStrategy,
				toolName: selected.proposedCall?.toolName ?? null,
				sanitizedArgs: sanitizeArgs(selected),
				verificationNotes: [applied.error ?? "apply_failed"],
				requestedLanding: preflight.landing,
			}),
			true,
			false,
		);
	}

	pushLifecycle(lifecycle, "applied");
	pushLifecycle(lifecycle, "verifying");

	const verification = verifyAfterApply({
		before: snapshot.document,
		after: applied.document,
		proposal: selected,
		preflight,
		forceFailure: input.forceVerificationFailure,
	});
	latencyBase.structuralVerificationMs = verification.structuralMs;
	latencyBase.preservationVerificationMs = verification.preservationMs;

	const afterFp = fingerprintDocument(applied.document).value;
	const baseReceiptFields = {
		proposalId: selected.id,
		preflightId: preflight.id,
		consentId: input.consent!.id,
		lifecycle,
		beforeDocumentFingerprint: beforeFp,
		afterDocumentFingerprint: afterFp,
		mutationAttempted: true,
		mutationSucceeded: true,
		mutationsApplied: 1 as const,
		toolCalls: applied.toolCalls,
		toolFamily: selected.preferredStrategy,
		toolName: selected.proposedCall?.toolName ?? null,
		sanitizedArgs: sanitizeArgs(selected),
		requestedLanding: preflight.landing,
		actualMutation: applied.actualMutation,
		affectedClipIds: verification.affectedClipIds,
		affectedAssetIds: verification.affectedAssetIds,
		verificationNotes: verification.notes,
		preservationOk: verification.preservationOk,
		structuralOk: verification.structuralOk,
		timestamps: { startedAtIso, finishedAtIso: "" },
		latencyMs: { ...latencyBase, totalMs: 0 },
	};

	if (!verification.passed) {
		return doRollback(snapshot, beforeFp, afterFp, baseReceiptFields, []);
	}

	// --- Family verification (trim compositor+audio | zoom/crop/speed editVerify) ---
	pushLifecycle(lifecycle, "render_verifying");
	const toolName = selected.proposedCall?.toolName ?? "";
	const family = await runFamilyVerificationStage({
		toolName,
		proposal: selected,
		preflight,
		beforeDocument: snapshot.document,
		afterDocument: applied.document,
		beforeFp,
		afterFp,
		applyResultJson: applied.resultJson,
		compositorFrameSampler: input.compositorFrameSampler,
		allowInjectedCompositorAsAuthoritative: input.allowInjectedCompositorAsAuthoritative,
		failClosedIfUnavailable: input.failClosedIfRenderUnavailable,
		retainArtifacts: input.retainRenderArtifacts,
		artifactDir: input.renderArtifactDir,
		audioPcmProvider: input.audioPcmProvider,
		forceNoAudio: input.forceNoAudio,
		forceAudioUnavailable: input.forceAudioUnavailable,
		retainAudioArtifacts: input.retainAudioArtifacts,
		audioArtifactDir: input.audioArtifactDir,
		appRoot: input.appRoot,
		forceFamilyVerifyFailure: input.forceFamilyVerifyFailure,
	});
	latencyBase.renderVerificationMs = family.renderVerificationMs;
	latencyBase.audioVerificationMs = family.audioVerificationMs;

	if (!family.ok) {
		return doRollback(
			snapshot,
			beforeFp,
			afterFp,
			{
				...baseReceiptFields,
				latencyMs: { ...latencyBase, totalMs: 0 },
				compositorVerification: family.compositorVerification,
				audioVerification: family.audioVerification,
				editVerification: family.editVerification,
				captionVerification: family.captionVerification,
				graphicVerification: family.graphicVerification,
				verificationStatus: family.verificationStatus,
			},
			family.blockingReasons,
		);
	}

	pushLifecycle(lifecycle, "verified");
	return finish(
		applied.document,
		emptyReceipt({
			...baseReceiptFields,
			latencyMs: { ...latencyBase, totalMs: 0 },
			terminalStatus: "verified",
			verificationStatus: family.verificationStatus,
			verificationNotes: [...verification.notes, ...family.notes],
			compositorVerification: family.compositorVerification,
			audioVerification: family.audioVerification,
			editVerification: family.editVerification,
			captionVerification: family.captionVerification,
			graphicVerification: family.graphicVerification,
			rollbackStatus: "not_needed",
		}),
		true,
		true,
	);
}

/** Preflight-only helper for service wiring — never mutates. */
export function prepareApplyPreviewDiagnostics(input: {
	document: AxcutDocument;
	editProposalV1: ApplyPreviewInput["editProposalV1"];
	selectedProposalId?: string;
	proposalDocumentFingerprint?: string | null;
}): {
	providerId: typeof APPLY_PREVIEW_V1_PROVIDER_ID;
	preflight: ReturnType<typeof buildApplyPreflight>;
	mutations: 0;
	additionalOrchestrationModelCalls: 0;
} {
	const selected = selectProposalForPreview(input.editProposalV1, input.selectedProposalId);
	const preflight = buildApplyPreflight({
		document: input.document,
		proposal: selected,
		proposalDocumentFingerprint: input.proposalDocumentFingerprint,
	});
	return {
		providerId: APPLY_PREVIEW_V1_PROVIDER_ID,
		preflight,
		mutations: 0,
		additionalOrchestrationModelCalls: 0,
	};
}
