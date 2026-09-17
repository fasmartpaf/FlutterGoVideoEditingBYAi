/**
 * Grounding — collect candidate ranges before deep inspection.
 */

import type { ClaimPromotionSet } from "../../claimPromotion/types";
import type { VideoEvidenceStore } from "../../temporalEventLedger/store";
import { inferFocusRange } from "../plan";
import type { CandidateRange, InvestigationIntent } from "./types";

const END_HINT =
	/\b(near the end|at the end|ending|final (few )?(seconds?|moments?)|last\s+(few\s+)?(seconds?|moments?))\b/i;
const BEGIN_HINT =
	/\b(at the (start|beginning)|near the (start|beginning)|first\s+(few\s+)?seconds?)\b/i;

function clampRange(start: number, end: number, duration: number): { start: number; end: number } {
	const s = Math.max(0, Math.min(start, duration));
	const e = Math.max(s, Math.min(end, duration));
	return { start: s, end: e };
}

function pushCandidate(
	out: CandidateRange[],
	id: string,
	start: number,
	end: number,
	duration: number,
	sources: string[],
	reason: string,
): void {
	const r = clampRange(start, end, duration);
	if (r.end - r.start < 0.05 && duration > 0) {
		r.end = Math.min(duration, r.start + 0.5);
	}
	out.push({
		id,
		startSourceTimeSec: r.start,
		endSourceTimeSec: r.end,
		sources,
		score: 0,
		scoreBreakdown: {},
		reason,
	});
}

export function collectGroundingCandidates(input: {
	userMessage: string;
	store: VideoEvidenceStore;
	sourceDurationSec: number;
	intents: InvestigationIntent[];
	claimPromotion?: ClaimPromotionSet | null;
	maxCandidates: number;
}): CandidateRange[] {
	const dur = Math.max(0, input.sourceDurationSec);
	const out: CandidateRange[] = [];
	const focus = inferFocusRange(input.userMessage, dur);

	pushCandidate(
		out,
		"focus_hint",
		focus.startSourceTimeSec,
		focus.endSourceTimeSec,
		dur,
		["user_time_hint"],
		focus.questionSummary,
	);

	if (END_HINT.test(input.userMessage)) {
		const start = Math.max(0, dur - Math.min(8, Math.max(3, dur * 0.35)));
		pushCandidate(out, "late_window", start, dur, dur, ["end_hint"], "Late recording window");
	}
	if (BEGIN_HINT.test(input.userMessage)) {
		pushCandidate(
			out,
			"early_window",
			0,
			Math.min(dur, Math.max(4, dur * 0.25)),
			dur,
			["begin_hint"],
			"Early recording window",
		);
	}

	// Ledger-driven candidates
	for (const e of input.store.eventsByType("visual_transition")) {
		pushCandidate(
			out,
			`vt_${e.id}`,
			e.startSourceTimeSec,
			e.endSourceTimeSec,
			dur,
			["visual_transition"],
			e.summary.slice(0, 80),
		);
	}
	for (const e of input.store.eventsByType("observed_visual_diff")) {
		pushCandidate(
			out,
			`vd_${e.id}`,
			e.startSourceTimeSec,
			e.endSourceTimeSec,
			dur,
			["visual_diff"],
			e.summary.slice(0, 80),
		);
	}
	for (const e of [
		...input.store.eventsByType("observed_visible_text"),
		...input.store.eventsByType("observed_ui_state"),
	]) {
		pushCandidate(
			out,
			`txt_${e.id}`,
			e.startSourceTimeSec,
			e.endSourceTimeSec,
			dur,
			["visible_text"],
			e.summary.slice(0, 80),
		);
	}
	for (const e of input.store.eventsByType("passive_chrome")) {
		pushCandidate(
			out,
			`pc_${e.id}`,
			Math.max(0, e.startSourceTimeSec - 0.5),
			Math.min(dur, e.endSourceTimeSec + 0.5),
			dur,
			["passive_chrome"],
			e.summary.slice(0, 80),
		);
	}
	for (const e of [
		...input.store.eventsByType("spoken_correction"),
		...input.store.contradictionsInRange(0, dur),
	]) {
		pushCandidate(
			out,
			`sp_${e.id}`,
			Math.max(0, e.startSourceTimeSec - 0.5),
			Math.min(dur, e.endSourceTimeSec + 1),
			dur,
			["speech_or_contradiction"],
			e.summary.slice(0, 80),
		);
	}
	for (const e of input.store.eventsByType("cursor_interaction")) {
		pushCandidate(
			out,
			`cur_${e.id}`,
			Math.max(0, e.startSourceTimeSec - 0.3),
			Math.min(dur, e.endSourceTimeSec + 0.3),
			dur,
			["cursor"],
			e.summary.slice(0, 80),
		);
	}

	// Claim-promotion unresolved / contradiction candidates (lazy signal)
	if (input.claimPromotion) {
		for (const c of input.claimPromotion.claims) {
			const relevant =
				!c.lazyVerified ||
				c.status === "unknown" ||
				c.status === "contradicted" ||
				c.status === "inferred" ||
				(c.isActionClaim && c.status !== "verified");
			if (!relevant) continue;
			const q = input.userMessage.toLowerCase();
			const subj = (c.subject ?? "").toLowerCase();
			const textHit =
				!q.trim() ||
				(subj && q.includes(subj)) ||
				c.text
					.toLowerCase()
					.split(/\s+/)
					.some((t) => t.length > 3 && q.includes(t));
			if (
				!textHit &&
				c.isActionClaim &&
				!/\b(open|did i|work|settings|upwork|restart)\b/i.test(q)
			) {
				continue;
			}
			pushCandidate(
				out,
				`claim_${c.id}`,
				c.startSourceTimeSec,
				c.endSourceTimeSec,
				dur,
				["claim_promotion"],
				`Claim ${c.status}: ${c.text.slice(0, 60)}`,
			);
		}
	}

	// Whole-video hierarchy: coarse thirds instead of full brute force
	if (input.intents.includes("chronology") || input.intents.includes("whole_media_understanding")) {
		if (dur > 12) {
			const third = dur / 3;
			pushCandidate(out, "coarse_0", 0, third, dur, ["hierarchy_coarse"], "Coarse first third");
			pushCandidate(
				out,
				"coarse_1",
				third,
				2 * third,
				dur,
				["hierarchy_coarse"],
				"Coarse middle third",
			);
			pushCandidate(
				out,
				"coarse_2",
				2 * third,
				dur,
				dur,
				["hierarchy_coarse"],
				"Coarse final third",
			);
		}
	}

	// Dedupe overlapping identical windows (keep first)
	const seen = new Set<string>();
	const deduped: CandidateRange[] = [];
	for (const c of out) {
		const key = `${c.startSourceTimeSec.toFixed(1)}-${c.endSourceTimeSec.toFixed(1)}-${c.sources[0]}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(c);
		if (deduped.length >= input.maxCandidates * 3) break;
	}
	return deduped;
}
