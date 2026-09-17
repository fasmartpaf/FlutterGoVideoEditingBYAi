/**
 * Prepare Planning Closure after Edit Plan when evidence is missing.
 * Does not execute edits. Does not mutate AxcutDocument.
 */

import type { EditGapV1 } from "../editGap/types";
import type { EditPlanV1 } from "../editPlan/types";
import type { MediaContextNeeds } from "../mediaContextNeeds";
import type { SourceStoryV2 } from "../sourceStory/v2/types";
import type { TargetStoryV1 } from "../targetStory/v1/types";
import { generateEvidenceRequests } from "./requests";
import { runPlanningClosureV1 } from "./runClosure";
import type { PlanningClosureEvidenceContext, PlanningClosureResult } from "./types";
import { itemNeedsEvidence, PLANNING_CLOSURE_V1_PROVIDER_ID } from "./types";

export function wantsPlanningClosure(contextNeeds: MediaContextNeeds): boolean {
	return contextNeeds.category === "editingContext";
}

export function planMayNeedClosure(plan: EditPlanV1): boolean {
	if (plan.items.some(itemNeedsEvidence)) return true;
	// Crop-safety only path
	return generateEvidenceRequests(plan, { maxRequests: 1 }).length > 0;
}

export async function preparePlanningClosureForTurn(input: {
	contextNeeds: MediaContextNeeds;
	sourceStoryV2?: SourceStoryV2 | null;
	targetStoryV1?: TargetStoryV1 | null;
	editGapV1?: EditGapV1 | null;
	editPlanV1?: EditPlanV1 | null;
	evidence: PlanningClosureEvidenceContext;
	/** Skip real investigator (tests / offline). */
	investigate?: Parameters<typeof runPlanningClosureV1>[0]["investigate"];
	mergeInvestigation?: Parameters<typeof runPlanningClosureV1>[0]["mergeInvestigation"];
}): Promise<{
	closure: PlanningClosureResult;
	finalPlan: EditPlanV1;
	providerId: typeof PLANNING_CLOSURE_V1_PROVIDER_ID;
} | null> {
	if (!wantsPlanningClosure(input.contextNeeds)) return null;
	if (!input.sourceStoryV2 || !input.targetStoryV1 || !input.editGapV1 || !input.editPlanV1) {
		return null;
	}
	if (!planMayNeedClosure(input.editPlanV1)) {
		// Explicit no-op result for metrics / callers
		const closure = await runPlanningClosureV1({
			initialPlan: input.editPlanV1,
			sourceStoryV2: input.sourceStoryV2,
			targetStoryV1: input.targetStoryV1,
			editGapV1: input.editGapV1,
			evidence: input.evidence,
			investigate: async () => null,
		});
		return {
			closure,
			finalPlan: input.editPlanV1,
			providerId: PLANNING_CLOSURE_V1_PROVIDER_ID,
		};
	}

	const closure = await runPlanningClosureV1({
		initialPlan: input.editPlanV1,
		sourceStoryV2: input.sourceStoryV2,
		targetStoryV1: input.targetStoryV1,
		editGapV1: input.editGapV1,
		evidence: input.evidence,
		investigate: input.investigate,
		mergeInvestigation: input.mergeInvestigation,
	});
	const finalSnap = closure.planVersions[closure.planVersions.length - 1];
	return {
		closure,
		finalPlan: finalSnap?.plan ?? input.editPlanV1,
		providerId: PLANNING_CLOSURE_V1_PROVIDER_ID,
	};
}
