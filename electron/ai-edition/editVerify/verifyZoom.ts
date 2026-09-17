/**
 * Zoom verification — structural + geometry + native compositor samples.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { ZoomDepth } from "../../../src/lib/ai-edition/timeline/zoom-scale";
import type { CompositedFrameSampler } from "../compositorVerify/types";
import {
	editVerifyFrameCacheKey,
	getCachedEditVerifyFrame,
	setCachedEditVerifyFrame,
} from "./frameCache";
import { verifyZoomGeometry } from "./geometry/zoom";
import { assessZoomMustSurvive } from "./mustSurvive";
import {
	baseResult,
	collectLevels,
	emptyAudio,
	emptyLatency,
	emptyTemporal,
	finalizeStatus,
} from "./resultHelpers";
import { planProgrammeSamples } from "./samples";
import { inspectSceneEffects } from "./sceneInspect";
import type { EditVerificationResult, MustSurviveRequirement, NormalizedRect } from "./types";

export interface VerifyZoomArgs {
	operationId: string;
	document: AxcutDocument;
	documentFingerprint: string;
	zoom: {
		id: string;
		startSec: number;
		endSec: number;
		depth: ZoomDepth;
		focus: { cx: number; cy: number };
		customScale?: number;
	};
	targetRegion?: NormalizedRect | null;
	mustSurvive?: MustSurviveRequirement[];
	sampler?: CompositedFrameSampler | null;
	allowInjectedAsAuthoritative?: boolean;
	frameWidth?: number;
	frameHeight?: number;
	/** Force blank-frame failure path in tests. */
	forceBlankFailure?: boolean;
}

export async function verifyZoom(args: VerifyZoomArgs): Promise<EditVerificationResult> {
	const t0 = Date.now();
	const latency = emptyLatency();
	const blocking: string[] = [];
	const warnings: string[] = [];
	const evidence: EditVerificationResult["evidence"] = [];
	const claims: string[] = [];

	const tGeo0 = Date.now();
	const geometry = verifyZoomGeometry({
		depth: args.zoom.depth,
		customScale: args.zoom.customScale,
		focus: args.zoom.focus,
		startMs: Math.round(args.zoom.startSec * 1000),
		endMs: Math.round(args.zoom.endSec * 1000),
		targetRegion: args.targetRegion,
	});
	latency.geometryVerifyMs = Date.now() - tGeo0;

	const inDoc = args.document.zoomRanges.some((z) => z.id === args.zoom.id);
	const structural = {
		ok:
			inDoc &&
			geometry.status !== "INVALID_SCALE" &&
			geometry.status !== "INVALID_FOCUS" &&
			geometry.status !== "INVALID_SPAN",
		mutationPresent: inDoc,
		notes: [...geometry.notes],
	};
	if (!inDoc) blocking.push("zoom_missing_from_document");
	if (geometry.status === "INVALID_SCALE") blocking.push("invalid_zoom_scale");
	if (geometry.status === "INVALID_FOCUS") blocking.push("invalid_zoom_focus");
	if (geometry.status === "INVALID_SPAN") blocking.push("invalid_zoom_span");

	evidence.push({
		kind: "zoom_geometry",
		id: args.zoom.id,
		note: `status=${geometry.status} scale=${geometry.scale.toFixed(3)}`,
		metrics: {
			scale: geometry.scale,
			focusCx: geometry.focus.cx,
			focusCy: geometry.focus.cy,
			targetFullyVisible: geometry.targetFullyVisible,
		},
	});

	const midSource = (args.zoom.startSec + args.zoom.endSec) / 2;
	const tScene0 = Date.now();
	const scene = inspectSceneEffects({ document: args.document, sourceTimeSec: midSource });
	latency.sceneBuildMs = Date.now() - tScene0;

	const effectPresent =
		scene.zoomActiveAt &&
		scene.zoomScale != null &&
		Math.abs(scene.zoomScale - geometry.scale) < 0.05;
	if (!effectPresent) {
		blocking.push("zoom_effect_not_present_in_scene");
		structural.notes.push(...scene.notes);
	} else {
		claims.push("zoom_rendered_as_specified");
	}

	const temporal = emptyTemporal(true);
	temporal.programmeMappingOk = true;
	temporal.ok = true;
	temporal.notes.push("zoom_uses_source_authored_ms_projected_in_scene");

	const preservation = assessZoomMustSurvive({
		geometry,
		mustSurvive: args.mustSurvive ?? [],
	});
	if (geometry.status === "TARGET_CLIPPED") {
		preservation.ok = false;
		preservation.failedIds.push("focal_target");
		preservation.notes.push("focal_target_clipped");
		blocking.push("protected_target_clipped");
	}
	if (!preservation.ok) {
		blocking.push(...preservation.failedIds.map((id) => `must_survive_failed:${id}`));
	}

	let framesValid = true;
	let authoritative = false;
	const visualNotes: string[] = [];

	if (args.forceBlankFailure) {
		framesValid = false;
		blocking.push("blank_compositor_frame");
	} else if (args.sampler) {
		const plan = planProgrammeSamples({
			rangeStartSec: args.zoom.startSec,
			rangeEndSec: args.zoom.endSec,
		});
		const w = args.frameWidth ?? 64;
		const h = args.frameHeight ?? 36;
		let frameReadMs = 0;
		for (const t of [plan.before, plan.mid, plan.after].filter((x): x is number => x != null)) {
			const key = editVerifyFrameCacheKey({
				documentFingerprint: args.documentFingerprint,
				programmeTimeSec: t,
				width: w,
				height: h,
			});
			let frame = getCachedEditVerifyFrame(key);
			if (!frame) {
				const tFr0 = Date.now();
				frame = await args.sampler.sampleFrame({
					document: args.document,
					programmeTimeSec: t,
					width: w,
					height: h,
				});
				frameReadMs += Date.now() - tFr0;
				setCachedEditVerifyFrame(key, frame);
			}
			evidence.push({
				kind: "compositor_frame",
				id: frame.evidenceId,
				note: `t=${t} status=${frame.status}`,
				programmeTimeSec: t,
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
		}
		latency.frameReadMs = frameReadMs;
		if (!authoritative && framesValid) {
			warnings.push("frames_not_native_authoritative");
			visualNotes.push("injected_or_non_native_frames");
		}
	} else {
		warnings.push("no_compositor_sampler");
		visualNotes.push("compositor_sampling_skipped");
		// Without sampler, cannot claim RENDER_VALID / VISUAL ok for production,
		// but geometry+scene still run. Fail closed for full VERIFIED.
		framesValid = false;
		blocking.push("compositor_sampler_required");
	}

	const visual = {
		ok: effectPresent && geometry.status === "OK" && framesValid && authoritative,
		authoritative,
		effectPresent,
		geometryOk: geometry.status === "OK" || geometry.status === "TARGET_CLIPPED",
		framesValid,
		notes: visualNotes,
	};

	// Geometry-only failures already blocked; TARGET_CLIPPED is preservation fail.
	if (geometry.status === "OK" && structural.ok) claims.push("structural_valid");

	const audio = emptyAudio(true);
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
		operationType: "zoom",
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
