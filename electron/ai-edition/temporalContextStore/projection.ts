/**
 * Canonical source → programme projection.
 * Reuses captionLayout mapSourceSpanThroughDocument (trim + speed aware).
 * Do NOT invent a second timing implementation.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { programmeFingerprintFromDocument } from "../captionLayout/operation";
import { mapSourceSpanThroughDocument } from "../captionLayout/programmeMap";
import type { TimeRangeSec } from "./types";

export { programmeFingerprintFromDocument };

export function projectSourceRangeToProgramme(args: {
	document: AxcutDocument;
	assetId: string;
	sourceRange: TimeRangeSec;
}): TimeRangeSec[] {
	return mapSourceSpanThroughDocument(
		args.document,
		args.assetId,
		args.sourceRange.startSec,
		args.sourceRange.endSec,
	);
}

export function remapRecordProgrammeRanges(args: {
	document: AxcutDocument;
	assetId: string;
	sourceRange?: TimeRangeSec;
}): TimeRangeSec[] | undefined {
	if (!args.sourceRange) return undefined;
	return projectSourceRangeToProgramme({
		document: args.document,
		assetId: args.assetId,
		sourceRange: args.sourceRange,
	});
}
