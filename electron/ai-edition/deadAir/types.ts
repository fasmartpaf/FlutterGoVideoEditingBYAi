/**
 * Local Dead-Air Shorten V1 — types.
 * Time domain: SOURCE_MEDIA_TIME unless a field is explicitly programme-mapped.
 */

import type { VisualActivityAssessment, VisualActivityState } from "./visualActivityTypes";
import { VISUAL_SAFETY_VERSION } from "./visualActivityTypes";

export const LOCAL_DEAD_AIR_V1_PROVIDER_ID = "CURRENT_OPENSCREEN_LOCAL_DEAD_AIR_V1" as const;

export type AudioState =
	| "present"
	| "absent"
	| "probe_failed"
	| "ffmpeg_unavailable"
	| "cancelled"
	| "timeout"
	| "malformed";

export type SilenceClassification =
	| "INTER_SENTENCE_PAUSE"
	| "POSSIBLE_DEAD_AIR"
	| "LEADING_SILENCE"
	| "TRAILING_SILENCE"
	| "WITHIN_PROTECTED_CONTEXT"
	| "TOO_SHORT"
	| "VISUAL_ACTIVITY_PRESENT"
	| "VISUAL_ACTIVITY_UNCERTAIN"
	| "ALREADY_REMOVED"
	| "UNKNOWN";

export type DeadAirConfidence = "high" | "medium" | "low" | "none";

export interface SourceTimeRange {
	timebase: "SOURCE_MEDIA_TIME";
	startSec: number;
	endSec: number;
}

export interface SilenceInterval {
	startSec: number;
	endSec: number;
	durationSec: number;
	source: "ffmpeg_silencedetect";
}

export interface SilenceDetectorParameters {
	noiseThresholdDb: number;
	minimumSilenceDurationSec: number;
	timeoutMs: number;
}

export interface SilenceDetectorResult {
	assetId: string;
	mediaPath: string;
	durationSec: number | null;
	audioState: AudioState;
	intervals: SilenceInterval[];
	ffmpegVersion: string | null;
	parameters: SilenceDetectorParameters;
	latencyMs: number;
	cacheHit: boolean;
	stderrExcerpt?: string;
	error?: string;
}

export interface SpeechAnchorRef {
	kind: "speech_segment" | "speech_word" | "transcript_segment" | "none";
	id?: string;
	startSourceTimeSec?: number;
	endSourceTimeSec?: number;
	text?: string;
}

export interface VisualActivityHit {
	kind: "cursor_interaction" | "ledger_event" | "marked_story_event";
	sourceTimeSec: number;
	note: string;
}

export interface DeadAirCandidateV1 {
	id: string;
	assetId: string;
	silenceRange: SourceTimeRange;
	proposedTrimRange: SourceTimeRange | null;
	silenceDurationSec: number;
	resultingRemovedDurationSec: number;
	classification: SilenceClassification;
	confidence: DeadAirConfidence;
	evidenceRefs: Array<{ kind: string; id: string; note: string }>;
	speechBoundaryState: {
		before: SpeechAnchorRef;
		after: SpeechAnchorRef;
		assessedRisk?: string;
		blocking: boolean;
	};
	paddingBeforeSec: number;
	paddingAfterSec: number;
	targetPauseKeptSec: number;
	preserveConstraints: string[];
	safeToPropose: boolean;
	blockingReasons: string[];
	/** @deprecated Prefer visualActivityAssessment.events — kept for V1 compat. */
	visualActivity: VisualActivityHit[];
	visualActivityState: VisualActivityState;
	visualEvidenceRefs: Array<{ kind: string; id: string; note: string }>;
	visualBlockingReasons: string[];
	visualSafetyVersion: typeof VISUAL_SAFETY_VERSION;
	visualActivityAssessment?: VisualActivityAssessment;
	warnings: string[];
}

export interface DeadAirAnalysisBundle {
	version: 1;
	providerId: typeof LOCAL_DEAD_AIR_V1_PROVIDER_ID;
	detector: SilenceDetectorResult;
	candidates: DeadAirCandidateV1[];
	metrics: {
		silenceIntervalCount: number;
		candidateCount: number;
		safeCandidateCount: number;
		blockedCandidateCount: number;
		classifyMs: number;
		programmeRemapMs: number;
	};
}
