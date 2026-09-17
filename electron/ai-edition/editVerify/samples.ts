/**
 * Bounded before / start / mid / end / after programme sample planner.
 */

export interface ProgrammeSamplePlan {
	before: number | null;
	start: number;
	mid: number;
	end: number;
	after: number | null;
	all: number[];
}

export function planProgrammeSamples(args: {
	rangeStartSec: number;
	rangeEndSec: number;
	programmeDurationSec?: number | null;
	padSec?: number;
}): ProgrammeSamplePlan {
	const pad = args.padSec ?? 0.15;
	const a = Math.min(args.rangeStartSec, args.rangeEndSec);
	const b = Math.max(args.rangeStartSec, args.rangeEndSec);
	const mid = (a + b) / 2;
	const dur = args.programmeDurationSec;
	const before = a - pad >= 0 ? Math.max(0, a - pad) : null;
	const after =
		dur != null && b + pad <= dur + 1e-6 ? Math.min(dur, b + pad) : b + pad >= 0 ? b + pad : null;
	const all = [before, a, mid, b, after].filter(
		(t): t is number => t != null && Number.isFinite(t),
	);
	return {
		before,
		start: a,
		mid,
		end: b,
		after,
		all: [...new Set(all.map((t) => Math.round(t * 1000) / 1000))],
	};
}
