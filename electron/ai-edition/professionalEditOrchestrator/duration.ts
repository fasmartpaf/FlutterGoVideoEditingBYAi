/**
 * Duration objective assessment — never sacrifice important content for a number.
 */

import type { DeadAirCandidateV1 } from "../deadAir";
import type {
	DurationObjectiveAssessmentV1,
	ProfessionalEditIntentV1,
	ProfessionalEditStoryV1,
} from "./types";

export function assessDurationObjective(args: {
	originalDurationSec: number;
	intent: ProfessionalEditIntentV1;
	story: ProfessionalEditStoryV1;
	safeDeadAirCandidates: DeadAirCandidateV1[];
}): DurationObjectiveAssessmentV1 {
	const targetMax = args.intent.targetDurationMaxSec ?? args.intent.targetDurationSec;
	const removableSafeSec = args.safeDeadAirCandidates.reduce(
		(n, c) => n + (c.resultingRemovedDurationSec ?? 0),
		0,
	);
	const projected = Math.max(0, args.originalDurationSec - removableSafeSec);
	const notes: string[] = [];

	if (targetMax == null) {
		return {
			kind: "INSUFFICIENT_EVIDENCE",
			originalDurationSec: args.originalDurationSec,
			targetMaxSec: null,
			projectedSafeDurationSec: projected,
			removableSafeSec,
			notes: ["no_explicit_duration_target"],
		};
	}

	if (projected <= targetMax + 0.35) {
		notes.push("safe_dead_air_sufficient_for_target");
		return {
			kind: "ACHIEVABLE_SAFE",
			originalDurationSec: args.originalDurationSec,
			targetMaxSec: targetMax,
			projectedSafeDurationSec: projected,
			removableSafeSec,
			notes,
		};
	}

	const optionalSec = args.story.optionalRanges.reduce(
		(n, r) => n + Math.max(0, r.endSec - r.startSec),
		0,
	);
	const allowOptional = args.intent.allowOptionalContentRemoval === true;
	if (projected - optionalSec * (allowOptional ? 0.85 : 0.5) <= targetMax + 0.5) {
		notes.push(
			allowOptional
				? "user_authorized_optional_content_removal"
				: "would_need_optional_content_removal",
		);
		return {
			kind: "ACHIEVABLE_WITH_OPTIONAL_CONTENT_REMOVAL",
			originalDurationSec: args.originalDurationSec,
			targetMaxSec: targetMax,
			projectedSafeDurationSec: allowOptional
				? Math.max(targetMax, projected - optionalSec * 0.85)
				: projected,
			removableSafeSec,
			notes,
		};
	}

	notes.push("target_requires_important_speech_loss_or_unverified_cuts");
	return {
		kind: "NOT_ACHIEVABLE_WITHOUT_IMPORTANT_CONTENT_LOSS",
		originalDurationSec: args.originalDurationSec,
		targetMaxSec: targetMax,
		projectedSafeDurationSec: projected,
		removableSafeSec,
		notes,
	};
}
