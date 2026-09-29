/**
 * Understand a recording once, save it, reuse it.
 *
 * When a project is opened or a video imported, the app analyses the primary
 * recording in the background (one ffmpeg pass for the picture, one for the
 * sound) and saves a small summary next to the project's generated media:
 * where the screen changes, where it sits still (loading, waiting), where
 * nobody talks, a few key frames and the video's colours. Every later turn —
 * and the "Understand the recording" stage — reads that summary in one call
 * instead of re-watching the video. The summary is tied to the file's path,
 * size and modification time, so a changed recording is analysed again.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AxcutDocument } from "../../src/lib/ai-edition/schema";
import { resolveFfmpeg } from "../media/audioPeaks";
import { resolveGeneratedGraphicsDir } from "./agentToolMedia";
import { probeMediaDurationSec, runProcess } from "./mediaStudio";
import { deriveBrandKitFromVideo, paletteSourceVideo } from "./motionStudio/videoPalette";

export const VIDEO_SUMMARY_VERSION = 1;

export interface VideoSummary {
	version: number;
	source: { path: string; durationSec: number };
	builtAt: string;
	/** Seconds where the picture changes a lot (new page, dialog, tab) — natural section boundaries. */
	screenChanges: number[];
	/** Stretches where nothing on screen moves (loading, waiting, reading) — candidates to speed up or cut. */
	stillStretches: Array<[number, number]>;
	/** Stretches with no speech or sound. */
	silences: Array<[number, number]>;
	hasAudio: boolean;
	/** A few representative frames the agent can Read. */
	keyFrames: Array<{ atSec: number; path: string }>;
	/** Colours read from the recording (what motion graphics use when no brand kit is set). */
	colours: { primary: string; secondary: string; background: string; text: string } | null;
}

/** Seconds of stillness / silence worth reporting. */
const MIN_STILL_SEC = 1.5;
const MIN_SILENCE_SEC = 0.8;
const MAX_KEY_FRAMES = 6;
const ANALYSIS_TIMEOUT_MS = 10 * 60_000;

const round = (n: number) => Math.round(n * 100) / 100;

/** Run ffmpeg and hand every stderr line to `onLine` (its analysis filters log there). */
function scanFfmpeg(ffmpegPath: string, args: string[], onLine: (line: string) => void, signal?: AbortSignal): Promise<number | null> {
	return new Promise((resolve, reject) => {
		const child = spawn(ffmpegPath, ["-hide_banner", "-nostats", ...args], {
			stdio: ["ignore", "ignore", "pipe"],
			windowsHide: true,
		});
		let buf = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			buf += chunk;
			let i: number;
			while ((i = buf.indexOf("\n")) >= 0) {
				onLine(buf.slice(0, i));
				buf = buf.slice(i + 1);
			}
		});
		const kill = () => child.kill("SIGKILL");
		const timer = setTimeout(kill, ANALYSIS_TIMEOUT_MS);
		signal?.addEventListener("abort", kill, { once: true });
		child.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", kill);
			if (buf) onLine(buf);
			if (signal?.aborted) reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
			else resolve(code);
		});
	});
}

/** Pair "…_start: t" / "…_end: t" log lines into ranges. */
function collectRanges(lines: string[], startKey: RegExp, endKey: RegExp, durationSec: number, minSec: number): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	let open: number | null = null;
	for (const line of lines) {
		const s = startKey.exec(line);
		if (s) open = Number(s[1]);
		const e = endKey.exec(line);
		if (e && open !== null) {
			out.push([open, Number(e[1])]);
			open = null;
		}
	}
	if (open !== null) out.push([open, durationSec]);
	return out.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b - a >= minSec).map(([a, b]) => [round(a), round(b)]);
}

/** Spread up to `max` times over the video, preferring moments just after a screen change. */
export function pickKeyFrameTimes(durationSec: number, screenChanges: number[], max = MAX_KEY_FRAMES): number[] {
	const n = Math.max(1, Math.min(max, Math.ceil(durationSec / 5)));
	const times: number[] = [];
	for (let i = 0; i < n; i++) {
		const target = (durationSec * (i + 0.5)) / n;
		// The first screen change within this slot, a moment later so the new screen has settled.
		const slotStart = (durationSec * i) / n;
		const slotEnd = (durationSec * (i + 1)) / n;
		const change = screenChanges.find((t) => t >= slotStart && t < slotEnd);
		const t = change !== undefined ? Math.min(slotEnd - 0.05, change + 0.6) : target;
		times.push(round(Math.max(0, Math.min(durationSec - 0.1, t))));
	}
	return times;
}

function cacheKey(path: string): string | null {
	try {
		const st = statSync(path);
		return createHash("sha1").update(`${path}:${st.size}:${st.mtimeMs}:v${VIDEO_SUMMARY_VERSION}`).digest("hex").slice(0, 16);
	} catch {
		return null;
	}
}

function summaryDir(document: AxcutDocument): string {
	return join(resolveGeneratedGraphicsDir(document), ".summary");
}

const inFlight = new Map<string, Promise<VideoSummary | null>>();

/** The saved summary for the project's recording, or null when there is none yet (never analyses). */
export function readSavedVideoSummary(document: AxcutDocument): VideoSummary | null {
	const src = paletteSourceVideo(document);
	const key = src && cacheKey(src.path);
	if (!src || !key) return null;
	try {
		const file = join(summaryDir(document), `${key}.json`);
		if (!existsSync(file)) return null;
		const parsed = JSON.parse(readFileSync(file, "utf8")) as VideoSummary;
		return parsed.version === VIDEO_SUMMARY_VERSION ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * The summary for the project's primary recording: the saved one, the one
 * being built right now, or a new analysis. Null when there is no readable
 * recording or ffmpeg is missing.
 */
export async function ensureVideoSummary(
	document: AxcutDocument,
	options: { ffmpegPath?: string | null; signal?: AbortSignal } = {},
): Promise<VideoSummary | null> {
	const saved = readSavedVideoSummary(document);
	if (saved) return saved;
	const src = paletteSourceVideo(document);
	const key = src && cacheKey(src.path);
	const ffmpegPath = options.ffmpegPath ?? resolveFfmpeg()?.trim() ?? null;
	if (!src || !key || !ffmpegPath) return null;
	const running = inFlight.get(key);
	if (running) return running;
	const job = buildVideoSummary(document, src.path, key, ffmpegPath, options.signal).finally(() => inFlight.delete(key));
	inFlight.set(key, job);
	return job;
}

/** Start the analysis in the background (project opened, video imported). Never throws. */
export function warmVideoSummary(document: AxcutDocument): void {
	void ensureVideoSummary(document).catch((err) => {
		console.warn("[video-summary] analysis failed:", err instanceof Error ? err.message : err);
	});
}

async function buildVideoSummary(
	document: AxcutDocument,
	path: string,
	key: string,
	ffmpegPath: string,
	signal?: AbortSignal,
): Promise<VideoSummary | null> {
	const durationSec = (await probeMediaDurationSec(ffmpegPath, path, signal)) ?? 0;
	if (durationSec <= 0) return null;

	// Picture: stillness + scene changes, on a small copy of each frame (fast).
	const videoLines: string[] = [];
	const screenChanges: number[] = [];
	const videoPass = scanFfmpeg(
		ffmpegPath,
		["-i", path, "-an", "-vf", "scale=320:-2,freezedetect=n=0.003:d=1.5,select='gt(scene\\,0.12)',showinfo", "-f", "null", "-"],
		(line) => {
			if (line.includes("freezedetect")) videoLines.push(line);
			const m = /showinfo.*pts_time:\s*([\d.]+)/.exec(line);
			if (m) screenChanges.push(round(Number(m[1])));
		},
		signal,
	);
	// Sound: silences (a recording without an audio track is simply all silence).
	const audioLines: string[] = [];
	let hasAudio = true;
	const audioPass = scanFfmpeg(
		ffmpegPath,
		["-i", path, "-vn", "-af", `silencedetect=noise=-35dB:d=${MIN_SILENCE_SEC}`, "-f", "null", "-"],
		(line) => {
			if (line.includes("silencedetect")) audioLines.push(line);
			if (/does not contain any stream|Output file .* does not contain any stream|matches no streams/i.test(line)) hasAudio = false;
		},
		signal,
	).catch(() => {
		hasAudio = false;
		return null;
	});
	await Promise.all([videoPass, audioPass]);

	const stillStretches = collectRanges(videoLines, /freeze_start:\s*([\d.]+)/, /freeze_end:\s*([\d.]+)/, durationSec, MIN_STILL_SEC);
	const silences = hasAudio
		? collectRanges(audioLines, /silence_start:\s*([\d.]+)/, /silence_end:\s*([\d.]+)/, durationSec, MIN_SILENCE_SEC)
		: [[0, round(durationSec)] as [number, number]];

	// Screen changes closer than a second apart are one change (an animation).
	const changes = screenChanges.filter((t, i, all) => i === 0 || t - all[i - 1]! >= 1).slice(0, 60);

	const dir = summaryDir(document);
	const framesDir = join(dir, `${key}-frames`);
	mkdirSync(framesDir, { recursive: true });
	const keyFrames: VideoSummary["keyFrames"] = [];
	for (const [i, t] of pickKeyFrameTimes(durationSec, changes).entries()) {
		const out = join(framesDir, `frame-${i + 1}.jpg`);
		const r = await runProcess(
			ffmpegPath,
			["-v", "error", "-y", "-ss", t.toFixed(2), "-i", path, "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "4", out],
			{ timeoutMs: 30_000, signal },
		).catch(() => null);
		if (r?.code === 0 && existsSync(out)) keyFrames.push({ atSec: t, path: out });
	}

	const kit = await deriveBrandKitFromVideo(document, ffmpegPath, signal).catch(() => null);
	const summary: VideoSummary = {
		version: VIDEO_SUMMARY_VERSION,
		source: { path, durationSec: round(durationSec) },
		builtAt: new Date().toISOString(),
		screenChanges: changes,
		stillStretches,
		silences,
		hasAudio,
		keyFrames,
		colours: kit ? { primary: kit.primary, secondary: kit.secondary, background: kit.background, text: kit.text } : null,
	};
	writeFileSync(join(dir, `${key}.json`), JSON.stringify(summary, null, 1));
	return summary;
}

const total = (ranges: Array<[number, number]>) => round(ranges.reduce((acc, [a, b]) => acc + (b - a), 0));

/** What the agent gets: the summary plus what the project already knows (transcript) and plain-language hints. */
export function videoSummaryForAgent(summary: VideoSummary, document: AxcutDocument): Record<string, unknown> {
	const transcript = document.transcripts?.find((t) => t.assetId === (document.project.primaryAssetId ?? document.assets[0]?.id));
	const words = transcript?.words?.length ?? 0;
	const stillSec = total(summary.stillStretches);
	const silentSec = total(summary.silences);
	const hints: string[] = [];
	if (stillSec >= 2) hints.push(`The screen sits still for ${stillSec} s in ${summary.stillStretches.length} stretch(es) — speed these up or cut them.`);
	if (summary.hasAudio && silentSec >= 2) hints.push(`${silentSec} s without speech — tightenPacing (needs a transcript) or addTrims on these ranges.`);
	if (!summary.hasAudio) hints.push("No audio track: edit from the picture — screen changes, still stretches and key frames.");
	if (summary.hasAudio && words === 0) hints.push("No transcript yet: run generateCaptions if you need the words.");
	if (summary.screenChanges.length >= 2) hints.push(`${summary.screenChanges.length} screen changes — natural places for section cards, zooms and cuts.`);
	return {
		durationSec: summary.source.durationSec,
		screenChanges: summary.screenChanges,
		stillStretches: summary.stillStretches,
		silences: summary.silences.slice(0, 40),
		hasAudio: summary.hasAudio,
		transcript: words ? { words, language: transcript?.language } : null,
		keyFrames: summary.keyFrames,
		colours: summary.colours,
		hints,
		howToUse: "Read the keyFrames to see the app. This summary replaces re-watching the recording; take extra frames with sampleFrames only for a specific moment.",
	};
}
