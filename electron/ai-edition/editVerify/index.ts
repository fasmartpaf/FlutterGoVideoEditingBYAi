/**
 * Local Edit Verification Expansion V1 — public API.
 * TOTAL_PAID_AI_CALLS = 0. Production applyPreview remains addTrim-only.
 */

export {
	clearEditVerifyFrameCache,
	editVerifyFrameCacheKey,
	getCachedEditVerifyFrame,
	setCachedEditVerifyFrame,
} from "./frameCache";
export {
	type CropGeometryClass,
	classifyCrop,
	cropExcludesRegion,
	cropPreservesRegion,
} from "./geometry/crop";
export { classifyZoomScale, verifyZoomGeometry, visibleWindowForZoom } from "./geometry/zoom";
export { applyCropMutation, applySpeedMutation, applyZoomMutation } from "./mutate";
export { runConsentedVerifiedEdit, type VerifiedEditApplyResult } from "./run";
export { planProgrammeSamples } from "./samples";
export { inspectSceneEffects } from "./sceneInspect";
export {
	expectedProgrammeDurationForSpeed,
	MAX_VERIFY_SPEED,
	MIN_VERIFY_SPEED,
	sourceToProgrammeUnderSpeed,
	verifySpeedTiming,
} from "./speedMath";
export {
	ALLOWED_VERIFY_CLAIMS,
	EDIT_VERIFY_VERSION,
	type EditOperationType,
	type EditVerificationLevel,
	type EditVerificationRequest,
	type EditVerificationResult,
	LOCAL_EDIT_VERIFY_EXPANSION_V1_PROVIDER_ID,
	type MustSurviveRequirement,
	type NormalizedRect,
} from "./types";
export { verifyCrop } from "./verifyCrop";
export { verifySpeed } from "./verifySpeed";
export { verifyZoom } from "./verifyZoom";
