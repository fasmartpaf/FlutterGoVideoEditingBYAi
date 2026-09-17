/**
 * Bounded Editorial Reasoning V1 — contracts.
 * Reasoner over TemporalReasoningPacketV1. No mutation tools. No paid AI required.
 */

import type {
	EditorialRecommendationV1,
	ExecutionReadiness,
	OperationFamily,
	UnresolvedEditorialQuestionV1,
} from "../editorialOrchestration/types";
import type {
	ConfidenceClass,
	EvidenceCoverageV1,
	TemporalReasoningPacketV1,
} from "../temporalContextStore/types";

export const BOUNDED_EDITORIAL_REASONING_V1_PROVIDER_ID =
	"CURRENT_OPENSCREEN_BOUNDED_EDITORIAL_REASONING_OVER_TEMPORAL_CONTEXT_V1" as const;

export const EDITORIAL_REASONING_POLICY_VERSION = "v1" as const;

export type ReasoningProviderKind =
	| "DETERMINISTIC"
	| "LOCAL_MODEL"
	| "LOCAL_SERVER"
	| "REMOTE_SERVER"
	| "COMMERCIAL_PROVIDER";

export type EditorialGoalKind =
	| "MAKE_PROFESSIONAL"
	| "MAKE_TIGHTER"
	| "IMPROVE_CLARITY"
	| "IMPROVE_ACCESSIBILITY"
	| "CUSTOM_TEXT";

export type DecisionAction = "INCLUDE" | "EXCLUDE" | "OPTIONAL" | "ASK_USER" | "NO_ACTION";

export interface EditorialReasoningProviderCapabilities {
	structuredText: boolean;
	optionalImages: boolean;
	maxContextChars?: number;
	streamingOptional: boolean;
	schemaConstrainedOptional: boolean;
}

export interface EditorialDecisionV1 {
	id: string;
	recommendationId?: string;
	operationFamily?: OperationFamily | "NONE";
	decision: DecisionAction;
	rationale: string;
	evidenceRefs: string[];
	constraintRefs: string[];
	confidence: ConfidenceClass;
	requestedMissingInformation: string[];
	executionReadiness: ExecutionReadiness | "N/A";
}

export interface EditorialReasoningRequestV1 {
	requestId: string;
	goal: EditorialGoalKind;
	goalText?: string;
	packet: TemporalReasoningPacketV1;
	currentRecommendations: EditorialRecommendationV1[];
	unresolvedQuestions: UnresolvedEditorialQuestionV1[];
	constraints: string[];
	allowedDecisionFamilies: Array<OperationFamily | "NONE">;
	maxDecisions: number;
	reasoningPolicyVersion: typeof EDITORIAL_REASONING_POLICY_VERSION;
	/** Known Temporal Context record IDs eligible for evidence binding. */
	knownEvidenceIds: string[];
	coverage: EvidenceCoverageV1;
	followUp?: {
		selectedRecommendationId?: string;
		selectedRange?: { startSec: number; endSec: number };
		question?: string;
	};
}

export interface EditorialReasoningResponseV1 {
	requestId: string;
	decisions: EditorialDecisionV1[];
	questions: Array<{ id: string; text: string; evidenceRefs: string[] }>;
	preserve: Array<{ id: string; reason: string; evidenceRefs: string[] }>;
	summary: string;
	confidence: ConfidenceClass;
	evidenceRefs: string[];
	providerMetadata: {
		providerId: string;
		kind: ReasoningProviderKind;
		modelId?: string;
		latencyMs: number;
		inputChars: number;
		outputChars: number;
		fallbackUsed?: boolean;
		fallbackReason?: string;
	};
}

export interface EditorialReasoningProviderV1 {
	id: string;
	kind: ReasoningProviderKind;
	capabilities: EditorialReasoningProviderCapabilities;
	reason(request: EditorialReasoningRequestV1): Promise<EditorialReasoningResponseV1>;
}

export interface ReasonedEditorialRecommendationSetV1 {
	version: 1;
	providerId: typeof BOUNDED_EDITORIAL_REASONING_V1_PROVIDER_ID;
	goal: EditorialGoalKind;
	requestId: string;
	/** Surfaced recommendations after reasoner + deterministic safety. */
	recommendations: EditorialRecommendationV1[];
	decisions: EditorialDecisionV1[];
	unresolvedQuestions: UnresolvedEditorialQuestionV1[];
	preserve: Array<{ id: string; reason: string; evidenceRefs: string[] }>;
	summary: string;
	status: "ACTIONS_AVAILABLE" | "NO_ACTION_RECOMMENDED" | "NEEDS_HUMAN_JUDGMENT";
	validation: {
		accepted: boolean;
		rejectedDecisionIds: string[];
		reasons: string[];
	};
	metrics: {
		inputChars: number;
		outputChars: number;
		invariantChars: number;
		packetChars: number;
		requestChars: number;
		latencyMs: number;
		providerKind: ReasoningProviderKind;
		additionalModelCalls: number;
		paidAiCalls: 0;
		autoMutations: 0;
	};
}

export type ValidationResult = {
	ok: boolean;
	errors: string[];
	sanitized?: EditorialReasoningResponseV1;
};
