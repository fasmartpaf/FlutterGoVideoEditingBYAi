/**
 * Deterministic change-hotspot localization from gray thumbnails.
 * Additive helper — does not change existing scoreAdjacentVisualFrames API.
 */

import {
	CHANGE_BLOCK_H,
	CHANGE_BLOCK_W,
	CHANGE_COMPARE_HEIGHT,
	CHANGE_COMPARE_WIDTH,
} from "../visualEvidence/types";

export interface ChangeHotspot {
	/** Fraction [0,1] of thumbnail / frame. */
	xFrac: number;
	yFrac: number;
	blockMax: number;
}

/**
 * Find the block with maximum mean |Δ|/255 and return its center as fractions.
 */
export function hottestChangeBlock(
	a: Uint8Array,
	b: Uint8Array,
	width = CHANGE_COMPARE_WIDTH,
	height = CHANGE_COMPARE_HEIGHT,
	blockW = CHANGE_BLOCK_W,
	blockH = CHANGE_BLOCK_H,
): ChangeHotspot {
	const expected = width * height;
	if (a.length < expected || b.length < expected) {
		return { xFrac: 0.5, yFrac: 0.5, blockMax: 0 };
	}
	let best = 0;
	let bestBx = 0;
	let bestBy = 0;
	for (let by = 0; by < height; by += blockH) {
		for (let bx = 0; bx < width; bx += blockW) {
			let sum = 0;
			let n = 0;
			const yEnd = Math.min(by + blockH, height);
			const xEnd = Math.min(bx + blockW, width);
			for (let y = by; y < yEnd; y++) {
				const row = y * width;
				for (let x = bx; x < xEnd; x++) {
					sum += Math.abs(a[row + x]! - b[row + x]!);
					n += 1;
				}
			}
			const score = n > 0 ? sum / (n * 255) : 0;
			if (score > best) {
				best = score;
				bestBx = bx;
				bestBy = by;
			}
		}
	}
	return {
		xFrac: (bestBx + blockW / 2) / width,
		yFrac: (bestBy + blockH / 2) / height,
		blockMax: best,
	};
}
