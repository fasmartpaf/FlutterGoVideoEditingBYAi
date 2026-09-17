/**
 * Crop verification — geometry + scene cropByClip + compositor frames.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { CompositedFrameSampler } from "../compositorVerify/types";
import {
	editVerifyFrameCacheKey,
	getCachedEditVerifyFrame,
	setCachedEditVerifyFrame,
} from "./frameCache";
import { classifyCrop, cropPreservesRegion } from "./geometry/crop";
import { assessCropMustSurvive } from "./mustSurvive";
import {
	baseResult,
	collectLevels,
	emptyAudio,
	emptyLatency,
	emptyTemporal,
	finalizeStatus,
} from "./resultHelpers";
import { inspectSceneEffects } from "./sceneInspect";
import type { EditVerificationResult, MustSurviveRequirement, NormalizedRect } from "./types";

export interface VerifyCropArgs {
	operationId: string;
	document: AxcutDocument;
	documentFingerprint: string;
	clipId: string;
	crop: NormalizedRect;
	mustSurvive?: MustSurviveRequirement[];
	sampler?: CompositedFrameSampler | null;
	allowInjectedAsAuthoritative?: boolean;
	frameWidth?: number;
	frameHeight?: number;
	programmeSampleSec?: number;
}

export async function verifyCrop(args: VerifyCropArgs): Promise<EditVerificationResult> {
	const t0 = Date.now();
	const latency = emptyLatency();
	const blocking: string[] = [];
	const warnings: string[] = [];
	const evidence: EditVerificationResult["evidence"] = [];
	const claims: string[] = [];

	const clip = args.document.timeline.clips.find((c) => c.id === args.clipId);
	const tGeo0 = Date.now();
	const geometry = classifyCrop({ crop: args.crop });
	latency.geometryVerifyMs = Date.now() - tGeo0;

	const cropOnClip =
		clip?.cropRegion != null &&
		Math.abs(clip.cropRegion.x - args.crop.x) < 1e-6 &&
		Math.abs(clip.cropRegion.y - args.crop.y) < 1e-6 &&
		Math.abs(clip.cropRegion.width - args.crop.width) < 1e-6 &&
		Math.abs(clip.cropRegion.height - args.crop.height) < 1e-6;

	const structural = {
		ok:
			clip != null &&
			cropOnClip &&
			(geometry.classification === "VALID_CROP" || geometry.classification === "EXTREME_CROP"),
		mutationPresent: cropOnClip,
		notes: [...geometry.notes],
	};
	if (!clip) blocking.push("unknown_clip");
	if (!cropOnClip) blocking.push("crop_missing_from_document");
	if (geometry.classification === "EMPTY_CROP") blocking.push("empty_crop");
	if (geometry.classification === "OUT_OF_BOUNDS") blocking.push("out_of_bounds_crop");

	evidence.push({
		kind: "crop_geometry",
		id: args.clipId,
		note: `class=${geometry.classification} area=${geometry.area.toFixed(4)}`,
		metrics: { area: geometry.area, classification: geometry.classification },
	});

	if (geometry.classification === "VALID_CROP") claims.push("crop_geometry_valid");

	const clipIndex = args.document.timeline.clips.findIndex((c) => c.id === args.clipId);
	const sampleSec =
		args.programmeSampleSec ?? ((clip?.timelineStartSec ?? 0) + (clip?.timelineEndSec ?? 1)) / 2;
	const tScene0 = Date.now();
	const scene = inspectSceneEffects({
		document: args.document,
		sourceTimeSec: sampleSec,
		clipIndex: clipIndex >= 0 ? clipIndex : 0,
	});
	latency.sceneBuildMs = Date.now() - tScene0;

	const effectPresent =
		scene.cropOnClip != null &&
		Math.abs(scene.cropOnClip.width - args.crop.width) < 1e-4 &&
		Math.abs(scene.cropOnClip.height - args.crop.height) < 1e-4;
	if (!effectPresent) blocking.push("crop_effect_not_present_in_scene");

	const temporal = emptyTemporal(true);
	temporal.ok = true;
	temporal.programmeMappingOk = true;

	const preservation = assessCropMustSurvive({
		crop: args.crop,
		mustSurvive: args.mustSurvive ?? [],
	});
	for (const req of args.mustSurvive ?? []) {
		if (req.kind === "normalized_region" && req.region) {
			if (!cropPreservesRegion(args.crop, req.region, "center")) {
				blocking.push(`protected_region_excluded:${req.id}`);
			}
		}
	}
	if (!preservation.ok) {
		blocking.push(...preservation.failedIds.map((id) => `must_survive_failed:${id}`));
	}

	let framesValid = true;
	let authoritative = false;
	const visualNotes: string[] = [];

	if (args.sampler) {
		const w = args.frameWidth ?? 64;
		const h = args.frameHeight ?? 36;
		const key = editVerifyFrameCacheKey({
			documentFingerprint: args.documentFingerprint,
			programmeTimeSec: sampleSec,
			width: w,
			height: h,
		});
		let frame = getCachedEditVerifyFrame(key);
		const tFr0 = Date.now();
		if (!frame) {
			frame = await args.sampler.sampleFrame({
				document: args.document,
				programmeTimeSec: sampleSec,
				width: w,
				height: h,
			});
			setCachedEditVerifyFrame(key, frame);
		}
		latency.frameReadMs = Date.now() - tFr0;
		evidence.push({
			kind: "compositor_frame",
			id: frame.evidenceId,
			note: `crop_sample status=${frame.status}`,
			programmeTimeSec: sampleSec,
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
		if (!authoritative && framesValid) warnings.push("frames_not_native_authoritative");
	} else {
		framesValid = false;
		blocking.push("compositor_sampler_required");
		visualNotes.push("compositor_sampling_skipped");
	}

	const visual = {
		ok:
			effectPresent &&
			geometry.classification === "VALID_CROP" &&
			framesValid &&
			authoritative &&
			preservation.ok,
		authoritative,
		effectPresent,
		geometryOk: geometry.classification === "VALID_CROP",
		framesValid,
		notes: visualNotes,
	};

	const audio = emptyAudio(true);
	const levels = collectLevels({ structural, temporal, visual, audio, preservation });
	latency.totalVerifyMs = Date.now() - t0;
	latency.totalMs = latency.totalVerifyMs;

	const uniqueBlocking = [...new Set(blocking)];
	return baseResult({
		operationType: "crop",
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
