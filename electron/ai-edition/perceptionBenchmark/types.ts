/**
 * Provider-neutral perception benchmark types.
 * Ground truth is separate from predictions. No Target Story / edit planning.
 */

export type EventModality = "visual" | "speech" | "cursor" | "audio_nonspeech" | "multimodal";

export type EventImportance = "critical" | "important" | "supporting";

export type DetectionVerdict = "DETECTED_CORRECTLY" | "PARTIALLY_DETECTED" | "MISSED" | "INCORRECT";

export type HallucinationKind =
	| "UI_HALLUCINATION"
	| "SPEECH_HALLUCINATION"
	| "INTENT_HALLUCINATION"
	| "EMOTION_HALLUCINATION"
	| "TEMPORAL_HALLUCINATION"
	| "OTHER";

export interface GroundTruthEvent {
	id: string;
	startSec: number;
	endSec: number;
	modality: EventModality;
	/** What a correct system should recognize. */
	expectedMeaning: string;
	importance: EventImportance;
	/** Optional keywords/phrases that support DETECTED / PARTIAL matching. */
	matchHints?: string[];
}

export interface GroundTruthMustNotClaim {
	id: string;
	kind: HallucinationKind;
	description: string;
	/** Patterns that indicate the forbidden claim appeared. */
	forbiddenPatterns: string[];
}

export interface PerceptionGroundTruth {
	caseId: string;
	title: string;
	/** Absolute or repo-relative media path; null if RECORDING_REQUIRED. */
	mediaPath: string | null;
	cursorPath?: string | null;
	webcamPath?: string | null;
	durationSec?: number;
	status: "READY" | "PARTIAL" | "RECORDING_REQUIRED";
	recordingScript?: string;
	notes?: string;
	events: GroundTruthEvent[];
	mustNotClaim: GroundTruthMustNotClaim[];
	/** Optional human reference transcript lines (not Whisper output). */
	referenceSpeech?: Array<{
		startSec: number;
		endSec: number;
		text: string;
	}>;
}

export interface BenchmarkObservation {
	startSec?: number;
	endSec?: number;
	timeSec?: number;
	modality: EventModality | "unknown";
	description: string;
	confidence?: string;
	source: "speech" | "visual_change" | "semantic" | "source_story" | "cursor" | "user_text";
}

export interface PerceptionRunEvidence {
	selectedFrameTimestamps: number[];
	changeScores: Array<{
		fromSec: number;
		toSec: number;
		score: number;
		classification: string;
	}>;
	attachedFrameCount: number;
	speechSegments: Array<{
		startSec: number;
		endSec: number;
		text: string;
	}>;
	speechStatus?: string;
	cursorEventCount: number;
	cursorNonMoveCount: number;
	rawSemanticText?: string;
	validatedSemanticSummary?: string;
	sourceStorySummary?: string;
	sourceStoryBeats?: Array<{
		id: string;
		startSec: number;
		endSec: number;
		purpose: string;
		summary: string;
	}>;
	finalUserText?: string;
}

export interface PerceptionRunLatency {
	mediaProbeMs: number;
	visualPreparationMs: number;
	speechPreparationMs: number;
	cursorPreparationMs: number;
	modelLatencyMs: number | null;
	totalTurnMs: number;
	cacheState: "cold" | "warm" | "mixed" | "unknown";
	model: string | null;
	provider: string;
}

export interface EventScore {
	eventId: string;
	verdict: DetectionVerdict;
	gtStartSec: number;
	gtEndSec: number;
	predictedTimeSec?: number;
	predictedStartSec?: number;
	predictedEndSec?: number;
	absTimingErrorSec?: number;
	notes: string;
}

export interface HallucinationHit {
	mustNotId: string;
	kind: HallucinationKind;
	matchedText: string;
}

export interface PerceptionBenchmarkResult {
	caseId: string;
	providerRunId: string;
	provider: string;
	ranAt: string;
	groundTruthReady: boolean;
	mediaReady: boolean;
	evidence: PerceptionRunEvidence;
	observations: BenchmarkObservation[];
	eventScores: EventScore[];
	importantEventRecall: {
		criticalImportantTotal: number;
		detected: number;
		partial: number;
		missed: number;
		incorrect: number;
		recall: number | null;
	};
	hallucinations: HallucinationHit[];
	speechEval?: {
		semanticCorrect: boolean | null;
		technicalNameErrors: string[];
		correctionDetected: boolean | null;
		pauseDetected: boolean | null;
		hallucinatedSpeech: boolean;
		notes: string;
	};
	visualEval?: {
		notes: string;
		appStateChange: DetectionVerdict | "N/A";
		briefUiEvent: DetectionVerdict | "N/A";
		smallText: DetectionVerdict | "N/A";
	};
	multimodalEval?: {
		notes: string;
		correlated: boolean | null;
	};
	latency: PerceptionRunLatency;
	/** Opaque provider-specific dump for diagnosis (no secrets). */
	providerRaw?: unknown;
}
