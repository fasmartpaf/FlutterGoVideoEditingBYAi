/**
 * Bridge editorial focal targets → professional orchestrator GroundedFocalTargetV1.
 * Only GROUNDED + ZOOM_ELIGIBLE become executable orchestrator focals.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import {
	mapSourceSpanThroughDocument,
	sourceInstantSurvivesPlayback,
} from "../captionLayout/programmeMap";
import type { GroundedFocalTargetV1 } from "../professionalEditOrchestrator/focal";
import type { EditorialFocalAnalysisBundleV1, GroundedEditorialFocalTargetV1 } from "./types";

function evidenceTypeFor(t: GroundedEditorialFocalTargetV1): GroundedFocalTargetV1["evidenceType"] {
	if (t.evidenceFamilies.includes("CURSOR_CLUSTER")) return "cursor_stable_cluster";
	if (t.evidenceFamilies.includes("CURSOR_CLICK")) return "cursor_click_dwell";
	if (t.evidenceFamilies.includes("CURSOR_APPROACH")) return "cursor_convergence";
	if (t.evidenceFamilies.includes("CURSOR_DWELL")) return "cursor_stable_cluster";
	return "none";
}

export function toOrchestratorGroundedFocals(args: {
	document: AxcutDocument;
	assetId: string;
	bundle: EditorialFocalAnalysisBundleV1;
}): GroundedFocalTargetV1[] {
	if (args.bundle.zoomDecision.decision !== "ZOOM_ELIGIBLE") {
		return [];
	}
	const targetId = args.bundle.zoomDecision.targetId;
	const targets = args.bundle.targets.filter(
		(t) => t.status === "GROUNDED" && (targetId == null || t.targetId === targetId),
	);
	const out: GroundedFocalTargetV1[] = [];
	for (const t of targets) {
		const geom = args.bundle.zoomDecision.geometry;
		const rangeStart = geom?.sourceStartSec ?? t.sourceRange.startSec;
		const rangeEnd = geom?.sourceEndSec ?? t.sourceRange.endSec;
		// Prefer interaction start / geometry mid — a long merged mid can land in a trim.
		const probeTimes = [
			rangeStart + 0.15,
			(rangeStart + rangeEnd) / 2,
			t.sourceRange.startSec + 0.1,
		];
		const survives = probeTimes.some((tSec) =>
			sourceInstantSurvivesPlayback(args.document, args.assetId, tSec),
		);
		if (!survives) continue;
		const programmeRanges = mapSourceSpanThroughDocument(
			args.document,
			args.assetId,
			rangeStart,
			rangeEnd,
		);
		if (programmeRanges.length === 0) continue;
		out.push({
			version: 1,
			sourceRange: { startSec: rangeStart, endSec: rangeEnd },
			focal: geom ? { cx: geom.focalPoint.cx, cy: geom.focalPoint.cy } : { ...t.focalPoint },
			evidenceType: evidenceTypeFor(t),
			evidenceRefs: t.evidenceIds,
			confidence: t.confidence === "HIGH" ? "high" : t.confidence === "MEDIUM" ? "medium" : "low",
			reason: t.reasonCode,
			programmeRanges,
			survivesCurrentPlayback: survives,
			notes: [`editorial_focal:${t.status}`, `zoom:${args.bundle.zoomDecision.reasonCode}`],
		});
	}
	return out;
}
