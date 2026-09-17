/**
 * Local Professional Editorial Planner V1 — contracts.
 */

export const LOCAL_PROFESSIONAL_EDITORIAL_PLANNER_V1_ID =
	"CURRENT_OPENSCREEN_LOCAL_PROFESSIONAL_EDITORIAL_PLANNER_V1" as const;

export type OpportunityFamily =
	| "TRIM"
	| "ZOOM"
	| "CROP"
	| "SPEED"
	| "CAPTIONS"
	| "LOUDNESS"
	| "TITLE"
	| "CALLOUT"
	| "TRANSITION";

export type OpportunityGenerationStatus =
	| "GROUNDED_READY"
	| "GROUNDED_NOT_USEFUL"
	| "INSUFFICIENT_EVIDENCE"
	| "PRESERVATION_CONFLICT"
	| "MISSING_PARAMETERS"
	| "UNSUPPORTED_GENERATION";

export type OpportunityConfidence = "HIGH" | "MEDIUM" | "LOW";

export type StoryPhaseHint =
	| "HOOK"
	| "INTRO"
	| "EXPLANATION"
	| "IMPORTANT_ACTION"
	| "WAITING"
	| "LOW_INFORMATION"
	| "RESULT"
	| "OUTRO"
	| "UNKNOWN";

export interface SourceRangeSec {
	startSec: number;
	endSec: number;
}

export interface ProfessionalEditorialOpportunityV1 {
	id: string;
	family: OpportunityFamily;
	sourceRange?: SourceRangeSec;
	programmeRange?: SourceRangeSec;
	editorialReason: string;
	evidenceRefs: string[];
	confidence: OpportunityConfidence;
	preservationStatus: "SAFE" | "RISKY" | "BLOCKED" | "UNKNOWN";
	generationStatus: OpportunityGenerationStatus;
	requiredParameters: string[];
	derivedParameters: Record<string, unknown>;
	executionReadiness: "READY" | "NOT_READY";
	storyPhase?: StoryPhaseHint;
	rankScore: number;
}

export interface StoryPhaseSegmentV1 {
	phase: StoryPhaseHint;
	sourceRange: SourceRangeSec;
	evidenceRefs: string[];
}

export interface ProfessionalEditorialPlannerResultV1 {
	providerId: typeof LOCAL_PROFESSIONAL_EDITORIAL_PLANNER_V1_ID;
	version: 1;
	opportunities: ProfessionalEditorialOpportunityV1[];
	ready: ProfessionalEditorialOpportunityV1[];
	storyPhases: StoryPhaseSegmentV1[];
	temporalPacketSummary: {
		recordCount: number;
		coverage: Record<string, string>;
		consumed: true;
	} | null;
	/** Full STANDARD packet when consumed — for Director / auditors. */
	temporalPacket?: import("../temporalContextStore").TemporalReasoningPacketV1 | null;
	metrics: {
		buildMs: number;
		paidAiCalls: 0;
		temporalContextConsumed: boolean;
	};
}
