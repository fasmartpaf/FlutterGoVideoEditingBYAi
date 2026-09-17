/**
 * Editorial Recommendation Product Surface V1 — types.
 */

import type { ApplyPreflight } from "../applyPreview/types";
import { APPLY_PREVIEW_V1_PROVIDER_ID } from "../applyPreview/types";
import type { ReasonedEditorialRecommendationSetV1 } from "../boundedEditorialReasoning/types";
import type {
	EditorialRecommendationSetV1,
	EditorialRecommendationV1,
	EditorialSignalBundle,
} from "../editorialOrchestration/types";
import type { EditProposalV1 } from "../editProposal/types";
import type { EditReviewAttachment } from "../uiConsent/types";

export const EDITORIAL_RECOMMENDATION_PRODUCT_SURFACE_V1_ID =
	"CURRENT_OPENSCREEN_EDITORIAL_RECOMMENDATION_PRODUCT_SURFACE_V1" as const;

export interface ProductEditorialIntents {
	wantCaptions: boolean;
	wantTighter: boolean;
	wantProfessional: boolean;
	wantClarity: boolean;
	targetDurationSec: number | null;
	rawGoalText: string;
}

export type LocalSupportedFamily = "trim" | "caption" | "zoom" | "crop" | "speed" | "loudness";

export interface EditorialRecommendationProductSurfaceResult {
	providerId: typeof EDITORIAL_RECOMMENDATION_PRODUCT_SURFACE_V1_ID;
	intents: ProductEditorialIntents;
	signalBundle: EditorialSignalBundle;
	orchestrationSet: EditorialRecommendationSetV1;
	reasonedSet: ReasonedEditorialRecommendationSetV1 | null;
	selectedRecommendation: EditorialRecommendationV1 | null;
	editProposalV1: EditProposalV1 | null;
	applyPreviewV1: {
		providerId: typeof APPLY_PREVIEW_V1_PROVIDER_ID;
		preflight: ApplyPreflight;
		mutations: 0;
		additionalOrchestrationModelCalls: 0;
	} | null;
	editReview: EditReviewAttachment | null;
	/** Families the local stack can ground in user-facing prose this turn. */
	supportedFamilies: LocalSupportedFamily[];
	userFacingOffer: string | null;
	doNothing: boolean;
	notes: string[];
	metrics: {
		gatherMs: number;
		orchestrateMs: number;
		reasonMs: number;
		proposalMs: number;
		deadAirRan: boolean;
		captionLayoutRan: boolean;
		additionalModelCalls: 0;
		paidAiCalls: 0;
		autoMutations: 0;
	};
}
