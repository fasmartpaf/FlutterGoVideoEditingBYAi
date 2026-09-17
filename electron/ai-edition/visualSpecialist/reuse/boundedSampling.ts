/**
 * Bounded-range candidate times: periodic + scene + interaction + change.
 * Adapts watch-video first+scene+periodic idea for Investigator windows only.
 * @see reuse/NOTICE.md
 */

import { DEFAULT_SPECIALIST_PERIODIC_SEC } from "./constants";

export interface BoundedSamplingInput {
	startSourceTimeSec: number;
	endSourceTimeSec: number;
	/** Periodic step (seconds). */
	periodicSec?: number;
	/** Existing Bug-3 / ledger change times inside or near the range. */
	changeTimesSec?: number[];
	/** Cursor / ROI / investigator focus times. */
	interactionTimesSec?: number[];
	/** Optional ffmpeg scene-detect times already probed for this window. */
	sceneTimesSec?: number[];
	/** Cap raw candidates before perceptual dedupe. */
	maxCandidates?: number;
}

export interface SampleCandidate {
	sourceTimeSec: number;
	reason: "periodic" | "scene" | "change" | "interaction" | "endpoint";
	protected: boolean;
}

function clamp(t: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, t));
}

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

/**
 * Combine signals inside [start, end]. Does not scan the full video.
 */
export function buildBoundedSampleCandidates(input: BoundedSamplingInput): SampleCandidate[] {
	const start = Math.max(0, input.startSourceTimeSec);
	const end = Math.max(start, input.endSourceTimeSec);
	const periodic = Math.max(0.2, input.periodicSec ?? DEFAULT_SPECIALIST_PERIODIC_SEC);
	const maxCandidates = input.maxCandidates ?? 24;
	const byTime = new Map<number, SampleCandidate>();

	const upsert = (t: number, reason: SampleCandidate["reason"], protectedFrame: boolean) => {
		const tt = round3(clamp(t, start, end));
		const prev = byTime.get(tt);
		if (!prev) {
			byTime.set(tt, { sourceTimeSec: tt, reason, protected: protectedFrame });
			return;
		}
		const rank = { interaction: 4, change: 3, scene: 2, endpoint: 2, periodic: 1 } as const;
		const nextProtected = prev.protected || protectedFrame;
		const nextReason = rank[reason] >= rank[prev.reason] ? reason : prev.reason;
		byTime.set(tt, {
			sourceTimeSec: tt,
			reason: nextReason,
			protected: nextProtected,
		});
	};

	upsert(start, "endpoint", true);
	upsert(end, "endpoint", true);

	for (let t = start; t <= end + 1e-9; t += periodic) {
		upsert(t, "periodic", false);
	}

	for (const t of input.sceneTimesSec ?? []) {
		if (t >= start - 0.05 && t <= end + 0.05) upsert(t, "scene", false);
	}
	for (const t of input.changeTimesSec ?? []) {
		if (t >= start - 0.05 && t <= end + 0.05) upsert(t, "change", false);
	}
	for (const t of input.interactionTimesSec ?? []) {
		if (t >= start - 0.05 && t <= end + 0.05) upsert(t, "interaction", true);
	}

	let out = [...byTime.values()].sort((a, b) => a.sourceTimeSec - b.sourceTimeSec);
	if (out.length > maxCandidates) {
		const protectedOnes = out.filter((c) => c.protected);
		const rest = out.filter((c) => !c.protected);
		const slots = Math.max(0, maxCandidates - protectedOnes.length);
		const thinned: SampleCandidate[] = [];
		if (slots > 0 && rest.length > 0) {
			for (let i = 0; i < slots; i++) {
				const idx = slots === 1 ? 0 : Math.round((i * (rest.length - 1)) / (slots - 1));
				thinned.push(rest[idx]!);
			}
		}
		const seen = new Set<number>();
		out = [...protectedOnes, ...thinned]
			.filter((c) => {
				if (seen.has(c.sourceTimeSec)) return false;
				seen.add(c.sourceTimeSec);
				return true;
			})
			.sort((a, b) => a.sourceTimeSec - b.sourceTimeSec);
	}

	return out;
}
