/**
 * Zoom geometry — deterministic, no AI vision.
 */

import {
	effectiveZoomScale,
	MAX_ZOOM_SCALE,
	MIN_ZOOM_SCALE,
	type ZoomDepth,
} from "../../../../src/lib/ai-edition/timeline/zoom-scale";
import type { NormalizedRect } from "../types";

export type ZoomScaleValidity = "VALID" | "INVALID_SCALE" | "INVALID_FOCUS" | "INVALID_SPAN";

export interface ZoomGeometryVerification {
	scale: number;
	scaleValid: boolean;
	focus: { cx: number; cy: number };
	focusInUnitSquare: boolean;
	focusWithinScaleBounds: boolean;
	visibleSourceWindow: NormalizedRect;
	targetRegion: NormalizedRect | null;
	targetFullyVisible: boolean | null;
	targetPartiallyVisible: boolean | null;
	focusOffsetFromTargetCenter: { dx: number; dy: number } | null;
	status: ZoomScaleValidity | "TARGET_CLIPPED" | "OK";
	notes: string[];
}

/** Mirror of getFocusBoundsForScale — local copy to avoid renderer `@/` imports. */
export function focusBoundsForScale(zoomScale: number): {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
} {
	const margin = Math.min(0.5, 1 / (2 * zoomScale));
	return { minX: margin, maxX: 1 - margin, minY: margin, maxY: 1 - margin };
}

export function classifyZoomScale(scale: number): boolean {
	return Number.isFinite(scale) && scale >= MIN_ZOOM_SCALE - 1e-9 && scale <= MAX_ZOOM_SCALE + 1e-9;
}

export function focusInUnitSquare(focus: { cx: number; cy: number }): boolean {
	return (
		Number.isFinite(focus.cx) &&
		Number.isFinite(focus.cy) &&
		focus.cx >= 0 &&
		focus.cx <= 1 &&
		focus.cy >= 0 &&
		focus.cy <= 1
	);
}

/** Visible normalized source window for a zoom (square viewport assumption). */
export function visibleWindowForZoom(args: {
	focus: { cx: number; cy: number };
	scale: number;
}): NormalizedRect {
	const scale = Math.max(MIN_ZOOM_SCALE, args.scale);
	const half = 0.5 / scale;
	const bounds = focusBoundsForScale(scale);
	const cx = Math.min(bounds.maxX, Math.max(bounds.minX, args.focus.cx));
	const cy = Math.min(bounds.maxY, Math.max(bounds.minY, args.focus.cy));
	return {
		x: cx - half,
		y: cy - half,
		width: 1 / scale,
		height: 1 / scale,
	};
}

function rectsIntersect(a: NormalizedRect, b: NormalizedRect): boolean {
	return (
		a.x < b.x + b.width - 1e-9 &&
		a.x + a.width > b.x + 1e-9 &&
		a.y < b.y + b.height - 1e-9 &&
		a.y + a.height > b.y + 1e-9
	);
}

function rectContains(outer: NormalizedRect, inner: NormalizedRect, eps = 1e-6): boolean {
	return (
		inner.x >= outer.x - eps &&
		inner.y >= outer.y - eps &&
		inner.x + inner.width <= outer.x + outer.width + eps &&
		inner.y + inner.height <= outer.y + outer.height + eps
	);
}

export function verifyZoomGeometry(args: {
	depth: ZoomDepth;
	customScale?: number;
	focus: { cx: number; cy: number };
	startMs: number;
	endMs: number;
	targetRegion?: NormalizedRect | null;
}): ZoomGeometryVerification {
	const notes: string[] = [];
	const scale = effectiveZoomScale({ depth: args.depth, customScale: args.customScale });
	const scaleValid = classifyZoomScale(scale);
	if (!scaleValid) notes.push("invalid_scale");

	const focusOk = focusInUnitSquare(args.focus);
	if (!focusOk) notes.push("focus_outside_unit_square");

	const bounds = focusBoundsForScale(scale);
	const focusWithinScaleBounds =
		focusOk &&
		args.focus.cx >= bounds.minX - 1e-6 &&
		args.focus.cx <= bounds.maxX + 1e-6 &&
		args.focus.cy >= bounds.minY - 1e-6 &&
		args.focus.cy <= bounds.maxY + 1e-6;
	if (focusOk && !focusWithinScaleBounds) notes.push("focus_outside_scale_bounds");

	if (!(args.endMs > args.startMs)) notes.push("invalid_span");

	const visible = visibleWindowForZoom({ focus: args.focus, scale });
	const target = args.targetRegion ?? null;
	let targetFullyVisible: boolean | null = null;
	let targetPartiallyVisible: boolean | null = null;
	let focusOffsetFromTargetCenter: { dx: number; dy: number } | null = null;

	if (target) {
		targetFullyVisible = rectContains(visible, target);
		targetPartiallyVisible = rectsIntersect(visible, target);
		const tcx = target.x + target.width / 2;
		const tcy = target.y + target.height / 2;
		focusOffsetFromTargetCenter = {
			dx: args.focus.cx - tcx,
			dy: args.focus.cy - tcy,
		};
		if (!targetPartiallyVisible) notes.push("target_not_visible");
		else if (!targetFullyVisible) notes.push("target_partially_clipped");
	}

	let status: ZoomGeometryVerification["status"] = "OK";
	if (!(args.endMs > args.startMs)) status = "INVALID_SPAN";
	else if (!scaleValid) status = "INVALID_SCALE";
	else if (!focusOk) status = "INVALID_FOCUS";
	else if (target && targetFullyVisible === false) status = "TARGET_CLIPPED";

	return {
		scale,
		scaleValid,
		focus: args.focus,
		focusInUnitSquare: focusOk,
		focusWithinScaleBounds,
		visibleSourceWindow: visible,
		targetRegion: target,
		targetFullyVisible,
		targetPartiallyVisible,
		focusOffsetFromTargetCenter,
		status,
		notes,
	};
}
