/**
 * Map planner opportunities + compiled intents → EditorialTransformationDecisionV1.
 * Enforces problem → goal → transform (never tool-availability alone).
 */

import type { ProfessionalEditorialOpportunityV1 } from "../professionalEditorialPlanner";
import {
	decideApplyOrKeep,
	type EditorialTransformationDecisionV1,
	isToolAvailabilityOnlyReason,
	makeTransformationDecision,
	type TransformationFamilyV1,
} from "./transformationDecision";
import type { CompiledIntentResultV1, TargetEditStoryV1 } from "./types";

function mapFamily(f: string): TransformationFamilyV1 {
	const u = f.toUpperCase();
	if (u === "TRIM") return "trim";
	if (u === "ZOOM") return "zoom";
	if (u === "CROP") return "crop";
	if (u === "SPEED") return "speed";
	if (u === "TITLE") return "title";
	if (u === "CALLOUT") return "callout";
	if (u === "TRANSITION") return "transition";
	if (u === "CAPTIONS") return "captions";
	if (u === "LOUDNESS") return "loudness";
	return "other";
}

function problemFromOpp(o: ProfessionalEditorialOpportunityV1): string {
	const p = o.derivedParameters.editorialProblem;
	if (typeof p === "string" && p.trim()) return p.trim();
	return o.editorialReason;
}

function improvementFromOpp(o: ProfessionalEditorialOpportunityV1): string {
	const e = o.derivedParameters.expectedImprovement;
	if (typeof e === "string" && e.trim()) return e.trim();
	return o.editorialReason;
}

export function buildTransformationDecisions(args: {
	opportunities: ProfessionalEditorialOpportunityV1[];
	compiled: CompiledIntentResultV1[];
	targetStory: TargetEditStoryV1 | null | undefined;
}): EditorialTransformationDecisionV1[] {
	const groundedOppIds = new Set(
		args.compiled
			.filter((c) => c.status === "GROUNDED")
			.map((c) => String(c.derivedHint?.opportunityId ?? ""))
			.filter(Boolean),
	);
	const out: EditorialTransformationDecisionV1[] = [];

	for (const o of args.opportunities) {
		const family = mapFamily(o.family);
		const problem = problemFromOpp(o);
		const toolOnly =
			isToolAvailabilityOnlyReason(problem) || isToolAvailabilityOnlyReason(o.editorialReason);
		const editorialProblemClear =
			!toolOnly &&
			(o.generationStatus === "GROUNDED_READY" ||
				o.generationStatus === "GROUNDED_NOT_USEFUL" ||
				o.generationStatus === "INSUFFICIENT_EVIDENCE");
		const improvesTarget =
			Boolean(args.targetStory?.beats.length) &&
			o.generationStatus === "GROUNDED_READY" &&
			!toolOnly;
		const decision = decideApplyOrKeep({
			family,
			hasGroundedOpportunity:
				o.generationStatus === "GROUNDED_READY" && o.executionReadiness === "READY",
			editorialProblemClear: editorialProblemClear && improvesTarget,
			improvesTargetStory: improvesTarget,
			preservationRisk:
				o.preservationStatus === "BLOCKED"
					? "HIGH"
					: o.preservationStatus === "RISKY"
						? "MEDIUM"
						: "LOW",
			unsupported: o.generationStatus === "UNSUPPORTED",
		});
		// Force KEEP when tool-availability-only even if READY
		const finalDecision =
			toolOnly && decision === "APPLY"
				? "KEEP"
				: groundedOppIds.has(o.id) || decision === "APPLY"
					? decision === "APPLY" && !toolOnly
						? "APPLY"
						: decision
					: decision;

		out.push(
			makeTransformationDecision({
				family,
				sourceRange: o.sourceRange,
				sourceBeatId: null,
				problem,
				viewerImpact:
					typeof o.derivedParameters.viewerImpact === "string"
						? String(o.derivedParameters.viewerImpact)
						: "Viewer may miss clarity or pace issues if left unchanged",
				targetStoryGoal:
					args.targetStory?.desiredArc?.slice(0, 160) ??
					"Improve comprehension and pacing where evidence supports it",
				evidenceRefs: o.evidenceRefs,
				editorialReason: o.editorialReason,
				operationIntent: `${family}:${o.generationStatus}`,
				expectedImprovement: improvementFromOpp(o),
				confidence: o.confidence,
				executionReadiness:
					o.executionReadiness === "READY"
						? "READY"
						: o.generationStatus === "UNSUPPORTED"
							? "UNSUPPORTED"
							: "NOT_READY",
				preservationRisk:
					o.preservationStatus === "BLOCKED"
						? "HIGH"
						: o.preservationStatus === "RISKY"
							? "MEDIUM"
							: "LOW",
				decision: finalDecision,
				opportunityId: o.id,
			}),
		);
	}
	return out;
}
