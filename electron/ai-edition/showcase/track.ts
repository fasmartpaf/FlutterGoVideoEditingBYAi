/**
 * Following something through a screen recording as the page scrolls.
 *
 * Screen recordings mostly move vertically: a chat or a page scrolls and
 * everything on it slides up or down together. So a cover (blur, a new logo
 * over an old one) follows its spot by tracking the vertical shift of the
 * column band it sits in: each frame's row profile (the mean brightness of
 * every row across the band) is matched against the previous frame's, and
 * the best shift is added up. Cheap enough to run over every frame, and it
 * streams — only one profile per band is kept per frame.
 */

import { spawn } from "node:child_process";

/** Mean brightness of each row across columns [x0, x1) of a gray frame. */
export function rowProfile(gray: Uint8Array, width: number, height: number, x0: number, x1: number): Float32Array {
	const a = Math.max(0, Math.min(width - 1, Math.floor(x0)));
	const b = Math.max(a + 1, Math.min(width, Math.ceil(x1)));
	const out = new Float32Array(height);
	for (let y = 0; y < height; y++) {
		let sum = 0;
		const row = y * width;
		for (let x = a; x < b; x++) sum += gray[row + x]!;
		out[y] = sum / (b - a);
	}
	return out;
}

/**
 * The vertical shift (in rows) that best moves profile `prev` onto `next`:
 * positive = the content moved down. 0 when nothing clearly matches (a new
 * page, a fade) — a cover then stays where it is rather than jumping.
 */
export function bestShift(prev: Float32Array, next: Float32Array, maxShift: number): number {
	const h = prev.length;
	const err = (s: number) => {
		let acc = 0;
		let n = 0;
		for (let y = Math.max(0, s); y < Math.min(h, h + s); y++) {
			acc += Math.abs(next[y]! - prev[y - s]!);
			n++;
		}
		return n > h / 3 ? acc / n : Number.POSITIVE_INFINITY;
	};
	const still = err(0);
	if (still < 0.6) return 0;
	let best = 0;
	let bestErr = still;
	for (let s = -maxShift; s <= maxShift; s++) {
		if (s === 0) continue;
		const e = err(s);
		if (e < bestErr) {
			bestErr = e;
			best = s;
		}
	}
	// Only trust a shift that explains the change much better than "nothing moved".
	return bestErr < still * 0.6 && bestErr < 6 ? best : 0;
}

/** Cumulative vertical offset per frame for each band, in full-resolution pixels (frame 0 = 0). */
export function cumulativeShifts(profiles: Float32Array[][], scale: number, maxShift: number): number[][] {
	return profiles.map((band) => {
		const out: number[] = [0];
		for (let i = 1; i < band.length; i++) out.push(out[i - 1]! + bestShift(band[i - 1]!, band[i]!, maxShift) * scale);
		return out;
	});
}

/**
 * Read a JPEG frame sequence small and gray through ffmpeg and return, for
 * each band [x0, x1) (full-resolution pixels), the cumulative vertical shift
 * of every frame.
 */
export async function trackBands(input: {
	ffmpegPath: string;
	framesPattern: string;
	fps: number;
	width: number;
	height: number;
	bands: Array<{ x0: number; x1: number }>;
	signal?: AbortSignal;
}): Promise<number[][]> {
	const { width, height, bands } = input;
	if (bands.length === 0) return [];
	const scale = Math.max(1, Math.round(width / 320));
	const w = Math.max(2, Math.floor(width / scale / 2) * 2);
	const h = Math.max(2, Math.floor(height / scale / 2) * 2);
	const sx = width / w;
	const sy = height / h;
	const frameBytes = w * h;
	const profiles: Float32Array[][] = bands.map(() => []);
	await new Promise<void>((resolve, reject) => {
		const child = spawn(
			input.ffmpegPath,
			["-v", "error", "-framerate", String(input.fps), "-i", input.framesPattern, "-vf", `scale=${w}:${h},format=gray`, "-f", "rawvideo", "-"],
			{ stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
		);
		const onAbort = () => child.kill("SIGKILL");
		input.signal?.addEventListener("abort", onAbort, { once: true });
		let pending: Buffer = Buffer.alloc(0);
		child.stdout.on("data", (chunk: Buffer) => {
			pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
			while (pending.length >= frameBytes) {
				const frame = new Uint8Array(pending.buffer, pending.byteOffset, frameBytes);
				bands.forEach((b, i) => profiles[i]!.push(rowProfile(frame, w, h, b.x0 / sx, b.x1 / sx)));
				pending = pending.subarray(frameBytes);
			}
		});
		child.on("error", reject);
		child.on("close", (code) => {
			input.signal?.removeEventListener("abort", onAbort);
			if (input.signal?.aborted) {
				const err = new Error("Agent stopped.");
				err.name = "AbortError";
				reject(err);
			} else if (code === 0) resolve();
			else reject(new Error(`Could not track the recording (ffmpeg exit ${code}).`));
		});
	});
	return cumulativeShifts(profiles, sy, Math.ceil(h / 3));
}
