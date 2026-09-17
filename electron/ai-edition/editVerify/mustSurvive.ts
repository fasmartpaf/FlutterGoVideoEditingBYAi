/**
 * Must-survive generalization across zoom / crop / speed.
 * "Exists in timeline" ≠ "visible in output."
 */

import { cropPreservesRegion } from "./geometry/crop";
import type { ZoomGeometryVerification } from "./geometry/zoom";
import { sourceToProgrammeUnderSpeed } from "./speedMath";
import type { MustSurviveRequirement, NormalizedRect } from "./types";

export interface MustSurviveAssessment {
	ok: boolean;
	failedIds: string[];
	notes: string[];
}

export function assessZoomMustSurvive(args: {
	geometry: ZoomGeometryVerification;
	mustSurvive: MustSurviveRequirement[];
}): MustSurviveAssessment {
	const notes: string[] = [];
	const failedIds: string[] = [];
	for (const req of args.mustSurvive) {
		if (req.kind !== "normalized_region" || !req.region) continue;
		const visible = args.geometry.visibleSourceWindow;
		const survives = cropPreservesRegion(visible, req.region, "center");
		if (!survives) {
			failedIds.push(req.id);
			notes.push(`zoom_must_survive_clipped:${req.id}`);
		}
	}
	return { ok: failedIds.length === 0, failedIds, notes };
}

export function assessCropMustSurvive(args: {
	crop: NormalizedRect;
	mustSurvive: MustSurviveRequirement[];
}): MustSurviveAssessment {
	const notes: string[] = [];
	const failedIds: string[] = [];
	for (const req of args.mustSurvive) {
		if (req.kind !== "normalized_region" || !req.region) continue;
		if (!cropPreservesRegion(args.crop, req.region, "center")) {
			failedIds.push(req.id);
			notes.push(`crop_must_survive_excluded:${req.id}`);
		}
	}
	return { ok: failedIds.length === 0, failedIds, notes };
}

export function assessSpeedMustSurvive(args: {
	mustSurvive: MustSurviveRequirement[];
	regionSourceStartSec: number;
	regionSourceEndSec: number;
	programmeStartSec: number;
	multiplier: number;
}): MustSurviveAssessment {
	const notes: string[] = [];
	const failedIds: string[] = [];
	for (const req of args.mustSurvive) {
		if (req.kind === "source_range" && req.startSourceSec != null && req.endSourceSec != null) {
			const mid = (req.startSourceSec + req.endSourceSec) / 2;
			const mapped = sourceToProgrammeUnderSpeed({
				sourceTimeSec: mid,
				regionSourceStartSec: args.regionSourceStartSec,
				regionSourceEndSec: args.regionSourceEndSec,
				programmeStartSec: args.programmeStartSec,
				multiplier: args.multiplier,
			});
			if (mapped == null) {
				// Outside speed region — still represented at 1×; OK for V1 if not in region.
				notes.push(`speed_must_survive_outside_region:${req.id}`);
			}
		}
	}
	return { ok: failedIds.length === 0, failedIds, notes };
}
