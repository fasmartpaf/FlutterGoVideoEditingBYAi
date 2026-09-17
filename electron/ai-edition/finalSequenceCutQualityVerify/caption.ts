/**
 * Caption continuity across programme joins.
 */

import { getCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { mapSourceSpanThroughDocument, runCaptionLayoutForDocument } from "../captionLayout";
import type { JoinModalityResult, ProgrammeJoinV1 } from "./types";

export function verifyJoinCaption(args: {
	document: AxcutDocument;
	join: ProgrammeJoinV1;
	aspectValue?: number;
}): JoinModalityResult {
	const t0 = Date.now();
	const notes: string[] = [];
	const blocking: string[] = [];
	const warnings: string[] = [];
	const evidenceRefs: string[] = [];
	const aspect = args.aspectValue ?? 16 / 9;

	if (!getCaptionSettings(args.document, aspect).enabled) {
		return {
			outcome: "NOT_APPLICABLE",
			blockingReasons: [],
			warnings: [],
			evidenceRefs: [],
			notes: ["captions_disabled"],
			latencyMs: Date.now() - t0,
		};
	}

	const assetId = args.join.leftAssetId;
	const words = args.document.transcripts.find((t) => t.assetId === assetId)?.words ?? [];
	if (words.length === 0) {
		return {
			outcome: "INSUFFICIENT_EVIDENCE",
			blockingReasons: [],
			warnings: ["no_transcript_words"],
			evidenceRefs: [],
			notes: ["caption_check_needs_transcript"],
			latencyMs: Date.now() - t0,
		};
	}

	const { layout } = runCaptionLayoutForDocument({
		document: args.document,
		assetId,
		aspectValue: aspect,
		useCache: true,
	});

	const joinT = args.join.programmeTimeSec;
	const crossing = layout.cues.filter(
		(c) => !c.omitted && c.programmeStartSec < joinT && c.programmeEndSec > joinT,
	);
	const cueIds = crossing.map((c) => c.id);
	args.join.captionContext = { cueIdsCrossing: cueIds, notes: [] };

	// Cue must not claim source words that were removed by a trim-created join gap.
	if (args.join.cause === "TRIM_CREATED") {
		const gapStart = args.join.leftSourceRange.endSec;
		const gapEnd = args.join.rightSourceRange.startSec;
		for (const c of crossing) {
			const midSrc = (c.sourceStartSec + c.sourceEndSec) / 2;
			if (midSrc > gapStart && midSrc < gapEnd) {
				blocking.push(`caption_over_removed_source:${c.id}`);
				evidenceRefs.push(`cue:${c.id}`);
			}
		}
		// Words fully inside removed gap must not appear as surviving cues midpoints
		for (const w of words) {
			if (w.startSec >= gapStart && w.endSec <= gapEnd) {
				const mapped = mapSourceSpanThroughDocument(args.document, assetId, w.startSec, w.endSec);
				if (mapped.length > 0) {
					warnings.push(`removed_word_still_mapped:${w.id}`);
				}
			}
		}
	}

	// Programme cue timing monotonicity
	let prevEnd = -1;
	for (const c of layout.cues.filter((x) => !x.omitted)) {
		if (c.programmeStartSec + 1e-6 < prevEnd) {
			warnings.push(`non_monotonic_cue:${c.id}`);
		}
		if (c.programmeEndSec < c.programmeStartSec) {
			blocking.push(`inverted_cue_timing:${c.id}`);
		}
		prevEnd = c.programmeEndSec;
		evidenceRefs.push(`cue:${c.id}`);
	}

	// Duplicate cue ids
	const ids = layout.cues.map((c) => c.id);
	if (new Set(ids).size !== ids.length) {
		blocking.push("duplicate_cue_ids");
	}

	notes.push(`cues=${layout.cues.length}`, `crossing=${crossing.length}`);
	args.join.captionContext.notes = notes;

	const outcome = blocking.length > 0 ? "FAIL" : warnings.length > 0 ? "WARNING" : "PASS";

	return {
		outcome,
		blockingReasons: blocking,
		warnings,
		evidenceRefs: [...new Set(evidenceRefs)].slice(0, 24),
		notes,
		latencyMs: Date.now() - t0,
		metrics: { cueCount: layout.cues.length, crossingCount: crossing.length },
	};
}
