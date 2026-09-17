/**
 * Local Loudness Analysis + Normalize V1 — types.
 * Domains: analysis = primary programme audio (source file V1);
 * apply = legacyEditor.audioGainDb; verify = FFmpeg measure after volume=gain.
 */

export const LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID =
	"CURRENT_OPENSCREEN_LOCAL_LOUDNESS_NORMALIZE_V1" as const;

export const LOUDNESS_MEASUREMENT_VERSION = "v1" as const;

export type LoudnessAudioState =
	| "present"
	| "absent"
	| "probe_failed"
	| "ffmpeg_unavailable"
	| "cancelled"
	| "timeout"
	| "malformed"
	| "parse_failed";

export type LoudnessClassification =
	| "ALREADY_ACCEPTABLE"
	| "TOO_QUIET"
	| "TOO_LOUD"
	| "TRUE_PEAK_RISK"
	| "DYNAMIC_RANGE_CONCERN"
	| "NO_AUDIO"
	| "INSUFFICIENT_ANALYSIS"
	| "UNSUPPORTED_COMPLEX_MIX";

export interface LoudnessAnalysisV1 {
	version: 1;
	measurementVersion: typeof LOUDNESS_MEASUREMENT_VERSION;
	providerId: typeof LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID;
	assetId: string;
	mediaPath: string;
	/** V1: PRIMARY_SOURCE_AUDIO (screen track). Not full mixed export. */
	analysisDomain: "PRIMARY_SOURCE_AUDIO";
	audioState: LoudnessAudioState;
	integratedLufs: number | null;
	truePeakDbTp: number | null;
	loudnessRangeLra: number | null;
	thresholdLufs: number | null;
	durationSec: number | null;
	ffmpegVersion: string | null;
	parameters: {
		targetIntegratedLufs: number;
		maxTruePeakDbTp: number;
		lra: number;
	};
	latencyMs: number;
	cacheHit: boolean;
	error?: string;
	stderrExcerpt?: string;
}

export interface LoudnessTargetPolicy {
	/** Online / screen-recording speech target (not EBU R128 -23 broadcast). */
	targetIntegratedLufs: number;
	/** Acceptable band around target before proposing. */
	acceptableBandDb: number;
	maxTruePeakDbTp: number;
	maxGainIncreaseDb: number;
	maxGainReductionDb: number;
	minimumMeaningfulDeltaDb: number;
	/** Matches compositor AUDIO_GAIN_DB_LIMIT. */
	compositorGainLimitDb: number;
	/** Post-apply integrated LUFS tolerance. */
	verifyIntegratedToleranceDb: number;
	/** Post-apply true-peak must stay ≤ this. */
	verifyMaxTruePeakDbTp: number;
}

export interface AudioNormalizeCandidateV1 {
	id: string;
	assetId: string;
	analysis: LoudnessAnalysisV1;
	targetPolicy: LoudnessTargetPolicy;
	classification: LoudnessClassification;
	/** Delta to apply relative to current programme audioGainDb (usually absolute target makeup). */
	estimatedGainDb: number;
	/** Absolute programme audioGainDb after apply (clamped). */
	resultingAudioGainDb: number;
	currentAudioGainDb: number;
	expectedIntegratedLufs: number | null;
	expectedTruePeakDbTp: number | null;
	safeToPropose: boolean;
	blockingReasons: string[];
	evidenceRefs: Array<{ kind: string; id: string; note: string }>;
	warnings: string[];
	/** Honest V1 scope. */
	mixSupport: "single_primary" | "unsupported_complex_mix";
}

export interface LoudnessVerifyResult {
	passed: boolean;
	blocking: boolean;
	notes: string[];
	before: LoudnessAnalysisV1;
	after: LoudnessAnalysisV1 | null;
	appliedGainDb: number;
	latencyMs: number;
}
