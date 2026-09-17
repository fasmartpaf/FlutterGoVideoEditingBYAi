/**
 * Deterministic RGBA8 pixel / luma validation for compositor frames.
 * Uniform / transparent / empty → invalid. Dark-but-varied → valid.
 */

import type { PixelStats } from "./types";

const NEAR_BLACK = 12;
const NEAR_TRANSPARENT = 8;
/** Buckets for crude uniqueness (16 levels per channel → coarse). */
const LUMA_BUCKETS = 32;

export function analyzeRgba8(data: Uint8Array | Buffer, width: number, height: number): PixelStats {
	const expected = width * height * 4;
	if (width <= 0 || height <= 0 || data.byteLength < expected) {
		return {
			meanLuma: 0,
			lumaVariance: 0,
			nearBlackFraction: 1,
			nearTransparentFraction: 1,
			uniqueApproxBuckets: 0,
			uniform: true,
			entirelyTransparent: true,
			valid: false,
			darkButValid: false,
		};
	}

	let sum = 0;
	let sum2 = 0;
	let nearBlack = 0;
	let nearTransparent = 0;
	let opaque = 0;
	const buckets = new Uint32Array(LUMA_BUCKETS);
	const n = width * height;

	for (let i = 0; i < n; i += 1) {
		const o = i * 4;
		const r = data[o] ?? 0;
		const g = data[o + 1] ?? 0;
		const b = data[o + 2] ?? 0;
		const a = data[o + 3] ?? 0;
		const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		sum += y;
		sum2 += y * y;
		if (y < NEAR_BLACK) nearBlack += 1;
		if (a < NEAR_TRANSPARENT) nearTransparent += 1;
		else opaque += 1;
		const bi = Math.min(LUMA_BUCKETS - 1, Math.floor((y / 255) * LUMA_BUCKETS));
		buckets[bi] += 1;
	}

	const meanLuma = sum / n;
	const lumaVariance = Math.max(0, sum2 / n - meanLuma * meanLuma);
	const nearBlackFraction = nearBlack / n;
	const nearTransparentFraction = nearTransparent / n;
	let uniqueApproxBuckets = 0;
	for (let i = 0; i < LUMA_BUCKETS; i += 1) {
		if (buckets[i] > 0) uniqueApproxBuckets += 1;
	}

	const entirelyTransparent = nearTransparentFraction > 0.98;
	// Uniform: almost all mass in one luma bucket and very low variance.
	const uniform = uniqueApproxBuckets <= 1 && lumaVariance < 4;
	// Solid near-black uniform = blank/invalid; dark with structure is OK.
	const blankUniformDark = uniform && meanLuma < NEAR_BLACK;
	const darkButValid = meanLuma < 40 && lumaVariance >= 4 && uniqueApproxBuckets >= 2;
	const valid =
		!entirelyTransparent &&
		!blankUniformDark &&
		data.byteLength >= expected &&
		opaque > 0 &&
		(lumaVariance >= 1 || uniqueApproxBuckets >= 2 || meanLuma >= NEAR_BLACK);

	return {
		meanLuma,
		lumaVariance,
		nearBlackFraction,
		nearTransparentFraction,
		uniqueApproxBuckets,
		uniform,
		entirelyTransparent,
		valid,
		darkButValid,
	};
}

/** Synthetic solid RGBA buffer for tests. */
export function makeSolidRgba(
	width: number,
	height: number,
	rgba: [number, number, number, number],
): Uint8Array {
	const out = new Uint8Array(width * height * 4);
	for (let i = 0; i < width * height; i += 1) {
		out[i * 4] = rgba[0];
		out[i * 4 + 1] = rgba[1];
		out[i * 4 + 2] = rgba[2];
		out[i * 4 + 3] = rgba[3];
	}
	return out;
}

/** Synthetic non-uniform frame (gradient) — valid even if dark. */
export function makeGradientRgba(width: number, height: number, dark = false): Uint8Array {
	const out = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const i = (y * width + x) * 4;
			const v = dark ? Math.floor((x / width) * 30) : Math.floor((x / width) * 200);
			out[i] = v;
			out[i + 1] = Math.floor((y / height) * (dark ? 25 : 180));
			out[i + 2] = dark ? 10 : 120;
			out[i + 3] = 255;
		}
	}
	return out;
}
