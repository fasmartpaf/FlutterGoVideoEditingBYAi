/**
 * Evidence event regions — cluster nearby information-rich candidates.
 * Deterministic; no LLM. Used by Retrieval Deepening V1.
 */

import type { VisualChange, VisualEvidenceFrame } from "../visualEvidence/types";
import { bucketIndexForTime, coverageBucketCount } from "./coverageBuckets";
import type { VideoMemoryQueryClass } from "./index";
import { relevanceScore } from "./relevanceScore";

export const EVIDENCE_RETRIEVAL_DEEPENING_V1_ID =
	"CURRENT_OPENSCREEN_EVIDENCE_RETRIEVAL_DEEPENING_V1" as const;

export type EvidenceEventSignal =
	| "change_refinement"
	| "significant_transition"
	| "moderate_large_gap"
	| "cursor_interaction"
	| "clip_boundary"
	| "speech_alignment"
	| "temporary_ui"
	| "priority_target";

export type EvidenceEventRegion = {
	id: string;
	startSec: number;
	endSec: number;
	peakTimeSec: number;
	signals: EvidenceEventSignal[];
	confidence: number;
	queryRelevance: number;
	novelty: number;
	alreadyCovered: boolean;
	memberTimes: number[];
	bucketIndex: number;
};

const REGION_MERGE_GAP_SEC = 2.8;

function signalWeight(s: EvidenceEventSignal): number {
	switch (s) {
		case "change_refinement":
			return 0.35;
		case "significant_transition":
			return 0.3;
		case "cursor_interaction":
			return 0.25;
		case "speech_alignment":
			return 0.2;
		case "priority_target":
			return 0.35;
		case "moderate_large_gap":
			return 0.18;
		case "temporary_ui":
			return 0.15;
		case "clip_boundary":
			return 0.08;
		default:
			return 0.05;
	}
}

/**
 * Cluster nearby high-value times into regions; pick peak as representative.
 */
export function buildEvidenceEventRegions(input: {
	frames: VisualEvidenceFrame[];
	changes?: VisualChange[];
	durationSec: number;
	queryClass: VideoMemoryQueryClass;
	priorityTimesSec?: number[];
	lateStart?: number;
}): EvidenceEventRegion[] {
	const duration = Math.max(0, input.durationSec);
	const nBuckets = coverageBucketCount(duration || 1);
	type Seed = { t: number; signals: EvidenceEventSignal[]; score: number };
	const seeds: Seed[] = [];

	for (const f of input.frames) {
		const signals: EvidenceEventSignal[] = [];
		if (f.reason === "change_refinement") signals.push("change_refinement");
		if (f.reason.startsWith("cursor_interaction")) signals.push("cursor_interaction");
		if (f.reason === "clip_boundary") signals.push("clip_boundary");
		if (!signals.length) continue;
		seeds.push({
			t: f.sourceTimeSec,
			signals,
			score: relevanceScore(f, {
				preferChangeBoundaries: true,
				preferLateWindow: false,
				lateStart: input.lateStart ?? duration * 0.5,
				priorityTimesSec: input.priorityTimesSec ?? [],
				queryClass: input.queryClass,
			}),
		});
	}

	for (const c of input.changes ?? []) {
		const gap = c.toSourceTimeSec - c.fromSourceTimeSec;
		if (c.classification === "significant" && gap >= 1.5) {
			seeds.push({
				t: (c.fromSourceTimeSec + c.toSourceTimeSec) / 2,
				signals: ["significant_transition"],
				score: 20 + c.score * 40,
			});
		} else if (c.classification === "moderate" && gap >= 3.0) {
			seeds.push({
				t: (c.fromSourceTimeSec + c.toSourceTimeSec) / 2,
				signals: ["moderate_large_gap"],
				score: 10 + c.score * 30,
			});
		}
	}

	for (const p of input.priorityTimesSec ?? []) {
		seeds.push({
			t: p,
			signals: ["speech_alignment", "priority_target"],
			score: 40,
		});
	}

	if (!seeds.length) return [];

	seeds.sort((a, b) => a.t - b.t);
	const clusters: Seed[][] = [];
	let cur: Seed[] = [seeds[0]!];
	for (let i = 1; i < seeds.length; i++) {
		const s = seeds[i]!;
		const prev = cur[cur.length - 1]!;
		if (s.t - prev.t <= REGION_MERGE_GAP_SEC) {
			cur.push(s);
		} else {
			clusters.push(cur);
			cur = [s];
		}
	}
	clusters.push(cur);

	return clusters.map((members, idx) => {
		const times = members.map((m) => m.t);
		const startSec = Math.min(...times);
		const endSec = Math.max(...times);
		let peak = members[0]!;
		for (const m of members) {
			if (m.score > peak.score) peak = m;
		}
		const signals = [...new Set(members.flatMap((m) => m.signals))];
		const confidence = Math.min(
			1,
			signals.reduce((n, s) => n + signalWeight(s), 0) + Math.min(0.2, members.length * 0.04),
		);
		const queryRelevance = Math.min(1, peak.score / 50);
		return {
			id: `evr_${idx}`,
			startSec,
			endSec,
			peakTimeSec: peak.t,
			signals,
			confidence,
			queryRelevance,
			novelty: 1,
			alreadyCovered: false,
			memberTimes: [...new Set(times.map((t) => Math.round(t * 1000) / 1000))],
			bucketIndex: bucketIndexForTime(peak.t, duration || 1, nBuckets),
		};
	});
}

export function markRegionsCovered(
	regions: EvidenceEventRegion[],
	selectedTimes: number[],
	coverRadiusSec = 1.6,
): EvidenceEventRegion[] {
	return regions.map((r) => {
		const covered = selectedTimes.some(
			(t) => t >= r.startSec - coverRadiusSec && t <= r.endSec + coverRadiusSec,
		);
		return {
			...r,
			alreadyCovered: covered,
			novelty: covered
				? Math.max(0, 1 - coverRadiusSec / Math.max(1, r.endSec - r.startSec + 1))
				: 1,
		};
	});
}

/** Prefer one peak frame per region; optionally before/after if span is large and distinct. */
export function representativeTimesForRegion(
	region: EvidenceEventRegion,
	available: VisualEvidenceFrame[],
): number[] {
	const peak =
		available.find((f) => Math.abs(f.sourceTimeSec - region.peakTimeSec) <= 0.35)?.sourceTimeSec ??
		region.peakTimeSec;
	const span = region.endSec - region.startSec;
	if (span < 2.0 || available.length < 2) return [peak];
	const before = available
		.filter((f) => f.sourceTimeSec >= region.startSec - 0.2 && f.sourceTimeSec < peak - 0.4)
		.sort((a, b) => b.sourceTimeSec - a.sourceTimeSec)[0];
	const after = available
		.filter((f) => f.sourceTimeSec <= region.endSec + 0.2 && f.sourceTimeSec > peak + 0.4)
		.sort((a, b) => a.sourceTimeSec - b.sourceTimeSec)[0];
	const out = [peak];
	// Only add before/after when signals are rich and span justifies it — still one region.
	if (region.signals.length >= 2 && span >= 3.5) {
		if (before) out.unshift(before.sourceTimeSec);
		if (after) out.push(after.sourceTimeSec);
	}
	return out.slice(0, 2); // at most 2 frames from one region into deepening budget
}

export type FrameAttachBudgetSplit = {
	coverageBudget: number;
	deepeningBudget: number;
	maxFrames: number;
	reason: string;
};

/**
 * Adaptive coverage vs deepening split for whole_media.
 * Coverage may not consume 100% when event regions exist (or may exist after extract).
 */
export function allocateCoverageDeepeningBudgets(input: {
	maxFrames: number;
	durationSec: number;
	bucketCount: number;
	eventRegionCount: number;
	queryClass: VideoMemoryQueryClass;
}): FrameAttachBudgetSplit {
	const maxFrames = Math.max(0, input.maxFrames);
	if (maxFrames <= 1) {
		return {
			coverageBudget: maxFrames,
			deepeningBudget: 0,
			maxFrames,
			reason: "tiny budget — coverage only",
		};
	}
	if (maxFrames === 2) {
		return {
			coverageBudget: 1,
			deepeningBudget: 1,
			maxFrames,
			reason: "2-frame split 1+1",
		};
	}

	const minDeepen =
		input.eventRegionCount > 0 ||
		input.queryClass === "editorial" ||
		input.queryClass === "cross_modal" ||
		input.queryClass === "visual"
			? Math.max(1, Math.floor(maxFrames * 0.3))
			: Math.max(0, Math.floor(maxFrames * 0.2));
	const maxCoverage = Math.max(2, maxFrames - minDeepen);
	const coverageBudget = Math.min(
		maxCoverage,
		Math.max(2, Math.min(input.bucketCount, Math.ceil(maxFrames * 0.65))),
	);
	const deepeningBudget = Math.max(0, maxFrames - coverageBudget);
	return {
		coverageBudget,
		deepeningBudget,
		maxFrames,
		reason: `adaptive coverage=${coverageBudget} deepen=${deepeningBudget} (regions=${input.eventRegionCount}, buckets=${input.bucketCount})`,
	};
}

export type RetrievalQualityDiagnostics = {
	coverageUtilization: number;
	deepeningUtilization: number;
	eventRegionDiversity: number;
	redundancyRatio: number;
	coverageBudget: number;
	deepeningBudget: number;
	eventRegionCount: number;
	relevanceCandidatesAvailable: number;
	relevanceCandidatesSelected: number;
	duplicateRegionFrames: number;
};

export function computeRetrievalQualityDiagnostics(input: {
	coverageBudget: number;
	deepeningBudget: number;
	coverageSelected: number;
	deepeningSelected: number;
	eventRegions: EvidenceEventRegion[];
	selectedTimes: number[];
	duplicateRegionFrames: number;
	relevanceCandidatesAvailable: number;
	relevanceCandidatesSelected: number;
}): RetrievalQualityDiagnostics {
	return {
		coverageUtilization:
			input.coverageBudget > 0 ? input.coverageSelected / input.coverageBudget : 0,
		deepeningUtilization:
			input.deepeningBudget > 0 ? input.deepeningSelected / input.deepeningBudget : 0,
		eventRegionDiversity:
			input.eventRegions.length > 0
				? new Set(
						input.selectedTimes
							.map(
								(t) =>
									input.eventRegions.find((r) => t >= r.startSec - 0.5 && t <= r.endSec + 0.5)?.id,
							)
							.filter(Boolean),
					).size / input.eventRegions.length
				: 0,
		redundancyRatio:
			input.selectedTimes.length > 0 ? input.duplicateRegionFrames / input.selectedTimes.length : 0,
		coverageBudget: input.coverageBudget,
		deepeningBudget: input.deepeningBudget,
		eventRegionCount: input.eventRegions.length,
		relevanceCandidatesAvailable: input.relevanceCandidatesAvailable,
		relevanceCandidatesSelected: input.relevanceCandidatesSelected,
		duplicateRegionFrames: input.duplicateRegionFrames,
	};
}
