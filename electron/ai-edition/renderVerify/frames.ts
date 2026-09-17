/**
 * Frame sampling + blank detection for Render Verification V1.
 * Prefers injected sampler → ffmpeg source stills. Native compositor is optional
 * and reported separately when unavailable (no silent structural upgrade).
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFfmpeg } from "../../media/audioPeaks";
import type { RenderedFrameEvidence, RenderFrameSampleRequest, RenderFrameSampler } from "./types";

const BLANK_LUMA_THRESHOLD = 8;
const MIN_VALID_BYTES = 32;

/** Heuristic blank check from JPEG/PNG bytes (no image decoder required). */
export function assessFrameBytes(bytes: Uint8Array | Buffer): {
	valid: boolean;
	blank: boolean;
	meanLuma?: number;
	byteLength: number;
} {
	const byteLength = bytes.byteLength;
	if (byteLength < MIN_VALID_BYTES) {
		return { valid: false, blank: true, byteLength, meanLuma: 0 };
	}
	// Sample every Nth byte as a crude luma proxy for JPEG entropy.
	let sum = 0;
	let n = 0;
	const step = Math.max(1, Math.floor(byteLength / 256));
	for (let i = 0; i < byteLength; i += step) {
		sum += bytes[i] ?? 0;
		n += 1;
	}
	const meanLuma = n > 0 ? sum / n : 0;
	// Tiny near-constant files are treated as blank/invalid.
	const blank = byteLength < 200 || meanLuma < BLANK_LUMA_THRESHOLD;
	return { valid: !blank && byteLength >= 200, blank, meanLuma, byteLength };
}

export function createInjectedSampler(
	frames: Array<
		Partial<RenderedFrameEvidence> & { sourceTimeSec: number; role: RenderedFrameEvidence["role"] }
	>,
): RenderFrameSampler {
	return (req) => {
		const hit =
			frames.find(
				(f) => f.role === req.role && Math.abs(f.sourceTimeSec - req.sourceTimeSec) < 0.05,
			) ?? frames.find((f) => f.role === req.role);
		if (!hit) {
			return {
				role: req.role,
				sourceTimeSec: req.sourceTimeSec,
				compressedTimeSec: req.compressedTimeSec,
				valid: false,
				blank: true,
				note: "injected_miss",
			};
		}
		return {
			role: req.role,
			sourceTimeSec: req.sourceTimeSec,
			compressedTimeSec: req.compressedTimeSec,
			valid: hit.valid !== false,
			blank: hit.blank === true,
			width: hit.width ?? 64,
			height: hit.height ?? 36,
			byteLength: hit.byteLength ?? 1024,
			meanLuma: hit.meanLuma ?? 120,
			path: hit.path,
			note: hit.note ?? "injected_sampler",
		};
	};
}

/** Always-unavailable sampler (forces render_unavailable). */
export function unavailableSampler(): RenderFrameSampler {
	return () => null;
}

/** Sampler that returns blank invalid frames (forces visual fail). */
export function blankFrameSampler(): RenderFrameSampler {
	return (req) => ({
		role: req.role,
		sourceTimeSec: req.sourceTimeSec,
		compressedTimeSec: req.compressedTimeSec,
		valid: false,
		blank: true,
		byteLength: 10,
		meanLuma: 0,
		note: "forced_blank",
	});
}

export function tryFfmpegSourceSampler(args: {
	workDir: string;
	retain?: boolean;
}): RenderFrameSampler {
	return (req: RenderFrameSampleRequest): RenderedFrameEvidence | null => {
		if (!req.assetPath || !existsSync(req.assetPath)) return null;
		let ffmpeg: string | null = null;
		try {
			ffmpeg = resolveFfmpeg();
		} catch {
			return null;
		}
		if (!ffmpeg || !existsSync(ffmpeg)) return null;

		mkdirSync(args.workDir, { recursive: true });
		const outPath = join(
			args.workDir,
			`rv_${req.role}_${Math.round(req.sourceTimeSec * 1000)}.jpg`,
		);
		const result = spawnSync(
			ffmpeg,
			[
				"-hide_banner",
				"-loglevel",
				"error",
				"-ss",
				String(Math.max(0, req.sourceTimeSec)),
				"-i",
				req.assetPath,
				"-frames:v",
				"1",
				"-q:v",
				"4",
				"-y",
				outPath,
			],
			{ encoding: "utf8" },
		);
		if (result.status !== 0 || !existsSync(outPath)) {
			return {
				role: req.role,
				sourceTimeSec: req.sourceTimeSec,
				compressedTimeSec: req.compressedTimeSec,
				valid: false,
				blank: true,
				note: `ffmpeg_failed:${result.stderr?.slice(0, 80) ?? "error"}`,
			};
		}
		const bytes = readFileSync(outPath);
		const assessed = assessFrameBytes(bytes);
		if (!args.retain) {
			try {
				rmSync(outPath, { force: true });
			} catch {
				/* ignore */
			}
		}
		return {
			role: req.role,
			sourceTimeSec: req.sourceTimeSec,
			compressedTimeSec: req.compressedTimeSec,
			valid: assessed.valid,
			blank: assessed.blank,
			byteLength: assessed.byteLength,
			meanLuma: assessed.meanLuma,
			path: args.retain ? outPath : undefined,
			note: "ffmpeg_source_stills",
		};
	};
}

export function defaultWorkDir(prefix = "openscreen-render-verify"): string {
	return join(tmpdir(), `${prefix}-${process.pid}`);
}

export function writeDebugMeta(dir: string, meta: unknown): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "render-verify-meta.json"), JSON.stringify(meta, null, 2), "utf8");
}

export function dirByteSize(dir: string): number {
	if (!existsSync(dir)) return 0;
	try {
		return statSync(dir).size;
	} catch {
		return 0;
	}
}
