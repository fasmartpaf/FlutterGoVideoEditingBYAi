/**
 * Planning → Investigation Closure V1 orchestrator.
 * 0 orchestration/policy LLM calls. Does not execute edits.
 */

import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import { runMasterVideoInvestigatorV1_1 } from "../videoInvestigator";
import type { InvestigationEvidenceSet } from "../videoInvestigator/types";
import { analyzePlanRedundancy, classifyItemOutcomes, isMaterialPlanChange } from "./material";
import { recomputeCognitionChain } from "./recompute";
import { generateEvidenceRequests } from "./requests";
import type {
	PlanningClosureBudgets,
	PlanningClosureEvidenceContext,
	PlanningClosureInput,
	PlanningClosureResult,
	PlanningClosureRound,
	PlanningEvidenceRequest,
	PlanVersionSnapshot,
} from "./types";
import { DEFAULT_CLOSURE_BUDGETS, PLANNING_CLOSURE_V1_PROVIDER_ID } from "./types";

function emptyInvestigation(
	ctx: PlanningClosureEvidenceContext,
	reason: string,
): InvestigationEvidenceSet {
	return {
		version: 1,
		assetId: ctx.assetId,
		timebase: "SOURCE_MEDIA_TIME",
		questionSummary: reason,
		focusRange: { startSourceTimeSec: 0, endSourceTimeSec: ctx.sourceDurationSec },
		stopReason: "insufficient_evidence",
		coverage: {
			sourceDurationSec: ctx.sourceDurationSec,
			rangesInspected: [],
			frameTimesSec: [],
			roiCount: 0,
			modalitiesTouched: [],
			absenceIsStrong: true,
		},
		observations: [],
		claims: [],
		toolTrace: [],
		metrics: {
			memoryQueryMs: 0,
			planningMs: 0,
			toolExecutionMs: 0,
			verificationMs: 0,
			totalInvestigationMs: 0,
			frameCacheHits: 0,
			frameCacheMisses: 0,
			newlyExtractedFrames: 0,
			roiExtractMs: 0,
			transcriptRetrievalMs: 0,
			cursorRetrievalMs: 0,
			investigatorModelCalls: 0,
			stepsUsed: 0,
			toolCalls: 0,
			policyVersion: "v1.1",
		},
		internalBriefing: "",
		additionalFrames: [],
		providerId: "CURRENT_OPENSCREEN_INVESTIGATOR_V1_1",
	};
}

async function defaultInvestigate(
	request: PlanningEvidenceRequest,
	ctx: PlanningClosureEvidenceContext,
): Promise<InvestigationEvidenceSet | null> {
	const needs = ctx.contextNeeds ?? classifyMediaContextNeeds(request.focusedUserMessage);

	return runMasterVideoInvestigatorV1_1({
		userMessage: request.focusedUserMessage,
		needs,
		assetId: ctx.assetId,
		sourceDurationSec: ctx.sourceDurationSec,
		videoPath: ctx.videoPath ?? null,
		speechEvidence: ctx.speechEvidence,
		frames: ctx.frames,
		changes: ctx.changes,
		cursorInteractions: ctx.cursorInteractions,
		ledger: ctx.ledger ?? undefined,
		claimPromotion: ctx.claimPromotion ?? undefined,
		ffmpegPath: ctx.ffmpegPath,
		roleBudgets: {
			maxGroundingRanges: 3,
			maxVisualInspections: 2,
			maxOcrInspections: 2,
			maxSpeechQueries: 1,
			maxCursorQueries: 2,
			maxContradictionChecks: 2,
			maxVerificationPasses: 1,
			maxRankedRanges: 2,
		},
		budgets: {
			maxSteps: 8,
			maxFrameInspections: 3,
			maxRangeInspections: 2,
			maxRoiInspections: 2,
			maxCompareCalls: 1,
			maxRepeatedRangeInspections: 1,
			maxBriefingChars: 2500,
		},
	});
}

/**
 * Run bounded planning→investigation closure. Never mutates AxcutDocument / never calls edit tools.
 */
export async function runPlanningClosureV1(
	input: PlanningClosureInput,
): Promise<PlanningClosureResult> {
	const tTotal = performance.now();
	const budgets: PlanningClosureBudgets = {
		...DEFAULT_CLOSURE_BUDGETS,
		...input.budgets,
	};

	const planVersions: PlanVersionSnapshot[] = [
		{
			versionIndex: 0,
			plan: input.initialPlan,
			sourceStoryV2: input.sourceStoryV2,
			targetStoryV1: input.targetStoryV1,
			editGapV1: input.editGapV1,
			label: "initial",
			round: 0,
		},
	];

	let currentPlan = input.initialPlan;
	let currentSource = input.sourceStoryV2;
	let currentTarget = input.targetStoryV1;
	let currentGap = input.editGapV1;
	let ctx = { ...input.evidence };
	const investigate = input.investigate ?? defaultInvestigate;

	const rounds: PlanningClosureRound[] = [];
	const allRequests: PlanningEvidenceRequest[] = [];
	const executedIdentities = new Set<string>();
	let duplicatesSuppressed = 0;
	let investigatorInvocations = 0;
	let providerCallsApprox = 0;
	let cacheHits = 0;
	let cacheMisses = 0;
	let requestGenMs = 0;
	let investigationMs = 0;
	let recomputeMs = 0;
	const breakdown: Record<string, number> = {};

	let stopReason: PlanningClosureResult["stopReason"] = "no_requests_needed";

	for (let round = 1; round <= budgets.maxRounds; round++) {
		const tReq = performance.now();
		const generated = generateEvidenceRequests(currentPlan, {
			maxRequests: budgets.maxRequestsPerRound,
		});
		requestGenMs += performance.now() - tReq;

		const requests: PlanningEvidenceRequest[] = [];
		const skippedDuplicateIds: string[] = [];
		for (const req of generated) {
			if (executedIdentities.has(req.identityKey)) {
				skippedDuplicateIds.push(req.id);
				duplicatesSuppressed += 1;
				continue;
			}
			if (requests.length >= budgets.maxRequestsPerRound) break;
			requests.push(req);
		}

		if (requests.length === 0) {
			stopReason = round === 1 ? "no_requests_needed" : "insufficient_evidence";
			break;
		}

		allRequests.push(...requests);
		const investigationSummaries: PlanningClosureRound["investigationSummaries"] = [];
		let lastInvestigation: InvestigationEvidenceSet | null = null;

		for (const req of requests) {
			executedIdentities.add(req.identityKey);
			const tInv = performance.now();
			let inv: InvestigationEvidenceSet | null = null;
			try {
				inv = await investigate(req, ctx);
			} catch {
				inv = emptyInvestigation(ctx, "investigation_failed");
			}
			const invMs = performance.now() - tInv;
			investigationMs += invMs;
			investigatorInvocations += 1;
			lastInvestigation = inv;

			if (input.mergeInvestigation) {
				ctx = input.mergeInvestigation(ctx, inv, req);
			}

			const metrics = inv?.metrics;
			providerCallsApprox += metrics?.investigatorModelCalls ?? 0;
			cacheHits += metrics?.frameCacheHits ?? 0;
			cacheMisses += metrics?.frameCacheMisses ?? 0;

			investigationSummaries.push({
				requestId: req.id,
				stopReason: inv?.stopReason,
				claimCount: inv?.claims.length ?? 0,
				observationCount: inv?.observations.length ?? 0,
				providerCallsApprox: metrics?.investigatorModelCalls ?? 0,
				ms: invMs,
			});
		}

		const tRec = performance.now();
		const rebuilt = recomputeCognitionChain({
			ctx,
			investigation: lastInvestigation,
			priorLedger: ctx.ledger,
			userIntent: ctx.userMessage,
		});
		const recMs = performance.now() - tRec;
		recomputeMs += recMs;
		for (const [k, v] of Object.entries(rebuilt.timingsMs)) {
			breakdown[k] = (breakdown[k] ?? 0) + v;
		}
		if (rebuilt.claimPromotion) {
			ctx = { ...ctx, claimPromotion: rebuilt.claimPromotion };
		}

		const materialChange = isMaterialPlanChange(currentPlan, rebuilt.editPlanV1);
		const versionIndex = planVersions.length;
		planVersions.push({
			versionIndex,
			plan: rebuilt.editPlanV1,
			sourceStoryV2: rebuilt.sourceStoryV2,
			targetStoryV1: rebuilt.targetStoryV1,
			editGapV1: rebuilt.editGapV1,
			label: "after_closure_round",
			round,
		});

		rounds.push({
			round,
			requests,
			skippedDuplicateIds,
			investigationSummaries,
			materialChange,
			planVersionIndex: versionIndex,
		});

		currentPlan = rebuilt.editPlanV1;
		currentSource = rebuilt.sourceStoryV2;
		currentTarget = rebuilt.targetStoryV1;
		currentGap = rebuilt.editGapV1;

		const stillNeeds = currentPlan.items.some(
			(i) =>
				i.preferredStrategy === "needs_more_evidence" || i.feasibility === "needs_more_evidence",
		);

		if (!materialChange) {
			stopReason = "no_material_change";
			break;
		}
		if (!stillNeeds) {
			stopReason = "all_resolved";
			break;
		}
		if (round >= budgets.maxRounds) {
			stopReason = stillNeeds ? "budget_exhausted" : "all_resolved";
			break;
		}
		stopReason = stillNeeds ? "insufficient_evidence" : "all_resolved";
	}

	// Finalize last snapshot label
	const last = planVersions[planVersions.length - 1];
	if (last && last.label !== "initial") {
		last.label = "final";
	}

	const outcomes = classifyItemOutcomes(input.initialPlan, currentPlan);
	const redundancyNotes = analyzePlanRedundancy(currentPlan);

	const result: PlanningClosureResult = {
		version: 1,
		providerId: PLANNING_CLOSURE_V1_PROVIDER_ID,
		rounds,
		planVersions,
		initialPlanId: `v0:${input.initialPlan.assetId}`,
		finalPlanId: `v${planVersions.length - 1}:${currentPlan.assetId}`,
		resolvedItems: outcomes.resolved,
		unresolvedItems: outcomes.unresolved,
		invalidatedItems: outcomes.invalidated,
		evidenceRequests: allRequests,
		stopReason,
		redundancyNotes,
		metrics: {
			closureRounds: rounds.length,
			evidenceRequestsGenerated: allRequests.length + duplicatesSuppressed,
			evidenceRequestsExecuted: allRequests.length,
			duplicatesSuppressed,
			investigatorInvocations,
			orchestrationModelCalls: 0,
			providerCallsFromInvestigatorApprox: providerCallsApprox,
			cacheHitsApprox: cacheHits,
			cacheMissesApprox: cacheMisses,
			latencyMs: {
				requestGeneration: requestGenMs,
				investigation: investigationMs,
				recompute: recomputeMs,
				total: performance.now() - tTotal,
				breakdown,
			},
			serializedBytesApprox: 0,
			additionalOrchestrationModelCalls: 0,
		},
	};
	// Keep versions + current for consumers (attach lightly)
	void currentSource;
	void currentTarget;
	void currentGap;
	result.metrics.serializedBytesApprox = JSON.stringify(result).length;
	return result;
}
