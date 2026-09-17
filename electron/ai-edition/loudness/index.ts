/**
 * Local Loudness Normalize V1 public API.
 */

export { type AnalyzeLoudnessArgs, analyzeLoudness } from "./analyze";
export {
	applyNormalizeGainToDocument,
	type LoudnessApplyResult,
	runConsentedLoudnessNormalize,
} from "./apply";
export { buildLoudnessCacheKey, readLoudnessCache, writeLoudnessCache } from "./cache";
export {
	buildNormalizeCandidate,
	classifyLoudness,
	hasUnsupportedComplexMix,
	resetLoudnessCandidateSeqForTests,
} from "./candidate";
export { parseFfmpegVersionBanner, parseLoudnormPrintJson } from "./parseLoudnorm";
export { DEFAULT_LOUDNESS_TARGET_POLICY } from "./policy";
export {
	candidateToLoudnessProposal,
	formatLoudnessReviewCopy,
	type LoudnessNormalizeProposal,
	type LoudnessReviewCopy,
} from "./proposal";
export {
	type LoudnessNormalizeAnalysisBundle,
	type RunLoudnessNormalizeAnalysisArgs,
	runLoudnessNormalizeAnalysis,
} from "./run";
export type {
	AudioNormalizeCandidateV1,
	LoudnessAnalysisV1,
	LoudnessAudioState,
	LoudnessClassification,
	LoudnessTargetPolicy,
	LoudnessVerifyResult,
} from "./types";
export {
	LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID,
	LOUDNESS_MEASUREMENT_VERSION,
} from "./types";
export { verifyLoudnessAfterNormalize } from "./verify";
