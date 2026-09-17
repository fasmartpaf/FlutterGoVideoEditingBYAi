/**
 * Clean-room difference hash (dHash) — algorithmic idea from watch-video `dhash`/`hamming`.
 * Deterministic, local, no model. Operates on grayscale byte buffers.
 * @see reuse/NOTICE.md
 */

import { spawn } from "node:child_process";
import { DHASH_SIZE } from "./constants";

/** 64-bit dHash as unsigned bigint (size=8 → 8×8 comparisons). */
export type DHash = bigint;

export function hammingDistance(a: DHash, b: DHash): number {
	let x = a ^ b;
	let n = 0;
	while (x > 0n) {
		n += Number(x & 1n);
		x >>= 1n;
	}
	return n;
}

/**
 * Compute dHash from a grayscale buffer of width=(size+1), height=size
 * (row-major). Same structure as upstream: horizontal neighbor comparisons.
 */
export function dhashFromGray(gray: Uint8Array, size = DHASH_SIZE): DHash {
	const width = size + 1;
	const height = size;
	const expected = width * height;
	if (gray.length < expected) {
		throw new Error(`dhash gray too small: need ${expected}, got ${gray.length}`);
	}
	let bits = 0n;
	for (let y = 0; y < height; y++) {
		const row = y * width;
		for (let x = 0; x < size; x++) {
			bits <<= 1n;
			if (gray[row + x]! > gray[row + x + 1]!) bits |= 1n;
		}
	}
	return bits;
}

/** Decode JPEG/PNG to (size+1)×size gray via ffmpeg (LANCZOS-ish scale). */
export async function decodeGrayForDhash(
	imagePath: string,
	ffmpegPath: string,
	size = DHASH_SIZE,
): Promise<Uint8Array> {
	const width = size + 1;
	const height = size;
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
			else reject(new Error(stderr.trim() || `dhash decode exit ${code}`));
		});
	});
	return new Uint8Array(buf);
}

export async function dhashImage(
	imagePath: string,
	ffmpegPath: string,
	size = DHASH_SIZE,
): Promise<DHash> {
	const gray = await decodeGrayForDhash(imagePath, ffmpegPath, size);
	return dhashFromGray(gray, size);
}
