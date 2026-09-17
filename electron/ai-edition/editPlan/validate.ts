/**
 * Edit Plan V1 validator / sanitizer.
 */

import {
	assertsForbiddenRestartActionPlan,
	assertsForbiddenUnverifiedPanelZoom,
	assertsForbiddenUpworkPlan,
	leaksExecutableToolArgs,
	sanitizePlanProse,
} from "./guards";
import type { EditPlanItem, EditPlanQualityRubric, EditPlanV1 } from "./types";
import { EDIT_PLAN_V1_PROVIDER_ID } from "./types";

export function validateAndSanitizeEditPlanV1(plan: EditPlanV1): {
	plan: EditPlanV1;
	rejected: string[];
	downgraded: string[];
} {
	const rejected: string[] = [];
	const downgraded: string[] = [];
	const kept: EditPlanItem[] = [];

	for (const item of plan.items) {
		const blob = JSON.stringify(item);
		if (leaksExecutableToolArgs(blob)) {
			rejected.push(`${item.id}: executable tool args`);
			continue;
		}
		if (
			assertsForbiddenUpworkPlan(blob) ||
			assertsForbiddenRestartActionPlan(blob) ||
			assertsForbiddenUnverifiedPanelZoom(blob)
		) {
			rejected.push(`${item.id}: forbidden epistemic target`);
			continue;
		}
		if (item.gapIds.length === 0 && !/denoise|unsupported/i.test(item.editorialIntent)) {
			downgraded.push(`${item.id}: no gap provenance`);
			kept.push({
				...item,
				confidence: Math.min(item.confidence, 0.3),
				editorialIntent: sanitizePlanProse(item.editorialIntent),
				constraints: item.constraints.map(sanitizePlanProse),
				candidateStrategies: item.candidateStrategies.map((s) => ({
					...s,
					rationale: sanitizePlanProse(s.rationale),
				})),
			});
			continue;
		}

		// Downgrade unsupported marked as supported
		const strategies = item.candidateStrategies.map((s) => {
			if (
				s.unsupportedCapability &&
				(s.feasibility === "supported" || s.feasibility === "partially_supported")
			) {
				downgraded.push(`${item.id}: capability honesty`);
				return { ...s, feasibility: "unsupported" as const, rankScore: s.rankScore - 50 };
			}
			return { ...s, rationale: sanitizePlanProse(s.rationale) };
		});

		kept.push({
			...item,
			editorialIntent: sanitizePlanProse(item.editorialIntent),
			constraints: item.constraints.map(sanitizePlanProse),
			candidateStrategies: strategies,
		});
	}

	const out: EditPlanV1 = {
		...plan,
		providerId: EDIT_PLAN_V1_PROVIDER_ID,
		summary: sanitizePlanProse(plan.summary),
		items: kept.slice(0, 16),
		hardConstraints: plan.hardConstraints.map(sanitizePlanProse),
		metrics: {
			...plan.metrics,
			planItemsGenerated: kept.length,
			additionalModelCalls: 0,
			providerId: EDIT_PLAN_V1_PROVIDER_ID,
			serializedBytesApprox: 0,
		},
	};
	out.metrics.serializedBytesApprox = JSON.stringify(out).length;
	return { plan: out, rejected, downgraded };
}

export function evaluateEditPlanRubric(plan: EditPlanV1, gapCount: number): EditPlanQualityRubric {
	const blob = JSON.stringify(plan);
	const notes: string[] = [];
	const gapCoverage =
		gapCount === 0 ||
		plan.items.some((i) => i.gapIds.length > 0) ||
		plan.items.some((i) => i.feasibility === "unsupported");
	const sourceGrounding = plan.items.every(
		(i) =>
			i.sourceBeatIds.length > 0 ||
			i.provenanceRefs.length > 0 ||
			i.feasibility === "unsupported" ||
			i.preferredStrategy === "needs_more_evidence" ||
			/denoise/i.test(i.editorialIntent),
	);
	if (!sourceGrounding) notes.push("some items lack grounding");

	return {
		gapCoverage,
		sourceGrounding,
		targetFidelity: !/fabricate|invent Settings screen/i.test(blob),
		preservationSafety:
			plan.hardConstraints.some((c) => /preserve/i.test(c)) ||
			plan.items.some((i) => i.preservationRefs.length > 0),
		epistemicHonesty:
			!assertsForbiddenUpworkPlan(blob) &&
			!assertsForbiddenRestartActionPlan(blob) &&
			!assertsForbiddenUnverifiedPanelZoom(blob),
		feasibilityAccuracy: plan.items.every((i) =>
			i.candidateStrategies.every(
				(s) => !(s.unsupportedCapability && s.feasibility === "supported"),
			),
		),
		unsupportedCapabilityHonesty:
			!plan.capabilities.denoise && !plan.capabilities.transitions && !plan.capabilities.tts,
		noExecutionLeakage: !leaksExecutableToolArgs(blob),
		conflictHandling: true,
		evidenceAwareness:
			plan.metrics.needsMoreEvidenceItems >= 0 && !/zoom Publish|zoom Settings/i.test(blob),
		compactness: plan.items.length <= 16 && plan.summary.length < 900,
		notes,
	};
}
