/**
 * Bounded Reasoning Packet + Phase Tools
 * (+ Reliability V2 + Quality Closure V3 + Decision Requirements V4)
 * Identity: CURRENT_OPENSCREEN_BOUNDED_REASONING_V1
 *
 * Experimental provider-facing path. Default packing remains CURRENT_FULL_CONTEXT.
 */

export { BOUNDED_REASONING_V1_ID } from "../videoMemory/productionPath";
export { buildReasoningPacketV1 } from "./buildPacket";
export { buildCorrectionScaffold, type CorrectionScaffold } from "./correctionScaffold";
export {
	buildCrossModalRelations,
	type CrossModalEvidenceRelation,
} from "./crossModal";
export {
	type DecisionRequirementContract,
	type DecisionSection,
	decisionRequirementContract,
	REASONING_DECISION_KINDS,
	type ReasoningDecisionKind,
	resolveDecisionRequirements,
	resolveReasoningDecisionKind,
} from "./decisionRequirements";
export {
	type EditorialDecision,
	parseEditorialDecisions,
	validateEditorialDecisions,
} from "./editorialDecisions";
export {
	auditEditorialFindings,
	buildEditorialFindings,
	type EditorialFinding,
	type EditorialFindingCoverage,
	type FindingDisposition,
	groupFindingsForSerialize,
	synthesizeEditorialFindings,
} from "./editorialFindings";
export { type FastPathDecision, resolveDeterministicFastPath } from "./fastPath";
export {
	type FocalTargetDecision,
	parseFocalTargetDecisions,
	validateFocalTargetDecisions,
} from "./focalDecisions";
export {
	buildFocalTargetCandidates,
	type FocalTargetCandidate,
	wantsFocalTargets,
} from "./focalTargets";
export { selectBoundedHistoryConstraints } from "./historyPolicy";
export type { AppendPacketResult } from "./packetDelivery";
export {
	COGNITION_PHASES,
	type CognitionPhase,
	phaseAllowsMutationTools,
	resolveCognitionPhase,
} from "./phase";
export { buildBoundedProjectProjection } from "./projectProjection";
export {
	applyRequiredModalitiesToNeeds,
	type RequiredModalities,
	resolveRequiredModalities,
} from "./requiredModalities";
export { evaluatePacketSelfContainment, type SelfContainmentReport } from "./selfContainment";
export {
	appendReasoningPacketToUserMessage,
	assertReasoningPacketDelivered,
	extractProviderBoundUserText,
	REASONING_PACKET_MARKER,
	serializeReasoningPacket,
} from "./serialize";
export {
	evaluatePacketSufficiency,
	type ModalitySufficiencyReport,
	type SpeechMediaState,
} from "./sufficiency";
export { buildBoundedSystemPrompt, CORE_INVARIANTS, phasePolicy } from "./systemPolicy";
export { assertPhaseMutationInvariant, toolGateForPhase } from "./toolFamilies";
export {
	resolveToolNeedPolicy,
	type ToolNeedPolicy,
	toolGateFromPolicy,
} from "./toolPolicy";
export type {
	BoundedProjectProjection,
	PacketSufficiency,
	ReasoningPacketSerializeResult,
	ReasoningPacketV1,
} from "./types";
export {
	applyBoundedResponseValidators,
	validateCrossModalResponse,
	validateEditorialSpecificity,
	validateFocalTargetResponse,
} from "./validators";
