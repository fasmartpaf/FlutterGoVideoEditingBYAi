/**
 * Intent → grounded operation compiler.
 * Bridges EditorialIntentPlan to existing planner opportunities / statuses.
 * NEVER invents geometry, transcript, or timestamps.
 */

import type { ProfessionalEditorialOpportunityV1 } from "../professionalEditorialPlanner";
import type { CompiledIntentResultV1, EditorialIntentItemV1, EditorialIntentPlanV1 } from "./types";

function overlap(
	a?: { startSec: number; endSec: number },
	b?: { startSec: number; endSec: number },
): number {
	if (!a || !b) return 0;
	return Math.max(0, Math.min(a.endSec, b.endSec) - Math.max(a.startSec, b.startSec));
}

export function compileEditorialIntents(args: {
	intentPlan: EditorialIntentPlanV1;
	opportunities: ProfessionalEditorialOpportunityV1[];
}): CompiledIntentResultV1[] {
	const out: CompiledIntentResultV1[] = [];

	for (const intent of args.intentPlan.intents) {
		out.push(compileOne(intent, args.opportunities));
	}
	for (const rej of args.intentPlan.rejectedSkills) {
		const kind = rej.skill as import("./types").EditorialIntentKindV1;
		if (out.some((c) => c.kind === kind && c.status === "UNSUPPORTED")) continue;
		out.push({
			intentId: `rej_${rej.skill}`,
			kind:
				kind in { ADD_TRANSITION: 1, IMPROVE_COLOR: 1, AUDIO_CLEANUP: 1, SLOW_IMPORTANT_ACTION: 1 }
					? kind
					: "ADD_TRANSITION",
			status: "UNSUPPORTED",
			reason: rej.reason,
		});
	}
	return out;
}

function compileOne(
	intent: EditorialIntentItemV1,
	opportunities: ProfessionalEditorialOpportunityV1[],
): CompiledIntentResultV1 {
	if (intent.kind === "KEEP_SECTION" || intent.kind === "PRESERVE_CONTENT") {
		return {
			intentId: intent.id,
			kind: intent.kind,
			status: "KEEP",
			reason: "Preservation intent — no mutation",
		};
	}
	if (intent.kind === "IMPROVE_COLOR" || intent.kind === "AUDIO_CLEANUP") {
		return {
			intentId: intent.id,
			kind: intent.kind,
			status: "UNSUPPORTED",
			reason: "Product capability gap — not silently invented",
		};
	}
	if (intent.kind === "SLOW_IMPORTANT_ACTION") {
		return {
			intentId: intent.id,
			kind: intent.kind,
			status: "UNSUPPORTED",
			reason: "Slow-motion not autonomously generated (execution-only)",
		};
	}

	const family =
		intent.kind === "REMOVE_DEAD_TIME" || intent.kind === "TIGHTEN_SECTION"
			? "TRIM"
			: intent.kind === "EMPHASIZE_TARGET"
				? "ZOOM"
				: intent.kind === "REFRAME_SCENE"
					? "CROP"
					: intent.kind === "ACCELERATE_LOW_INFORMATION_SECTION"
						? "SPEED"
						: intent.kind === "ADD_CAPTIONS"
							? "CAPTIONS"
							: intent.kind === "BALANCE_AUDIO"
								? "LOUDNESS"
								: intent.kind === "ADD_TITLE"
									? "TITLE"
									: intent.kind === "ADD_CALLOUT"
										? "CALLOUT"
										: intent.kind === "ADD_TRANSITION"
											? "TRANSITION"
											: null;

	if (!family) {
		return {
			intentId: intent.id,
			kind: intent.kind,
			status: "NEEDS_EVIDENCE",
			reason: "No compiler mapping",
		};
	}

	const candidates = opportunities.filter((o) => o.family === family);
	const overlapping = candidates
		.map((o) => ({ o, ov: overlap(intent.sourceRange, o.sourceRange) }))
		.sort((a, b) => b.ov - a.ov);

	const best =
		overlapping.find((x) => x.o.generationStatus === "GROUNDED_READY")?.o ??
		overlapping[0]?.o ??
		candidates.find((o) => o.generationStatus === "GROUNDED_READY") ??
		candidates[0];

	if (!best) {
		return {
			intentId: intent.id,
			kind: intent.kind,
			status: "NEEDS_EVIDENCE",
			reason: `No ${family} opportunity from local evidence`,
			operationFamily: family.toLowerCase() as CompiledIntentResultV1["operationFamily"],
		};
	}

	if (best.generationStatus === "GROUNDED_READY" && best.executionReadiness === "READY") {
		return {
			intentId: intent.id,
			kind: intent.kind,
			status: "GROUNDED",
			reason: best.editorialReason,
			operationFamily: family.toLowerCase() as CompiledIntentResultV1["operationFamily"],
			derivedHint: {
				opportunityId: best.id,
				derivedParameters: best.derivedParameters,
			},
		};
	}
	if (best.generationStatus === "PRESERVATION_CONFLICT" || best.preservationStatus === "BLOCKED") {
		return {
			intentId: intent.id,
			kind: intent.kind,
			status: "PRESERVATION_CONFLICT",
			reason: best.editorialReason,
			operationFamily: family.toLowerCase() as CompiledIntentResultV1["operationFamily"],
		};
	}
	if (best.generationStatus === "INSUFFICIENT_EVIDENCE") {
		return {
			intentId: intent.id,
			kind: intent.kind,
			status: "NEEDS_EVIDENCE",
			reason: best.editorialReason,
			operationFamily: family.toLowerCase() as CompiledIntentResultV1["operationFamily"],
		};
	}
	return {
		intentId: intent.id,
		kind: intent.kind,
		status: "KEEP",
		reason: best.editorialReason,
		operationFamily: family.toLowerCase() as CompiledIntentResultV1["operationFamily"],
	};
}

/** Prefer opportunities that the director grounded. */
export function prioritizeOpportunitiesByDirector(args: {
	opportunities: ProfessionalEditorialOpportunityV1[];
	compiled: CompiledIntentResultV1[];
}): ProfessionalEditorialOpportunityV1[] {
	const groundedIds = new Set(
		args.compiled
			.filter((c) => c.status === "GROUNDED")
			.map((c) => String(c.derivedHint?.opportunityId ?? "")),
	);
	const groundedFamilies = new Set(
		args.compiled
			.filter((c) => c.status === "GROUNDED" && c.operationFamily)
			.map((c) => c.operationFamily!.toUpperCase()),
	);

	return [...args.opportunities].sort((a, b) => {
		const ag = groundedIds.has(a.id) || groundedFamilies.has(a.family) ? 1 : 0;
		const bg = groundedIds.has(b.id) || groundedFamilies.has(b.family) ? 1 : 0;
		if (ag !== bg) return bg - ag;
		return b.rankScore - a.rankScore;
	});
}
