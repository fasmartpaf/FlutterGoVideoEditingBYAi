/**
 * Turn-local speech evidence for the AI editing brain.
 * Source-time grounded. Distinct from visual evidence and from edit decisions.
 */

export const SPEECH_EVIDENCE_STATUSES = [
	"available",
	"no_speech_detected",
	"unavailable",
	"failed",
	"no_audio",
] as const;
export type SpeechEvidenceStatus = (typeof SPEECH_EVIDENCE_STATUSES)[number];

export interface SpeechWord {
	startSourceTimeSec: number;
	endSourceTimeSec: number;
	text: string;
	confidence?: number;
}

export interface SpeechSegment {
	startSourceTimeSec: number;
	endSourceTimeSec: number;
	text: string;
	confidence?: number;
	words?: SpeechWord[];
}

export interface SpeechEvidenceTimings {
	audioProbeMs: number;
	audioExtractMs: number;
	sttMs: number;
	transcriptParseMs: number;
	transcriptCacheMs: number;
	segmentCount: number;
	cacheHit: boolean;
}

export interface SpeechEvidence {
	assetId: string;
	sourceDurationSec?: number;
	segments: SpeechSegment[];
	language?: string;
	status: SpeechEvidenceStatus;
	engine?: string;
	/** Distinct from status — whether a decodable audio stream was found. */
	audioStreamPresent: boolean | null;
	timings: SpeechEvidenceTimings;
	/** Human-safe reason when status is unavailable/failed/no_audio. */
	reason?: string;
}

export interface PreparedSpeechEvidence {
	evidence: SpeechEvidence[];
	/** Document after any newly produced transcripts were merged. */
	documentMutated: boolean;
	timings: SpeechEvidenceTimings;
}
