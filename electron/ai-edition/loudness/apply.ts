/**
 * Consent-gated non-destructive apply of programme audioGainDb.
 * Does NOT modify applyPreview (still addTrim-only).
 * Uses the same consent philosophy: explicit consent required; rollback on verify fail.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import {
	getEditorSettings,
	patchEditorSettings,
} from "../../../src/lib/ai-edition/store/editorSettings";
import { validateConsent } from "../applyPreview/consent";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import type { ApplyConsent } from "../applyPreview/types";
import type { AudioNormalizeCandidateV1, LoudnessVerifyResult } from "./types";
import { LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID } from "./types";
import { verifyLoudnessAfterNormalize } from "./verify";

export interface LoudnessApplyResult {
	providerId: typeof LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID;
	document: AxcutDocument;
	mutatedAndVerified: boolean;
	mutationAttempted: boolean;
	terminalStatus:
		| "verified"
		| "rolled_back"
		| "blocked_no_consent"
		| "blocked_not_safe"
		| "apply_failed";
	appliedGainDb: number | null;
	previousGainDb: number;
	verify: LoudnessVerifyResult | null;
	notes: string[];
}

export function applyNormalizeGainToDocument(
	document: AxcutDocument,
	audioGainDb: number,
): AxcutDocument {
	return patchEditorSettings(document, { audioGainDb });
}

/**
 * Apply one loudness normalize with explicit consent + post-measure verify + rollback.
 */
export async function runConsentedLoudnessNormalize(args: {
	document: AxcutDocument;
	candidate: AudioNormalizeCandidateV1;
	mediaPath: string;
	consent: ApplyConsent | null;
	/** Preflight-like fingerprint the consent was minted against. */
	documentFingerprint: string;
	preflightId: string;
	cacheDir?: string;
	/** Test hook: force verify failure. */
	forceVerifyFailure?: boolean;
}): Promise<LoudnessApplyResult> {
	const previousGainDb = getEditorSettings(args.document).audioGainDb;
	const notes: string[] = [];

	if (!args.candidate.safeToPropose) {
		return {
			providerId: LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID,
			document: args.document,
			mutatedAndVerified: false,
			mutationAttempted: false,
			terminalStatus: "blocked_not_safe",
			appliedGainDb: null,
			previousGainDb,
			verify: null,
			notes: ["candidate_not_safe_to_propose"],
		};
	}

	const currentFp = fingerprintDocument(args.document).value;
	const consentCheck = validateConsent({
		consent: args.consent,
		proposalId: args.candidate.id,
		preflight: {
			id: args.preflightId,
			proposalId: args.candidate.id,
			eligible: true,
			blockingReasons: [],
			documentFingerprint: {
				algorithm: "json_sha256_relevant",
				value: args.documentFingerprint,
				scope: "loudness_normalize_v1",
			},
			mustSurviveIds: [],
			damageRiskLevels: [],
			stale: false,
			preflightMs: 0,
		},
		currentFingerprint: currentFp,
	});

	if (!consentCheck.ok) {
		return {
			providerId: LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID,
			document: args.document,
			mutatedAndVerified: false,
			mutationAttempted: false,
			terminalStatus: "blocked_no_consent",
			appliedGainDb: null,
			previousGainDb,
			verify: null,
			notes: [consentCheck.reason ?? "missing_consent"],
		};
	}

	const snapshot = structuredClone(args.document);
	const next = applyNormalizeGainToDocument(args.document, args.candidate.resultingAudioGainDb);
	notes.push(`applied_audioGainDb=${args.candidate.resultingAudioGainDb}`);

	let verify = await verifyLoudnessAfterNormalize({
		candidate: args.candidate,
		appliedGainDb: args.candidate.resultingAudioGainDb,
		mediaPath: args.mediaPath,
		assetId: args.candidate.assetId,
		cacheDir: args.cacheDir,
	});

	if (args.forceVerifyFailure) {
		verify = {
			...verify,
			passed: false,
			blocking: true,
			notes: [...verify.notes, "BLOCKING:forced_verify_failure"],
		};
	}

	if (!verify.passed || verify.blocking) {
		return {
			providerId: LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID,
			document: snapshot,
			mutatedAndVerified: false,
			mutationAttempted: true,
			terminalStatus: "rolled_back",
			appliedGainDb: null,
			previousGainDb,
			verify,
			notes: [...notes, "rollback_after_verify_fail"],
		};
	}

	return {
		providerId: LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID,
		document: next,
		mutatedAndVerified: true,
		mutationAttempted: true,
		terminalStatus: "verified",
		appliedGainDb: args.candidate.resultingAudioGainDb,
		previousGainDb,
		verify,
		notes,
	};
}
