/**
 * Check a rendered motion clip before it goes on the timeline, and give the
 * agent still frames to look at. Automatic checks catch what a model tends
 * to miss: wrong size or frame rate, a clip much shorter than asked, and
 * blank or frozen output (a composition whose animation never ran).
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ffprobeBesideFfmpeg, runProcess } from "../mediaStudio";

export interface MotionClipCheck {
	ok: boolean;
	problems: string[];
	/** Measured by ffprobe. */
	measured: { width: number; height: number; fps: number; durationSec: number } | null;
	/** Stills the agent can Read to judge the result (start / middle / end). */
	framePaths: string[];
}

function parseRate(rate: string | undefined): number {
	if (!rate) return 0;
	const [n, d] = rate.split("/").map(Number);
	return d ? n! / d : Number(n) || 0;
}

/** Tiny grayscale thumbnails of `count` evenly spaced frames, as raw bytes. */
async function grayThumbs(ffmpeg: string, mp4: string, durationSec: number, count: number, signal?: AbortSignal) {
	const out: Buffer[] = [];
	for (let i = 0; i < count; i++) {
		const t = Math.min(durationSec - 0.05, (durationSec * (i + 0.5)) / count);
		const r = await runProcessBuffer(
			ffmpeg,
			["-v", "error", "-ss", String(Math.max(0, t)), "-i", mp4, "-frames:v", "1", "-vf", "scale=32:18,format=gray", "-f", "rawvideo", "-"],
			signal,
		);
		if (r.length === 32 * 18) out.push(r);
	}
	return out;
}

/** runProcess returns text; frames need bytes. */
async function runProcessBuffer(bin: string, args: string[], signal?: AbortSignal): Promise<Buffer> {
	const { spawn } = await import("node:child_process");
	return new Promise((resolve, reject) => {
		const child = spawn(bin, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
		const chunks: Buffer[] = [];
		const onAbort = () => child.kill("SIGKILL");
		signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (d: Buffer) => chunks.push(d));
		child.on("error", reject);
		child.on("close", () => {
			signal?.removeEventListener("abort", onAbort);
			resolve(Buffer.concat(chunks));
		});
	});
}

function stddev(buf: Buffer): number {
	let sum = 0;
	for (const v of buf) sum += v;
	const mean = sum / buf.length;
	let acc = 0;
	for (const v of buf) acc += (v - mean) ** 2;
	return Math.sqrt(acc / buf.length);
}

function meanAbsDiff(a: Buffer, b: Buffer): number {
	let acc = 0;
	for (let i = 0; i < a.length; i++) acc += Math.abs(a[i]! - b[i]!);
	return acc / a.length;
}

export async function verifyMotionClip(input: {
	ffmpegPath: string;
	mp4Path: string;
	expected: { width: number; height: number; fps: number; durationSec: number };
	/** Where to write the preview stills (created if missing). */
	framesDir: string;
	stem: string;
	signal?: AbortSignal;
}): Promise<MotionClipCheck> {
	const { ffmpegPath, mp4Path, expected, signal } = input;
	const problems: string[] = [];
	let measured: MotionClipCheck["measured"] = null;
	const probe = await runProcess(
		ffprobeBesideFfmpeg(ffmpegPath),
		["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", mp4Path],
		{ timeoutMs: 30_000, signal },
	).catch(() => null);
	if (probe && probe.code === 0) {
		try {
			const j = JSON.parse(probe.stdout) as {
				streams?: Array<{ width?: number; height?: number; r_frame_rate?: string }>;
				format?: { duration?: string };
			};
			const s = j.streams?.[0];
			measured = {
				width: s?.width ?? 0,
				height: s?.height ?? 0,
				fps: Math.round(parseRate(s?.r_frame_rate) * 100) / 100,
				durationSec: Number(j.format?.duration ?? 0),
			};
		} catch {
			measured = null;
		}
	}
	if (!measured) {
		problems.push("could not read the rendered file");
	} else {
		if (measured.width !== expected.width || measured.height !== expected.height) {
			problems.push(`size is ${measured.width}×${measured.height}, expected ${expected.width}×${expected.height}`);
		}
		if (Math.abs(measured.fps - expected.fps) > 0.5) problems.push(`frame rate is ${measured.fps}, expected ${expected.fps}`);
		if (Math.abs(measured.durationSec - expected.durationSec) > Math.max(0.15, 2 / expected.fps)) {
			problems.push(`length is ${measured.durationSec.toFixed(2)}s, expected ${expected.durationSec.toFixed(2)}s`);
		}
	}

	const duration = measured?.durationSec || expected.durationSec;
	const thumbs = await grayThumbs(ffmpegPath, mp4Path, duration, 6, signal);
	if (thumbs.length >= 2) {
		if (thumbs.every((t) => stddev(t) < 2)) problems.push("every frame is a flat colour — nothing visible was drawn");
		const motion = thumbs.slice(1).reduce((acc, t, i) => acc + meanAbsDiff(thumbs[i]!, t), 0);
		if (motion < 0.2) problems.push("frames are identical — the animation did not play");
	}

	// Stills for the agent (and the chat preview): start, middle, end.
	mkdirSync(input.framesDir, { recursive: true });
	const framePaths: string[] = [];
	const marks = [Math.min(0.4, duration * 0.15), duration * 0.5, Math.max(0, duration - 0.6)];
	for (const [i, t] of marks.entries()) {
		const out = join(input.framesDir, `${input.stem}-frame${i + 1}.jpg`);
		const r = await runProcess(
			ffmpegPath,
			["-v", "error", "-y", "-ss", String(t), "-i", mp4Path, "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "4", out],
			{ timeoutMs: 30_000, signal },
		).catch(() => null);
		if (r && r.code === 0) framePaths.push(out);
	}
	return { ok: problems.length === 0, problems, measured, framePaths };
}
