/**
 * Benchmark-only types for CURRENT_OPENSCREEN_REAL_CORPUS_BASELINE_V1.
 * Does not alter production behavior.
 */

export type ScoreMark = "PASS" | "PARTIAL" | "FAIL" | "NOT_APPLICABLE" | "NOT_VERIFIED";

export type FailureCategory =
	| "PERCEPTION_MISS"
	| "SAMPLING_MISS"
	| "OCR_MISS"
	| "SPEECH_MISS"
	| "TEMPORAL_GROUNDING_ERROR"
	| "CROSS_MODAL_CONFUSION"
	| "LEDGER_ERROR"
	| "CLAIM_PROMOTION_ERROR"
	| "SOURCE_STORY_ERROR"
	| "TARGET_STORY_GENERIC"
	| "EDIT_GAP_ERROR"
	| "EDIT_PLAN_ERROR"
	| "PLANNING_CLOSURE_ERROR"
	| "PROPOSAL_TOO_AGGRESSIVE"
	| "PROPOSAL_TOO_CONSERVATIVE"
	| "PRESERVATION_FAILURE"
	| "LANDING_UNCERTAIN"
	| "COMPOSITOR_VERIFY_FAILURE"
	| "AUDIO_VERIFY_FAILURE"
	| "FINAL_RESPONSE_ERROR"
	| "PROVIDER_FAILURE"
	| "INFRASTRUCTURE_FAILURE"
	| "CAPABILITY_NOT_SUPPORTED";

export type Severity = "P0" | "P1" | "P2" | "P3";

export interface DimensionScore {
	mark: ScoreMark;
	notes?: string;
}

export interface CaseScore {
	caseId: string;
	overall: ScoreMark;
	dimensions: {
		visualEventRecall: DimensionScore;
		speechCorrectness: DimensionScore;
		temporalCorrectness: DimensionScore;
		crossModalGrounding: DimensionScore;
		hallucinationUnsupportedClaims: DimensionScore;
		epistemicHonesty: DimensionScore;
		sourceStoryCompleteness: DimensionScore;
		targetStorySpecificity: DimensionScore;
		editorialJudgment: DimensionScore;
		preservationCorrectness: DimensionScore;
		editGapUsefulness: DimensionScore;
		editPlanUsefulness: DimensionScore;
		proposalSafety: DimensionScore;
		unnecessaryConservatism: DimensionScore;
		finalAnswerAccuracy: DimensionScore;
		finalAnswerClarity: DimensionScore;
		finalAnswerRelevance: DimensionScore;
		latency: DimensionScore;
		modelCalls: DimensionScore;
		ocrCalls: DimensionScore;
		investigatorToolCalls: DimensionScore;
	};
	issues: Array<{
		severity: Severity;
		primary: FailureCategory;
		secondary?: FailureCategory;
		detail: string;
	}>;
	negativeTests: Array<{ name: string; result: ScoreMark; detail?: string }>;
	userFacingAudit: {
		calmNatural: ScoreMark;
		technicalLeak: boolean;
		confidenceCalibrated: ScoreMark;
		notes: string[];
	};
}

export interface CaseLatency {
	totalTurnMs: number;
	agentInvokeMs: number;
	applyMs?: number;
	stages?: Record<string, number | null>;
}

export interface ModelCallAccounting {
	mainAgentModelCallsEstimate: number;
	investigatorModelCalls: number;
	ocrCallsEstimate: number;
	investigatorToolCalls: number;
	notes: string[];
}
