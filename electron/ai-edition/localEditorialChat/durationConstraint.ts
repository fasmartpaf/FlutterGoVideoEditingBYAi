/**
 * DurationConstraintDecisionV1 — editorial duration targets without blind speed.
 */

import type { DurationObjectiveAssessmentV1 } from "../professionalEditOrchestrator/types";
import type { DurationConstraintDecisionV1 } from "./types";

export function buildDurationConstraintDecision(args: {
	requestedDurationSec: number | null;
	currentDurationSec: number;
	duration: DurationObjectiveAssessmentV1;
	operationsConsidered: string[];
	operationsApplied: string[];
	finalDurationSec: number;
}): DurationConstraintDecisionV1 {
	const target = args.requestedDurationSec ?? args.duration.targetMaxSec;
	const safe = args.duration.projectedSafeDurationSec;
	const achievable =
		target == null
			? true
			: args.duration.kind === "ACHIEVABLE_SAFE" || args.finalDurationSec <= target + 0.4;
	const protectedContent: string[] = [];
	if (args.duration.kind === "NOT_ACHIEVABLE_WITHOUT_IMPORTANT_CONTENT_LOSS") {
		protectedContent.push("IMPORTANT_EXPLANATION_OR_SPEECH");
	}
	if (args.duration.kind === "ACHIEVABLE_WITH_OPTIONAL_CONTENT_REMOVAL") {
		protectedContent.push("OPTIONAL_CONTENT_NOT_FORCED");
	}
	return {
		version: 1,
		requestedDurationSec: target,
		currentDurationSec: args.currentDurationSec,
		safeAchievableDurationSec: safe,
		targetAchievable: achievable,
		operationsConsidered: args.operationsConsidered,
		operationsApplied: args.operationsApplied,
		protectedContentPreventingTarget: protectedContent,
		notes: [...args.duration.notes],
	};
}

export function formatDurationConstraintReceipt(
	decision: DurationConstraintDecisionV1,
	baseText: string,
): string {
	if (decision.requestedDurationSec == null) return baseText;
	const req = decision.requestedDurationSec;
	const after = decision.safeAchievableDurationSec;
	if (decision.targetAchievable && after <= req + 0.4) {
		return baseText;
	}
	const honest =
		`I safely reduced it to about ${after.toFixed(1)} seconds` +
		(req != null
			? `. Going below ${req} seconds would require removing part of the important explanation.`
			: ".");
	if (/could not safely reach|preserved the explanation|important speech/i.test(baseText)) {
		return baseText;
	}
	return `${baseText.trim()} ${honest}`.trim();
}
