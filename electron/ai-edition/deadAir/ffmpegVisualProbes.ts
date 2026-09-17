/**
 * Bounded FFmpeg visual probes for dead-air V1.1.
 * Analyzer only — never rewrites media. Path always argv.
 */

import { spawn } from "node:child_process";
import { resolveFfmpeg } from "../../media/audioPeaks";
import { probeSceneTimesInRange } from "../visualSpecialist/reuse/sceneDetect";

export interface DetectedInterval {
	startSec: number;
	endSec: number;
	durationSec: number;
}

function runFfmpegBounded(args: {
	mediaPath: string;
	startSec: number;
	durationSec: number;
	vf: string;
	timeoutMs: number;
}): Promise<{ stderr: string; ok: boolean; error?: string }> {
	const ffmpeg = resolveFfmpeg();
	if (!ffmpeg) return Promise.resolve({ stderr: "", ok: false, error: "ffmpeg_unavailable" });
	const argv = [
		"-hide_banner",
		"-nostats",
		"-ss",
		args.startSec.toFixed(3),
		"-t",
		args.durationSec.toFixed(3),
		"-i",
		args.mediaPath,
		"-vf",
		args.vf,
		"-f",
		"null",
		"-",
	];
	return new Promise((resolve) => {
		const child = spawn(ffmpeg, argv, { stdio: ["ignore", "ignore", "pipe"] });
		let stderr = "";
		child.stderr?.on("data", (c: Buffer) => {
			stderr += c.toString("utf8");
		});
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			resolve({ stderr, ok: false, error: "timeout" });
		}, args.timeoutMs);
		child.on("close", () => {
			clearTimeout(timer);
			resolve({ stderr, ok: true });
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			resolve({ stderr, ok: false, error: err.message });
		});
	});
}

/** Parse blackdetect stderr into SOURCE_MEDIA_TIME intervals (absolute). */
export function parseBlackdetectStderr(stderr: string, seekStartSec = 0): DetectedInterval[] {
	const out: DetectedInterval[] = [];
	const re = /black_start:\s*([0-9.]+)\s+black_end:\s*([0-9.]+)\s+black_duration:\s*([0-9.]+)/gi;
	for (const m of stderr.matchAll(re)) {
		const localStart = Number(m[1]);
		const localEnd = Number(m[2]);
		const dur = Number(m[3]);
		if (!Number.isFinite(localStart) || !Number.isFinite(localEnd)) continue;
		const startSec = seekStartSec + localStart;
		const endSec = seekStartSec + localEnd;
		out.push({
			startSec,
			endSec,
			durationSec: Number.isFinite(dur) ? dur : Math.max(0, endSec - startSec),
		});
	}
	return out;
}

/** Parse freezedetect stderr. */
export function parseFreezedetectStderr(stderr: string, seekStartSec = 0): DetectedInterval[] {
	const out: DetectedInterval[] = [];
	let open: number | null = null;
	for (const line of stderr.split(/\r?\n/)) {
		const start = line.match(/freeze_start:\s*([0-9.]+)/i);
		if (start) {
			open = Number(start[1]);
			continue;
		}
		const end = line.match(/freeze_end:\s*([0-9.]+)\s*(?:\|\s*freeze_duration:\s*([0-9.]+))?/i);
		if (end && open != null) {
			const localEnd = Number(end[1]);
			const dur = end[2] != null ? Number(end[2]) : localEnd - open;
			const startSec = seekStartSec + open;
			const endSec = seekStartSec + localEnd;
			if (endSec > startSec) {
				out.push({
					startSec,
					endSec,
					durationSec: Number.isFinite(dur) ? dur : endSec - startSec,
				});
			}
			open = null;
		}
	}
	return out;
}

export async function probeSceneChangesInRange(args: {
	mediaPath: string;
	startSec: number;
	endSec: number;
	sceneThreshold: number;
	timeoutMs: number;
}): Promise<{ times: number[]; error?: string; latencyMs: number }> {
	const t0 = Date.now();
	const ffmpeg = resolveFfmpeg();
	if (!ffmpeg) {
		return { times: [], error: "ffmpeg_unavailable", latencyMs: Date.now() - t0 };
	}
	try {
		const times = await Promise.race([
			probeSceneTimesInRange({
				videoPath: args.mediaPath,
				ffmpegPath: ffmpeg,
				startSourceTimeSec: args.startSec,
				endSourceTimeSec: args.endSec,
				sceneThreshold: args.sceneThreshold,
			}),
			new Promise<number[]>((_, reject) =>
				setTimeout(() => reject(new Error("timeout")), args.timeoutMs),
			),
		]);
		return { times, latencyMs: Date.now() - t0 };
	} catch (err) {
		return {
			times: [],
			error: err instanceof Error ? err.message : String(err),
			latencyMs: Date.now() - t0,
		};
	}
}

export async function probeBlackInRange(args: {
	mediaPath: string;
	startSec: number;
	endSec: number;
	timeoutMs: number;
}): Promise<{ intervals: DetectedInterval[]; error?: string; latencyMs: number }> {
	const t0 = Date.now();
	const start = Math.max(0, args.startSec);
	const dur = Math.max(0.05, args.endSec - start);
	const run = await runFfmpegBounded({
		mediaPath: args.mediaPath,
		startSec: start,
		durationSec: dur,
		vf: "blackdetect=d=0.2:pix_th=0.10",
		timeoutMs: args.timeoutMs,
	});
	if (!run.ok) {
		return { intervals: [], error: run.error, latencyMs: Date.now() - t0 };
	}
	return {
		intervals: parseBlackdetectStderr(run.stderr, start),
		latencyMs: Date.now() - t0,
	};
}

export async function probeFreezeInRange(args: {
	mediaPath: string;
	startSec: number;
	endSec: number;
	timeoutMs: number;
}): Promise<{ intervals: DetectedInterval[]; error?: string; latencyMs: number }> {
	const t0 = Date.now();
	const start = Math.max(0, args.startSec);
	const dur = Math.max(0.05, args.endSec - start);
	const run = await runFfmpegBounded({
		mediaPath: args.mediaPath,
		startSec: start,
		durationSec: dur,
		vf: "freezedetect=n=0.003:d=0.5",
		timeoutMs: args.timeoutMs,
	});
	if (!run.ok) {
		return { intervals: [], error: run.error, latencyMs: Date.now() - t0 };
	}
	return {
		intervals: parseFreezedetectStderr(run.stderr, start),
		latencyMs: Date.now() - t0,
	};
}
