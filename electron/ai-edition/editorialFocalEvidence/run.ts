/**
 * Main Local Editorial Focal Evidence V1 runner.
 */

import { buildEditorialFocalEvidence, fingerprintSource } from "./buildEvidence";
import { decideCrop } from "./cropDecision";
import { deriveGroundedFocalTargets } from "./deriveTarget";
import { investigateFocalWindow } from "./investigate";
import type {
	CursorSampleV1,
	EditorialFocalAnalysisBundleV1,
	ExistingZoomContextV1,
	FrameGeometryV1,
	ProtectedRegionV1,
	VisibleTextRegionV1,
	VisualChangeIntervalV1,
} from "./types";
import { LOCAL_EDITORIAL_FOCAL_EVIDENCE_V1_ID } from "./types";
import { decideZoom } from "./zoomDecision";

export interface AnalyzeEditorialFocalArgs {
	assetId: string;
	mediaFingerprint?: string | null;
	cursorSamples?: CursorSampleV1[] | null;
	visualIntervals?: VisualChangeIntervalV1[] | null;
	textRegions?: VisibleTextRegionV1[] | null;
	protectedRegions?: ProtectedRegionV1[] | null;
	existingZooms?: ExistingZoomContextV1[] | null;
	frameGeometry?: FrameGeometryV1 | null;
	aspectFramingRequired?: boolean;
	maxTargets?: number;
}

export function analyzeEditorialFocalEvidence(
	args: AnalyzeEditorialFocalArgs,
): EditorialFocalAnalysisBundleV1 {
	const t0 = Date.now();
	const sourceFingerprint =
		args.mediaFingerprint ??
		fingerprintSource([
			args.assetId,
			args.cursorSamples?.length ?? 0,
			args.visualIntervals?.length ?? 0,
			args.textRegions?.length ?? 0,
		]);

	const evidence = buildEditorialFocalEvidence({
		cursorSamples: args.cursorSamples,
		visualIntervals: args.visualIntervals,
		textRegions: args.textRegions,
		protectedRegions: args.protectedRegions,
		existingZooms: args.existingZooms,
		frameGeometry: args.frameGeometry,
	});

	const targets = deriveGroundedFocalTargets({
		evidence,
		sourceFingerprint,
		maxTargets: args.maxTargets ?? 4,
	});

	const investigations = [];
	for (const t of targets.filter((x) => x.status === "GROUNDED" || x.status === "WEAK")) {
		if (t.sourceRange.endSec <= t.sourceRange.startSec) continue;
		investigations.push(
			investigateFocalWindow({
				window: t.sourceRange,
				evidence,
				cursorSamples: args.cursorSamples,
				visualIntervals: args.visualIntervals,
				primaryFocal: t.focalPoint,
			}),
		);
	}

	// If investigation finds conflict, demote
	for (const inv of investigations) {
		if (inv.answers.conflictingFocal) {
			for (const t of targets) {
				if (t.sourceRange.startSec === inv.window.startSec && t.status === "GROUNDED") {
					t.status = "CONFLICTING";
					t.reasonCode = "INVESTIGATION_CONFLICTING_FOCAL";
				}
			}
		}
	}

	const zoomDecision = decideZoom({
		targets,
		evidence,
		protectedRegions: args.protectedRegions,
	});
	const cropDecision = decideCrop({
		targets,
		aspectFramingRequired: args.aspectFramingRequired === true,
	});

	const cursorAvail =
		(args.cursorSamples?.length ?? 0) === 0
			? "NOT_AVAILABLE"
			: (args.cursorSamples?.length ?? 0) < 5
				? "PARTIAL"
				: "AVAILABLE";
	const visualAvail =
		(args.visualIntervals?.length ?? 0) === 0
			? "NOT_AVAILABLE"
			: args.visualIntervals!.some((v) => !v.fullFrame)
				? "AVAILABLE"
				: "AVAILABLE_COARSE";
	const ocrAvail = (args.textRegions?.length ?? 0) > 0 ? "AVAILABLE" : "NOT_AVAILABLE";
	const grounded = targets.some((t) => t.status === "GROUNDED");
	const focalAvail = grounded
		? "AVAILABLE"
		: targets.some((t) => t.status === "WEAK")
			? "PARTIAL"
			: "NOT_AVAILABLE";

	return {
		providerId: LOCAL_EDITORIAL_FOCAL_EVIDENCE_V1_ID,
		version: 1,
		sourceFingerprint,
		evidence,
		targets,
		investigations,
		zoomDecision,
		cropDecision,
		coverage: {
			cursor: cursorAvail,
			visual: visualAvail,
			ocr: ocrAvail,
			focal: focalAvail,
		},
		metrics: {
			buildMs: Date.now() - t0,
			additionalDecodePasses: 0,
			paidAiCalls: 0,
		},
	};
}
