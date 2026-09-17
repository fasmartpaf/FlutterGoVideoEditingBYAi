/**
 * Normalized caption safe-area geometry (aspect-aware).
 * Reuses product captionSafeColumn / inset conventions as fractions 0..1.
 */

import {
	captionSafeColumn,
	defaultCaptionInsetX,
	defaultCaptionInsetY,
} from "../../../src/lib/ai-edition/captions/settings";
import type { CaptionSafeArea, NormalizedRect } from "./types";

function pctToFrac(pct: number): number {
	return pct / 100;
}

export function buildCaptionSafeArea(aspectValue: number): CaptionSafeArea {
	const columnPct = captionSafeColumn(aspectValue);
	const insetYPct = defaultCaptionInsetY(aspectValue);
	const insetXPct = defaultCaptionInsetX(aspectValue);
	const margin = {
		top: pctToFrac(insetYPct),
		bottom: pctToFrac(insetYPct),
		left: pctToFrac(Math.max(insetXPct, columnPct.x)),
		right: pctToFrac(Math.max(insetXPct, 100 - columnPct.x - columnPct.width)),
	};
	const column: NormalizedRect = {
		x: pctToFrac(columnPct.x),
		y: margin.top,
		width: pctToFrac(columnPct.width),
		height: Math.max(0.05, 1 - margin.top - margin.bottom),
	};
	// BBC-ish title safe ≈ 80–90% interior.
	const titleSafe: NormalizedRect = {
		x: 0.1,
		y: 0.1,
		width: 0.8,
		height: 0.8,
	};
	return { aspectValue, margin, column, titleSafe };
}

export function placementBox(
	placement: "BOTTOM_CENTER" | "TOP_CENTER" | "BOTTOM_LEFT" | "BOTTOM_RIGHT",
	safe: CaptionSafeArea,
	boxHeightFrac: number,
): NormalizedRect {
	const h = Math.min(boxHeightFrac, safe.column.height * 0.55);
	const w = safe.column.width;
	const yBottom = 1 - safe.margin.bottom - h;
	const yTop = safe.margin.top;
	switch (placement) {
		case "TOP_CENTER":
			return { x: safe.column.x, y: yTop, width: w, height: h };
		case "BOTTOM_LEFT":
			return {
				x: safe.margin.left,
				y: yBottom,
				width: Math.min(w, 0.45),
				height: h,
			};
		case "BOTTOM_RIGHT":
			return {
				x: Math.max(safe.margin.left, 1 - safe.margin.right - Math.min(w, 0.45)),
				y: yBottom,
				width: Math.min(w, 0.45),
				height: h,
			};
		default:
			return { x: safe.column.x, y: yBottom, width: w, height: h };
	}
}

export function placementStyle(
	placement: "BOTTOM_CENTER" | "TOP_CENTER" | "BOTTOM_LEFT" | "BOTTOM_RIGHT",
): {
	anchorV: "top" | "bottom";
	anchorH: "left" | "center" | "right";
} {
	switch (placement) {
		case "TOP_CENTER":
			return { anchorV: "top", anchorH: "center" };
		case "BOTTOM_LEFT":
			return { anchorV: "bottom", anchorH: "left" };
		case "BOTTOM_RIGHT":
			return { anchorV: "bottom", anchorH: "right" };
		default:
			return { anchorV: "bottom", anchorH: "center" };
	}
}
