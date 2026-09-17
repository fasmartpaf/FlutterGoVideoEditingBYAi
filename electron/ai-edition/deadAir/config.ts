/**
 * Conservative detector + policy defaults for speech/screen recordings.
 *
 * These are heuristics for V1 candidate generation — not editorial taste.
 * Tuned for high precision / lower recall (prefer missing silence over cutting
 * speech). Documented here so diagnostics can show the live values.
 */

import type { SilenceClassification, SilenceDetectorParameters } from "./types";
import { DEFAULT_VISUAL_SAFETY_POLICY, type VisualSafetyPolicy } from "./visualPolicy";

export interface DeadAirPolicyConfig {
	detector: SilenceDetectorParameters;
	/** Protect speech edges when proposing a trim inside a silence interval. */
	speechPaddingSec: number;
	/** Natural pause left after shortening interior / inter-sentence silence. */
	targetPauseInteriorSec: number;
	/** Shorter keep for leading pad silence. */
	targetPauseLeadingSec: number;
	/**
	 * Trailing: V1 does not auto-propose by default (outro / end-state risk).
	 * When true, still requires long silence + no visual activity.
	 */
	allowTrailingPropose: boolean;
	targetPauseTrailingSec: number;
	/** Raw silence must be at least this long before keep-some-pause math. */
	minSilenceForCandidateSec: number;
	/** After keep + pads, must still remove at least this much. */
	minRemovableSec: number;
	/** Cursor non-move interactions inside silence → visual block. */
	visualCursorBlock: boolean;
	/** Inter-sentence pause below this after classification stays INTER_SENTENCE (not proposed). */
	interSentenceMaxProposeSec: number;
	/**
	 * When true, mid-length INTER_SENTENCE pauses may SHORTEN (keep breath) via keep-pause.
	 * Short natural breaths below interSentenceMinShortenSec remain KEEP.
	 */
	allowInterSentenceShorten?: boolean;
	/** Minimum silence duration before inter-sentence SHORTEN is allowed. */
	interSentenceMinShortenSec?: number;
	/** V1.1 visual activity safety. */
	visualSafety: VisualSafetyPolicy;
	/**
	 * User explicitly asked to remove pauses / silence.
	 * Allows tighter keep-pause math, trailing propose, and speech-clamped
	 * trims so Chat can produce visible timeline cuts.
	 */
	explicitUserCut?: boolean;
}

/**
 * Evidence notes for defaults:
 * - noise -35 dB: common silencedetect starting point for speech; less aggressive
 *   than -30 (which marks soft speech as silence) and less sensitive than -50.
 * - d=0.55s: above typical breath (~0.2–0.4s) so short pauses are TOO_SHORT.
 * - keep 0.55s interior: leaves a natural beat; never collapse to zero.
 */
export const DEFAULT_DEAD_AIR_POLICY: DeadAirPolicyConfig = {
	detector: {
		noiseThresholdDb: -35,
		minimumSilenceDurationSec: 0.55,
		timeoutMs: 60_000,
	},
	speechPaddingSec: 0.15,
	targetPauseInteriorSec: 0.55,
	targetPauseLeadingSec: 0.2,
	allowTrailingPropose: false,
	targetPauseTrailingSec: 0.4,
	minSilenceForCandidateSec: 1.0,
	minRemovableSec: 0.4,
	visualCursorBlock: true,
	interSentenceMaxProposeSec: 1.25,
	visualSafety: { ...DEFAULT_VISUAL_SAFETY_POLICY },
	explicitUserCut: false,
};

/** When Chat says “remove pauses / no voice” — still KEEP some pause, but allow visible cuts. */
export const EXPLICIT_PAUSE_REMOVAL_DEAD_AIR_POLICY: DeadAirPolicyConfig = {
	...DEFAULT_DEAD_AIR_POLICY,
	allowTrailingPropose: true,
	targetPauseInteriorSec: 0.28,
	targetPauseLeadingSec: 0.15,
	targetPauseTrailingSec: 0.25,
	minSilenceForCandidateSec: 0.75,
	minRemovableSec: 0.28,
	visualCursorBlock: false,
	explicitUserCut: true,
};

/**
 * “Make this professional. You decide.” — same tightening as explicit pause removal
 * so product Chat is not stuck on captions/loudness while obvious quiet gaps remain.
 */
export const PROFESSIONAL_YOU_DECIDE_DEAD_AIR_POLICY: DeadAirPolicyConfig = {
	...EXPLICIT_PAUSE_REMOVAL_DEAD_AIR_POLICY,
	allowInterSentenceShorten: true,
	interSentenceMinShortenSec: 0.95,
};

export function targetPauseForClassification(
	classification: SilenceClassification,
	policy: DeadAirPolicyConfig = DEFAULT_DEAD_AIR_POLICY,
): number {
	switch (classification) {
		case "LEADING_SILENCE":
			return policy.targetPauseLeadingSec;
		case "TRAILING_SILENCE":
			return policy.targetPauseTrailingSec;
		case "INTER_SENTENCE_PAUSE":
		case "POSSIBLE_DEAD_AIR":
			return policy.targetPauseInteriorSec;
		default:
			return policy.targetPauseInteriorSec;
	}
}
