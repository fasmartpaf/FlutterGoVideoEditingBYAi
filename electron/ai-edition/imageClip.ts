/**
 * Images as timeline clips.
 *
 * The compositor plays video files, so a still becomes a short silent H.264
 * clip that matches the project canvas. Optionally with a slow camera move
 * (Ken Burns) so a story told from pictures doesn't sit dead still.
 *
 * The asset keeps `still` (the source picture and how it was baked) so the
 * clip can be re-baked later with another length, move or fit.
 */

import { existsSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { AxcutDocument } from "../../src/lib/ai-edition/schema";
import { pickH264Encoder, runProcess } from "./mediaStudio";
import { ffmpegFilters, parseFfmpegProbe } from "./showcase/render";

export const IMAGE_CLIP_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);

export const IMAGE_CLIP_MOTIONS = ["none", "zoom-in", "zoom-out", "pan-left", "pan-right", "pan-up", "pan-down"] as const;
export type ImageClipMotion = (typeof IMAGE_CLIP_MOTIONS)[number];

export const IMAGE_CLIP_FITS = ["auto", "cover", "contain", "blur"] as const;
export type ImageClipFit = (typeof IMAGE_CLIP_FITS)[number];

export const DEFAULT_IMAGE_CLIP_SEC = 4;
export const MIN_IMAGE_CLIP_SEC = 0.5;
export const MAX_IMAGE_CLIP_SEC = 60;
const FPS = 30;
/** How far a move travels: 12% zoom, or a 12%-zoomed frame panned edge to edge. */
const MOTION_ZOOM = 0.12;

/**
 * Where generated media lives when a project has no media folder of its own
 * yet (a story made only from pictures). Set once from main to the app's
 * userData; the OS temp dir would lose the clips on reboot.
 */
let mediaHome: string | null = null;
export function setMediaHome(dir: string): void {
	mediaHome = dir;
}
export function getMediaHome(): string | null {
	return mediaHome;
}

/** Size of the video the timeline is built around, or null when there is none. */
export function primaryVideoSize(document: AxcutDocument): { width: number; height: number } | null {
	const primaryId = document.project.primaryAssetId;
	const primary =
		(primaryId ? document.assets.find((a) => a.id === primaryId && a.kind !== "audio") : undefined) ??
		document.assets.find((a) => a.kind === "video" && (a.video?.width ?? 0) > 0);
	const w = primary?.video?.width ?? 0;
	const h = primary?.video?.height ?? 0;
	return w > 0 && h > 0 ? { width: w, height: h } : null;
}

export function isImageClipPath(path: string): boolean {
	return IMAGE_CLIP_EXTENSIONS.has(extname(path).toLowerCase());
}

export function clampImageClipSec(sec: unknown): number {
	const n = typeof sec === "number" && Number.isFinite(sec) ? sec : DEFAULT_IMAGE_CLIP_SEC;
	return Math.min(MAX_IMAGE_CLIP_SEC, Math.max(MIN_IMAGE_CLIP_SEC, n));
}

function even(n: number): number {
	const v = Math.max(2, Math.round(n));
	return v % 2 === 0 ? v : v + 1;
}

/**
 * The frame a still is baked into. It must match the video already on the
 * timeline; in a project with no video yet, the picture's own shape decides
 * (portrait → 1080×1920, landscape → 1920×1080, square-ish → 1080×1080).
 */
export function imageClipCanvas(
	primary: { width: number; height: number } | null,
	image: { width: number; height: number } | null,
): { width: number; height: number } {
	if (primary && primary.width > 0 && primary.height > 0) {
		return { width: even(primary.width), height: even(primary.height) };
	}
	if (image && image.width > 0 && image.height > 0) {
		const r = image.width / image.height;
		if (r < 0.85) return { width: 1080, height: 1920 };
		if (r > 1.18) return { width: 1920, height: 1080 };
		return { width: 1080, height: 1080 };
	}
	return { width: 1920, height: 1080 };
}

/**
 * "auto": fill the frame when the picture is close to the frame's shape
 * (little is cropped); otherwise show all of it over a blurred copy of
 * itself, the way pro editors handle a portrait photo in a landscape video.
 */
export function resolveImageClipFit(
	fit: ImageClipFit,
	image: { width: number; height: number } | null,
	canvas: { width: number; height: number },
	canBlur: boolean,
): Exclude<ImageClipFit, "auto"> {
	let chosen: Exclude<ImageClipFit, "auto">;
	if (fit !== "auto") chosen = fit;
	else if (!image || image.width <= 0 || image.height <= 0) chosen = "cover";
	else {
		const gap = Math.abs(Math.log(image.width / image.height / (canvas.width / canvas.height)));
		chosen = gap < 0.2 ? "cover" : "blur";
	}
	return chosen === "blur" && !canBlur ? "contain" : chosen;
}

/**
 * The ffmpeg filter graph for one still: fit it to the canvas, then (for a
 * move) zoom/pan over a 2× copy so the crop steps in half pixels — smooth,
 * no jitter. Input is the picture looped at 30 fps; output label [v].
 */
export function imageClipFilter(input: {
	width: number;
	height: number;
	durationSec: number;
	motion: ImageClipMotion;
	fit: Exclude<ImageClipFit, "auto">;
}): string {
	const { width: W, height: H, motion, fit } = input;
	const moving = motion !== "none";
	const k = moving ? 2 : 1;
	const w = W * k;
	const h = H * k;
	const cover = `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}`;
	const contain = `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos`;
	const parts: string[] = [];
	if (fit === "cover") {
		parts.push(`[0:v]${cover},setsar=1[fit]`);
	} else if (fit === "contain") {
		parts.push(`[0:v]${contain},pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=0x000000,setsar=1[fit]`);
	} else {
		// Blur a small copy (cheap), then scale it up behind the whole picture.
		const bw = even(w / 8);
		const bh = even(h / 8);
		parts.push(
			`[0:v]split=2[bgsrc][fgsrc]`,
			`[bgsrc]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},gblur=sigma=6,colorchannelmixer=rr=0.78:gg=0.78:bb=0.78,scale=${w}:${h}[bgblur]`,
			`[fgsrc]${contain}[fg]`,
			`[bgblur][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[fit]`,
		);
	}
	if (!moving) {
		parts.push(`[fit]fps=${FPS},format=yuv420p[v]`);
		return parts.join(";");
	}
	const frames = Math.max(2, Math.round(input.durationSec * FPS));
	// Eased 0→1 progress over the clip.
	const e = `((1-cos(PI*min(on/${frames - 1},1)))/2)`;
	const z = MOTION_ZOOM;
	let zoom = `${1 + z}`;
	let x = "(iw-iw/zoom)/2";
	let y = "(ih-ih/zoom)/2";
	switch (motion) {
		case "zoom-in":
			zoom = `1+${z}*${e}`;
			break;
		case "zoom-out":
			zoom = `${1 + z}-${z}*${e}`;
			break;
		case "pan-left":
			x = `(iw-iw/zoom)*(1-${e})`;
			break;
		case "pan-right":
			x = `(iw-iw/zoom)*${e}`;
			break;
		case "pan-up":
			y = `(ih-ih/zoom)*(1-${e})`;
			break;
		case "pan-down":
			y = `(ih-ih/zoom)*${e}`;
			break;
	}
	parts.push(`[fit]zoompan=z='${zoom}':x='${x}':y='${y}':d=1:s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p[v]`);
	return parts.join(";");
}

export type BakeImageClipInput = {
	ffmpegPath: string;
	imagePath: string;
	durationSec?: number;
	motion?: ImageClipMotion;
	fit?: ImageClipFit;
	/** Size of the video already on the timeline (null in a project without one). */
	primary: { width: number; height: number } | null;
	outDir: string;
	signal?: AbortSignal;
};

export type BakedImageClip = {
	mp4Path: string;
	durationSec: number;
	width: number;
	height: number;
	motion: ImageClipMotion;
	fit: Exclude<ImageClipFit, "auto">;
	sourcePath: string;
};

export async function probeImageSize(
	ffmpegPath: string,
	imagePath: string,
	signal?: AbortSignal,
): Promise<{ width: number; height: number } | null> {
	const probe = await runProcess(ffmpegPath, ["-hide_banner", "-i", imagePath], { timeoutMs: 20_000, signal }).catch(
		() => null,
	);
	const info = probe ? parseFfmpegProbe(probe.stderr) : null;
	return info ? { width: info.width, height: info.height } : null;
}

export async function bakeImageClip(input: BakeImageClipInput): Promise<BakedImageClip> {
	if (!isImageClipPath(input.imagePath)) {
		throw new Error(`Not a picture this can use (${extname(input.imagePath) || "no extension"}). Use PNG, JPG or WEBP.`);
	}
	if (!existsSync(input.imagePath)) throw new Error(`Picture not found: ${input.imagePath}`);
	const durationSec = clampImageClipSec(input.durationSec);
	const motion: ImageClipMotion = IMAGE_CLIP_MOTIONS.includes(input.motion as ImageClipMotion)
		? (input.motion as ImageClipMotion)
		: "none";
	const image = await probeImageSize(input.ffmpegPath, input.imagePath, input.signal);
	const canvas = imageClipCanvas(input.primary, image);
	const filters = await ffmpegFilters(input.ffmpegPath, input.signal);
	const has = (f: string) => !filters || filters.has(f);
	const fit = resolveImageClipFit(input.fit ?? "auto", image, canvas, has("gblur") && has("colorchannelmixer") && has("split") && has("overlay"));
	const effectiveMotion: ImageClipMotion = motion !== "none" && !has("zoompan") ? "none" : motion;
	const graph = imageClipFilter({ ...canvas, durationSec, motion: effectiveMotion, fit });

	mkdirSync(input.outDir, { recursive: true });
	const stem = basename(input.imagePath, extname(input.imagePath)).replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40) || "image";
	const mp4Path = join(
		input.outDir,
		`${stem}-${effectiveMotion}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}.mp4`,
	);
	const encoder = await pickH264Encoder(input.ffmpegPath, input.signal);
	const result = await runProcess(
		input.ffmpegPath,
		[
			"-y",
			"-nostdin",
			"-hide_banner",
			"-loop",
			"1",
			"-framerate",
			String(FPS),
			"-i",
			input.imagePath,
			"-filter_complex",
			graph,
			"-map",
			"[v]",
			"-t",
			String(durationSec),
			"-r",
			String(FPS),
			"-c:v",
			encoder,
			...(encoder === "libx264" ? ["-preset", "medium", "-crf", "18"] : ["-b:v", "12M"]),
			"-pix_fmt",
			"yuv420p",
			"-movflags",
			"+faststart",
			"-an",
			mp4Path,
		],
		{ timeoutMs: 300_000, signal: input.signal },
	);
	if (result.code !== 0 || !existsSync(mp4Path)) {
		const err = (result.stderr || result.stdout || "ffmpeg failed").slice(-500);
		throw new Error(`Could not turn the picture into a clip: ${err}`);
	}
	return { mp4Path, durationSec, ...canvas, motion: effectiveMotion, fit, sourcePath: input.imagePath };
}
