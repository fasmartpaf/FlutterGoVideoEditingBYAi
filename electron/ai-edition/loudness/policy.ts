/**
 * Conservative loudness target for screen-recording / online playback.
 *
 * Not EBU R128 broadcast (-23 LUFS): that is often too quiet for tutorials.
 * -16 LUFS integrated is a common online/speech-forward target (YouTube-ish
 * dialogue region) with headroom for true peak.
 */

import type { LoudnessTargetPolicy } from "./types";

export const DEFAULT_LOUDNESS_TARGET_POLICY: LoudnessTargetPolicy = {
	targetIntegratedLufs: -16,
	acceptableBandDb: 2.5,
	maxTruePeakDbTp: -1.5,
	maxGainIncreaseDb: 12,
	maxGainReductionDb: 12,
	minimumMeaningfulDeltaDb: 1.5,
	compositorGainLimitDb: 12,
	verifyIntegratedToleranceDb: 2.0,
	verifyMaxTruePeakDbTp: -1.0,
};
