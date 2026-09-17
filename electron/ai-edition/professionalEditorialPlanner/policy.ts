/**
 * Bounded planner policy — restraint over volume.
 */

export const PLANNER_POLICY_V1 = {
	minSpeedSpanSec: 1.8,
	minSpeedBenefitSec: 0.55,
	/** Speeds only when speech overlap fraction below this. */
	maxSpeechOverlapForSpeed: 0.15,
	speedRates: {
		mild: 1.25,
		medium: 1.5,
		strong: 2.0,
	} as const,
	/** Prefer mild unless span is long and speech-free. */
	strongSpeedMinSpanSec: 8,
	mediumSpeedMinSpanSec: 4,
	minZoomUsefulOverlapSec: 0.25,
	maxOpsFromPlanner: 12,
	rankWeights: {
		material: 3,
		evidence: 2,
		readiness: 2,
		preservation: 2,
	},
} as const;
