/**
 * Result-level self review — programme as a whole.
 * Separates TECHNICALLY_VALID from EDITORIALLY_IMPROVED.
 */

import type { ProfessionalEditOrchestratorResultV1 } from "../professionalEditOrchestrator/types";
import type { FinalResultSelfReviewV1 } from "./types";

export const MAX_AUTONOMOUS_REVISIONS_V1 = 1;

export function reviewFinalProgramme(args: {
	result: ProfessionalEditOrchestratorResultV1;
	originalDurationSec: number;
	revisionUsed?: number;
}): FinalResultSelfReviewV1 {
	const { result } = args;
	const committed = result.session.completed.filter((c) => c.status === "committed").length;
	const loudnessCommitted = Boolean(result.loudness?.committed);
	const anyCommit = committed > 0 || loudnessCommitted;
	const rolledBack = result.session.failed.filter((c) => c.status === "rolled_back").length;
	const qc = result.finalSequenceQc?.overall;
	const joinQuality =
		qc === "PASS" || qc === "PASS_WITH_WARNINGS" ? "PASS" : qc === "FAIL" ? "FAIL" : "NOT_RUN";

	const technicallyValid =
		rolledBack === 0 && result.metrics.autoUnverifiedMutations === 0 && joinQuality !== "FAIL";

	const families = new Set(result.plan.steps.map((s) => s.family));
	if (loudnessCommitted) families.add("loudness");

	const onlyCaptionsLoudness =
		anyCommit &&
		[...families].every((f) => f === "captions" || f === "loudness") &&
		!families.has("trim") &&
		!families.has("zoom") &&
		!families.has("speed") &&
		!families.has("crop");

	const finalDur = result.session.finalProgrammeDurationSec ?? args.originalDurationSec;
	const shortened = finalDur < args.originalDurationSec - 0.4;

	let editorialImprovement: FinalResultSelfReviewV1["editorialImprovement"] = "UNCHANGED";
	if (!anyCommit) {
		editorialImprovement = "UNCHANGED";
	} else if (!technicallyValid) {
		editorialImprovement = "POSSIBLY_WORSE";
	} else if (onlyCaptionsLoudness) {
		editorialImprovement = "TECHNICALLY_VALID_NO_CLEAR_IMPROVEMENT";
	} else if (families.has("trim") || families.has("zoom") || families.has("speed") || shortened) {
		editorialImprovement = "EDITORIALLY_IMPROVED";
	} else {
		editorialImprovement = "TECHNICALLY_VALID_NO_CLEAR_IMPROVEMENT";
	}

	const notes: string[] = [];
	if (!anyCommit) notes.push("No timeline/settings mutations committed");
	if (onlyCaptionsLoudness) {
		notes.push(
			"Committed families were captions/loudness only — accessibility polish, not full editorial reshape",
		);
	}
	if (result.planner?.metrics.temporalContextConsumed) {
		notes.push("Temporal context was consumed during planning");
	}
	if (joinQuality === "FAIL") notes.push("Final sequence QC FAIL");

	const revisionBudgetRemaining = Math.max(
		0,
		MAX_AUTONOMOUS_REVISIONS_V1 - (args.revisionUsed ?? 0),
	);
	const replanSuggested =
		technicallyValid === false && revisionBudgetRemaining > 0 && rolledBack > 0;

	return {
		version: 1,
		technicallyValid,
		editorialImprovement,
		storyContinuity: technicallyValid ? "OK" : "RISK",
		pacing: shortened ? "OK" : anyCommit ? "UNKNOWN" : "STILL_SLOW",
		attentionFlow: families.has("zoom") ? "OK" : "UNKNOWN",
		captionQuality:
			families.has("captions") ||
			result.decisionTable.some((d) => d.family === "CAPTIONS" && d.decision === "KEEP")
				? "OK"
				: "SKIP",
		audioQuality:
			loudnessCommitted || result.decisionTable.some((d) => d.family === "LOUDNESS")
				? "OK"
				: "SKIP",
		joinQuality,
		durationObjective: shortened ? "MET" : "N_A",
		preservation: technicallyValid ? "OK" : "RISK",
		notes,
		replanSuggested,
		revisionBudgetRemaining,
	};
}
