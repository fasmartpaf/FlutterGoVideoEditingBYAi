/**
 * Offline micro-fade experiment on problematic PCM joins.
 * Report-only — does NOT change production compositor.
 */

import { analyzeJoinPcm, classifyWaveformPolicy, synthesizeJoinPcm } from "../audioVerify";
import type { MicroFadeExperimentResult, MicroFadeExperimentRow } from "./types";

/** Apply equal-power crossfade of `fadeMs` centered on join index. */
export function applyMicroFade(
	samples: Float32Array,
	sampleRate: number,
	joinOffsetSec: number,
	fadeMs: number,
): Float32Array {
	const out = new Float32Array(samples);
	if (fadeMs <= 0) return out;
	const joinIdx = Math.round(joinOffsetSec * sampleRate);
	const half = Math.max(1, Math.round((fadeMs / 1000) * sampleRate));
	for (let i = 0; i < half; i += 1) {
		const t = (i + 1) / (half + 1);
		const fadeOut = Math.cos((Math.PI / 2) * t);
		const fadeIn = Math.sin((Math.PI / 2) * t);
		const pre = joinIdx - half + i;
		const post = joinIdx + i;
		if (pre >= 0 && pre < out.length && post >= 0 && post < out.length) {
			const a = out[pre] ?? 0;
			const b = out[post] ?? 0;
			// Blend neighborhood toward continuity
			out[pre] = a * fadeOut + b * (1 - fadeOut) * 0.15;
			out[post] = b * fadeIn + a * (1 - fadeIn) * 0.15;
		}
	}
	// Soften instantaneous jump at join
	if (joinIdx > 0 && joinIdx < out.length) {
		const a = out[joinIdx - 1] ?? 0;
		const b = out[joinIdx] ?? 0;
		const mid = (a + b) / 2;
		out[joinIdx - 1] = (a + mid) / 2;
		out[joinIdx] = (b + mid) / 2;
	}
	return out;
}

function rowFor(
	label: MicroFadeExperimentRow["label"],
	fadeMs: number,
	samples: Float32Array,
	sampleRate: number,
	joinOffsetSec: number,
): MicroFadeExperimentRow {
	const metrics = analyzeJoinPcm({ samples, sampleRate, joinOffsetSec });
	const policy = classifyWaveformPolicy(metrics);
	return {
		label,
		fadeMs,
		boundarySampleJump: metrics.boundarySampleJump,
		rmsRatio: metrics.rmsRatio,
		blocking: policy.blocking,
		warnings: policy.warnings,
	};
}

/**
 * Compare current vs optional micro-fades on a click/pop synthetic join.
 */
export function runMicroFadeExperiment(args?: {
	baseSamples?: { samples: Float32Array; sampleRate: number; joinOffsetSec: number };
}): MicroFadeExperimentResult {
	const base =
		args?.baseSamples ?? synthesizeJoinPcm({ mode: "click_pop", sampleRate: 48_000, padSec: 0.75 });
	const { samples, sampleRate, joinOffsetSec } = base;

	const rows: MicroFadeExperimentRow[] = [
		rowFor("current", 0, samples, sampleRate, joinOffsetSec),
		rowFor(
			"fade_10ms",
			10,
			applyMicroFade(samples, sampleRate, joinOffsetSec, 10),
			sampleRate,
			joinOffsetSec,
		),
		rowFor(
			"fade_20ms",
			20,
			applyMicroFade(samples, sampleRate, joinOffsetSec, 20),
			sampleRate,
			joinOffsetSec,
		),
		rowFor(
			"fade_30ms",
			30,
			applyMicroFade(samples, sampleRate, joinOffsetSec, 30),
			sampleRate,
			joinOffsetSec,
		),
	];

	const adaptiveMs = 15;
	rows.push(
		rowFor(
			"adaptive",
			adaptiveMs,
			applyMicroFade(samples, sampleRate, joinOffsetSec, adaptiveMs),
			sampleRate,
			joinOffsetSec,
		),
	);

	const current = rows[0]!;
	const best = rows
		.slice(1)
		.reduce((a, b) => (b.boundarySampleJump < a.boundarySampleJump ? b : a));

	const notes = [
		"Native compositor already uses AUDIO_BOUNDARY_FADE_SAMPLES=240 (~5ms) at PCM joins.",
		"Native video uses CUT_FADE_HALF_SEC=0.35s dissolve — unrelated to micro-fade.",
		"video-use 30ms policy is NOT present in OpenScreen production.",
		`Synthetic click_pop current jump=${current.boundarySampleJump.toFixed(3)}; best experimental=${best.label} jump=${best.boundarySampleJump.toFixed(3)}.`,
	];

	let policyRecommendation: MicroFadeExperimentResult["policyRecommendation"] =
		"MORE_EVIDENCE_REQUIRED";
	if (current.blocking.length === 0) {
		policyRecommendation = "NO_CHANGE";
		notes.push("Baseline synthetic already non-blocking after native-style analysis? unexpected.");
	} else if (
		best.blocking.length === 0 &&
		best.boundarySampleJump < current.boundarySampleJump * 0.5
	) {
		// Improvement clear on synthetic — still need real corpus before shipping fades.
		policyRecommendation = "MORE_EVIDENCE_REQUIRED";
		notes.push(
			"Synthetic pop improves with micro-fade, but production compositor must stay unchanged until real-media corpus confirms.",
		);
	} else {
		policyRecommendation = "MORE_EVIDENCE_REQUIRED";
	}

	return {
		policyRecommendation,
		nativeAudioBoundaryFadeSamples: 240,
		nativeAudioBoundaryFadeMsApprox: 5,
		rows,
		notes,
	};
}
