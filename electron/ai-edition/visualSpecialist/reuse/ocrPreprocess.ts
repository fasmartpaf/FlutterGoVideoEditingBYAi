/**
 * OCR preprocessing — clean-room adapt of watch-video `_prep_for_ocr`:
 * upscale if width &lt; 1000, grayscale, mean threshold → binary.
 * @see reuse/NOTICE.md
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { OCR_PREP_MIN_WIDTH, OCR_PREPROCESS_VERSION } from "./constants";

export interface OcrPreprocessResult {
	imagePath: string;
	/** Input image path. */
	sourceImagePath: string;
	inputWidth: number;
	inputHeight: number;
	outputWidth: number;
	outputHeight: number;
	version: typeof OCR_PREPROCESS_VERSION;
	ms: number;
	/** When false, returned source path unchanged (ffmpeg missing / error). */
	applied: boolean;
}

async function probeStillSize(
	imagePath: string,
	ffmpegPath: string,
): Promise<{ width: number; height: number } | null> {
	const text = await new Promise<string>((resolve, reject) => {
		const child = spawn(ffmpegPath, ["-hide_banner", "-i", imagePath], {
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

async function decodeGrayRaw(
	imagePath: string,
	ffmpegPath: string,
	width: number,
	height: number,
): Promise<Uint8Array> {
	const vf = `scale=${width}:${height}:flags=lanczos,format=gray`;
	const args = [
		"-hide_banner",
		"-loglevel",
		"error",
		"-i",
		imagePath,
		"-frames:v",
		"1",
		"-vf",
		vf,
		"-f",
		"rawvideo",
		"pipe:1",
	];
	const buf = await new Promise<Buffer>((resolve, reject) => {
		const child = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
		const chunks: Buffer[] = [];
		let stderr = "";
		child.stdout?.on("data", (d) => chunks.push(Buffer.from(d)));
		child.stderr?.on("data", (d) => {
			stderr += String(d);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve(Buffer.concat(chunks));
			else reject(new Error(stderr.trim() || `ocr prep decode exit ${code}`));
		});
	});
	return new Uint8Array(buf);
}

async function encodeGrayJpeg(
	gray: Uint8Array,
	width: number,
	height: number,
	outPath: string,
	ffmpegPath: string,
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(
			ffmpegPath,
			[
				"-hide_banner",
				"-loglevel",
				"error",
				"-f",
				"rawvideo",
				"-pix_fmt",
				"gray",
				"-s",
				`${width}x${height}`,
				"-i",
				"pipe:0",
				"-frames:v",
				"1",
				"-q:v",
				"2",
				"-y",
				outPath,
			],
			{ stdio: ["pipe", "ignore", "pipe"] },
		);
		let stderr = "";
		child.stderr?.on("data", (d) => {
			stderr += String(d);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(stderr.trim() || `ocr prep encode exit ${code}`));
		});
		child.stdin?.write(Buffer.from(gray));
		child.stdin?.end();
	});
}

/**
 * Mean-threshold binary image for sharper on-screen glyphs (upstream recipe).
 */
export async function preprocessForOcr(input: {
	imagePath: string;
	cacheDir: string;
	ffmpegPath: string | null;
}): Promise<OcrPreprocessResult> {
	const t0 = Date.now();
	const base: OcrPreprocessResult = {
		imagePath: input.imagePath,
		sourceImagePath: input.imagePath,
		inputWidth: 0,
		inputHeight: 0,
		outputWidth: 0,
		outputHeight: 0,
		version: OCR_PREPROCESS_VERSION,
		ms: 0,
		applied: false,
	};
	if (!input.ffmpegPath) {
		base.ms = Date.now() - t0;
		return base;
	}
	try {
		const size = await probeStillSize(input.imagePath, input.ffmpegPath);
		if (!size) {
			base.ms = Date.now() - t0;
			return base;
		}
		base.inputWidth = size.width;
		base.inputHeight = size.height;
		let outW = size.width;
		let outH = size.height;
		if (outW < OCR_PREP_MIN_WIDTH) {
			const scale = OCR_PREP_MIN_WIDTH / outW;
			outW = OCR_PREP_MIN_WIDTH;
			outH = Math.max(1, Math.round(size.height * scale));
		}
		const gray = await decodeGrayRaw(input.imagePath, input.ffmpegPath, outW, outH);
		let sum = 0;
		for (let i = 0; i < gray.length; i++) sum += gray[i]!;
		const mean = gray.length > 0 ? sum / gray.length : 128;
		const bw = new Uint8Array(gray.length);
		for (let i = 0; i < gray.length; i++) {
			bw[i] = gray[i]! > mean ? 255 : 0;
		}
		await fs.mkdir(input.cacheDir, { recursive: true });
		const outPath = path.join(
			input.cacheDir,
			`ocrprep_${path.basename(input.imagePath, path.extname(input.imagePath))}_${OCR_PREPROCESS_VERSION}.jpg`,
		);
		await encodeGrayJpeg(bw, outW, outH, outPath, input.ffmpegPath);
		return {
			imagePath: outPath,
			sourceImagePath: input.imagePath,
			inputWidth: size.width,
			inputHeight: size.height,
			outputWidth: outW,
			outputHeight: outH,
			version: OCR_PREPROCESS_VERSION,
			ms: Date.now() - t0,
			applied: true,
		};
	} catch {
		base.ms = Date.now() - t0;
		return base;
	}
}
