/**
 * Loudness coordination for professional-edit sessions (settings path, not ApplyPreview).
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { createApplyConsent } from "../applyPreview/consent";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import type { ApplyPreflight } from "../applyPreview/types";
import {
	type AudioNormalizeCandidateV1,
	type LoudnessClassification,
	runConsentedLoudnessNormalize,
	runLoudnessNormalizeAnalysis,
} from "../loudness";

export type LoudnessCoordinationOutcome =
	| "ALREADY_ACCEPTABLE"
	| "SAFE_NORMALIZATION_AVAILABLE"
	| "PEAK_LIMITED_SAFE_NORMALIZATION"
	| "BLOCKED_TRUE_PEAK"
	| "UNSUPPORTED_COMPLEX_MIX"
	| "NO_AUDIO"
	| "INSUFFICIENT_ANALYSIS"
	| "NOT_RUN";

export interface LoudnessCoordinationResultV1 {
	outcome: LoudnessCoordinationOutcome;
	candidate: AudioNormalizeCandidateV1 | null;
	classification: LoudnessClassification | null;
	committed: boolean;
	appliedGainDb: number | null;
	notes: string[];
	receipt: {
		terminalStatus: string;
		verificationNotes: string[];
		family: "loudness";
	} | null;
	document: AxcutDocument;
}

function mapOutcome(c: AudioNormalizeCandidateV1 | null): LoudnessCoordinationOutcome {
	if (!c) return "INSUFFICIENT_ANALYSIS";
	if (c.classification === "ALREADY_ACCEPTABLE") return "ALREADY_ACCEPTABLE";
	if (c.classification === "NO_AUDIO") return "NO_AUDIO";
	if (c.classification === "TRUE_PEAK_RISK") return "BLOCKED_TRUE_PEAK";
	if (c.classification === "UNSUPPORTED_COMPLEX_MIX") return "UNSUPPORTED_COMPLEX_MIX";
	if (c.classification === "INSUFFICIENT_ANALYSIS") return "INSUFFICIENT_ANALYSIS";
	if (c.safeToPropose) {
		const limited = c.warnings.some((w) => /clamped|Partial normalization/i.test(w));
		return limited ? "PEAK_LIMITED_SAFE_NORMALIZATION" : "SAFE_NORMALIZATION_AVAILABLE";
	}
	if (
		c.blockingReasons.includes("true_peak_already_high") ||
		c.blockingReasons.includes("cannot_raise_gain_without_peak_violation") ||
		c.blockingReasons.includes("expected_true_peak_unsafe")
	) {
		return "BLOCKED_TRUE_PEAK";
	}
	return "INSUFFICIENT_ANALYSIS";
}

export async function coordinateLoudnessForProfessionalEdit(args: {
	document: AxcutDocument;
	assetId: string;
	mediaPath: string | null | undefined;
	execute: boolean;
}): Promise<LoudnessCoordinationResultV1> {
	if (!args.mediaPath) {
		return {
			outcome: "NO_AUDIO",
			candidate: null,
			classification: null,
			committed: false,
			appliedGainDb: null,
			notes: ["no_media_path"],
			receipt: null,
			document: args.document,
		};
	}

	const bundle = await runLoudnessNormalizeAnalysis({
		assetId: args.assetId,
		mediaPath: args.mediaPath,
		document: args.document,
	});
	const outcome = mapOutcome(bundle.candidate);
	const notes = [
		`classification=${bundle.candidate.classification}`,
		`outcome=${outcome}`,
		...(bundle.candidate.blockingReasons ?? []),
		...(bundle.candidate.warnings ?? []),
	];

	if (
		!args.execute ||
		!bundle.candidate.safeToPropose ||
		(outcome !== "SAFE_NORMALIZATION_AVAILABLE" && outcome !== "PEAK_LIMITED_SAFE_NORMALIZATION")
	) {
		return {
			outcome,
			candidate: bundle.candidate,
			classification: bundle.candidate.classification,
			committed: false,
			appliedGainDb: null,
			notes,
			receipt: null,
			document: args.document,
		};
	}

	const fp = fingerprintDocument(args.document);
	const preflight: ApplyPreflight = {
		id: `pf_loudness_${bundle.candidate.id}`,
		proposalId: bundle.candidate.id,
		eligible: true,
		blockingReasons: [],
		documentFingerprint: fp,
		mustSurviveIds: [],
		damageRiskLevels: [],
		stale: false,
		preflightMs: 0,
		toolName: "setAudioGainDb",
	};
	const consent = createApplyConsent({
		proposalId: bundle.candidate.id,
		preflight,
	});
	const applied = await runConsentedLoudnessNormalize({
		document: args.document,
		candidate: bundle.candidate,
		mediaPath: args.mediaPath,
		consent,
		documentFingerprint: fp.value,
		preflightId: preflight.id,
	});

	return {
		outcome,
		candidate: bundle.candidate,
		classification: bundle.candidate.classification,
		committed: applied.mutatedAndVerified,
		appliedGainDb: applied.appliedGainDb,
		notes: [...notes, ...applied.notes],
		receipt: {
			terminalStatus: applied.terminalStatus,
			verificationNotes: applied.verify?.notes ?? applied.notes,
			family: "loudness",
		},
		document: applied.document,
	};
}
