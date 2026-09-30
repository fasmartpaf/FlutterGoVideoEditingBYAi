/**
 * Voice clean-up: rumble cut, noise reduction and a gentle compressor on a
 * recording's sound.
 *
 * The compositor plays a clip's sound from its video file, so the cleaned
 * sound goes into a copy of the file (the picture is stream-copied, not
 * re-encoded; the cursor sidecar is copied along) and the asset points at
 * the copy. The asset remembers the original (`derived.sourcePath`), so a
 * new level always starts from the untouched recording and undo restores it.
 * Preview and export both play the copy.
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { AxcutAsset, AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { runProcess } from "../mediaStudio";
import { ffmpegFilters, parseFfmpegProbe } from "../showcase/render";

export const VOICE_LEVELS = ["light", "medium", "strong"] as const;
export type VoiceLevel = (typeof VOICE_LEVELS)[number];

/** Each step is [filterName, args]; steps whose filter this ffmpeg lacks are left out. */
const CHAINS: Record<VoiceLevel, Array<[string, string]>> = {
	light: [
		["highpass", "f=80"],
		["afftdn", "nr=10:nf=-40"],
		["acompressor", "threshold=0.125:ratio=2:attack=10:release=200"],
		["alimiter", "limit=0.95"],
	],
	medium: [
		["highpass", "f=90"],
		["afftdn", "nr=18:nf=-35:tn=1"],
		["acompressor", "threshold=0.1:ratio=3:attack=8:release=180:makeup=1.6"],
		["alimiter", "limit=0.95"],
	],
	strong: [
		["highpass", "f=100"],
		["lowpass", "f=12000"],
		["afftdn", "nr=28:nf=-30:tn=1"],
		["agate", "threshold=0.02:ratio=2:attack=5:release=250"],
		["acompressor", "threshold=0.08:ratio=4:attack=6:release=160:makeup=2"],
		["alimiter", "limit=0.95"],
	],
};

export function voiceFilterChain(level: VoiceLevel, available?: ReadonlySet<string>): string {
	return CHAINS[level]
		.filter(([name]) => !available || available.has(name))
		.map(([name, args]) => `${name}=${args}`)
		.join(",");
}

export type VoiceTarget = { asset: AxcutAsset; sourcePath: string };

/** Recordings on the timeline whose voice can be cleaned (pictures and audio-only files are not). */
export function voiceTargets(document: AxcutDocument, assetId?: string): VoiceTarget[] {
	const onTimeline = new Set(document.timeline.clips.map((c) => c.assetId));
	return document.assets
		.filter((a) => a.kind !== "audio" && !a.still && onTimeline.has(a.id) && (!assetId || a.id === assetId))
		.map((a) => ({
			asset: a,
			sourcePath: a.derived?.kind === "voice-clean" && a.derived.sourcePath ? a.derived.sourcePath : a.originalPath,
		}));
}

export async function bakeCleanVoice(input: {
	ffmpegPath: string;
	sourcePath: string;
	level: VoiceLevel;
	outDir: string;
	signal?: AbortSignal;
}): Promise<{ path: string; chain: string }> {
	const probe = await runProcess(input.ffmpegPath, ["-hide_banner", "-i", input.sourcePath], {
		timeoutMs: 20_000,
		signal: input.signal,
	}).catch(() => null);
	const info = probe ? parseFfmpegProbe(probe.stderr) : null;
	if (probe && info && !info.hasAudio) throw new Error("this recording has no sound");
	const chain = voiceFilterChain(input.level, await ffmpegFilters(input.ffmpegPath, input.signal));
	if (!chain) throw new Error("this ffmpeg has none of the clean-up filters");
	mkdirSync(input.outDir, { recursive: true });
	const ext = extname(input.sourcePath).toLowerCase() === ".mov" ? ".mov" : ".mp4";
	const stem = basename(input.sourcePath, extname(input.sourcePath)).replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 50) || "recording";
	const out = join(input.outDir, `${stem}.voice-${input.level}-${Date.now().toString(36)}${ext}`);
	const res = await runProcess(
		input.ffmpegPath,
		[
			"-y",
			"-nostdin",
			"-hide_banner",
			"-i",
			input.sourcePath,
			"-map",
			"0:v:0",
			"-map",
			"0:a:0",
			"-c:v",
			"copy",
			"-af",
			chain,
			"-c:a",
			"aac",
			"-b:a",
			"192k",
			"-movflags",
			"+faststart",
			out,
		],
		{ timeoutMs: 1_800_000, signal: input.signal },
	);
	if (res.code !== 0 || !existsSync(out)) {
		throw new Error(`Could not clean the voice: ${(res.stderr || "").slice(-400)}`);
	}
	// The pointer data rides beside the video it was recorded with.
	const sidecar = `${input.sourcePath}.cursor.json`;
	if (existsSync(sidecar)) copyFileSync(sidecar, `${out}.cursor.json`);
	return { path: out, chain };
}

/** Point the asset at the cleaned copy (remembering the original), or back. */
export function setVoiceSource(
	document: AxcutDocument,
	assetId: string,
	cleaned: { path: string; level: VoiceLevel } | null,
): AxcutDocument {
	return {
		...document,
		assets: document.assets.map((a) => {
			if (a.id !== assetId) return a;
			const original = a.derived?.kind === "voice-clean" && a.derived.sourcePath ? a.derived.sourcePath : a.originalPath;
			if (!cleaned) {
				const { derived: _d, ...rest } = a;
				return { ...rest, originalPath: original } as AxcutAsset;
			}
			return {
				...a,
				originalPath: cleaned.path,
				derived: { fromAssetId: a.id, kind: "voice-clean", level: cleaned.level, sourcePath: original },
			};
		}),
	};
}
