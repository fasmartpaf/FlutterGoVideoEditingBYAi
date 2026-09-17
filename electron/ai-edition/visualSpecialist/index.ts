export { hottestChangeBlock } from "./changeHeat";
export {
	appendVisualSpecialistToLedger,
	specialistHasVerifiedOpenFromOcr,
	specialistObservedText,
} from "./ledgerBridge";
export { MacosVisionOcrEngine, resolveOcrEngine, UnavailableOcrEngine } from "./ocr/engine";
export type { RunReuseVisualInput } from "./reuse";
export {
	buildBoundedSampleCandidates,
	dedupeByDhash,
	dhashFromGray,
	hammingDistance,
	OCR_PREPROCESS_VERSION,
	preprocessForOcr,
	REUSE_VISUAL_PROVIDER_ID,
	runReuseVisualV1,
	TesseractOcrEngine,
} from "./reuse";
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
	OcrStatus,
	SourceResCrop,
	VisualObservation,
	VisualObservationKind,
	VisualSpecialistBudgets,
	VisualSpecialistMetrics,
	VisualSpecialistResult,
} from "./types";
export { DEFAULT_VISUAL_SPECIALIST_BUDGETS } from "./types";
