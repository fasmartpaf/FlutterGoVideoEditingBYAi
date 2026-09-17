/**
 * Programme ↔ source mapping for semantic WHERE.
 * VisualAnalysisV1 uses SOURCE_MEDIA_TIME; Zoom / Chat use programme time.
 * Speed regions are not modelled by resolvePlaybackSegments — block WHERE there.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import {
	mapSourceInstantToProgramme,
	mapSourceRangeToProgramme,
} from "../visualAnalysis/programmeMap";
import { programmePointToSourceSec } from "./directTrim";
import type { VisualChangeIntervalLite } from "./semanticEventResolve";

export type SemanticTimeMapStatus = "ok" | "unmapped" | "removed" | "partial" | "speed_blocked";

export interface MappedVisualInterval {
	programme: VisualChangeIntervalLite;
	source: VisualChangeIntervalLite;
	status: SemanticTimeMapStatus;
}

function speedRangeBounds(s: {
	startSec?: number;
	endSec?: number;
	startMs?: number;
	endMs?: number;
}): { start: number; end: number } | null {
	const start =
		typeof s.startSec === "number" && Number.isFinite(s.startSec)
			? s.startSec
			: typeof s.startMs === "number" && Number.isFinite(s.startMs)
				? s.startMs / 1000
				: NaN;
	const end =
		typeof s.endSec === "number" && Number.isFinite(s.endSec)
			? s.endSec
			: typeof s.endMs === "number" && Number.isFinite(s.endMs)
				? s.endMs / 1000
				: NaN;
	if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return null;
	return { start, end };
}

export function speedOverlapsProgramme(
	doc: AxcutDocument,
	startSec: number,
	endSec: number,
): boolean {
	const candidates: Array<{
		startSec?: number;
		endSec?: number;
		startMs?: number;
		endMs?: number;
	}> = [];
	for (const s of doc.timeline?.speedRanges ?? []) {
		candidates.push(s);
	}
	const legacy = doc.legacyEditor as { speedRegions?: Array<Record<string, unknown>> } | null;
	for (const s of legacy?.speedRegions ?? []) {
		candidates.push(s as { startSec?: number; endSec?: number; startMs?: number; endMs?: number });
	}
	// Some documents historically exposed top-level speedRanges (typed loosely).
	for (const s of (doc as { speedRanges?: Array<Record<string, unknown>> }).speedRanges ?? []) {
		candidates.push(s as { startSec?: number; endSec?: number; startMs?: number; endMs?: number });
	}
	for (const s of candidates) {
		const b = speedRangeBounds(s);
		if (!b) continue;
		if (b.end > startSec && b.start < endSec) return true;
	}
	return false;
}

/** Map a VisualAnalysis source-time interval into programme time. */
export function mapVisualIntervalToProgramme(args: {
	document: AxcutDocument;
	assetId: string;
	sourceInterval: VisualChangeIntervalLite;
}): MappedVisualInterval {
	const src = args.sourceInterval;
	const mapped = mapSourceRangeToProgramme({
		document: args.document,
		assetId: args.assetId,
		startSec: src.startSec,
		endSec: src.endSec,
	});
	if (mapped.status === "removed" || mapped.programmeRanges.length === 0) {
		return { source: src, programme: src, status: "removed" };
	}
	const pr = mapped.programmeRanges[0]!;
	const programme: VisualChangeIntervalLite = {
		startSec: pr.startSec,
		endSec: Math.max(pr.endSec, pr.startSec + 0.05),
		level: src.level,
		sourceSec: (src.startSec + src.endSec) / 2,
	};
	if (speedOverlapsProgramme(args.document, programme.startSec, programme.endSec)) {
		return { source: src, programme, status: "speed_blocked" };
	}
	return {
		source: src,
		programme,
		status: mapped.status === "present" ? "ok" : "partial",
	};
}

export function mapSourceInstantToProgrammeSafe(args: {
	document: AxcutDocument;
	assetId: string;
	sourceTimeSec: number;
}): { status: SemanticTimeMapStatus; programmeTimeSec: number | null } {
	const r = mapSourceInstantToProgramme(args);
	if (r.status !== "present" || r.programmeTimeSec == null) {
		return { status: "removed", programmeTimeSec: null };
	}
	if (speedOverlapsProgramme(args.document, r.programmeTimeSec - 0.05, r.programmeTimeSec + 0.05)) {
		return { status: "speed_blocked", programmeTimeSec: r.programmeTimeSec };
	}
	return { status: "ok", programmeTimeSec: r.programmeTimeSec };
}

export function mapProgrammeInstantToSourceSafe(args: {
	document: AxcutDocument;
	programmeTimeSec: number;
}): { status: SemanticTimeMapStatus; sourceTimeSec: number | null } {
	if (
		speedOverlapsProgramme(
			args.document,
			args.programmeTimeSec - 0.05,
			args.programmeTimeSec + 0.05,
		)
	) {
		return { status: "speed_blocked", sourceTimeSec: null };
	}
	const src = programmePointToSourceSec(args.document, args.programmeTimeSec);
	if (src == null) return { status: "unmapped", sourceTimeSec: null };
	return { status: "ok", sourceTimeSec: src };
}
