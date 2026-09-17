/**
 * Lazy verification — only deepen claims relevant to the user question.
 */

import type { ClaimPromotionSet, PromotedClaim } from "./types";

export function claimRelevantToQuery(claim: PromotedClaim, userQuery: string): boolean {
	const q = userQuery.toLowerCase().trim();
	if (!q) return true;
	const subject = (claim.subject ?? "").toLowerCase();
	const text = claim.text.toLowerCase();
	if (subject && q.includes(subject)) return true;
	if (subject && subject.split(/\s+/).some((tok) => tok.length > 3 && q.includes(tok))) {
		return true;
	}
	// Action verbs in query → deepen action claims
	if (
		claim.isActionClaim &&
		/\b(open|opened|navigate|work|worked|restart|click|did i|settings|upwork)\b/i.test(q)
	) {
		if (!subject) return true;
		return subject.split(/\s+/).some((tok) => tok.length > 2 && q.includes(tok));
	}
	// Transcript-only questions should not force UI claim deepening
	if (
		/\b(say|said|speak|speech|transcript|final\s+\d+\s+seconds?)\b/i.test(q) &&
		claim.isActionClaim
	) {
		return false;
	}
	return text.split(/\s+/).some((tok) => tok.length > 4 && q.includes(tok));
}

export function selectClaimsForLazyVerification(
	set: ClaimPromotionSet,
	userQuery: string,
): { evaluate: PromotedClaim[]; skip: PromotedClaim[] } {
	const evaluate: PromotedClaim[] = [];
	const skip: PromotedClaim[] = [];
	for (const c of set.claims) {
		if (claimRelevantToQuery(c, userQuery)) evaluate.push(c);
		else skip.push(c);
	}
	return { evaluate, skip };
}

export function queryClaimsInRange(
	set: ClaimPromotionSet,
	startSourceTimeSec: number,
	endSourceTimeSec: number,
): PromotedClaim[] {
	return set.claims.filter(
		(c) => c.endSourceTimeSec >= startSourceTimeSec && c.startSourceTimeSec <= endSourceTimeSec,
	);
}

export function queryUnresolvedClaims(set: ClaimPromotionSet): PromotedClaim[] {
	return set.claims.filter(
		(c) =>
			c.status === "unknown" ||
			c.status === "inferred" ||
			(c.isActionClaim && c.status !== "verified" && c.status !== "contradicted"),
	);
}

export function queryContradictedClaims(set: ClaimPromotionSet): PromotedClaim[] {
	return set.claims.filter((c) => c.status === "contradicted");
}

export function queryClaimEvidence(set: ClaimPromotionSet, claimId: string): PromotedClaim | null {
	return set.claims.find((c) => c.id === claimId) ?? null;
}

/** What additional evidence could promote/reject — advisory only, no perception. */
export function suggestPromotionEvidence(claim: PromotedClaim): string[] {
	if (!claim.isActionClaim) {
		return ["Additional OCR/ROI confirmation", "Before/after visual change in neighborhood"];
	}
	return [
		"Cursor interaction near control at claim time",
		"Verified target UI state after hypothesized action",
		"Cross-modal speech + visual state (not keyword alone)",
		"Do not promote from OCR label coincidence alone",
	];
}
