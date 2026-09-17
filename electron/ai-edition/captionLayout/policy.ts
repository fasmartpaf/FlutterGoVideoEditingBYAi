/**
 * Caption grouping / reading-speed / font policy constants.
 * Tuned for general screen recordings, not a single fixture.
 */

import type { CaptionGroupingPolicy } from "./types";
import { CAPTION_GROUPING_POLICY_VERSION } from "./types";

export const DEFAULT_CAPTION_GROUPING_POLICY: CaptionGroupingPolicy = {
	version: CAPTION_GROUPING_POLICY_VERSION,
	// Aligns with existing WORD_RUN_BREAK_GAP_SEC (~0.24) in annotationsFromCaptions.
	pauseBreakSec: 0.24,
	minWordsPerCue: 2,
	maxWordsPerCue: 7,
	maxCueDurationSec: 6,
	minCueDurationSec: 0.35,
	// ~CPS band used by common subtitle guidelines (approx).
	maxCharactersPerSecond: 21,
	maxWordsPerSecond: 4,
	minCharactersPerSecond: 4,
	preferredMaxLines: 2,
	hardMaxLines: 3,
	avgGlyphWidthEm: 0.55,
	preferredFontSizePxAt1080: 48,
	minFontSizePxAt1080: 28,
	maxFontSizePxAt1080: 64,
	maxSafeWidthFrac: 0.68,
	orphanWordAvoidance: true,
	punctuationBreakChars: ".!?;:",
};

export function mergeGroupingPolicy(
	partial?: Partial<CaptionGroupingPolicy>,
): CaptionGroupingPolicy {
	return { ...DEFAULT_CAPTION_GROUPING_POLICY, ...partial };
}
