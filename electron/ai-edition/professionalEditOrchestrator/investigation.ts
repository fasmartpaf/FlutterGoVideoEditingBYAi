/**
 * Targeted temporal investigation — bounded range only; no invented geometry.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { TargetedInvestigationResultV1 } from "./types";

export interface CursorSample {
	atSec: number;
	cx: number;
	cy: number;
	interactionType?: "move" | "click" | "mouseup";
	visible?: boolean;
}

/**
 * Look for a stable focal target in a bounded source window using cursor samples
 * (when provided). Never invents center zoom.
 */
export function investigateFocalInRange(args: {
	document: AxcutDocument;
	assetId: string;
	startSec: number;
	endSec: number;
	cursorSamples?: CursorSample[] | null;
	question?: string;
}): TargetedInvestigationResultV1 {
	const samples = (args.cursorSamples ?? []).filter(
		(s) => s.atSec >= args.startSec && s.atSec <= args.endSec,
	);
	const notes: string[] = [];
	let additionalDecodePasses = 0;

	if (samples.length < 3) {
		notes.push("insufficient_cursor_samples_in_range");
		return {
			question: args.question ?? "focal_for_zoom",
			range: { startSec: args.startSec, endSec: args.endSec },
			focalFound: false,
			notes,
			additionalDecodePasses,
			evidenceRefs: [],
		};
	}

	const meanCx = samples.reduce((n, s) => n + s.cx, 0) / samples.length;
	const meanCy = samples.reduce((n, s) => n + s.cy, 0) / samples.length;
	const varCx = samples.reduce((n, s) => n + (s.cx - meanCx) ** 2, 0) / samples.length;
	const varCy = samples.reduce((n, s) => n + (s.cy - meanCy) ** 2, 0) / samples.length;
	const stable = varCx < 0.01 && varCy < 0.01;
	notes.push(`cursor_samples=${samples.length}`, `stable=${stable}`);

	if (!stable) {
		notes.push("cursor_not_stable_enough_for_focal");
		return {
			question: args.question ?? "focal_for_zoom",
			range: { startSec: args.startSec, endSec: args.endSec },
			focalFound: false,
			notes,
			additionalDecodePasses,
			evidenceRefs: samples.slice(0, 4).map((s) => `cursor@${s.atSec.toFixed(2)}`),
		};
	}

	return {
		question: args.question ?? "focal_for_zoom",
		range: { startSec: args.startSec, endSec: args.endSec },
		focalFound: true,
		focal: { cx: meanCx, cy: meanCy, kind: "cursor_stable_cluster" },
		notes,
		additionalDecodePasses,
		evidenceRefs: samples.slice(0, 6).map((s) => `cursor@${s.atSec.toFixed(2)}`),
	};
}
