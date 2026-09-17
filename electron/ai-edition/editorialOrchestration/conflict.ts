/**
 * Conflict graph + redundancy resolution for editorial recommendations.
 * Deterministic. Does not mutate.
 */

import { OPERATION_PRECEDENCE } from "./policy";
import type {
	EditorialFindingV1,
	EditorialOrchestrationPolicy,
	EditorialRecommendationV1,
	PreservedRange,
	TimeRangeSec,
} from "./types";

export interface ConflictEdge {
	a: string;
	b: string;
	reason: string;
	resolution: "suppress_a" | "suppress_b" | "mark_both" | "dependency";
}

function rangesOverlap(a: TimeRangeSec, b: TimeRangeSec, padSec = 0.05): boolean {
	return a.startSec < b.endSec + padSec && b.startSec < a.endSec + padSec;
}

export function buildPreservedRanges(findings: EditorialFindingV1[]): PreservedRange[] {
	return findings
		.filter((f) => f.category === "PRESERVATION" && f.sourceRange)
		.map((f) => ({
			id: `pres_range_${f.id}`,
			sourceRange: f.sourceRange!,
			reason: f.reason,
			findingIds: [f.id],
		}));
}

/**
 * Precedence for redundancy: safer / more direct primitive wins.
 * TRIM > SPEED for silence gaps.
 * Prefer READY_TO_APPLY over MISSING_ARGS when same family.
 */
export function redundancyWinner(
	a: EditorialRecommendationV1,
	b: EditorialRecommendationV1,
	policy: EditorialOrchestrationPolicy,
): "a" | "b" {
	if (
		policy.preferTrimOverSpeedForSilence &&
		a.operationFamily === "TRIM" &&
		b.operationFamily === "SPEED"
	) {
		return "a";
	}
	if (
		policy.preferTrimOverSpeedForSilence &&
		b.operationFamily === "TRIM" &&
		a.operationFamily === "SPEED"
	) {
		return "b";
	}
	const readyRank = (r: EditorialRecommendationV1) =>
		r.executionReadiness === "READY_TO_APPLY" ? 0 : 1;
	if (readyRank(a) !== readyRank(b)) return readyRank(a) < readyRank(b) ? "a" : "b";
	const statusRank = (r: EditorialRecommendationV1) =>
		r.recommendationStatus === "RECOMMEND" ? 0 : r.recommendationStatus === "OPTIONAL" ? 1 : 2;
	if (statusRank(a) !== statusRank(b)) return statusRank(a) < statusRank(b) ? "a" : "b";
	const pa = OPERATION_PRECEDENCE[a.operationFamily] ?? 50;
	const pb = OPERATION_PRECEDENCE[b.operationFamily] ?? 50;
	return pa <= pb ? "a" : "b";
}

export function resolveConflictsAndRedundancy(args: {
	recommendations: EditorialRecommendationV1[];
	preserved: PreservedRange[];
	policy: EditorialOrchestrationPolicy;
}): {
	recommendations: EditorialRecommendationV1[];
	edges: ConflictEdge[];
} {
	const recs = args.recommendations.map((r) => ({
		...r,
		conflictsWith: [...r.conflictsWith],
		dependencies: [...r.dependencies],
	}));
	const edges: ConflictEdge[] = [];
	const suppress = new Set<string>();

	// Preservation blocks overlapping TRIM / SPEED / CROP / ZOOM recommends
	for (const r of recs) {
		if (
			r.recommendationStatus === "DO_NOT_RECOMMEND" ||
			r.recommendationStatus === "NEEDS_HUMAN_JUDGMENT"
		) {
			continue;
		}
		if (!r.sourceRange) continue;
		if (!["TRIM", "SPEED", "CROP", "ZOOM"].includes(r.operationFamily)) continue;
		for (const p of args.preserved) {
			if (rangesOverlap(r.sourceRange, p.sourceRange)) {
				edges.push({
					a: r.id,
					b: p.id,
					reason: `Overlaps preserved range: ${p.reason}`,
					resolution: "suppress_a",
				});
				r.conflictsWith.push(p.id);
				r.recommendationStatus = "DO_NOT_RECOMMEND";
				r.rationale = `${r.rationale} — blocked by preservation`;
				r.reviewCopy = `Skipped: ${p.reason}`;
				r.risk = "HIGH";
				r.executionReadiness = "UNSUPPORTED";
				suppress.add(r.id);
			}
		}
	}

	// Pairwise conflicts / redundancy among actionable recs
	for (let i = 0; i < recs.length; i++) {
		for (let j = i + 1; j < recs.length; j++) {
			const a = recs[i]!;
			const b = recs[j]!;
			if (suppress.has(a.id) || suppress.has(b.id)) continue;
			if (
				a.recommendationStatus === "DO_NOT_RECOMMEND" ||
				b.recommendationStatus === "DO_NOT_RECOMMEND"
			) {
				continue;
			}

			const sameSilenceIssue =
				a.sourceRange &&
				b.sourceRange &&
				rangesOverlap(a.sourceRange, b.sourceRange) &&
				((a.operationFamily === "TRIM" && b.operationFamily === "SPEED") ||
					(a.operationFamily === "SPEED" && b.operationFamily === "TRIM") ||
					(a.operationFamily === b.operationFamily && a.operationFamily === "TRIM"));

			if (sameSilenceIssue) {
				const winner = redundancyWinner(a, b, args.policy);
				const lose = winner === "a" ? b : a;
				const win = winner === "a" ? a : b;
				edges.push({
					a: win.id,
					b: lose.id,
					reason: "Redundant pacing fix for overlapping range — prefer safer primitive",
					resolution: winner === "a" ? "suppress_b" : "suppress_a",
				});
				lose.conflictsWith.push(win.id);
				lose.recommendationStatus = "DO_NOT_RECOMMEND";
				lose.rationale = `${lose.rationale} — redundant with ${win.operationFamily}`;
				lose.reviewCopy = `Not needed — ${win.operationFamily.toLowerCase()} already addresses this range.`;
				lose.executionReadiness = "UNSUPPORTED";
				suppress.add(lose.id);
				continue;
			}

			// ZOOM target removed by TRIM
			if (
				a.sourceRange &&
				b.sourceRange &&
				rangesOverlap(a.sourceRange, b.sourceRange) &&
				((a.operationFamily === "TRIM" && b.operationFamily === "ZOOM") ||
					(a.operationFamily === "ZOOM" && b.operationFamily === "TRIM"))
			) {
				const trim = a.operationFamily === "TRIM" ? a : b;
				const zoom = a.operationFamily === "ZOOM" ? a : b;
				edges.push({
					a: trim.id,
					b: zoom.id,
					reason: "TRIM overlaps ZOOM focal range",
					resolution: "mark_both",
				});
				trim.conflictsWith.push(zoom.id);
				zoom.conflictsWith.push(trim.id);
				zoom.dependencies.push(trim.id);
				// Prefer not recommending both; mark zoom as needs human if trim is recommended
				if (
					trim.recommendationStatus === "RECOMMEND" &&
					zoom.recommendationStatus === "RECOMMEND"
				) {
					zoom.recommendationStatus = "NEEDS_HUMAN_JUDGMENT";
					zoom.reviewCopy = "Zoom target overlaps a proposed trim — resolve order before applying.";
					zoom.executionReadiness = "NEEDS_HUMAN_SELECTION";
				}
			}

			// CROP excludes ZOOM focal region (overlap → conflict)
			if (
				a.sourceRange &&
				b.sourceRange &&
				rangesOverlap(a.sourceRange, b.sourceRange) &&
				((a.operationFamily === "CROP" && b.operationFamily === "ZOOM") ||
					(a.operationFamily === "ZOOM" && b.operationFamily === "CROP"))
			) {
				edges.push({
					a: a.id,
					b: b.id,
					reason: "CROP and ZOOM may exclude each other's geometry",
					resolution: "mark_both",
				});
				a.conflictsWith.push(b.id);
				b.conflictsWith.push(a.id);
				if (a.recommendationStatus === "RECOMMEND" && b.recommendationStatus === "RECOMMEND") {
					b.recommendationStatus = "NEEDS_HUMAN_JUDGMENT";
					b.executionReadiness = "NEEDS_HUMAN_SELECTION";
				}
			}
		}
	}

	return { recommendations: recs, edges };
}
