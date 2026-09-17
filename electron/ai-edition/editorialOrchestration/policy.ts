/**
 * Orchestration policy — precedence, budget, restraints.
 */

import type { EditorialOrchestrationPolicy } from "./types";
import { EDITORIAL_ORCHESTRATION_POLICY_VERSION } from "./types";

export const DEFAULT_EDITORIAL_ORCHESTRATION_POLICY: EditorialOrchestrationPolicy = {
	version: EDITORIAL_ORCHESTRATION_POLICY_VERSION,
	maxRecommendations: 5,
	preferTrimOverSpeedForSilence: true,
	captionsDefaultOptional: true,
	speedRequiresExplicitIntent: true,
	zoomRequiresFocalTarget: true,
	cropRequiresFramingEvidence: true,
	suppressIncompleteGeometryCards: true,
	activityWithoutFocalAsQuestion: true,
};

/**
 * Review-only precedence (lowest index = earlier in suggested review order).
 * Does not auto-apply.
 */
export const OPERATION_PRECEDENCE: Record<string, number> = {
	PRESERVATION: 0,
	TRIM: 1,
	SPEED: 2,
	CROP: 3,
	ZOOM: 4,
	CAPTIONS: 5,
	LOUDNESS: 6,
	NONE: 99,
};

export function mergeOrchestrationPolicy(
	partial?: Partial<EditorialOrchestrationPolicy>,
): EditorialOrchestrationPolicy {
	return { ...DEFAULT_EDITORIAL_ORCHESTRATION_POLICY, ...partial };
}
