/**
 * Local Visual Analysis Suite V1 — public API.
 * Deterministic / local. TOTAL_PAID_AI_CALLS = 0.
 */

export { type AnalyzeVisualArgs, analyzeVisual } from "./analyse";
export {
	buildVisualAnalysisCacheKey,
	readVisualAnalysisCache,
	writeVisualAnalysisCache,
} from "./cache";
export { sampleBug3ChangeEvents, visualChangesToEvents } from "./changeSample";
export {
	analysisCoversSilence,
	assessVisualActivityFromAnalysis,
	changeEventsToPreparedChanges,
} from "./deadAirBridge";
export {
	type CursorInstant,
	deriveActivityIntervals,
	deriveStableIntervals,
} from "./derive";
export {
	FUTURE_VISUAL_ANALYSIS_CONSUMERS,
	toVisualEditorialSignals,
} from "./editorial";
export {
	type ProbeBatchResult,
	probeVisualFilters,
} from "./ffmpegProbes";
export { DEFAULT_VISUAL_ANALYSIS_PARAMETERS } from "./policy";
export {
	mapSourceInstantToProgramme,
	mapSourceRangeToProgramme,
	type ProgrammeMappedRange,
	type ProgrammeMapStatus,
} from "./programmeMap";
export {
	type ActivityInterval,
	type BlackInterval,
	type FreezeInterval,
	LOCAL_VISUAL_ANALYSIS_V1_PROVIDER_ID,
	type SceneEvent,
	type StableInterval,
	VISUAL_ANALYSIS_DETECTOR_VERSION,
	type VisualAnalysisParameters,
	type VisualAnalysisV1,
	type VisualChangeEvent,
	type VisualChangeLevel,
	type VisualEditorialSignals,
} from "./types";
