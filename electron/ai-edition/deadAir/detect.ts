/**
 * Local FFmpeg silencedetect analyzer.
 * Path is always an argv element — never shell-concatenated.
 */

import { spawn } from "node:child_process";
import { resolveFfmpeg } from "../../media/audioPeaks";
import { probeSourceDurations } from "../sourceTiming/probe";
import { probeAudioStream } from "../speechEvidence/probe";
import { readSilenceCache, type SilenceCacheKeyParts, writeSilenceCache } from "./cache";
import { DEFAULT_DEAD_AIR_POLICY, type DeadAirPolicyConfig } from "./config";
import { parseFfmpegVersionBanner, parseSilencedetectStderr } from "./parseSilencedetect";
import type { SilenceDetectorResult } from "./types";

export interface DetectSilenceArgs {
	assetId: string;
	mediaPath: string;
	policy?: DeadAirPolicyConfig;
	signal?: AbortSignal;
	/** Skip cache read/write. */
	bypassCache?: boolean;
	cacheDir?: string;
}

async function readFfmpegVersion(ffmpegPath: string): Promise<string | null> {
	return new Promise((resolve) => {
		const child = spawn(ffmpegPath, ["-hide_banner", "-version"], {
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
			resolve(parseFfmpegVersionBanner(out));
		});
		child.on("error", () => {
			clearTimeout(t);
			resolve(null);
		});
	});
}

export async function detectSilenceIntervals(
	args: DetectSilenceArgs,
): Promise<SilenceDetectorResult> {
	const policy = args.policy ?? DEFAULT_DEAD_AIR_POLICY;
	const parameters = { ...policy.detector };
	const t0 = Date.now();
	const ffmpeg = resolveFfmpeg();
	if (!ffmpeg) {
		return {
			assetId: args.assetId,
			mediaPath: args.mediaPath,
			durationSec: null,
			audioState: "ffmpeg_unavailable",
			intervals: [],
			ffmpegVersion: null,
			parameters,
			latencyMs: Date.now() - t0,
			cacheHit: false,
			error: "ffmpeg executable not found",
		};
	}

	const version = await readFfmpegVersion(ffmpeg);
	const probe = await probeAudioStream(args.mediaPath);
	const durations = await probeSourceDurations(args.mediaPath).catch(() => null);
	const durationSec =
		durations?.containerDurationSec ??
		durations?.audioStreamDurationSec ??
		durations?.videoStreamDurationSec ??
		null;

	if (probe.present === false) {
		return {
			assetId: args.assetId,
			mediaPath: args.mediaPath,
			durationSec,
			audioState: "absent",
			intervals: [],
			ffmpegVersion: version,
			parameters,
			latencyMs: Date.now() - t0,
			cacheHit: false,
			error: probe.reason,
		};
	}
	if (probe.present === null) {
		return {
			assetId: args.assetId,
			mediaPath: args.mediaPath,
			durationSec,
			audioState: "probe_failed",
			intervals: [],
			ffmpegVersion: version,
			parameters,
			latencyMs: Date.now() - t0,
			cacheHit: false,
			error: probe.reason,
		};
	}

	const cacheKey: SilenceCacheKeyParts = {
		mediaPath: args.mediaPath,
		noiseThresholdDb: parameters.noiseThresholdDb,
		minimumSilenceDurationSec: parameters.minimumSilenceDurationSec,
	};

	if (!args.bypassCache) {
		const cached = await readSilenceCache(cacheKey, args.cacheDir);
		if (cached) {
			return {
				...cached.result,
				assetId: args.assetId,
				latencyMs: Date.now() - t0,
				cacheHit: true,
			};
		}
	}

	const noise = `noise=${parameters.noiseThresholdDb}dB`;
	const dur = `d=${parameters.minimumSilenceDurationSec}`;
	const filter = `silencedetect=${noise}:${dur}`;

	const run = await new Promise<{
		stderr: string;
		code: number | null;
		state: "ok" | "timeout" | "cancelled" | "spawn_error";
		error?: string;
	}>((resolve) => {
		if (args.signal?.aborted) {
			resolve({ stderr: "", code: null, state: "cancelled", error: "aborted before spawn" });
			return;
		}
		const child = spawn(
			ffmpeg,
			["-hide_banner", "-nostats", "-i", args.mediaPath, "-af", filter, "-f", "null", "-"],
			{ stdio: ["ignore", "ignore", "pipe"] },
		);
		let stderr = "";
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			resolve({ stderr, code: null, state: "timeout", error: "silencedetect timed out" });
		}, parameters.timeoutMs);

		const onAbort = () => {
			child.kill("SIGKILL");
		};
		args.signal?.addEventListener("abort", onAbort, { once: true });

		child.on("close", (code) => {
			clearTimeout(timer);
			args.signal?.removeEventListener("abort", onAbort);
			if (args.signal?.aborted) {
				resolve({ stderr, code, state: "cancelled", error: "analysis cancelled" });
				return;
			}
			resolve({ stderr, code, state: "ok" });
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			args.signal?.removeEventListener("abort", onAbort);
			resolve({ stderr, code: null, state: "spawn_error", error: err.message });
		});
	});

	if (run.state === "timeout") {
		return {
			assetId: args.assetId,
			mediaPath: args.mediaPath,
			durationSec,
			audioState: "timeout",
			intervals: [],
			ffmpegVersion: version,
			parameters,
			latencyMs: Date.now() - t0,
			cacheHit: false,
			stderrExcerpt: run.stderr.slice(0, 800),
			error: run.error,
		};
	}
	if (run.state === "cancelled") {
		return {
			assetId: args.assetId,
			mediaPath: args.mediaPath,
			durationSec,
			audioState: "cancelled",
			intervals: [],
			ffmpegVersion: version,
			parameters,
			latencyMs: Date.now() - t0,
			cacheHit: false,
			error: run.error,
		};
	}
	if (run.state === "spawn_error") {
		return {
			assetId: args.assetId,
			mediaPath: args.mediaPath,
			durationSec,
			audioState: "malformed",
			intervals: [],
			ffmpegVersion: version,
			parameters,
			latencyMs: Date.now() - t0,
			cacheHit: false,
			error: run.error,
		};
	}

	const intervals = parseSilencedetectStderr(run.stderr);
	const result: SilenceDetectorResult = {
		assetId: args.assetId,
		mediaPath: args.mediaPath,
		durationSec,
		audioState: "present",
		intervals,
		ffmpegVersion: version,
		parameters,
		latencyMs: Date.now() - t0,
		cacheHit: false,
		stderrExcerpt: run.stderr.slice(0, 400),
	};

	if (!args.bypassCache) {
		await writeSilenceCache(cacheKey, result, args.cacheDir);
	}
	return result;
}
