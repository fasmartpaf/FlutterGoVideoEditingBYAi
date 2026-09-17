/**
 * Deterministic candidate range ranking — no GT, no LLM.
 */

import type { ClaimPromotionSet } from "../../claimPromotion/types";
import type { VideoEvidenceStore } from "../../temporalEventLedger/store";
import type { CandidateRange, InvestigationIntent } from "./types";

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
	return a1 >= b0 && a0 <= b1;
}

export function scoreCandidateRange(
	c: CandidateRange,
	input: {
		userMessage: string;
		intents: InvestigationIntent[];
		store: VideoEvidenceStore;
		claimPromotion?: ClaimPromotionSet | null;
	},
): CandidateRange {
	const breakdown: Record<string, number> = {};
	const q = input.userMessage.toLowerCase();

	if (
		c.sources.includes("user_time_hint") ||
		c.sources.includes("end_hint") ||
		c.sources.includes("begin_hint")
	) {
		breakdown.time_hint = 4;
	}
	if (c.sources.includes("visual_transition") || c.sources.includes("visual_diff")) {
		breakdown.visual_change = 3;
	}
	if (c.sources.includes("visible_text")) {
		breakdown.visible_text =
			input.intents.includes("text_ui_reading") || input.intents.includes("temporary_ui")
				? 3.5
				: 1.5;
	}
	if (c.sources.includes("passive_chrome")) {
		breakdown.passive = input.intents.includes("action_verification") ? 3 : 1;
	}
	if (c.sources.includes("speech_or_contradiction")) {
		breakdown.speech =
			input.intents.includes("speech_content") ||
			input.intents.includes("spoken_correction") ||
			input.intents.includes("contradiction_check")
				? 4
				: 1.5;
	}
	if (c.sources.includes("cursor")) {
		breakdown.cursor =
			input.intents.includes("cursor_interaction") || input.intents.includes("action_verification")
				? 3
				: 0.5;
	}
	if (c.sources.includes("claim_promotion")) {
		breakdown.claim = 3.5;
	}
	if (c.sources.includes("hierarchy_coarse")) {
		breakdown.hierarchy =
			input.intents.includes("chronology") || input.intents.includes("whole_media_understanding")
				? 1.2
				: 0.2;
	}

	// Temporary UI / late popup boost for late windows
	if (
		(input.intents.includes("temporary_ui") || /\b(popup|tooltip|brief|near the end)\b/i.test(q)) &&
		(c.sources.includes("end_hint") || c.id === "late_window" || c.sources.includes("visual_diff"))
	) {
		breakdown.temporary_ui = 4;
	}

	// Unresolved claims overlapping this range
	if (input.claimPromotion) {
		for (const claim of input.claimPromotion.claims) {
			if (
				!overlaps(
					c.startSourceTimeSec,
					c.endSourceTimeSec,
					claim.startSourceTimeSec,
					claim.endSourceTimeSec,
				)
			) {
				continue;
			}
			if (claim.status === "contradicted")
				breakdown.claim_contradiction = (breakdown.claim_contradiction ?? 0) + 2;
			if (claim.isActionClaim && claim.status !== "verified") {
				breakdown.unresolved_action = (breakdown.unresolved_action ?? 0) + 2;
			}
			if (!claim.isActionClaim && claim.verificationLevel === "single_source") {
				breakdown.single_source = (breakdown.single_source ?? 0) + 1;
			}
		}
	}

	// Ledger contradictions / unknowns in range
	const unknowns = input.store.unknownClaimsInRange(c.startSourceTimeSec, c.endSourceTimeSec);
	const contras = input.store.contradictionsInRange(c.startSourceTimeSec, c.endSourceTimeSec);
	if (unknowns.length) breakdown.ledger_unknown = Math.min(3, unknowns.length);
	if (contras.length) breakdown.ledger_contra = Math.min(3, contras.length * 1.5);

	// Subject keyword overlap with query tokens
	const reasonL = c.reason.toLowerCase();
	for (const tok of q.split(/\s+/)) {
		if (tok.length > 3 && reasonL.includes(tok)) {
			breakdown.query_token = (breakdown.query_token ?? 0) + 0.8;
		}
	}

	// Penalize near-full-duration windows (avoid brute-force whole-video inspect)
	const span = c.endSourceTimeSec - c.startSourceTimeSec;
	const durGuess = Math.max(
		c.endSourceTimeSec,
		...input.store.eventsByType("visual_transition").map((e) => e.endSourceTimeSec),
		1,
	);
	// Prefer using ledger meta duration via end of focus candidates
	if (span > 20 && c.sources.includes("user_time_hint")) {
		breakdown.full_span_penalty = -5;
	}
	if (span > 40) {
		breakdown.full_span_penalty = (breakdown.full_span_penalty ?? 0) - 4;
	}
	void durGuess;

	const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
	return { ...c, score, scoreBreakdown: breakdown };
}

export function rankCandidateRanges(
	candidates: CandidateRange[],
	input: {
		userMessage: string;
		intents: InvestigationIntent[];
		store: VideoEvidenceStore;
		claimPromotion?: ClaimPromotionSet | null;
		maxRanked: number;
	},
): CandidateRange[] {
	const scored = candidates.map((c) => scoreCandidateRange(c, input));
	scored.sort((a, b) => b.score - a.score || a.startSourceTimeSec - b.startSourceTimeSec);
	return scored.slice(0, input.maxRanked);
}
