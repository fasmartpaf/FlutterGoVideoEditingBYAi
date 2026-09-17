/**
 * Deterministic beat importance — not every OCR word or frame sample.
 */

import type { SourceStoryEvidenceInput } from "./types";

export interface ImportanceSignal {
	score: number;
	reasons: string[];
}

export function scoreRangeImportance(
	start: number,
	end: number,
	input: SourceStoryEvidenceInput,
): ImportanceSignal {
	const reasons: string[] = [];
	let score = 0;
	const mid = (start + end) / 2;
	const overlaps = (a: number, b: number) => b >= start - 0.05 && a <= end + 0.05;

	for (const c of input.visualChanges) {
		if (!overlaps(c.fromSourceTimeSec, c.toSourceTimeSec)) continue;
		if (c.classification === "significant") {
			score += 4;
			reasons.push("significant_visual_transition");
		} else if (c.classification === "moderate") {
			score += 2.5;
			reasons.push("moderate_visual_transition");
		}
	}

	for (const s of input.speechSegments) {
		if (!overlaps(s.startSourceTimeSec, s.endSourceTimeSec)) continue;
		score += 2;
		reasons.push("speech_content");
		if (/\b(i mean|meant|correction|actually|instead)\b/i.test(s.text)) {
			score += 3;
			reasons.push("spoken_correction");
		}
		if (/\b(open|opening|settings|effects|timeline)\b/i.test(s.text)) {
			score += 1.5;
			reasons.push("spoken_topic");
		}
	}

	for (const c of input.contradictions) {
		if (!overlaps(c.startSourceTimeSec, c.endSourceTimeSec)) continue;
		score += 4;
		reasons.push("contradiction");
	}

	for (const c of input.promotedClaims) {
		if (!overlaps(c.startSourceTimeSec, c.endSourceTimeSec)) continue;
		if (c.kind === "temporary_ui_visibility") {
			score += 3.5;
			reasons.push("temporary_ui");
		} else if (c.kind === "spoken_correction") {
			score += 3;
			reasons.push("correction_claim");
		} else if (!c.isActionClaim && (c.status === "supported" || c.status === "observed")) {
			score += 1.5;
			reasons.push("promoted_observation");
		}
	}

	for (const c of input.unresolvedClaims) {
		if (!c.isActionClaim) continue;
		if (!overlaps(c.startSourceTimeSec, c.endSourceTimeSec)) continue;
		score += 2;
		reasons.push("unresolved_action");
	}

	for (const e of input.ledgerEvents) {
		if (!overlaps(e.startSourceTimeSec, e.endSourceTimeSec)) continue;
		if (e.type === "passive_chrome") {
			score += 1.2;
			reasons.push("passive_context");
		}
		if (e.type === "visual_transition" || e.type === "observed_visual_diff") {
			score += 2;
			reasons.push("ledger_visual_change");
		}
	}

	for (const t of input.cursorEventTimes) {
		if (t >= start - 0.2 && t <= end + 0.2) {
			score += 1;
			reasons.push("cursor_activity");
			break;
		}
	}

	// Beginning / ending anchors
	const dur = input.sourceDurationSec;
	if (start <= 0.5) {
		score += 1;
		reasons.push("initial_state");
	}
	if (end >= dur - 1.5 || mid >= dur * 0.85) {
		score += 1.2;
		reasons.push("ending_window");
	}

	return { score, reasons: [...new Set(reasons)] };
}

/** Minimum score for a standalone beat (periodic frame alone fails). */
export const MIN_BEAT_IMPORTANCE = 2.0;
