/**
 * Audio join verify — reuses audioVerify PCM metrics (injected or provider).
 */

import {
	AUDIO_VERIFY_PAD_AFTER_SEC,
	AUDIO_VERIFY_PAD_BEFORE_SEC,
	type AudioPcmProvider,
	analyzeJoinPcm,
	classifyWaveformPolicy,
} from "../audioVerify";
import type { JoinModalityResult, ProgrammeJoinV1 } from "./types";

export async function verifyJoinAudio(args: {
	document?: import("../../../src/lib/ai-edition/schema").AxcutDocument | null;
	join: ProgrammeJoinV1;
	pcmProvider?: AudioPcmProvider | null;
	/** Injected PCM for unit tests (join at pad). */
	injectedSamples?: { samples: Float32Array; sampleRate: number; joinOffsetSec: number } | null;
}): Promise<JoinModalityResult> {
	const t0 = Date.now();
	if (args.join.cause === "NATURAL_CONTINUITY") {
		return {
			outcome: "NOT_APPLICABLE",
			blockingReasons: [],
			warnings: [],
			evidenceRefs: [],
			notes: ["natural_continuity_skip_audio"],
			latencyMs: Date.now() - t0,
		};
	}

	let samples: Float32Array | null = null;
	let sampleRate = 48_000;
	let joinOffsetSec = AUDIO_VERIFY_PAD_BEFORE_SEC;

	if (args.injectedSamples) {
		samples = args.injectedSamples.samples;
		sampleRate = args.injectedSamples.sampleRate;
		joinOffsetSec = args.injectedSamples.joinOffsetSec;
	} else if (args.pcmProvider) {
		const start = Math.max(0, args.join.programmeTimeSec - AUDIO_VERIFY_PAD_BEFORE_SEC);
		const end = args.join.programmeTimeSec + AUDIO_VERIFY_PAD_AFTER_SEC;
		try {
			if (!args.document) {
				return {
					outcome: "INSUFFICIENT_EVIDENCE",
					blockingReasons: [],
					warnings: ["pcm_needs_document"],
					evidenceRefs: [],
					notes: ["audio_provider_requires_document"],
					latencyMs: Date.now() - t0,
				};
			}
			const buf = await args.pcmProvider({
				document: args.document,
				programmeStartSec: start,
				programmeEndSec: end,
				assetId: args.join.leftAssetId,
			});
			if (!buf || buf.samples.length === 0) {
				return {
					outcome: "INSUFFICIENT_EVIDENCE",
					blockingReasons: [],
					warnings: ["pcm_unavailable"],
					evidenceRefs: [],
					notes: ["audio_pcm_provider_empty"],
					latencyMs: Date.now() - t0,
				};
			}
			samples = buf.samples;
			sampleRate = buf.sampleRate;
			joinOffsetSec = args.join.programmeTimeSec - start;
		} catch (err) {
			return {
				outcome: "INSUFFICIENT_EVIDENCE",
				blockingReasons: [],
				warnings: ["pcm_provider_error"],
				evidenceRefs: [],
				notes: [err instanceof Error ? err.message.slice(0, 120) : String(err)],
				latencyMs: Date.now() - t0,
			};
		}
	} else {
		return {
			outcome: "INSUFFICIENT_EVIDENCE",
			blockingReasons: [],
			warnings: ["no_pcm_provider"],
			evidenceRefs: [],
			notes: ["audio_not_sampled_this_run"],
			latencyMs: Date.now() - t0,
		};
	}

	const metrics = analyzeJoinPcm({
		samples: samples!,
		sampleRate,
		joinOffsetSec,
	});
	const policy = classifyWaveformPolicy(metrics);
	const outcome =
		policy.blocking.length > 0 ? "FAIL" : policy.warnings.length > 0 ? "WARNING" : "PASS";

	return {
		outcome,
		blockingReasons: policy.blocking,
		warnings: policy.warnings,
		evidenceRefs: [`pcm@${args.join.programmeTimeSec.toFixed(3)}`],
		notes: [],
		latencyMs: Date.now() - t0,
		metrics: {
			boundarySampleJump: metrics.boundarySampleJump,
			rmsRatio: metrics.rmsRatio,
			clippingFraction: metrics.clippingFraction,
			rmsBefore: metrics.rmsBefore,
			rmsAfter: metrics.rmsAfter,
		},
	};
}
