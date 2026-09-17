/**
 * Local Dead-Air Shorten V1 / Visual Safety V1.1 public API.
 */

export { type AnalyzeDeadAirArgs, analyzeDeadAir } from "./analyze";
export { buildSilenceCacheKey, readSilenceCache, writeSilenceCache } from "./cache";
export {
	buildDeadAirCandidate,
	classifySilenceInterval,
	resetDeadAirCandidateSeqForTests,
	resolveSpeechWindows,
	type SpeechWindow,
	speechWindowsFromEvidence,
	speechWindowsFromTranscript,
} from "./classify";
export {
	DEFAULT_DEAD_AIR_POLICY,
	type DeadAirPolicyConfig,
	EXPLICIT_PAUSE_REMOVAL_DEAD_AIR_POLICY,
	PROFESSIONAL_YOU_DECIDE_DEAD_AIR_POLICY,
	targetPauseForClassification,
} from "./config";
export { detectSilenceIntervals } from "./detect";
export {
	parseBlackdetectStderr,
	parseFreezedetectStderr,
	probeBlackInRange,
	probeFreezeInRange,
	probeSceneChangesInRange,
} from "./ffmpegVisualProbes";
export { planKeepSomePause } from "./keepPause";
export { parseFfmpegVersionBanner, parseSilencedetectStderr } from "./parseSilencedetect";
export {
	filterCandidatesByProgrammeMapping,
	mapCandidateToProgramme,
} from "./programmeMap";
export {
	deadAirCandidateToProposalItem,
	formatDeadAirReviewCopy,
	selectSingleDeadAirCandidate,
	wrapDeadAirProposal,
} from "./proposal";
export type {
	AudioState,
	DeadAirAnalysisBundle,
	DeadAirCandidateV1,
	DeadAirConfidence,
	SilenceClassification,
	SilenceDetectorParameters,
	SilenceDetectorResult,
	SilenceInterval,
	SourceTimeRange,
	SpeechAnchorRef,
	VisualActivityHit,
} from "./types";
export { LOCAL_DEAD_AIR_V1_PROVIDER_ID } from "./types";
export {
	LOCAL_DEAD_AIR_VISUAL_SAFETY_V1_1,
	VISUAL_SAFETY_VERSION,
	type VisualActivityAssessment,
	type VisualActivityEvidence,
	type VisualActivityKind,
	type VisualActivityState,
} from "./visualActivityTypes";
export {
	DEFAULT_VISUAL_SAFETY_POLICY,
	type VisualSafetyPolicy,
} from "./visualPolicy";
export {
	type AssessVisualActivityArgs,
	assessVisualActivity,
	type CachedOcrObservation,
	collectVisualActivityInRange,
	hasBlockingVisualActivity,
	resetVisualActivitySeqForTests,
	visualAssessmentBlocksSafePropose,
} from "./visualSafety";
