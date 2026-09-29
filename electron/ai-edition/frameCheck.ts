/**
 * sampleFrames: still frames the agent can look at to check its own work —
 * of the EDITED timeline (rendered by the same compositor as preview/export,
 * so zooms, overlays, captions and backgrounds are in the picture), of a
 * finished export, or of the raw recording.
 *
 * Everything is async: this runs inside a chat turn and must never block the
 * app. Frames land in the project's generated-graphics folder, which the
 * local CLI can Read.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolvePlaybackSegments } from "../../src/lib/ai-edition/document/timeline";
import type { AxcutDocument } from "../../src/lib/ai-edition/schema";
import { analyzeRgba8 } from "./compositorVerify/pixels";
import { locateProgrammeInstant } from "./compositorVerify/programmeMap";
import type { CompositedFrameSampler } from "./compositorVerify/types";
import { assertSafeLocalMediaPath, probeMediaDurationSec, runProcess } from "./mediaStudio";
import { canvasSizeFromDocument } from "./startThumbnail";

export type SampleFramesFrom = "timeline" | "export" | "recording";

export interface SampledFrame {
	/** The time asked for (programme time for timeline/export, source time for recording). */
	timeSec: number;
	path: string | null;
	/**
	 * edited = composited timeline frame (what the viewer will see);
	 * approximate = the source frame at that point (the compositor was unavailable — zooms,
	 * overlays and captions are NOT in it); export / recording = straight from that file.
	 */
	kind: "edited" | "approximate" | "export" | "recording";
	/** True when the frame is one flat colour (nothing visible drawn). */
	blank?: boolean;
	error?: string;
}

export interface SampleFramesResult {
	frames: SampledFrame[];
	/** Length of what was sampled (programme length for timeline). */
	durationSec: number;
	notes: string[];
}

const MAX_FRAMES = 8;
const FRAME_WIDTH = 960;

/** Programme length after trims. */
export function timelineDurationSec(document: AxcutDocument): number {
	const segs = resolvePlaybackSegments(document.timeline.clips, document.timeline.trimRanges);
	return segs.length ? Math.max(...segs.map((s) => s.timelineEndSec)) : 0;
}

/** `count` evenly spaced times, avoiding the very first and last frame. */
export function evenlySpacedTimes(durationSec: number, count: number): number[] {
	const n = Math.max(1, Math.min(MAX_FRAMES, Math.round(count)));
	return Array.from({ length: n }, (_, i) => Math.round(((durationSec * (i + 0.5)) / n) * 100) / 100);
}

function primaryRecording(document: AxcutDocument): string | null {
	const videos = document.assets.filter((a) => a.kind === "video" && a.originalPath);
	const pick = videos.find((a) => a.id === document.project.primaryAssetId) ?? videos[0];
	return pick?.originalPath ?? null;
}

async function grabJpeg(
	ffmpegPath: string,
	file: string,
	atSec: number,
	out: string,
	width: number,
	signal?: AbortSignal,
): Promise<string | null> {
	const r = await runProcess(
		ffmpegPath,
		["-v", "error", "-y", "-ss", Math.max(0, atSec).toFixed(3), "-i", file, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "4", out],
		{ timeoutMs: 30_000, signal },
	);
	return r.code === 0 && existsSync(out) ? out : null;
}

/** Tightly packed RGBA → JPEG via ffmpeg stdin. */
function rgbaToJpeg(
	ffmpegPath: string,
	rgba: Uint8Array,
	width: number,
	height: number,
	out: string,
	signal?: AbortSignal,
): Promise<string | null> {
	return new Promise((resolve) => {
		const child = spawn(
			ffmpegPath,
			["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-i", "-", "-frames:v", "1", "-q:v", "4", out],
			{ stdio: ["pipe", "ignore", "ignore"], windowsHide: true },
		);
		const onAbort = () => child.kill("SIGKILL");
		signal?.addEventListener("abort", onAbort, { once: true });
		const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
		child.on("error", () => resolve(null));
		child.on("close", (code) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			resolve(code === 0 && existsSync(out) ? out : null);
		});
		child.stdin.on("error", () => {});
		child.stdin.end(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength));
	});
}

export async function sampleFramesForAgent(
	document: AxcutDocument,
	input: { from: SampleFramesFrom; times?: number[]; count?: number; exportPath?: string },
	deps: {
		ffmpegPath: string;
		outDir: string;
		stem: string;
		createSampler?: () => Promise<CompositedFrameSampler | null>;
		signal?: AbortSignal;
	},
): Promise<SampleFramesResult> {
	const { ffmpegPath, signal } = deps;
	const notes: string[] = [];
	let file: string | null = null;
	let durationSec: number;
	if (input.from === "timeline") {
		durationSec = timelineDurationSec(document);
		if (durationSec <= 0) throw new Error("The timeline is empty — nothing to sample.");
	} else {
		if (input.from === "export") {
			if (!input.exportPath) throw new Error("exportPath is required for from:\"export\" (the outputPath exportProject returned).");
			file = assertSafeLocalMediaPath(input.exportPath, "exportPath");
		} else {
			file = primaryRecording(document);
			if (!file) throw new Error("The project has no recording.");
		}
		if (!existsSync(file)) throw new Error(`File not found: ${file}`);
		durationSec = (await probeMediaDurationSec(ffmpegPath, file, signal)) ?? 0;
		if (durationSec <= 0) throw new Error(`Could not read the length of ${file}`);
	}

	const times = (input.times?.length ? input.times : evenlySpacedTimes(durationSec, input.count ?? 4))
		.slice(0, MAX_FRAMES)
		.map((t) => Math.max(0, Math.min(t, Math.max(0, durationSec - 0.05))));
	mkdirSync(deps.outDir, { recursive: true });
	const canvas = canvasSizeFromDocument(document);
	const width = FRAME_WIDTH;
	const height = Math.max(2, Math.round((width * (canvas.height || 1080)) / (canvas.width || 1920) / 2) * 2);
	const frames: SampledFrame[] = [];

	if (file) {
		for (const [i, t] of times.entries()) {
			const out = join(deps.outDir, `${deps.stem}-${i + 1}.jpg`);
			const path = await grabJpeg(ffmpegPath, file, t, out, width, signal);
			frames.push({ timeSec: t, path, kind: input.from === "export" ? "export" : "recording", ...(path ? {} : { error: "could not decode a frame here" }) });
		}
		return { frames, durationSec, notes };
	}

	// Timeline: composited frames when the compositor is available, source frames otherwise.
	const sampler = (await deps.createSampler?.().catch(() => null)) ?? null;
	let fellBack = false;
	try {
		for (const [i, t] of times.entries()) {
			const out = join(deps.outDir, `${deps.stem}-${i + 1}.jpg`);
			if (sampler) {
				const r = await sampler.sampleFrame({ document, programmeTimeSec: t, width, height });
				if ((r.status === "ok" || r.status === "invalid") && r.rgba && r.width && r.height) {
					const stats = r.pixelStats ?? analyzeRgba8(r.rgba, r.width, r.height);
					const path = await rgbaToJpeg(ffmpegPath, r.rgba, r.width, r.height, out, signal);
					if (path) {
						frames.push({ timeSec: t, path, kind: "edited", ...(stats.uniform ? { blank: true } : {}) });
						continue;
					}
				}
			}
			const at = locateProgrammeInstant(document, t);
			const path = at && existsSync(at.screenPath) ? await grabJpeg(ffmpegPath, at.screenPath, at.sourceTimeSec, out, width, signal) : null;
			fellBack = true;
			frames.push({ timeSec: t, path, kind: "approximate", ...(path ? {} : { error: "no playable media at this time" }) });
		}
	} finally {
		await sampler?.dispose?.();
	}
	if (fellBack) {
		notes.push(
			"Some frames are APPROXIMATE: the source picture at that point, without zooms, overlays, captions or background. Check those effects in an export instead.",
		);
	}
	return { frames, durationSec, notes };
}
