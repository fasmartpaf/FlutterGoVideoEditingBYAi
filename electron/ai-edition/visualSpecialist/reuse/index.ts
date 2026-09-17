export type { BoundedSamplingInput, SampleCandidate } from "./boundedSampling";
export { buildBoundedSampleCandidates } from "./boundedSampling";
export {
	DEFAULT_DEDUP_HAMMING,
	DHASH_SIZE,
	OCR_PREPROCESS_VERSION,
	REUSE_VISUAL_PROVIDER_ID,
} from "./constants";
export type { DedupeCandidate, DedupeResult } from "./dedupe";
export { dedupeByDhash } from "./dedupe";
export { dhashFromGray, dhashImage, hammingDistance } from "./dhash";
export { buildOcrCacheKey, OcrResultCache } from "./ocrCache";
export { preprocessForOcr } from "./ocrPreprocess";
export type { RunReuseVisualInput } from "./runReuse";
export { runReuseVisualV1 } from "./runReuse";
export { probeSceneTimesInRange } from "./sceneDetect";
export { isTesseractAvailable, TesseractOcrEngine } from "./tesseractEngine";
