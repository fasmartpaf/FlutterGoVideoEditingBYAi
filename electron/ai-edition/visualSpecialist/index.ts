export { hottestChangeBlock } from "./changeHeat";
export {
	appendVisualSpecialistToLedger,
	specialistHasVerifiedOpenFromOcr,
	specialistObservedText,
} from "./ledgerBridge";
export { MacosVisionOcrEngine, resolveOcrEngine, UnavailableOcrEngine } from "./ocr/engine";
export {
	mergeSpecialistIntoInvestigation,
	type RunVisualSpecialistInput,
	runVisualSpecialistV1,
} from "./run";
export {
	cropRectForPreset,
	extractSourceResolutionCrop,
	probeVideoSize,
} from "./sourceCrop";
export type {
	OcrLine,
	OcrResult,
	SourceResCrop,
	VisualObservation,
	VisualObservationKind,
	VisualSpecialistBudgets,
	VisualSpecialistMetrics,
	VisualSpecialistResult,
} from "./types";
export { DEFAULT_VISUAL_SPECIALIST_BUDGETS } from "./types";
