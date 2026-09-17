/**
 * Source → programme mapping for caption cues (trim + speed aware).
 */

import { sourceSpanToTimelineSpans } from "../../../src/lib/ai-edition/captions/cues";
import {
	getCaptionSettings,
	resolveCaptionLane,
} from "../../../src/lib/ai-edition/captions/settings";
import { resolvePlaybackSegments } from "../../../src/lib/ai-edition/document/timeline";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { lanePlacements } from "../../../src/lib/ai-edition/timeline/aggregated-transcript";
import { removedRawSpans } from "../../../src/lib/ai-edition/timeline/programme-time";
import { expectedProgrammeDurationForSpeed } from "../editVerify/speedMath";

export interface ProgrammeSpan {
	startSec: number;
	endSec: number;
}

interface SpeedRegion {
	startSec?: number;
	endSec?: number;
	speed?: number;
}

function readSpeedRegions(doc: AxcutDocument): SpeedRegion[] {
	const legacy = doc.legacyEditor as Record<string, unknown> | null | undefined;
	const raw = legacy?.speedRegions;
	return Array.isArray(raw) ? (raw as SpeedRegion[]) : [];
}

function speedAt(mid: number, regions: SpeedRegion[]): number {
	for (const r of regions) {
		if (
			typeof r.startSec === "number" &&
			typeof r.endSec === "number" &&
			typeof r.speed === "number" &&
			r.speed > 0 &&
			mid >= r.startSec &&
			mid < r.endSec
		) {
			return r.speed;
		}
	}
	return 1;
}

/** Programme duration of [start,end) under speed regions (virtual/timeline seconds in). */
export function compressedDurationSec(
	startSec: number,
	endSec: number,
	speedRegions: SpeedRegion[],
): number {
	if (!(endSec > startSec)) return 0;
	if (speedRegions.length === 0) return endSec - startSec;
	const cuts = new Set<number>([startSec, endSec]);
	for (const r of speedRegions) {
		if (typeof r.startSec === "number") {
			cuts.add(Math.max(startSec, Math.min(endSec, r.startSec)));
		}
		if (typeof r.endSec === "number") {
			cuts.add(Math.max(startSec, Math.min(endSec, r.endSec)));
		}
	}
	const points = [...cuts].sort((a, b) => a - b);
	let out = 0;
	for (let i = 0; i < points.length - 1; i++) {
		const a = points[i]!;
		const b = points[i + 1]!;
		if (b <= a) continue;
		const s = speedAt((a + b) / 2, speedRegions);
		out += expectedProgrammeDurationForSpeed(b - a, s);
	}
	return out;
}

/**
 * Map virtual timeline [start,end) into compressed programme time,
 * where programme clock starts at 0 for virtual 0.
 */
export function virtualSpanToProgrammeSpan(
	startSec: number,
	endSec: number,
	speedRegions: SpeedRegion[],
): ProgrammeSpan {
	const origin = compressedDurationSec(0, Math.max(0, startSec), speedRegions);
	const dur = compressedDurationSec(startSec, endSec, speedRegions);
	return { startSec: origin, endSec: origin + dur };
}

/** True when the source midpoint still appears in playback segments. */
export function sourceInstantSurvivesPlayback(
	document: AxcutDocument,
	assetId: string,
	sourceSec: number,
): boolean {
	const segs = resolvePlaybackSegments(document.timeline.clips, document.timeline.trimRanges);
	for (const s of segs) {
		if (s.assetId !== assetId) continue;
		const end = s.sourceEndSec ?? s.sourceStartSec;
		if (sourceSec >= s.sourceStartSec - 1e-6 && sourceSec < end - 1e-9) return true;
		if (Math.abs(sourceSec - end) < 1e-6 && sourceSec >= s.sourceStartSec) return true;
	}
	return false;
}

export function mapSourceSpanThroughDocument(
	document: AxcutDocument,
	assetId: string,
	sourceStartSec: number,
	sourceEndSec: number,
): ProgrammeSpan[] {
	const mid = (sourceStartSec + sourceEndSec) / 2;
	if (!sourceInstantSurvivesPlayback(document, assetId, mid)) {
		return [];
	}
	const settings = getCaptionSettings(document);
	const placements = lanePlacements(
		resolveCaptionLane(document, settings),
		document.timeline.clips,
		document.audioTracks ?? [],
		removedRawSpans(document.timeline.clips, document.timeline.trimRanges),
	);
	const virtual = sourceSpanToTimelineSpans(assetId, sourceStartSec, sourceEndSec, placements);
	const speeds = readSpeedRegions(document);
	return virtual
		.map((span) => virtualSpanToProgrammeSpan(span.startSec, span.endSec, speeds))
		.filter((s) => s.endSec > s.startSec + 1e-4);
}

export function wordsSurvivingTrims(
	document: AxcutDocument,
	assetId: string,
	words: Array<{ sourceStartSec: number; sourceEndSec: number }>,
): boolean[] {
	return words.map((w) => {
		const mid = (w.sourceStartSec + w.sourceEndSec) / 2;
		return sourceInstantSurvivesPlayback(document, assetId, mid);
	});
}
