/**
 * Programme candidate mapping — recomputed after timeline mutation.
 * SOURCE silence analysis stays cached; this layer checks trim feasibility
 * against current trimRanges / playback spans.
 */

import { resolvePlaybackSegments } from "../../../src/lib/ai-edition/document/timeline";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { DeadAirCandidateV1 } from "./types";

export interface ProgrammeMappingResult {
	ok: boolean;
	reason?: string;
	/** True when proposed trim SOURCE range still sits inside a kept span. */
	trimInsideKeptSpan: boolean;
}

function spansContain(
	start: number,
	end: number,
	spans: Array<{ sourceStartSec: number; sourceEndSec: number; assetId: string }>,
	assetId: string,
): boolean {
	for (const s of spans) {
		if (s.assetId !== assetId) continue;
		if (start >= s.sourceStartSec - 1e-4 && end <= s.sourceEndSec + 1e-4) return true;
	}
	return false;
}

export function mapCandidateToProgramme(
	document: AxcutDocument,
	candidate: DeadAirCandidateV1,
): ProgrammeMappingResult {
	const trim = candidate.proposedTrimRange;
	if (!trim) {
		return { ok: false, reason: "no_proposed_trim", trimInsideKeptSpan: false };
	}
	const segs = resolvePlaybackSegments(document.timeline.clips, document.timeline.trimRanges);
	const spans = segs.map((s) => ({
		sourceStartSec: s.sourceStartSec,
		sourceEndSec: s.sourceEndSec ?? s.sourceStartSec,
		assetId: s.assetId,
	}));
	const inside = spansContain(trim.startSec, trim.endSec, spans, candidate.assetId);
	if (!inside) {
		return {
			ok: false,
			reason: "insufficient_programme_mapping_or_already_removed",
			trimInsideKeptSpan: false,
		};
	}
	return { ok: true, trimInsideKeptSpan: true };
}

export function filterCandidatesByProgrammeMapping(
	document: AxcutDocument,
	candidates: DeadAirCandidateV1[],
): DeadAirCandidateV1[] {
	return candidates.map((c) => {
		if (!c.safeToPropose || !c.proposedTrimRange) return c;
		const map = mapCandidateToProgramme(document, c);
		if (map.ok) return c;
		return {
			...c,
			safeToPropose: false,
			proposedTrimRange: null,
			resultingRemovedDurationSec: 0,
			blockingReasons: [...c.blockingReasons, map.reason ?? "programme_mapping_failed"],
		};
	});
}
