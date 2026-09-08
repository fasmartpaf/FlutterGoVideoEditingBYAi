// Pure crop-draft helpers for Edit Clip. The modal stores the rectangle as
// frame fractions (0–1), not rounded integer percents, so a 1px nudge is
// representable once the source size is known.

export interface CropDraft {
	x: number;
	y: number;
	width: number;
	height: number;
}

export function cropDraftFromRegion(region: CropDraft): CropDraft {
	return { x: region.x, y: region.y, width: region.width, height: region.height };
}

/** Smallest crop, as a percent of the frame, that a drawn pick may produce. */
export const MIN_CROP_PCT = 4;

/**
 * Bounding box of visible pixels as a crop region (0–1). Near-black
 * letterboxing — the empty sides around a phone preview — is treated as
 * outside the pick. Returns null when the frame is empty or already filled.
 */
export function detectContentCrop(
	data: ArrayLike<number>,
	width: number,
	height: number,
	options?: { lumaThreshold?: number; paddingFrac?: number; fullCoverage?: number },
): CropDraft | null {
	if (width < 2 || height < 2 || data.length < width * height * 4) return null;
	const threshold = options?.lumaThreshold ?? 24;
	const paddingFrac = options?.paddingFrac ?? 0.02;
	const fullCoverage = options?.fullCoverage ?? 0.94;
	let minX = width;
	let minY = height;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < height; y++) {
		const row = y * width * 4;
		for (let x = 0; x < width; x++) {
			const i = row + x * 4;
			const visible = Math.max(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
			if (visible <= threshold) continue;
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
		}
	}
	if (maxX < 0) return null;
	const padX = paddingFrac <= 0 ? 0 : Math.max(1, Math.round(width * paddingFrac));
	const padY = paddingFrac <= 0 ? 0 : Math.max(1, Math.round(height * paddingFrac));
	const x0 = Math.max(0, minX - padX);
	const y0 = Math.max(0, minY - padY);
	const x1 = Math.min(width - 1, maxX + padX);
	const y1 = Math.min(height - 1, maxY + padY);
	const cropW = (x1 - x0 + 1) / width;
	const cropH = (y1 - y0 + 1) / height;
	if (cropW < MIN_CROP_PCT / 100 || cropH < MIN_CROP_PCT / 100) return null;
	if (cropW >= fullCoverage && cropH >= fullCoverage) return null;
	return {
		x: x0 / width,
		y: y0 / height,
		width: cropW,
		height: cropH,
	};
}

function pixelLuma(data: ArrayLike<number>, width: number, x: number, y: number): number {
	const i = (y * width + x) * 4;
	return 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function padCrop(crop: CropDraft, pad: number): CropDraft {
	const x = clamp01(crop.x - pad);
	const y = clamp01(crop.y - pad);
	return {
		x,
		y,
		width: Math.min(1 - x, crop.width + pad * 2),
		height: Math.min(1 - y, crop.height + pad * 2),
	};
}

/** Score a portrait window: bezel contrast + busy interior + center bias. */
function scoreDeviceWindow(
	data: ArrayLike<number>,
	width: number,
	height: number,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
): number {
	const leftOut = Math.max(0, x0 - 2);
	const rightOut = Math.min(width - 1, x1 + 2);
	const topOut = Math.max(0, y0 - 2);
	const bottomOut = Math.min(height - 1, y1 + 2);
	let edge = 0;
	let edgeN = 0;
	for (let y = y0; y <= y1; y += 2) {
		edge += Math.abs(pixelLuma(data, width, x0 + 1, y) - pixelLuma(data, width, leftOut, y));
		edge += Math.abs(pixelLuma(data, width, x1 - 1, y) - pixelLuma(data, width, rightOut, y));
		edgeN += 2;
	}
	for (let x = x0; x <= x1; x += 2) {
		edge += Math.abs(pixelLuma(data, width, x, y0 + 1) - pixelLuma(data, width, x, topOut));
		edge += Math.abs(pixelLuma(data, width, x, y1 - 1) - pixelLuma(data, width, x, bottomOut));
		edgeN += 2;
	}
	const edgeMean = edgeN > 0 ? edge / edgeN : 0;

	let sum = 0;
	let sumSq = 0;
	let n = 0;
	const stepX = Math.max(1, Math.floor((x1 - x0) / 8));
	const stepY = Math.max(1, Math.floor((y1 - y0) / 12));
	for (let y = y0 + 1; y < y1; y += stepY) {
		for (let x = x0 + 1; x < x1; x += stepX) {
			const luma = pixelLuma(data, width, x, y);
			sum += luma;
			sumSq += luma * luma;
			n += 1;
		}
	}
	const mean = n > 0 ? sum / n : 0;
	const variance = n > 1 ? Math.max(0, sumSq / n - mean * mean) : 0;
	const cx = (x0 + x1) / 2 / width;
	const center = 1 - Math.abs(cx - 0.5) * 1.6;
	return edgeMean * 1.7 + Math.min(Math.sqrt(variance), 40) * 0.9 + center * 10;
}

/**
 * Find a phone / device mockup inside a busy studio frame (no letterbox).
 * Slides portrait windows and keeps the one with the strongest bezel.
 */
export function detectDeviceCrop(
	data: ArrayLike<number>,
	width: number,
	height: number,
): CropDraft | null {
	if (width < 24 || height < 24 || data.length < width * height * 4) return null;
	const aspects = [9 / 19.5, 9 / 18, 9 / 16];
	const minW = Math.max(10, Math.round(width * 0.16));
	const maxW = Math.round(width * 0.44);
	const stepX = Math.max(1, Math.round(width / 70));
	const stepY = Math.max(1, Math.round(height / 45));
	const stepW = Math.max(2, Math.round(width / 36));
	let bestScore = 0;
	let best: CropDraft | null = null;
	for (const aspect of aspects) {
		for (let boxW = minW; boxW <= maxW; boxW += stepW) {
			const boxH = Math.round(boxW / aspect);
			if (boxH < height * 0.34 || boxH > height * 0.92) continue;
			for (let x = 0; x + boxW < width; x += stepX) {
				for (let y = 0; y + boxH < height; y += stepY) {
					if (x + 2 >= width || y + 2 >= height) continue;
					const score = scoreDeviceWindow(data, width, height, x, y, x + boxW - 1, y + boxH - 1);
					if (score > bestScore) {
						bestScore = score;
						best = {
							x: x / width,
							y: y / height,
							width: boxW / width,
							height: boxH / height,
						};
					}
				}
			}
		}
	}
	// Empty / flat frames score in the low teens. A phone bezel is well above that.
	if (!best || bestScore < 22) return null;
	return padCrop(best, 0.012);
}

/** Letterbox first; if the frame is a full studio, lock onto the device. */
export function detectPreviewCrop(
	data: ArrayLike<number>,
	width: number,
	height: number,
): CropDraft | null {
	return detectContentCrop(data, width, height) ?? detectDeviceCrop(data, width, height);
}

/** Axis-aligned box from two corners, in percent of the frame. */
export function cropPctFromDrag(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	minPct = MIN_CROP_PCT,
): { x: number; y: number; w: number; h: number } | null {
	const left = Math.min(x0, x1);
	const top = Math.min(y0, y1);
	const w = Math.abs(x1 - x0);
	const h = Math.abs(y1 - y0);
	if (w < minPct || h < minPct) return null;
	return {
		x: Math.max(0, left),
		y: Math.max(0, top),
		w: Math.min(100 - Math.max(0, left), w),
		h: Math.min(100 - Math.max(0, top), h),
	};
}

export function cropDraftToPct(draft: CropDraft): { x: number; y: number; w: number; h: number } {
	return {
		x: draft.x * 100,
		y: draft.y * 100,
		w: draft.width * 100,
		h: draft.height * 100,
	};
}

/** Percent step for a numeric field: one source pixel when the frame size is known. */
export function stepPct(frameSizePx: number): number {
	return frameSizePx > 0 ? 100 / frameSizePx : 0.1;
}

/**
 * What the numeric fields DISPLAY. The draft itself stays unrounded (that is
 * the point of pixel-precision crops), but a drag leaves values like
 * 33.33333333333333 behind, and eight digits of float noise in a percent
 * field reads as a bug. Two decimals is 0.01% — under a fifth of a pixel on
 * a 1920-wide source — so the display can never be visibly off from the
 * stored value. Typing writes the exact typed number; this only formats.
 */
export function displayPct(value: number): number {
	return Math.round(value * 100) / 100;
}

export const PREVIEW_MAX_HEIGHT_PX = 360;

/**
 * Preview box for the crop overlay. The crop rectangle and every drag are
 * measured against THIS element, while the <video> inside it letterboxes via
 * object-fit: contain — so the box must have the video's own aspect ratio or
 * the overlay drifts off the pixels it claims to crop (the old fixed
 * 409x230 box was 16:9 for exactly this reason). Width is therefore derived
 * from the height cap and the aspect: `min(100%, height-cap * aspect)`.
 * Declaring width this way — rather than `width: 100%` plus a max-height —
 * matters because when a max-height clamps an aspect-ratio box, CSS keeps
 * the width and BREAKS the ratio, which would letterbox portrait sources
 * all over again.
 */
export function previewBoxStyle(videoAspectRatio: number): {
	position: "relative";
	width: string;
	aspectRatio: string;
	margin: string;
	flexShrink: number;
	background: string;
	borderRadius: string;
	border: string;
	overflow: "hidden";
} {
	const aspect =
		Number.isFinite(videoAspectRatio) && videoAspectRatio > 0 ? videoAspectRatio : 16 / 9;
	return {
		position: "relative",
		width: `min(100%, calc(${PREVIEW_MAX_HEIGHT_PX}px * ${aspect}))`,
		aspectRatio: `${aspect}`,
		margin: "0 auto 14px",
		flexShrink: 0,
		background: "#0a0b0e",
		borderRadius: "var(--r-md)",
		border: "1px solid var(--border)",
		overflow: "hidden",
	};
}
