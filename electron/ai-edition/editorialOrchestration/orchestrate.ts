/**
 * Local Editorial Orchestration — assemble signals into a reviewable set.
 * Precision Closure V1: recommendations[] = surfaceable edit cards only.
 * TOTAL_PAID_AI_CALLS = 0. AUTO_MUTATIONS = 0.
 */

import {
	adaptCaptions,
	adaptDeadAir,
	adaptLoudness,
	adaptPreservation,
	adaptSpeedIntent,
	adaptVisual,
	resetOrchestrationSeqForTests,
} from "./adapters";
import {
	buildOrchestrationCacheKey,
	buildOrchestrationCacheKeyParts,
	readOrchestrationCache,
	writeOrchestrationCache,
} from "./cache";
import { buildPreservedRanges, resolveConflictsAndRedundancy } from "./conflict";
import { mergeOrchestrationPolicy } from "./policy";
import { applyRecommendationBudget, buildDeterministicSummary, deriveSetStatus } from "./rank";
import { aggregateExecutionReadiness } from "./readiness";
import { applySurfaceFilter, resetSurfaceSeqForTests } from "./surface";
import type {
	EditorialOrchestrationPolicy,
	EditorialRecommendationSetV1,
	EditorialRecommendationV1,
	EditorialSignalBundle,
} from "./types";
import {
	EDITORIAL_ORCHESTRATION_POLICY_VERSION,
	LOCAL_EDITORIAL_ORCHESTRATION_V1_PROVIDER_ID,
} from "./types";

export { resetOrchestrationSeqForTests, resetSurfaceSeqForTests };

export interface OrchestrateArgs {
	bundle: EditorialSignalBundle;
	policy?: Partial<EditorialOrchestrationPolicy>;
	/** When true, skip cache read/write. */
	bypassCache?: boolean;
}

export interface OrchestrateResult {
	set: EditorialRecommendationSetV1;
	/** Pre-surface candidates (audit). */
	rawRecommendations: EditorialRecommendationV1[];
	executionReadiness: ReturnType<typeof aggregateExecutionReadiness>;
	conflictEdges: Array<{ a: string; b: string; reason: string; resolution: string }>;
	cacheKey: string;
}

export function orchestrateFromSignals(args: OrchestrateArgs): OrchestrateResult {
	const t0 = Date.now();
	const policy = mergeOrchestrationPolicy(args.policy);
	const keyParts = buildOrchestrationCacheKeyParts(args.bundle, policy);
	const cacheKey = buildOrchestrationCacheKey(keyParts);

	if (!args.bypassCache) {
		const hit = readOrchestrationCache<OrchestrateResult>(cacheKey);
		if (hit) {
			return {
				...hit,
				set: {
					...hit.set,
					metrics: { ...hit.set.metrics, cacheHit: true, totalMs: Date.now() - t0 },
				},
			};
		}
	}

	const tSignal = Date.now();
	const signalCollectionMs = Date.now() - tSignal;

	const tFind = Date.now();
	const da = adaptDeadAir(args.bundle);
	const loud = adaptLoudness(args.bundle);
	const cap = adaptCaptions(args.bundle, policy);
	const vis = adaptVisual(args.bundle, policy);
	const speed = adaptSpeedIntent(args.bundle, policy);
	const pres = adaptPreservation(args.bundle);

	const findings = [
		...da.findings,
		...loud.findings,
		...cap.findings,
		...vis.findings,
		...speed.findings,
		...pres.findings,
	];
	const seeds: EditorialRecommendationV1[] = [
		...da.seeds,
		...loud.seeds,
		...cap.seeds,
		...vis.seeds,
		...speed.seeds,
	];
	const findingMs = Date.now() - tFind;

	const preservedRanges = buildPreservedRanges(findings);

	const tConf = Date.now();
	const { recommendations: afterConflict, edges } = resolveConflictsAndRedundancy({
		recommendations: seeds,
		preserved: preservedRanges,
		policy,
	});
	const conflictMs = Date.now() - tConf;

	const tRank = Date.now();
	// Soft budget on raw candidates before surface filter (conflicts already applied)
	const ranked = applyRecommendationBudget(afterConflict, policy.maxRecommendations * 2);
	const rankMs = Date.now() - tRank;

	const surfacePass = applySurfaceFilter({
		candidates: ranked,
		findings,
		bundleUnresolved: args.bundle.unresolved,
		maxRecommendations: policy.maxRecommendations,
	});

	const surfaced = surfacePass.surfaced;
	const status = deriveSetStatus(surfaced, surfacePass.questions.length);
	const summary = buildDeterministicSummary({
		status,
		recommendations: surfaced,
		questionCount: surfacePass.questions.length,
	});

	const executionReadiness = aggregateExecutionReadiness(surfaced);

	const recommendCount = surfaced.filter((r) => r.recommendationStatus === "RECOMMEND").length;
	const optionalCount = surfaced.filter((r) => r.recommendationStatus === "OPTIONAL").length;
	const blockedCount = ranked.filter((r) => r.recommendationStatus === "DO_NOT_RECOMMEND").length;
	const needsHumanCount = surfacePass.questions.length;

	const set: EditorialRecommendationSetV1 = {
		version: 1,
		providerId: LOCAL_EDITORIAL_ORCHESTRATION_V1_PROVIDER_ID,
		policyVersion: EDITORIAL_ORCHESTRATION_POLICY_VERSION,
		mediaFingerprint: args.bundle.mediaFingerprint,
		programmeFingerprint: args.bundle.programmeFingerprint,
		findings,
		recommendations: surfaced,
		preservedRanges,
		unresolvedQuestions: surfacePass.questions,
		surfaceDecisions: surfacePass.decisions,
		summary,
		status,
		metrics: {
			findingCount: findings.length,
			recommendationCount: surfaced.length,
			recommendCount,
			optionalCount,
			blockedCount,
			needsHumanCount,
			conflictEdges: edges.length,
			rawCandidates: surfacePass.metrics.rawCandidates,
			surfaceableRecommendations: surfacePass.metrics.surfaceableRecommendations,
			questionCount: surfacePass.metrics.questions,
			suppressedUnsupported: surfacePass.metrics.suppressedUnsupported,
			suppressedConflicts: surfacePass.metrics.suppressedConflicts,
			suppressedRedundant: surfacePass.metrics.suppressedRedundant,
			signalCollectionMs,
			findingMs,
			conflictMs,
			rankMs,
			surfaceMs: surfacePass.metrics.surfaceMs,
			totalMs: Date.now() - t0,
			additionalMediaDecodePasses: 0,
			additionalModelCalls: 0,
			autoMutations: 0,
			cacheHit: false,
		},
	};

	const result: OrchestrateResult = {
		set,
		rawRecommendations: ranked,
		executionReadiness,
		conflictEdges: edges,
		cacheKey,
	};

	if (!args.bypassCache) {
		writeOrchestrationCache(cacheKey, result);
	}
	return result;
}
