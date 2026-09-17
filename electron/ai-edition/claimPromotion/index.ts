export { buildSourceStoryClaimBridge } from "./bridge";
export { claimIdentityKey, normalizeSubject } from "./identity";
export type { InvestigatorClaimQueries } from "./investigatorBridge";
export { createInvestigatorClaimQueries } from "./investigatorBridge";
export {
	claimRelevantToQuery,
	queryClaimEvidence,
	queryClaimsInRange,
	queryContradictedClaims,
	queryUnresolvedClaims,
	selectClaimsForLazyVerification,
	suggestPromotionEvidence,
} from "./lazy";
export { buildClaimPromotionSet, resetClaimPromotionSeqForTests } from "./promote";
export {
	decideKeywordCoincidenceAction,
	decidePassiveVisibility,
	decideSpeechAssertion,
	decideVisibleText,
	initialStatusForKind,
	looksLikeActionHypothesis,
} from "./rules";
export type {
	ClaimHistoryEntry,
	ClaimKind,
	ClaimPromotionMetrics,
	ClaimPromotionSet,
	ClaimPromotionStatus,
	ClaimProvenanceLink,
	ClaimVerificationLevel,
	PromotedClaim,
	SourceStoryClaimBridge,
} from "./types";
export {
	CLAIM_PROMOTION_PROVIDER_ID,
	CLAIM_PROMOTION_STATUSES,
	CLAIM_VERIFICATION_LEVELS,
} from "./types";
