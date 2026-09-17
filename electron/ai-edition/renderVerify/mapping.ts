/**
 * Compressed-programme mapping checks for trim render verification.
 * Uses resolvePlaybackSegments — same basis as export/native walk.
 */

import { resolvePlaybackSegments } from "../../../src/lib/ai-edition/document/timeline";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";

export interface TrimJoinMapping {
	removedAbsent: boolean;
	joinCompressedSec: number | null;
	sourceJustBefore: number | null;
	sourceJustAfter: number | null;
	programmeDurationSec: number;
	segmentsCoveringInterior: number;
	notes: string[];
}

function sourceCoveredByProgramme(doc: AxcutDocument, sourceSec: number, assetId: string): boolean {
	const segs = resolvePlaybackSegments(doc.timeline.clips, doc.timeline.trimRanges);
	return segs.some(
		(s) =>
			s.assetId === assetId &&
			sourceSec >= s.sourceStartSec - 1e-9 &&
			sourceSec < (s.sourceEndSec ?? s.sourceStartSec) - 1e-9,
	);
}

/**
 * Verify the trim interval is absent from the compressed programme and
 * locate the join between content before and after the cut.
 */
export function analyzeTrimProgrammeMapping(args: {
	after: AxcutDocument;
	assetId: string;
	trimStartSec: number;
	trimEndSec: number;
}): TrimJoinMapping {
	const notes: string[] = [];
	const segs = resolvePlaybackSegments(args.after.timeline.clips, args.after.timeline.trimRanges);
	const relevant = segs.filter((s) => s.assetId === args.assetId);

	const mid = (args.trimStartSec + args.trimEndSec) / 2;
	const probePoints = [args.trimStartSec + 1e-3, mid, args.trimEndSec - 1e-3].filter(
		(t) => t > args.trimStartSec && t < args.trimEndSec,
	);

	let segmentsCoveringInterior = 0;
	for (const t of probePoints) {
		if (sourceCoveredByProgramme(args.after, t, args.assetId)) {
			segmentsCoveringInterior += 1;
			notes.push(`removed_source_still_in_programme:${t.toFixed(3)}`);
		}
	}
	const removedAbsent = segmentsCoveringInterior === 0;

	const epsilon = 1e-3;
	const justBefore = args.trimStartSec - epsilon;
	const justAfter = args.trimEndSec + epsilon;

	let joinCompressedSec: number | null = null;
	let sourceJustBefore: number | null = null;
	let sourceJustAfter: number | null = null;

	// Find segment ending at/near trim start and segment starting at/near trim end.
	for (const s of relevant) {
		const end = s.sourceEndSec ?? s.sourceStartSec;
		if (
			Math.abs(end - args.trimStartSec) < 0.05 ||
			(end <= args.trimStartSec && end > args.trimStartSec - 0.5)
		) {
			if (end <= args.trimStartSec + 1e-6) {
				joinCompressedSec = s.timelineEndSec;
				sourceJustBefore = end - epsilon;
			}
		}
		if (
			Math.abs(s.sourceStartSec - args.trimEndSec) < 0.05 ||
			s.sourceStartSec >= args.trimEndSec - 1e-6
		) {
			if (s.sourceStartSec >= args.trimEndSec - 1e-6 && s.sourceStartSec < args.trimEndSec + 0.5) {
				sourceJustAfter = s.sourceStartSec + epsilon;
				if (joinCompressedSec == null) joinCompressedSec = s.timelineStartSec;
			}
		}
	}

	// Fallback: programme duration and approximate join from cumulative kept time before trim.
	const programmeDurationSec = relevant.reduce(
		(acc, s) => acc + (s.timelineEndSec - s.timelineStartSec),
		0,
	);
	if (joinCompressedSec == null) {
		let cursor = 0;
		for (const s of relevant) {
			const end = s.sourceEndSec ?? s.sourceStartSec;
			if (end <= args.trimStartSec + 1e-6) {
				cursor = s.timelineEndSec;
			}
		}
		joinCompressedSec = cursor;
		notes.push("join_inferred_from_kept_prefix");
	}

	if (sourceJustBefore == null && justBefore >= 0) sourceJustBefore = justBefore;
	if (sourceJustAfter == null) sourceJustAfter = justAfter;

	if (!removedAbsent) notes.push("BLOCKING:removed_interval_still_mapped");

	return {
		removedAbsent,
		joinCompressedSec,
		sourceJustBefore,
		sourceJustAfter,
		programmeDurationSec,
		segmentsCoveringInterior,
		notes,
	};
}

export function mustSurviveInProgramme(args: {
	after: AxcutDocument;
	assetId: string;
	ranges: Array<{ id: string; startSourceSec: number; endSourceSec: number }>;
}): { ok: boolean; missing: string[]; notes: string[] } {
	const missing: string[] = [];
	const notes: string[] = [];
	for (const r of args.ranges) {
		const mid = (r.startSourceSec + r.endSourceSec) / 2;
		const probes = [r.startSourceSec + 0.01, mid, r.endSourceSec - 0.01].filter(
			(t) => t >= r.startSourceSec && t <= r.endSourceSec,
		);
		const any = probes.some((t) => sourceCoveredByProgramme(args.after, t, args.assetId));
		if (!any) {
			missing.push(r.id);
			notes.push(`must_survive_missing_from_programme:${r.id}`);
		}
	}
	return { ok: missing.length === 0, missing, notes };
}

/** Map compressed time → source time via playback segments. */
export function compressedToSource(
	doc: AxcutDocument,
	compressedSec: number,
	assetId: string,
): number | null {
	const segs = resolvePlaybackSegments(doc.timeline.clips, doc.timeline.trimRanges).filter(
		(s) => s.assetId === assetId,
	);
	for (const s of segs) {
		if (compressedSec >= s.timelineStartSec - 1e-9 && compressedSec < s.timelineEndSec - 1e-9) {
			const offset = compressedSec - s.timelineStartSec;
			return s.sourceStartSec + offset;
		}
		if (Math.abs(compressedSec - s.timelineEndSec) < 1e-6) {
			return (s.sourceEndSec ?? s.sourceStartSec) - 1e-3;
		}
	}
	return null;
}
