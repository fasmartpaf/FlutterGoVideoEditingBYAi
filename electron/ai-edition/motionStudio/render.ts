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
	open(
		filePath: string,
		size: { width: number; height: number },
		options?: {
			transparent?: boolean;
			/** Draw at this fraction of `size` (the page keeps its CSS size; the encoder scales back up). */
			scale?: number;
		},
	): Promise<void>;
	/** Seek to `ms` on the virtual clock and return the frame as PNG bytes. */
	frame(ms: number): Promise<Buffer>;
	/**
	 * Optional fast path: the frame as raw pixels (no PNG encode/decode, which
	 * costs more than drawing the frame). Every frame must have the same size.
	 */
	frameRaw?(ms: number): Promise<{ data: Buffer; width: number; height: number; format: "bgra" | "rgba" }>;
	/** Script errors the page reported so far. */
	errors(): Promise<string[]>;
	close(): Promise<void>;
}

/** Longest side a motion page is drawn at; larger outputs are scaled up when encoding. */
export const MAX_RENDER_SIDE = 1920;

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
	/** Longest render allowed (default 60 s; a showcase of a whole recording is longer). */
	maxDurationSec?: number;
	/**
	 * Render in this many pages at once (each takes a slice of the frames and
	 * the slices are joined without re-encoding). Needs `createSource`.
	 */
	workers?: number;
	/** Opens another page for a parallel worker. */
	createSource?: () => Promise<FrameSource | null>;
	/** Save a still every so often while rendering (for the chat to show) and report its path. */
	stills?: { dir: string; count: number; onStill: (path: string, frame: number) => void };
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
	/** Raw pixels on stdin instead of PNGs. */
	raw?: { width: number; height: number; format: "bgra" | "rgba" };
}) {
	const inputArgs = input.raw
		? ["-f", "rawvideo", "-pix_fmt", input.raw.format, "-s", `${input.raw.width}x${input.raw.height}`, "-framerate", String(input.fps), "-i", "-"]
		: ["-f", "image2pipe", "-framerate", String(input.fps), "-c:v", "png", "-i", "-"];
	const child = spawn(
		input.ffmpegPath,
		[
			"-y",
			"-hide_banner",
			"-loglevel",
			"error",
			...inputArgs,
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
	const durationSec = Math.min(input.maxDurationSec ?? 60, Math.max(0.5, input.durationSec));
	const total = Math.max(1, Math.round(durationSec * fps));
	const encoderName = await pickH264Encoder(input.ffmpegPath, signal);
	// Retina recordings (3024×1964…) make every frame a 5+ megapixel paint; the
	// app's off-screen renderer then hands back frames before they finish drawing
	// (flicker, missing words, judder). Draw at most 1920 on the long side and
	// let the encoder's lanczos scale bring it back to the project size.
	const scale = Math.min(1, MAX_RENDER_SIDE / Math.max(width, height));
	const openOptions = scale < 1 ? { scale } : undefined;

	// Long renders are split across several pages; short ones are not worth the start-up.
	const workers = input.createSource ? Math.max(1, Math.min(input.workers ?? 1, Math.floor(total / 90))) : 1;
	const done = new Array<number>(workers).fill(0);
	const report = () => input.onProgress?.(done.reduce((a, b) => a + b, 0), total);
	const slices = Array.from({ length: workers }, (_, k) => [Math.floor((total * k) / workers), Math.floor((total * (k + 1)) / workers)] as const);
	const parts = workers === 1 ? [input.outPath] : slices.map((_, k) => `${input.outPath}.part${k}.mp4`);
	const pageErrors: string[] = [];
	// Evenly spaced stills of the video as it is made (a few, so they cost little).
	const stillFrames = new Set<number>();
	if (input.stills && input.stills.count > 0) {
		mkdirSync(input.stills.dir, { recursive: true });
		for (let j = 1; j <= input.stills.count; j++) stillFrames.add(Math.min(total - 1, Math.floor((total * j) / (input.stills.count + 1))));
	}
	// One slice failing stops the others instead of letting them draw for nothing.
	let sliceFailed = false;

	const renderSlice = async (k: number, src: FrameSource) => {
		const [from, to] = slices[k]!;
		let encoder: ReturnType<typeof startEncoder> | null = null;
		let ok = false;
		try {
			await src.open(input.compositionPath, { width, height }, openOptions);
			for (let i = from; i < to; i++) {
				if (signal?.aborted || sliceFailed) throw abortError();
				const ms = (i * 1000) / fps;
				if (src.frameRaw) {
					const raw = await src.frameRaw(ms);
					encoder ??= startEncoder({
						ffmpegPath: input.ffmpegPath,
						encoder: encoderName,
						fps,
						width,
						height,
						outPath: parts[k]!,
						raw: { width: raw.width, height: raw.height, format: raw.format },
					});
					await encoder.write(raw.data);
				} else {
					encoder ??= startEncoder({ ffmpegPath: input.ffmpegPath, encoder: encoderName, fps, width, height, outPath: parts[k]! });
					await encoder.write(await src.frame(ms));
				}
				if (stillFrames.has(i)) {
					try {
						const png = await src.frame(ms);
						const path = join(input.stills!.dir, `still-${String(i).padStart(5, "0")}.png`);
						writeFileSync(path, png);
						input.stills!.onStill(path, i);
					} catch {
						// a missing preview still never stops the render
					}
				}
				done[k] = i - from + 1;
				report();
			}
			const { code, stderr } = encoder ? await encoder.finish() : { code: 1, stderr: "no frames" };
			if (code !== 0 || !existsSync(parts[k]!)) {
				throw new Error(`Motion render encode failed (${encoderName}): ${stderr.slice(-600) || `exit ${code}`}`);
			}
			pageErrors.push(...(await src.errors()));
			ok = true;
		} finally {
			if (!ok) encoder?.kill();
			await src.close().catch(() => undefined);
		}
	};

	try {
		const sources: FrameSource[] = [source];
		for (let k = 1; k < workers; k++) {
			const extra = await input.createSource!();
			if (!extra) break;
			sources.push(extra);
		}
		if (sources.length < workers) {
			// Could not open every page: fall back to one page for everything.
			for (const s of sources.slice(1)) await s.close().catch(() => undefined);
			return await renderComposition({ ...input, workers: 1, createSource: undefined });
		}
		const results = await Promise.allSettled(
			sources.map((src, k) =>
				renderSlice(k, src).catch((err) => {
					sliceFailed = true;
					throw err;
				}),
			),
		);
		const firstFailure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
		if (firstFailure) {
			// Report the real failure, not the stop the other slices saw.
			const real = results.find(
				(r): r is PromiseRejectedResult => r.status === "rejected" && !(r.reason instanceof Error && r.reason.name === "AbortError"),
			);
			throw (real ?? firstFailure).reason;
		}
		if (workers > 1) {
			const list = `${input.outPath}.parts.txt`;
			writeFileSync(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
			const joined = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
				const child = spawn(
					input.ffmpegPath,
					["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", input.outPath],
					{ stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
				);
				let err = "";
				child.stderr.setEncoding("utf8");
				child.stderr.on("data", (d: string) => {
					err = (err + d).slice(-2000);
				});
				child.on("close", (code) => resolve({ code, stderr: err }));
				child.on("error", () => resolve({ code: 1, stderr: "could not start ffmpeg" }));
			});
			rmSync(list, { force: true });
			if (joined.code !== 0 || !existsSync(input.outPath)) throw new Error(`Could not join the rendered parts: ${joined.stderr}`);
		}
		return { mp4Path: input.outPath, frames: total, durationSec: total / fps, fps, width, height, pageErrors: [...new Set(pageErrors)].slice(0, 20) };
	} catch (err) {
		rmSync(input.outPath, { force: true });
		throw err;
	} finally {
		if (workers > 1) for (const p of parts) rmSync(p, { force: true });
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
