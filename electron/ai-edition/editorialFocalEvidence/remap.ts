/**
 * Post-trim SOURCE remap / revalidation for grounded focal targets.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import {
	mapSourceSpanThroughDocument,
	sourceInstantSurvivesPlayback,
} from "../captionLayout/programmeMap";
import { deriveZoomGeometry } from "./geometry";
import type {
	GroundedEditorialFocalTargetV1,
	RemapDisposition,
	ZoomGeometryProposalV1,
} from "./types";

export function remapFocalTargetAfterMutation(args: {
	document: AxcutDocument;
	assetId: string;
	target: GroundedEditorialFocalTargetV1;
}): {
	disposition: RemapDisposition;
	target: GroundedEditorialFocalTargetV1 | null;
	geometry: ZoomGeometryProposalV1 | null;
} {
	if (args.target.status !== "GROUNDED") {
		return { disposition: "STALE_AND_INVALID", target: null, geometry: null };
	}
	const mid = (args.target.sourceRange.startSec + args.target.sourceRange.endSec) / 2;
	const survives = sourceInstantSurvivesPlayback(args.document, args.assetId, mid);
	if (!survives) {
		return { disposition: "STALE_AND_INVALID", target: null, geometry: null };
	}

	const programmeRanges = mapSourceSpanThroughDocument(
		args.document,
		args.assetId,
		args.target.sourceRange.startSec,
		args.target.sourceRange.endSec,
	);
	if (programmeRanges.length < 1) {
		return { disposition: "REINVESTIGATION_REQUIRED", target: null, geometry: null };
	}
	const prog = programmeRanges[0]!;
	if (!(prog.endSec > prog.startSec + 0.35)) {
		return { disposition: "STALE_AND_INVALID", target: null, geometry: null };
	}

	const prior = args.target.programmeRanges?.[0];
	const disposition: RemapDisposition =
		prior &&
		Math.abs(prior.startSec - prog.startSec) < 1e-3 &&
		Math.abs(prior.endSec - prog.endSec) < 1e-3
			? "STILL_VALID"
			: "STALE_BUT_REMAPPABLE";

	const remapped: GroundedEditorialFocalTargetV1 = {
		...args.target,
		programmeRanges,
		survivesCurrentPlayback: true,
	};
	const geometry = deriveZoomGeometry(remapped);
	if (!geometry) {
		return { disposition: "REINVESTIGATION_REQUIRED", target: remapped, geometry: null };
	}
	return { disposition, target: remapped, geometry };
}
