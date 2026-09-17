/**
 * Surface eligibility — PRECISION CLOSURE V1.
 * Separates edit cards from findings and unresolved questions.
 */

import type {
	EditorialFindingV1,
	EditorialRecommendationV1,
	ExecutionReadiness,
	RecommendationSurfaceDecisionV1,
	UnresolvedEditorialQuestionV1,
} from "./types";

export interface SurfacePassResult {
	decisions: RecommendationSurfaceDecisionV1[];
	surfaced: EditorialRecommendationV1[];
	questions: UnresolvedEditorialQuestionV1[];
	metrics: {
		rawCandidates: number;
		surfaceableRecommendations: number;
		questions: number;
		suppressedUnsupported: number;
		suppressedConflicts: number;
		suppressedRedundant: number;
		suppressedBudget: number;
		internalOnly: number;
		SURFACED_READY: number;
		SURFACED_OPTIONAL: number;
		QUESTION_ONLY: number;
		INTERNAL_ONLY: number;
		BLOCKED_UNSUPPORTED: number;
		surfaceMs: number;
	};
}

function fmtSec(n: number): string {
	const s = Math.round(n * 10) / 10;
	return Number.isInteger(s) ? `${s}` : s.toFixed(1);
}

let qSeq = 0;
export function resetSurfaceSeqForTests(): void {
	qSeq = 0;
}

function qid(prefix: string): string {
	qSeq += 1;
	return `q_${prefix}_${qSeq}`;
}

/**
 * Policy (documented):
 * - RECOMMEND/OPTIONAL with READY_TO_APPLY (or verified READY) → surface YES
 * - ZOOM/CROP/SPEED with MISSING_ARGS for fundamental geometry/rate → QUESTION_ONLY or NO
 * - NEEDS_HUMAN_JUDGMENT without a resolvable user choice → QUESTION_ONLY (not an edit card)
 * - DO_NOT_RECOMMEND → NO (internal)
 * - Captions OPTIONAL remains YES when layout-valid
 */
export function decideSurface(r: EditorialRecommendationV1): RecommendationSurfaceDecisionV1 {
	const base = {
		recommendationId: r.id,
		executionReadiness: r.executionReadiness,
		missingParameters: [...r.missingParameters],
		requiresSemanticJudgment: false,
	};

	if (r.recommendationStatus === "DO_NOT_RECOMMEND") {
		const conflict =
			r.conflictsWith.some((c) => c.startsWith("pres_")) ||
			r.rationale.includes("blocked by preservation");
		const redundant = r.rationale.includes("redundant");
		const budget = r.conflictsWith.includes("budget_cap");
		return {
			...base,
			surface: "NO",
			reason: conflict
				? "Preservation conflict — internal only"
				: redundant
					? "Redundant with safer primitive — internal only"
					: budget
						? "Over recommendation budget — internal only"
						: "DO_NOT_RECOMMEND — not an edit card",
			evidenceStrength: "WEAK",
			requiresSemanticJudgment: false,
		};
	}

	// Missing fundamental geometry / rate → never an edit card
	if (
		r.operationFamily === "ZOOM" &&
		(r.missingParameters.some((p) =>
			["depth", "focus.cx", "focus.cy", "focal_geometry"].includes(p),
		) ||
			r.executionReadiness === "MISSING_ARGS" ||
			r.prerequisites.includes("focal_geometry"))
	) {
		return {
			...base,
			surface: "QUESTION_ONLY",
			reason: "Zoom without known focal geometry — question only, not an edit card",
			evidenceStrength: "WEAK",
			requiresSemanticJudgment: true,
		};
	}

	if (
		r.operationFamily === "CROP" &&
		(r.executionReadiness === "MISSING_ARGS" ||
			r.missingParameters.some((p) => ["crop", "cropRegion", "clipId"].includes(p)))
	) {
		return {
			...base,
			surface: "QUESTION_ONLY",
			reason: "Crop without validated geometry — question only",
			evidenceStrength: "WEAK",
			requiresSemanticJudgment: true,
		};
	}

	if (
		r.operationFamily === "SPEED" &&
		(r.executionReadiness === "MISSING_ARGS" ||
			r.missingParameters.includes("speed") ||
			r.recommendationStatus === "NEEDS_HUMAN_JUDGMENT")
	) {
		return {
			...base,
			surface: "QUESTION_ONLY",
			reason: "Speed without deterministic rate — question only, not an edit card",
			evidenceStrength: "WEAK",
			requiresSemanticJudgment: true,
		};
	}

	if (r.recommendationStatus === "NEEDS_HUMAN_JUDGMENT") {
		return {
			...base,
			surface: "QUESTION_ONLY",
			reason: "Needs human judgment — routed to unresolved question, not edit card",
			evidenceStrength: "MEDIUM",
			requiresSemanticJudgment: true,
		};
	}

	// RECOMMEND or OPTIONAL
	if (r.recommendationStatus === "RECOMMEND" || r.recommendationStatus === "OPTIONAL") {
		const actionable =
			r.executionReadiness === "READY_TO_APPLY" ||
			(r.verifiedApplyCapability === "READY" && r.missingParameters.length === 0);

		if (!actionable && r.operationFamily === "ZOOM") {
			// Focal known but incomplete scale — user can meaningfully pick depth
			if (r.missingParameters.includes("depth") && !r.missingParameters.includes("focus.cx")) {
				return {
					...base,
					surface: "QUESTION_ONLY",
					reason: "Zoom target known but scale incomplete — ask user; do not invent depth",
					evidenceStrength: "MEDIUM",
					requiresSemanticJudgment: true,
				};
			}
			return {
				...base,
				surface: "NO",
				reason: "Zoom not sufficiently actionable",
				evidenceStrength: "WEAK",
				requiresSemanticJudgment: true,
			};
		}

		if (!actionable && ["TRIM", "LOUDNESS", "CAPTIONS"].includes(r.operationFamily)) {
			// These families should be ready when RECOMMEND/OPTIONAL; if not, keep internal
			return {
				...base,
				surface: "NO",
				reason: "Marked recommend/optional but not execution-ready — suppress card",
				evidenceStrength: "MEDIUM",
			};
		}

		if (!actionable) {
			return {
				...base,
				surface: "QUESTION_ONLY",
				reason: "Editorially interesting but not actionable enough for a card",
				evidenceStrength: "MEDIUM",
				requiresSemanticJudgment: true,
			};
		}

		return {
			...base,
			surface: "YES",
			reason:
				r.recommendationStatus === "OPTIONAL"
					? "Valid optional recommendation with actionable parameters"
					: "Useful recommendation with actionable parameters",
			evidenceStrength: r.confidence === "HIGH" ? "STRONG" : "MEDIUM",
			requiresSemanticJudgment: false,
		};
	}

	return {
		...base,
		surface: "NO",
		reason: "Unrecognized status — internal only",
		evidenceStrength: "WEAK",
	};
}

export function questionFromDecision(
	r: EditorialRecommendationV1,
	decision: RecommendationSurfaceDecisionV1,
): UnresolvedEditorialQuestionV1 | null {
	if (decision.surface !== "QUESTION_ONLY") return null;

	if (r.operationFamily === "ZOOM") {
		const range = r.sourceRange;
		const where = range ? ` around ${fmtSec(range.startSec)}–${fmtSec(range.endSec)} seconds` : "";
		return {
			id: qid("zoom"),
			text: `Several on-screen changes happen${where}, but there is no reliable focal target.`,
			sourceRange: range,
			relatedFindingIds: [...r.findingIds],
			relatedRecommendationIds: [r.id],
			reason: decision.reason,
		};
	}

	if (r.operationFamily === "CROP") {
		return {
			id: qid("crop"),
			text: "Framing may benefit from adjustment, but no safe crop geometry is available.",
			sourceRange: r.sourceRange,
			relatedFindingIds: [...r.findingIds],
			relatedRecommendationIds: [r.id],
			reason: decision.reason,
		};
	}

	if (r.operationFamily === "SPEED") {
		return {
			id: qid("speed"),
			text: "A duration or speed goal was noted, but no safe playback rate is determined yet.",
			sourceRange: r.sourceRange,
			relatedFindingIds: [...r.findingIds],
			relatedRecommendationIds: [r.id],
			reason: decision.reason,
		};
	}

	if (r.operationFamily === "LOUDNESS") {
		return {
			id: qid("loud"),
			text: "Audio levels look risky to change automatically — review peaks before normalizing.",
			relatedFindingIds: [...r.findingIds],
			relatedRecommendationIds: [r.id],
			reason: decision.reason,
		};
	}

	return {
		id: qid("gen"),
		text: r.reviewCopy,
		sourceRange: r.sourceRange,
		relatedFindingIds: [...r.findingIds],
		relatedRecommendationIds: [r.id],
		reason: decision.reason,
	};
}

/** Meaningful activity-without-focal question from findings (no recommendation seed). */
export function questionsFromActivityFindings(
	findings: EditorialFindingV1[],
): UnresolvedEditorialQuestionV1[] {
	const activity = findings.filter((f) => f.findingType === "VISUAL_ACTIVITY_PRESENT");
	if (activity.length === 0) return [];
	const hasFocal = findings.some((f) => f.findingType === "FOCAL_TARGET");
	if (hasFocal) return [];

	// One question covering the activity span(s), not one per micro-finding
	const starts = activity.map((f) => f.sourceRange?.startSec ?? 0);
	const ends = activity.map((f) => f.sourceRange?.endSec ?? 0);
	const startSec = Math.min(...starts);
	const endSec = Math.max(...ends);
	return [
		{
			id: qid("activity"),
			text: `Material visual activity occurs around ${fmtSec(startSec)}–${fmtSec(endSec)} seconds. Would emphasizing a specific UI element help?`,
			sourceRange: { startSec, endSec },
			relatedFindingIds: activity.map((f) => f.id),
			reason: "Activity without focal geometry — question only",
		},
	];
}

export function applySurfaceFilter(args: {
	candidates: EditorialRecommendationV1[];
	findings: EditorialFindingV1[];
	bundleUnresolved?: string[];
	maxRecommendations: number;
}): SurfacePassResult {
	const t0 = Date.now();
	const decisions: RecommendationSurfaceDecisionV1[] = [];
	const questions: UnresolvedEditorialQuestionV1[] = [];
	const yes: EditorialRecommendationV1[] = [];

	let suppressedUnsupported = 0;
	let suppressedConflicts = 0;
	let suppressedRedundant = 0;
	let suppressedBudget = 0;
	let internalOnly = 0;
	let questionOnly = 0;
	let blockedUnsupported = 0;

	for (const r of args.candidates) {
		const d = decideSurface(r);
		decisions.push(d);
		if (d.surface === "YES") {
			yes.push(r);
		} else if (d.surface === "QUESTION_ONLY") {
			questionOnly += 1;
			blockedUnsupported += 1;
			suppressedUnsupported += 1;
			const q = questionFromDecision(r, d);
			if (q) questions.push(q);
		} else {
			internalOnly += 1;
			if (r.rationale.includes("blocked by preservation")) suppressedConflicts += 1;
			else if (r.rationale.includes("redundant")) suppressedRedundant += 1;
			else if (r.conflictsWith.includes("budget_cap")) suppressedBudget += 1;
			else if (r.executionReadiness === "UNSUPPORTED" || r.executionReadiness === "MISSING_ARGS") {
				suppressedUnsupported += 1;
				blockedUnsupported += 1;
			}
		}
	}

	// Activity findings → at most one meaningful question (avoid duplicate if zoom already asked)
	const activityQs = questionsFromActivityFindings(args.findings);
	const hasZoomQ = questions.some((q) => q.id.startsWith("q_zoom") || q.text.includes("focal"));
	if (!hasZoomQ) {
		for (const q of activityQs) questions.push(q);
	}

	for (const text of args.bundleUnresolved ?? []) {
		questions.push({
			id: qid("bundle"),
			text,
			relatedFindingIds: [],
			reason: "Upstream unresolved discrepancy",
		});
	}

	// Deduplicate similar question texts
	const seen = new Set<string>();
	const dedupedQuestions = questions.filter((q) => {
		const key = q.text.toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	// Budget applies only to surfaced YES cards
	const ranked = [...yes].sort((a, b) => {
		const score = (r: EditorialRecommendationV1) =>
			(r.recommendationStatus === "RECOMMEND" ? 100 : 50) +
			(r.executionReadiness === "READY_TO_APPLY" ? 20 : 0);
		return score(b) - score(a);
	});
	const kept = ranked.slice(0, args.maxRecommendations);
	const dropped = ranked.slice(args.maxRecommendations);
	for (const d of dropped) {
		suppressedBudget += 1;
		decisions.push({
			recommendationId: d.id,
			surface: "NO",
			reason: "Over surface recommendation budget after eligibility filter",
			evidenceStrength: "MEDIUM",
			executionReadiness: d.executionReadiness,
			missingParameters: d.missingParameters,
			requiresSemanticJudgment: false,
		});
	}

	const surfaced = kept;
	const SURFACED_READY = surfaced.filter((r) => r.recommendationStatus === "RECOMMEND").length;
	const SURFACED_OPTIONAL = surfaced.filter((r) => r.recommendationStatus === "OPTIONAL").length;

	return {
		decisions,
		surfaced,
		questions: dedupedQuestions,
		metrics: {
			rawCandidates: args.candidates.length,
			surfaceableRecommendations: surfaced.length,
			questions: dedupedQuestions.length,
			suppressedUnsupported,
			suppressedConflicts,
			suppressedRedundant,
			suppressedBudget,
			internalOnly,
			SURFACED_READY,
			SURFACED_OPTIONAL,
			QUESTION_ONLY: questionOnly + (hasZoomQ ? 0 : activityQs.length),
			INTERNAL_ONLY: internalOnly,
			BLOCKED_UNSUPPORTED: blockedUnsupported,
			surfaceMs: Date.now() - t0,
		},
	};
}

export function evidenceStrengthLabel(readiness: ExecutionReadiness): "STRONG" | "MEDIUM" | "WEAK" {
	if (readiness === "READY_TO_APPLY") return "STRONG";
	if (readiness === "NEEDS_HUMAN_SELECTION") return "MEDIUM";
	return "WEAK";
}
