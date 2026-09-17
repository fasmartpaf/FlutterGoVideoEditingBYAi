/**
 * Edit Gap V1 validator / sanitizer.
 */

import {
	assertsForbiddenRestartActionCleanup,
	assertsForbiddenUpworkWorkflowRemoval,
	leaksToolOrEditPlan,
	sanitizeGapProse,
} from "./guards";
import type { EditGapItem, EditGapQualityRubric, EditGapV1 } from "./types";
import { EDIT_GAP_CATEGORIES, EDIT_GAP_V1_PROVIDER_ID } from "./types";

const EDIT_TIMESTAMP_CMD_RE =
	/\b(cut|trim|crop)\s+(at|from|around)\s+\d+(\.\d+)?|\b\d+(\.\d+)?\s*[-–]\s*\d+(\.\d+)?\s*(s|sec).{0,20}\b(cut|trim|crop)\b/i;

export function validateAndSanitizeEditGapV1(gap: EditGapV1): {
	gap: EditGapV1;
	rejected: string[];
	downgraded: string[];
} {
	const rejected: string[] = [];
	const downgraded: string[] = [];
	const kept: EditGapItem[] = [];

	for (const item of gap.gaps) {
		if (!EDIT_GAP_CATEGORIES.includes(item.category)) {
			rejected.push(`${item.id}: unknown category`);
			continue;
		}
		const blob = `${item.problemStatement}\n${item.desiredChange}\n${item.constraints.join("\n")}`;
		if (assertsForbiddenRestartActionCleanup(blob) || assertsForbiddenUpworkWorkflowRemoval(blob)) {
			rejected.push(`${item.id}: forbidden action/workflow assumption`);
			continue;
		}
		if (leaksToolOrEditPlan(blob) || EDIT_TIMESTAMP_CMD_RE.test(blob)) {
			rejected.push(`${item.id}: tool/edit-plan leakage`);
			continue;
		}
		const orphan =
			item.category !== "missing_target_support" &&
			item.provenance.sourceBeatIds.length === 0 &&
			item.provenance.targetBeatIds.length === 0 &&
			!item.provenance.correctionIds?.length &&
			!item.provenance.contradictionIds?.length;
		if (orphan && item.category !== "preservation_requirement") {
			// Allow correction/contradiction-driven with ids only
			if (!(item.provenance.correctionIds?.length || item.provenance.contradictionIds?.length)) {
				downgraded.push(`${item.id}: weak provenance`);
				kept.push({
					...item,
					confidence: "low",
					problemStatement: sanitizeGapProse(item.problemStatement),
					desiredChange: sanitizeGapProse(item.desiredChange),
					constraints: item.constraints.map(sanitizeGapProse),
				});
				continue;
			}
		}
		kept.push({
			...item,
			problemStatement: sanitizeGapProse(item.problemStatement),
			desiredChange: sanitizeGapProse(item.desiredChange),
			constraints: item.constraints.map(sanitizeGapProse),
		});
	}

	const summary = sanitizeGapProse(gap.summary);
	const hardConstraints = gap.hardConstraints
		.map(sanitizeGapProse)
		.filter((c) => !leaksToolOrEditPlan(c) && !assertsForbiddenRestartActionCleanup(c));

	const out: EditGapV1 = {
		...gap,
		providerId: EDIT_GAP_V1_PROVIDER_ID,
		summary,
		gaps: kept,
		hardConstraints: [...new Set(hardConstraints)],
		metrics: {
			...gap.metrics,
			gapsCreated: kept.length,
			missingSupportGaps: kept.filter((g) => g.category === "missing_target_support").length,
			additionalModelCalls: 0,
			providerId: EDIT_GAP_V1_PROVIDER_ID,
			serializedBytesApprox: 0,
		},
	};
	out.metrics.serializedBytesApprox = JSON.stringify(out).length;
	return { gap: out, rejected, downgraded };
}

export function evaluateEditGapRubric(gap: EditGapV1): EditGapQualityRubric {
	const blob = JSON.stringify(gap);
	const notes: string[] = [];
	const sourceGrounding = gap.gaps.every(
		(g) =>
			g.category === "missing_target_support" ||
			g.provenance.sourceBeatIds.length > 0 ||
			(g.provenance.correctionIds?.length ?? 0) > 0 ||
			(g.provenance.contradictionIds?.length ?? 0) > 0,
	);
	if (!sourceGrounding) notes.push("some gaps lack source grounding");

	const targetFidelity = gap.gaps.every(
		(g) =>
			g.category === "missing_target_support" ||
			g.category === "preservation_requirement" ||
			g.provenance.targetBeatIds.length > 0 ||
			(g.provenance.correctionIds?.length ?? 0) > 0 ||
			(g.provenance.contradictionIds?.length ?? 0) > 0 ||
			g.provenance.sourceBeatIds.length > 0,
	);

	const epistemicHonesty = !/remove restart action|upwork workflow removal|invent settings/i.test(
		blob,
	);
	const noToolLeakage = !leaksToolOrEditPlan(blob);
	const noEditPlanLeakage = !EDIT_TIMESTAMP_CMD_RE.test(blob) && !/\btrim\s+\d+\.\d+/i.test(blob);
	const preservationAwareness =
		gap.preserved.length > 0 || gap.gaps.some((g) => g.category === "preservation_requirement");
	const contradictionAwareness =
		gap.gaps.some((g) => g.category === "unsupported_story_implication") ||
		!blob.includes("contradict");
	const unsupportedTargetAwareness =
		gap.gaps.some((g) => g.category === "missing_target_support") ||
		gap.unresolved.every((u) => u.kind !== "missing_target_support");
	const compactness = gap.gaps.length <= 16 && gap.summary.length < 800;
	const gapUsefulness = gap.gaps.length > 0 || /no material editorial gaps/i.test(gap.summary);

	return {
		sourceGrounding,
		targetFidelity,
		epistemicHonesty,
		gapUsefulness,
		noToolLeakage,
		noEditPlanLeakage,
		preservationAwareness:
			preservationAwareness || gap.hardConstraints.some((c) => /preserve/i.test(c)),
		contradictionAwareness,
		unsupportedTargetAwareness,
		compactness,
		notes,
	};
}
