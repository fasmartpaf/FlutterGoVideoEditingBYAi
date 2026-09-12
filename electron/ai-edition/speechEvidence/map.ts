/**
 * Map Whisper STT output → AxcutTranscript / SpeechEvidence (source-time only).
 */

import type {
	AxcutTranscript,
	AxcutTranscriptSegment,
	AxcutWord,
} from "../../../src/lib/ai-edition/schema";
import type { SttTranscribeResponse } from "../../stt/transcriptionContract";
import { SOURCE_TIMESTAMP_TOLERANCE_SEC } from "../sourceTiming";
import type { SpeechEvidence, SpeechSegment, SpeechWord } from "./types";

const TIME_EPS = 0.051;
/** Align speech bounds with canonical SOURCE_MEDIA_TIME (Whisper may slightly overshoot). */
const DURATION_EPS = SOURCE_TIMESTAMP_TOLERANCE_SEC;
/** Bin size for detecting collapsed DTW word/segment starts. */
const START_BIN_SEC = 0.05;

function near(a: number, b: number): boolean {
	return Math.abs(a - b) <= TIME_EPS;
}

/**
 * Document transcripts that prefer broken Metal DTW words end up as N one-word
 * segments all sharing ~one start. Source Story then windows away the text.
 * Repair by exposing the full spoken text over the media duration.
 */
export function isDegenerateSpeechSegmentTimeline(segments: readonly SpeechSegment[]): boolean {
	const speech = segments.filter((s) => s.text.trim().length > 0);
	if (speech.length < 4) return false;
	const starts = speech.map((s) => s.startSourceTimeSec);
	const uniqueStarts = new Set(starts.map((t) => Math.round(t / START_BIN_SEC))).size;
	const uniqueRatio = uniqueStarts / speech.length;
	const span = Math.max(...starts) - Math.min(...starts);
	if (uniqueRatio < 0.45) return true;
	if (uniqueStarts <= 2 && speech.length >= 8) return true;
	if (span < 1.0 && speech.length >= 8) return true;
	return false;
}

/** Collapse a degenerate timeline into one evidence segment with full text. */
export function repairDegenerateSpeechEvidence(speech: SpeechEvidence): SpeechEvidence {
	if (!isDegenerateSpeechSegmentTimeline(speech.segments)) return speech;
	const text = speech.segments
		.map((s) => s.text.trim())
		.filter(Boolean)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
	if (!text) return speech;
	const end =
		speech.sourceDurationSec != null && speech.sourceDurationSec > 0
			? speech.sourceDurationSec
			: Math.max(...speech.segments.map((s) => s.endSourceTimeSec), 0.1);
	return {
		...speech,
		segments: [
			{
				startSourceTimeSec: 0,
				endSourceTimeSec: Math.max(end, 0.1),
				text,
			},
		],
		reason:
			speech.reason ??
			"word timestamps were degenerate; using full transcript text without per-word times",
	};
}

/** Build AxcutTranscript from STT — source seconds, never virtual timeline. */
export function axcutTranscriptFromSttResponse(input: {
	assetId: string;
	response: SttTranscribeResponse;
	languageFallback?: string;
}): AxcutTranscript {
	const { assetId, response } = input;
	const words: AxcutWord[] = (response.wordSegments ?? []).map((w, i) => ({
		id: `word_${i + 1}`,
		segmentId: "seg_pending",
		startSec: w.startSec,
		endSec: w.endSec,
		text: w.word,
	}));

	const phraseSource =
		response.segments.length > 0
			? response.segments
			: words.length > 0
				? [
						{
							text: words.map((w) => w.text).join(" "),
							startSec: words[0]!.startSec,
							endSec: words[words.length - 1]!.endSec,
						},
					]
				: [];

	const segments: AxcutTranscriptSegment[] = phraseSource.map((phrase, i) => {
		const segId = `seg_${i + 1}`;
		const wordIds = words
			.filter(
				(w) =>
					w.startSec + TIME_EPS >= phrase.startSec &&
					w.endSec - TIME_EPS <= phrase.endSec + TIME_EPS,
			)
			.map((w) => {
				w.segmentId = segId;
				return w.id;
			});
		return {
			id: segId,
			kind: "speech" as const,
			startSec: phrase.startSec,
			endSec: phrase.endSec,
			text: phrase.text.trim(),
			wordIds,
		};
	});

	// Orphan words (outside every phrase window) get their own speech segment.
	for (const w of words) {
		if (w.segmentId !== "seg_pending") continue;
		const segId = `seg_${segments.length + 1}`;
		w.segmentId = segId;
		segments.push({
			id: segId,
			kind: "speech",
			startSec: w.startSec,
			endSec: w.endSec,
			text: w.text,
			wordIds: [w.id],
		});
	}

	return {
		assetId,
		language: response.detectedLanguage || input.languageFallback || "auto",
		segments,
		words,
	};
}

export function speechEvidenceFromAxcutTranscript(input: {
	assetId: string;
	transcript: AxcutTranscript;
	sourceDurationSec?: number;
	status: SpeechEvidence["status"];
	engine?: string;
	audioStreamPresent: boolean | null;
	timings: SpeechEvidence["timings"];
	reason?: string;
}): SpeechEvidence {
	const speechSegs = input.transcript.segments.filter((s) => s.kind === "speech" && s.text.trim());
	const segments: SpeechSegment[] = speechSegs.map((s) => {
		const words: SpeechWord[] = input.transcript.words
			.filter((w) => w.segmentId === s.id)
			.map((w) => ({
				startSourceTimeSec: w.startSec,
				endSourceTimeSec: w.endSec,
				text: w.text,
			}));
		return {
			startSourceTimeSec: s.startSec,
			endSourceTimeSec: s.endSec,
			text: s.text,
			...(words.length > 0 ? { words } : {}),
		};
	});
	const evidence: SpeechEvidence = {
		assetId: input.assetId,
		sourceDurationSec: input.sourceDurationSec,
		segments,
		language: input.transcript.language,
		status: input.status,
		engine: input.engine,
		audioStreamPresent: input.audioStreamPresent,
		timings: input.timings,
		...(input.reason ? { reason: input.reason } : {}),
	};
	return repairDegenerateSpeechEvidence(evidence);
}

/** Segments overlapping [start, end] in source time (inclusive with small eps). */
export function filterSpeechSegmentsBySourceRange(
	segments: SpeechSegment[],
	startSourceTimeSec: number,
	endSourceTimeSec: number,
): SpeechSegment[] {
	const from = Math.min(startSourceTimeSec, endSourceTimeSec);
	const to = Math.max(startSourceTimeSec, endSourceTimeSec);
	return segments.filter(
		(s) => s.endSourceTimeSec + TIME_EPS >= from && s.startSourceTimeSec - TIME_EPS <= to,
	);
}

export function assertSegmentChronology(segments: SpeechSegment[]): string[] {
	const errors: string[] = [];
	for (let i = 0; i < segments.length; i++) {
		const s = segments[i]!;
		if (s.endSourceTimeSec + TIME_EPS < s.startSourceTimeSec) {
			errors.push(`segment ${i} end before start`);
		}
		if (i > 0) {
			const prev = segments[i - 1]!;
			if (
				s.startSourceTimeSec + TIME_EPS < prev.startSourceTimeSec &&
				!near(s.startSourceTimeSec, prev.startSourceTimeSec)
			) {
				errors.push(`segment ${i} out of chronological order`);
			}
		}
	}
	return errors;
}

export function assertSegmentsWithinDuration(
	segments: SpeechSegment[],
	durationSec: number,
	toleranceSec: number = DURATION_EPS,
): string[] {
	const errors: string[] = [];
	for (const s of segments) {
		if (s.startSourceTimeSec < -toleranceSec || s.endSourceTimeSec > durationSec + toleranceSec) {
			errors.push(
				`segment ${s.startSourceTimeSec}–${s.endSourceTimeSec} outside duration ${durationSec} (±${toleranceSec}s)`,
			);
		}
	}
	return errors;
}
