/**
 * Lightweight claim verification over investigator observations + ledger.
 */

import {
	ledgerHasPassiveChromeObservation,
	ledgerHasVerifiedOpenAction,
} from "../temporalEventLedger/build";
import type { VideoEvidenceStore } from "../temporalEventLedger/store";
import type { InvestigationClaim, InvestigationObservation } from "./types";

let claimSeq = 0;
function nextId(): string {
	claimSeq += 1;
	return `ic_${claimSeq}`;
}

export function resetClaimSeqForTests(): void {
	claimSeq = 0;
}

/**
 * Derive important claims from known epistemic patterns.
 * Does not invent UI labels from pixel scores.
 */
export function verifyInvestigationClaims(input: {
	store: VideoEvidenceStore;
	observations: InvestigationObservation[];
	focusStart: number;
	focusEnd: number;
}): InvestigationClaim[] {
	const claims: InvestigationClaim[] = [];
	const ledger = input.store.ledger;

	// Passive chrome apps must not upgrade to verified open/work.
	for (const e of input.store.eventsByType("passive_chrome")) {
		const nameMatch = e.summary.match(/Passive chrome:\s*([^(]+)/i);
		const name = nameMatch?.[1]?.trim() ?? "app";
		const observed = ledgerHasPassiveChromeObservation(ledger, name);
		const verifiedOpen = ledgerHasVerifiedOpenAction(ledger, name);
		claims.push({
			id: nextId(),
			hypothesis: `User opened or worked in ${name}`,
			verdict: verifiedOpen ? "verified" : observed ? "not_verified" : "unknown",
			rationale: observed
				? `"${name}" appears as passive chrome visibility only. Visibility ≠ open/navigate/work action.`
				: `No passive or active evidence for ${name} in the ledger.`,
			evidence: e.evidence,
		});
	}

	// Spoken corrections / open-panel without visual support.
	for (const e of input.store.contradictionsInRange(input.focusStart, input.focusEnd)) {
		claims.push({
			id: nextId(),
			hypothesis: e.summary,
			verdict: "contradicted",
			rationale:
				"Speech asserts a UI open/action but material visual change does not support it in the inspected neighborhood. Speech remains speech evidence.",
			evidence: e.evidence,
		});
	}

	for (const e of input.store.eventsByType("spoken_correction")) {
		claims.push({
			id: nextId(),
			hypothesis: "Speaker corrected a prior spoken statement",
			verdict: "spoken",
			rationale: e.summary,
			evidence: e.evidence,
		});
	}

	// Pixel compares: supported change only — never a named UI event.
	for (const obs of input.observations) {
		if (obs.kind !== "visual_compare" || !obs.change) continue;
		claims.push({
			id: nextId(),
			hypothesis: `Material visual change between ${obs.change.fromSourceTimeSec.toFixed(2)}s and ${obs.change.toSourceTimeSec.toFixed(2)}s`,
			verdict: obs.change.classification === "minimal" ? "unknown" : "supported",
			rationale: `Deterministic pixel score=${obs.change.score.toFixed(3)} (${obs.change.classification}). Semantic cause remains unknown without recognition evidence.`,
			evidence: obs.evidence,
		});
	}

	// Coverage honesty
	const visualObs = input.observations.filter(
		(o) => o.kind === "frame" || o.kind === "range_frames" || o.kind === "roi",
	);
	if (visualObs.length === 0) {
		claims.push({
			id: nextId(),
			hypothesis: "All visually relevant events in focus were fully confirmed",
			verdict: "insufficient_evidence",
			rationale:
				"No additional visual inspection completed. Absence of observation is not proof of absence.",
			evidence: [],
		});
	}

	return claims;
}
