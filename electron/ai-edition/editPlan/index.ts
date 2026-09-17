/**
 * Edit Plan V1 — Edit Gap → editorial intentions / tool families.
 * Does NOT execute edits. Does NOT mutate AxcutDocument. Does NOT call tools.
 */

export { buildEditPlanV1, resetEditPlanSeqForTests } from "./buildPlan";
export {
	defaultEditCapabilityRegistry,
	familyCapabilityKey,
	isFamilySupported,
	mergeCapabilities,
} from "./capabilities";
export {
	assertsForbiddenRestartActionPlan,
	assertsForbiddenUnverifiedPanelZoom,
	assertsForbiddenUpworkPlan,
	leaksExecutableToolArgs,
	sanitizePlanProse,
} from "./guards";
export { prepareEditPlanForTurn, wantsEditPlan } from "./prepare";
export type {
	CandidateStrategy,
	EditCapabilityRegistry,
	EditPlanConflict,
	EditPlanFeasibility,
	EditPlanInput,
	EditPlanItem,
	EditPlanPriority,
	EditPlanQualityRubric,
	EditPlanRisk,
	EditPlanV1,
	EditStrategyFamily,
} from "./types";
export { EDIT_PLAN_V1_PROVIDER_ID } from "./types";
export { evaluateEditPlanRubric, validateAndSanitizeEditPlanV1 } from "./validate";
