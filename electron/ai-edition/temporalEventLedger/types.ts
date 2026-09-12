/**
 * Temporal Event Ledger V1 — provider-neutral grounded evidence events.
 *
 * SOURCE_MEDIA_TIME only. Deterministic construction from prepared OpenScreen
 * evidence (0 extra LLM calls). Model semantic prose is provenance-tagged as
 * model-derived, never as verified pixel actions.
 */

import type { SpeechEvidenceStatus } from "../speechEvidence/types";
import type { VisualChangeClassification, VisualEvidenceReason } from "../visualEvidence/types";

/** Epistemic state for a claim about the recording. */
export const CLAIM_EPISTEMIC_STATES = [
	"observed",
	"spoken",
	"inferred",
	"verified",
	"contradicted",
	"unknown",
] as const;
export type ClaimEpistemicState = (typeof CLAIM_EPISTEMIC_STATES)[number];

/**
 * Minimal V1 taxonomy — derived from channels we already prepare.
 * Intentionally small; expand only with new sensors.
 */
export const TEMPORAL_EVENT_TYPES = [
	"visual_sample",
	"visual_transition",
	"passive_chrome",
	"frontmost_surface",
	"speech",
	"speech_pause",
	"spoken_correction",
	"cursor_interaction",
	"speech_status",
	"contradiction",
	"uncertain",
	/** Visual Specialist V1 — OCR/readability (observed text ≠ action). */
	"observed_visible_text",
	"observed_ui_state",
	"observed_visual_diff",
] as const;
export type TemporalEventType = (typeof TEMPORAL_EVENT_TYPES)[number];

export const EVIDENCE_MODALITIES = [
	"speech",
	"visual",
	"cursor",
	"audio_state",
	"model_semantic",
] as const;
export type EvidenceModality = (typeof EVIDENCE_MODALITIES)[number];

export interface EvidenceProvenanceRef {
	modality: EvidenceModality;
	/** SOURCE_MEDIA_TIME anchors when known. */
	sourceTimeSec?: number;
	endSourceTimeSec?: number;
	/** Stable ids from upstream modules when available. */
	speechSegmentId?: string;
	frameSourceTimeSec?: number;
	frameReason?: VisualEvidenceReason;
	frameImagePath?: string;
	changeFromSourceTimeSec?: number;
	changeToSourceTimeSec?: number;
	changeClassification?: VisualChangeClassification;
	cursorTimeSec?: number;
	cursorInteractionType?: string;
	/** Model-derived observation provenance (not deterministic pixels). */
	modelDerived?: boolean;
	note?: string;
}

export interface TemporalClaim {
	id: string;
	text: string;
	epistemic: ClaimEpistemicState;
	/** Provenance supporting this claim. */
	evidence: EvidenceProvenanceRef[];
}

export interface TemporalEvent {
	id: string;
	assetId: string;
	/** Inclusive-ish SOURCE_MEDIA_TIME window. */
	startSourceTimeSec: number;
	endSourceTimeSec: number;
	type: TemporalEventType;
	modalities: EvidenceModality[];
	/**
	 * When true, start/end are sample bounds (e.g. change between frame A and B),
	 * not an exact action onset.
	 */
	temporallyUncertain?: boolean;
	summary: string;
	claims: TemporalClaim[];
	evidence: EvidenceProvenanceRef[];
	confidence: "high" | "medium" | "low";
}

export interface TemporalEventLedgerMeta {
	assetId: string;
	sourceDurationSec: number;
	timebase: "SOURCE_MEDIA_TIME";
	speechStatus?: SpeechEvidenceStatus | "not_requested" | "none";
	builtAtIso: string;
	constructionMs: number;
	/** Always 0 for V1 — ledger is deterministic. */
	additionalModelCalls: 0;
	eventCount: number;
	claimCount: number;
	evidenceRefCount: number;
}

export interface TemporalEventLedger {
	meta: TemporalEventLedgerMeta;
	events: TemporalEvent[];
}

export interface BuildTemporalEventLedgerInput {
	assetId: string;
	sourceDurationSec: number;
	speech?: {
		status: SpeechEvidenceStatus | "not_requested" | "none";
		segments: Array<{
			id?: string;
			startSourceTimeSec: number;
			endSourceTimeSec: number;
			text: string;
		}>;
	};
	frames?: Array<{
		sourceTimeSec: number;
		reason: VisualEvidenceReason;
		imagePath?: string;
	}>;
	changes?: Array<{
		fromSourceTimeSec: number;
		toSourceTimeSec: number;
		classification: VisualChangeClassification;
		score?: number;
	}>;
	cursorInteractions?: Array<{
		sourceTimeSec: number;
		interactionType?: string;
	}>;
	/**
	 * Optional turn-local model semantic grounding. Claims from this layer are
	 * tagged modelDerived / observed|inferred — never auto-verified actions.
	 */
	semantic?: {
		observations?: Array<{
			sourceTimeSec: number;
			frameSummary?: string;
			frontmostSurface?: { name: string; kind?: string };
			backgroundSurfaces?: Array<{ name: string; role?: string }>;
			observed?: string[];
			inferred?: string[];
		}>;
	};
}
