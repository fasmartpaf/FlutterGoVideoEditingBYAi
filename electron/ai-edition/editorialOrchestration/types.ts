/**
 * Local Editorial Orchestration V1 — contracts.
 * Findings are observations; recommendations are optional next steps.
 * Never auto-mutates.
 */

export const LOCAL_EDITORIAL_ORCHESTRATION_V1_PROVIDER_ID =
	"CURRENT_OPENSCREEN_EDITORIAL_ORCHESTRATION_LOCAL_V1" as const;

/** Precision Closure V1 bumps surface policy; cache keys include this. */
export const EDITORIAL_ORCHESTRATION_POLICY_VERSION = "v1.1-precision-closure" as const;

export const LOCAL_EDITORIAL_PRECISION_CLOSURE_V1_PROVIDER_ID =
	"CURRENT_OPENSCREEN_EDITORIAL_PRECISION_CLOSURE_V1" as const;

export type FindingCategory =
	| "PACING"
	| "AUDIO"
	| "VISUAL_FOCUS"
	| "FRAMING"
	| "CAPTIONS"
	| "PRESERVATION"
	| "UNKNOWN";

export type FindingSeverity = "LOW" | "MEDIUM" | "HIGH";
export type ConfidenceClass = "HIGH" | "MEDIUM" | "LOW";

export type OperationFamily = "TRIM" | "ZOOM" | "CROP" | "SPEED" | "CAPTIONS" | "LOUDNESS" | "NONE";

export type RecommendationStatus =
	| "RECOMMEND"
	| "OPTIONAL"
	| "DO_NOT_RECOMMEND"
	| "NEEDS_HUMAN_JUDGMENT";

export type VerifiedApplyCapability = "READY" | "PARTIAL" | "UNSUPPORTED";

export type ExecutionReadiness =
	| "READY_TO_APPLY"
	| "MISSING_ARGS"
	| "NEEDS_HUMAN_SELECTION"
	| "UNSUPPORTED";

export interface TimeRangeSec {
	startSec: number;
	endSec: number;
}

export interface EvidenceRef {
	kind: string;
	id: string;
	note?: string;
}

export interface EditorialFindingV1 {
	id: string;
	category: FindingCategory;
	sourceRange?: TimeRangeSec;
	programmeRange?: TimeRangeSec;
	findingType: string;
	severity: FindingSeverity;
	confidence: ConfidenceClass;
	evidence: EvidenceRef[];
	constraints: string[];
	recommendationCandidate?: OperationFamily;
	reason: string;
}

export interface EditorialRecommendationV1 {
	id: string;
	operationFamily: OperationFamily;
	sourceRange?: TimeRangeSec;
	programmeRange?: TimeRangeSec;
	rationale: string;
	reviewCopy: string;
	evidenceRefs: EvidenceRef[];
	confidence: ConfidenceClass;
	expectedBenefit: string;
	risk: FindingSeverity;
	prerequisites: string[];
	conflictsWith: string[];
	dependencies: string[];
	verifiedApplyCapability: VerifiedApplyCapability;
	recommendationStatus: RecommendationStatus;
	executionReadiness: ExecutionReadiness;
	expectedOperationType?: string;
	missingParameters: string[];
	findingIds: string[];
}

export interface PreservedRange {
	id: string;
	sourceRange: TimeRangeSec;
	reason: string;
	findingIds: string[];
}

export type SurfaceEligibility = "YES" | "NO" | "QUESTION_ONLY";

export interface RecommendationSurfaceDecisionV1 {
	recommendationId: string;
	surface: SurfaceEligibility;
	reason: string;
	evidenceStrength: "STRONG" | "MEDIUM" | "WEAK";
	executionReadiness: ExecutionReadiness;
	missingParameters: string[];
	requiresSemanticJudgment: boolean;
}

/** Useful ambiguity that is NOT an edit card. */
export interface UnresolvedEditorialQuestionV1 {
	id: string;
	text: string;
	sourceRange?: TimeRangeSec;
	relatedFindingIds: string[];
	relatedRecommendationIds?: string[];
	reason: string;
}

export interface EditorialRecommendationSetV1 {
	version: 1;
	providerId: typeof LOCAL_EDITORIAL_ORCHESTRATION_V1_PROVIDER_ID;
	policyVersion: typeof EDITORIAL_ORCHESTRATION_POLICY_VERSION;
	mediaFingerprint: string;
	programmeFingerprint: string;
	/** Observations — may exist without a card. */
	findings: EditorialFindingV1[];
	/**
	 * User-facing edit cards only (surface YES).
	 * Unsupported / incomplete ideas are excluded.
	 */
	recommendations: EditorialRecommendationV1[];
	preservedRanges: PreservedRange[];
	/** Non-actionable editorial ambiguity — does not count as recommendations. */
	unresolvedQuestions: UnresolvedEditorialQuestionV1[];
	/** Audit: surface decisions for all raw candidates. */
	surfaceDecisions?: RecommendationSurfaceDecisionV1[];
	summary: string;
	status: "ACTIONS_AVAILABLE" | "NO_ACTION_RECOMMENDED" | "NEEDS_HUMAN_JUDGMENT";
	metrics: {
		findingCount: number;
		recommendationCount: number;
		recommendCount: number;
		optionalCount: number;
		blockedCount: number;
		needsHumanCount: number;
		conflictEdges: number;
		rawCandidates: number;
		surfaceableRecommendations: number;
		questionCount: number;
		suppressedUnsupported: number;
		suppressedConflicts: number;
		suppressedRedundant: number;
		signalCollectionMs: number;
		findingMs: number;
		conflictMs: number;
		rankMs: number;
		surfaceMs: number;
		totalMs: number;
		additionalMediaDecodePasses: number;
		additionalModelCalls: 0;
		autoMutations: 0;
		cacheHit: boolean;
	};
}

export interface EditorialOrchestrationPolicy {
	version: typeof EDITORIAL_ORCHESTRATION_POLICY_VERSION;
	maxRecommendations: number;
	/** Prefer trim over speed for the same silence gap. */
	preferTrimOverSpeedForSilence: boolean;
	/** Captions default to OPTIONAL unless stronger reason. */
	captionsDefaultOptional: boolean;
	/** Speed without explicit intent → NEEDS_HUMAN_JUDGMENT / none. */
	speedRequiresExplicitIntent: boolean;
	/** Zoom requires focal geometry. */
	zoomRequiresFocalTarget: boolean;
	/** Crop requires framing evidence. */
	cropRequiresFramingEvidence: boolean;
	/**
	 * Precision Closure: never surface ZOOM/CROP/SPEED edit cards when
	 * fundamental geometry/rate is missing — route to questions instead.
	 */
	suppressIncompleteGeometryCards: boolean;
	/** Emit activity-without-focal as unresolved question (not zoom card). */
	activityWithoutFocalAsQuestion: boolean;
}

/** Precomputed local signals — adapters do not re-decode by default. */
export interface EditorialSignalBundle {
	assetId: string;
	mediaPath?: string;
	mediaFingerprint: string;
	programmeFingerprint: string;
	aspectValue: number;
	/** Explicit user/project intents (speed, aspect conversion, duration target). */
	intents?: {
		speed?: boolean;
		cropForAspect?: boolean;
		targetDurationSec?: number;
		wantCaptions?: boolean;
	};
	deadAir?: {
		candidates: Array<{
			id: string;
			startSec: number;
			endSec: number;
			durationSec: number;
			safeToPropose: boolean;
			blockingReasons: string[];
			classification?: string;
			confidence?: ConfidenceClass;
		}>;
	};
	loudness?: {
		classification: string;
		safeToPropose: boolean;
		estimatedGainDb?: number;
		blockingReasons?: string[];
		integratedLufs?: number | null;
	};
	captions?: {
		layoutStatus: "ok" | "NO_SAFE_LAYOUT" | "NO_SPEECH" | "NO_TRANSCRIPT";
		cueCount: number;
		alreadyEnabled: boolean;
		manualConflict: boolean;
		speechDurationSec?: number;
		safeToPropose: boolean;
	};
	visual?: {
		activityRanges: Array<{
			startSec: number;
			endSec: number;
			reason: string;
		}>;
		stableRanges?: Array<{ startSec: number; endSec: number }>;
		/** Deterministic focal targets only — never invent from activity alone. */
		focalTargets?: Array<{
			id: string;
			startSec: number;
			endSec: number;
			cx: number;
			cy: number;
			kind: string;
		}>;
		framingEvidence?: Array<{
			id: string;
			kind: "unused_margins" | "aspect_conversion" | "explicit_geometry";
			note: string;
			crop?: { x: number; y: number; width: number; height: number };
		}>;
	};
	preservation?: Array<{
		id: string;
		startSec: number;
		endSec: number;
		reason: string;
		kind: "speech" | "visual" | "manual_annotation" | "manual_caption" | "user_edit";
	}>;
	timeline?: {
		existingTrimCount: number;
		existingZoomCount: number;
		existingSpeedCount: number;
		existingCropCount: number;
	};
	/** Case4-style correction discrepancy without inventing UI actions. */
	unresolved?: string[];
}
