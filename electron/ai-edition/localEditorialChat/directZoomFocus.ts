/**
 * DIRECT zoom focus selection — WHERE only, never WHETHER.
 * Priority: user target → click → dwell → focal cluster → center.
 */

import { existsSync, readFileSync } from "node:fs";
import {
	detectDwellRuns,
	interactionInstants,
	meanPoint,
	sortSamples,
} from "../editorialFocalEvidence/cursorMetrics";
import type { CursorSampleV1 } from "../editorialFocalEvidence/types";

export type DirectZoomFocusSource = "user" | "click" | "dwell" | "focal" | "center";

export interface DirectZoomFocusCandidate {
	source: DirectZoomFocusSource;
	cx: number;
	cy: number;
	confidence: number;
	reason: string;
	atSec?: number;
}

export interface DirectZoomFocusTrace {
	requestedRange: { startSec: number; endSec: number };
	focusCandidates: DirectZoomFocusCandidate[];
	selectedFocus: { cx: number; cy: number };
	focusSource: DirectZoomFocusSource;
	confidence: number;
	fallbackUsed: boolean;
}

export interface CursorSampleLite {
	atSec: number;
	cx: number;
	cy: number;
	visible?: boolean;
	interactionType?: string;
}

export function loadCursorSamplesFromSidecar(
	mediaPath: string | null | undefined,
): CursorSampleLite[] {
	if (!mediaPath) return [];
	const side = `${mediaPath}.cursor.json`;
	if (!existsSync(side)) return [];
	try {
		const raw = JSON.parse(readFileSync(side, "utf8")) as {
			samples?: Array<{
				timeMs?: number;
				atSec?: number;
				cx?: number;
				cy?: number;
				visible?: boolean;
				interactionType?: string;
			}>;
		};
		const out: CursorSampleLite[] = [];
		for (const s of raw.samples ?? []) {
			const atSec =
				typeof s.atSec === "number"
					? s.atSec
					: typeof s.timeMs === "number"
						? s.timeMs / 1000
						: Number.NaN;
			const cx = Number(s.cx);
			const cy = Number(s.cy);
			if (!Number.isFinite(atSec) || !Number.isFinite(cx) || !Number.isFinite(cy)) continue;
			out.push({
				atSec,
				cx,
				cy,
				visible: s.visible,
				interactionType: s.interactionType,
			});
		}
		return out;
	} catch {
		return [];
	}
}

function toV1(samples: CursorSampleLite[]): CursorSampleV1[] {
	return samples.map((s) => ({
		atSec: s.atSec,
		cx: s.cx,
		cy: s.cy,
		visible: s.visible,
		interactionType: (s.interactionType as CursorSampleV1["interactionType"]) ?? "move",
	}));
}

/**
 * Select focus for an already-authorized DIRECT zoom range.
 * Never returns "reject" — center is always available.
 */
export function selectDirectZoomFocus(args: {
	startSec: number;
	endSec: number;
	/** Explicit user focus when supplied (selection / named region coords). */
	userFocus?: { cx: number; cy: number } | null;
	cursorSamples?: CursorSampleLite[] | null;
}): DirectZoomFocusTrace {
	const requestedRange = { startSec: args.startSec, endSec: args.endSec };
	const candidates: DirectZoomFocusCandidate[] = [];

	if (args.userFocus && Number.isFinite(args.userFocus.cx) && Number.isFinite(args.userFocus.cy)) {
		candidates.push({
			source: "user",
			cx: clamp01(args.userFocus.cx),
			cy: clamp01(args.userFocus.cy),
			confidence: 1,
			reason: "explicit_user_target",
		});
	}

	const inRange = sortSamples(
		toV1(
			(args.cursorSamples ?? []).filter((s) => s.atSec >= args.startSec && s.atSec <= args.endSec),
		),
	);

	const clicks = interactionInstants(inRange).filter((s) => {
		const t = String(s.interactionType ?? "").toLowerCase();
		return t === "click" || t === "mousedown" || t === "mouseup" || t === "down";
	});
	if (clicks.length > 0) {
		// Prefer last click in range (most intentional action).
		const click = clicks[clicks.length - 1]!;
		candidates.push({
			source: "click",
			cx: click.cx,
			cy: click.cy,
			confidence: 0.92,
			reason: "grounded_click_in_range",
			atSec: click.atSec,
		});
	}

	const dwells = detectDwellRuns(inRange).sort((a, b) => b.dwellSec - a.dwellSec);
	if (dwells.length > 0) {
		const d = dwells[0]!;
		candidates.push({
			source: "dwell",
			cx: d.mean.cx,
			cy: d.mean.cy,
			confidence: d.interactionCount > 0 ? 0.88 : 0.72,
			reason: "cursor_dwell_cluster_in_range",
			atSec: (d.startSec + d.endSec) / 2,
		});
	}

	if (inRange.length >= 8) {
		const mid = inRange.slice(Math.floor(inRange.length * 0.25), Math.ceil(inRange.length * 0.9));
		if (mid.length >= 4) {
			const m = meanPoint(mid);
			const radius = Math.max(...mid.map((s) => Math.hypot(s.cx - m.cx, s.cy - m.cy)));
			if (radius < 0.18) {
				candidates.push({
					source: "focal",
					cx: m.cx,
					cy: m.cy,
					confidence: radius < 0.08 ? 0.7 : 0.55,
					reason: "stable_cursor_activity_cluster",
				});
			}
		}
	}

	candidates.push({
		source: "center",
		cx: 0.5,
		cy: 0.5,
		confidence: 0.25,
		reason: "deterministic_center_fallback",
	});

	const priority: DirectZoomFocusSource[] = ["user", "click", "dwell", "focal", "center"];
	let selected = candidates[candidates.length - 1]!;
	for (const src of priority) {
		const hit = candidates.find((c) => c.source === src);
		if (hit) {
			selected = hit;
			break;
		}
	}

	return {
		requestedRange,
		focusCandidates: candidates,
		selectedFocus: { cx: selected.cx, cy: selected.cy },
		focusSource: selected.source,
		confidence: selected.confidence,
		fallbackUsed: selected.source === "center",
	};
}

function clamp01(n: number): number {
	return Math.max(0, Math.min(1, n));
}
