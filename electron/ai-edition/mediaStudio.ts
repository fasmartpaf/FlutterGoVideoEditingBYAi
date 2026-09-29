/**
 * Async media primitives for agent tools: run ffmpeg/ffprobe without blocking
 * the Electron main process, honour the chat Stop button, and cache the
 * encoder probe instead of re-running it for every slide.
 *
 * `executeAgentTool` stays synchronous (it is the single mutation gate); the
 * heavy media work happens here first, in `prepareAgentToolMedia`, and the
 * executor only consumes the finished files.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join } from "node:path";

export type ProcessRunResult = {
	code: number | null;
	stdout: string;
	stderr: string;
};

export type RunProcessOptions = {
	timeoutMs?: number;
	signal?: AbortSignal;
};

function abortError(): Error {
	const err = new Error("Agent stopped.");
	err.name = "AbortError";
	return err;
}

/** Keep only the tail of noisy ffmpeg logs. */
const MAX_LOG_CHARS = 64 * 1024;

/**
 * Run a binary asynchronously. Resolves with the exit code (never rejects on a
 * non-zero exit); rejects on spawn errors, timeouts and aborts. The child is
 * killed on timeout or abort.
 */
export function runProcess(
	bin: string,
	args: string[],
	options: RunProcessOptions = {},
): Promise<ProcessRunResult> {
	const { timeoutMs = 120_000, signal } = options;
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(abortError());
			return;
		}
		const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			fn();
		};
		const onAbort = () => {
			child.kill("SIGKILL");
			finish(() => reject(abortError()));
		};
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			finish(() =>
				reject(new Error(`${basename(bin)} timed out after ${Math.round(timeoutMs / 1000)}s`)),
			);
		}, timeoutMs);
		timer.unref?.();
		signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout = (stdout + chunk).slice(-MAX_LOG_CHARS);
		});
		child.stderr.on("data", (chunk: string) => {
			stderr = (stderr + chunk).slice(-MAX_LOG_CHARS);
		});
		child.on("error", (error) => finish(() => reject(error)));
		child.on("close", (code) => finish(() => resolve({ code, stdout, stderr })));
	});
}

const encoderCache = new Map<string, Promise<string>>();

/**
 * Bundled LGPL ffmpeg often lacks libx264; pick whatever H.264 encoder this
 * binary actually has. Probed once per ffmpeg path.
 */
export function pickH264Encoder(ffmpegPath: string, signal?: AbortSignal): Promise<string> {
	const cached = encoderCache.get(ffmpegPath);
	if (cached) return cached;
	const probe = runProcess(ffmpegPath, ["-hide_banner", "-encoders"], {
		timeoutMs: 15_000,
		signal,
	})
		.then(({ stdout, stderr }) => {
			const out = `${stdout}\n${stderr}`;
			if (/\blibopenh264\b/.test(out)) return "libopenh264";
			if (/\bh264_videotoolbox\b/.test(out)) return "h264_videotoolbox";
			if (/\blibx264\b/.test(out)) return "libx264";
			return "mpeg4";
		})
		.catch((err) => {
			// Do not cache failures (an aborted probe must not poison later runs).
			encoderCache.delete(ffmpegPath);
			throw err;
		});
	encoderCache.set(ffmpegPath, probe);
	return probe;
}

export function resetEncoderCacheForTests(): void {
	encoderCache.clear();
}

/** ffprobe sits beside ffmpeg in every bundle OpenScreen ships. */
export function ffprobeBesideFfmpeg(ffmpegPath: string): string {
	return ffmpegPath.replace(/ffmpeg(\.exe)?$/i, (_m, exe: string | undefined) =>
		exe ? "ffprobe.exe" : "ffprobe",
	);
}

/** Container duration in seconds, or null when ffprobe is missing / fails. */
export async function probeMediaDurationSec(
	ffmpegPath: string | null | undefined,
	filePath: string,
	signal?: AbortSignal,
): Promise<number | null> {
	const ffmpeg = ffmpegPath?.trim();
	if (!ffmpeg) return null;
	try {
		const result = await runProcess(
			ffprobeBesideFfmpeg(ffmpeg),
			[
				"-v",
				"error",
				"-show_entries",
				"format=duration",
				"-of",
				"default=noprint_wrappers=1:nokey=1",
				filePath,
			],
			{ timeoutMs: 30_000, signal },
		);
		if (result.code !== 0) return null;
		const n = Number.parseFloat(result.stdout.trim());
		return Number.isFinite(n) && n > 0 ? n : null;
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") throw err;
		return null;
	}
}

/**
 * Shared rule for any image/media path that comes from the model: it must be
 * absolute (a relative path would resolve against Electron's cwd) and must be
 * a plain file path, never an ffmpeg protocol URL such as `http:` or `concat:`.
 */
export function assertSafeLocalMediaPath(value: string, label = "path"): string {
	const trimmed = value.trim();
	if (/^[a-z][a-z0-9+.-]*:(?![\\/])/i.test(trimmed) && !/^[a-z]:[\\/]/i.test(trimmed)) {
		throw new Error(`${label} must be a local file path, not a URL or protocol (${trimmed.slice(0, 40)})`);
	}
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
		throw new Error(`${label} must be a local file path, not a URL (${trimmed.slice(0, 40)})`);
	}
	if (!isAbsolute(trimmed)) {
		throw new Error(`${label} must be an absolute path (got "${trimmed.slice(0, 80)}")`);
	}
	return trimmed;
}

const ALPHA_EXTS = new Set([".png", ".webp", ".gif"]);

/**
 * Downscale an oversized still into `cacheDir` without blocking. Keeps alpha
 * (PNG) when the source can have it; falls back to JPEG when the PNG is still
 * over `maxBytes`. The result is cached by source path + size + mtime, so the
 * same file is only shrunk once.
 */
export async function shrinkImageFile(input: {
	ffmpegPath: string;
	sourcePath: string;
	cacheDir: string;
	maxBytes: number;
	maxWidth?: number;
	signal?: AbortSignal;
}): Promise<string | null> {
	const { ffmpegPath, sourcePath, cacheDir, maxBytes, signal } = input;
	const maxWidth = input.maxWidth ?? 1280;
	const st = statSync(sourcePath);
	const key = createHash("sha1")
		.update(`${sourcePath}\0${st.size}\0${st.mtimeMs}\0${maxWidth}`)
		.digest("hex")
		.slice(0, 16);
	mkdirSync(cacheDir, { recursive: true });
	const wantsAlpha = ALPHA_EXTS.has(extname(sourcePath).toLowerCase());
	const candidates = wantsAlpha ? [".png", ".jpg"] : [".jpg"];
	for (const ext of candidates) {
		const out = join(cacheDir, `${key}${ext}`);
		if (existsSync(out) && statSync(out).size <= maxBytes) return out;
		const tmp = `${out}.tmp-${process.pid}${ext}`;
		const args = ["-y", "-i", sourcePath, "-frames:v", "1", "-vf", `scale=min(${maxWidth}\\,iw):-2`];
		if (ext === ".jpg") args.push("-q:v", "4");
		args.push(tmp);
		const result = await runProcess(ffmpegPath, args, { timeoutMs: 60_000, signal });
		if (result.code !== 0 || !existsSync(tmp)) {
			rmSync(tmp, { force: true });
			continue;
		}
		if (statSync(tmp).size > maxBytes) {
			rmSync(tmp, { force: true });
			continue;
		}
		renameSync(tmp, out);
		return out;
	}
	return null;
}
