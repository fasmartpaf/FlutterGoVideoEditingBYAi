/**
 * Direct TRIM / SHORTEN document mutations (0 LLM).
 * User-facing times are CURRENT PROGRAMME (compressed) time.
 * ZOOM is frozen — do not touch zoom paths.
 */

import {
	projectPlaybackSecToRawTimelineSec,
	resolvePlaybackSegments,
} from "../../../src/lib/ai-edition/document/timeline";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { executeAgentTool } from "../agent-tools";
import type { LocalEditorialRequestV1 } from "./types";

export function programmeDurationSec(doc: AxcutDocument): number {
	const segs = resolvePlaybackSegments(doc.timeline.clips, doc.timeline.trimRanges ?? []);
	if (segs.length === 0) {
		const clips = doc.timeline.clips;
		if (clips.length === 0) return 0;
		return Math.max(...clips.map((c) => c.timelineEndSec));
	}
	return Math.max(...segs.map((s) => s.timelineEndSec));
}

/** RAW virtual ruler length (trims still occupy space) — matches V4Timeline `total`. */
export function rawTimelineDurationSec(doc: AxcutDocument): number {
	const clips = doc.timeline.clips;
	if (clips.length === 0) return 0;
	return Math.max(...clips.map((c) => c.timelineEndSec));
}

/**
 * Map trim-compressed playback (semantic WHERE / Chat programme) onto the RAW
 * ruler coordinate that Zoom `addZoom` / playhead / `startMs` use.
 */
export function playbackPointToRawTimelineSec(
	doc: AxcutDocument,
	playbackSec: number,
): number | null {
	return projectPlaybackSecToRawTimelineSec(
		doc.timeline.clips,
		doc.timeline.trimRanges ?? [],
		playbackSec,
	);
}

/**
 * Convert a compressed playback window into RAW Zoom args (null if unmappable).
 * Clamps to the playable programme span so a window that overhangs the end still
 * converts — never returns compressed seconds as if they were RAW.
 */
export function playbackRangeToZoomRawRange(
	doc: AxcutDocument,
	playbackStartSec: number,
	playbackEndSec: number,
): { startSec: number; endSec: number } | null {
	const progDur = programmeDurationSec(doc);
	if (!(progDur > 1e-9)) return null;
	const startP = Math.min(Math.max(0, playbackStartSec), progDur);
	const endP = Math.min(Math.max(startP + 1e-3, playbackEndSec), progDur);
	const startSec = playbackPointToRawTimelineSec(doc, startP);
	const endSec = playbackPointToRawTimelineSec(doc, endP);
	if (startSec == null || endSec == null) return null;
	if (!(endSec > startSec)) return null;
	return { startSec, endSec };
}

function originalClipId(segmentId: string): string {
	const m = segmentId.match(/^(.*)_seg\d+$/);
	return m?.[1] ?? segmentId;
}

/** Map a programme-time point onto source media time (null if outside playable span). */
export function programmePointToSourceSec(doc: AxcutDocument, progSec: number): number | null {
	const segs = resolvePlaybackSegments(doc.timeline.clips, doc.timeline.trimRanges ?? []);
	for (const s of segs) {
		if (progSec >= s.timelineStartSec - 1e-6 && progSec <= s.timelineEndSec + 1e-6) {
			return s.sourceStartSec + (progSec - s.timelineStartSec);
		}
	}
	return null;
}

/** Map current-programme span → source trim windows. */
export function programmeRangeToSourceTrims(
	doc: AxcutDocument,
	progStartSec: number,
	progEndSec: number,
): Array<{ assetId: string; clipId: string; sourceStartSec: number; sourceEndSec: number }> {
	const segs = resolvePlaybackSegments(doc.timeline.clips, doc.timeline.trimRanges ?? []);
	const out: Array<{
		assetId: string;
		clipId: string;
		sourceStartSec: number;
		sourceEndSec: number;
	}> = [];
	for (const s of segs) {
		const overlapStart = Math.max(progStartSec, s.timelineStartSec);
		const overlapEnd = Math.min(progEndSec, s.timelineEndSec);
		if (!(overlapEnd > overlapStart + 0.05)) continue;
		const srcStart = s.sourceStartSec + (overlapStart - s.timelineStartSec);
		const srcEnd = s.sourceStartSec + (overlapEnd - s.timelineStartSec);
		out.push({
			assetId: s.assetId,
			clipId: originalClipId(s.id),
			sourceStartSec: srcStart,
			sourceEndSec: srcEnd,
		});
	}
	return out;
}

export function resolveProgrammeRange(
	doc: AxcutDocument,
	request: LocalEditorialRequestV1,
): { startSec: number; endSec: number } | { error: string } {
	const dur = programmeDurationSec(doc);
	if (!(dur > 0.05)) {
		return { error: "There isn't enough timeline media to trim yet." };
	}
	const slot = request.range;
	if (!slot) {
		return { error: "I need a time range to trim (for example “remove from 5s to 8s”)." };
	}
	let startSec = slot.startSec;
	let endSec = slot.endSec;
	if (slot.relativeEdge === "first") {
		startSec = 0;
		endSec = Math.min(slot.endSec, dur);
	} else if (slot.relativeEdge === "last") {
		const len = slot.endSec;
		endSec = dur;
		startSec = Math.max(0, dur - len);
	}
	startSec = Math.max(0, startSec);
	endSec = Math.min(dur, endSec);
	if (!(endSec > startSec + 0.05)) {
		return {
			error: `That range (${startSec.toFixed(1)}s–${endSec.toFixed(1)}s) is outside the current ${dur.toFixed(1)}s programme.`,
		};
	}
	return { startSec, endSec };
}

function applySourceTrims(
	doc: AxcutDocument,
	ranges: Array<{ assetId: string; clipId: string; sourceStartSec: number; sourceEndSec: number }>,
): { document: AxcutDocument; mutated: boolean; summaries: string[] } {
	let next = doc;
	const summaries: string[] = [];
	let added = 0;
	for (const r of ranges) {
		if (!(r.sourceEndSec > r.sourceStartSec + 0.05)) continue;
		const result = executeAgentTool(
			next,
			"addTrim",
			JSON.stringify({
				assetId: r.assetId,
				clipId: r.clipId,
				startSec: r.sourceStartSec,
				endSec: r.sourceEndSec,
			}),
			{ editsAllowed: true },
		);
		if (result.ok && result.document) {
			next = result.document;
			added += 1;
			if (result.summary) summaries.push(result.summary);
		}
	}
	return { document: next, mutated: added > 0, summaries };
}

export function applyDirectRemoveRange(args: {
	document: AxcutDocument;
	request: LocalEditorialRequestV1;
}): {
	document: AxcutDocument;
	mutated: boolean;
	userFacingText: string;
	families: string[];
} {
	const resolved = resolveProgrammeRange(args.document, args.request);
	if ("error" in resolved) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: resolved.error,
			families: [],
		};
	}
	const { startSec, endSec } = resolved;
	const sourceRanges = programmeRangeToSourceTrims(args.document, startSec, endSec);
	if (sourceRanges.length === 0) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: `I couldn't map ${startSec.toFixed(1)}s–${endSec.toFixed(1)}s onto playable programme media to remove.`,
			families: [],
		};
	}
	const applied = applySourceTrims(args.document, sourceRanges);
	if (!applied.mutated) {
		return {
			document: args.document,
			mutated: false,
			userFacingText:
				applied.summaries[0] ??
				`I couldn't remove ${startSec.toFixed(1)}s–${endSec.toFixed(1)}s (the range may already be gone).`,
			families: [],
		};
	}
	const afterDur = programmeDurationSec(applied.document);
	return {
		document: applied.document,
		mutated: true,
		userFacingText: `I removed ${startSec.toFixed(1)}s–${endSec.toFixed(1)}s from the current timeline (programme is now ${afterDur.toFixed(1)}s).`,
		families: ["trim"],
	};
}

export function applyDirectTrimAdjust(args: {
	document: AxcutDocument;
	request: LocalEditorialRequestV1;
}): {
	document: AxcutDocument;
	mutated: boolean;
	userFacingText: string;
	families: string[];
} {
	const trims = args.document.timeline.trimRanges ?? [];
	if (trims.length === 0) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: "There isn't a cut on the timeline to adjust.",
			families: [],
		};
	}
	const last = trims[trims.length - 1]!;
	const n = args.request.rawText.toLowerCase();
	let srcStart = last.startSec;
	let srcEnd = last.endSec;
	const half = 0.5;
	const bit = 0.35;
	const aboutPause = /\bpause|silence\b/.test(n);
	if (
		/\bearlier\b|\bsooner\b|\bstart\b.*\bearlier\b|\bhalf\s+(?:a\s+)?sec(?:ond)?\s+earlier\b/.test(
			n,
		)
	) {
		srcStart = Math.max(0, srcStart - (/\bhalf\b/.test(n) ? half : bit));
	}
	if (/\blater\b|\bend\b.*\blater\b|\bhalf\s+(?:a\s+)?sec(?:ond)?\s+later\b/.test(n)) {
		srcEnd = srcEnd + (/\bhalf\b/.test(n) ? half : bit);
	}
	if (/\bshorter\b|\bless\b|\btighter\b/.test(n) && !aboutPause) {
		const mid = (srcStart + srcEnd) / 2;
		const halfLen = Math.max(0.15, (srcEnd - srcStart) / 2 - 0.25);
		srcStart = mid - halfLen;
		srcEnd = mid + halfLen;
	}
	if (aboutPause && /\b(?:shorter|little\s+shorter|a\s+little\s+shorter|tighter)\b/.test(n)) {
		srcStart = Math.max(0, srcStart - 0.25);
		srcEnd = srcEnd + 0.25;
	}
	if (
		aboutPause &&
		/\b(?:keep\s+(?:a\s+)?bit\s+more|longer|more\s+of\s+(?:that\s+)?(?:pause|silence)|a\s+little\s+longer)\b/.test(
			n,
		)
	) {
		const mid = (srcStart + srcEnd) / 2;
		const halfLen = Math.max(0.12, (srcEnd - srcStart) / 2 - 0.25);
		srcStart = mid - halfLen;
		srcEnd = mid + halfLen;
	}
	if (!aboutPause && /\blonger\b|\bmore\b/.test(n) && !/\bearlier|later|start|end\b/.test(n)) {
		srcStart = Math.max(0, srcStart - 0.25);
		srcEnd = srcEnd + 0.25;
	}
	if (Math.abs(srcStart - last.startSec) < 0.02 && Math.abs(srcEnd - last.endSec) < 0.02) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: "I need a clearer adjustment (for example “start half a second earlier”).",
			families: [],
		};
	}
	if (!(srcEnd > srcStart + 0.05)) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: "That adjustment would collapse the cut — try a smaller change.",
			families: [],
		};
	}

	const removed = executeAgentTool(
		args.document,
		"removeTrim",
		JSON.stringify({ trimRangeId: last.id }),
		{ editsAllowed: true },
	);
	const base = removed.ok && removed.document ? removed.document : args.document;
	const applied = applySourceTrims(base, [
		{
			assetId: last.assetId,
			clipId:
				last.clipId ??
				args.document.timeline.clips.find((c) => c.assetId === last.assetId)?.id ??
				"clip_1",
			sourceStartSec: srcStart,
			sourceEndSec: srcEnd,
		},
	]);
	if (!applied.mutated) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: "I couldn't adjust that cut on the current programme.",
			families: [],
		};
	}
	return {
		document: applied.document,
		mutated: true,
		userFacingText: `I updated that cut to source ${srcStart.toFixed(1)}s–${srcEnd.toFixed(1)}s.`,
		families: ["trim"],
	};
}
