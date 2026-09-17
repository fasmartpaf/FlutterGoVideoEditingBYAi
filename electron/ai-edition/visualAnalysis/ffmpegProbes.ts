/**
 * FFmpeg observation probes for VisualAnalysisV1 (full-source or bounded).
 * Reuses deadAir parsers / sceneDetect where possible (WRAP).
 */

import { spawn } from "node:child_process";
import { resolveFfmpeg } from "../../media/audioPeaks";
import {
	type DetectedInterval,
	parseBlackdetectStderr,
	parseFreezedetectStderr,
} from "../deadAir/ffmpegVisualProbes";
import { probeSceneTimesInRange } from "../visualSpecialist/reuse/sceneDetect";
import type { VisualAnalysisParameters } from "./types";

export interface ProbeBatchResult {
	black: DetectedInterval[];
	freeze: DetectedInterval[];
	sceneTimes: number[];
	ffmpegVersion: string | null;
	mediaDecodePasses: number;
	latencyMs: number;
	errors: string[];
}

async function readVersion(ffmpeg: string): Promise<string | null> {
	return new Promise((resolve) => {
		const child = spawn(ffmpeg, ["-hide_banner", "-version"], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let out = "";
		child.stdout?.on("data", (c: Buffer) => {
			out += c.toString("utf8");
		});
		child.stderr?.on("data", (c: Buffer) => {
			out += c.toString("utf8");
		});
		const t = setTimeout(() => {
			child.kill("SIGKILL");
			resolve(null);
		}, 5_000);
		child.on("close", () => {
			clearTimeout(t);
			const m = out.match(/ffmpeg version\s+([^\s]+)/i);
			resolve(m?.[1] ?? null);
		});
		child.on("error", () => {
			clearTimeout(t);
			resolve(null);
		});
	});
}

function runVf(args: {
	ffmpeg: string;
	mediaPath: string;
	startSec: number;
	durationSec: number;
	vf: string;
	timeoutMs: number;
}): Promise<{ stderr: string; ok: boolean; error?: string }> {
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
		const child = spawn(args.ffmpeg, argv, { stdio: ["ignore", "ignore", "pipe"] });
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

export async function probeVisualFilters(args: {
	mediaPath: string;
	startSec?: number;
	endSec?: number;
	parameters: VisualAnalysisParameters;
	timeoutMs?: number;
}): Promise<ProbeBatchResult> {
	const t0 = Date.now();
	const errors: string[] = [];
	const ffmpeg = resolveFfmpeg();
	if (!ffmpeg) {
		return {
			black: [],
			freeze: [],
			sceneTimes: [],
			ffmpegVersion: null,
			mediaDecodePasses: 0,
			latencyMs: Date.now() - t0,
			errors: ["ffmpeg_unavailable"],
		};
	}
	const version = await readVersion(ffmpeg);
	const start = Math.max(0, args.startSec ?? 0);
	const end = args.endSec ?? 3600;
	const dur = Math.max(0.05, end - start);
	const timeoutMs = args.timeoutMs ?? 120_000;
	const p = args.parameters;

	const [blackRun, freezeRun, sceneTimes] = await Promise.all([
		runVf({
			ffmpeg,
			mediaPath: args.mediaPath,
			startSec: start,
			durationSec: dur,
			vf: `blackdetect=d=${p.blackDetect.d}:pix_th=${p.blackDetect.pixTh}`,
			timeoutMs,
		}),
		runVf({
			ffmpeg,
			mediaPath: args.mediaPath,
			startSec: start,
			durationSec: dur,
			vf: `freezedetect=n=${p.freezeDetect.n}:d=${p.freezeDetect.d}`,
			timeoutMs,
		}),
		probeSceneTimesInRange({
			videoPath: args.mediaPath,
			ffmpegPath: ffmpeg,
			startSourceTimeSec: start,
			endSourceTimeSec: start + dur,
			sceneThreshold: p.sceneThreshold,
		}).catch((err) => {
			errors.push(err instanceof Error ? err.message : String(err));
			return [] as number[];
		}),
	]);

	if (!blackRun.ok) errors.push(`blackdetect:${blackRun.error}`);
	if (!freezeRun.ok) errors.push(`freezedetect:${freezeRun.error}`);

	return {
		black: blackRun.ok ? parseBlackdetectStderr(blackRun.stderr, start) : [],
		freeze: freezeRun.ok ? parseFreezedetectStderr(freezeRun.stderr, start) : [],
		sceneTimes,
		ffmpegVersion: version,
		mediaDecodePasses: 3,
		latencyMs: Date.now() - t0,
		errors,
	};
}
