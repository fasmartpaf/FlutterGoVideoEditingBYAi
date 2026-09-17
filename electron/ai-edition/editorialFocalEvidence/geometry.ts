/**
 * Zoom geometry from grounded normalized region — restrained, deterministic.
 */

import {
	effectiveZoomScale,
	type ZoomDepth,
} from "../../../src/lib/ai-edition/timeline/zoom-scale";
import { focusBoundsForScale, visibleWindowForZoom } from "../editVerify/geometry/zoom";
import { FOCAL_POLICY_V1 } from "./policy";
import type {
	GroundedEditorialFocalTargetV1,
	NormalizedRegionV1,
	ZoomGeometryProposalV1,
} from "./types";

function clampFocus(cx: number, cy: number, scale: number): { cx: number; cy: number } {
	const b = focusBoundsForScale(scale);
	return {
		cx: Math.min(b.maxX, Math.max(b.minX, cx)),
		cy: Math.min(b.maxY, Math.max(b.minY, cy)),
	};
}

/**
 * Choose depth so the target region is meaningfully smaller than the frame
 * but still fully contained in the visible window when possible.
 */
export function deriveZoomGeometry(
	target: GroundedEditorialFocalTargetV1,
): ZoomGeometryProposalV1 | null {
	if (target.status !== "GROUNDED") return null;
	const area = target.normalizedRegion.width * target.normalizedRegion.height;
	if (area >= FOCAL_POLICY_V1.maxTargetArea || area < FOCAL_POLICY_V1.minTargetArea) {
		return null;
	}
	const dur = target.sourceRange.endSec - target.sourceRange.startSec;
	if (dur < FOCAL_POLICY_V1.minGroundedPersistSec) return null;

	let depth: ZoomDepth = FOCAL_POLICY_V1.defaultZoomDepth;
	// Larger targets → milder zoom
	if (area > 0.28) depth = 1;
	else if (area < 0.08) depth = Math.min(FOCAL_POLICY_V1.maxZoomDepth, 3) as ZoomDepth;

	const scale = effectiveZoomScale({ depth });
	const focus = clampFocus(target.focalPoint.cx, target.focalPoint.cy, scale);
	const visibleWindow: NormalizedRegionV1 = visibleWindowForZoom({ focus, scale });

	// Ensure target center lies inside visible window
	const cx = target.focalPoint.cx;
	const cy = target.focalPoint.cy;
	const inside =
		cx >= visibleWindow.x &&
		cx <= visibleWindow.x + visibleWindow.width &&
		cy >= visibleWindow.y &&
		cy <= visibleWindow.y + visibleWindow.height;
	if (!inside) return null;

	// Clamp to a professional enter→hold→exit window around the interaction core.
	let start = target.sourceRange.startSec;
	let end = target.sourceRange.endSec;
	const span = end - start;
	if (span > FOCAL_POLICY_V1.maxZoomHoldSec) {
		const mid = (start + end) / 2;
		const half = FOCAL_POLICY_V1.maxZoomHoldSec / 2;
		start = Math.max(target.sourceRange.startSec, mid - half);
		end = Math.min(target.sourceRange.endSec, start + FOCAL_POLICY_V1.maxZoomHoldSec);
		if (end - start < FOCAL_POLICY_V1.minGroundedPersistSec) {
			start = target.sourceRange.startSec;
			end = Math.min(target.sourceRange.endSec, start + FOCAL_POLICY_V1.maxZoomHoldSec);
		}
	}

	return {
		focalPoint: focus,
		depth: depth as 1 | 2 | 3,
		scale,
		sourceStartSec: start,
		sourceEndSec: end,
		visibleWindow,
	};
}
