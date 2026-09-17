/**
 * Constrained Edit Proposal V1
 * Precise, evidence-backed proposals — NOT execution.
 */

export { buildEditProposalV1, resetEditProposalSeqForTests } from "./buildProposal";
export {
	assertsForbiddenRestartActionProposal,
	assertsForbiddenSettingsZoomProposal,
	assertsForbiddenUpworkProposal,
	isValidProposedCallShape,
	leaksExecution,
	sanitizeProposalProse,
} from "./guards";
export { prepareEditProposalForTurn, wantsEditProposal } from "./prepare";
export type {
	ContinuityRiskLevel,
	DamageKind,
	EditProposalInput,
	EditProposalItem,
	EditProposalQualityMetrics,
	EditProposalQualityRubric,
	EditProposalV1,
	ProposalDamageRisk,
	ProposalEvidenceRef,
	ProposalLanding,
	ProposalPriority,
	ProposalStatus,
	ProposalSurvivalRequirement,
	ProposedToolCallShape,
} from "./types";
export {
	EDIT_PROPOSAL_V1_PROVIDER_ID,
	isNonMutatingStrategy,
	planItemIsProposalCandidate,
} from "./types";
export { evaluateEditProposalRubric, validateAndSanitizeEditProposalV1 } from "./validate";
