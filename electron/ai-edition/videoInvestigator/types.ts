/**
 * Master Video Investigator Agent V1 — types.
 *
 * Internal cognition only. Never dump this JSON into normal user-facing prose.
 * Does not execute edits. Does not replace Source Story or rewrite the ledger.
 */

import type { ClaimEpistemicState, EvidenceProvenanceRef } from "../temporalEventLedger/types";
import type { VisualChangeClassification } from "../visualEvidence/types";

/** Soft reuse of ledger epistemic labels + investigator stop states. */
export type InvestigationClaimVerdict =
	| ClaimEpistemicState
	| "supported"
	| "insufficient_evidence"
	| "not_verified";

export type InvestigationStopReason =
	| "sufficient_evidence"
	| "budget_exhausted"
	| "no_uncertainty"
	| "deterministic_edit_skip"
	| "no_ledger"
	| "insufficient_evidence";

export type InvestigationToolName =
	| "get_events_in_range"
	| "get_transcript_range"
	| "get_cursor_events"
	| "inspect_frame"
	| "inspect_video_range"
	| "compare_visual_states"
	| "get_evidence_for_event"
	| "inspect_region";

export interface InvestigationBudgets {
	maxSteps: number;
	maxFrameInspections: number;
	maxRangeInspections: number;
	maxRoiInspections: number;
	maxCompareCalls: number;
	maxRepeatedRangeInspections: number;
	/** Soft cap on approximate evidence payload characters in the briefing. */
	maxBriefingChars: number;
}

/** Default V1 budgets — deliberately far below agent recursionLimit: 1000. */
export const DEFAULT_INVESTIGATION_BUDGETS: InvestigationBudgets = {
	maxSteps: 12,
	maxFrameInspections: 4,
	maxRangeInspections: 3,
	maxRoiInspections: 2,
	maxCompareCalls: 3,
	maxRepeatedRangeInspections: 1,
	maxBriefingChars: 3500,
};

export interface InvestigationToolTrace {
	step: number;
	tool: InvestigationToolName;
	args: Record<string, unknown>;
	ok: boolean;
	summary: string;
	ms: number;
}

export interface InvestigationObservation {
	id: string;
	kind:
		| "ledger_events"
		| "transcript"
		| "cursor"
		| "frame"
		| "range_frames"
		| "visual_compare"
		| "roi"
		| "provenance"
		| "note";
	startSourceTimeSec?: number;
	endSourceTimeSec?: number;
	text: string;
	/** Evidence refs when known — never GT. */
	evidence: EvidenceProvenanceRef[];
	/** Optional JPEG path for deeper model attachment (not user-facing). */
	imagePath?: string;
	/** Pixel compare result only — not a semantic conclusion. */
	change?: {
		fromSourceTimeSec: number;
		toSourceTimeSec: number;
		score: number;
		classification: VisualChangeClassification;
	};
}

export interface InvestigationClaim {
	id: string;
	hypothesis: string;
	verdict: InvestigationClaimVerdict;
	rationale: string;
	evidence: EvidenceProvenanceRef[];
}

export interface InvestigationCoverage {
	sourceDurationSec: number;
	rangesInspected: Array<{ startSourceTimeSec: number; endSourceTimeSec: number }>;
	frameTimesSec: number[];
	roiCount: number;
	modalitiesTouched: Array<"speech" | "visual" | "cursor" | "ledger" | "audio_state">;
	/** Honest: absence of observation ≠ event did not happen. */
	absenceIsStrong: boolean;
}

export interface InvestigationMetrics {
	memoryQueryMs: number;
	planningMs: number;
	toolExecutionMs: number;
	verificationMs: number;
	totalInvestigationMs: number;
	frameCacheHits: number;
	frameCacheMisses: number;
	newlyExtractedFrames: number;
	roiExtractMs: number;
	transcriptRetrievalMs: number;
	cursorRetrievalMs: number;
	/** Investigator V1 itself: 0 (deterministic). Main agent call is separate. */
	investigatorModelCalls: 0;
	stepsUsed: number;
	toolCalls: number;
}

export interface InvestigationEvidenceSet {
	version: 1;
	assetId: string;
	timebase: "SOURCE_MEDIA_TIME";
	questionSummary: string;
	focusRange: { startSourceTimeSec: number; endSourceTimeSec: number };
	stopReason: InvestigationStopReason;
	coverage: InvestigationCoverage;
	observations: InvestigationObservation[];
	claims: InvestigationClaim[];
	toolTrace: InvestigationToolTrace[];
	metrics: InvestigationMetrics;
	/** Compact grounded briefing for the existing reasoning layer (not for end users). */
	internalBriefing: string;
	/** Extra frames discovered during investigation for optional attachment. */
	additionalFrames: Array<{
		sourceTimeSec: number;
		imagePath: string;
		width: number;
		height: number;
		byteLength: number;
		note: string;
	}>;
}
