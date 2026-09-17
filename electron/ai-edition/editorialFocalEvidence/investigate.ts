/**
 * Targeted temporal investigation — bounded window, structured answers, no decode.
 */

import { rangesOverlap } from "./cursorMetrics";
import { FOCAL_POLICY_V1 } from "./policy";
import type {
	CursorSampleV1,
	EditorialFocalEvidenceV1,
	SourceRangeSec,
	TargetedTemporalInvestigationResultV1,
	VisualChangeIntervalV1,
} from "./types";

export function investigateFocalWindow(args: {
	window: SourceRangeSec;
	evidence: EditorialFocalEvidenceV1[];
	cursorSamples?: CursorSampleV1[] | null;
	visualIntervals?: VisualChangeIntervalV1[] | null;
	/** When set, conflict is measured against this primary focus (not competing[0]). */
	primaryFocal?: { cx: number; cy: number } | null;
}): TargetedTemporalInvestigationResultV1 {
	const { window } = args;
	const inWin = args.evidence.filter((e) => rangesOverlap(e.sourceRange, window, 0.05));
	const notes: string[] = [];
	const samples = (args.cursorSamples ?? []).filter(
		(s) => s.atSec >= window.startSec - 0.2 && s.atSec <= window.endSec + 0.2,
	);
	const interactions = inWin.filter(
		(e) =>
			e.kind === "CURSOR_CLICK" || e.kind === "CURSOR_CLUSTER" || e.kind === "INTERACTION_REGION",
	);
	const dwells = inWin.filter((e) => e.kind === "CURSOR_DWELL");
	const visuals = (args.visualIntervals ?? []).filter((v) =>
		rangesOverlap({ startSec: v.startSec, endSec: v.endSec }, window, 0.1),
	);
	const fullFrame = visuals.some((v) => v.fullFrame || v.kind === "scene");
	const localChange = visuals.some(
		(v) =>
			!v.fullFrame && (v.kind === "moderate" || v.kind === "significant" || v.kind === "activity"),
	);
	const competing = inWin.filter(
		(e) => e.focalPoint && (e.kind === "CURSOR_CLICK" || e.kind === "CURSOR_CLUSTER"),
	);
	let conflicting = false;
	if (competing.length >= 2) {
		const primary = args.primaryFocal ?? competing[0]!.focalPoint!;
		const instants = (e: (typeof competing)[0]) => {
			if (e.kind === "CURSOR_CLICK") return [e.sourceRange.startSec];
			return [e.sourceRange.startSec];
		};
		conflicting = competing.some((c) => {
			if (
				Math.hypot(c.focalPoint!.cx - primary.cx, c.focalPoint!.cy - primary.cy) <=
				FOCAL_POLICY_V1.competeDistance
			) {
				return false;
			}
			const primaryEv = competing.find(
				(p) =>
					p.focalPoint &&
					Math.hypot(p.focalPoint.cx - primary.cx, p.focalPoint.cy - primary.cy) <=
						FOCAL_POLICY_V1.competeDistance,
			);
			if (!primaryEv) return true;
			const a = instants(primaryEv);
			const b = instants(c);
			return a.some((ta) => b.some((tb) => Math.abs(ta - tb) <= 0.75));
		});
	}

	const persistSec = Math.max(
		0,
		...dwells.map((d) => d.sourceRange.endSec - d.sourceRange.startSec),
		...interactions.map((d) => d.sourceRange.endSec - d.sourceRange.startSec),
	);

	notes.push(
		`evidence_in_window=${inWin.length}`,
		`cursor_samples=${samples.length}`,
		`interactions=${interactions.length}`,
	);

	return {
		window: { ...window },
		evidenceIds: inWin.map((e) => e.id),
		answers: {
			stableBefore: dwells.length > 0 || samples.length >= 3,
			whatChanged: fullFrame
				? "full_frame"
				: localChange
					? "local"
					: visuals.length
						? "unknown"
						: "none",
			cursorActivity: samples.length > 0,
			interactionHappened: interactions.length > 0,
			regionPersisted: persistSec >= FOCAL_POLICY_V1.minGroundedPersistSec,
			conflictingFocal: conflicting,
			survivesLongEnough: persistSec >= FOCAL_POLICY_V1.minGroundedPersistSec,
		},
		additionalDecodePasses: 0,
		notes,
	};
}
