/**
 * Brand kit from the recording itself: sample a few frames, find the
 * dominant (background) colour and the strongest accent hues, and turn them
 * into a brand kit so generated graphics look like they belong to the video
 * (a dark IDE demo gets dark cards with its accent colours; a light SaaS UI
 * gets light cards in its button colour). Used whenever the project has no
 * brand kit set by the user or agent.
 */

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { type BrandKit, brandKitSchema, DEFAULT_BRAND_KIT } from "./brandKit";

const THUMB_W = 64;
const THUMB_H = 36;
const SAMPLES = 6;

type Rgb = [number, number, number];

const hex = (c: Rgb) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

function luminance([r, g, b]: Rgb): number {
	const lin = (v: number) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
}

function toHsv([r, g, b]: Rgb): { h: number; s: number; v: number } {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	let h = 0;
	if (d > 0) {
		if (max === r) h = ((g - b) / d) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	return { h, s: max === 0 ? 0 : d / max, v: max / 255 };
}

function fromHsv(h: number, s: number, v: number): Rgb {
	const c = v * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = v - c;
	const [r, g, b] =
		h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
	return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Nudge `c` toward black or white until it reads against `bg` (buttons, underlines). */
function readableOn(c: Rgb, bg: Rgb, min = 2.4): Rgb {
	if (contrastRatio(c, bg) >= min) return c;
	const target: Rgb = luminance(bg) > 0.4 ? [0, 0, 0] : [255, 255, 255];
	for (let t = 0.1; t <= 0.8; t += 0.1) {
		const m = mix(c, target, t);
		if (contrastRatio(m, bg) >= min) return m;
	}
	return mix(c, target, 0.8);
}

const hueDist = (a: number, b: number) => {
	const d = Math.abs(a - b) % 360;
	return d > 180 ? 360 - d : d;
};

/**
 * Pure part: RGB24 pixels → brand-kit colours. Exported for tests.
 * Returns only the colour fields; the caller merges them over defaults.
 */
export function paletteFromPixels(rgb: Uint8Array): Pick<BrandKit, "primary" | "secondary" | "background" | "text"> | null {
	const n = Math.floor(rgb.length / 3);
	if (n === 0) return null;
	// 4-bit bins per channel: counts + running sums for an average colour per bin.
	const count = new Uint32Array(4096);
	const sum = new Float64Array(4096 * 3);
	for (let i = 0; i < n; i++) {
		const r = rgb[i * 3]!;
		const g = rgb[i * 3 + 1]!;
		const b = rgb[i * 3 + 2]!;
		const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
		count[k]!++;
		sum[k * 3] += r;
		sum[k * 3 + 1] += g;
		sum[k * 3 + 2] += b;
	}
	const avg = (k: number): Rgb => [sum[k * 3]! / count[k]!, sum[k * 3 + 1]! / count[k]!, sum[k * 3 + 2]! / count[k]!];

	// Background: the most common colour, merged with its near neighbours.
	let top = 0;
	for (let k = 1; k < 4096; k++) if (count[k]! > count[top]!) top = k;
	const dominant = avg(top);
	const domLum = luminance(dominant);
	let background: Rgb;
	let text: Rgb;
	if (domLum > 0.45) {
		background = dominant; // light UI → light cards
		text = [15, 23, 42];
	} else if (domLum < 0.12) {
		background = dominant; // dark UI → dark cards
		text = [255, 255, 255];
	} else {
		// Mid-tone footage: a deep version of the dominant hue keeps it on-theme and readable.
		const { h, s } = toHsv(dominant);
		background = fromHsv(h, Math.min(0.6, s), 0.14);
		text = [255, 255, 255];
	}
	if (contrastRatio(text, background) < 4.5) text = luminance(background) > 0.3 ? [15, 23, 42] : [255, 255, 255];

	// Accents: saturated, not-too-dark colours, grouped into 15° hue buckets.
	const minShare = n * 0.002;
	const buckets = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
	for (let k = 0; k < 4096; k++) {
		const c = count[k]!;
		if (c < minShare) continue;
		const col = avg(k);
		const { h, s, v } = toHsv(col);
		if (s < 0.3 || v < 0.3) continue;
		const w = c * s * s * v;
		const bk = buckets[Math.floor(h / 15) % 24]!;
		bk.w += w;
		bk.r += col[0] * w;
		bk.g += col[1] * w;
		bk.b += col[2] * w;
	}
	const ranked = buckets
		.map((bk, i) => ({ ...bk, hue: i * 15 + 7.5 }))
		.filter((bk) => bk.w > 0)
		.sort((a, b) => b.w - a.w);
	if (ranked.length === 0) {
		// Greyscale footage: keep its light/dark look, with the default accents made readable on it.
		const toRgb = (h: string): Rgb => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as Rgb;
		return {
			primary: hex(readableOn(toRgb(DEFAULT_BRAND_KIT.primary), background)),
			secondary: hex(readableOn(toRgb(DEFAULT_BRAND_KIT.secondary), background, 1.8)),
			background: hex(background),
			text: hex(text),
		};
	}
	const colourOf = (bk: (typeof ranked)[number]): Rgb => {
		const c: Rgb = [bk.r / bk.w, bk.g / bk.w, bk.b / bk.w];
		// Lift washed-out picks so they still work as an accent.
		const { h, s, v } = toHsv(c);
		return fromHsv(h, Math.max(s, 0.55), Math.max(v, 0.6));
	};
	const first = ranked[0]!;
	let primary = colourOf(first);
	const second = ranked.find((bk) => hueDist(bk.hue, first.hue) >= 40 && bk.w >= first.w * 0.08);
	let secondary: Rgb = second
		? colourOf(second)
		: (() => {
				// One accent only: a close neighbour hue makes a gradient that stays on-theme
				// (orange → red-orange, blue → violet-blue) instead of an unrelated colour.
				const { h, s, v } = toHsv(primary);
				return fromHsv((h + 335) % 360, s, v);
			})();
	primary = readableOn(primary, background);
	secondary = readableOn(secondary, background, 1.8);
	return { primary: hex(primary), secondary: hex(secondary), background: hex(background), text: hex(text) };
}

function grabFrame(ffmpegPath: string, videoPath: string, atSec: number, signal?: AbortSignal): Promise<Buffer> {
	return new Promise((resolve) => {
		const child = spawn(
			ffmpegPath,
			[
				"-v", "error", "-ss", atSec.toFixed(2), "-i", videoPath, "-frames:v", "1",
				"-vf", `scale=${THUMB_W}:${THUMB_H}`, "-pix_fmt", "rgb24", "-f", "rawvideo", "-",
			],
			{ stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
		);
		const chunks: Buffer[] = [];
		const onAbort = () => child.kill("SIGKILL");
		signal?.addEventListener("abort", onAbort, { once: true });
		const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
		child.stdout.on("data", (d: Buffer) => chunks.push(d));
		child.on("error", () => resolve(Buffer.alloc(0)));
		child.on("close", () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			const buf = Buffer.concat(chunks);
			resolve(buf.length === THUMB_W * THUMB_H * 3 ? buf : Buffer.alloc(0));
		});
	});
}

/** The recording the palette is taken from: the project's primary video, else the first video on disk. */
export function paletteSourceVideo(document: AxcutDocument): { path: string; durationSec: number } | null {
	const videos = document.assets.filter((a) => a.kind === "video" && a.originalPath && existsSync(a.originalPath));
	const pick = videos.find((a) => a.id === document.project.primaryAssetId) ?? videos[0];
	return pick ? { path: pick.originalPath, durationSec: pick.durationSec ?? 0 } : null;
}

const cache = new Map<string, BrandKit | null>();

/**
 * A brand kit whose colours come from the recording (font and style stay at
 * their defaults). Null when there is no readable recording. Cached per file.
 */
export async function deriveBrandKitFromVideo(
	document: AxcutDocument,
	ffmpegPath: string,
	signal?: AbortSignal,
): Promise<BrandKit | null> {
	const src = paletteSourceVideo(document);
	if (!src) return null;
	let key: string;
	try {
		key = `${src.path}:${statSync(src.path).mtimeMs}`;
	} catch {
		return null;
	}
	if (cache.has(key)) return cache.get(key) ?? null;
	const dur = src.durationSec > 0 ? src.durationSec : 10;
	const pixels: Buffer[] = [];
	for (let i = 0; i < SAMPLES; i++) {
		const frame = await grabFrame(ffmpegPath, src.path, (dur * (i + 0.5)) / SAMPLES, signal);
		if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
		if (frame.length) pixels.push(frame);
	}
	if (pixels.length === 0) {
		cache.set(key, null);
		return null;
	}
	const colours = paletteFromPixels(Buffer.concat(pixels));
	const kit = colours ? brandKitSchema.parse({ ...colours, source: "video" }) : null;
	cache.set(key, kit);
	return kit;
}
