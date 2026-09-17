/**
 * Prepare Edit Proposal V1 after Edit Plan (+ optional Closure).
 * Deterministic — 0 model calls. Never executes.
 */

import type { EditGapV1 } from "../editGap/types";
import type { EditCapabilityRegistry, EditPlanV1 } from "../editPlan/types";
import type { MediaContextNeeds } from "../mediaContextNeeds";
import type { PlanningClosureResult } from "../planningClosure/types";
import type { SourceStoryV2 } from "../sourceStory/v2/types";
import type { TargetStoryV1 } from "../targetStory/v1/types";
import { buildEditProposalV1 } from "./buildProposal";
import type { EditProposalV1 } from "./types";
import { EDIT_PROPOSAL_V1_PROVIDER_ID } from "./types";
import { validateAndSanitizeEditProposalV1 } from "./validate";

export function wantsEditProposal(contextNeeds: MediaContextNeeds): boolean {
	return contextNeeds.category === "editingContext";
}

export function prepareEditProposalForTurn(input: {
	contextNeeds: MediaContextNeeds;
	sourceStoryV2?: SourceStoryV2 | null;
	targetStoryV1?: TargetStoryV1 | null;
	editGapV1?: EditGapV1 | null;
	editPlanV1?: EditPlanV1 | null;
	planningClosureV1?: PlanningClosureResult | null;
	availableCapabilities?: EditCapabilityRegistry;
}): { editProposalV1: EditProposalV1; providerId: typeof EDIT_PROPOSAL_V1_PROVIDER_ID } | null {
	if (!wantsEditProposal(input.contextNeeds)) return null;
	if (!input.sourceStoryV2 || !input.targetStoryV1 || !input.editGapV1 || !input.editPlanV1) {
		return null;
	}

	const built = buildEditProposalV1({
		sourceStoryV2: input.sourceStoryV2,
		targetStoryV1: input.targetStoryV1,
		editGapV1: input.editGapV1,
		editPlanV1: input.editPlanV1,
		planningClosureV1: input.planningClosureV1,
		availableCapabilities: input.availableCapabilities,
	});
	const { proposal } = validateAndSanitizeEditProposalV1(built);
	return { editProposalV1: proposal, providerId: EDIT_PROPOSAL_V1_PROVIDER_ID };
}
