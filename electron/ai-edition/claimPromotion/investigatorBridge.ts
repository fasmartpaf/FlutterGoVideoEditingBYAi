/**
 * Minimal Investigator ↔ Claim Promotion query surface.
 * Does not create a new top-level agent.
 */

import type { ClaimPromotionSet, PromotedClaim } from "../claimPromotion/types";
import {
	queryClaimEvidence,
	queryClaimsInRange,
	queryContradictedClaims,
	queryUnresolvedClaims,
	selectClaimsForLazyVerification,
	suggestPromotionEvidence,
} from "./lazy";

export interface InvestigatorClaimQueries {
	claimsInRange: (startSourceTimeSec: number, endSourceTimeSec: number) => PromotedClaim[];
	unresolvedClaims: () => PromotedClaim[];
	contradictedClaims: () => PromotedClaim[];
	evidenceForClaim: (claimId: string) => PromotedClaim | null;
	promotionHints: (claimId: string) => string[];
	lazyRelevant: (userQuery: string) => { evaluate: PromotedClaim[]; skip: PromotedClaim[] };
}

export function createInvestigatorClaimQueries(set: ClaimPromotionSet): InvestigatorClaimQueries {
	return {
		claimsInRange: (start, end) => queryClaimsInRange(set, start, end),
		unresolvedClaims: () => queryUnresolvedClaims(set),
		contradictedClaims: () => queryContradictedClaims(set),
		evidenceForClaim: (id) => queryClaimEvidence(set, id),
		promotionHints: (id) => {
			const c = queryClaimEvidence(set, id);
			return c ? suggestPromotionEvidence(c) : [];
		},
		lazyRelevant: (q) => selectClaimsForLazyVerification(set, q),
	};
}
