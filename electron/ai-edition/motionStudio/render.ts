/**
 * Composition → MP4. The page is opened by a FrameSource (Electron offscreen
 * window in the app; headless Chromium in tests), stepped frame by frame on
 * the virtual clock (see driver.ts), and every captured frame is piped into
 * ffmpeg. Async throughout, honours the chat Stop button.
 */

import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sequenceFrameName } from "../../../src/lib/ai-edition/document/imageSequence";
import { pickH264Encoder } from "../mediaStudio";

export interface FrameSource {
	/**
	 * Load the composition file (already wrapped with the driver). `transparent`
	 * keeps the page background see-through so frames carry alpha (overlays).
	 */
	open(filePath: string, size: { width: number; height: number }, options?: { transparent?: boolean }): Promise<void>;
	/** Seek to `ms` on the virtual clock and return the frame as PNG bytes. */
	frame(ms: number): Promise<Buffer>;
	/** Script errors the page reported so far. */
	errors(): Promise<string[]>;
	close(): Promise<void>;
}

export interface RenderCompositionInput {
	source: FrameSource;
	/** Wrapped composition file on disk (see writeComposition). */
	compositionPath: string;
	width: number;
	height: number;
	fps: number;
	durationSec: number;
	outPath: string;
	ffmpegPath: string;
	signal?: AbortSignal;
	onProgress?: (done: number, total: number) => void;
}

export interface RenderCompositionResult {
	mp4Path: string;
	frames: number;
	durationSec: number;
	fps: number;
	width: number;
	height: number;
	/** Script errors thrown by the composition while rendering. */
	pageErrors: string[];
}

function abortError(): Error {
	const err = new Error("Agent stopped.");
	err.name = "AbortError";
	return err;
}

export function even(n: number): number {
	const v = Math.max(2, Math.round(n));
	return v % 2 === 0 ? v : v + 1;
}

/** ffmpeg reading PNG frames from stdin → H.264 MP4 at a fixed frame rate. */
function startEncoder(input: {
	ffmpegPath: string;
	encoder: string;
	fps: number;
	width: number;
	height: number;
	outPath: string;
}) {
	const child = spawn(
		input.ffmpegPath,
		[
			"-y",
			"-hide_banner",
			"-loglevel",
			"error",
			"-f",
			"image2pipe",
			"-framerate",
			String(input.fps),
			"-c:v",
			"png",
			"-i",
			"-",
			"-vf",
			`scale=${input.width}:${input.height}:flags=lanczos,format=yuv420p`,
			"-c:v",
			input.encoder,
			...(input.encoder === "libx264" ? ["-preset", "medium", "-crf", "18"] : ["-b:v", "8M"]),
			"-r",
			String(input.fps),
			"-movflags",
			"+faststart",
			"-an",
			input.outPath,
		],
		{ stdio: ["pipe", "ignore", "pipe"], windowsHide: true },
	);
	let stderr = "";
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (d: string) => {
		stderr = (stderr + d).slice(-4_000);
	});
	let failed: Error | null = null;
	child.stdin.on("error", (err) => {
		failed = err;
	});
	const closed = new Promise<number | null>((resolve) => child.on("close", (code) => resolve(code)));
	child.on("error", (err) => {
		failed = err;
	});
	return {
		async write(png: Buffer): Promise<void> {
			if (failed) throw failed;
			if (!child.stdin.write(png)) {
				await new Promise<void>((resolve) => child.stdin.once("drain", () => resolve()));
			}
		},
		async finish(): Promise<{ code: number | null; stderr: string }> {
			child.stdin.end();
			const code = await closed;
			return { code, stderr };
		},
		kill(): void {
			child.kill("SIGKILL");
		},
	};
}

export async function renderComposition(input: RenderCompositionInput): Promise<RenderCompositionResult> {
	const { source, signal } = input;
	if (signal?.aborted) throw abortError();
	const width = even(input.width);
	const height = even(input.height);
	const fps = Math.min(60, Math.max(12, Math.round(input.fps)));
	const durationSec = Math.min(60, Math.max(0.5, input.durationSec));
	const total = Math.max(1, Math.round(durationSec * fps));
	const encoderName = await pickH264Encoder(input.ffmpegPath, signal);
	await source.open(input.compositionPath, { width, height });
	const encoder = startEncoder({ ffmpegPath: input.ffmpegPath, encoder: encoderName, fps, width, height, outPath: input.outPath });
	let ok = false;
	try {
		for (let i = 0; i < total; i++) {
			if (signal?.aborted) throw abortError();
			const png = await source.frame((i * 1000) / fps);
			await encoder.write(png);
			input.onProgress?.(i + 1, total);
		}
		const { code, stderr } = await encoder.finish();
		if (code !== 0 || !existsSync(input.outPath)) {
			throw new Error(`Motion render encode failed (${encoderName}): ${stderr.slice(-600) || `exit ${code}`}`);
		}
		const pageErrors = await source.errors();
		ok = true;
		return { mp4Path: input.outPath, frames: total, durationSec: total / fps, fps, width, height, pageErrors };
	} finally {
		if (!ok) {
			encoder.kill();
			rmSync(input.outPath, { force: true });
		}
		await source.close().catch(() => undefined);
	}
}

export interface RenderSequenceInput {
	source: FrameSource;
	compositionPath: string;
	width: number;
	height: number;
	fps: number;
	durationSec: number;
	/** Folder for frame-00000.png … (created). */
	outDir: string;
	signal?: AbortSignal;
}

export interface RenderSequenceResult {
	dir: string;
	frameCount: number;
	fps: number;
	width: number;
	height: number;
	durationSec: number;
	pageErrors: string[];
}

/**
 * Composition → transparent PNG sequence, for animated overlays drawn on top
 * of the recording by the compositor (which steps through the frames).
 */
export async function renderSequence(input: RenderSequenceInput): Promise<RenderSequenceResult> {
	const { source, signal } = input;
	if (signal?.aborted) throw abortError();
	const width = even(input.width);
	const height = even(input.height);
	const fps = Math.min(30, Math.max(10, Math.round(input.fps)));
	const durationSec = Math.min(30, Math.max(0.5, input.durationSec));
	const total = Math.max(1, Math.round(durationSec * fps));
	mkdirSync(input.outDir, { recursive: true });
	await source.open(input.compositionPath, { width, height }, { transparent: true });
	try {
		for (let i = 0; i < total; i++) {
			if (signal?.aborted) throw abortError();
			const png = await source.frame((i * 1000) / fps);
			writeFileSync(join(input.outDir, sequenceFrameName(i)), png);
		}
		return {
			dir: input.outDir,
			frameCount: total,
			fps,
			width,
			height,
			durationSec: total / fps,
			pageErrors: await source.errors(),
		};
	} finally {
		await source.close().catch(() => undefined);
	}
}
