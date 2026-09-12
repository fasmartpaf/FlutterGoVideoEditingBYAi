import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveFfmpeg } from "../../media/audioPeaks";
import {
	VISUAL_FRAME_MAX_DIM,
	VISUAL_JPEG_QUALITY,
	type VisualEvidenceCandidate,
	type VisualEvidenceFrame,
} from "./types";

export interface ExtractFrameDeps {
	cacheDir: string;
	/** Override for tests. */
	ffmpegPath?: string | null;
	/** Override spawn-based extract for cache tests. */
	runExtract?: (args: {
		ffmpeg: string;
		videoPath: string;
		sourceTimeSec: number;
		outPath: string;
		maxDim: number;
		jpegQuality: number;
	}) => Promise<{ width: number; height: number }>;
}

export interface ExtractBatchResult {
	frames: VisualEvidenceFrame[];
	cacheHits: number;
	cacheMisses: number;
	extractMs: number;
}

function roundSourceKey(sourceTimeSec: number): string {
	// Millisecond key — matches clamp/dedupe granularity used by the sampler.
	return String(Math.round(sourceTimeSec * 1000));
}

export function visualFrameCacheKey(input: {
	assetId: string;
	sourcePath: string;
	mtimeMs: number;
	sourceTimeSec: number;
	maxDim: number;
	jpegQuality: number;
}): string {
	const digest = createHash("sha1")
		.update(
			[
				input.assetId,
				input.sourcePath,
				String(input.mtimeMs),
				roundSourceKey(input.sourceTimeSec),
				String(input.maxDim),
				String(input.jpegQuality),
			].join("|"),
		)
		.digest("hex")
		.slice(0, 24);
	return `${digest}.jpg`;
}

export async function defaultVisualFrameCacheDir(): Promise<string> {
	try {
		const electron = await import("electron");
		const userData = electron.app.getPath("userData");
		return path.join(userData, "visual-frames");
	} catch {
		return path.join(os.tmpdir(), "openscreen-visual-frames");
	}
}

async function defaultRunExtract(args: {
	ffmpeg: string;
	videoPath: string;
	sourceTimeSec: number;
	outPath: string;
	maxDim: number;
	jpegQuality: number;
}): Promise<{ width: number; height: number }> {
	await fs.mkdir(path.dirname(args.outPath), { recursive: true });
	// Seek before -i for speed; scale longest side to maxDim, never upscale/stretch.
	const vf = `scale=${args.maxDim}:${args.maxDim}:force_original_aspect_ratio=decrease`;
	const ffmpegArgs = [
		"-hide_banner",
		"-loglevel",
		"error",
		"-ss",
		args.sourceTimeSec.toFixed(3),
		"-i",
		args.videoPath,
		"-frames:v",
		"1",
		"-vf",
		vf,
		"-q:v",
		String(args.jpegQuality),
		"-y",
		args.outPath,
	];
	await new Promise<void>((resolve, reject) => {
		const child = spawn(args.ffmpeg, ffmpegArgs, { stdio: ["ignore", "ignore", "pipe"] });
		let stderr = "";
		child.stderr?.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0
				? resolve()
				: reject(new Error(`ffmpeg frame extract failed (${code}): ${stderr.trim()}`)),
		);
	});
	// Probe size via ffprobe when available; otherwise leave maxDim placeholders.
	const dims = await probeJpegSize(args.outPath, args.maxDim);
	return dims;
}

async function probeJpegSize(
	filePath: string,
	fallbackMax: number,
): Promise<{ width: number; height: number }> {
	try {
		const buf = await fs.readFile(filePath);
		// Minimal SOF0 scan for JPEG dimensions.
		for (let i = 0; i < buf.length - 9; i++) {
			if (buf[i] === 0xff && buf[i + 1] >= 0xc0 && buf[i + 1] <= 0xc3) {
				const height = buf.readUInt16BE(i + 5);
				const width = buf.readUInt16BE(i + 7);
				if (width > 0 && height > 0) return { width, height };
			}
		}
	} catch {
		// fall through
	}
	return { width: fallbackMax, height: Math.round(fallbackMax * (9 / 16)) };
}

/**
 * Extract (or cache-hit) JPEGs for each candidate. Never logs image bytes.
 */
export async function extractVisualEvidenceFrames(
	candidates: VisualEvidenceCandidate[],
	videoPath: string,
	deps: ExtractFrameDeps,
): Promise<ExtractBatchResult> {
	const started = Date.now();
	let cacheHits = 0;
	let cacheMisses = 0;
	const frames: VisualEvidenceFrame[] = [];
	const ffmpeg = deps.ffmpegPath === null ? null : (deps.ffmpegPath ?? resolveFfmpeg());
	const run = deps.runExtract ?? defaultRunExtract;

	let mtimeMs = 0;
	try {
		mtimeMs = (await fs.stat(videoPath)).mtimeMs;
	} catch {
		return { frames: [], cacheHits: 0, cacheMisses: 0, extractMs: Date.now() - started };
	}

	await fs.mkdir(deps.cacheDir, { recursive: true });

	for (const c of candidates) {
		const key = visualFrameCacheKey({
			assetId: c.assetId,
			sourcePath: videoPath,
			mtimeMs,
			sourceTimeSec: c.sourceTimeSec,
			maxDim: VISUAL_FRAME_MAX_DIM,
			jpegQuality: VISUAL_JPEG_QUALITY,
		});
		const outPath = path.join(deps.cacheDir, key);
		let hit = false;
		try {
			const st = await fs.stat(outPath);
			if (st.isFile() && st.size > 0) hit = true;
		} catch {
			hit = false;
		}

		if (hit) {
			cacheHits += 1;
			const dims = await probeJpegSize(outPath, VISUAL_FRAME_MAX_DIM);
			const byteLength = (await fs.stat(outPath)).size;
			frames.push({
				assetId: c.assetId,
				sourceTimeSec: c.sourceTimeSec,
				virtualTimeSec: c.virtualTimeSec,
				reason: c.reason,
				imagePath: outPath,
				mimeType: "image/jpeg",
				width: dims.width,
				height: dims.height,
				byteLength,
			});
			continue;
		}

		if (!ffmpeg && !deps.runExtract) {
			cacheMisses += 1;
			continue;
		}

		cacheMisses += 1;
		try {
			const dims = await run({
				ffmpeg: ffmpeg ?? "ffmpeg",
				videoPath,
				sourceTimeSec: c.sourceTimeSec,
				outPath,
				maxDim: VISUAL_FRAME_MAX_DIM,
				jpegQuality: VISUAL_JPEG_QUALITY,
			});
			const byteLength = (await fs.stat(outPath)).size;
			frames.push({
				assetId: c.assetId,
				sourceTimeSec: c.sourceTimeSec,
				virtualTimeSec: c.virtualTimeSec,
				reason: c.reason,
				imagePath: outPath,
				mimeType: "image/jpeg",
				width: dims.width,
				height: dims.height,
				byteLength,
			});
		} catch (err) {
			console.warn(
				"[visual-evidence] extract failed",
				c.assetId,
				c.sourceTimeSec.toFixed(3),
				err instanceof Error ? err.message : err,
			);
		}
	}

	return {
		frames,
		cacheHits,
		cacheMisses,
		extractMs: Date.now() - started,
	};
}
