/**
 * Recompute full cognition chain after investigation evidence.
 * Ledger → Claim Promotion → Source Story V2 → Target Story V1 → Edit Gap → Edit Plan
 */

import { buildClaimPromotionSet } from "../claimPromotion";
import type { ClaimPromotionSet } from "../claimPromotion/types";
import { buildEditGapV1, validateAndSanitizeEditGapV1 } from "../editGap";
import type { EditGapV1 } from "../editGap/types";
import { buildEditPlanV1, validateAndSanitizeEditPlanV1 } from "../editPlan";
import type { EditPlanV1 } from "../editPlan/types";
import { buildSourceStoryEvidenceInput, buildSourceStoryV2 } from "../sourceStory/v2";
import type { SourceStoryV2 } from "../sourceStory/v2/types";
import { buildTargetStoryV1 } from "../targetStory/v1";
import type { TargetStoryV1 } from "../targetStory/v1/types";
import type { TemporalEventLedger } from "../temporalEventLedger/types";
import type { InvestigationEvidenceSet } from "../videoInvestigator/types";
import type { PlanningClosureEvidenceContext } from "./types";

export interface RecomputeChainResult {
	ledger: TemporalEventLedger | null | undefined;
	claimPromotion: ClaimPromotionSet | undefined;
	sourceStoryV2: SourceStoryV2;
	targetStoryV1: TargetStoryV1;
	editGapV1: EditGapV1;
	editPlanV1: EditPlanV1;
	timingsMs: Record<string, number>;
}

export function recomputeCognitionChain(input: {
	ctx: PlanningClosureEvidenceContext;
	investigation?: InvestigationEvidenceSet | null;
	priorLedger?: TemporalEventLedger | null;
	userIntent: string;
}): RecomputeChainResult {
	const timings: Record<string, number> = {};
	const ledger = input.priorLedger ?? input.ctx.ledger ?? null;

	let t0 = performance.now();
	const claimPromotion = ledger
		? buildClaimPromotionSet({
				ledger,
				investigation: input.investigation ?? undefined,
				userQuery: input.userIntent,
				lazy: false,
			})
		: (input.ctx.claimPromotion ?? undefined);
	timings.claimPromotion = performance.now() - t0;

	t0 = performance.now();
	const evidenceInput = buildSourceStoryEvidenceInput({
		assetId: input.ctx.assetId,
		sourceDurationSec: input.ctx.sourceDurationSec,
		speechEvidence: input.ctx.speechEvidence ?? undefined,
		frames: input.ctx.frames,
		changes: input.ctx.changes,
		cursorEventTimes: input.ctx.cursorEventTimes,
		ledger: ledger ?? undefined,
		claimPromotion: claimPromotion ?? undefined,
		investigation: input.investigation ?? undefined,
	});
	const sourceStoryV2 = buildSourceStoryV2(evidenceInput);
	timings.sourceStory = performance.now() - t0;

	t0 = performance.now();
	const targetStoryV1 = buildTargetStoryV1({
		sourceStoryV2,
		userIntent: input.userIntent,
	});
	timings.targetStory = performance.now() - t0;

	t0 = performance.now();
	const editGapV1 = validateAndSanitizeEditGapV1(
		buildEditGapV1({
			sourceStoryV2,
			targetStoryV1,
			userIntent: input.userIntent,
		}),
	).gap;
	timings.editGap = performance.now() - t0;

	t0 = performance.now();
	const editPlanV1 = validateAndSanitizeEditPlanV1(
		buildEditPlanV1({
			sourceStoryV2,
			targetStoryV1,
			editGapV1,
		}),
	).plan;
	timings.editPlan = performance.now() - t0;

	return {
		ledger,
		claimPromotion,
		sourceStoryV2,
		targetStoryV1,
		editGapV1,
		editPlanV1,
		timingsMs: timings,
	};
}
