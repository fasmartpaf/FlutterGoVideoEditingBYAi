/**
 * Graphic / title / callout verification for Verified Apply Preview.
 * Scene identity + timing + compositor frame presence (no OCR).
 */

import type { AxcutAnnotationRegion, AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { CompositedFrameSampler } from "../compositorVerify/types";

export const GRAPHIC_VERIFY_PROVIDER_ID = "CURRENT_OPENSCREEN_GRAPHIC_VERIFIED_APPLY_V1" as const;

export interface GraphicVerifyResult {
	passed: boolean;
	annotationId: string | null;
	kind: string | null;
	sampledProgrammeTimes: number[];
	blockingReasons: string[];
	notes: string[];
	frameProvider: string | null;
	authoritativeSatisfied: boolean;
	liveVerifiedGraphicRender: boolean;
	verifyMs: number;
}

function newAnnotations(before: AxcutDocument, after: AxcutDocument): AxcutAnnotationRegion[] {
	const beforeIds = new Set((before.annotations ?? []).map((a) => a.id));
	return (after.annotations ?? []).filter((a) => !beforeIds.has(a.id));
}

function programmeMidSec(ann: AxcutAnnotationRegion): number {
	const start = ann.startMs / 1000;
	const end = ann.endMs / 1000;
	return start + Math.max(0.05, (end - start) / 2);
}

export async function verifyGraphicAnnotation(args: {
	beforeDocument: AxcutDocument;
	afterDocument: AxcutDocument;
	expected: {
		kind?: string;
		text?: string;
		startSec?: number;
		endSec?: number;
		x?: number;
		y?: number;
	};
	sampler?: CompositedFrameSampler;
	allowInjectedAsAuthoritative?: boolean;
	requireNativeAuthoritative?: boolean;
}): Promise<GraphicVerifyResult> {
	const t0 = Date.now();
	const notes: string[] = [];
	const blocking: string[] = [];
	const added = newAnnotations(args.beforeDocument, args.afterDocument);
	if (added.length < 1) {
		blocking.push("requested_graphic_not_found");
		return {
			passed: false,
			annotationId: null,
			kind: null,
			sampledProgrammeTimes: [],
			blockingReasons: blocking,
			notes,
			frameProvider: null,
			authoritativeSatisfied: false,
			liveVerifiedGraphicRender: false,
			verifyMs: Date.now() - t0,
		};
	}
	if (added.length > 1) notes.push("multiple_new_annotations");

	const ann = added[0]!;
	const text = (ann.textContent ?? ann.content ?? "").trim();
	if (args.expected.text && text.length > 0) {
		const expectNorm = args.expected.text.trim().toLowerCase();
		const gotNorm = text.toLowerCase();
		if (!gotNorm.includes(expectNorm.slice(0, Math.min(12, expectNorm.length)))) {
			blocking.push("graphic_text_mismatch");
		}
	} else if (args.expected.text && text.length === 0 && args.expected.kind === "title") {
		blocking.push("graphic_text_empty");
	}

	const startSec = ann.startMs / 1000;
	const endSec = ann.endMs / 1000;
	if (!(endSec > startSec)) blocking.push("graphic_invalid_span");
	if (
		typeof args.expected.startSec === "number" &&
		Math.abs(startSec - args.expected.startSec) > 0.35
	) {
		blocking.push("graphic_start_timing_mismatch");
	}
	if (typeof args.expected.endSec === "number" && Math.abs(endSec - args.expected.endSec) > 0.5) {
		blocking.push("graphic_end_timing_mismatch");
	}

	const x = ann.position?.x;
	const y = ann.position?.y;
	if (typeof x !== "number" || typeof y !== "number" || x < 0 || x > 100 || y < 0 || y > 100) {
		blocking.push("graphic_position_out_of_bounds");
	}
	if (
		typeof args.expected.x === "number" &&
		typeof x === "number" &&
		Math.abs(x - args.expected.x) > 8
	) {
		blocking.push("graphic_x_mismatch");
	}
	if (
		typeof args.expected.y === "number" &&
		typeof y === "number" &&
		Math.abs(y - args.expected.y) > 8
	) {
		blocking.push("graphic_y_mismatch");
	}

	const w = ann.size?.width ?? 0;
	const h = ann.size?.height ?? 0;
	if (!(w > 0 && h > 0) || w > 100 || h > 100) {
		blocking.push("graphic_frame_bounds_unsafe");
	}
	// Annotation position is a layout anchor (often center for titles). Do not
	// treat (x,y)+(w,h) as a strict top-left AABB against the frame.

	const mid = programmeMidSec(ann);
	const sampled = [Math.max(0, startSec + 0.05), mid, Math.max(0, endSec - 0.05)];
	let frameProvider: string | null = null;
	let authoritative = false;
	let live = false;

	if (args.sampler) {
		const requireNative = args.requireNativeAuthoritative === true;
		try {
			for (const t of sampled) {
				const frame = await args.sampler.sampleFrame({
					document: args.afterDocument,
					programmeTimeSec: t,
				});
				frameProvider = frame.frameProvider ?? frameProvider;
				if (frame.status !== "ok" || frame.width < 2 || frame.height < 2) {
					blocking.push(`graphic_frame_invalid@${t.toFixed(2)}`);
					continue;
				}
				if (frame.pixelStats) {
					if (frame.pixelStats.entirelyTransparent || !frame.pixelStats.valid) {
						blocking.push(`graphic_frame_blank@${t.toFixed(2)}`);
					} else {
						live = true;
					}
				} else if (frame.rgba && frame.rgba.length >= 4) {
					let nonBlank = false;
					for (let i = 0; i < frame.rgba.length; i += 64) {
						if (frame.rgba[i]! > 8 || frame.rgba[i + 1]! > 8 || frame.rgba[i + 2]! > 8) {
							nonBlank = true;
							break;
						}
					}
					if (!nonBlank) blocking.push(`graphic_frame_blank@${t.toFixed(2)}`);
					else live = true;
				} else {
					notes.push(`graphic_frame_no_pixels@${t.toFixed(2)}`);
					live = true;
				}
			}
			const isNative = frameProvider === "native_compositor" || frameProvider === "injected_test";
			authoritative =
				(args.allowInjectedAsAuthoritative === true && frameProvider === "injected_test") ||
				(frameProvider === "native_compositor" && live) ||
				(args.allowInjectedAsAuthoritative === true && live);
			if (requireNative && !authoritative) {
				blocking.push("native_compositor_required_for_live_verified");
			}
			void isNative;
		} catch (err) {
			blocking.push(
				err instanceof Error && /unavailable|not.?found/i.test(err.message)
					? "native_compositor_unavailable"
					: `graphic_sample_error:${err instanceof Error ? err.message.slice(0, 80) : String(err)}`,
			);
		}
	} else if (args.requireNativeAuthoritative) {
		blocking.push("native_compositor_unavailable");
	} else {
		notes.push("graphic_metadata_only_no_sampler");
		authoritative = false;
	}

	return {
		passed: blocking.length === 0,
		annotationId: ann.id,
		kind: ann.type,
		sampledProgrammeTimes: sampled,
		blockingReasons: blocking,
		notes,
		frameProvider,
		authoritativeSatisfied: authoritative,
		liveVerifiedGraphicRender: live && authoritative,
		verifyMs: Date.now() - t0,
	};
}
