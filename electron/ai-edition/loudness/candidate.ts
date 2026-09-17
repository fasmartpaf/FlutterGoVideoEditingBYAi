/**
 * Classify loudness + build AudioNormalizeCandidateV1.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { getEditorSettings } from "../../../src/lib/ai-edition/store/editorSettings";
import { DEFAULT_LOUDNESS_TARGET_POLICY } from "./policy";
import type {
	AudioNormalizeCandidateV1,
	LoudnessAnalysisV1,
	LoudnessClassification,
	LoudnessTargetPolicy,
} from "./types";

let seq = 0;
export function resetLoudnessCandidateSeqForTests(): void {
	seq = 0;
}

function nextId(): string {
	seq += 1;
	return `loudness_cand_${seq}`;
}

export function hasUnsupportedComplexMix(document: AxcutDocument | null | undefined): boolean {
	if (!document) return false;
	const active = (document.audioTracks ?? []).filter((t) => !t.muted);
	return active.length > 0;
}

export function classifyLoudness(
	analysis: LoudnessAnalysisV1,
	policy: LoudnessTargetPolicy = DEFAULT_LOUDNESS_TARGET_POLICY,
): LoudnessClassification {
	if (analysis.audioState === "absent") return "NO_AUDIO";
	if (analysis.audioState !== "present" || analysis.integratedLufs == null) {
		return "INSUFFICIENT_ANALYSIS";
	}
	const i = analysis.integratedLufs;
	const tp = analysis.truePeakDbTp;
	const band = policy.acceptableBandDb;
	const target = policy.targetIntegratedLufs;

	if (tp != null && tp > policy.maxTruePeakDbTp + 0.05 && i >= target - band) {
		return "TRUE_PEAK_RISK";
	}
	if (i < target - band) return "TOO_QUIET";
	if (i > target + band) return "TOO_LOUD";
	if (
		analysis.loudnessRangeLra != null &&
		analysis.loudnessRangeLra > 18 &&
		Math.abs(i - target) <= band
	) {
		return "DYNAMIC_RANGE_CONCERN";
	}
	return "ALREADY_ACCEPTABLE";
}

export function buildNormalizeCandidate(args: {
	analysis: LoudnessAnalysisV1;
	document?: AxcutDocument | null;
	policy?: LoudnessTargetPolicy;
}): AudioNormalizeCandidateV1 {
	const policy = args.policy ?? DEFAULT_LOUDNESS_TARGET_POLICY;
	const currentAudioGainDb = args.document ? getEditorSettings(args.document).audioGainDb : 0;
	const blockingReasons: string[] = [];
	const warnings: string[] = [];

	const complex = hasUnsupportedComplexMix(args.document);
	let classification = classifyLoudness(args.analysis, policy);
	let mixSupport: AudioNormalizeCandidateV1["mixSupport"] = "single_primary";

	if (complex) {
		mixSupport = "unsupported_complex_mix";
		classification = "UNSUPPORTED_COMPLEX_MIX";
		blockingReasons.push("unsupported_complex_mix");
	}

	if (classification === "NO_AUDIO") {
		blockingReasons.push("no_audio");
	}
	if (classification === "INSUFFICIENT_ANALYSIS") {
		blockingReasons.push("insufficient_analysis");
	}
	if (classification === "ALREADY_ACCEPTABLE") {
		blockingReasons.push("already_within_acceptable_band");
	}
	if (classification === "DYNAMIC_RANGE_CONCERN") {
		blockingReasons.push("dynamic_range_concern_not_normalized_in_v1");
		warnings.push("Wide LRA noted; V1 does not compress/limit.");
	}
	if (classification === "TRUE_PEAK_RISK") {
		blockingReasons.push("true_peak_already_high");
		warnings.push("True peak already near ceiling; gain increase blocked.");
	}

	const measured = args.analysis.integratedLufs;
	const measuredTp = args.analysis.truePeakDbTp;
	let estimatedGainDb = 0;
	let resultingAudioGainDb = currentAudioGainDb;
	let expectedIntegratedLufs: number | null = measured;
	let expectedTruePeakDbTp: number | null = measuredTp;

	if ((classification === "TOO_QUIET" || classification === "TOO_LOUD") && measured != null) {
		const rawDelta = policy.targetIntegratedLufs - measured;
		const clampedDelta = Math.max(
			-policy.maxGainReductionDb,
			Math.min(policy.maxGainIncreaseDb, rawDelta),
		);
		estimatedGainDb = clampedDelta;
		resultingAudioGainDb = Math.max(
			-policy.compositorGainLimitDb,
			Math.min(policy.compositorGainLimitDb, currentAudioGainDb + clampedDelta),
		);
		const appliedDelta = resultingAudioGainDb - currentAudioGainDb;
		estimatedGainDb = appliedDelta;
		expectedIntegratedLufs = measured + appliedDelta;
		expectedTruePeakDbTp = measuredTp != null ? measuredTp + appliedDelta : null;

		if (Math.abs(appliedDelta) < policy.minimumMeaningfulDeltaDb) {
			blockingReasons.push("delta_below_meaningful_threshold");
		}
		if (Math.abs(rawDelta) > policy.compositorGainLimitDb + 0.01) {
			warnings.push(
				`Ideal gain ${rawDelta.toFixed(1)} dB exceeds compositor ±${policy.compositorGainLimitDb} dB; clamped.`,
			);
			if (Math.abs(appliedDelta) < Math.abs(rawDelta) - 0.01) {
				// Partial normalize remains safe when clamped delta is still meaningful.
				if (Math.abs(appliedDelta) < policy.minimumMeaningfulDeltaDb) {
					blockingReasons.push("required_gain_exceeds_compositor_limit");
				} else {
					warnings.push("Partial normalization within compositor gain limit.");
				}
			}
		}
		if (expectedTruePeakDbTp != null && expectedTruePeakDbTp > policy.maxTruePeakDbTp) {
			blockingReasons.push("expected_true_peak_unsafe");
			// Reduce gain to keep peak safe
			const headroom = policy.maxTruePeakDbTp - (measuredTp ?? 0);
			if (headroom < appliedDelta && appliedDelta > 0) {
				const safeDelta = Math.max(0, headroom);
				if (safeDelta < policy.minimumMeaningfulDeltaDb) {
					blockingReasons.push("cannot_raise_gain_without_peak_violation");
				} else {
					estimatedGainDb = safeDelta;
					resultingAudioGainDb = currentAudioGainDb + safeDelta;
					expectedIntegratedLufs = measured + safeDelta;
					expectedTruePeakDbTp = (measuredTp ?? 0) + safeDelta;
					// remove peak block if now safe
					const idx = blockingReasons.indexOf("expected_true_peak_unsafe");
					if (idx >= 0) blockingReasons.splice(idx, 1);
					warnings.push("Gain reduced to respect true-peak policy (no limiter).");
				}
			}
		}
	}

	const mayPropose =
		(classification === "TOO_QUIET" || classification === "TOO_LOUD") &&
		!complex &&
		args.analysis.audioState === "present" &&
		Math.abs(estimatedGainDb) >= policy.minimumMeaningfulDeltaDb &&
		!blockingReasons.includes("expected_true_peak_unsafe") &&
		!blockingReasons.includes("cannot_raise_gain_without_peak_violation") &&
		!blockingReasons.includes("required_gain_exceeds_compositor_limit") &&
		!blockingReasons.includes("delta_below_meaningful_threshold") &&
		!blockingReasons.includes("unsupported_complex_mix") &&
		!blockingReasons.includes("no_audio") &&
		!blockingReasons.includes("insufficient_analysis") &&
		!blockingReasons.includes("already_within_acceptable_band") &&
		!blockingReasons.includes("true_peak_already_high") &&
		!blockingReasons.includes("dynamic_range_concern_not_normalized_in_v1");

	const safeToPropose = mayPropose && blockingReasons.length === 0;

	return {
		id: nextId(),
		assetId: args.analysis.assetId,
		analysis: args.analysis,
		targetPolicy: policy,
		classification,
		estimatedGainDb: safeToPropose ? estimatedGainDb : 0,
		resultingAudioGainDb: safeToPropose ? resultingAudioGainDb : currentAudioGainDb,
		currentAudioGainDb,
		expectedIntegratedLufs: safeToPropose ? expectedIntegratedLufs : measured,
		expectedTruePeakDbTp: safeToPropose ? expectedTruePeakDbTp : measuredTp,
		safeToPropose,
		blockingReasons: safeToPropose ? [] : [...new Set(blockingReasons)],
		evidenceRefs: [
			{
				kind: "loudness_analysis",
				id: `${args.analysis.integratedLufs ?? "na"}`,
				note: `I=${args.analysis.integratedLufs?.toFixed(2) ?? "n/a"} LUFS TP=${args.analysis.truePeakDbTp?.toFixed(2) ?? "n/a"}`,
			},
		],
		warnings,
		mixSupport,
	};
}
