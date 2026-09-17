/**
 * Local Caption Layout + Safe Areas V1 — public API.
 */

export {
	type CaptionLayoutApplyResult,
	type CaptionLayoutConsent,
	documentHasManualOrLegacyCaptions,
	fingerprintDocLite,
	runConsentedCaptionLayoutEnable,
} from "./apply";
export {
	buildCaptionLayoutCacheKey,
	fingerprintProtectedRegions,
	readCaptionLayoutCache,
	writeCaptionLayoutCache,
} from "./cache";
export { detectCollisions, hasBlockingCollision, overlapRatio } from "./collision";
export { groupWordsIntoCaptionDrafts } from "./group";
export { fingerprintWords, layoutCaptions } from "./layout";
export { breakLinesDeterministic, chooseFontSize, estimateTextWidthFrac } from "./measure";
export {
	buildCaptionLayoutOperation,
	CAPTION_VERIFIED_APPLY_TOOL,
	type CaptionLayoutOperationV1,
	classifyDocumentCaptions,
	operationToProvisionalArgs,
	programmeFingerprintFromDocument,
	styleFingerprintFromDocument,
} from "./operation";
export { choosePlacement, PLACEMENT_CANDIDATES } from "./place";
export { DEFAULT_CAPTION_GROUPING_POLICY, mergeGroupingPolicy } from "./policy";
export {
	compressedDurationSec,
	mapSourceSpanThroughDocument,
	virtualSpanToProgrammeSpan,
	wordsSurvivingTrims,
} from "./programmeMap";
export {
	buildCaptionLayoutProposal,
	type CaptionLayoutProposal,
	type CaptionLayoutReviewCopy,
	formatCaptionLayoutReviewCopy,
} from "./proposal";
export { runCaptionLayoutForDocument, survivingWordsFromDocument, wordsFromDocument } from "./run";
export { buildCaptionSafeArea, placementBox, placementStyle } from "./safeArea";
export type {
	CaptionCollision,
	CaptionCueV1,
	CaptionGroupingPolicy,
	CaptionLayoutInput,
	CaptionLayoutResult,
	CaptionPlacementId,
	CaptionProtectedRegion,
	CaptionSafeArea,
	CaptionWordSpan,
} from "./types";
export {
	CAPTION_GROUPING_POLICY_VERSION,
	CAPTION_LAYOUT_VERSION,
	LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID,
} from "./types";
export { type CaptionRenderVerification, verifyCaptionLayoutRender } from "./verify";
