/**
 * Source Story V2 — evidence-grounded types.
 * Truth comes from Claim Promotion / Ledger / Investigator — not free LLM inference.
 */

export const SOURCE_STORY_V2_PROVIDER_ID = "CURRENT_OPENSCREEN_SOURCE_STORY_V2";

export const SOURCE_STORY_EPISTEMIC = [
	"observed",
	"spoken",
	"supported",
	"verified",
	"contradicted",
	"unknown",
] as const;
export type SourceStoryEpistemic = (typeof SOURCE_STORY_EPISTEMIC)[number];

export type StoryItemKind =
	| "story_fact"
	| "context"
	| "spoken_intention"
	| "spoken_correction"
	| "visually_performed_action"
	| "unresolved_action"
	| "contradiction"
	| "uncertainty";

export interface SourceStoryEvidenceRef {
	claimIds?: string[];
	ledgerEventIds?: string[];
	speechSegmentIds?: string[];
	observationIds?: string[];
	ocrIds?: string[];
	cropIds?: string[];
	investigationClaimIds?: string[];
	investigationObservationIds?: string[];
}

/** Compact claim/event reference for the evidence input (no full payloads). */
export interface SourceStoryClaimRef {
	id: string;
	kind: string;
	text: string;
	subject?: string;
	status: SourceStoryEpistemic | string;
	verificationLevel?: string;
	isActionClaim: boolean;
	startSourceTimeSec: number;
	endSourceTimeSec: number;
	evidenceIds: string[];
}

export interface SourceStoryLedgerEventRef {
	id: string;
	type: string;
	summary: string;
	startSourceTimeSec: number;
	endSourceTimeSec: number;
}

export interface SourceStorySpeechRef {
	id: string;
	startSourceTimeSec: number;
	endSourceTimeSec: number;
	text: string;
}

export interface SourceStoryVisualChangeRef {
	fromSourceTimeSec: number;
	toSourceTimeSec: number;
	classification: "minimal" | "moderate" | "significant";
}

export interface SourceStoryInvestigationRef {
	observationIds: string[];
	claimIds: string[];
	focusStart: number;
	focusEnd: number;
	stopReason?: string;
}

export interface SourceStoryEvidenceInput {
	version: 2;
	assetId: string;
	sourceDurationSec: number;
	speechStatus:
		| "available"
		| "no_speech_detected"
		| "unavailable"
		| "failed"
		| "no_audio"
		| "not_requested"
		| "none";
	promotedClaims: SourceStoryClaimRef[];
	unresolvedClaims: SourceStoryClaimRef[];
	contradictions: SourceStoryClaimRef[];
	ledgerEvents: SourceStoryLedgerEventRef[];
	speechSegments: SourceStorySpeechRef[];
	visualTimes: number[];
	visualChanges: SourceStoryVisualChangeRef[];
	cursorEventTimes: number[];
	investigation?: SourceStoryInvestigationRef | null;
	/** Metrics for the report. */
	metrics: {
		promotedCount: number;
		unresolvedCount: number;
		contradictionCount: number;
		ledgerEventCount: number;
		investigationObservationCount: number;
		buildMs: number;
		additionalModelCalls: 0;
	};
}

export interface SourceStoryV2Item {
	id: string;
	kind: StoryItemKind;
	epistemic: SourceStoryEpistemic;
	text: string;
	/** When true, item is passive context — never narrate as user action. */
	isContextOnly?: boolean;
	/** Correction chain: this intention supersedes earlierIntentionId. */
	supersedesId?: string;
	supersededById?: string;
	startSourceTimeSec: number;
	endSourceTimeSec: number;
	provenance: SourceStoryEvidenceRef;
}

export interface SourceStoryV2Beat {
	id: string;
	startSourceTimeSec: number;
	endSourceTimeSec: number;
	importance: number;
	importanceReasons: string[];
	purposeHint:
		| "intro"
		| "setup"
		| "explanation"
		| "demonstration"
		| "navigation"
		| "transition"
		| "result"
		| "pause"
		| "repetition"
		| "correction"
		| "outro"
		| "unknown";
	/** Deterministic communication summary (evidence-constrained). */
	summary: string;
	facts: SourceStoryV2Item[];
	context: SourceStoryV2Item[];
	spoken: SourceStoryV2Item[];
	actions: SourceStoryV2Item[];
	contradictions: SourceStoryV2Item[];
	uncertainties: SourceStoryV2Item[];
	evidenceRefs: SourceStoryEvidenceRef;
}

export interface SourceStoryV2Correction {
	id: string;
	fromText: string;
	toText: string;
	startSourceTimeSec: number;
	endSourceTimeSec: number;
	supersededIntentionId?: string;
	activeIntentionId?: string;
	provenance: SourceStoryEvidenceRef;
}

export interface SourceStoryV2Contradiction {
	id: string;
	claim: string;
	supportingModality: string;
	conflictingModality: string;
	startSourceTimeSec: number;
	endSourceTimeSec: number;
	resolutionStatus: "unresolved" | "contradicted" | "resolved";
	provenance: SourceStoryEvidenceRef;
}

export interface SourceStoryV2 {
	version: 2;
	providerId: typeof SOURCE_STORY_V2_PROVIDER_ID;
	assetId: string;
	sourceDurationSec: number;
	speechStatus: SourceStoryEvidenceInput["speechStatus"];
	mediaSummary: string;
	beats: SourceStoryV2Beat[];
	persistentContext: SourceStoryV2Item[];
	corrections: SourceStoryV2Correction[];
	contradictions: SourceStoryV2Contradiction[];
	unresolved: SourceStoryV2Item[];
	capabilities: {
		hasSpeech: boolean;
		hasVisual: boolean;
		hasCursor: boolean;
		hasClaims: boolean;
		hasInvestigation: boolean;
	};
	provenance: {
		claimIds: string[];
		ledgerEventIds: string[];
		speechSegmentIds: string[];
		investigationObservationIds: string[];
	};
	metrics: {
		beatCount: number;
		factCount: number;
		contextCount: number;
		contradictionCount: number;
		unresolvedCount: number;
		buildMs: number;
		evidenceInputChars: number;
		additionalModelCalls: 0;
		providerId: typeof SOURCE_STORY_V2_PROVIDER_ID;
	};
}
