/**
 * Recommendation ranking + budget.
 */

import { OPERATION_PRECEDENCE } from "./policy";
import type {
	ConfidenceClass,
	EditorialRecommendationV1,
	FindingSeverity,
	RecommendationStatus,
} from "./types";

const STATUS_SURFACE: RecommendationStatus[] = ["RECOMMEND", "OPTIONAL", "NEEDS_HUMAN_JUDGMENT"];

function confScore(c: ConfidenceClass): number {
	return c === "HIGH" ? 3 : c === "MEDIUM" ? 2 : 1;
}

function severityScore(s: FindingSeverity): number {
	return s === "HIGH" ? 3 : s === "MEDIUM" ? 2 : 1;
}

function statusScore(s: RecommendationStatus): number {
	if (s === "RECOMMEND") return 4;
	if (s === "OPTIONAL") return 2;
	if (s === "NEEDS_HUMAN_JUDGMENT") return 1;
	return 0;
}

function readinessScore(r: EditorialRecommendationV1): number {
	if (r.executionReadiness === "READY_TO_APPLY") return 3;
	if (r.executionReadiness === "MISSING_ARGS") return 1;
	if (r.executionReadiness === "NEEDS_HUMAN_SELECTION") return 1;
	return 0;
}

/** Higher = more worth surfacing. */
export function recommendationPriority(r: EditorialRecommendationV1): number {
	if (r.recommendationStatus === "DO_NOT_RECOMMEND") return -1000;
	const riskPenalty = severityScore(r.risk);
	return (
		statusScore(r.recommendationStatus) * 100 +
		confScore(r.confidence) * 20 +
		readinessScore(r) * 10 -
		riskPenalty * 5 -
		(OPERATION_PRECEDENCE[r.operationFamily] ?? 50)
	);
}

/**
 * Soft pre-filter budget on raw candidates (before surface eligibility).
 * DO_NOT_RECOMMEND stay for audit.
 */
export function applyRecommendationBudget(
	recommendations: EditorialRecommendationV1[],
	max: number,
): EditorialRecommendationV1[] {
	const blocked = recommendations.filter((r) => r.recommendationStatus === "DO_NOT_RECOMMEND");
	const surface = recommendations
		.filter((r) => STATUS_SURFACE.includes(r.recommendationStatus))
		.sort((a, b) => recommendationPriority(b) - recommendationPriority(a));

	const kept = surface.slice(0, max);
	const dropped = surface.slice(max);
	for (const d of dropped) {
		d.recommendationStatus = "DO_NOT_RECOMMEND";
		d.rationale = `${d.rationale} — over recommendation budget`;
		d.reviewCopy = "Not shown — lower priority than other suggestions.";
		d.conflictsWith = [...d.conflictsWith, "budget_cap"];
	}

	kept.sort(
		(a, b) =>
			(OPERATION_PRECEDENCE[a.operationFamily] ?? 50) -
				(OPERATION_PRECEDENCE[b.operationFamily] ?? 50) ||
			recommendationPriority(b) - recommendationPriority(a),
	);

	return [...kept, ...blocked, ...dropped];
}

export function buildDeterministicSummary(args: {
	status: "ACTIONS_AVAILABLE" | "NO_ACTION_RECOMMENDED" | "NEEDS_HUMAN_JUDGMENT";
	recommendations: EditorialRecommendationV1[];
	questionCount?: number;
}): string {
	const actionable = args.recommendations.filter(
		(r) => r.recommendationStatus === "RECOMMEND" || r.recommendationStatus === "OPTIONAL",
	);
	const q = args.questionCount ?? 0;
	if (args.status === "NO_ACTION_RECOMMENDED") {
		return "No automatic edit recommendations — the recording looks fine to leave as-is.";
	}
	if (args.status === "NEEDS_HUMAN_JUDGMENT" && actionable.length === 0) {
		return q > 0
			? `${q} editorial question${q === 1 ? "" : "s"} need human judgment; no safe automatic edits.`
			: "Needs human judgment; no safe automatic edits.";
	}
	const parts = actionable.slice(0, 3).map((r) => r.reviewCopy.replace(/\.$/, ""));
	const more =
		actionable.length > 3
			? ` (+${actionable.length - 3} more)`
			: q > 0
				? ` (${q} editorial question${q === 1 ? "" : "s"})`
				: "";
	return parts.join(" ") + (parts.length ? "." : "") + more;
}

export function deriveSetStatus(
	recommendations: EditorialRecommendationV1[],
	questionCount = 0,
): "ACTIONS_AVAILABLE" | "NO_ACTION_RECOMMENDED" | "NEEDS_HUMAN_JUDGMENT" {
	const recommend = recommendations.some(
		(r) => r.recommendationStatus === "RECOMMEND" || r.recommendationStatus === "OPTIONAL",
	);
	if (recommend) return "ACTIONS_AVAILABLE";
	if (questionCount > 0) return "NEEDS_HUMAN_JUDGMENT";
	return "NO_ACTION_RECOMMENDED";
}
