/**
 * Planning → Investigation Closure V1
 * Does NOT execute edits. Does NOT mutate AxcutDocument.
 */

export { leaksExecution } from "./guards";
export {
	analyzePlanRedundancy,
	classifyItemOutcomes,
	isMaterialPlanChange,
	planSignature,
} from "./material";
export {
	planMayNeedClosure,
	preparePlanningClosureForTurn,
	wantsPlanningClosure,
} from "./prepare";
export { recomputeCognitionChain } from "./recompute";
export { generateEvidenceRequests, requestIdentityKey } from "./requests";
export { runPlanningClosureV1 } from "./runClosure";
export type {
	PlanningClosureBudgets,
	PlanningClosureEvidenceContext,
	PlanningClosureInput,
	PlanningClosureResult,
	PlanningClosureRound,
	PlanningClosureStopReason,
	PlanningEvidenceModality,
	PlanningEvidencePriority,
	PlanningEvidenceQuestion,
	PlanningEvidenceRequest,
	PlanVersionSnapshot,
} from "./types";
export {
	DEFAULT_CLOSURE_BUDGETS,
	itemNeedsEvidence,
	PLANNING_CLOSURE_V1_PROVIDER_ID,
	PLANNING_EVIDENCE_QUESTIONS,
} from "./types";
