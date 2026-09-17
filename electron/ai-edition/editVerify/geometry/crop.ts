/**
 * Crop geometry — observation only, not aesthetic judgment.
 */

import type { NormalizedRect } from "../types";

export type CropGeometryClass = "VALID_CROP" | "EMPTY_CROP" | "OUT_OF_BOUNDS" | "EXTREME_CROP";

export interface CropGeometryVerification {
	sourceRect: NormalizedRect;
	cropRect: NormalizedRect;
	outputAspect: number | null;
	sourceAspect: number | null;
	aspectDelta: number | null;
	normalizedVisibleRect: NormalizedRect;
	classification: CropGeometryClass;
	area: number;
	notes: string[];
}

const IDENTITY: NormalizedRect = { x: 0, y: 0, width: 1, height: 1 };

/** Extreme if remaining area < 5% or either edge < 2%. */
const EXTREME_AREA = 0.05;
const EXTREME_EDGE = 0.02;

export function classifyCrop(args: {
	crop: NormalizedRect | null | undefined;
	sourceWidthPx?: number | null;
	sourceHeightPx?: number | null;
	outputWidthPx?: number | null;
	outputHeightPx?: number | null;
}): CropGeometryVerification {
	const notes: string[] = [];
	const crop = args.crop ?? IDENTITY;
	const area = Math.max(0, crop.width) * Math.max(0, crop.height);

	const inBounds =
		crop.x >= -1e-9 &&
		crop.y >= -1e-9 &&
		crop.width >= -1e-9 &&
		crop.height >= -1e-9 &&
		crop.x + crop.width <= 1 + 1e-9 &&
		crop.y + crop.height <= 1 + 1e-9;

	let classification: CropGeometryClass = "VALID_CROP";
	if (area <= 1e-9 || crop.width <= 1e-9 || crop.height <= 1e-9) {
		classification = "EMPTY_CROP";
		notes.push("zero_area_crop");
	} else if (!inBounds) {
		classification = "OUT_OF_BOUNDS";
		notes.push("crop_out_of_bounds");
	} else if (area < EXTREME_AREA || crop.width < EXTREME_EDGE || crop.height < EXTREME_EDGE) {
		classification = "EXTREME_CROP";
		notes.push("extreme_crop");
	}

	const sw = args.sourceWidthPx ?? null;
	const sh = args.sourceHeightPx ?? null;
	const ow = args.outputWidthPx ?? null;
	const oh = args.outputHeightPx ?? null;
	const sourceAspect = sw != null && sh != null && sh > 0 ? sw / sh : null;
	const cropAspect = crop.height > 1e-9 ? crop.width / crop.height : null;
	const outputAspect = ow != null && oh != null && oh > 0 ? ow / oh : cropAspect;
	const aspectDelta =
		sourceAspect != null && outputAspect != null ? Math.abs(outputAspect - sourceAspect) : null;

	return {
		sourceRect: IDENTITY,
		cropRect: crop,
		outputAspect,
		sourceAspect,
		aspectDelta,
		normalizedVisibleRect: crop,
		classification,
		area,
		notes,
	};
}

/** True when protected region is fully outside the crop (excluded). */
export function cropExcludesRegion(crop: NormalizedRect, protectedRegion: NormalizedRect): boolean {
	const intersect =
		crop.x < protectedRegion.x + protectedRegion.width - 1e-9 &&
		crop.x + crop.width > protectedRegion.x + 1e-9 &&
		crop.y < protectedRegion.y + protectedRegion.height - 1e-9 &&
		crop.y + crop.height > protectedRegion.y + 1e-9;
	return !intersect;
}

/** Protected region survives if its center (or full rect) is inside crop. */
export function cropPreservesRegion(
	crop: NormalizedRect,
	protectedRegion: NormalizedRect,
	mode: "center" | "full" = "center",
): boolean {
	if (mode === "full") {
		return (
			protectedRegion.x >= crop.x - 1e-6 &&
			protectedRegion.y >= crop.y - 1e-6 &&
			protectedRegion.x + protectedRegion.width <= crop.x + crop.width + 1e-6 &&
			protectedRegion.y + protectedRegion.height <= crop.y + crop.height + 1e-6
		);
	}
	const cx = protectedRegion.x + protectedRegion.width / 2;
	const cy = protectedRegion.y + protectedRegion.height / 2;
	return (
		cx >= crop.x - 1e-6 &&
		cx <= crop.x + crop.width + 1e-6 &&
		cy >= crop.y - 1e-6 &&
		cy <= crop.y + crop.height + 1e-6
	);
}
