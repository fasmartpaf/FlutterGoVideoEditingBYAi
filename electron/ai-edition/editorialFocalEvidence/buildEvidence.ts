/**
 * Build EditorialFocalEvidenceV1 items from local inputs (no paid AI).
 */

import { createHash } from "node:crypto";
import {
	detectDwellRuns,
	interactionClusters,
	interactionInstants,
	isFastCrossing,
	meanPoint,
	regionAround,
	sortSamples,
} from "./cursorMetrics";
import { FOCAL_POLICY_V1 } from "./policy";
import type {
	CursorSampleV1,
	EditorialFocalEvidenceV1,
	ExistingZoomContextV1,
	FrameGeometryV1,
	ProtectedRegionV1,
	VisibleTextRegionV1,
	VisualChangeIntervalV1,
} from "./types";

let seq = 0;
export function resetFocalEvidenceSeqForTests(): void {
	seq = 0;
}

function eid(kind: string): string {
	seq += 1;
	return `efe_${kind}_${seq}`;
}

export function fingerprintSource(parts: Array<string | number | null | undefined>): string {
	return createHash("sha256")
		.update(parts.filter((p) => p != null).join("|"))
		.digest("hex")
		.slice(0, 16);
}

export function buildEditorialFocalEvidence(args: {
	cursorSamples?: CursorSampleV1[] | null;
	visualIntervals?: VisualChangeIntervalV1[] | null;
	textRegions?: VisibleTextRegionV1[] | null;
	protectedRegions?: ProtectedRegionV1[] | null;
	existingZooms?: ExistingZoomContextV1[] | null;
	frameGeometry?: FrameGeometryV1 | null;
}): EditorialFocalEvidenceV1[] {
	const out: EditorialFocalEvidenceV1[] = [];
	const samples = sortSamples(args.cursorSamples ?? []);

	if (args.frameGeometry) {
		out.push({
			id: eid("frame"),
			kind: "FRAME_GEOMETRY",
			sourceRange: { startSec: 0, endSec: 0 },
			confidence: "HIGH",
			provenance: {
				module: "editorialFocalEvidence",
				version: "v1",
				observedOrDerived: "OBSERVED",
			},
			epistemic: "OBSERVED",
			metrics: {
				widthPx: args.frameGeometry.widthPx,
				heightPx: args.frameGeometry.heightPx,
				aspect: args.frameGeometry.aspect,
			},
		});
	}

	for (const z of args.existingZooms ?? []) {
		out.push({
			id: eid("zoom"),
			kind: "EXISTING_ZOOM_CONTEXT",
			sourceRange: { startSec: z.startSec, endSec: z.endSec },
			focalPoint: { ...z.focus },
			confidence: "HIGH",
			provenance: {
				module: "document",
				observedOrDerived: "OBSERVED",
			},
			epistemic: "OBSERVED",
			payloadRef: z.id,
			metrics: { depth: z.depth ?? 0 },
		});
	}

	for (const p of args.protectedRegions ?? []) {
		out.push({
			id: eid("prot"),
			kind: "PROTECTED_REGION",
			sourceRange: p.sourceRange ?? { startSec: 0, endSec: 0 },
			normalizedRegion: { ...p.region },
			confidence: "HIGH",
			provenance: {
				module: "preservation",
				observedOrDerived: "OBSERVED",
			},
			epistemic: "OBSERVED",
			payloadRef: p.id,
			metrics: { kind: p.kind },
		});
	}

	for (const t of args.textRegions ?? []) {
		out.push({
			id: eid("text"),
			kind: "VISIBLE_TEXT_REGION",
			sourceRange: { ...t.sourceRange },
			normalizedRegion: { ...t.region },
			focalPoint: {
				cx: t.region.x + t.region.width / 2,
				cy: t.region.y + t.region.height / 2,
			},
			confidence: "MEDIUM",
			provenance: {
				module: "ocrCache",
				observedOrDerived: "OBSERVED",
			},
			epistemic: "OBSERVED",
			payloadRef: t.payloadRef ?? t.id,
		});
	}

	// Visual intervals — context only; full-frame flagged so targets never use as geometry.
	for (const v of args.visualIntervals ?? []) {
		out.push({
			id: eid("vis"),
			kind: "VISUAL_CHANGE_REGION",
			sourceRange: { startSec: v.startSec, endSec: v.endSec },
			confidence: v.fullFrame ? "LOW" : "MEDIUM",
			provenance: {
				module: "visualAnalysis",
				observedOrDerived: "DERIVED",
			},
			epistemic: "DERIVED",
			metrics: {
				kind: v.kind,
				fullFrame: Boolean(v.fullFrame),
			},
		});
	}

	if (samples.length === 0) return out;

	const crossing = isFastCrossing(samples);
	for (const dwell of detectDwellRuns(samples)) {
		const weakPark =
			dwell.interactionCount === 0 && dwell.dwellSec >= FOCAL_POLICY_V1.minDwellSec && !crossing;
		out.push({
			id: eid("dwell"),
			kind: "CURSOR_DWELL",
			sourceRange: { startSec: dwell.startSec, endSec: dwell.endSec },
			focalPoint: { ...dwell.mean },
			normalizedRegion: regionAround(dwell.mean, Math.max(0.06, dwell.clusterRadius + 0.04)),
			confidence: dwell.interactionCount > 0 ? "HIGH" : weakPark ? "LOW" : "MEDIUM",
			provenance: {
				module: "editorialFocalEvidence.cursor",
				observedOrDerived: "DERIVED",
			},
			epistemic: "DERIVED",
			metrics: {
				dwellSec: dwell.dwellSec,
				meanVelocity: dwell.meanVelocity,
				interactionCount: dwell.interactionCount,
				clusterRadius: dwell.clusterRadius,
				sampleCount: dwell.sampleCount,
				parkedNoInteraction: weakPark,
			},
		});
	}

	for (const click of interactionInstants(samples)) {
		const after = samples.filter(
			(s) => s.atSec >= click.atSec && s.atSec <= click.atSec + FOCAL_POLICY_V1.clickDwellWindowSec,
		);
		const dwellAfter = detectDwellRuns(after)[0];
		out.push({
			id: eid("click"),
			kind: "CURSOR_CLICK",
			sourceRange: {
				startSec: click.atSec,
				endSec: dwellAfter?.endSec ?? click.atSec + 0.05,
			},
			focalPoint: { cx: click.cx, cy: click.cy },
			normalizedRegion: regionAround(
				{ cx: click.cx, cy: click.cy },
				dwellAfter ? Math.max(0.06, dwellAfter.clusterRadius + 0.04) : 0.08,
			),
			confidence: dwellAfter ? "HIGH" : "MEDIUM",
			provenance: {
				module: "editorialFocalEvidence.cursor",
				observedOrDerived: "OBSERVED",
			},
			epistemic: "OBSERVED",
			metrics: {
				hasLocalDwell: Boolean(dwellAfter),
				dwellSec: dwellAfter?.dwellSec ?? 0,
			},
		});
	}

	for (const cl of interactionClusters(samples)) {
		out.push({
			id: eid("cluster"),
			kind: "CURSOR_CLUSTER",
			sourceRange: { ...cl.range },
			focalPoint: { ...cl.mean },
			normalizedRegion: regionAround(cl.mean, Math.max(0.07, cl.radius + 0.03)),
			confidence: "HIGH",
			provenance: {
				module: "editorialFocalEvidence.cursor",
				observedOrDerived: "DERIVED",
			},
			epistemic: "DERIVED",
			metrics: {
				interactionCount: cl.count,
				clusterRadius: cl.radius,
			},
		});
		out.push({
			id: eid("inter"),
			kind: "INTERACTION_REGION",
			sourceRange: { ...cl.range },
			focalPoint: { ...cl.mean },
			normalizedRegion: regionAround(cl.mean, Math.max(0.07, cl.radius + 0.03)),
			confidence: "HIGH",
			provenance: {
				module: "editorialFocalEvidence.cursor",
				observedOrDerived: "DERIVED",
			},
			epistemic: "DERIVED",
			metrics: { interactionCount: cl.count },
		});
	}

	// Approach / convergence: last half of samples in a compact window with declining spread
	if (samples.length >= 6 && !crossing) {
		const last = samples.slice(Math.floor(samples.length * 0.5));
		const m = meanPoint(last);
		const vars =
			last.reduce((n, s) => n + (s.cx - m.cx) ** 2 + (s.cy - m.cy) ** 2, 0) / last.length;
		if (vars < FOCAL_POLICY_V1.approachConvergenceVar) {
			out.push({
				id: eid("approach"),
				kind: "CURSOR_APPROACH",
				sourceRange: {
					startSec: last[0]!.atSec,
					endSec: last[last.length - 1]!.atSec,
				},
				focalPoint: m,
				normalizedRegion: regionAround(m, 0.09),
				confidence: "MEDIUM",
				provenance: {
					module: "editorialFocalEvidence.cursor",
					observedOrDerived: "DERIVED",
				},
				epistemic: "DERIVED",
				metrics: { variance: vars, sampleCount: last.length },
			});
		}
	}

	return out;
}
