/**
 * Investigator V1.1 — role policy types (internal planning states, not agents).
 */

import type { PlannedAction } from "../plan";

export const INVESTIGATOR_V1_1_PROVIDER_ID = "CURRENT_OPENSCREEN_INVESTIGATOR_V1_1";

export const INVESTIGATOR_ROLES = [
	"GROUNDING",
	"VISUAL_INSPECTION",
	"SPEECH_INSPECTION",
	"OCR_INSPECTION",
	"CURSOR_INSPECTION",
	"CONTRADICTION_CHECK",
	"VERIFICATION",
	"STOP",
] as const;
export type InvestigatorRole = (typeof INVESTIGATOR_ROLES)[number];

export const INVESTIGATION_INTENTS = [
	"chronology",
	"visual_state",
	"speech_content",
	"spoken_correction",
	"action_verification",
	"temporary_ui",
	"text_ui_reading",
	"cursor_interaction",
	"contradiction_check",
	"whole_media_understanding",
] as const;
export type InvestigationIntent = (typeof INVESTIGATION_INTENTS)[number];

export interface RoleBudgets {
	maxGroundingRanges: number;
	maxVisualInspections: number;
	maxOcrInspections: number;
	maxSpeechQueries: number;
	maxCursorQueries: number;
	maxContradictionChecks: number;
	maxVerificationPasses: number;
	/** Max candidate ranges kept after ranking. */
	maxRankedRanges: number;
}

export const DEFAULT_ROLE_BUDGETS: RoleBudgets = {
	maxGroundingRanges: 6,
	maxVisualInspections: 3,
	maxOcrInspections: 2,
	maxSpeechQueries: 2,
	maxCursorQueries: 2,
	maxContradictionChecks: 3,
	maxVerificationPasses: 2,
	maxRankedRanges: 3,
};

export interface CandidateRange {
	id: string;
	startSourceTimeSec: number;
	endSourceTimeSec: number;
	sources: string[];
	/** Deterministic rank score (higher = inspect sooner). */
	score: number;
	scoreBreakdown: Record<string, number>;
	reason: string;
}

export interface RoleTransition {
	from: InvestigatorRole;
	to: InvestigatorRole;
	why: string;
}

export interface RolePolicyPlan {
	providerId: typeof INVESTIGATOR_V1_1_PROVIDER_ID;
	intents: InvestigationIntent[];
	roles: InvestigatorRole[];
	transitions: RoleTransition[];
	candidates: CandidateRange[];
	ranked: CandidateRange[];
	focus: { startSourceTimeSec: number; endSourceTimeSec: number; questionSummary: string };
	actions: PlannedAction[];
	/** Actions that were skipped because claims were already supported / irrelevant. */
	skippedIrrelevant: string[];
	/** Claim IDs that scheduled work via lazy verification. */
	lazyScheduledClaimIds: string[];
	stopHint: "sufficient_after_plan" | "insufficient_after_plan" | "continue";
	additionalModelCalls: 0;
	planningMs: number;
}

export interface RolePolicyTrace {
	providerId: typeof INVESTIGATOR_V1_1_PROVIDER_ID;
	intents: InvestigationIntent[];
	roleSequence: InvestigatorRole[];
	transitions: RoleTransition[];
	rankedRangeIds: string[];
	lazyScheduledClaimIds: string[];
	skippedIrrelevant: string[];
	stopReasonDetail?: string;
}
