/**
 * Deterministic investigation planning — no LLM, no GT.
 */

import type { MediaContextNeeds } from "../mediaContextNeeds";
import type { VideoEvidenceStore } from "../temporalEventLedger/store";
import type { TemporalEvent } from "../temporalEventLedger/types";
import type { RoiPreset as RoiPresetType } from "./tools";

export type PlannedAction =
	| {
			tool: "get_events_in_range";
			startSourceSec: number;
			endSourceSec: number;
			why: string;
	  }
	| {
			tool: "get_transcript_range";
			startSourceSec: number;
			endSourceSec: number;
			why: string;
	  }
	| {
			tool: "get_cursor_events";
			startSourceSec: number;
			endSourceSec: number;
			why: string;
	  }
	| {
			tool: "inspect_frame";
			sourceTimeSec: number;
			why: string;
	  }
	| {
			tool: "inspect_video_range";
			startSourceSec: number;
			endSourceSec: number;
			detailLevel: "coarse" | "normal";
			why: string;
	  }
	| {
			tool: "compare_visual_states";
			t1: number;
			t2: number;
			why: string;
	  }
	| {
			tool: "get_evidence_for_event";
			eventId: string;
			why: string;
	  }
	| {
			tool: "inspect_region";
			sourceTimeSec: number;
			preset: RoiPresetType;
			why: string;
	  };

const END_HINT =
	/\b(near the end|at the end|ending|final (few )?(seconds?|moments?)|last\s+(few\s+)?(seconds?|moments?)|wrap(?:ping)? up|closing)\b/i;
const BEGIN_HINT =
	/\b(at the (start|beginning)|near the (start|beginning)|first\s+(few\s+)?seconds?|opening moments?)\b/i;

export function shouldRunInvestigator(needs: MediaContextNeeds): boolean {
	if (needs.category === "deterministicEdit") return false;
	return (
		needs.category === "mediaUnderstanding" ||
		needs.category === "editingContext" ||
		needs.category === "visualInspection" ||
		needs.category === "speechInspection"
	);
}

export function inferFocusRange(
	userMessage: string,
	sourceDurationSec: number,
): { startSourceTimeSec: number; endSourceTimeSec: number; questionSummary: string } {
	const dur = Math.max(0, sourceDurationSec);
	if (END_HINT.test(userMessage) && dur > 0) {
		const start = Math.max(0, dur - Math.min(8, Math.max(3, dur * 0.35)));
		return {
			startSourceTimeSec: start,
			endSourceTimeSec: dur,
			questionSummary: "Focus near the end of the recording",
		};
	}
	if (BEGIN_HINT.test(userMessage) && dur > 0) {
		return {
			startSourceTimeSec: 0,
			endSourceTimeSec: Math.min(dur, Math.max(4, dur * 0.25)),
			questionSummary: "Focus near the beginning of the recording",
		};
	}
	return {
		startSourceTimeSec: 0,
		endSourceTimeSec: dur,
		questionSummary: "Whole-recording understanding / evidence check",
	};
}

function lateWindow(durationSec: number): { start: number; end: number } {
	const end = durationSec;
	const start = Math.max(0, durationSec - Math.min(6, Math.max(2.5, durationSec * 0.3)));
	return { start, end };
}

/**
 * Build a bounded action list from ledger uncertainty + question focus.
 * Never encodes benchmark ground truth (no "Restart", no fixed 18s case ids).
 */
export function planInvestigation(input: {
	userMessage: string;
	store: VideoEvidenceStore;
	sourceDurationSec: number;
	needs: MediaContextNeeds;
}): { focus: ReturnType<typeof inferFocusRange>; actions: PlannedAction[] } {
	const focus = inferFocusRange(input.userMessage, input.sourceDurationSec);
	const actions: PlannedAction[] = [];
	const push = (a: PlannedAction) => {
		if (actions.length >= 12) return;
		actions.push(a);
	};

	push({
		tool: "get_events_in_range",
		startSourceSec: focus.startSourceTimeSec,
		endSourceSec: focus.endSourceTimeSec,
		why: "Query existing Temporal Event Ledger memory first",
	});

	if (input.needs.speech) {
		push({
			tool: "get_transcript_range",
			startSourceSec: focus.startSourceTimeSec,
			endSourceSec: focus.endSourceTimeSec,
			why: "Retrieve speech evidence in focus range",
		});
	}
	if (input.needs.cursor) {
		push({
			tool: "get_cursor_events",
			startSourceSec: focus.startSourceTimeSec,
			endSourceSec: focus.endSourceTimeSec,
			why: "Retrieve non-move cursor evidence in focus range",
		});
	}

	const unknowns = input.store.unknownClaimsInRange(
		focus.startSourceTimeSec,
		focus.endSourceTimeSec,
	);
	const contradictions = input.store.contradictionsInRange(
		focus.startSourceTimeSec,
		focus.endSourceTimeSec,
	);
	const uncertain = input.store
		.eventsInRange(focus.startSourceTimeSec, focus.endSourceTimeSec)
		.filter((e) => e.type === "uncertain" || e.temporallyUncertain);

	for (const e of [...contradictions, ...unknowns].slice(0, 3)) {
		push({
			tool: "get_evidence_for_event",
			eventId: e.id,
			why: `Resolve provenance for ${e.type} / uncertain claim`,
		});
	}

	const transitions = input.store
		.eventsByType("visual_transition")
		.filter(
			(e) =>
				e.endSourceTimeSec >= focus.startSourceTimeSec &&
				e.startSourceTimeSec <= focus.endSourceTimeSec,
		);

	for (const tr of transitions.slice(0, 2)) {
		push({
			tool: "compare_visual_states",
			t1: tr.startSourceTimeSec,
			t2: tr.endSourceTimeSec,
			why: "Re-measure pixel difference for uncertain transition (not a semantic label)",
		});
		push({
			tool: "inspect_video_range",
			startSourceSec: tr.startSourceTimeSec,
			endSourceSec: tr.endSourceTimeSec,
			detailLevel: "normal",
			why: "Bounded samples inside transition interval",
		});
	}

	// Late-recording peripheral UI often sits in chrome/HUD — inspect when the
	// focus includes the end OR when a late transition/uncertain visual exists.
	const late = lateWindow(input.sourceDurationSec);
	const focusTouchesLate = focus.endSourceTimeSec >= late.start;
	const lateTransition = transitions.some((e) => e.endSourceTimeSec >= late.start);
	const lateUncertainVisual = uncertain.some(
		(e) =>
			(e.type === "visual_transition" || e.type === "visual_sample" || e.temporallyUncertain) &&
			e.endSourceTimeSec >= late.start,
	);

	if (input.needs.visual && (focusTouchesLate || lateTransition || lateUncertainVisual)) {
		push({
			tool: "inspect_video_range",
			startSourceSec: late.start,
			endSourceSec: late.end,
			detailLevel: "normal",
			why: "Late-window temporal inspection for residual visual uncertainty",
		});
		const roiTime = late.end > 0 ? Math.max(late.start, late.end - 0.5) : late.start;
		push({
			tool: "inspect_region",
			sourceTimeSec: roiTime,
			preset: "bottom_center" as RoiPresetType,
			why: "Peripheral/HUD-region crop when late visual state may be under-resolved",
		});
		push({
			tool: "inspect_region",
			sourceTimeSec: roiTime,
			preset: "top_chrome" as RoiPresetType,
			why: "Browser/app chrome crop for passive tab vs active surface checks",
		});
	}

	// Passive chrome: provenance only — never plan an "open app" confirmation tool.
	const passive = input.store.eventsByType("passive_chrome");
	for (const e of passive.slice(0, 2)) {
		push({
			tool: "get_evidence_for_event",
			eventId: e.id,
			why: "Passive chrome observation — keep as visibility, not action",
		});
	}

	return { focus, actions };
}

export function summarizeLedgerGaps(
	store: VideoEvidenceStore,
	start: number,
	end: number,
): {
	unknownCount: number;
	contradictionCount: number;
	passiveChrome: TemporalEvent[];
	spokenCorrections: TemporalEvent[];
} {
	return {
		unknownCount: store.unknownClaimsInRange(start, end).length,
		contradictionCount: store.contradictionsInRange(start, end).length,
		passiveChrome: store.eventsByType("passive_chrome"),
		spokenCorrections: store.eventsByType("spoken_correction"),
	};
}

// silence unused import lint if RoiPreset only used as type via tools
