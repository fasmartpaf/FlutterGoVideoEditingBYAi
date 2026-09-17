/**
 * Deterministic PCM continuity metrics for a programme join.
 */

import {
	AUDIO_VERIFY_CONTEXT_SEC,
	AUDIO_VERIFY_MICRO_WINDOW_SEC,
	type AudioWaveformMetrics,
} from "./types";

const NEAR_SILENCE = 0.01;
const CLIP_LEVEL = 0.98;
/** Blocking pop: near full-scale instantaneous jump. */
export const BLOCKING_BOUNDARY_JUMP = 0.85;
/** Warning: large but not extreme jump. */
export const WARNING_BOUNDARY_JUMP = 0.45;
/** Warning RMS ratio when neither side is near-silence. */
export const WARNING_RMS_RATIO = 12;
/** Blocking clipping fraction. */
export const BLOCKING_CLIP_FRACTION = 0.02;

function rms(samples: Float32Array): number {
	if (samples.length === 0) return 0;
	let s = 0;
	for (let i = 0; i < samples.length; i += 1) {
		const v = samples[i] ?? 0;
		s += v * v;
	}
	return Math.sqrt(s / samples.length);
}

function peak(samples: Float32Array): number {
	let p = 0;
	for (let i = 0; i < samples.length; i += 1) {
		p = Math.max(p, Math.abs(samples[i] ?? 0));
	}
	return p;
}

function nearSilenceFraction(samples: Float32Array): number {
	if (samples.length === 0) return 1;
	let n = 0;
	for (let i = 0; i < samples.length; i += 1) {
		if (Math.abs(samples[i] ?? 0) < NEAR_SILENCE) n += 1;
	}
	return n / samples.length;
}

function clippingFraction(samples: Float32Array): number {
	if (samples.length === 0) return 0;
	let n = 0;
	for (let i = 0; i < samples.length; i += 1) {
		if (Math.abs(samples[i] ?? 0) >= CLIP_LEVEL) n += 1;
	}
	return n / samples.length;
}

/**
 * Analyze PCM where join is at `joinOffsetSec` from buffer start.
 */
export function analyzeJoinPcm(args: {
	samples: Float32Array;
	sampleRate: number;
	joinOffsetSec: number;
}): AudioWaveformMetrics {
	const { samples, sampleRate, joinOffsetSec } = args;
	const joinIdx = Math.max(0, Math.min(samples.length - 1, Math.round(joinOffsetSec * sampleRate)));
	const micro = Math.max(1, Math.round(AUDIO_VERIFY_MICRO_WINDOW_SEC * sampleRate));
	const context = Math.max(micro, Math.round(AUDIO_VERIFY_CONTEXT_SEC * sampleRate));

	const preMicro = samples.subarray(Math.max(0, joinIdx - micro), joinIdx);
	const postMicro = samples.subarray(joinIdx, Math.min(samples.length, joinIdx + micro));
	const preCtx = samples.subarray(Math.max(0, joinIdx - context), joinIdx);
	const postCtx = samples.subarray(joinIdx, Math.min(samples.length, joinIdx + context));

	const lastPre = preMicro.length > 0 ? (preMicro[preMicro.length - 1] ?? 0) : 0;
	const firstPost = postMicro.length > 0 ? (postMicro[0] ?? 0) : 0;
	const boundarySampleJump = Math.abs(firstPost - lastPre);

	const rmsBefore = rms(preCtx);
	const rmsAfter = rms(postCtx);
	const rmsRatio =
		rmsBefore < 1e-6 ? (rmsAfter < 1e-6 ? 1 : Number.POSITIVE_INFINITY) : rmsAfter / rmsBefore;

	return {
		rmsBefore,
		rmsAfter,
		peakBefore: peak(preCtx),
		peakAfter: peak(postCtx),
		boundarySampleJump,
		clippingFraction: clippingFraction(samples),
		nearSilenceFractionBefore: nearSilenceFraction(preCtx),
		nearSilenceFractionAfter: nearSilenceFraction(postCtx),
		rmsRatio: Number.isFinite(rmsRatio) ? rmsRatio : 999,
	};
}

export function classifyWaveformPolicy(metrics: AudioWaveformMetrics): {
	blocking: string[];
	warnings: string[];
} {
	const blocking: string[] = [];
	const warnings: string[] = [];

	if (metrics.boundarySampleJump >= BLOCKING_BOUNDARY_JUMP) {
		blocking.push(`boundary_jump:${metrics.boundarySampleJump.toFixed(3)}`);
	} else if (metrics.boundarySampleJump >= WARNING_BOUNDARY_JUMP) {
		warnings.push(`boundary_jump_warning:${metrics.boundarySampleJump.toFixed(3)}`);
	}

	if (metrics.clippingFraction >= BLOCKING_CLIP_FRACTION) {
		blocking.push(`clipping:${metrics.clippingFraction.toFixed(4)}`);
	} else if (metrics.clippingFraction > 0.005) {
		warnings.push(`clipping_warning:${metrics.clippingFraction.toFixed(4)}`);
	}

	const bothActive =
		metrics.nearSilenceFractionBefore < 0.85 && metrics.nearSilenceFractionAfter < 0.85;
	if (bothActive && metrics.rmsRatio >= WARNING_RMS_RATIO) {
		warnings.push(`rms_jump_warning:${metrics.rmsRatio.toFixed(2)}`);
	}
	// Inverse ratio
	if (bothActive && metrics.rmsRatio > 0 && 1 / metrics.rmsRatio >= WARNING_RMS_RATIO) {
		warnings.push(`rms_drop_warning:${(1 / metrics.rmsRatio).toFixed(2)}`);
	}

	return { blocking, warnings };
}

/** Build synthetic PCM for tests: silence / pop / loudness jump. */
export function synthesizeJoinPcm(args: {
	mode: "safe_silence" | "click_pop" | "loudness_jump" | "clipping";
	sampleRate?: number;
	padSec?: number;
}): { samples: Float32Array; sampleRate: number; joinOffsetSec: number } {
	const sampleRate = args.sampleRate ?? 48_000;
	const pad = args.padSec ?? 0.75;
	const total = Math.round(pad * 2 * sampleRate);
	const join = Math.round(pad * sampleRate);
	const samples = new Float32Array(total);

	if (args.mode === "safe_silence") {
		for (let i = 0; i < total; i += 1) {
			samples[i] = (Math.random() - 0.5) * 0.002; // tiny room tone
		}
	} else if (args.mode === "click_pop") {
		for (let i = 0; i < join; i += 1) samples[i] = 0.9;
		for (let i = join; i < total; i += 1) samples[i] = -0.9;
	} else if (args.mode === "loudness_jump") {
		for (let i = 0; i < join; i += 1) samples[i] = Math.sin(i * 0.02) * 0.02;
		for (let i = join; i < total; i += 1) samples[i] = Math.sin(i * 0.02) * 0.35;
	} else if (args.mode === "clipping") {
		for (let i = 0; i < total; i += 1) samples[i] = i % 2 === 0 ? 0.995 : -0.995;
	}

	return { samples, sampleRate, joinOffsetSec: pad };
}
