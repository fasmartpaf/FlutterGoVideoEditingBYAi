/**
 * Editorial zoom decision — grounded target still not automatic zoom.
 */

import { targetAreaFraction } from "./deriveTarget";
import { deriveZoomGeometry } from "./geometry";
import { FOCAL_POLICY_V1 } from "./policy";
import type {
	EditorialFocalEvidenceV1,
	GroundedEditorialFocalTargetV1,
	ProtectedRegionV1,
	ZoomDecisionV1,
} from "./types";

function rectsOverlap(
	a: { x: number; y: number; width: number; height: number },
	b: { x: number; y: number; width: number; height: number },
): boolean {
	return (
		a.x < b.x + b.width - 1e-9 &&
		a.x + a.width > b.x + 1e-9 &&
		a.y < b.y + b.height - 1e-9 &&
		a.y + a.height > b.y + 1e-9
	);
}

export function decideZoom(args: {
	targets: GroundedEditorialFocalTargetV1[];
	evidence: EditorialFocalEvidenceV1[];
	protectedRegions?: ProtectedRegionV1[] | null;
}): ZoomDecisionV1 {
	const notes: string[] = [];
	const grounded = args.targets.filter((t) => t.status === "GROUNDED");
	const ambiguous = args.targets.find(
		(t) => t.status === "AMBIGUOUS" || t.status === "CONFLICTING",
	);
	if (ambiguous) {
		return {
			decision: "NO_ZOOM_RECOMMENDED",
			reasonCode: "AMBIGUOUS_TARGET",
			targetId: ambiguous.targetId,
			geometry: null,
			notes: ["competing_or_ambiguous_focal"],
		};
	}
	if (grounded.length === 0) {
		const any = args.targets[0];
		return {
			decision: "NO_ZOOM_RECOMMENDED",
			reasonCode: any?.status === "WEAK" ? "INSUFFICIENT_EVIDENCE" : "NO_GROUNDED_FOCAL_TARGET",
			targetId: any?.targetId ?? null,
			geometry: null,
			notes: [any?.reasonCode ?? "no_target"],
		};
	}

	const target = grounded[0]!;
	if (target.status !== "GROUNDED") {
		return {
			decision: "NO_ZOOM_RECOMMENDED",
			reasonCode: "STATUS_NOT_GROUNDED",
			targetId: target.targetId,
			geometry: null,
			notes,
		};
	}

	const area = targetAreaFraction(target);
	if (area >= FOCAL_POLICY_V1.maxTargetArea) {
		return {
			decision: "NO_ZOOM_RECOMMENDED",
			reasonCode: "TARGET_TOO_LARGE",
			targetId: target.targetId,
			geometry: null,
			notes: [`area=${area.toFixed(3)}`],
		};
	}
	const dur = target.sourceRange.endSec - target.sourceRange.startSec;
	if (dur < FOCAL_POLICY_V1.minGroundedPersistSec || target.stability === "TRANSIENT") {
		return {
			decision: "NO_ZOOM_RECOMMENDED",
			reasonCode: "TARGET_TOO_SHORT",
			targetId: target.targetId,
			geometry: null,
			notes: [`dur=${dur.toFixed(3)}`],
		};
	}

	const existing = args.evidence.filter((e) => e.kind === "EXISTING_ZOOM_CONTEXT");
	for (const z of existing) {
		if (!z.focalPoint) continue;
		const overlapTime =
			z.sourceRange.startSec < target.sourceRange.endSec &&
			z.sourceRange.endSec > target.sourceRange.startSec;
		const near =
			Math.hypot(z.focalPoint.cx - target.focalPoint.cx, z.focalPoint.cy - target.focalPoint.cy) <=
			FOCAL_POLICY_V1.existingZoomFocusMatch;
		if (overlapTime && near) {
			return {
				decision: "NO_ZOOM_RECOMMENDED",
				reasonCode: "EXISTING_ZOOM_SUFFICIENT",
				targetId: target.targetId,
				geometry: null,
				notes: ["existing_zoom_covers_target"],
			};
		}
	}

	const geometry = deriveZoomGeometry(target);
	if (!geometry) {
		return {
			decision: "NO_ZOOM_RECOMMENDED",
			reasonCode: "NO_ACTIONABLE_GEOMETRY",
			targetId: target.targetId,
			geometry: null,
			notes: ["geometry_derivation_failed"],
		};
	}

	// Preservation: zoom must not hide protected content (webcam / captions / annotations)
	for (const p of args.protectedRegions ?? []) {
		if (p.kind === "caption_safe" || p.kind === "webcam" || p.kind === "annotation") {
			const prot = p.region;
			const nearTarget = rectsOverlap(prot, target.normalizedRegion);
			if (p.kind === "webcam" && nearTarget) {
				return {
					decision: "NO_ZOOM_RECOMMENDED",
					reasonCode: "PRESERVATION_CONFLICT",
					targetId: target.targetId,
					geometry: null,
					notes: [`protected:${p.id}:${p.kind}`],
				};
			}
			const vis = geometry.visibleWindow;
			const overlap = rectsOverlap(prot, vis);
			const protCenter = {
				cx: prot.x + prot.width / 2,
				cy: prot.y + prot.height / 2,
			};
			const centerVisible =
				protCenter.cx >= vis.x &&
				protCenter.cx <= vis.x + vis.width &&
				protCenter.cy >= vis.y &&
				protCenter.cy <= vis.y + vis.height;
			if ((!overlap || !centerVisible) && nearTarget) {
				return {
					decision: "NO_ZOOM_RECOMMENDED",
					reasonCode: "PRESERVATION_CONFLICT",
					targetId: target.targetId,
					geometry: null,
					notes: [`protected:${p.id}:${p.kind}`],
				};
			}
		}
	}

	// Target already fills most of a mild zoom → already visible enough
	if (area > 0.35 && geometry.depth <= 1) {
		return {
			decision: "NO_ZOOM_RECOMMENDED",
			reasonCode: "ALREADY_VISIBLE",
			targetId: target.targetId,
			geometry: null,
			notes: ["target_already_large_in_frame"],
		};
	}

	notes.push("grounded_emphasis_eligible");
	return {
		decision: "ZOOM_ELIGIBLE",
		reasonCode: "GROUNDED_EMPHASIS",
		targetId: target.targetId,
		geometry,
		notes,
	};
}
