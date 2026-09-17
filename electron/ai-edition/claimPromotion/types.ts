/**
 * Claim Promotion V1 — types.
 * Sits above Temporal Event Ledger. Does not invent perception.
 */

import type { EvidenceProvenanceRef } from "../temporalEventLedger/types";

/** Provider id for A/B — does not overwrite locked baselines. */
export const CLAIM_PROMOTION_PROVIDER_ID = "CURRENT_OPENSCREEN_CLAIM_PROMOTION_V1";

/**
 * Promotion lifecycle (extends ledger epistemics with explicit SUPPORTED).
 * Maps to timecode-agent idea of hypothesized→verified without replacing ledger enums.
 */
export const CLAIM_PROMOTION_STATUSES = [
	"observed",
	"spoken",
	"inferred",
	"supported",
	"verified",
	"contradicted",
	"unknown",
] as const;
export type ClaimPromotionStatus = (typeof CLAIM_PROMOTION_STATUSES)[number];

/**
 * Verification level — adapt of timecode-agent VerificationLevel idea
 * (unsupported / single modality / cross-modal), plus multi-evidence.
 */
export const CLAIM_VERIFICATION_LEVELS = [
	"unsupported",
	"single_source",
	"multi_evidence",
	"cross_modal",
	"contradicted",
] as const;
export type ClaimVerificationLevel = (typeof CLAIM_VERIFICATION_LEVELS)[number];

export type ClaimKind =
	| "visible_text"
	| "temporary_ui_visibility"
	| "passive_app_visibility"
	| "ui_state_visibility"
	| "speech_assertion"
	| "spoken_correction"
	| "visual_change"
	| "user_action"
	| "navigation_action"
	| "other";

export interface ClaimProvenanceLink {
	/** Stable id of supporting artifact (event, observation, OCR result, crop). */
	evidenceId: string;
	kind:
		| "ledger_event"
		| "ledger_claim"
		| "investigation_observation"
		| "visual_observation"
		| "ocr_result"
		| "source_crop"
		| "speech_segment"
		| "cursor_event"
		| "visual_change";
	sourceTimeSec?: number;
	endSourceTimeSec?: number;
	note?: string;
	/** Optional raw refs reused from ledger. */
	refs?: EvidenceProvenanceRef[];
}

export interface ClaimHistoryEntry {
	atIso: string;
	from: ClaimPromotionStatus | null;
	to: ClaimPromotionStatus;
	reason: string;
	/** Rule id that caused the transition. */
	ruleId: string;
	evidenceIds: string[];
}

export interface PromotedClaim {
	id: string;
	/** Conservative identity key for dedupe. */
	identityKey: string;
	assetId: string;
	kind: ClaimKind;
	/** Human-readable hypothesis (internal). */
	text: string;
	/** Normalized subject (e.g. "upwork", "restart recording"). */
	subject?: string;
	startSourceTimeSec: number;
	endSourceTimeSec: number;
	status: ClaimPromotionStatus;
	verificationLevel: ClaimVerificationLevel;
	/** Explicit: visible text / speech must not silently become this. */
	isActionClaim: boolean;
	provenance: ClaimProvenanceLink[];
	history: ClaimHistoryEntry[];
	/** When false, claim was created but not deep-verified this turn. */
	lazyVerified: boolean;
}

export interface ClaimPromotionMetrics {
	claimsCreated: number;
	claimsAfterDedupe: number;
	promotions: number;
	demotions: number;
	lazySkipped: number;
	lazyEvaluated: number;
	identityMs: number;
	promotionMs: number;
	totalMs: number;
	additionalModelCalls: 0;
	providerId: typeof CLAIM_PROMOTION_PROVIDER_ID;
}

export interface ClaimPromotionSet {
	version: 1;
	assetId: string;
	timebase: "SOURCE_MEDIA_TIME";
	claims: PromotedClaim[];
	metrics: ClaimPromotionMetrics;
	/** Compact internal notes for investigator (not user-facing). */
	internalNotes: string[];
}

export interface SourceStoryClaimBridge {
	promotedSummaries: string[];
	unresolvedSummaries: string[];
	contradictionSummaries: string[];
}
