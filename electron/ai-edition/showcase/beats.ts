/**
 * Music for a showcase: find the beat, so cards and pulses land on it.
 *
 * The song is decoded small (mono, 11 kHz); an onset curve (how much louder
 * each 23 ms slice is than the one before) is autocorrelated to find the
 * tempo between 70 and 180 BPM, and the phase that lines the most onsets up
 * gives the beat grid. Simple and deterministic — enough to cut to.
 */

import { runProcessBuffer } from "../mediaStudio";

export const BEAT_SAMPLE_RATE = 11025;
const HOP = 256;

/** Onset strength per hop: the rise in log energy (never negative). */
export function onsetEnvelope(samples: Float32Array, hop = HOP): Float32Array {
	const n = Math.floor(samples.length / hop);
	const env = new Float32Array(n);
	let prev = 0;
	for (let i = 0; i < n; i++) {
		let e = 0;
		for (let j = i * hop; j < (i + 1) * hop; j++) e += samples[j]! * samples[j]!;
		const le = Math.log1p(1000 * (e / hop));
		env[i] = i === 0 ? 0 : Math.max(0, le - prev);
		prev = le;
	}
	return env;
}

export interface BeatGrid {
	bpm: number;
	/** Beat times in seconds from the start of the decoded audio. */
	beats: number[];
}

/** Tempo and beat times from an onset envelope sampled at `rate` values per second. */
export function beatGridFromEnvelope(env: Float32Array, rate: number): BeatGrid | null {
	const n = env.length;
	if (n < rate * 3) return null;
	const minLag = Math.floor((60 / 180) * rate);
	const maxLag = Math.ceil((60 / 70) * rate);
	let bestLag = 0;
	let bestScore = 0;
	for (let lag = minLag; lag <= maxLag; lag++) {
		let acc = 0;
		for (let i = lag; i < n; i++) acc += env[i]! * env[i - lag]!;
		// Mild preference for tempos near 120 so a half/double-time lag does not win on noise.
		const bpm = (60 * rate) / lag;
		const score = (acc / (n - lag)) * (1 - Math.abs(Math.log2(bpm / 120)) * 0.15);
		if (score > bestScore) {
			bestScore = score;
			bestLag = lag;
		}
	}
	if (!bestLag || bestScore <= 0) return null;
	// Refine to a fractional period and its phase: an integer lag drifts a whole
	// beat off over a minute of music.
	let bestPeriod = bestLag;
	let bestPhase = 0;
	let phaseScore = -1;
	for (let p = bestLag - 1; p <= bestLag + 1; p += 0.02) {
		for (let ph = 0; ph < p; ph += 0.5) {
			let acc = 0;
			for (let t = ph; t < n; t += p) acc += env[Math.round(t)] ?? 0;
			if (acc > phaseScore) {
				phaseScore = acc;
				bestPhase = ph;
				bestPeriod = p;
			}
		}
	}
	const period = bestPeriod / rate;
	const beats: number[] = [];
	for (let t = bestPhase / rate; t < n / rate; t += period) beats.push(Math.round(t * 1000) / 1000);
	return { bpm: Math.round((60 / period) * 10) / 10, beats };
}

/** Decode `durationSec` of a song from `startSec` and find its beats. Null when it cannot be read. */
export async function detectBeats(
	ffmpegPath: string,
	path: string,
	startSec: number,
	durationSec: number,
	signal?: AbortSignal,
): Promise<BeatGrid | null> {
	const buf = await runProcessBuffer(
		ffmpegPath,
		[
			"-v",
			"error",
			"-ss",
			startSec.toFixed(3),
			"-t",
			Math.max(3, durationSec).toFixed(3),
			"-i",
			path,
			"-ac",
			"1",
			"-ar",
			String(BEAT_SAMPLE_RATE),
			"-f",
			"f32le",
			"-",
		],
		{ timeoutMs: 120_000, signal },
	).catch((err) => {
		if (err instanceof Error && err.name === "AbortError") throw err;
		return null;
	});
	if (!buf || buf.length < BEAT_SAMPLE_RATE * 4 * 3) return null;
	const samples = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + Math.floor(buf.length / 4) * 4));
	return beatGridFromEnvelope(onsetEnvelope(samples), BEAT_SAMPLE_RATE / HOP);
}

/** Move `t` onto the nearest beat when one is within `window` seconds. */
export function snapToBeat(t: number, beats: readonly number[], window = 0.3): number {
	let best = t;
	let dist = window;
	for (const b of beats) {
		const d = Math.abs(b - t);
		if (d < dist) {
			dist = d;
			best = b;
		}
		if (b > t + window) break;
	}
	return best;
}
