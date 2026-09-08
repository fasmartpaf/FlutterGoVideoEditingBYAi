import { describe, expect, it } from "vitest";
import {
	cropDraftFromRegion,
	cropPctFromDrag,
	detectContentCrop,
	detectDeviceCrop,
	detectPreviewCrop,
	displayPct,
	PREVIEW_MAX_HEIGHT_PX,
	previewBoxStyle,
	stepPct,
} from "./cropDraft";

describe("crop draft helpers", () => {
	it("steps one source pixel, not 1%, when the frame width is known", () => {
		expect(stepPct(1920)).toBe(100 / 1920);
		expect(stepPct(1920)).not.toBe(1);
	});

	it("falls back to a fine percent step when the frame size is unknown", () => {
		expect(stepPct(0)).toBe(0.1);
	});

	it("gives the preview box the video's own aspect ratio", () => {
		// The overlay and every drag are measured against the box while the
		// video letterboxes inside it — any box/video aspect mismatch shifts
		// the crop off the pixels it claims to select.
		for (const aspect of [16 / 9, 784 / 1082, 21 / 9]) {
			const style = previewBoxStyle(aspect);
			expect(style.aspectRatio).toBe(`${aspect}`);
			// Width is derived from the height cap so a clamped height can
			// never silently break the ratio (CSS keeps width and drops the
			// ratio when max-height wins).
			expect(style.width).toBe(`min(100%, calc(${PREVIEW_MAX_HEIGHT_PX}px * ${aspect}))`);
		}
	});

	it("falls back to 16:9 while the video metadata has not loaded", () => {
		for (const bogus of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(previewBoxStyle(bogus).aspectRatio).toBe(`${16 / 9}`);
		}
	});

	it("stores the draft as unrounded fractions", () => {
		const draft = cropDraftFromRegion({ x: 1 / 3, y: 0.1, width: 0.5, height: 0.8 });
		expect(draft.x).toBe(1 / 3);
		expect(draft.x).not.toBe(33);
	});

	it("picks the non-black phone strip and drops the letterbox", () => {
		const width = 20;
		const height = 10;
		const pixels = new Uint8ClampedArray(width * height * 4);
		// Vertical content strip in columns 7–12 (a phone on a black 16:9 frame).
		for (let y = 1; y < height - 1; y++) {
			for (let x = 7; x <= 12; x++) {
				const i = (y * width + x) * 4;
				pixels[i] = 220;
				pixels[i + 1] = 80;
				pixels[i + 2] = 40;
				pixels[i + 3] = 255;
			}
		}
		const crop = detectContentCrop(pixels, width, height, { paddingFrac: 0 });
		expect(crop).not.toBeNull();
		expect(crop?.x).toBeCloseTo(7 / 20);
		expect(crop?.width).toBeCloseTo(6 / 20);
		expect((crop?.x ?? 0) + (crop?.width ?? 0)).toBeLessThan(0.8);
	});

	it("returns null for a fully black frame and for an already-full frame", () => {
		const width = 8;
		const height = 8;
		const black = new Uint8ClampedArray(width * height * 4);
		expect(detectContentCrop(black, width, height)).toBeNull();
		const white = new Uint8ClampedArray(width * height * 4);
		for (let i = 0; i < white.length; i += 4) {
			white[i] = 200;
			white[i + 1] = 200;
			white[i + 2] = 200;
			white[i + 3] = 255;
		}
		expect(detectContentCrop(white, width, height)).toBeNull();
	});

	it("does not invent a device crop on a flat frame", () => {
		const width = 48;
		const height = 28;
		const flat = new Uint8ClampedArray(width * height * 4);
		for (let i = 0; i < flat.length; i += 4) {
			flat[i] = 18;
			flat[i + 1] = 18;
			flat[i + 2] = 20;
			flat[i + 3] = 255;
		}
		expect(detectDeviceCrop(flat, width, height)).toBeNull();
		expect(detectPreviewCrop(flat, width, height)).toBeNull();
	});

	it("finds a portrait phone sitting in a filled studio frame", () => {
		const width = 80;
		const height = 46;
		const pixels = new Uint8ClampedArray(width * height * 4);
		// Dark chrome everywhere (IDE / starfield) — no letterbox, so content
		// crop must refuse and device crop has to pick the phone.
		for (let i = 0; i < pixels.length; i += 4) {
			pixels[i] = 22;
			pixels[i + 1] = 24;
			pixels[i + 2] = 28;
			pixels[i + 3] = 255;
		}
		const x0 = 32;
		const x1 = 50;
		const y0 = 4;
		const y1 = 42;
		for (let y = y0; y <= y1; y++) {
			for (let x = x0; x <= x1; x++) {
				const i = (y * width + x) * 4;
				const bezel = x === x0 || x === x1 || y === y0 || y === y1;
				pixels[i] = bezel ? 210 : 80 + ((x * 13 + y * 7) % 90);
				pixels[i + 1] = bezel ? 200 : 50 + ((x * 5 + y * 11) % 70);
				pixels[i + 2] = bezel ? 190 : 40 + ((x * 3 + y) % 50);
			}
		}
		expect(detectContentCrop(pixels, width, height)).toBeNull();
		const device = detectDeviceCrop(pixels, width, height);
		expect(device).not.toBeNull();
		expect(device?.width ?? 1).toBeLessThan(0.45);
		expect(device?.height ?? 0).toBeGreaterThan(0.5);
		const mid = (device?.x ?? 0) + (device?.width ?? 0) / 2;
		expect(mid).toBeGreaterThan(0.3);
		expect(mid).toBeLessThan(0.75);
		const preview = detectPreviewCrop(pixels, width, height);
		expect(preview?.width).toBe(device?.width);
	});

	it("builds a crop from a drag on the preview", () => {
		expect(cropPctFromDrag(20, 10, 70, 90)).toEqual({ x: 20, y: 10, w: 50, h: 80 });
		expect(cropPctFromDrag(70, 90, 20, 10)).toEqual({ x: 20, y: 10, w: 50, h: 80 });
		expect(cropPctFromDrag(50, 50, 51, 51)).toBeNull();
	});

	it("formats field display to two decimals without touching the stored value", () => {
		expect(displayPct((1 / 3) * 100)).toBe(33.33);
		expect(displayPct(100)).toBe(100);
		expect(displayPct(0)).toBe(0);
		// One source pixel on a 1920-wide frame is ~0.052% — two display
		// decimals stay within a fifth of a pixel of the stored fraction.
		expect(Math.abs(displayPct(33.333333) - 33.333333)).toBeLessThan(stepPct(1920) / 5);
	});
});
