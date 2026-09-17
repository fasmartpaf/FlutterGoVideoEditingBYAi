/**
 * Source → programme mapping for VisualAnalysisV1 events.
 */

import { resolvePlaybackSegments } from "../../../src/lib/ai-edition/document/timeline";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";

export type ProgrammeMapStatus = "present" | "removed" | "partial" | "unmapped";

export interface ProgrammeMappedRange {
	sourceStartSec: number;
	sourceEndSec: number;
	status: ProgrammeMapStatus;
	programmeRanges: Array<{ startSec: number; endSec: number }>;
}

function sourceToProgramme(
	sourceSec: number,
	segs: ReturnType<typeof resolvePlaybackSegments>,
	assetId: string,
): number | null {
	for (const s of segs) {
		if (s.assetId !== assetId) continue;
		const srcEnd = s.sourceEndSec ?? s.sourceStartSec;
		if (sourceSec >= s.sourceStartSec - 1e-6 && sourceSec <= srcEnd + 1e-6) {
			const offset = sourceSec - s.sourceStartSec;
			return s.timelineStartSec + offset;
		}
	}
	return null;
}

export function mapSourceRangeToProgramme(args: {
	document: AxcutDocument;
	assetId: string;
	startSec: number;
	endSec: number;
}): ProgrammeMappedRange {
	const segs = resolvePlaybackSegments(
		args.document.timeline.clips,
		args.document.timeline.trimRanges,
	).filter((s) => s.assetId === args.assetId);

	const samples: number[] = [];
	const step = Math.max(0.05, (args.endSec - args.startSec) / 20);
	for (let t = args.startSec; t <= args.endSec + 1e-9; t += step) {
		samples.push(t);
	}
	if (samples[samples.length - 1]! < args.endSec - 1e-6) samples.push(args.endSec);

	const mapped = samples
		.map((t) => ({ t, p: sourceToProgramme(t, segs, args.assetId) }))
		.filter((x) => x.p != null) as Array<{ t: number; p: number }>;

	if (mapped.length === 0) {
		return {
			sourceStartSec: args.startSec,
			sourceEndSec: args.endSec,
			status: "removed",
			programmeRanges: [],
		};
	}

	const allPresent = mapped.length === samples.length;
	const programmeRanges: Array<{ startSec: number; endSec: number }> = [];
	let runStart = mapped[0]!.p;
	let runEnd = mapped[0]!.p;
	let prev = mapped[0]!.p;
	for (let i = 1; i < mapped.length; i += 1) {
		const p = mapped[i]!.p;
		if (p <= prev + step * 2 + 0.05) {
			runEnd = p;
			prev = p;
		} else {
			programmeRanges.push({ startSec: runStart, endSec: runEnd });
			runStart = p;
			runEnd = p;
			prev = p;
		}
	}
	programmeRanges.push({ startSec: runStart, endSec: Math.max(runEnd, runStart) });

	return {
		sourceStartSec: args.startSec,
		sourceEndSec: args.endSec,
		status: allPresent ? "present" : "partial",
		programmeRanges,
	};
}

export function mapSourceInstantToProgramme(args: {
	document: AxcutDocument;
	assetId: string;
	sourceTimeSec: number;
}): { status: ProgrammeMapStatus; programmeTimeSec: number | null } {
	const segs = resolvePlaybackSegments(
		args.document.timeline.clips,
		args.document.timeline.trimRanges,
	);
	const p = sourceToProgramme(args.sourceTimeSec, segs, args.assetId);
	return p == null
		? { status: "removed", programmeTimeSec: null }
		: { status: "present", programmeTimeSec: p };
}
