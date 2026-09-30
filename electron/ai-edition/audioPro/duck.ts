/**
 * Auto-ducking: music dips under speech.
 *
 * The native mixer plays each track at one fixed gain, so the dips are baked
 * into a copy of the music file: the speech moments are mapped into the
 * file's own time (through exactly the placement the mixer uses), and a
 * smooth gain envelope — down a little before each phrase, back up after it —
 * is applied with ffmpeg. The track then plays the copy; the original file is
 * untouched and "undo" switches back. Preview and export play the same file.
 */

import { existsSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { createId } from "../../../src/lib/ai-edition/document/ids";
import { collapseTracksToPills, trackGroupId } from "../../../src/lib/ai-edition/document/audioTracks";
import { projectRawTimelineSecToPlayback } from "../../../src/lib/ai-edition/document/timeline";
import type { AxcutAsset, AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { buildSceneDescription } from "../../../src/native/sceneDescription";
import { runProcess } from "../mediaStudio";

export type Interval = { start: number; end: number };

export const DEFAULT_DUCK_DB = 12;
/** Gain starts dropping this long before a phrase, and comes back over RELEASE after it. */
export const DUCK_ATTACK_SEC = 0.25;
export const DUCK_RELEASE_SEC = 0.5;

/** Sort, drop empties, and join intervals closer than `gapSec` (a breath doesn't un-duck). */
export function mergeIntervals(list: Interval[], gapSec = 0.6): Interval[] {
	const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
	const out: Interval[] = [];
	for (const i of sorted) {
		const last = out[out.length - 1];
		if (last && i.start - last.end <= gapSec) last.end = Math.max(last.end, i.end);
		else out.push({ ...i });
	}
	return out;
}

type SpeechSource = Map<string, Interval[]>; // assetId → speech in the asset's own (source) time

/** Speech from the transcripts: every `speech` segment, per asset. */
export function transcriptSpeech(document: AxcutDocument): SpeechSource {
	const out: SpeechSource = new Map();
	const all = [...(document.transcripts ?? []), ...(document.transcript ? [document.transcript] : [])];
	for (const t of all) {
		const list = out.get(t.assetId) ?? [];
		for (const s of t.segments ?? []) if (s.kind === "speech") list.push({ start: s.startSec, end: s.endSec });
		out.set(t.assetId, list);
	}
	return out;
}

/**
 * Speech on the programme clock (seconds of the finished video): the
 * recording's speech through the clip layout, trims and speed, plus every
 * voiceover track's whole span.
 */
export function speechPlaybackIntervals(document: AxcutDocument, speech: SpeechSource): Interval[] {
	const clips = document.timeline.clips;
	const trims = document.timeline.trimRanges;
	const speed = (
		((document.legacyEditor as Record<string, unknown> | null)?.speedRegions as
			| Array<{ startMs: number; endMs: number; speed: number }>
			| undefined) ?? []
	).filter((r) => Number.isFinite(r.speed) && r.speed > 0);
	const out: Interval[] = [];
	for (const clip of clips) {
		const srcStart = clip.sourceStartSec;
		const srcEnd = clip.sourceEndSec ?? srcStart + (clip.timelineEndSec - clip.timelineStartSec);
		for (const s of speech.get(clip.assetId) ?? []) {
			const a = Math.max(s.start, srcStart);
			const b = Math.min(s.end, srcEnd);
			if (b <= a) continue;
			const rawA = clip.timelineStartSec + (a - srcStart);
			const rawB = clip.timelineStartSec + (b - srcStart);
			const pa = projectRawTimelineSecToPlayback(clips, trims, rawA, speed);
			const pb = projectRawTimelineSecToPlayback(clips, trims, rawB, speed);
			if (pb > pa) out.push({ start: pa, end: pb });
		}
	}
	for (const pill of collapseTracksToPills(document.audioTracks ?? [])) {
		if (pill.kind !== "voiceover" || pill.muted) continue;
		const pa = projectRawTimelineSecToPlayback(clips, trims, pill.startMs / 1000, speed);
		const pb = projectRawTimelineSecToPlayback(clips, trims, pill.endMs / 1000, speed);
		if (pb > pa) out.push({ start: pa, end: pb });
	}
	return mergeIntervals(out);
}

/**
 * Speech mapped into a music file's own time, through the placement the mixer
 * uses for that file (the scene's audio entries). Null when the file isn't
 * playing anywhere.
 */
export function speechInFileTime(document: AxcutDocument, filePath: string, speech: Interval[]): Interval[] | null {
	const entries = buildSceneDescription(document).audioTracks.filter((e) => e.path === filePath);
	if (entries.length === 0) return null;
	const out: Interval[] = [];
	for (const e of entries) {
		const len = e.trimEndSec - e.trimStartSec;
		for (const s of speech) {
			const a = Math.max(s.start, e.startSec);
			const b = Math.min(s.end, e.startSec + len);
			if (b > a) out.push({ start: e.trimStartSec + (a - e.startSec), end: e.trimStartSec + (b - e.startSec) });
		}
	}
	return mergeIntervals(out, 0);
}

/**
 * ffmpeg `volume` expression (per-frame) for the dips: 1 outside speech,
 * `10^(-db/20)` inside, with linear ramps of `attack` before and `release`
 * after each interval. Overlapping ramps take the deeper dip.
 */
export function duckGainExpr(intervals: Interval[], amountDb: number, attack = DUCK_ATTACK_SEC, release = DUCK_RELEASE_SEC): string {
	const g = 10 ** (-Math.abs(amountDb) / 20);
	if (intervals.length === 0) return "1";
	const f = (n: number) => Number(n.toFixed(3));
	const terms = intervals.map(
		(i) => `clip((t-${f(i.start - attack)})/${f(attack)},0,1)*clip((${f(i.end + release)}-t)/${f(release)},0,1)`,
	);
	// max() takes two arguments: fold them.
	const depth = terms.reduce((acc, term) => `max(${acc},${term})`);
	return `1-${f(1 - g)}*${depth}`;
}

/** Speech found by level when there is no transcript: the parts that are not silence. */
export async function speechBySilence(
	ffmpegPath: string,
	path: string,
	durationSec: number,
	signal?: AbortSignal,
): Promise<Interval[]> {
	const res = await runProcess(
		ffmpegPath,
		["-nostdin", "-hide_banner", "-i", path, "-vn", "-af", "silencedetect=noise=-35dB:d=0.45", "-f", "null", "-"],
		{ timeoutMs: 300_000, signal },
	);
	const silences: Interval[] = [];
	let open: number | null = null;
	for (const line of res.stderr.split("\n")) {
		const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
		if (s) open = Math.max(0, Number(s[1]));
		const e = /silence_end:\s*([\d.]+)/.exec(line);
		if (e && open !== null) {
			silences.push({ start: open, end: Number(e[1]) });
			open = null;
		}
	}
	if (open !== null) silences.push({ start: open, end: durationSec });
	const speech: Interval[] = [];
	let cursor = 0;
	for (const s of silences) {
		if (s.start > cursor) speech.push({ start: cursor, end: s.start });
		cursor = Math.max(cursor, s.end);
	}
	if (durationSec > cursor) speech.push({ start: cursor, end: durationSec });
	return mergeIntervals(speech);
}

/** Write the ducked copy of a music file. */
export async function bakeDuckedAudio(input: {
	ffmpegPath: string;
	sourcePath: string;
	speechInFile: Interval[];
	amountDb: number;
	outDir: string;
	signal?: AbortSignal;
}): Promise<string> {
	mkdirSync(input.outDir, { recursive: true });
	const stem = basename(input.sourcePath, extname(input.sourcePath)).replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40) || "music";
	const out = join(input.outDir, `${stem}-ducked-${Date.now().toString(36)}.m4a`);
	const expr = duckGainExpr(input.speechInFile, input.amountDb);
	const res = await runProcess(
		input.ffmpegPath,
		[
			"-y",
			"-nostdin",
			"-hide_banner",
			"-i",
			input.sourcePath,
			"-vn",
			"-af",
			`volume='${expr}':eval=frame`,
			"-c:a",
			"aac",
			"-b:a",
			"192k",
			out,
		],
		{ timeoutMs: 600_000, signal: input.signal },
	);
	if (res.code !== 0 || !existsSync(out)) {
		throw new Error(`Could not duck the music: ${(res.stderr || "").slice(-400)}`);
	}
	return out;
}

export type DuckPlanItem = {
	trackId: string;
	label: string;
	/** The file the track should duck FROM (the original, even if it is already ducked). */
	sourceAsset: AxcutAsset;
	skipped?: string;
};

/** Which music tracks to duck (all, or one), each resolved back to its original file. */
export function planDuck(document: AxcutDocument, trackId?: string): DuckPlanItem[] {
	const pills = collapseTracksToPills(document.audioTracks ?? []).filter((p) => p.kind !== "voiceover");
	const chosen = trackId ? pills.filter((p) => trackGroupId(p) === trackId || p.id === trackId) : pills;
	const assets = new Map(document.assets.map((a) => [a.id, a]));
	return chosen.flatMap((pill) => {
		const current = assets.get(pill.assetId);
		if (!current) return [];
		const original = current.derived?.fromAssetId ? (assets.get(current.derived.fromAssetId) ?? current) : current;
		return [
			{
				trackId: trackGroupId(pill),
				label: pill.label || original.label,
				sourceAsset: original,
				...(pill.loop ? { skipped: "it loops — turn Loop off (or use a longer music file) to duck it" } : {}),
				...(pill.muted ? { skipped: "it is muted" } : {}),
			},
		];
	});
}

/** Point a track at a (new) asset, every fragment. */
export function swapTrackAsset(document: AxcutDocument, trackId: string, assetId: string): AxcutDocument {
	return {
		...document,
		audioTracks: (document.audioTracks ?? []).map((t) => (trackGroupId(t) === trackId ? { ...t, assetId } : t)),
	};
}

/** Drop derived (ducked / cleaned) audio assets nothing plays any more. */
export function dropUnusedDerivedAssets(document: AxcutDocument): AxcutDocument {
	const used = new Set([...document.timeline.clips.map((c) => c.assetId), ...(document.audioTracks ?? []).map((t) => t.assetId)]);
	const assets = document.assets.filter((a) => !a.derived || used.has(a.id));
	return assets.length === document.assets.length ? document : { ...document, assets };
}

export function makeDuckedAsset(original: AxcutAsset, path: string, amountDb: number): AxcutAsset {
	return {
		id: createId("asset"),
		kind: "audio",
		label: `${original.label} (ducked)`,
		originalPath: path,
		durationSec: original.durationSec,
		cameraTrack: null,
		derived: { fromAssetId: original.id, kind: "duck", amountDb },
	} as AxcutAsset;
}
