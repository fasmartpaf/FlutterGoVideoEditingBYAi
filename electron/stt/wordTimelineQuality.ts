/**
 * Detect collapsed/broken word timelines from whisper.cpp DTW (especially Metal).
 *
 * Phrase t0/t1 can be correct while every word shares one t_dtw (e.g. all at
 * 23.92s). Preferring those words over phrases then hides almost all speech from
 * Source Story windowing. Callers should drop wordSegments and keep phrases.
 */

import type { SttPhraseSegment, SttWordSegment } from "./transcriptionContract";

/** Round starts so near-identical DTW pileups count as one unique time. */
const START_BIN_SEC = 0.05;

/**
 * True when word timestamps are too collapsed to trust for word-level captions
 * or evidence windowing. Phrase segments (when present) are the fallback.
 */
export function isDegenerateWordTimeline(
	words: readonly SttWordSegment[],
	phrases?: readonly SttPhraseSegment[],
): boolean {
	if (words.length < 4) return false;

	const starts = words.map((w) => w.startSec);
	const minStart = Math.min(...starts);
	const maxStart = Math.max(...starts);
	const uniqueStarts = new Set(starts.map((t) => Math.round(t / START_BIN_SEC))).size;
	const uniqueRatio = uniqueStarts / words.length;

	const zeroOrMinDur = words.filter((w) => w.endSec - w.startSec <= 0.025).length;
	const zeroRatio = zeroOrMinDur / words.length;

	// Classic collapse: almost every word shares one start (this recording: 52/52).
	if (uniqueRatio < 0.45) return true;
	if (uniqueStarts <= 2 && words.length >= 8) return true;

	// Many zero-duration words with little start diversity (Metal DTW pileups).
	if (zeroRatio >= 0.4 && uniqueRatio < 0.7) return true;

	// Word start span tiny vs phrase span — DTW pinned while phrases span the clip.
	if (phrases && phrases.length > 0) {
		const phraseStart = Math.min(...phrases.map((p) => p.startSec));
		const phraseEnd = Math.max(...phrases.map((p) => p.endSec));
		const phraseSpan = phraseEnd - phraseStart;
		const wordSpan = maxStart - minStart;
		if (phraseSpan >= 3 && wordSpan < phraseSpan * 0.25 && uniqueRatio < 0.7) {
			return true;
		}
	}

	return false;
}
