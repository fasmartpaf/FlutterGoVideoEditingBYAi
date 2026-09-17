/**
 * Local FFmpeg loudnorm analysis (print_format=json).
 * Path is argv only — never shell-concatenated.
 */

import { spawn } from "node:child_process";
import { resolveFfmpeg } from "../../media/audioPeaks";
import { probeSourceDurations } from "../sourceTiming/probe";
import { probeAudioStream } from "../speechEvidence/probe";
import { type LoudnessCacheKeyParts, readLoudnessCache, writeLoudnessCache } from "./cache";
import { parseFfmpegVersionBanner, parseLoudnormPrintJson } from "./parseLoudnorm";
import { DEFAULT_LOUDNESS_TARGET_POLICY } from "./policy";
import type { LoudnessAnalysisV1, LoudnessTargetPolicy } from "./types";
import { LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID, LOUDNESS_MEASUREMENT_VERSION } from "./types";

export interface AnalyzeLoudnessArgs {
	assetId: string;
	mediaPath: string;
	policy?: LoudnessTargetPolicy;
	/** Apply linear volume before measure (post-apply verification). */
	preVolumeDb?: number;
	signal?: AbortSignal;
	bypassCache?: boolean;
	cacheDir?: string;
	timeoutMs?: number;
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
			resolve(parseFfmpegVersionBanner(out));
		});
		child.on("error", () => {
			clearTimeout(t);
			resolve(null);
		});
	});
}

function emptyAnalysis(
	partial: Partial<LoudnessAnalysisV1> &
		Pick<LoudnessAnalysisV1, "assetId" | "mediaPath" | "audioState" | "parameters" | "latencyMs">,
): LoudnessAnalysisV1 {
	return {
		version: 1,
		measurementVersion: LOUDNESS_MEASUREMENT_VERSION,
		providerId: LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID,
		analysisDomain: "PRIMARY_SOURCE_AUDIO",
		integratedLufs: null,
		truePeakDbTp: null,
		loudnessRangeLra: null,
		thresholdLufs: null,
		durationSec: null,
		ffmpegVersion: null,
		cacheHit: false,
		...partial,
	};
}

export async function analyzeLoudness(args: AnalyzeLoudnessArgs): Promise<LoudnessAnalysisV1> {
	const policy = args.policy ?? DEFAULT_LOUDNESS_TARGET_POLICY;
	const parameters = {
		targetIntegratedLufs: policy.targetIntegratedLufs,
		maxTruePeakDbTp: policy.maxTruePeakDbTp,
		lra: 11,
	};
	const t0 = Date.now();
	const preVolumeDb = args.preVolumeDb ?? 0;
	const timeoutMs = args.timeoutMs ?? 90_000;

	const ffmpeg = resolveFfmpeg();
	if (!ffmpeg) {
		return emptyAnalysis({
			assetId: args.assetId,
			mediaPath: args.mediaPath,
			audioState: "ffmpeg_unavailable",
			parameters,
			latencyMs: Date.now() - t0,
			error: "ffmpeg executable not found",
		});
	}

	const version = await readVersion(ffmpeg);
	const probe = await probeAudioStream(args.mediaPath);
	const durations = await probeSourceDurations(args.mediaPath).catch(() => null);
	const durationSec =
		durations?.containerDurationSec ??
		durations?.audioStreamDurationSec ??
		durations?.videoStreamDurationSec ??
		null;

	if (probe.present === false) {
		return emptyAnalysis({
			assetId: args.assetId,
			mediaPath: args.mediaPath,
			audioState: "absent",
			parameters,
			durationSec,
			ffmpegVersion: version,
			latencyMs: Date.now() - t0,
			error: probe.reason,
		});
	}
	if (probe.present === null) {
		return emptyAnalysis({
			assetId: args.assetId,
			mediaPath: args.mediaPath,
			audioState: "probe_failed",
			parameters,
			durationSec,
			ffmpegVersion: version,
			latencyMs: Date.now() - t0,
			error: probe.reason,
		});
	}

	const cacheKey: LoudnessCacheKeyParts = {
		mediaPath: args.mediaPath,
		targetIntegratedLufs: parameters.targetIntegratedLufs,
		maxTruePeakDbTp: parameters.maxTruePeakDbTp,
		lra: parameters.lra,
		preVolumeDb,
	};

	if (!args.bypassCache) {
		const cached = await readLoudnessCache(cacheKey, args.cacheDir);
		if (cached) {
			return {
				...cached,
				assetId: args.assetId,
				latencyMs: Date.now() - t0,
				cacheHit: true,
			};
		}
	}

	const loudnorm = `loudnorm=I=${parameters.targetIntegratedLufs}:TP=${parameters.maxTruePeakDbTp}:LRA=${parameters.lra}:print_format=json`;
	const af =
		Math.abs(preVolumeDb) > 1e-6 ? `volume=${preVolumeDb.toFixed(3)}dB,${loudnorm}` : loudnorm;

	const run = await new Promise<{
		stderr: string;
		state: "ok" | "timeout" | "cancelled" | "spawn_error";
		error?: string;
	}>((resolve) => {
		if (args.signal?.aborted) {
			resolve({ stderr: "", state: "cancelled", error: "aborted before spawn" });
			return;
		}
		const child = spawn(
			ffmpeg,
			["-hide_banner", "-nostats", "-i", args.mediaPath, "-af", af, "-f", "null", "-"],
			{ stdio: ["ignore", "ignore", "pipe"] },
		);
		let stderr = "";
		child.stderr?.on("data", (c: Buffer) => {
			stderr += c.toString("utf8");
		});
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			resolve({ stderr, state: "timeout", error: "loudnorm timed out" });
		}, timeoutMs);
		const onAbort = () => child.kill("SIGKILL");
		args.signal?.addEventListener("abort", onAbort, { once: true });
		child.on("close", () => {
			clearTimeout(timer);
			args.signal?.removeEventListener("abort", onAbort);
			if (args.signal?.aborted) {
				resolve({ stderr, state: "cancelled", error: "analysis cancelled" });
				return;
			}
			resolve({ stderr, state: "ok" });
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			args.signal?.removeEventListener("abort", onAbort);
			resolve({ stderr, state: "spawn_error", error: err.message });
		});
	});

	if (run.state !== "ok") {
		return emptyAnalysis({
			assetId: args.assetId,
			mediaPath: args.mediaPath,
			audioState:
				run.state === "timeout" ? "timeout" : run.state === "cancelled" ? "cancelled" : "malformed",
			parameters,
			durationSec,
			ffmpegVersion: version,
			latencyMs: Date.now() - t0,
			error: run.error,
			stderrExcerpt: run.stderr.slice(0, 600),
		});
	}

	const parsed = parseLoudnormPrintJson(run.stderr);
	if (!parsed) {
		return emptyAnalysis({
			assetId: args.assetId,
			mediaPath: args.mediaPath,
			audioState: "parse_failed",
			parameters,
			durationSec,
			ffmpegVersion: version,
			latencyMs: Date.now() - t0,
			error: "failed to parse loudnorm JSON",
			stderrExcerpt: run.stderr.slice(0, 600),
		});
	}

	const result: LoudnessAnalysisV1 = {
		version: 1,
		measurementVersion: LOUDNESS_MEASUREMENT_VERSION,
		providerId: LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID,
		assetId: args.assetId,
		mediaPath: args.mediaPath,
		analysisDomain: "PRIMARY_SOURCE_AUDIO",
		audioState: "present",
		integratedLufs: parsed.inputIntegratedLufs,
		truePeakDbTp: parsed.inputTruePeakDbTp,
		loudnessRangeLra: parsed.inputLra,
		thresholdLufs: parsed.inputThresholdLufs,
		durationSec,
		ffmpegVersion: version,
		parameters,
		latencyMs: Date.now() - t0,
		cacheHit: false,
		stderrExcerpt: run.stderr.slice(0, 400),
	};

	if (!args.bypassCache) {
		await writeLoudnessCache(cacheKey, result, args.cacheDir);
	}
	return result;
}
