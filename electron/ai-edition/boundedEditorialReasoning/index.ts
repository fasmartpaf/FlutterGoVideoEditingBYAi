/**
 * Bounded Editorial Reasoning Over Temporal Context V1 — public API.
 */

export {
	createDeterministicEditorialReasoningProvider,
	resetDeterministicReasoningSeqForTests,
} from "./deterministicProvider";
export { normalizeEditorialGoal } from "./goals";

export { CORE_EDITORIAL_INVARIANTS, INVARIANT_CHAR_COUNT } from "./invariants";
export {
	createLocalChatEditorialReasoningProvider,
	type LocalChatProviderConfig,
	probeLocalChatEndpoint,
} from "./localChatProvider";
export {
	type RunBoundedEditorialReasoningArgs,
	type RunBoundedEditorialReasoningResult,
	reasonedQuestionsOnly,
	reasonedRecommendationsOnly,
	runBoundedEditorialReasoning,
} from "./pipeline";
export { reconcileReasonedRecommendations } from "./reconcile";
export type {
	DecisionAction,
	EditorialDecisionV1,
	EditorialGoalKind,
	EditorialReasoningProviderCapabilities,
	EditorialReasoningProviderV1,
	EditorialReasoningRequestV1,
	EditorialReasoningResponseV1,
	ReasonedEditorialRecommendationSetV1,
	ReasoningProviderKind,
	ValidationResult,
} from "./types";
export {
	BOUNDED_EDITORIAL_REASONING_V1_PROVIDER_ID,
	EDITORIAL_REASONING_POLICY_VERSION,
} from "./types";
export { validateEditorialReasoningResponseV1 } from "./validate";
