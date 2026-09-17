/**
 * High-level: transcript words → layout → proposal (+ optional cache).
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { documentHasManualOrLegacyCaptions } from "./apply";
import {
	buildCaptionLayoutCacheKey,
	fingerprintProtectedRegions,
	readCaptionLayoutCache,
	writeCaptionLayoutCache,
} from "./cache";
import { fingerprintWords, layoutCaptions } from "./layout";
import { mapSourceSpanThroughDocument, wordsSurvivingTrims } from "./programmeMap";
import { buildCaptionLayoutProposal, type CaptionLayoutProposal } from "./proposal";
import {
	CAPTION_GROUPING_POLICY_VERSION,
	type CaptionLayoutResult,
	type CaptionProtectedRegion,
	type CaptionWordSpan,
} from "./types";

export function wordsFromDocument(doc: AxcutDocument, assetId: string): CaptionWordSpan[] {
	const transcript = doc.transcripts.find((t) => t.assetId === assetId);
	if (!transcript) return [];
	return transcript.words
		.filter((w) => w.text.trim().length > 0)
		.map((w) => ({
			id: w.id,
			text: w.text,
			sourceStartSec: w.startSec,
			sourceEndSec: w.endSec,
			source: w.source,
		}));
}

/** Drop words whose source span is fully removed by trims / missing from programme. */
export function survivingWordsFromDocument(doc: AxcutDocument, assetId: string): CaptionWordSpan[] {
	const all = wordsFromDocument(doc, assetId);
	const survive = wordsSurvivingTrims(doc, assetId, all);
	return all.filter((_, i) => survive[i]);
}

export function runCaptionLayoutForDocument(args: {
	document: AxcutDocument;
	assetId: string;
	aspectValue: number;
	protectedRegions?: CaptionProtectedRegion[];
	useCache?: boolean;
}): { layout: CaptionLayoutResult; proposal: CaptionLayoutProposal } {
	const words = survivingWordsFromDocument(args.document, args.assetId);
	const protectedRegions = args.protectedRegions ?? [];
	const transcriptFp = fingerprintWords(words);
	const programmeFp = `${args.document.timeline.clips.length}:${args.document.timeline.trimRanges.length}:${JSON.stringify((args.document.legacyEditor as Record<string, unknown>)?.speedRegions ?? [])}`;
	const cacheKey = buildCaptionLayoutCacheKey({
		transcriptFingerprint: transcriptFp,
		programmeFingerprint: programmeFp,
		aspectValue: args.aspectValue,
		policyVersion: CAPTION_GROUPING_POLICY_VERSION,
		protectedRegionFingerprint: fingerprintProtectedRegions(protectedRegions),
	});

	if (args.useCache !== false) {
		const hit = readCaptionLayoutCache(cacheKey);
		if (hit) {
			const proposal = buildCaptionLayoutProposal(hit);
			return { layout: hit, proposal };
		}
	}

	const layout = layoutCaptions({
		assetId: args.assetId,
		aspectValue: args.aspectValue,
		words,
		protectedRegions,
		preferPlacementContinuity: true,
		manualCaptionIds: documentHasManualOrLegacyCaptions(args.document)
			? ["manual_or_legacy_present"]
			: [],
		mapSourceSpanToProgramme: (start, end) =>
			mapSourceSpanThroughDocument(args.document, args.assetId, start, end),
	});

	if (args.useCache !== false) {
		writeCaptionLayoutCache(cacheKey, layout);
	}

	return { layout, proposal: buildCaptionLayoutProposal(layout) };
}
