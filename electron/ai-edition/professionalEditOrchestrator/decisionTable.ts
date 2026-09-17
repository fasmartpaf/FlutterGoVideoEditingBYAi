/**
 * Internal professional-edit decision table — diagnostic, not user copy.
 */

import { getCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { DeadAirCandidateV1 } from "../deadAir";
import type { EditorialFocalAnalysisBundleV1 } from "../editorialFocalEvidence";
import type { ProfessionalEditorialPlannerResultV1 } from "../professionalEditorialPlanner";
import type { LoudnessCoordinationResultV1 } from "./loudnessCoord";
import type { ProfessionalEditPlanV1 } from "./types";
import type { ProfessionalEditCapabilityUtilizationV1 } from "./utilization";

export type FamilyDecision = "APPLY" | "KEEP" | "MISSING_GENERATION" | "HONESTLY_LIMITED";

export interface ProfessionalFamilyDecisionV1 {
	family: "TRIM" | "ZOOM" | "CROP" | "SPEED" | "CAPTIONS" | "LOUDNESS";
	evidence: string;
	decision: FamilyDecision;
	reason: string;
}

function oppSummary(
	planner: ProfessionalEditorialPlannerResultV1 | null | undefined,
	family: string,
): string {
	const ops = planner?.opportunities.filter((o) => o.family === family) ?? [];
	if (ops.length === 0) return "no opportunities";
	return ops
		.map((o) => `${o.generationStatus}/${o.executionReadiness}`)
		.slice(0, 4)
		.join("; ");
}

export function buildProfessionalDecisionTable(args: {
	document: AxcutDocument;
	aspectValue?: number;
	deadAir: DeadAirCandidateV1[];
	focal: EditorialFocalAnalysisBundleV1 | null;
	plan: ProfessionalEditPlanV1;
	loudness: LoudnessCoordinationResultV1 | null;
	util: ProfessionalEditCapabilityUtilizationV1;
	planner?: ProfessionalEditorialPlannerResultV1 | null;
}): ProfessionalFamilyDecisionV1[] {
	const safe = args.deadAir.filter((c) => c.safeToPropose);
	const trimInPlan = args.plan.steps.some((s) => s.family === "trim");
	const zoomInPlan = args.plan.steps.some((s) => s.family === "zoom");
	const speedInPlan = args.plan.steps.some((s) => s.family === "speed");
	const cropInPlan = args.plan.steps.some((s) => s.family === "crop");
	const capInPlan = args.plan.steps.some((s) => s.family === "captions");
	const captionsOn = getCaptionSettings(args.document, args.aspectValue ?? 16 / 9).enabled;
	const zoomRow = args.util.rows.find((r) => r.family === "zoom");
	const trimRow = args.util.rows.find((r) => r.family === "trim");
	const speedRow = args.util.rows.find((r) => r.family === "speed");
	const cropRow = args.util.rows.find((r) => r.family === "crop");

	const speedOpp = args.planner?.opportunities.find((o) => o.family === "SPEED");
	const cropOpp = args.planner?.opportunities.find((o) => o.family === "CROP");

	return [
		{
			family: "TRIM",
			evidence: `${args.deadAir.length} silence; ${safe.length} safe; planner=${oppSummary(args.planner, "TRIM")}`,
			decision: trimInPlan ? "APPLY" : "KEEP",
			reason: trimInPlan
				? "Planner/dead-air grounded trim entered plan"
				: (trimRow?.skippedReason ??
					(args.deadAir.length === 0
						? "No silence intervals detected"
						: "Contextual KEEP / KEEP_SOME_PAUSE retained pauses")),
		},
		{
			family: "ZOOM",
			evidence: args.focal
				? `cursor=${args.focal.coverage.cursor}; zoom=${args.focal.zoomDecision.reasonCode}; planner=${oppSummary(args.planner, "ZOOM")}`
				: "focal analysis not run",
			decision: zoomInPlan ? "APPLY" : "KEEP",
			reason: zoomInPlan
				? "Editorially useful grounded zoom entered plan"
				: (zoomRow?.skippedReason ??
					args.planner?.opportunities.find((o) => o.family === "ZOOM")?.editorialReason ??
					args.focal?.zoomDecision.reasonCode ??
					"No grounded useful zoom"),
		},
		{
			family: "CROP",
			evidence: `planner=${oppSummary(args.planner, "CROP")}; focalCrop=${args.focal?.cropDecision.reasonCode ?? "n/a"}`,
			decision: cropInPlan
				? "APPLY"
				: cropOpp?.generationStatus === "INSUFFICIENT_EVIDENCE" ||
						cropOpp?.derivedParameters?.honest === "HONESTLY_LIMITED"
					? "HONESTLY_LIMITED"
					: cropOpp
						? "KEEP"
						: "MISSING_GENERATION",
			reason: cropInPlan
				? "Grounded framing crop entered plan"
				: (cropRow?.skippedReason ??
					cropOpp?.editorialReason ??
					"No safe autonomous crop geometry"),
		},
		{
			family: "SPEED",
			evidence: `planner=${oppSummary(args.planner, "SPEED")}`,
			decision: speedInPlan
				? "APPLY"
				: speedOpp?.generationStatus === "INSUFFICIENT_EVIDENCE"
					? "HONESTLY_LIMITED"
					: speedOpp
						? "KEEP"
						: "MISSING_GENERATION",
			reason: speedInPlan
				? "Grounded low-information speed entered plan"
				: (speedRow?.skippedReason ?? speedOpp?.editorialReason ?? "No grounded speed span"),
		},
		{
			family: "CAPTIONS",
			evidence: captionsOn ? "already enabled" : `planner=${oppSummary(args.planner, "CAPTIONS")}`,
			decision: capInPlan ? "APPLY" : "KEEP",
			reason: capInPlan
				? "Caption layout READY for MAKE_PROFESSIONAL"
				: captionsOn
					? "CAPTIONS_ALREADY_GOOD — preserve and continue other families"
					: "No caption layout / not requested",
		},
		{
			family: "LOUDNESS",
			evidence: args.loudness
				? `${args.loudness.outcome} gain=${args.loudness.appliedGainDb ?? "n/a"}`
				: `planner=${oppSummary(args.planner, "LOUDNESS")}`,
			decision: args.loudness?.committed ? "APPLY" : "KEEP",
			reason: args.loudness?.committed
				? "Safe normalization committed via settings path"
				: (args.loudness?.outcome ?? "audio not coordinated"),
		},
	];
}
