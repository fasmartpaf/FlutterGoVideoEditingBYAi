/**
 * Put a rendered motion clip on the timeline as its own full-frame clip:
 * at the start, at the end, next to a given clip, or at a playback time —
 * in which case the cut is moved to the nearest pause in the speech so the
 * graphic never lands mid-word.
 */

import { existsSync } from "node:fs";
import { createId } from "../../../src/lib/ai-edition/document/ids";
import { insertClip, resolvePlaybackSegments, splitClip } from "../../../src/lib/ai-edition/document/timeline";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";

export type MotionPlacement =
	| "none"
	| "start"
	| "end"
	| { beforeClipId: string }
	| { afterClipId: string }
	| { atSec: number };

export interface PlacedMotionClip {
	document: AxcutDocument;
	assetId: string;
	clipId: string | null;
	/** Where it actually went, in plain words (for the receipt / the agent). */
	where: string;
	/** For atSec: the playback time the cut was snapped to. */
	snappedToSec?: number;
}

/** Search window around the requested time for a pause in the speech. */
const SNAP_WINDOW_SEC = 2;
/** Gaps shorter than this are breaths between words, not pauses. */
const MIN_PAUSE_SEC = 0.15;
/** Closer than this to a clip edge → insert at the edge instead of splitting. */
const EDGE_SEC = 0.35;

/**
 * Nearest source-time point between two words (or the requested point when
 * there is no transcript), within ±SNAP_WINDOW_SEC. Prefers the middle of
 * the widest nearby gap so the cut sits in silence.
 */
export function snapToSpeechPause(
	document: AxcutDocument,
	assetId: string,
	sourceSec: number,
	bounds: { min: number; max: number },
): number {
	const transcript = document.transcripts?.find((t) => t.assetId === assetId);
	const words = [...(transcript?.words ?? [])].sort((a, b) => a.startSec - b.startSec);
	if (words.length === 0) return sourceSec;
	let best: { at: number; score: number } | null = null;
	for (let i = 0; i <= words.length; i++) {
		const gapStart = i === 0 ? bounds.min : words[i - 1]!.endSec;
		const gapEnd = i === words.length ? bounds.max : words[i]!.startSec;
		const width = gapEnd - gapStart;
		if (width <= 0) continue;
		// Already in a real pause → keep the requested point.
		if (sourceSec >= gapStart && sourceSec <= gapEnd && width >= MIN_PAUSE_SEC) return sourceSec;
		// The point of this gap closest to the request, kept off the word edges
		// in a long pause; the middle of a short one.
		const margin = Math.min(width / 2, 0.15);
		const at = Math.min(gapEnd - margin, Math.max(gapStart + margin, sourceSec));
		const distance = Math.abs(at - sourceSec);
		if (distance > SNAP_WINDOW_SEC) continue;
		// A breath between two words is not a pause — only use it as a last resort.
		const score = distance + (width < MIN_PAUSE_SEC ? SNAP_WINDOW_SEC : 0);
		if (!best || score < best.score) best = { at, score };
	}
	return best ? Math.min(bounds.max, Math.max(bounds.min, best.at)) : sourceSec;
}

function clipIndex(document: AxcutDocument, clipId: string): number {
	return document.timeline.clips.findIndex((c) => c.id === clipId);
}

export function placeMotionClip(
	document: AxcutDocument,
	input: { mp4Path: string; durationSec: number; label: string },
	place: MotionPlacement,
): PlacedMotionClip {
	if (!existsSync(input.mp4Path)) throw new Error(`motion clip not found: ${input.mp4Path}`);
	const assetId = createId("asset");
	let next: AxcutDocument = {
		...document,
		assets: [
			...document.assets,
			{
				id: assetId,
				kind: "video" as const,
				label: input.label,
				originalPath: input.mp4Path,
				durationSec: input.durationSec,
				cameraTrack: null,
			} as AxcutDocument["assets"][number],
		],
		project: { ...document.project, updatedAt: new Date().toISOString() },
	};
	if (place === "none") {
		return { document: next, assetId, clipId: null, where: "added to project media (not on the timeline)" };
	}

	const reason = `Motion graphic: ${input.label}`;
	const insertAt = (index: number, where: string, snappedToSec?: number): PlacedMotionClip => {
		const before = new Set(next.timeline.clips.map((c) => c.id));
		next = insertClip(next, assetId, index, "agent", reason);
		const clipId = next.timeline.clips.find((c) => !before.has(c.id))?.id ?? null;
		return { document: next, assetId, clipId, where, snappedToSec };
	};

	if (place === "start") return insertAt(0, "at the start");
	if (place === "end") return insertAt(next.timeline.clips.length, "at the end");
	if ("beforeClipId" in place) {
		const i = clipIndex(next, place.beforeClipId);
		if (i < 0) throw new Error(`Unknown clip: ${place.beforeClipId}`);
		return insertAt(i, `before clip ${place.beforeClipId}`);
	}
	if ("afterClipId" in place) {
		const i = clipIndex(next, place.afterClipId);
		if (i < 0) throw new Error(`Unknown clip: ${place.afterClipId}`);
		return insertAt(i + 1, `after clip ${place.afterClipId}`);
	}

	// atSec: playback time on the finished programme (trims applied).
	const t = Math.max(0, place.atSec);
	const segments = resolvePlaybackSegments(next.timeline.clips, next.timeline.trimRanges);
	if (segments.length === 0) return insertAt(0, "at the start");
	const seg = segments.find((s) => t >= s.timelineStartSec && t < s.timelineEndSec);
	if (!seg) return insertAt(next.timeline.clips.length, "at the end");
	const clipId = seg.id.replace(/_seg\d+$/, "");
	const index = clipIndex(next, clipId);
	const clip = next.timeline.clips[index];
	if (!clip) return insertAt(next.timeline.clips.length, "at the end");
	const clipEnd = clip.sourceEndSec ?? clip.sourceStartSec;
	const requested = seg.sourceStartSec + (t - seg.timelineStartSec);
	const snapped = snapToSpeechPause(next, clip.assetId, requested, {
		min: Math.max(clip.sourceStartSec, seg.sourceStartSec),
		max: Math.min(clipEnd, seg.sourceEndSec ?? clipEnd),
	});
	const snappedPlayback = seg.timelineStartSec + (snapped - seg.sourceStartSec);
	if (snapped - clip.sourceStartSec < EDGE_SEC) return insertAt(index, `before clip ${clipId}`, snappedPlayback);
	if (clipEnd - snapped < EDGE_SEC) return insertAt(index + 1, `after clip ${clipId}`, snappedPlayback);
	next = splitClip(next, clipId, snapped, "agent");
	return insertAt(index + 1, `at ${snappedPlayback.toFixed(1)}s (in a pause in the speech)`, snappedPlayback);
}
