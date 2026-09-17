/**
 * Canonical VisualAnalysisV1 runner — one source analysis, many consumers.
 * Strategy: reuse prepared → cache → Bug-3 sample + FFmpeg probes → derive.
 * TOTAL_PAID_AI_CALLS = 0.
 */

import { stat } from "node:fs/promises";
import { readCursorSidecar } from "../../media/cursorSidecar";
import { probeSourceDurations } from "../sourceTiming/probe";
import type { VisualChange } from "../visualEvidence/types";
import { readVisualAnalysisCache, writeVisualAnalysisCache } from "./cache";
import { sampleBug3ChangeEvents, visualChangesToEvents } from "./changeSample";
import { deriveActivityIntervals, deriveStableIntervals } from "./derive";
import { probeVisualFilters } from "./ffmpegProbes";
import { DEFAULT_VISUAL_ANALYSIS_PARAMETERS } from "./policy";
import type {
	BlackInterval,
	FreezeInterval,
	SceneEvent,
	VisualAnalysisParameters,
	VisualAnalysisV1,
	VisualChangeEvent,
} from "./types";
import { LOCAL_VISUAL_ANALYSIS_V1_PROVIDER_ID, VISUAL_ANALYSIS_DETECTOR_VERSION } from "./types";

export interface AnalyzeVisualArgs {
	assetId: string;
	mediaPath: string;
	/** Optional prepared Bug-3 changes — skips re-sampling when present. */
	preparedChanges?: VisualChange[] | null;
	parameters?: Partial<VisualAnalysisParameters>;
	/** Bound analysis (default: full source). */
	startSec?: number;
	endSec?: number;
	bypassCache?: boolean;
	cacheDir?: string;
	frameCacheDir?: string;
	/** Skip Bug-3 frame sampling (FFmpeg filters + cursor only). */
	skipChangeSampling?: boolean;
	/** Skip black/freeze/scene FFmpeg batch. */
	skipFfmpegProbes?: boolean;
	includeCursor?: boolean;
	timeoutMs?: number;
}

function mergeParams(partial?: Partial<VisualAnalysisParameters>): VisualAnalysisParameters {
	return { ...DEFAULT_VISUAL_ANALYSIS_PARAMETERS, ...partial };
}

async function collectCursorInstants(
	mediaPath: string,
	startSec: number,
	endSec: number,
): Promise<{ times: number[]; used: boolean }> {
	try {
		const sidecar = await readCursorSidecar(mediaPath, {});
		if (!sidecar.found) return { times: [], used: false };
		const times: number[] = [];
		for (const sample of sidecar.data.samples) {
			if (sample.interactionType === "move") continue;
			const t = sample.timeMs / 1000;
			if (t >= startSec - 1e-3 && t <= endSec + 1e-3) times.push(t);
		}
		return { times, used: true };
	} catch {
		return { times: [], used: false };
	}
}

export async function analyzeVisual(args: AnalyzeVisualArgs): Promise<VisualAnalysisV1> {
	const t0 = Date.now();
	const parameters = mergeParams(args.parameters);
	const notes: string[] = [];
	let mediaDecodePasses = 0;

	const durations = await probeSourceDurations(args.mediaPath).catch(() => null);
	const durationSec = durations?.videoStreamDurationSec ?? durations?.containerDurationSec ?? null;

	let fingerprint: VisualAnalysisV1["sourceFingerprint"] = null;
	try {
		const st = await stat(args.mediaPath);
		fingerprint = {
			path: args.mediaPath,
			size: st.size,
			mtimeMs: st.mtimeMs,
		};
	} catch {
		notes.push("fingerprint_unavailable");
	}

	const cacheParts = {
		mediaPath: args.mediaPath,
		parameters,
		detectorSuiteVersion: VISUAL_ANALYSIS_DETECTOR_VERSION,
	};

	if (!args.bypassCache && !args.preparedChanges?.length && !args.skipChangeSampling) {
		const hit = await readVisualAnalysisCache(cacheParts, args.cacheDir);
		if (hit) {
			return {
				...hit,
				cacheHit: true,
				latencyMs: Date.now() - t0,
				provenance: {
					...hit.provenance,
					notes: [...hit.provenance.notes, "cache_hit"],
				},
			};
		}
	}

	const covStart = Math.max(0, args.startSec ?? 0);
	const covEnd =
		args.endSec ?? (durationSec != null && durationSec > 0 ? durationSec : covStart + 60);
	const fullSource =
		covStart <= 1e-6 && (durationSec == null || Math.abs(covEnd - durationSec) < 0.15);

	let changeEvents: VisualChangeEvent[] = [];
	let reusedPrepared = false;

	if (args.preparedChanges && args.preparedChanges.length > 0) {
		reusedPrepared = true;
		changeEvents = visualChangesToEvents(args.preparedChanges, "prepared_reuse");
		notes.push("reused_prepared_changes");
	} else if (!args.skipChangeSampling && durationSec != null && durationSec > 0) {
		const sampled = await sampleBug3ChangeEvents({
			assetId: args.assetId,
			mediaPath: args.mediaPath,
			durationSec: Math.min(durationSec, covEnd),
			parameters,
			frameCacheDir: args.frameCacheDir,
		});
		changeEvents = sampled.events.filter(
			(e) => e.toSec >= covStart - 1e-6 && e.fromSec <= covEnd + 1e-6,
		);
		mediaDecodePasses += sampled.decodePasses;
		notes.push(`bug3_sample_ms=${sampled.latencyMs}`);
	} else if (args.skipChangeSampling) {
		notes.push("change_sampling_skipped");
	} else {
		notes.push("change_sampling_skipped_no_duration");
	}

	let sceneEvents: SceneEvent[] = [];
	let blackIntervals: BlackInterval[] = [];
	let freezeIntervals: FreezeInterval[] = [];
	let ffmpegVersion: string | null = null;

	if (!args.skipFfmpegProbes) {
		const probes = await probeVisualFilters({
			mediaPath: args.mediaPath,
			startSec: covStart,
			endSec: covEnd,
			parameters,
			timeoutMs: args.timeoutMs,
		});
		mediaDecodePasses += probes.mediaDecodePasses;
		ffmpegVersion = probes.ffmpegVersion;
		if (probes.errors.length) notes.push(...probes.errors.map((e) => `probe:${e}`));

		blackIntervals = probes.black.map((iv) => ({
			startSec: iv.startSec,
			endSec: iv.endSec,
			durationSec: iv.durationSec,
			detector: "ffmpeg_blackdetect" as const,
			observationOnly: true as const,
		}));
		freezeIntervals = probes.freeze.map((iv) => ({
			startSec: iv.startSec,
			endSec: iv.endSec,
			durationSec: iv.durationSec,
			detector: "ffmpeg_freezedetect" as const,
			observationOnly: true as const,
		}));
		sceneEvents = probes.sceneTimes.map((t) => ({
			timeSec: t,
			score: null,
			detector: "ffmpeg_scene_select" as const,
			sourceRange: { startSec: Math.max(covStart, t - 0.05), endSec: Math.min(covEnd, t + 0.05) },
			evidenceRefs: [
				{
					kind: "scene",
					id: `scene_${t.toFixed(3)}`,
					note: `scene threshold=${parameters.sceneThreshold}`,
				},
			],
		}));
		notes.push(`ffmpeg_probe_ms=${probes.latencyMs}`);
	} else {
		notes.push("ffmpeg_probes_skipped");
	}

	const includeCursor = args.includeCursor !== false;
	const cursor = includeCursor
		? await collectCursorInstants(args.mediaPath, covStart, covEnd)
		: { times: [], used: false };

	const spanDur = Math.max(covEnd, durationSec ?? covEnd);
	const activityIntervals = deriveActivityIntervals({
		durationSec: spanDur,
		changeEvents,
		sceneEvents,
		cursorInstants: cursor.times.map((sourceTimeSec) => ({ sourceTimeSec })),
		parameters,
	});

	const stableIntervals = deriveStableIntervals({
		durationSec: spanDur,
		activity: activityIntervals,
		parameters,
		freezeIntervals,
		blackIntervals,
	});

	const result: VisualAnalysisV1 = {
		version: 1,
		providerId: LOCAL_VISUAL_ANALYSIS_V1_PROVIDER_ID,
		assetId: args.assetId,
		mediaPath: args.mediaPath,
		durationSec,
		sourceFingerprint: fingerprint,
		timebase: "SOURCE_MEDIA_TIME",
		changeEvents,
		sceneEvents,
		blackIntervals,
		freezeIntervals,
		stableIntervals,
		activityIntervals,
		analysisCoverage: {
			startSec: covStart,
			endSec: covEnd,
			fullSource,
		},
		detectorVersions: {
			suite: VISUAL_ANALYSIS_DETECTOR_VERSION,
			bug3Thresholds: `minimal<=${parameters.changeMinimalMax}<moderate<=${parameters.changeModerateMax}<significant`,
			ffmpegVersion,
		},
		parameters,
		provenance: {
			reusedPreparedChanges: reusedPrepared,
			cursorSidecarUsed: cursor.used,
			mediaDecodePasses,
			notes,
		},
		latencyMs: Date.now() - t0,
		cacheHit: false,
	};

	if (!args.preparedChanges?.length && fullSource) {
		await writeVisualAnalysisCache(cacheParts, result, args.cacheDir).catch(() => {
			/* cache best-effort */
		});
	}

	return result;
}
