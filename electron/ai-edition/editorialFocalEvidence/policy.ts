/**
 * Deterministic focal / zoom policy — restraint over volume.
 */

export const FOCAL_POLICY_V1 = {
	/** Max velocity (norm units / sec) to count as dwell sample. */
	maxDwellVelocity: 0.08,
	minDwellSec: 0.45,
	maxDwellSec: 4.0,
	dwellMoveThreshold: 0.02,
	/** Click → look for dwell within this window. */
	clickDwellWindowSec: 1.2,
	/** Spatial cluster radius for interaction compact-ness. */
	clusterRadius: 0.08,
	minClusterInteractions: 2,
	minGroundedPersistSec: 0.55,
	/** Max zoom hold on screen tutorials — enter/hold/exit, not half the take. */
	maxZoomHoldSec: 3.8,
	/** Do not merge spatially-near seeds across this temporal gap. */
	mergeMaxTemporalGapSec: 3.5,
	/** Region area above this fraction of frame → TARGET_TOO_LARGE. */
	maxTargetArea: 0.55,
	minTargetArea: 0.01,
	/** Prefer restrained depth for screen recordings. */
	defaultZoomDepth: 2 as const,
	maxZoomDepth: 3 as const,
	existingZoomFocusMatch: 0.06,
	competeDistance: 0.22,
	approachConvergenceVar: 0.012,
	/** Corroboration boosts confidence; never creates geometry alone. */
	visualCorroborationWindowSec: 0.8,
	ocrNearDistance: 0.12,
	fastMoveVelocity: 0.45,
} as const;

export type FocalPolicyV1 = typeof FOCAL_POLICY_V1;
