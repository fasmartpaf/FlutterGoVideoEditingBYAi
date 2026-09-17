/**
 * Material-change detection + Case 4 redundancy analysis for Edit Plans.
 */

import type { EditPlanItem, EditPlanV1 } from "../editPlan/types";

export function planSignature(plan: EditPlanV1): string {
	return plan.items
		.map(
			(i) =>
				`${i.gapIds.sort().join(",")}|${i.preferredStrategy ?? "?"}|${i.feasibility}|${i.priority}`,
		)
		.sort()
		.join(";");
}

/**
 * Material if preferred strategy / feasibility sets change for any gap cluster.
 */
export function isMaterialPlanChange(before: EditPlanV1, after: EditPlanV1): boolean {
	if (planSignature(before) !== planSignature(after)) return true;

	const beforeNeeds = before.items.filter(
		(i) => i.preferredStrategy === "needs_more_evidence" || i.feasibility === "needs_more_evidence",
	).length;
	const afterNeeds = after.items.filter(
		(i) => i.preferredStrategy === "needs_more_evidence" || i.feasibility === "needs_more_evidence",
	).length;
	if (beforeNeeds !== afterNeeds) return true;

	return false;
}

export function classifyItemOutcomes(
	initial: EditPlanV1,
	final: EditPlanV1,
): { resolved: string[]; unresolved: string[]; invalidated: string[] } {
	const resolved: string[] = [];
	const unresolved: string[] = [];
	const invalidated: string[] = [];

	for (const item of initial.items) {
		if (
			item.preferredStrategy !== "needs_more_evidence" &&
			item.feasibility !== "needs_more_evidence"
		) {
			continue;
		}
		const after = final.items.find(
			(f) =>
				f.gapIds.some((g) => item.gapIds.includes(g)) ||
				(f.sourceBeatIds.length && f.sourceBeatIds.every((id) => item.sourceBeatIds.includes(id))),
		);
		if (!after) {
			// Item disappeared — may have merged; treat as resolved if no needs_more remains for those gaps
			const still = final.items.some(
				(f) =>
					f.gapIds.some((g) => item.gapIds.includes(g)) &&
					(f.preferredStrategy === "needs_more_evidence" ||
						f.feasibility === "needs_more_evidence"),
			);
			if (still) unresolved.push(item.id);
			else resolved.push(item.id);
			continue;
		}
		if (
			after.preferredStrategy === "needs_more_evidence" ||
			after.feasibility === "needs_more_evidence"
		) {
			unresolved.push(item.id);
		} else if (
			after.preferredStrategy === "no_safe_edit" ||
			after.preferredStrategy === "preserve" ||
			after.preferredStrategy === "avoid_implication"
		) {
			// Candidate strategy may have been invalidated toward safer choice
			if (item.candidateStrategies.some((s) => s.family === "zoom" || s.family === "crop")) {
				invalidated.push(item.id);
			} else {
				resolved.push(item.id);
			}
		} else {
			resolved.push(item.id);
		}
	}

	return { resolved, unresolved, invalidated };
}

/** Case 4-style redundancy notes — report only, do not force-merge. */
export function analyzePlanRedundancy(plan: EditPlanV1): string[] {
	const notes: string[] = [];
	const byCategoryIntent = new Map<string, EditPlanItem[]>();
	for (const item of plan.items) {
		const cat = item.editorialIntent.match(/\(([^)]+)\)\s*$/)?.[1] ?? "other";
		const key = `${cat}|${item.preferredStrategy ?? "?"}`;
		const list = byCategoryIntent.get(key) ?? [];
		list.push(item);
		byCategoryIntent.set(key, list);
	}
	for (const [key, items] of byCategoryIntent) {
		if (items.length > 1) {
			notes.push(
				`Potential redundancy: ${items.length} items share category/strategy cluster "${key}" (${items.map((i) => i.id).join(", ")}). Distinct gap provenance may still justify multiples.`,
			);
		}
	}
	const preserve = plan.items.filter((i) => i.preferredStrategy === "preserve");
	const trim = plan.items.filter((i) => i.preferredStrategy === "trim");
	if (preserve.length && trim.length) {
		const overlap = preserve.filter((p) =>
			trim.some((t) => p.sourceBeatIds.some((id) => t.sourceBeatIds.includes(id))),
		);
		if (overlap.length) {
			notes.push(
				`Preserve/trim overlap on ${overlap.length} preserve item(s) — conflicts may already be marked; review before execution.`,
			);
		}
	}
	notes.push(`Plan item count: ${plan.items.length} (cap 16).`);
	return notes;
}
