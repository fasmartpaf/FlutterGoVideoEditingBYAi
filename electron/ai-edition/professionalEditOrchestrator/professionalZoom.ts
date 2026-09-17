/**
 * Professional zoom intent — enter → hold → exit lifecycle.
 * Compositor already eases zoom in/out; we ensure the range is long enough
 * for a readable hold and record the editorial intent on the plan step.
 */

import {
	TRANSITION_WINDOW_MS,
	ZOOM_IN_TRANSITION_WINDOW_MS,
} from "../../../src/lib/zoomMath/constants";

export interface ProfessionalZoomIntentV1 {
	version: 1;
	sourceStartSec: number;
	sourceEndSec: number;
	focusRegion: { cx: number; cy: number };
	importance: "HIGH" | "MEDIUM";
	enterDurationSec: number;
	holdDurationSec: number;
	exitDurationSec: number;
	scale: number;
	depth: number;
	evidenceRefs: string[];
	storyBeatId: string | null;
}

const DEFAULT_ENTER_SEC = ZOOM_IN_TRANSITION_WINDOW_MS / 1000;
const DEFAULT_EXIT_SEC = TRANSITION_WINDOW_MS / 1000;
const MIN_HOLD_SEC = 1.15;

/** Expand a grounded focal span so enter+hold+exit can play professionally. */
export function expandZoomRangeForLifecycle(args: {
	sourceStartSec: number;
	sourceEndSec: number;
	assetDurationSec: number;
	enterDurationSec?: number;
	exitDurationSec?: number;
	minHoldSec?: number;
}): {
	startSec: number;
	endSec: number;
	enterDurationSec: number;
	holdDurationSec: number;
	exitDurationSec: number;
} {
	const enter = args.enterDurationSec ?? DEFAULT_ENTER_SEC;
	const exit = args.exitDurationSec ?? DEFAULT_EXIT_SEC;
	const minHold = args.minHoldSec ?? MIN_HOLD_SEC;
	const needed = enter + minHold + exit;
	let start = Math.max(0, args.sourceStartSec);
	let end = Math.min(args.assetDurationSec, args.sourceEndSec);
	if (!(end > start)) {
		start = Math.max(0, Math.min(args.sourceStartSec, args.assetDurationSec - needed));
		end = Math.min(args.assetDurationSec, start + needed);
	}
	const span = end - start;
	if (span < needed) {
		const deficit = needed - span;
		const padBefore = Math.min(start, deficit / 2);
		const padAfter = Math.min(args.assetDurationSec - end, deficit - padBefore);
		start = Math.max(0, start - padBefore);
		end = Math.min(args.assetDurationSec, end + padAfter);
		if (end - start < needed) {
			end = Math.min(args.assetDurationSec, start + needed);
			start = Math.max(0, end - needed);
		}
	}
	const hold = Math.max(0.2, end - start - enter - exit);
	return {
		startSec: start,
		endSec: end,
		enterDurationSec: enter,
		holdDurationSec: hold,
		exitDurationSec: exit,
	};
}

export function buildProfessionalZoomIntent(args: {
	sourceStartSec: number;
	sourceEndSec: number;
	assetDurationSec: number;
	focus: { cx: number; cy: number };
	depth: number;
	scale: number;
	evidenceRefs: string[];
	storyBeatId?: string | null;
	importance?: "HIGH" | "MEDIUM";
}): ProfessionalZoomIntentV1 {
	const life = expandZoomRangeForLifecycle({
		sourceStartSec: args.sourceStartSec,
		sourceEndSec: args.sourceEndSec,
		assetDurationSec: args.assetDurationSec,
	});
	return {
		version: 1,
		sourceStartSec: life.startSec,
		sourceEndSec: life.endSec,
		focusRegion: { ...args.focus },
		importance: args.importance ?? "MEDIUM",
		enterDurationSec: life.enterDurationSec,
		holdDurationSec: life.holdDurationSec,
		exitDurationSec: life.exitDurationSec,
		scale: args.scale,
		depth: args.depth,
		evidenceRefs: args.evidenceRefs,
		storyBeatId: args.storyBeatId ?? null,
	};
}
