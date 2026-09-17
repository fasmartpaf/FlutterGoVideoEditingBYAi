export type { ClaimPromotionSet, InvestigatorClaimQueries, PromotedClaim } from "../claimPromotion";
/** Claim-promotion query helpers (Reuse Milestone 2) — additive surface. */
export {
	createInvestigatorClaimQueries,
	queryClaimEvidence,
	queryClaimsInRange,
	queryContradictedClaims,
	queryUnresolvedClaims,
	selectClaimsForLazyVerification,
	suggestPromotionEvidence,
} from "../claimPromotion";
export { appendInvestigatorToUserMessage } from "./attachBriefing";
export {
	buildInvestigatorInternalBriefing,
	truncateBriefing,
	userFacingLeaksInvestigatorInternals,
} from "./briefing";
export {
	inferFocusRange,
	planInvestigation,
	summarizeLedgerGaps,
} from "./plan";
export type {
	InvestigationIntent,
	InvestigatorRole,
	RolePolicyPlan,
	RolePolicyTrace,
} from "./rolePolicy";
export {
	classifyInvestigationIntents,
	INVESTIGATOR_V1_1_PROVIDER_ID,
	planInvestigationV11,
	rankCandidateRanges,
} from "./rolePolicy";
export {
	type RunInvestigatorInput,
	runMasterVideoInvestigatorV1,
	runMasterVideoInvestigatorV1_1,
	shouldRunInvestigator,
} from "./run";
export {
	toolCompareVisualStates,
	toolGetCursorEvents,
	toolGetEventsInRange,
	toolGetEvidenceForEvent,
	toolGetTranscriptRange,
	toolInspectFrame,
	toolInspectRegion,
	toolInspectVideoRange,
} from "./tools";
export type {
	InvestigationBudgets,
	InvestigationClaim,
	InvestigationClaimVerdict,
	InvestigationCoverage,
	InvestigationEvidenceSet,
	InvestigationMetrics,
	InvestigationObservation,
	InvestigationStopReason,
	InvestigationToolName,
	InvestigationToolTrace,
} from "./types";
export { DEFAULT_INVESTIGATION_BUDGETS } from "./types";
export { resetClaimSeqForTests, verifyInvestigationClaims } from "./verify";
