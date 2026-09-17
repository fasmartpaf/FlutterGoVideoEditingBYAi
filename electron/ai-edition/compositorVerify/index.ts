/**
 * Offscreen Native Compositor Verification V1
 */

export { analyzeRgba8, makeGradientRgba, makeSolidRgba } from "./pixels";
export {
	assertSourceOutsideRemoved,
	clipInputsForProgrammeWindow,
	locateProgrammeInstant,
} from "./programmeMap";
export {
	createInjectedCompositorSampler,
	NativeCompositorFrameSampler,
	writeCompositorMeta,
} from "./sampler";
export type {
	CompositedFrameResult,
	CompositedFrameSampleRequest,
	CompositedFrameSampler,
	CompositorBackendLabel,
	CompositorVerifyQualityState,
	FrameProviderKind,
} from "./types";
export { COMPOSITOR_VERIFY_V1_PROVIDER_ID } from "./types";
export type { CompositorTrimVerifyEvidence, CompositorTrimVerifyInput } from "./verify";
export { compositorVerifyPassed, verifyTrimWithCompositor } from "./verify";
