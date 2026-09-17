/**
 * Local Editorial Orchestration + Precision Closure V1 — public API.
 * Assembles local evidence into a reviewable recommendation set.
 * Never auto-applies. TOTAL_PAID_AI_CALLS = 0.
 */

export {
	adaptCaptions,
	adaptDeadAir,
	adaptLoudness,
	adaptPreservation,
	adaptSpeedIntent,
	adaptVisual,
} from "./adapters";
export {
	buildOrchestrationCacheKey,
	buildOrchestrationCacheKeyParts,
	clearOrchestrationCacheForTests,
	fingerprintObject,
	type OrchestrationCacheKeyParts,
	readOrchestrationCache,
	writeOrchestrationCache,
} from "./cache";
export {
	buildPreservedRanges,
	type ConflictEdge,
	redundancyWinner,
	resolveConflictsAndRedundancy,
} from "./conflict";

export {
	type OrchestrateArgs,
	type OrchestrateResult,
	orchestrateFromSignals,
	resetOrchestrationSeqForTests,
	resetSurfaceSeqForTests,
} from "./orchestrate";
export {
	DEFAULT_EDITORIAL_ORCHESTRATION_POLICY,
	mergeOrchestrationPolicy,
	OPERATION_PRECEDENCE,
} from "./policy";
export {
	applyRecommendationBudget,
	buildDeterministicSummary,
	deriveSetStatus,
	recommendationPriority,
} from "./rank";
export {
	aggregateExecutionReadiness,
	type FamilyReadinessRow,
	PROPOSAL_BUILDER_ARG_GAPS,
} from "./readiness";

export {
	applySurfaceFilter,
	decideSurface,
	questionsFromActivityFindings,
	type SurfacePassResult,
} from "./surface";
export type {
	ConfidenceClass,
	EditorialFindingV1,
	EditorialOrchestrationPolicy,
	EditorialRecommendationSetV1,
	EditorialRecommendationV1,
	EditorialSignalBundle,
	EvidenceRef,
	ExecutionReadiness,
	FindingCategory,
	FindingSeverity,
	OperationFamily,
	PreservedRange,
	RecommendationStatus,
	RecommendationSurfaceDecisionV1,
	SurfaceEligibility,
	TimeRangeSec,
	UnresolvedEditorialQuestionV1,
	VerifiedApplyCapability,
} from "./types";
export {
	EDITORIAL_ORCHESTRATION_POLICY_VERSION,
	LOCAL_EDITORIAL_ORCHESTRATION_V1_PROVIDER_ID,
	LOCAL_EDITORIAL_PRECISION_CLOSURE_V1_PROVIDER_ID,
} from "./types";
