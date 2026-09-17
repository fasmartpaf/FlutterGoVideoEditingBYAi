/**
 * Shared relevance scoring for frame selection / event regions.
 */

import type { VisualEvidenceFrame } from "../visualEvidence/types";
import type { VideoMemoryQueryClass } from "./index";

export function relevanceScore(
	frame: VisualEvidenceFrame,
	opts: {
		preferChangeBoundaries: boolean;
		preferLateWindow: boolean;
		lateStart: number;
		priorityTimesSec: number[];
		queryClass: VideoMemoryQueryClass;
	},
): number {
	let s = 0;
	if (opts.preferChangeBoundaries) {
		if (frame.reason === "change_refinement") s += 30;
		if (frame.reason === "clip_boundary") s += 20;
		if (frame.reason.startsWith("cursor_interaction")) s += 15;
	}
	if (opts.preferLateWindow && frame.sourceTimeSec >= opts.lateStart) s += 10;
	for (const p of opts.priorityTimesSec) {
		if (Math.abs(frame.sourceTimeSec - p) <= 1.0) s += 40;
	}
	if (opts.queryClass === "editorial" && frame.reason === "periodic") s += 5;
	if (frame.reason === "periodic") s += 1;
	return s;
}
