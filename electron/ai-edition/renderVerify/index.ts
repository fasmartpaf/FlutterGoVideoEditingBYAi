/**
 * Render Verification V1
 * Post-edit bounded media check for a single consented trim apply.
 */

export {
	assessFrameBytes,
	blankFrameSampler,
	createInjectedSampler,
	tryFfmpegSourceSampler,
	unavailableSampler,
} from "./frames";
export {
	analyzeTrimProgrammeMapping,
	compressedToSource,
	mustSurviveInProgramme,
} from "./mapping";
export { assessSpeechBoundary } from "./speechBoundary";
export type {
	CompositorSampleStatus,
	RenderedFrameEvidence,
	RenderFrameSampleRequest,
	RenderFrameSampler,
	RenderVerificationBoundary,
	RenderVerificationEvidence,
	RenderVerifyInput,
	RenderVerifyQualityState,
	SpeechBoundaryRisk,
} from "./types";
export {
	RENDER_VERIFY_MAX_FRAMES_PER_SIDE,
	RENDER_VERIFY_PAD_AFTER_SEC,
	RENDER_VERIFY_PAD_BEFORE_SEC,
	RENDER_VERIFY_V1_PROVIDER_ID,
} from "./types";
export { renderVerifyPassed, verifyTrimRender } from "./verify";
