/**
 * Consent-gated verified apply for zoom / crop / speed (one mutation).
 * Does NOT expand applyPreview SUPPORTED_APPLY_TOOLS (production default unchanged).
 * Pattern mirrors loudness: consent → snapshot → mutate → verify → keep|rollback.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { ZoomDepth } from "../../../src/lib/ai-edition/timeline/zoom-scale";
import { validateConsent } from "../applyPreview/consent";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import type { ApplyConsent } from "../applyPreview/types";
import type { CompositedFrameSampler } from "../compositorVerify/types";
import { clearEditVerifyFrameCache } from "./frameCache";
import { applyCropMutation, applySpeedMutation, applyZoomMutation } from "./mutate";
import type { EditVerificationResult, MustSurviveRequirement, NormalizedRect } from "./types";
import { LOCAL_EDIT_VERIFY_EXPANSION_V1_PROVIDER_ID } from "./types";
import { verifyCrop } from "./verifyCrop";
import { verifySpeed } from "./verifySpeed";
import { verifyZoom } from "./verifyZoom";

export type VerifiedEditFamily = "zoom" | "crop" | "speed";

export interface VerifiedEditApplyResult {
	providerId: typeof LOCAL_EDIT_VERIFY_EXPANSION_V1_PROVIDER_ID;
	family: VerifiedEditFamily;
	document: AxcutDocument;
	mutatedAndVerified: boolean;
	mutationAttempted: boolean;
	terminalStatus:
		| "verified"
		| "rolled_back"
		| "blocked_no_consent"
		| "blocked_fingerprint_mismatch"
		| "apply_failed";
	beforeFingerprint: string;
	afterFingerprint: string | null;
	rollbackFingerprintMatch: boolean | null;
	verify: EditVerificationResult | null;
	notes: string[];
	latencyMs: { preflightMs: number; applyMs: number; totalMs: number };
}

export interface RunConsentedVerifiedEditArgs {
	document: AxcutDocument;
	consent: ApplyConsent | null;
	documentFingerprint: string;
	preflightId: string;
	proposalId: string;
	family: VerifiedEditFamily;
	zoom?: {
		id: string;
		startSec: number;
		endSec: number;
		depth: ZoomDepth;
		focus: { cx: number; cy: number };
		customScale?: number;
		targetRegion?: NormalizedRect | null;
	};
	crop?: { clipId: string; crop: NormalizedRect };
	speed?: { id: string; startSec: number; endSec: number; multiplier: number };
	mustSurvive?: MustSurviveRequirement[];
	sampler?: CompositedFrameSampler | null;
	allowInjectedAsAuthoritative?: boolean;
	forceVerifyFailure?: boolean;
	forceAudioFailure?: boolean;
	measuredAudioDurationSec?: number | null;
}

export async function runConsentedVerifiedEdit(
	args: RunConsentedVerifiedEditArgs,
): Promise<VerifiedEditApplyResult> {
	const t0 = Date.now();
	const notes: string[] = [];
	const beforeFingerprint = fingerprintDocument(args.document).value;
	const tPre0 = Date.now();

	const consentCheck = validateConsent({
		consent: args.consent,
		proposalId: args.proposalId,
		preflight: {
			id: args.preflightId,
			proposalId: args.proposalId,
			eligible: true,
			blockingReasons: [],
			documentFingerprint: {
				algorithm: "json_sha256_relevant",
				value: args.documentFingerprint,
				scope: "edit_verify_expansion_v1",
			},
			mustSurviveIds: (args.mustSurvive ?? []).map((m) => m.id),
			damageRiskLevels: [],
			stale: false,
			preflightMs: 0,
		},
		currentFingerprint: beforeFingerprint,
	});
	const preflightMs = Date.now() - tPre0;

	if (!consentCheck.ok) {
		const mismatch =
			consentCheck.reason === "document_changed_after_consent" ||
			consentCheck.reason === "consent_fingerprint_mismatch" ||
			consentCheck.reason === "stale_document_fingerprint";
		return {
			providerId: LOCAL_EDIT_VERIFY_EXPANSION_V1_PROVIDER_ID,
			family: args.family,
			document: args.document,
			mutatedAndVerified: false,
			mutationAttempted: false,
			terminalStatus: mismatch ? "blocked_fingerprint_mismatch" : "blocked_no_consent",
			beforeFingerprint,
			afterFingerprint: null,
			rollbackFingerprintMatch: null,
			verify: null,
			notes: [consentCheck.reason ?? "missing_consent"],
			latencyMs: { preflightMs, applyMs: 0, totalMs: Date.now() - t0 },
		};
	}

	const snapshot = structuredClone(args.document);
	clearEditVerifyFrameCache();

	let next = args.document;
	const tApply0 = Date.now();
	try {
		if (args.family === "zoom") {
			if (!args.zoom) throw new Error("zoom_spec_required");
			next = applyZoomMutation(args.document, {
				id: args.zoom.id,
				startSec: args.zoom.startSec,
				endSec: args.zoom.endSec,
				depth: args.zoom.depth,
				focus: args.zoom.focus,
				customScale: args.zoom.customScale,
			});
		} else if (args.family === "crop") {
			if (!args.crop) throw new Error("crop_spec_required");
			next = applyCropMutation(args.document, args.crop);
		} else {
			if (!args.speed) throw new Error("speed_spec_required");
			next = applySpeedMutation(args.document, {
				id: args.speed.id,
				startSec: args.speed.startSec,
				endSec: args.speed.endSec,
				speed: args.speed.multiplier,
			});
		}
	} catch (err) {
		return {
			providerId: LOCAL_EDIT_VERIFY_EXPANSION_V1_PROVIDER_ID,
			family: args.family,
			document: args.document,
			mutatedAndVerified: false,
			mutationAttempted: true,
			terminalStatus: "apply_failed",
			beforeFingerprint,
			afterFingerprint: null,
			rollbackFingerprintMatch: null,
			verify: null,
			notes: [err instanceof Error ? err.message : String(err)],
			latencyMs: { preflightMs, applyMs: Date.now() - tApply0, totalMs: Date.now() - t0 },
		};
	}
	const applyMs = Date.now() - tApply0;
	const afterFingerprint = fingerprintDocument(next).value;
	notes.push(`mutated_${args.family}`);

	const sampler = args.sampler ?? null;
	let verify: EditVerificationResult;
	if (args.family === "zoom" && args.zoom) {
		verify = await verifyZoom({
			operationId: args.proposalId,
			document: next,
			documentFingerprint: afterFingerprint,
			zoom: args.zoom,
			targetRegion: args.zoom.targetRegion,
			mustSurvive: args.mustSurvive,
			sampler,
			allowInjectedAsAuthoritative: args.allowInjectedAsAuthoritative,
			forceBlankFailure: args.forceVerifyFailure,
		});
	} else if (args.family === "crop" && args.crop) {
		verify = await verifyCrop({
			operationId: args.proposalId,
			document: next,
			documentFingerprint: afterFingerprint,
			clipId: args.crop.clipId,
			crop: args.crop.crop,
			mustSurvive: args.mustSurvive,
			sampler,
			allowInjectedAsAuthoritative: args.allowInjectedAsAuthoritative,
		});
		if (args.forceVerifyFailure) {
			verify = {
				...verify,
				status: "failed",
				blockingReasons: [...verify.blockingReasons, "forced_verify_failure"],
				levelsAchieved: verify.levelsAchieved.filter((l) => l !== "VERIFIED"),
			};
		}
	} else if (args.family === "speed" && args.speed) {
		verify = await verifySpeed({
			operationId: args.proposalId,
			document: next,
			documentFingerprint: afterFingerprint,
			speed: args.speed,
			mustSurvive: args.mustSurvive,
			sampler,
			allowInjectedAsAuthoritative: args.allowInjectedAsAuthoritative,
			forceAudioFailure: args.forceAudioFailure ?? args.forceVerifyFailure,
			measuredAudioDurationSec: args.measuredAudioDurationSec,
		});
	} else {
		throw new Error("invalid_family_args");
	}

	if (verify.status !== "verified") {
		const restored = structuredClone(snapshot);
		const restoredFp = fingerprintDocument(restored).value;
		return {
			providerId: LOCAL_EDIT_VERIFY_EXPANSION_V1_PROVIDER_ID,
			family: args.family,
			document: restored,
			mutatedAndVerified: false,
			mutationAttempted: true,
			terminalStatus: "rolled_back",
			beforeFingerprint,
			afterFingerprint,
			rollbackFingerprintMatch: restoredFp === beforeFingerprint,
			verify,
			notes: [...notes, "verification_failed_rollback", ...verify.blockingReasons],
			latencyMs: { preflightMs, applyMs, totalMs: Date.now() - t0 },
		};
	}

	return {
		providerId: LOCAL_EDIT_VERIFY_EXPANSION_V1_PROVIDER_ID,
		family: args.family,
		document: next,
		mutatedAndVerified: true,
		mutationAttempted: true,
		terminalStatus: "verified",
		beforeFingerprint,
		afterFingerprint,
		rollbackFingerprintMatch: null,
		verify,
		notes,
		latencyMs: { preflightMs, applyMs, totalMs: Date.now() - t0 },
	};
}
