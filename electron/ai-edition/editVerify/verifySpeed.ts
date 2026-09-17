/**
 * Speed verification — timing math + scene presence + optional PCM duration check.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { CompositedFrameSampler } from "../compositorVerify/types";
import {
	editVerifyFrameCacheKey,
	getCachedEditVerifyFrame,
	setCachedEditVerifyFrame,
} from "./frameCache";
import { assessSpeedMustSurvive } from "./mustSurvive";
import { baseResult, collectLevels, emptyLatency, finalizeStatus } from "./resultHelpers";
import { inspectSceneEffects } from "./sceneInspect";
import { verifySpeedTiming } from "./speedMath";
import type { EditVerificationResult, MustSurviveRequirement } from "./types";

export interface VerifySpeedArgs {
	operationId: string;
	document: AxcutDocument;
	documentFingerprint: string;
	speed: {
		id: string;
		startSec: number;
		endSec: number;
		multiplier: number;
	};
	mustSurvive?: MustSurviveRequirement[];
	sampler?: CompositedFrameSampler | null;
	allowInjectedAsAuthoritative?: boolean;
	/** Optional audio duration probe (seconds). */
	measuredAudioDurationSec?: number | null;
	/** Force audio failure. */
	forceAudioFailure?: boolean;
	frameWidth?: number;
	frameHeight?: number;
}

function findLegacySpeed(
	document: AxcutDocument,
	id: string,
): { id: string; startMs: number; endMs: number; speed: number } | null {
	const legacy = (document.legacyEditor as Record<string, unknown> | null)?.speedRegions as
		| Array<{ id: string; startMs: number; endMs: number; speed: number }>
		| undefined;
	return legacy?.find((s) => s.id === id) ?? null;
}

export async function verifySpeed(args: VerifySpeedArgs): Promise<EditVerificationResult> {
	const t0 = Date.now();
	const latency = emptyLatency();
	const blocking: string[] = [];
	const warnings: string[] = [];
	const evidence: EditVerificationResult["evidence"] = [];
	const claims: string[] = [];

	const stored = findLegacySpeed(args.document, args.speed.id);
	const tGeo0 = Date.now();
	const timing = verifySpeedTiming({
		multiplier: args.speed.multiplier,
		sourceStartSec: args.speed.startSec,
		sourceEndSec: args.speed.endSec,
		measuredProgrammeDurationSec: timingMeasured(args),
	});
	latency.geometryVerifyMs = Date.now() - tGeo0;

	const structural = {
		ok:
			stored != null &&
			Math.abs(stored.speed - args.speed.multiplier) < 1e-6 &&
			timing.multiplierValid,
		mutationPresent: stored != null,
		notes: [...timing.notes],
	};
	if (!stored) blocking.push("speed_missing_from_document");
	if (!timing.multiplierValid) blocking.push("invalid_speed_multiplier");

	evidence.push({
		kind: "speed_timing",
		id: args.speed.id,
		note: `M=${args.speed.multiplier} expectedProg=${timing.expectedProgrammeDurationSec.toFixed(4)}`,
		metrics: {
			multiplier: args.speed.multiplier,
			expectedProgrammeDurationSec: timing.expectedProgrammeDurationSec,
			sourceDurationSec: timing.sourceDurationSec,
		},
	});

	const mid = (args.speed.startSec + args.speed.endSec) / 2;
	const tScene0 = Date.now();
	const scene = inspectSceneEffects({ document: args.document, sourceTimeSec: mid });
	latency.sceneBuildMs = Date.now() - tScene0;

	const effectPresent =
		scene.speedActiveAt &&
		scene.speedMultiplier != null &&
		Math.abs(scene.speedMultiplier - args.speed.multiplier) < 1e-3;
	if (!effectPresent) blocking.push("speed_effect_not_present_in_scene");

	const temporal = {
		ok: timing.ok && effectPresent,
		programmeMappingOk: timing.ok,
		expectedProgrammeDurationSec: timing.expectedProgrammeDurationSec,
		measuredProgrammeDurationSec: timingMeasured(args),
		notes: [...timing.notes],
	};
	if (!timing.ok) blocking.push("speed_timing_invalid");
	else claims.push("speed_timing_valid");

	const preservation = assessSpeedMustSurvive({
		mustSurvive: args.mustSurvive ?? [],
		regionSourceStartSec: args.speed.startSec,
		regionSourceEndSec: args.speed.endSec,
		programmeStartSec: args.speed.startSec, // no trims: programme≈source at region start for 1× prefix
		multiplier: args.speed.multiplier,
	});

	let framesValid = true;
	let authoritative = false;
	if (args.sampler) {
		const w = args.frameWidth ?? 64;
		const h = args.frameHeight ?? 36;
		const key = editVerifyFrameCacheKey({
			documentFingerprint: args.documentFingerprint,
			programmeTimeSec: mid,
			width: w,
			height: h,
		});
		const tFr0 = Date.now();
		let frame = getCachedEditVerifyFrame(key);
		if (!frame) {
			frame = await args.sampler.sampleFrame({
				document: args.document,
				programmeTimeSec: mid,
				width: w,
				height: h,
			});
			setCachedEditVerifyFrame(key, frame);
		}
		latency.frameReadMs = Date.now() - tFr0;
		evidence.push({
			kind: "compositor_frame",
			id: frame.evidenceId,
			note: `speed_mid status=${frame.status}`,
			programmeTimeSec: mid,
		});
		if (frame.status === "unavailable") {
			blocking.push("native_compositor_unavailable");
			framesValid = false;
		} else if (frame.status !== "ok" || frame.pixelStats?.valid === false) {
			blocking.push("invalid_compositor_frame");
			framesValid = false;
		} else {
			authoritative =
				frame.frameProvider === "native_compositor" ||
				(args.allowInjectedAsAuthoritative === true && frame.frameProvider === "injected_test");
		}
	} else {
		framesValid = false;
		blocking.push("compositor_sampler_required");
	}

	const tAud0 = Date.now();
	let audioOk = true;
	const audioNotes: string[] = [];
	let audioRan = false;
	if (args.forceAudioFailure) {
		audioRan = true;
		audioOk = false;
		blocking.push("audio_verification_failed");
		audioNotes.push("forced_audio_failure");
	} else if (args.measuredAudioDurationSec != null) {
		audioRan = true;
		const expected = timing.expectedProgrammeDurationSec;
		const delta = Math.abs(args.measuredAudioDurationSec - expected);
		if (delta > timing.toleranceSec) {
			audioOk = false;
			blocking.push("audio_duration_mismatch");
			audioNotes.push(`audio_delta=${delta.toFixed(4)}`);
		} else {
			claims.push("audio_valid");
			audioNotes.push("audio_duration_tracks_programme");
		}
	} else {
		audioNotes.push("audio_probe_not_provided_atempo_path_assumed_via_scene");
		// V1: without PCM probe, audio slice stays ok but not AUDIO_VALID level.
		audioOk = true;
		audioRan = false;
	}
	latency.audioVerifyMs = Date.now() - tAud0;

	const visual = {
		ok: effectPresent && framesValid && authoritative,
		authoritative,
		effectPresent,
		geometryOk: timing.ok,
		framesValid,
		notes: [],
	};

	const audio = { ok: audioOk, ran: audioRan, notes: audioNotes };
	const levels = collectLevels({
		structural,
		temporal,
		visual,
		audio,
		preservation,
	});
	latency.totalVerifyMs = Date.now() - t0;
	latency.totalMs = latency.totalVerifyMs;

	const uniqueBlocking = [...new Set(blocking)];
	return baseResult({
		operationType: "speed",
		operationId: args.operationId,
		status: finalizeStatus(levels, uniqueBlocking),
		levelsAchieved: levels,
		structural,
		temporal,
		visual,
		audio,
		preservation,
		evidence,
		warnings,
		blockingReasons: uniqueBlocking,
		latencyMs: latency,
		claims: [...new Set(claims)],
	});
}

function timingMeasured(args: VerifySpeedArgs): number | null {
	if (args.measuredAudioDurationSec != null) return args.measuredAudioDurationSec;
	// Without external measure, use pure math expectation as self-check (still validates formula).
	return null;
}
