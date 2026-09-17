/**
 * Local cursor temporal metrics — velocity, dwell, cluster, convergence.
 */

import { FOCAL_POLICY_V1 } from "./policy";
import type { CursorSampleV1, NormalizedPointV1, SourceRangeSec } from "./types";

export interface CursorSegmentMetrics {
	startSec: number;
	endSec: number;
	mean: NormalizedPointV1;
	sampleCount: number;
	meanVelocity: number;
	maxVelocity: number;
	interactionCount: number;
	dwellSec: number;
	clusterRadius: number;
}

function clamp01(n: number): number {
	return Math.max(0, Math.min(1, n));
}

export function sortSamples(samples: CursorSampleV1[]): CursorSampleV1[] {
	return [...samples]
		.filter(
			(s) =>
				Number.isFinite(s.atSec) &&
				Number.isFinite(s.cx) &&
				Number.isFinite(s.cy) &&
				s.visible !== false,
		)
		.map((s) => ({
			...s,
			cx: clamp01(s.cx),
			cy: clamp01(s.cy),
			interactionType: s.interactionType ?? "move",
		}))
		.sort((a, b) => a.atSec - b.atSec);
}

export function sampleVelocity(prev: CursorSampleV1, curr: CursorSampleV1): number {
	const dt = Math.max(1e-3, curr.atSec - prev.atSec);
	return Math.hypot(curr.cx - prev.cx, curr.cy - prev.cy) / dt;
}

export function meanPoint(samples: CursorSampleV1[]): NormalizedPointV1 {
	const n = Math.max(1, samples.length);
	return {
		cx: samples.reduce((a, s) => a + s.cx, 0) / n,
		cy: samples.reduce((a, s) => a + s.cy, 0) / n,
	};
}

export function clusterRadius(samples: CursorSampleV1[]): number {
	if (samples.length < 2) return 0;
	const m = meanPoint(samples);
	return Math.max(...samples.map((s) => Math.hypot(s.cx - m.cx, s.cy - m.cy)));
}

export function detectDwellRuns(samples: CursorSampleV1[]): CursorSegmentMetrics[] {
	const sorted = sortSamples(samples);
	if (sorted.length < 2) return [];
	const out: CursorSegmentMetrics[] = [];
	let runStart = 0;
	const push = (start: number, endEx: number) => {
		if (endEx - start < 2) return;
		const run = sorted.slice(start, endEx);
		const dur = run[run.length - 1]!.atSec - run[0]!.atSec;
		if (dur < FOCAL_POLICY_V1.minDwellSec || dur > FOCAL_POLICY_V1.maxDwellSec) return;
		const velocities: number[] = [];
		for (let i = 1; i < run.length; i++) {
			velocities.push(sampleVelocity(run[i - 1]!, run[i]!));
		}
		const meanVel =
			velocities.length === 0 ? 0 : velocities.reduce((a, v) => a + v, 0) / velocities.length;
		if (meanVel > FOCAL_POLICY_V1.maxDwellVelocity) return;
		out.push({
			startSec: run[0]!.atSec,
			endSec: run[run.length - 1]!.atSec,
			mean: meanPoint(run),
			sampleCount: run.length,
			meanVelocity: meanVel,
			maxVelocity: velocities.length ? Math.max(...velocities) : 0,
			interactionCount: run.filter(
				(s) => s.interactionType === "click" || s.interactionType === "mouseup",
			).length,
			dwellSec: dur,
			clusterRadius: clusterRadius(run),
		});
	};
	for (let i = 1; i < sorted.length; i++) {
		const dist = Math.hypot(sorted[i]!.cx - sorted[i - 1]!.cx, sorted[i]!.cy - sorted[i - 1]!.cy);
		if (dist > FOCAL_POLICY_V1.dwellMoveThreshold) {
			push(runStart, i);
			runStart = i;
		}
	}
	push(runStart, sorted.length);
	return out;
}

export function interactionInstants(samples: CursorSampleV1[]): CursorSampleV1[] {
	return sortSamples(samples).filter(
		(s) => s.interactionType === "click" || s.interactionType === "mouseup",
	);
}

export function interactionClusters(
	samples: CursorSampleV1[],
): Array<{ range: SourceRangeSec; mean: NormalizedPointV1; count: number; radius: number }> {
	const clicks = interactionInstants(samples);
	if (clicks.length === 0) return [];
	const clusters: Array<{
		points: CursorSampleV1[];
	}> = [];
	for (const c of clicks) {
		let placed = false;
		for (const cl of clusters) {
			const m = meanPoint(cl.points);
			if (Math.hypot(c.cx - m.cx, c.cy - m.cy) <= FOCAL_POLICY_V1.clusterRadius) {
				cl.points.push(c);
				placed = true;
				break;
			}
		}
		if (!placed) clusters.push({ points: [c] });
	}
	return clusters
		.filter((c) => c.points.length >= FOCAL_POLICY_V1.minClusterInteractions)
		.map((c) => {
			const times = c.points.map((p) => p.atSec);
			return {
				range: { startSec: Math.min(...times), endSec: Math.max(...times) },
				mean: meanPoint(c.points),
				count: c.points.length,
				radius: clusterRadius(c.points),
			};
		});
}

/** Fast transit — weak; should not ground a target. */
export function isFastCrossing(samples: CursorSampleV1[]): boolean {
	const sorted = sortSamples(samples);
	if (sorted.length < 3) return false;
	const velocities: number[] = [];
	for (let i = 1; i < sorted.length; i++) {
		velocities.push(sampleVelocity(sorted[i - 1]!, sorted[i]!));
	}
	const mean = velocities.reduce((a, v) => a + v, 0) / velocities.length;
	const clicks = interactionInstants(sorted).length;
	return mean >= FOCAL_POLICY_V1.fastMoveVelocity && clicks === 0;
}

export function regionAround(
	point: NormalizedPointV1,
	radius = 0.1,
): { x: number; y: number; width: number; height: number } {
	const r = Math.max(0.04, Math.min(0.25, radius));
	const x = clamp01(point.cx - r);
	const y = clamp01(point.cy - r);
	const x2 = clamp01(point.cx + r);
	const y2 = clamp01(point.cy + r);
	return { x, y, width: Math.max(0.02, x2 - x), height: Math.max(0.02, y2 - y) };
}

export function rangesOverlap(a: SourceRangeSec, b: SourceRangeSec, pad = 0): boolean {
	return a.startSec - pad < b.endSec && a.endSec + pad > b.startSec;
}

export function pointNearRegion(
	p: NormalizedPointV1,
	r: { x: number; y: number; width: number; height: number },
	pad = 0,
): boolean {
	return (
		p.cx >= r.x - pad &&
		p.cx <= r.x + r.width + pad &&
		p.cy >= r.y - pad &&
		p.cy <= r.y + r.height + pad
	);
}
