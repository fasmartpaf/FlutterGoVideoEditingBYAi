/**
 * Planning → Investigation Closure V1
 * When Edit Plan needs more evidence, request bounded Investigator work,
 * recompute the full cognition chain, and resolve or honestly stop.
 * Does NOT execute edits. Does NOT mutate AxcutDocument.
 */

import type { ClaimPromotionSet } from "../claimPromotion/types";
import type { EditGapV1 } from "../editGap/types";
import type { EditPlanItem, EditPlanV1 } from "../editPlan/types";
import type { MediaContextNeeds } from "../mediaContextNeeds";
import type { SourceStoryV2 } from "../sourceStory/v2/types";
import type { SpeechEvidence } from "../speechEvidence/types";
import type { TargetStoryV1 } from "../targetStory/v1/types";
import type { TemporalEventLedger } from "../temporalEventLedger/types";
import type { InvestigatorRole } from "../videoInvestigator/rolePolicy/types";
import type { InvestigationEvidenceSet } from "../videoInvestigator/types";
import type { VisualChange, VisualEvidenceFrame } from "../visualEvidence/types";

export const PLANNING_CLOSURE_V1_PROVIDER_ID = "CURRENT_OPENSCREEN_PLANNING_CLOSURE_V1";

export const PLANNING_EVIDENCE_QUESTIONS = [
	"identify_visual_target",
	"verify_action",
	"read_ui_text",
	"verify_temporary_state",
	"verify_cursor_target",
	"resolve_speech_visual_conflict",
	"verify_timing",
	"verify_crop_safety",
	"other",
] as const;
export type PlanningEvidenceQuestion = (typeof PLANNING_EVIDENCE_QUESTIONS)[number];

export type PlanningEvidenceModality = "visual" | "ocr" | "speech" | "cursor" | "comparison";

export type PlanningEvidencePriority = "critical" | "high" | "medium" | "low";

export interface PlanningEvidenceRequest {
	id: string;
	/** Deterministic identity for dedupe within a turn. */
	identityKey: string;
	planItemId: string;
	gapIds: string[];
	question: PlanningEvidenceQuestion;
	sourceRange?: { startSec: number; endSec: number };
	modalitiesNeeded: PlanningEvidenceModality[];
	/** Investigator V1.1 role sequence (planning states, not agents). */
	investigatorRoles: InvestigatorRole[];
	requiredOutcome: string;
	provenanceRefs: string[];
	priority: PlanningEvidencePriority;
	focusedUserMessage: string;
}

export interface PlanVersionSnapshot {
	versionIndex: number;
	plan: EditPlanV1;
	sourceStoryV2: SourceStoryV2;
	targetStoryV1: TargetStoryV1;
	editGapV1: EditGapV1;
	label: "initial" | "after_closure_round" | "final";
	round: number;
}

export interface PlanningClosureRound {
	round: number;
	requests: PlanningEvidenceRequest[];
	skippedDuplicateIds: string[];
	investigationSummaries: Array<{
		requestId: string;
		stopReason?: string;
		claimCount: number;
		observationCount: number;
		providerCallsApprox: number;
		ms: number;
	}>;
	materialChange: boolean;
	planVersionIndex: number;
}

export type PlanningClosureStopReason =
	| "all_resolved"
	| "no_requests_needed"
	| "budget_exhausted"
	| "insufficient_evidence"
	| "no_material_change";

export interface PlanningClosureResult {
	version: 1;
	providerId: typeof PLANNING_CLOSURE_V1_PROVIDER_ID;
	rounds: PlanningClosureRound[];
	planVersions: PlanVersionSnapshot[];
	initialPlanId: string;
	finalPlanId: string;
	resolvedItems: string[];
	unresolvedItems: string[];
	invalidatedItems: string[];
	evidenceRequests: PlanningEvidenceRequest[];
	stopReason: PlanningClosureStopReason;
	/** Case 4 compactness / redundancy notes (internal). */
	redundancyNotes?: string[];
	metrics: {
		closureRounds: number;
		evidenceRequestsGenerated: number;
		evidenceRequestsExecuted: number;
		duplicatesSuppressed: number;
		investigatorInvocations: number;
		orchestrationModelCalls: 0;
		providerCallsFromInvestigatorApprox: number;
		cacheHitsApprox: number;
		cacheMissesApprox: number;
		latencyMs: {
			requestGeneration: number;
			investigation: number;
			recompute: number;
			total: number;
			breakdown?: Record<string, number>;
		};
		serializedBytesApprox: number;
		additionalOrchestrationModelCalls: 0;
	};
}

export interface PlanningClosureBudgets {
	maxRounds: number;
	maxRequestsPerRound: number;
	/** Same identityKey may run at most once per turn. */
	maxRepeatedRequestIdentity: number;
}

export const DEFAULT_CLOSURE_BUDGETS: PlanningClosureBudgets = {
	maxRounds: 2,
	maxRequestsPerRound: 3,
	maxRepeatedRequestIdentity: 1,
};

export interface PlanningClosureEvidenceContext {
	assetId: string;
	sourceDurationSec: number;
	userMessage: string;
	contextNeeds: MediaContextNeeds;
	videoPath?: string | null;
	ledger?: TemporalEventLedger | null;
	claimPromotion?: ClaimPromotionSet | null;
	speechEvidence?: SpeechEvidence | null;
	frames?: VisualEvidenceFrame[];
	changes?: VisualChange[];
	cursorInteractions?: Array<{ sourceTimeSec: number; interactionType?: string }>;
	cursorEventTimes?: number[];
	ffmpegPath?: string | null;
}

export interface PlanningClosureInput {
	initialPlan: EditPlanV1;
	sourceStoryV2: SourceStoryV2;
	targetStoryV1: TargetStoryV1;
	editGapV1: EditGapV1;
	evidence: PlanningClosureEvidenceContext;
	budgets?: Partial<PlanningClosureBudgets>;
	/**
	 * Optional injectable investigator for tests / offline fixtures.
	 * When omitted, uses runMasterVideoInvestigatorV1_1.
	 */
	investigate?: (
		request: PlanningEvidenceRequest,
		ctx: PlanningClosureEvidenceContext,
	) => Promise<InvestigationEvidenceSet | null>;
	/**
	 * Optional post-investigation evidence merger (tests can inject verified claims).
	 */
	mergeInvestigation?: (
		ctx: PlanningClosureEvidenceContext,
		investigation: InvestigationEvidenceSet | null,
		request: PlanningEvidenceRequest,
	) => PlanningClosureEvidenceContext;
}

/** Items that already have a safe preferred strategy — no closure. */
export function itemNeedsEvidence(item: EditPlanItem): boolean {
	if (item.preferredStrategy === "needs_more_evidence") return true;
	if (item.feasibility === "needs_more_evidence") return true;
	return item.candidateStrategies.some(
		(s) =>
			s.family === "needs_more_evidence" &&
			(s.evidenceRequirements?.length ?? 0) > 0 &&
			item.preferredStrategy === "needs_more_evidence",
	);
}
