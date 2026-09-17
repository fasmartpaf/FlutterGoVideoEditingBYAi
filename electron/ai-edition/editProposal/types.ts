/**
 * Constrained Edit Proposal V1 — precise, evidence-backed edit proposals.
 * Does NOT execute tools. Does NOT mutate AxcutDocument. Does NOT apply edits.
 *
 * Differs from Edit Plan: Plan says “trim superseded correction”;
 * Proposal says where, why, what must survive, and what could break.
 */

import type { EditGapV1 } from "../editGap/types";
import type {
	EditCapabilityRegistry,
	EditPlanItem,
	EditPlanV1,
	EditStrategyFamily,
} from "../editPlan/types";
import type { PlanningClosureResult } from "../planningClosure/types";
import type { SourceStoryV2 } from "../sourceStory/v2/types";
import type { TargetStoryV1 } from "../targetStory/v1/types";

export const EDIT_PROPOSAL_V1_PROVIDER_ID = "CURRENT_OPENSCREEN_EDIT_PROPOSAL_V1";

export type ProposalStatus =
	| "proposal_ready"
	| "provisional"
	| "no_safe_proposal"
	| "needs_more_evidence"
	| "unsupported";

export type ProposalPriority = "critical" | "high" | "medium" | "low";

export type ContinuityRiskLevel = "low" | "medium" | "high" | "blocking";

export type DamageKind =
	| "speech_meaning"
	| "corrected_intent"
	| "visual_continuity"
	| "essential_ui"
	| "chronology"
	| "unsupported_implication"
	| "audio_clarity"
	| "other";

export interface ProposalEvidenceRef {
	kind:
		| "plan_item"
		| "gap"
		| "source_beat"
		| "speech_segment"
		| "correction"
		| "contradiction"
		| "preservation"
		| "hard_constraint"
		| "closure";
	id: string;
	note: string;
}

/** Proposed landing in SOURCE_MEDIA_TIME — not an applied edit. */
export interface ProposalLanding {
	timebase: "SOURCE_MEDIA_TIME";
	startSourceTimeSec: number;
	endSourceTimeSec: number;
	/** How the boundary was derived (speech / beat / evidenceRange). */
	boundaryBasis: string;
	boundaryConfidence: "high" | "medium" | "low";
	/** Explicit: not finalized for apply. */
	finalizedForApply: false;
}

export interface ProposalSurvivalRequirement {
	id: string;
	text: string;
	sourceBeatIds: string[];
	reason: string;
}

export interface ProposalDamageRisk {
	kind: DamageKind;
	level: ContinuityRiskLevel;
	description: string;
	mitigation?: string;
}

/**
 * Tool-shaped proposal only. Never executed by this module.
 * Args are provisional and must remain marked proposal_only.
 */
export interface ProposedToolCallShape {
	status: "proposal_only";
	notExecuted: true;
	toolFamily: EditStrategyFamily;
	/** Real OpenScreen tool name when mappable; else null. */
	toolName: string | null;
	/** Provisional args — evidence-derived, not applied. */
	provisionalArgs: Record<string, unknown>;
	argsConfidence: "high" | "medium" | "low";
}

export interface EditProposalItem {
	id: string;
	planItemId: string;
	gapIds: string[];
	sourceBeatIds: string[];
	targetBeatIds: string[];
	status: ProposalStatus;
	priority: ProposalPriority;
	/** Short editorial statement of the proposed intervention. */
	intent: string;
	/** 1. What evidence justifies the edit? */
	evidenceJustification: string;
	evidenceRefs: ProposalEvidenceRef[];
	/** 2. Where should the edit land? */
	landing?: ProposalLanding;
	/** 3. What must survive? */
	mustSurvive: ProposalSurvivalRequirement[];
	/** 4. What could this edit damage? */
	damageRisks: ProposalDamageRisk[];
	continuityRisk: ContinuityRiskLevel;
	preservationViolationRisk: ContinuityRiskLevel;
	preferredStrategy: EditStrategyFamily;
	proposedCall?: ProposedToolCallShape;
	constraints: string[];
	confidence: number;
	rejectionReason?: string;
}

export interface EditProposalQualityMetrics {
	proposalCount: number;
	proposalReadyCount: number;
	noSafeProposalCount: number;
	provisionalCount: number;
	needsMoreEvidenceCount: number;
	unsupportedCount: number;
	avgBoundaryConfidence: number;
	highContinuityRiskCount: number;
	preservationBlockingCount: number;
}

export interface EditProposalV1 {
	version: 1;
	providerId: typeof EDIT_PROPOSAL_V1_PROVIDER_ID;
	assetId: string;
	summary: string;
	proposals: EditProposalItem[];
	deferredPlanItemIds: string[];
	hardConstraints: string[];
	quality: EditProposalQualityMetrics;
	metrics: {
		planItemsConsumed: number;
		proposalsGenerated: number;
		serializedBytesApprox: number;
		buildMs: number;
		additionalModelCalls: 0;
		providerId: typeof EDIT_PROPOSAL_V1_PROVIDER_ID;
	};
}

export interface EditProposalInput {
	sourceStoryV2: SourceStoryV2;
	targetStoryV1: TargetStoryV1;
	editGapV1: EditGapV1;
	editPlanV1: EditPlanV1;
	/** Prefer post-closure plan when present. */
	planningClosureV1?: PlanningClosureResult | null;
	availableCapabilities?: EditCapabilityRegistry;
}

export interface EditProposalQualityRubric {
	evidenceGrounding: boolean;
	landingPrecision: boolean;
	preservationSafety: boolean;
	damageAwareness: boolean;
	noExecutionLeakage: boolean;
	epistemicHonesty: boolean;
	feasibilityHonesty: boolean;
	compactness: boolean;
	notes: string[];
}

/** Plan items that are not proposal candidates (informational / non-mutating). */
export function isNonMutatingStrategy(family: EditStrategyFamily | undefined): boolean {
	return (
		family === "preserve" ||
		family === "avoid_implication" ||
		family === "no_safe_edit" ||
		family === "needs_more_evidence"
	);
}

export function planItemIsProposalCandidate(item: EditPlanItem): boolean {
	const pref = item.preferredStrategy;
	if (!pref) return false;
	if (isNonMutatingStrategy(pref)) return false;
	if (item.feasibility === "needs_more_evidence") return false;
	if (item.feasibility === "unsupported") return false;
	return ["trim", "crop", "zoom", "speed", "caption", "annotation", "graphic"].includes(pref);
}
