/**
 * Prepare Edit Plan V1 after Edit Gap V1.
 * Deterministic only — 0 additional model calls. No execution.
 */

import type { EditGapV1 } from "../editGap/types";
import type { MediaContextNeeds } from "../mediaContextNeeds";
import type { SourceStoryV2 } from "../sourceStory/v2/types";
import type { TargetStoryV1 } from "../targetStory/v1/types";
import { buildEditPlanV1 } from "./buildPlan";
import type { EditCapabilityRegistry, EditPlanV1 } from "./types";
import { EDIT_PLAN_V1_PROVIDER_ID } from "./types";
import { validateAndSanitizeEditPlanV1 } from "./validate";

export function wantsEditPlan(contextNeeds: MediaContextNeeds): boolean {
	return contextNeeds.category === "editingContext";
}

export function prepareEditPlanForTurn(input: {
	contextNeeds: MediaContextNeeds;
	sourceStoryV2?: SourceStoryV2 | null;
	targetStoryV1?: TargetStoryV1 | null;
	editGapV1?: EditGapV1 | null;
	availableCapabilities?: EditCapabilityRegistry;
}): { editPlanV1: EditPlanV1; providerId: typeof EDIT_PLAN_V1_PROVIDER_ID } | null {
	if (!wantsEditPlan(input.contextNeeds)) return null;
	if (!input.sourceStoryV2 || !input.targetStoryV1 || !input.editGapV1) return null;

	const built = buildEditPlanV1({
		sourceStoryV2: input.sourceStoryV2,
		targetStoryV1: input.targetStoryV1,
		editGapV1: input.editGapV1,
		availableCapabilities: input.availableCapabilities,
	});
	const { plan } = validateAndSanitizeEditPlanV1(built);
	return { editPlanV1: plan, providerId: EDIT_PLAN_V1_PROVIDER_ID };
}
