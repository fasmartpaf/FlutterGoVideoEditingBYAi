/**
 * Probe container + stream durations via ffprobe (or ffmpeg -i fallback).
 */

import { spawn } from "node:child_process";
import { accessSync, existsSync, constants as fsConstants, statSync } from "node:fs";
import path from "node:path";
import { resolveFfmpeg } from "../../media/audioPeaks";
import { type ProbedSourceDurations, STREAM_DURATION_TOLERANCE_SEC } from "./types";

function isExecutableFile(candidate: string): boolean {
	try {
		if (!statSync(candidate).isFile()) return false;
		accessSync(candidate, fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/** Resolve bundled / env ffprobe beside the same roots as resolveFfmpeg. */
export function resolveFfprobe(here: string = process.cwd()): string | null {
	const env = process.env.OPENSCREEN_FFPROBE_PATH?.trim();
	if (env && isExecutableFile(env)) return env;
	const tag = `${process.platform}-${process.arch}`;
	const exe = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
	const candidates = [
		path.join(here, "crates/thirdparty/ffmpeg-n8.1.2-macos64-lgpl-shared/bin", exe),
		path.join(here, "crates/thirdparty/ffmpeg-n8.1.2-win64-lgpl-shared/bin", exe),
		path.join(here, "crates/thirdparty/ffmpeg-n8.1.2-linux64-lgpl-shared/bin", exe),
		path.join(here, "electron/native/bin", tag, exe),
	];
	const ffmpeg = resolveFfmpeg(here);
	if (ffmpeg) {
		candidates.unshift(path.join(path.dirname(ffmpeg), exe));
	}
	return candidates.find(isExecutableFile) ?? null;
}

function parsePositiveSec(value: unknown): number | null {
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function withDiscrepancy(
	probe: Omit<ProbedSourceDurations, "streamDiscrepancySec" | "streamDiscrepancyNote">,
): ProbedSourceDurations {
	const { videoStreamDurationSec: v, audioStreamDurationSec: a, containerDurationSec: c } = probe;
	let streamDiscrepancySec: number | null = null;
	let streamDiscrepancyNote: string | undefined;
	if (v != null && a != null) {
		const delta = Math.abs(v - a);
		if (delta > STREAM_DURATION_TOLERANCE_SEC) {
			streamDiscrepancySec = delta;
			streamDiscrepancyNote = `video/audio stream durations differ by ${delta.toFixed(3)}s (tolerance ${STREAM_DURATION_TOLERANCE_SEC}s)`;
		}
	}
	if (streamDiscrepancySec == null && c != null) {
		for (const [label, d] of [
			["video", v],
			["audio", a],
		] as const) {
			if (d == null) continue;
			const delta = Math.abs(c - d);
			if (delta > STREAM_DURATION_TOLERANCE_SEC) {
				streamDiscrepancySec = delta;
				streamDiscrepancyNote = `container vs ${label} stream differs by ${delta.toFixed(3)}s (tolerance ${STREAM_DURATION_TOLERANCE_SEC}s)`;
				break;
			}
		}
	}
	return {
		...probe,
		streamDiscrepancySec,
		...(streamDiscrepancyNote ? { streamDiscrepancyNote } : {}),
	};
}

async function probeWithFfprobe(
	ffprobePath: string,
	mediaPath: string,
): Promise<ProbedSourceDurations> {
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execFileAsync = promisify(execFile);
	const { stdout } = await execFileAsync(
		ffprobePath,
		[
			"-v",
			"error",
			"-show_entries",
			"format=duration",
			"-show_entries",
			"stream=index,codec_type,duration",
			"-of",
			"json",
			mediaPath,
		],
		{ timeout: 15_000 },
	);
	const parsed = JSON.parse(stdout) as {
		format?: { duration?: string };
		streams?: Array<{ codec_type?: string; duration?: string }>;
	};
	let videoStreamDurationSec: number | null = null;
	let audioStreamDurationSec: number | null = null;
	for (const stream of parsed.streams ?? []) {
		const d = parsePositiveSec(stream.duration);
		if (stream.codec_type === "video" && videoStreamDurationSec == null) {
			videoStreamDurationSec = d;
		}
		if (stream.codec_type === "audio" && audioStreamDurationSec == null) {
			audioStreamDurationSec = d;
		}
	}
	return withDiscrepancy({
		containerDurationSec: parsePositiveSec(parsed.format?.duration),
		videoStreamDurationSec,
		audioStreamDurationSec,
	});
}

/** ffmpeg -i stderr fallback when ffprobe is absent. */
async function probeWithFfmpeg(
	ffmpegPath: string,
	mediaPath: string,
): Promise<ProbedSourceDurations> {
	return new Promise((resolve) => {
		const child = spawn(ffmpegPath, ["-hide_banner", "-i", mediaPath], {
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			resolve(
				withDiscrepancy({
					containerDurationSec: null,
					videoStreamDurationSec: null,
					audioStreamDurationSec: null,
				}),
			);
		}, 15_000);
		child.on("close", () => {
			clearTimeout(timer);
			const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
			let containerDurationSec: number | null = null;
			if (durMatch) {
				const h = Number(durMatch[1]);
				const m = Number(durMatch[2]);
				const s = Number(durMatch[3]);
				const total = h * 3600 + m * 60 + s;
				containerDurationSec = Number.isFinite(total) && total > 0 ? total : null;
			}
			resolve(
				withDiscrepancy({
					containerDurationSec,
					videoStreamDurationSec: containerDurationSec,
					audioStreamDurationSec: /Stream\s+#\d+:\d+.*Audio:/i.test(stderr)
						? containerDurationSec
						: null,
				}),
			);
		});
		child.on("error", () => {
			clearTimeout(timer);
			resolve(
				withDiscrepancy({
					containerDurationSec: null,
					videoStreamDurationSec: null,
					audioStreamDurationSec: null,
				}),
			);
		});
	});
}

export async function probeSourceDurations(
	mediaPath: string,
	opts?: { ffprobePath?: string | null; ffmpegPath?: string | null },
): Promise<ProbedSourceDurations> {
	if (!mediaPath?.trim() || !existsSync(mediaPath)) {
		return withDiscrepancy({
			containerDurationSec: null,
			videoStreamDurationSec: null,
			audioStreamDurationSec: null,
		});
	}
	const ffprobe = opts?.ffprobePath === undefined ? resolveFfprobe() : opts.ffprobePath;
	if (ffprobe) {
		try {
			return await probeWithFfprobe(ffprobe, mediaPath);
		} catch {
			/* fall through to ffmpeg */
		}
	}
	const ffmpeg = opts?.ffmpegPath === undefined ? resolveFfmpeg() : opts.ffmpegPath;
	if (ffmpeg) {
		return probeWithFfmpeg(ffmpeg, mediaPath);
	}
	return withDiscrepancy({
		containerDurationSec: null,
		videoStreamDurationSec: null,
		audioStreamDurationSec: null,
	});
}

/**
 * Prefer container/format duration; else max(video, audio); else whichever exists.
 * Result is SOURCE_MEDIA_TIME for evidence grounding.
 */
export function selectCanonicalDurationSec(probe: ProbedSourceDurations): number | null {
	if (probe.containerDurationSec != null) return probe.containerDurationSec;
	const { videoStreamDurationSec: v, audioStreamDurationSec: a } = probe;
	if (v != null && a != null) return Math.max(v, a);
	return v ?? a ?? null;
}
