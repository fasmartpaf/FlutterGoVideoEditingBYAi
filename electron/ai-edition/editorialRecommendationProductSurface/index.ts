/**
 * Editorial Recommendation Product Surface V1 — public API.
 * Wires local editorial stack into chat review cards (consent still required).
 */

export {
	type GatheredLocalSignals,
	type GatherLocalSignalsArgs,
	gatherLocalEditorialSignals,
} from "./gatherSignals";
export {
	goalTextForReasoning,
	parseProductEditorialIntents,
	shouldRunDeadAir,
} from "./intents";
export {
	type RunEditorialRecommendationProductSurfaceArgs,
	runEditorialRecommendationProductSurface,
} from "./run";
export {
	buildUserFacingOffer,
	recommendationToEditProposal,
	selectProductRecommendation,
} from "./toProposal";
export type {
	EditorialRecommendationProductSurfaceResult,
	LocalSupportedFamily,
	ProductEditorialIntents,
} from "./types";
export { EDITORIAL_RECOMMENDATION_PRODUCT_SURFACE_V1_ID } from "./types";
