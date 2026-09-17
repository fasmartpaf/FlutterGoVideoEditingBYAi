/**
 * EditorialTransformationDecisionV1 — every edit needs problem → goal → transform.
 * Tool availability alone must never select an operation.
 */

export type TransformationDecisionKindV1 = "APPLY" | "KEEP" | "QUESTION" | "UNSUPPORTED";

export type TransformationFamilyV1 =
	| "trim"
	| "zoom"
	| "crop"
	| "speed"
	| "title"
	| "callout"
	| "transition"
	| "captions"
	| "loudness"
	| "other";

export interface EditorialTransformationDecisionV1 {
	version: 1;
	id: string;
	family: TransformationFamilyV1;
	sourceRange?: { startSec: number; endSec: number };
	sourceBeatId: string | null;
	/** What is wrong / missing for the viewer in the source. */
	problem: string;
	/** How the viewer is affected if left unchanged. */
	viewerImpact: string;
	/** What the target story wants for this beat. */
	targetStoryGoal: string;
	evidenceRefs: string[];
	editorialReason: string;
	operationIntent: string;
	expectedImprovement: string;
	confidence: "HIGH" | "MEDIUM" | "LOW";
	executionReadiness: "READY" | "NOT_READY" | "UNSUPPORTED";
	preservationRisk: "LOW" | "MEDIUM" | "HIGH";
	decision: TransformationDecisionKindV1;
	/** Opportunity id when grounded. */
	opportunityId?: string;
}

let seq = 0;
export function resetTransformationDecisionSeqForTests(): void {
	seq = 0;
}

export function makeTransformationDecision(
	partial: Omit<EditorialTransformationDecisionV1, "version" | "id"> & { id?: string },
): EditorialTransformationDecisionV1 {
	seq += 1;
	return {
		version: 1,
		id: partial.id ?? `etd_${partial.family}_${seq}`,
		family: partial.family,
		sourceRange: partial.sourceRange,
		sourceBeatId: partial.sourceBeatId,
		problem: partial.problem,
		viewerImpact: partial.viewerImpact,
		targetStoryGoal: partial.targetStoryGoal,
		evidenceRefs: partial.evidenceRefs,
		editorialReason: partial.editorialReason,
		operationIntent: partial.operationIntent,
		expectedImprovement: partial.expectedImprovement,
		confidence: partial.confidence,
		executionReadiness: partial.executionReadiness,
		preservationRisk: partial.preservationRisk,
		decision: partial.decision,
		opportunityId: partial.opportunityId,
	};
}

/** Reject APPLY when the row is merely “skill available”. */
export function isToolAvailabilityOnlyReason(reason: string): boolean {
	const t = reason.toLowerCase();
	return (
		/\btool\s+available\b/.test(t) ||
		/\bskill\s+available\b/.test(t) ||
		/\bbecause\s+(?:it\s+)?(?:is\s+)?supported\b/.test(t) ||
		/\bexecutable\s+skill\b/.test(t)
	);
}

export function decideApplyOrKeep(args: {
	family: TransformationFamilyV1;
	hasGroundedOpportunity: boolean;
	editorialProblemClear: boolean;
	improvesTargetStory: boolean;
	preservationRisk: "LOW" | "MEDIUM" | "HIGH";
	unsupported?: boolean;
}): TransformationDecisionKindV1 {
	if (args.unsupported) return "UNSUPPORTED";
	if (!args.hasGroundedOpportunity) return "KEEP";
	if (!args.editorialProblemClear || !args.improvesTargetStory) return "KEEP";
	if (args.preservationRisk === "HIGH") return "QUESTION";
	return "APPLY";
}
