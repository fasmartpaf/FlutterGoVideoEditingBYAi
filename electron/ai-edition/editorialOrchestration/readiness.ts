/**
 * Execution-readiness aggregation across recommendation families.
 */

import type { EditorialRecommendationV1, ExecutionReadiness, OperationFamily } from "./types";

export interface FamilyReadinessRow {
	family: OperationFamily;
	READY_TO_APPLY: number;
	MISSING_ARGS: number;
	NEEDS_HUMAN_SELECTION: number;
	UNSUPPORTED: number;
	notes: string[];
}

/** Known incomplete provisional args from Edit Proposal V1 builder (audit). */
export const PROPOSAL_BUILDER_ARG_GAPS: Record<string, string[]> = {
	TRIM: ["speech-boundary review note only — landing times present"],
	ZOOM: ["depth", "focus.cx", "focus.cy"],
	CROP: ["cropRegion / clipId"],
	SPEED: ["speed rate"],
	CAPTIONS: ["legacy generateCaptions scope; enableCaptions is ready when layout ok"],
	LOUDNESS: ["outside applyPreview — uses loudness audioGainDb path"],
	NONE: [],
};

export function aggregateExecutionReadiness(recommendations: EditorialRecommendationV1[]): {
	byFamily: FamilyReadinessRow[];
	totals: Record<ExecutionReadiness, number>;
} {
	const families: OperationFamily[] = [
		"TRIM",
		"ZOOM",
		"CROP",
		"SPEED",
		"CAPTIONS",
		"LOUDNESS",
		"NONE",
	];
	const byFamily: FamilyReadinessRow[] = families.map((family) => {
		const rows = recommendations.filter((r) => r.operationFamily === family);
		const count = (k: ExecutionReadiness) => rows.filter((r) => r.executionReadiness === k).length;
		const notes: string[] = [];
		if (family in PROPOSAL_BUILDER_ARG_GAPS) {
			const gaps = PROPOSAL_BUILDER_ARG_GAPS[family]!;
			if (gaps.length) notes.push(`proposal_builder_gaps: ${gaps.join(", ")}`);
		}
		for (const r of rows) {
			if (r.missingParameters.length) {
				notes.push(`${r.id}: missing ${r.missingParameters.join(", ")}`);
			}
		}
		return {
			family,
			READY_TO_APPLY: count("READY_TO_APPLY"),
			MISSING_ARGS: count("MISSING_ARGS"),
			NEEDS_HUMAN_SELECTION: count("NEEDS_HUMAN_SELECTION"),
			UNSUPPORTED: count("UNSUPPORTED"),
			notes,
		};
	});

	const totals: Record<ExecutionReadiness, number> = {
		READY_TO_APPLY: 0,
		MISSING_ARGS: 0,
		NEEDS_HUMAN_SELECTION: 0,
		UNSUPPORTED: 0,
	};
	for (const r of recommendations) {
		totals[r.executionReadiness] += 1;
	}
	return { byFamily, totals };
}
