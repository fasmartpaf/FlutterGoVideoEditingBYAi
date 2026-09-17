/**
 * Post-apply loudness verification — re-measure with volume=gain via FFmpeg.
 * Fail-closed → caller rolls back.
 */

import { analyzeLoudness } from "./analyze";
import type { AudioNormalizeCandidateV1, LoudnessVerifyResult } from "./types";

export async function verifyLoudnessAfterNormalize(args: {
	candidate: AudioNormalizeCandidateV1;
	appliedGainDb: number;
	mediaPath: string;
	assetId: string;
	cacheDir?: string;
}): Promise<LoudnessVerifyResult> {
	const t0 = Date.now();
	const before = args.candidate.analysis;
	const policy = args.candidate.targetPolicy;
	const notes: string[] = [];

	const after = await analyzeLoudness({
		assetId: args.assetId,
		mediaPath: args.mediaPath,
		policy,
		preVolumeDb: args.appliedGainDb,
		bypassCache: true,
		cacheDir: args.cacheDir,
	});

	if (after.audioState !== "present" || after.integratedLufs == null) {
		notes.push("BLOCKING:post_measure_failed");
		return {
			passed: false,
			blocking: true,
			notes,
			before,
			after,
			appliedGainDb: args.appliedGainDb,
			latencyMs: Date.now() - t0,
		};
	}

	const target = policy.targetIntegratedLufs;
	const expected = args.candidate.expectedIntegratedLufs ?? target;
	const deltaFromExpected = Math.abs(after.integratedLufs - expected);
	if (deltaFromExpected > policy.verifyIntegratedToleranceDb) {
		notes.push(
			`BLOCKING:integrated_not_near_expected got=${after.integratedLufs.toFixed(2)} expected=${expected.toFixed(2)} tol=${policy.verifyIntegratedToleranceDb}`,
		);
	} else {
		notes.push(
			`integrated_ok got=${after.integratedLufs.toFixed(2)} expected=${expected.toFixed(2)} delta=${deltaFromExpected.toFixed(2)}`,
		);
	}

	// Still require we did not move away from the absolute target vs before
	if (before.integratedLufs != null) {
		const beforeDist = Math.abs(before.integratedLufs - target);
		const afterDist = Math.abs(after.integratedLufs - target);
		if (afterDist > beforeDist + 0.35) {
			notes.push("BLOCKING:moved_away_from_target");
		} else {
			notes.push(
				`toward_target beforeDist=${beforeDist.toFixed(2)} afterDist=${afterDist.toFixed(2)}`,
			);
		}
	}

	if (after.truePeakDbTp != null && after.truePeakDbTp > policy.verifyMaxTruePeakDbTp) {
		notes.push(
			`BLOCKING:true_peak_exceeded got=${after.truePeakDbTp.toFixed(2)} max=${policy.verifyMaxTruePeakDbTp}`,
		);
	} else if (after.truePeakDbTp != null) {
		notes.push(`true_peak_ok ${after.truePeakDbTp.toFixed(2)}`);
	}

	const blocking = notes.some((n) => n.startsWith("BLOCKING:"));
	return {
		passed: !blocking,
		blocking,
		notes,
		before,
		after,
		appliedGainDb: args.appliedGainDb,
		latencyMs: Date.now() - t0,
	};
}
