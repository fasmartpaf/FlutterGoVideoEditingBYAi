/**
 * Temporal Context Store V1 — contracts.
 * Index/query layer over existing evidence. Never auto-mutates. No paid AI.
 */

export const TEMPORAL_CONTEXT_STORE_V1_PROVIDER_ID =
	"CURRENT_OPENSCREEN_TEMPORAL_CONTEXT_STORE_V1" as const;

export const TEMPORAL_CONTEXT_SCHEMA_VERSION = "v1" as const;
export const TEMPORAL_REASONING_PACKET_VERSION = "v1" as const;

export type TemporalRecordKind =
	| "SPEECH_SEGMENT"
	| "SPEECH_WORD"
	| "SPEECH_GAP"
	| "VISUAL_CHANGE"
	| "VISUAL_ACTIVITY"
	| "VISUAL_STABLE_RANGE"
	| "SCENE_CHANGE"
	| "BLACK_RANGE"
	| "FREEZE_RANGE"
	| "CURSOR_INTERACTION"
	| "FOCAL_TARGET"
	| "EDITORIAL_FOCAL_EVIDENCE"
	| "EDITORIAL_FOCAL_TARGET"
	| "PROTECTED_RANGE"
	| "DEAD_AIR_CANDIDATE"
	| "LOUDNESS_ANALYSIS"
	| "LOUDNESS_CANDIDATE"
	| "CAPTION_CUE"
	| "CAPTION_LAYOUT"
	| "EXISTING_TRIM"
	| "EXISTING_ZOOM"
	| "EXISTING_CROP"
	| "EXISTING_SPEED"
	| "EXISTING_CAPTION_STATE"
	| "ANNOTATION"
	| "EDITORIAL_FINDING"
	| "EDITORIAL_RECOMMENDATION"
	| "EDITORIAL_QUESTION";

export type RecordValidity = "CURRENT" | "SOURCE_CURRENT_PROGRAMME_STALE" | "STALE" | "REMOVED";

export type EpistemicType = "OBSERVED" | "DERIVED" | "HEURISTIC" | "USER_AUTHORED";

export type PrivacyClass = "LOCAL_ONLY" | "SAFE_STRUCTURED" | "REQUIRES_USER_PERMISSION";

export type ConfidenceClass = "HIGH" | "MEDIUM" | "LOW";

export interface TimeRangeSec {
	startSec: number;
	endSec: number;
}

export interface TemporalProvenance {
	module: string;
	evidenceId?: string;
	version?: string;
	observedOrDerived: EpistemicType;
}

export interface TemporalContextRecordV1 {
	id: string;
	kind: TemporalRecordKind;
	sourceRange?: TimeRangeSec;
	programmeRanges?: TimeRangeSec[];
	confidence?: ConfidenceClass;
	status: RecordValidity;
	provenance: TemporalProvenance;
	/** Reference into owner module payload — not a copy of detector blobs. */
	payloadRef?: string;
	normalizedSummary?: string;
	internalCode?: string;
	mediaFingerprint: string;
	programmeFingerprint?: string;
	createdAt?: string;
	updatedAt?: string;
	privacy: PrivacyClass;
	epistemic: EpistemicType;
}

export type PacketDetailLevel = "SUMMARY" | "STANDARD" | "DETAILED";

export interface EvidenceCoverageV1 {
	speechCoverage: "AVAILABLE" | "PARTIAL" | "NOT_AVAILABLE";
	visualCoverage: "AVAILABLE" | "AVAILABLE_COARSE" | "PARTIAL" | "NOT_AVAILABLE";
	ocrCoverage: "AVAILABLE" | "NOT_AVAILABLE";
	focalCoverage: "AVAILABLE" | "PARTIAL" | "NOT_AVAILABLE";
	cursorCoverage: "AVAILABLE" | "PARTIAL" | "NOT_AVAILABLE";
	loudnessCoverage: "AVAILABLE" | "NOT_AVAILABLE";
	captionLayoutCoverage: "AVAILABLE" | "PARTIAL" | "NOT_AVAILABLE";
	editorialCoverage: "AVAILABLE" | "PARTIAL" | "NOT_AVAILABLE";
}

export interface TemporalReasoningPacketV1 {
	version: typeof TEMPORAL_REASONING_PACKET_VERSION;
	providerId: typeof TEMPORAL_CONTEXT_STORE_V1_PROVIDER_ID;
	detailLevel: PacketDetailLevel;
	media: {
		assetId: string;
		mediaFingerprint: string;
	};
	currentProgramme: {
		programmeFingerprint: string;
		durationSecEstimate?: number;
	};
	requestedRange?: TimeRangeSec;
	speech: Array<{
		id: string;
		summary: string;
		sourceRange?: TimeRangeSec;
		programmeRanges?: TimeRangeSec[];
	}>;
	visual: Array<{
		id: string;
		summary: string;
		sourceRange?: TimeRangeSec;
		programmeRanges?: TimeRangeSec[];
	}>;
	audio: {
		loudnessSummary?: string;
		recordIds: string[];
	};
	focalTargets: Array<{ id: string; summary: string; sourceRange?: TimeRangeSec }>;
	protectedRanges: Array<{ id: string; summary: string; sourceRange?: TimeRangeSec }>;
	currentEdits: Array<{ id: string; kind: TemporalRecordKind; summary: string }>;
	findings: Array<{ id: string; summary: string }>;
	recommendations: Array<{ id: string; summary: string }>;
	unresolvedQuestions: Array<{ id: string; summary: string }>;
	evidenceCoverage: EvidenceCoverageV1;
	budgets: Record<string, number>;
	metrics: {
		recordCountIncluded: number;
		serializedBytesApprox: number;
		buildMs: number;
		additionalMediaDecodePasses: 0;
		additionalModelCalls: 0;
	};
}

export type SelectionKind = "range" | "recommendation" | "finding" | "focal" | "clip" | "question";

export interface EditorialContextSessionV1 {
	sessionId: string;
	mediaFingerprint: string;
	programmeFingerprint: string;
	selectedRange?: TimeRangeSec;
	selectedFindingId?: string;
	selectedRecommendationId?: string;
	selectedQuestionId?: string;
	selectedFocalId?: string;
	selectedClipId?: string;
	selectionStatus: "VALID" | "SELECTION_STALE" | "NONE";
	selectionStaleReason?: string;
	lastQuery?: TemporalContextQuery;
	lastResultRefs: string[];
	updatedAt: string;
}

export interface TemporalContextQuery {
	sourceRange?: [number, number];
	programmeRange?: [number, number];
	kinds?: TemporalRecordKind[];
	includeStale?: boolean;
	confidenceAtLeast?: ConfidenceClass;
	limit?: number;
}

export interface PacketBudget {
	maxSpeech: number;
	maxVisual: number;
	maxFindings: number;
	maxRecommendations: number;
	maxFocalTargets: number;
	maxProtected: number;
	maxEdits: number;
	maxQuestions: number;
}

export const DEFAULT_PACKET_BUDGETS: Record<PacketDetailLevel, PacketBudget> = {
	SUMMARY: {
		maxSpeech: 4,
		maxVisual: 4,
		maxFindings: 4,
		maxRecommendations: 3,
		maxFocalTargets: 2,
		maxProtected: 3,
		maxEdits: 4,
		maxQuestions: 2,
	},
	STANDARD: {
		maxSpeech: 12,
		maxVisual: 12,
		maxFindings: 10,
		maxRecommendations: 5,
		maxFocalTargets: 4,
		maxProtected: 6,
		maxEdits: 12,
		maxQuestions: 5,
	},
	DETAILED: {
		maxSpeech: 40,
		maxVisual: 40,
		maxFindings: 30,
		maxRecommendations: 10,
		maxFocalTargets: 10,
		maxProtected: 20,
		maxEdits: 40,
		maxQuestions: 10,
	},
};
