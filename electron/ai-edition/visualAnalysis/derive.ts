/**
 * Derive stable / activity intervals from observation events.
 * Stable ≠ unimportant. Activity ≠ editorial judgment.
 */

import type {
	ActivityInterval,
	BlackInterval,
	FreezeInterval,
	SceneEvent,
	StableInterval,
	VisualAnalysisParameters,
	VisualChangeEvent,
} from "./types";

export interface CursorInstant {
	sourceTimeSec: number;
}

function mergeIntervals(
	raw: Array<{ startSec: number; endSec: number; reasons: ActivityInterval["reasons"] }>,
	gapSec: number,
): ActivityInterval[] {
	if (raw.length === 0) return [];
	const sorted = [...raw].sort((a, b) => a.startSec - b.startSec);
	const out: ActivityInterval[] = [];
	let cur = { ...sorted[0]!, reasons: [...sorted[0]!.reasons] };
	for (let i = 1; i < sorted.length; i += 1) {
		const n = sorted[i]!;
		if (n.startSec <= cur.endSec + gapSec) {
			cur.endSec = Math.max(cur.endSec, n.endSec);
			for (const r of n.reasons) {
				if (!cur.reasons.includes(r)) cur.reasons.push(r);
			}
		} else {
			out.push({
				startSec: cur.startSec,
				endSec: cur.endSec,
				durationSec: cur.endSec - cur.startSec,
				reasons: cur.reasons,
			});
			cur = { ...n, reasons: [...n.reasons] };
		}
	}
	out.push({
		startSec: cur.startSec,
		endSec: cur.endSec,
		durationSec: cur.endSec - cur.startSec,
		reasons: cur.reasons,
	});
	return out;
}

export function deriveActivityIntervals(args: {
	durationSec: number;
	changeEvents: VisualChangeEvent[];
	sceneEvents: SceneEvent[];
	cursorInstants?: CursorInstant[];
	parameters: VisualAnalysisParameters;
}): ActivityInterval[] {
	const raw: Array<{ startSec: number; endSec: number; reasons: ActivityInterval["reasons"] }> = [];
	const pad = 0.15;

	for (const c of args.changeEvents) {
		if (c.level === "SIGNIFICANT") {
			raw.push({
				startSec: Math.max(0, c.fromSec - pad),
				endSec: Math.min(args.durationSec, c.toSec + pad),
				reasons: ["significant_change"],
			});
		}
	}

	const moderate = args.changeEvents.filter((c) => c.level === "MODERATE");
	for (let i = 0; i < moderate.length; i += 1) {
		const cluster = [moderate[i]!];
		while (
			i + 1 < moderate.length &&
			moderate[i + 1]!.fromSec - cluster[cluster.length - 1]!.toSec < 1.0
		) {
			i += 1;
			cluster.push(moderate[i]!);
		}
		if (cluster.length >= 2) {
			raw.push({
				startSec: Math.max(0, cluster[0]!.fromSec - pad),
				endSec: Math.min(args.durationSec, cluster[cluster.length - 1]!.toSec + pad),
				reasons: ["moderate_density"],
			});
		}
	}

	for (const s of args.sceneEvents) {
		raw.push({
			startSec: Math.max(0, s.timeSec - pad),
			endSec: Math.min(args.durationSec, s.timeSec + pad),
			reasons: ["scene_transition"],
		});
	}

	for (const c of args.cursorInstants ?? []) {
		raw.push({
			startSec: Math.max(0, c.sourceTimeSec - pad),
			endSec: Math.min(args.durationSec, c.sourceTimeSec + pad),
			reasons: ["cursor_interaction"],
		});
	}

	return mergeIntervals(raw, args.parameters.activityMergeGapSec).filter(
		(a) => a.durationSec > 1e-3,
	);
}

export function deriveStableIntervals(args: {
	durationSec: number;
	activity: ActivityInterval[];
	parameters: VisualAnalysisParameters;
	/** Freeze is evidence of stability, not activity. */
	freezeIntervals?: FreezeInterval[];
	blackIntervals?: BlackInterval[];
}): StableInterval[] {
	const blockers = args.activity
		.map((a) => ({ startSec: a.startSec, endSec: a.endSec }))
		.sort((a, b) => a.startSec - b.startSec);

	const gaps: Array<{ startSec: number; endSec: number }> = [];
	let cursor = 0;
	for (const b of blockers) {
		if (b.startSec > cursor + 1e-6) {
			gaps.push({ startSec: cursor, endSec: b.startSec });
		}
		cursor = Math.max(cursor, b.endSec);
	}
	if (cursor < args.durationSec - 1e-6) {
		gaps.push({ startSec: cursor, endSec: args.durationSec });
	}

	const out: StableInterval[] = [];
	for (const g of gaps) {
		const dur = g.endSec - g.startSec;
		if (dur + 1e-9 < args.parameters.stableMinDurationSec) continue;
		out.push({
			startSec: g.startSec,
			endSec: g.endSec,
			durationSec: dur,
			meaning: "visual_state_changes_little",
		});
	}
	return out;
}
