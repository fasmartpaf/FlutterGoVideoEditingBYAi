/**
 * Evidence Retrieval Coverage + Deepening — coverage floor, event-region deepen,
 * diversity, and sufficiency. Ranking ≠ selection.
 */

import type {
	VisualChange,
	VisualEvidenceCandidate,
	VisualEvidenceFrame,
} from "../visualEvidence/types";
import {
	bucketIndexForTime,
	buildCoverageBuckets,
	type CoverageBucket,
	coverageBucketCount,
} from "./coverageBuckets";
import {
	allocateCoverageDeepeningBudgets,
	buildEvidenceEventRegions,
	computeRetrievalQualityDiagnostics,
	type EvidenceEventRegion,
	markRegionsCovered,
	type RetrievalQualityDiagnostics,
	representativeTimesForRegion,
} from "./eventRegions";
import type { VideoMemoryQueryClass, VideoMemoryV1 } from "./index";
import type { AttachedFrameMeta, FrameAttachReason } from "./productionPath";
import { type FocusWindow, needsWholeMediaCoverage, type QueryScope } from "./queryScope";
import { relevanceScore } from "./relevanceScore";

export {
	bucketIndexForTime,
	buildCoverageBuckets,
	coverageBucketCount,
} from "./coverageBuckets";
export { relevanceScore } from "./relevanceScore";
export type { CoverageBucket };

export type VisualEvidenceCoverage = {
	scope: QueryScope;
	queryClass: VideoMemoryQueryClass;
	durationSec: number;
	selectedTimes: number[];
	bucketCount: number;
	coveredBuckets: number[];
	coverageFraction: number;
	largestUnobservedGapSec: number;
	clusterSpanSec: number;
	clustered: boolean;
	coverageSufficient: boolean;
	reason: string;
	evidenceSufficiency: "sufficient" | "insufficient";
};

export type CandidateSelectionTrace = {
	timestamp: number;
	reason: string;
	rawScore: number;
	temporalBucket: number;
	role: "coverage" | "deepening" | "neither";
	selected: boolean;
	rejectionReason: string | null;
	nearestSelected: number | null;
	diversityDecision: string | null;
	eventRegionId: string | null;
};

export type FrameSelectionResult = {
	frames: VisualEvidenceFrame[];
	meta: AttachedFrameMeta[];
	coverage: VisualEvidenceCoverage;
	eventRegions: EvidenceEventRegion[];
	diagnostics: RetrievalQualityDiagnostics;
	trace: CandidateSelectionTrace[];
	budget: { coverageBudget: number; deepeningBudget: number; reason: string };
};

function largestGap(times: number[], durationSec: number): number {
	if (!(durationSec > 0)) return 0;
	if (times.length === 0) return durationSec;
	const sorted = [...times].sort((a, b) => a - b);
	let gap = sorted[0]!;
	for (let i = 1; i < sorted.length; i++) {
		gap = Math.max(gap, sorted[i]! - sorted[i - 1]!);
	}
	gap = Math.max(gap, durationSec - sorted[sorted.length - 1]!);
	return gap;
}

/**
 * Honest coverage: occupied duration-normalized buckets / bucket count.
 * Two endpoint frames do not occupy the middle buckets.
 */
export function measureVisualEvidenceCoverage(input: {
	selectedTimes: number[];
	durationSec: number;
	scope: QueryScope;
	queryClass: VideoMemoryQueryClass;
	focusWindow?: FocusWindow | null;
}): VisualEvidenceCoverage {
	const durationSec = Math.max(0, input.durationSec);
	const times = [...input.selectedTimes].sort((a, b) => a - b);
	const buckets = buildCoverageBuckets(durationSec || 1);
	const n = buckets.length;
	for (const t of times) {
		const i = bucketIndexForTime(t, durationSec || 1, n);
		buckets[i]!.occupied = true;
		buckets[i]!.selectedTimes.push(t);
	}
	const covered = buckets.filter((b) => b.occupied).map((b) => b.index);
	const coverageFraction = n > 0 ? covered.length / n : 0;
	const clusterSpanSec = times.length ? times[times.length - 1]! - times[0]! : 0;
	const largestUnobservedGapSec = largestGap(times, durationSec);
	const clustered =
		times.length >= 3 && durationSec > 10 && clusterSpanSec < Math.max(3, durationSec * 0.18);

	let coverageSufficient = false;
	let reason = "";

	if (input.queryClass === "speech" || input.queryClass === "direct_edit") {
		coverageSufficient = true;
		reason = "visual coverage not required for this query class";
	} else if (input.scope === "local" || input.scope === "bounded_range") {
		const win = input.focusWindow;
		const inWindow = win
			? times.filter((t) => t >= win.startSec - 0.05 && t <= win.endSec + 0.05)
			: times;
		coverageSufficient = inWindow.length > 0;
		reason = coverageSufficient
			? "bounded/local window has at least one visual sample"
			: "no visual sample in the requested temporal window";
	} else if (
		needsWholeMediaCoverage(input.queryClass, input.scope) ||
		input.scope === "whole_media"
	) {
		const minBuckets = Math.max(3, Math.ceil(n * 0.6));
		const maxGap = durationSec * 0.45;
		coverageSufficient =
			times.length > 0 &&
			covered.length >= minBuckets &&
			!clustered &&
			largestUnobservedGapSec <= maxGap;
		reason = coverageSufficient
			? `whole-media coverage: ${covered.length}/${n} buckets, gap=${largestUnobservedGapSec.toFixed(2)}s`
			: clustered
				? `clustered samples span ${clusterSpanSec.toFixed(2)}s of ${durationSec.toFixed(2)}s — insufficient for whole-media`
				: `coverage ${covered.length}/${n} buckets (need ${minBuckets}), largest gap ${largestUnobservedGapSec.toFixed(2)}s`;
	} else {
		coverageSufficient = times.length > 0;
		reason = times.length > 0 ? "unknown scope with some frames" : "no visual frames";
	}

	return {
		scope: input.scope,
		queryClass: input.queryClass,
		durationSec,
		selectedTimes: times,
		bucketCount: n,
		coveredBuckets: covered,
		coverageFraction,
		largestUnobservedGapSec,
		clusterSpanSec,
		clustered,
		coverageSufficient,
		reason,
		evidenceSufficiency: coverageSufficient ? "sufficient" : "insufficient",
	};
}

export function speechAlignmentTimes(input: {
	windows: Array<{ startSec: number; endSec: number }>;
	durationSec: number;
	maxAnchors?: number;
}): number[] {
	const maxAnchors = input.maxAnchors ?? 4;
	const wins = [...input.windows].sort((a, b) => a.startSec - b.startSec);
	if (!wins.length || maxAnchors <= 0) return [];
	if (wins.length <= maxAnchors) {
		const out: number[] = [];
		for (const w of wins) {
			out.push(w.startSec);
			const span = w.endSec - w.startSec;
			if (span >= 1.2) out.push((w.startSec + w.endSec) / 2);
		}
		return out.slice(0, maxAnchors + 2);
	}
	const picks: number[] = [];
	for (let i = 0; i < maxAnchors; i++) {
		const idx =
			maxAnchors === 1
				? Math.floor(wins.length / 2)
				: Math.round((i * (wins.length - 1)) / (maxAnchors - 1));
		const w = wins[idx]!;
		picks.push((w.startSec + w.endSec) / 2);
	}
	return picks;
}

function tooClose(t: number, picked: VisualEvidenceFrame[], minSep: number): boolean {
	return picked.some((p) => Math.abs(p.sourceTimeSec - t) <= minSep);
}

function nearestSelectedTime(t: number, picked: VisualEvidenceFrame[]): number | null {
	if (!picked.length) return null;
	let best = picked[0]!.sourceTimeSec;
	let bestD = Math.abs(best - t);
	for (const p of picked) {
		const d = Math.abs(p.sourceTimeSec - t);
		if (d < bestD) {
			bestD = d;
			best = p.sourceTimeSec;
		}
	}
	return best;
}

function nearestTo(
	target: number,
	frames: VisualEvidenceFrame[],
	exclude: VisualEvidenceFrame[],
	minSep: number,
): VisualEvidenceFrame | null {
	let best: VisualEvidenceFrame | null = null;
	let bestD = Number.POSITIVE_INFINITY;
	for (const f of frames) {
		if (exclude.includes(f)) continue;
		if (tooClose(f.sourceTimeSec, exclude, minSep)) continue;
		const d = Math.abs(f.sourceTimeSec - target);
		if (d < bestD) {
			bestD = d;
			best = f;
		}
	}
	return best;
}

function findFrameNear(
	pool: VisualEvidenceFrame[],
	t: number,
	eps = 0.45,
): VisualEvidenceFrame | null {
	let best: VisualEvidenceFrame | null = null;
	let bestD = Number.POSITIVE_INFINITY;
	for (const f of pool) {
		const d = Math.abs(f.sourceTimeSec - t);
		if (d < bestD) {
			bestD = d;
			best = f;
		}
	}
	return best && bestD <= eps ? best : bestD <= 1.25 ? best : null;
}

function regionForTime(regions: EvidenceEventRegion[], t: number): EvidenceEventRegion | null {
	return (
		regions.find((r) => t >= r.startSec - 0.5 && t <= r.endSec + 0.5) ??
		regions.find((r) => Math.abs(r.peakTimeSec - t) <= 1.2) ??
		null
	);
}

function framesFromRegionCount(picked: VisualEvidenceFrame[], region: EvidenceEventRegion): number {
	return picked.filter(
		(p) => p.sourceTimeSec >= region.startSec - 0.5 && p.sourceTimeSec <= region.endSec + 0.5,
	).length;
}

/**
 * Stage A coverage + Stage B event-region deepening with replacement merge.
 */
export function selectFramesWithCoverage(input: {
	frames: VisualEvidenceFrame[];
	queryClass: VideoMemoryQueryClass;
	scope: QueryScope;
	maxFrames: number;
	preferChangeBoundaries: boolean;
	preferLateWindow: boolean;
	lateWindowStartFrac: number;
	memory?: VideoMemoryV1 | null;
	priorityTimesSec?: number[];
	focusWindow?: FocusWindow | null;
	durationSec?: number;
	changes?: VisualChange[];
	primaryReason: (
		queryClass: VideoMemoryQueryClass,
		frame: VisualEvidenceFrame,
		memory: VideoMemoryV1 | null,
	) => { reason: FrameAttachReason; note: string };
}): FrameSelectionResult {
	const duration =
		input.durationSec && input.durationSec > 0
			? input.durationSec
			: input.memory?.sourceDurationSec && input.memory.sourceDurationSec > 0
				? input.memory.sourceDurationSec
				: input.frames.length
					? Math.max(...input.frames.map((f) => f.sourceTimeSec))
					: 0;

	let pool = [...input.frames].sort((a, b) => a.sourceTimeSec - b.sourceTimeSec);
	if (input.focusWindow) {
		const w = input.focusWindow;
		const filtered = pool.filter(
			(f) => f.sourceTimeSec >= w.startSec - 0.15 && f.sourceTimeSec <= w.endSec + 0.15,
		);
		if (filtered.length) pool = filtered;
	}

	const emptyCoverage = measureVisualEvidenceCoverage({
		selectedTimes: [],
		durationSec: duration,
		scope: input.scope,
		queryClass: input.queryClass,
		focusWindow: input.focusWindow,
	});
	if (input.maxFrames <= 0 || pool.length === 0) {
		return {
			frames: [],
			meta: [],
			coverage: emptyCoverage,
			eventRegions: [],
			diagnostics: computeRetrievalQualityDiagnostics({
				coverageBudget: 0,
				deepeningBudget: 0,
				coverageSelected: 0,
				deepeningSelected: 0,
				eventRegions: [],
				selectedTimes: [],
				duplicateRegionFrames: 0,
				relevanceCandidatesAvailable: 0,
				relevanceCandidatesSelected: 0,
			}),
			trace: [],
			budget: { coverageBudget: 0, deepeningBudget: 0, reason: "empty" },
		};
	}

	const DEDUPE = 0.35;
	const minSep = Math.max(
		DEDUPE,
		duration > 0 ? Math.min(2.2, duration / Math.max(8, input.maxFrames * 2.2)) : DEDUPE,
	);
	const nBuckets = coverageBucketCount(duration);
	const lateStart = duration * input.lateWindowStartFrac;
	const priorityTimesSec = [...(input.priorityTimesSec ?? [])];
	if (input.queryClass === "cross_modal" && input.memory?.speechWindows?.length) {
		priorityTimesSec.push(
			...speechAlignmentTimes({
				windows: input.memory.speechWindows,
				durationSec: duration,
			}),
		);
	}

	const scoreOpts = {
		preferChangeBoundaries: input.preferChangeBoundaries,
		preferLateWindow: input.preferLateWindow,
		lateStart,
		priorityTimesSec,
		queryClass: input.queryClass,
	};

	let regions = buildEvidenceEventRegions({
		frames: pool,
		changes: input.changes,
		durationSec: duration,
		queryClass: input.queryClass,
		priorityTimesSec,
		lateStart,
	});

	const whole = needsWholeMediaCoverage(input.queryClass, input.scope);
	const budget = whole
		? allocateCoverageDeepeningBudgets({
				maxFrames: input.maxFrames,
				durationSec: duration,
				bucketCount: nBuckets,
				eventRegionCount: regions.length,
				queryClass: input.queryClass,
			})
		: {
				coverageBudget: input.maxFrames,
				deepeningBudget: 0,
				maxFrames: input.maxFrames,
				reason: "non-whole-media — single pool",
			};

	const picked: VisualEvidenceFrame[] = [];
	const coverageSet = new Set<VisualEvidenceFrame>();
	const deepenSet = new Set<VisualEvidenceFrame>();
	const traceByTime = new Map<number, CandidateSelectionTrace>();

	const ensureTrace = (f: VisualEvidenceFrame): CandidateSelectionTrace => {
		const key = Math.round(f.sourceTimeSec * 1000) / 1000;
		let row = traceByTime.get(key);
		if (!row) {
			row = {
				timestamp: f.sourceTimeSec,
				reason: f.reason,
				rawScore: relevanceScore(f, scoreOpts),
				temporalBucket: bucketIndexForTime(f.sourceTimeSec, duration || 1, nBuckets),
				role: "neither",
				selected: false,
				rejectionReason: null,
				nearestSelected: null,
				diversityDecision: null,
				eventRegionId: regionForTime(regions, f.sourceTimeSec)?.id ?? null,
			};
			traceByTime.set(key, row);
		}
		return row;
	};

	for (const f of pool) ensureTrace(f);

	if (whole && duration > 0) {
		const buckets = buildCoverageBuckets(duration);
		for (const b of buckets) {
			if ([...coverageSet].length >= budget.coverageBudget) break;
			if (picked.length >= input.maxFrames) break;
			const hit = nearestTo(b.centerSec, pool, picked, minSep * 0.55);
			if (!hit) continue;
			picked.push(hit);
			coverageSet.add(hit);
			const tr = ensureTrace(hit);
			tr.selected = true;
			tr.role = "coverage";
			tr.rejectionReason = null;
			tr.diversityDecision = `coverage_anchor bucket=${b.index}`;
		}
	} else {
		const ranked = [...pool].sort(
			(a, b) =>
				relevanceScore(b, scoreOpts) - relevanceScore(a, scoreOpts) ||
				a.sourceTimeSec - b.sourceTimeSec,
		);
		for (const f of ranked) {
			if (picked.length >= input.maxFrames) break;
			if (tooClose(f.sourceTimeSec, picked, DEDUPE)) {
				const tr = ensureTrace(f);
				tr.rejectionReason = "dedupe";
				tr.nearestSelected = nearestSelectedTime(f.sourceTimeSec, picked);
				continue;
			}
			picked.push(f);
			coverageSet.add(f);
			const tr = ensureTrace(f);
			tr.selected = true;
			tr.role = "coverage";
		}
	}

	regions = markRegionsCovered(
		regions,
		picked.map((p) => p.sourceTimeSec),
	);

	const relevancePool = pool.filter(
		(f) =>
			f.reason === "change_refinement" ||
			f.reason.startsWith("cursor_interaction") ||
			priorityTimesSec.some((p) => Math.abs(p - f.sourceTimeSec) <= 1.0) ||
			regions.some((r) => Math.abs(r.peakTimeSec - f.sourceTimeSec) <= 1.0),
	);

	if (whole && budget.deepeningBudget > 0) {
		const rankedRegions = [...regions].sort(
			(a, b) =>
				b.queryRelevance * b.confidence * b.novelty - a.queryRelevance * a.confidence * a.novelty ||
				a.peakTimeSec - b.peakTimeSec,
		);

		let deepenUsed = 0;
		for (const region of rankedRegions) {
			if (deepenUsed >= budget.deepeningBudget) break;
			if (picked.length >= input.maxFrames && deepenUsed >= budget.deepeningBudget) break;

			const reps = representativeTimesForRegion(region, pool);
			for (const peakT of reps) {
				if (deepenUsed >= budget.deepeningBudget) break;
				const candidate = findFrameNear(pool, peakT);
				if (!candidate) {
					continue;
				}
				const tr = ensureTrace(candidate);
				tr.eventRegionId = region.id;

				if (framesFromRegionCount(picked, region) >= 2) {
					tr.rejectionReason = "event_region_cap";
					tr.diversityDecision = "max 2 frames per event region";
					tr.nearestSelected = nearestSelectedTime(candidate.sourceTimeSec, picked);
					continue;
				}

				const sameBucketAnchor = picked.find(
					(p) =>
						coverageSet.has(p) &&
						bucketIndexForTime(p.sourceTimeSec, duration || 1, nBuckets) === region.bucketIndex &&
						Math.abs(p.sourceTimeSec - candidate.sourceTimeSec) <= Math.max(2.5, duration * 0.12),
				);

				if (sameBucketAnchor && candidate !== sameBucketAnchor) {
					// Replace coverage anchor with higher-value event frame; bucket stays occupied.
					const idx = picked.indexOf(sameBucketAnchor);
					if (idx >= 0) {
						picked[idx] = candidate;
						coverageSet.delete(sameBucketAnchor);
						coverageSet.add(candidate);
						deepenSet.add(candidate);
						const oldTr = ensureTrace(sameBucketAnchor);
						oldTr.selected = false;
						oldTr.rejectionReason = "replaced_by_event_region";
						oldTr.diversityDecision = `replaced by ${region.id} @ ${candidate.sourceTimeSec.toFixed(2)}`;
						tr.selected = true;
						tr.role = "deepening";
						tr.rejectionReason = null;
						tr.diversityDecision = `replaced coverage anchor; bucket ${region.bucketIndex} preserved`;
						deepenUsed += 1;
						continue;
					}
				}

				if (picked.includes(candidate)) {
					tr.rejectionReason = "already_selected";
					continue;
				}
				if (tooClose(candidate.sourceTimeSec, picked, DEDUPE)) {
					tr.rejectionReason = "dedupe";
					tr.nearestSelected = nearestSelectedTime(candidate.sourceTimeSec, picked);
					continue;
				}
				if (picked.length >= input.maxFrames) {
					// Try replace weakest periodic in same/nearby bucket
					const weak = picked
						.filter((p) => coverageSet.has(p) && p.reason === "periodic")
						.sort(
							(a, b) =>
								relevanceScore(a, scoreOpts) - relevanceScore(b, scoreOpts) ||
								Math.abs(a.sourceTimeSec - candidate.sourceTimeSec) -
									Math.abs(b.sourceTimeSec - candidate.sourceTimeSec),
						)[0];
					if (
						weak &&
						bucketIndexForTime(weak.sourceTimeSec, duration || 1, nBuckets) === region.bucketIndex
					) {
						const idx = picked.indexOf(weak);
						picked[idx] = candidate;
						coverageSet.delete(weak);
						deepenSet.add(candidate);
						ensureTrace(weak).selected = false;
						ensureTrace(weak).rejectionReason = "replaced_by_event_region";
						tr.selected = true;
						tr.role = "deepening";
						tr.diversityDecision = "replaced weak periodic in-bucket";
						deepenUsed += 1;
					} else {
						tr.rejectionReason = "attach_budget_full";
					}
					continue;
				}

				picked.push(candidate);
				deepenSet.add(candidate);
				tr.selected = true;
				tr.role = "deepening";
				tr.rejectionReason = null;
				tr.diversityDecision = `event_region ${region.id}`;
				deepenUsed += 1;
			}
		}

		// Remaining deepen slots: ranked relevance with diversity (not same region flood)
		if (deepenUsed < budget.deepeningBudget) {
			const ranked = [...relevancePool].sort(
				(a, b) =>
					relevanceScore(b, scoreOpts) - relevanceScore(a, scoreOpts) ||
					a.sourceTimeSec - b.sourceTimeSec,
			);
			for (const f of ranked) {
				if (deepenUsed >= budget.deepeningBudget) break;
				if (picked.length >= input.maxFrames) break;
				const tr = ensureTrace(f);
				if (picked.includes(f)) continue;
				if (tooClose(f.sourceTimeSec, picked, minSep)) {
					tr.rejectionReason = tr.rejectionReason ?? "temporal_diversity";
					tr.nearestSelected = nearestSelectedTime(f.sourceTimeSec, picked);
					tr.diversityDecision = `minSep=${minSep.toFixed(2)}`;
					continue;
				}
				const reg = regionForTime(regions, f.sourceTimeSec);
				if (reg && framesFromRegionCount(picked, reg) >= 2) {
					tr.rejectionReason = "event_region_cap";
					continue;
				}
				picked.push(f);
				deepenSet.add(f);
				tr.selected = true;
				tr.role = "deepening";
				tr.rejectionReason = null;
				deepenUsed += 1;
			}
		}
	}

	// Fill if under-budget (prefer uncovered buckets)
	if (picked.length < input.maxFrames && whole) {
		const buckets = buildCoverageBuckets(duration);
		for (const b of buckets) {
			if (picked.length >= input.maxFrames) break;
			const occupied = picked.some(
				(p) => bucketIndexForTime(p.sourceTimeSec, duration || 1, nBuckets) === b.index,
			);
			if (occupied) continue;
			const hit = nearestTo(b.centerSec, pool, picked, minSep * 0.5);
			if (!hit) continue;
			picked.push(hit);
			coverageSet.add(hit);
			const tr = ensureTrace(hit);
			tr.selected = true;
			tr.role = "coverage";
			tr.diversityDecision = "fill uncovered bucket";
		}
	}

	picked.sort((a, b) => a.sourceTimeSec - b.sourceTimeSec);

	for (const f of pool) {
		const tr = ensureTrace(f);
		if (!tr.selected && !tr.rejectionReason) {
			tr.rejectionReason = "not_chosen";
			tr.nearestSelected = nearestSelectedTime(f.sourceTimeSec, picked);
		}
	}

	const meta: AttachedFrameMeta[] = picked.map((f) => {
		if (deepenSet.has(f)) {
			const reg = regionForTime(regions, f.sourceTimeSec);
			if (f.reason === "change_refinement" || reg?.signals.includes("change_refinement")) {
				return {
					sourceTimeSec: f.sourceTimeSec,
					reason: "transition_boundary",
					note: `event deepen @ ${f.sourceTimeSec.toFixed(2)}s${reg ? ` (${reg.id})` : ""}`,
				};
			}
			if (priorityTimesSec.some((p) => Math.abs(p - f.sourceTimeSec) <= 1.0)) {
				return {
					sourceTimeSec: f.sourceTimeSec,
					reason:
						input.queryClass === "cross_modal" ? "cross_modal_compare" : "investigator_deepen",
					note: `aligned deepen @ ${f.sourceTimeSec.toFixed(2)}s`,
				};
			}
		}
		if (coverageSet.has(f) && (f.reason === "periodic" || f.reason === "clip_boundary")) {
			return {
				sourceTimeSec: f.sourceTimeSec,
				reason: "coverage_anchor" as FrameAttachReason,
				note: `coverage floor @ ${f.sourceTimeSec.toFixed(2)}s`,
			};
		}
		const { reason, note } = input.primaryReason(input.queryClass, f, input.memory ?? null);
		return { sourceTimeSec: f.sourceTimeSec, reason, note };
	});

	const coverage = measureVisualEvidenceCoverage({
		selectedTimes: picked.map((f) => f.sourceTimeSec),
		durationSec: duration,
		scope: input.scope,
		queryClass: input.queryClass,
		focusWindow: input.focusWindow,
	});

	let duplicateRegionFrames = 0;
	for (const r of regions) {
		const n = framesFromRegionCount(picked, r);
		if (n > 1) duplicateRegionFrames += n - 1;
	}

	const diagnostics = computeRetrievalQualityDiagnostics({
		coverageBudget: budget.coverageBudget,
		deepeningBudget: budget.deepeningBudget,
		coverageSelected: [...coverageSet].filter((f) => picked.includes(f)).length,
		deepeningSelected: [...deepenSet].filter((f) => picked.includes(f)).length,
		eventRegions: regions,
		selectedTimes: picked.map((f) => f.sourceTimeSec),
		duplicateRegionFrames,
		relevanceCandidatesAvailable: relevancePool.length,
		relevanceCandidatesSelected: picked.filter((f) => relevancePool.includes(f)).length,
	});

	return {
		frames: picked,
		meta,
		coverage,
		eventRegions: regions,
		diagnostics,
		trace: [...traceByTime.values()].sort((a, b) => a.timestamp - b.timestamp),
		budget: {
			coverageBudget: budget.coverageBudget,
			deepeningBudget: budget.deepeningBudget,
			reason: budget.reason,
		},
	};
}

/**
 * Candidate extract budget for coverage-first prepare: keep periodic anchors
 * plus room for later change refinement — never 70% interactions first.
 */
export function applyCoverageFirstCandidateBudget(
	candidates: VisualEvidenceCandidate[],
	maxFrames: number,
	durationSec: number,
): VisualEvidenceCandidate[] {
	if (candidates.length <= maxFrames) {
		return [...candidates].sort((a, b) => a.sourceTimeSec - b.sourceTimeSec);
	}
	const n = coverageBucketCount(durationSec);
	const buckets = buildCoverageBuckets(durationSec);
	const selected: VisualEvidenceCandidate[] = [];
	const near = (t: number) => selected.some((s) => Math.abs(s.sourceTimeSec - t) <= 0.35);

	const periodics = candidates
		.filter((c) => c.reason === "periodic" || c.reason === "clip_boundary")
		.sort((a, b) => a.sourceTimeSec - b.sourceTimeSec);
	for (const b of buckets) {
		if (selected.length >= n) break;
		let best: VisualEvidenceCandidate | null = null;
		let bestD = Number.POSITIVE_INFINITY;
		for (const c of periodics) {
			if (near(c.sourceTimeSec)) continue;
			const d = Math.abs(c.sourceTimeSec - b.centerSec);
			if (d < bestD) {
				bestD = d;
				best = c;
			}
		}
		if (best) selected.push(best);
	}

	const rest = [...candidates].sort((a, b) => {
		const rank = (c: VisualEvidenceCandidate) =>
			c.reason.startsWith("cursor") ? 3 : c.reason === "clip_boundary" ? 2 : 1;
		return rank(b) - rank(a) || a.sourceTimeSec - b.sourceTimeSec;
	});
	for (const c of rest) {
		if (selected.length >= maxFrames) break;
		if (near(c.sourceTimeSec)) continue;
		const i = bucketIndexForTime(c.sourceTimeSec, durationSec, n);
		const load = selected.filter(
			(s) => bucketIndexForTime(s.sourceTimeSec, durationSec, n) === i,
		).length;
		if (load >= 2 && c.reason.startsWith("cursor")) continue;
		selected.push(c);
	}

	return selected.sort((a, b) => a.sourceTimeSec - b.sourceTimeSec);
}

export function formatCoverageBriefing(coverage: VisualEvidenceCoverage): string {
	return [
		"VISUAL_EVIDENCE_COVERAGE (deterministic — not a claim that every frame was inspected)",
		`scope=${coverage.scope} queryClass=${coverage.queryClass} durationSec=${coverage.durationSec.toFixed(3)}`,
		`selectedTimes=${coverage.selectedTimes.map((t) => t.toFixed(2)).join(",") || "(none)"}`,
		`coveredBuckets=${coverage.coveredBuckets.join(",") || "(none)"} / ${coverage.bucketCount}`,
		`coverageFraction=${coverage.coverageFraction.toFixed(3)} (occupied buckets, not min–max span)`,
		`largestUnobservedGapSec=${coverage.largestUnobservedGapSec.toFixed(2)} clustered=${coverage.clustered}`,
		`EVIDENCE_SUFFICIENCY=${coverage.evidenceSufficiency}`,
		`reason=${coverage.reason}`,
		coverage.evidenceSufficiency === "insufficient"
			? "Do not treat attached frames as a whole-recording inspection."
			: coverage.queryClass === "speech" || coverage.queryClass === "direct_edit"
				? "Visual frames are not required for this query class."
				: "Attached frames are a bounded sample with coverage floor + relevance deepen.",
	].join("\n");
}
