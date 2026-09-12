/**
 * Source-resolution ROI crop from video — never upscale a 1280 JPEG.
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveFfmpeg } from "../../media/audioPeaks";
import type { SourceResCrop } from "./types";

export type CropPreset = "bottom_center" | "top_chrome" | "center" | "change_hotspot";

export interface VideoSourceSize {
	width: number;
	height: number;
}

export async function probeVideoSize(
	videoPath: string,
	ffmpegPath?: string | null,
): Promise<VideoSourceSize | null> {
	const ffmpeg = ffmpegPath === null ? null : (ffmpegPath ?? resolveFfmpeg());
	if (!ffmpeg) return null;
	// ffmpeg prints stream info to stderr; parse WxH from Video line.
	const text = await new Promise<string>((resolve, reject) => {
		const child = spawn(ffmpeg, ["-hide_banner", "-i", videoPath], {
			stdio: ["ignore", "ignore", "pipe"],
		});
		let err = "";
		child.stderr?.on("data", (d) => {
			err += String(d);
		});
		child.on("error", reject);
		child.on("close", () => resolve(err));
	});
	const m = text.match(/Video:.*?,\s*(\d{2,5})x(\d{2,5})\b/);
	if (!m) return null;
	return { width: Number(m[1]), height: Number(m[2]) };
}

export function cropRectForPreset(
	preset: CropPreset,
	sourceWidth: number,
	sourceHeight: number,
	hotspot?: { xFrac: number; yFrac: number },
): { x: number; y: number; w: number; h: number } {
	const W = sourceWidth;
	const H = sourceHeight;
	if (preset === "bottom_center") {
		const w = Math.max(64, Math.floor(W * 0.45));
		const h = Math.max(48, Math.floor(H * 0.22));
		return {
			x: Math.floor((W - w) / 2),
			y: Math.max(0, H - h - Math.floor(H * 0.02)),
			w,
			h,
		};
	}
	if (preset === "top_chrome") {
		const h = Math.max(40, Math.floor(H * 0.12));
		return { x: 0, y: 0, w: W, h };
	}
	if (preset === "change_hotspot" && hotspot) {
		const w = Math.max(96, Math.floor(W * 0.35));
		const h = Math.max(96, Math.floor(H * 0.28));
		const cx = Math.floor(hotspot.xFrac * W);
		const cy = Math.floor(hotspot.yFrac * H);
		return {
			x: Math.min(Math.max(0, cx - Math.floor(w / 2)), Math.max(0, W - w)),
			y: Math.min(Math.max(0, cy - Math.floor(h / 2)), Math.max(0, H - h)),
			w: Math.min(w, W),
			h: Math.min(h, H),
		};
	}
	const w = Math.max(64, Math.floor(W * 0.4));
	const h = Math.max(64, Math.floor(H * 0.4));
	return {
		x: Math.floor((W - w) / 2),
		y: Math.floor((H - h) / 2),
		w,
		h,
	};
}

let cropSeq = 0;

export async function extractSourceResolutionCrop(input: {
	videoPath: string;
	sourceTimeSec: number;
	preset: CropPreset;
	cacheDir: string;
	ffmpegPath?: string | null;
	hotspot?: { xFrac: number; yFrac: number };
	sourceSize?: VideoSourceSize | null;
}): Promise<SourceResCrop | null> {
	const ffmpeg = input.ffmpegPath === null ? null : (input.ffmpegPath ?? resolveFfmpeg());
	if (!ffmpeg) return null;
	const size = input.sourceSize ?? (await probeVideoSize(input.videoPath, ffmpeg));
	if (!size || !(size.width > 0) || !(size.height > 0)) return null;

	const crop = cropRectForPreset(input.preset, size.width, size.height, input.hotspot);
	const t0 = Date.now();
	cropSeq += 1;
	const id = `src_crop_${cropSeq}`;
	const outPath = path.join(
		input.cacheDir,
		`srcroi_${input.preset}_${Math.round(input.sourceTimeSec * 1000)}_${crop.w}x${crop.h}.jpg`,
	);
	await fs.mkdir(input.cacheDir, { recursive: true });

	await new Promise<void>((resolve, reject) => {
		const args = [
			"-hide_banner",
			"-loglevel",
			"error",
			"-ss",
			input.sourceTimeSec.toFixed(3),
			"-i",
			input.videoPath,
			"-frames:v",
			"1",
			"-vf",
			`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`,
			"-q:v",
			"2",
			"-y",
			outPath,
		];
		const child = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
		let err = "";
		child.stderr?.on("data", (d) => {
			err += String(d);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(err.trim() || `ffmpeg source crop exit ${code}`));
		});
	});

	const st = await fs.stat(outPath);
	return {
		id,
		sourceTimeSec: input.sourceTimeSec,
		videoPath: input.videoPath,
		crop,
		sourceWidth: size.width,
		sourceHeight: size.height,
		imagePath: outPath,
		width: crop.w,
		height: crop.h,
		byteLength: st.size,
		fromSourceMedia: true,
		presetOrReason: input.preset,
		ms: Date.now() - t0,
	};
}
