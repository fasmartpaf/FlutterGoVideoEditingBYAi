/**
 * Map COMPRESSED_PROGRAMME_TIME → source contribution for compositor seeks.
 */

import { resolvePlaybackSegments } from "../../../src/lib/ai-edition/document/timeline";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { resolveVisibleClips } from "../../../src/native/sceneDescription";

export interface ProgrammeInstant {
	programmeTimeSec: number;
	sourceTimeSec: number;
	assetId: string;
	clipId: string;
	clipIndex: number;
	sourceStartSec: number;
	sourceEndSec: number;
	screenPath: string;
	webcamPath: string;
	webcamOffsetSec: number;
}

export function locateProgrammeInstant(
	document: AxcutDocument,
	programmeTimeSec: number,
): ProgrammeInstant | null {
	const segs = resolvePlaybackSegments(document.timeline.clips, document.timeline.trimRanges);
	if (segs.length === 0) return null;
	const assetById = new Map(document.assets.map((a) => [a.id, a]));

	for (let i = 0; i < segs.length; i += 1) {
		const s = segs[i];
		const end = s.timelineEndSec;
		const last = i === segs.length - 1;
		if (
			programmeTimeSec >= s.timelineStartSec - 1e-9 &&
			(programmeTimeSec < end - 1e-9 || (last && programmeTimeSec <= end + 1e-9))
		) {
			const asset = assetById.get(s.assetId);
			if (!asset?.originalPath) return null;
			const srcEnd = s.sourceEndSec ?? s.sourceStartSec;
			const offset = Math.max(0, programmeTimeSec - s.timelineStartSec);
			const sourceTimeSec = Math.min(srcEnd - 1e-3, s.sourceStartSec + offset);
			return {
				programmeTimeSec,
				sourceTimeSec: Math.max(s.sourceStartSec, sourceTimeSec),
				assetId: s.assetId,
				clipId: s.id,
				clipIndex: i,
				sourceStartSec: s.sourceStartSec,
				sourceEndSec: srcEnd,
				screenPath: asset.originalPath,
				webcamPath: "",
				webcamOffsetSec: 0,
			};
		}
	}
	return null;
}

/** Clip list for bounded exportMulti covering a compressed programme window. */
export function clipInputsForProgrammeWindow(
	document: AxcutDocument,
	windowStartSec: number,
	windowEndSec: number,
): Array<{
	screenPath: string;
	webcamPath: string;
	sourceStartSec: number;
	sourceEndSec: number;
	webcamOffsetSec: number;
	hasAudio: boolean;
}> {
	const visible = resolveVisibleClips(document);
	const assetById = new Map(document.assets.map((a) => [a.id, a]));
	const out: Array<{
		screenPath: string;
		webcamPath: string;
		sourceStartSec: number;
		sourceEndSec: number;
		webcamOffsetSec: number;
		hasAudio: boolean;
	}> = [];

	for (const seg of visible) {
		const overlapStart = Math.max(seg.timelineStartSec, windowStartSec);
		const overlapEnd = Math.min(seg.timelineEndSec, windowEndSec);
		if (!(overlapEnd > overlapStart)) continue;
		const asset = assetById.get(seg.assetId);
		if (!asset?.originalPath) continue;
		const srcStart = seg.sourceStartSec + (overlapStart - seg.timelineStartSec);
		const srcEnd = seg.sourceStartSec + (overlapEnd - seg.timelineStartSec);
		out.push({
			screenPath: asset.originalPath,
			webcamPath: "",
			sourceStartSec: srcStart,
			sourceEndSec: Math.max(srcStart + 1e-3, srcEnd),
			webcamOffsetSec: 0,
			hasAudio: true,
		});
	}
	return out;
}

export function assertSourceOutsideRemoved(
	sourceTimeSec: number,
	trimStartSec: number,
	trimEndSec: number,
): boolean {
	return !(sourceTimeSec > trimStartSec + 1e-6 && sourceTimeSec < trimEndSec - 1e-6);
}
