/**
 * Autonomous Professional Editor / Editorial Director V1 — contracts.
 * Director NEVER mutates AxcutDocument.
 */

export const AUTONOMOUS_PROFESSIONAL_EDITOR_V1_ID =
	"CURRENT_OPENSCREEN_AUTONOMOUS_PROFESSIONAL_EDITOR_V1" as const;

export const EDITORIAL_DIRECTOR_V1_ID = "CURRENT_OPENSCREEN_EDITORIAL_DIRECTOR_V1" as const;

export type ReasoningProviderKindV1 =
	| "DETERMINISTIC"
	| "LOCAL_MODEL"
	| "USER_SERVER_MODEL"
	| "OPENAI"
	| "ANTHROPIC"
	| "GEMINI";

export type StoryBeatKindV1 =
	| "OPENING_SETUP"
	| "EXPLANATION"
	| "ACTION_DEMONSTRATION"
	| "WAITING_REPETITION"
	| "RESULT_REVEAL"
	| "CLOSING"
	| "UNCERTAIN";

export type InformationDensityV1 = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export type EditorialIntentKindV1 =
	| "REMOVE_DEAD_TIME"
	| "TIGHTEN_SECTION"
	| "EMPHASIZE_TARGET"
	| "REFRAME_SCENE"
	| "ACCELERATE_LOW_INFORMATION_SECTION"
	| "SLOW_IMPORTANT_ACTION"
	| "ADD_CAPTIONS"
	| "BALANCE_AUDIO"
	| "ADD_TRANSITION"
	| "ADD_CALLOUT"
	| "ADD_TITLE"
	| "IMPROVE_COLOR"
	| "AUDIO_CLEANUP"
	| "KEEP_SECTION"
	| "PRESERVE_CONTENT";

export type IntentGroundingStatusV1 =
	| "GROUNDED"
	| "NEEDS_EVIDENCE"
	| "UNSUPPORTED"
	| "PRESERVATION_CONFLICT"
	| "KEEP";

export type SkillAutonomyClassV1 =
	| "FULL_AUTONOMOUS_PATH"
	| "EXECUTION_ONLY"
	| "EVIDENCE_ONLY"
	| "PLANNER_ONLY"
	| "PARTIAL"
	| "MISSING";

export interface SourceRangeSec {
	startSec: number;
	endSec: number;
}

export interface MultimodalStoryBeatV1 {
	id: string;
	kind: StoryBeatKindV1;
	sourceRange: SourceRangeSec;
	speechSummary: string;
	visualState: string;
	importantActions: string[];
	focalEvidenceRefs: string[];
	informationDensity: InformationDensityV1;
	preservationStatus: "MUST_SURVIVE" | "SAFE_TO_TIGHTEN" | "UNCERTAIN";
	confidence: "HIGH" | "MEDIUM" | "LOW";
	evidenceRefs: string[];
}

export interface MultimodalSourceStoryV1 {
	version: 1;
	providerId: typeof AUTONOMOUS_PROFESSIONAL_EDITOR_V1_ID;
	assetId: string;
	sourceDurationSec: number;
	summary: string;
	beats: MultimodalStoryBeatV1[];
	metrics: { buildMs: number; paidAiCalls: 0 };
}

export interface TargetEditStoryBeatV1 {
	id: string;
	sourceBeatIds: string[];
	purpose: StoryBeatKindV1;
	viewerShouldUnderstand: string;
	pacingIntent: "COMPRESS" | "NORMAL" | "EMPHASIZE" | "ACCELERATE" | "REMOVE_CANDIDATE";
	attentionIntent: "KEEP_FRAME" | "EMPHASIZE_FOCAL" | "REFRAME_IF_GROUNDED";
	/** Visual treatment plan — drives operations; not post-hoc effect stacking. */
	visualTreatment: {
		framing: "normal" | "zoom_enter_hold_exit" | "restore";
		title: "NO_TITLE" | "OPENING_TITLE" | "SECTION_TITLE";
		callout: "NONE" | "OPTIONAL";
		transition: "CUT" | "DISSOLVE" | "NONE";
		speedMultiplier: 1 | 1.25 | 1.5 | 2;
	};
	skillHints: EditorialIntentKindV1[];
	preserve: boolean;
	confidence: "HIGH" | "MEDIUM" | "LOW";
}

export interface TargetEditStoryV1 {
	version: 1;
	providerId: typeof AUTONOMOUS_PROFESSIONAL_EDITOR_V1_ID;
	assetId: string;
	viewerGoal: string;
	desiredArc: string;
	beats: TargetEditStoryBeatV1[];
	globalSkills: EditorialIntentKindV1[];
	unsupportedDesiredSkills: Array<{ skill: EditorialIntentKindV1; reason: string }>;
	metrics: { buildMs: number; paidAiCalls: 0 };
}

export interface EditorialIntentItemV1 {
	id: string;
	kind: EditorialIntentKindV1;
	beatId?: string;
	sourceRange?: SourceRangeSec;
	rationale: string;
	evidenceRefs: string[];
	priority: number;
	/** Never invents geometry/timestamps beyond evidence refs. */
	requestedSkill: string;
}

export interface EditorialIntentPlanV1 {
	version: 1;
	providerId: typeof EDITORIAL_DIRECTOR_V1_ID;
	reasoningProvider: ReasoningProviderKindV1;
	sourceStorySummary: string;
	targetStorySummary: string;
	intents: EditorialIntentItemV1[];
	preserveNotes: string[];
	rejectedSkills: Array<{ skill: string; reason: string }>;
	metrics: { buildMs: number; paidAiCalls: 0 };
}

export interface CompiledIntentResultV1 {
	intentId: string;
	kind: EditorialIntentKindV1;
	status: IntentGroundingStatusV1;
	reason: string;
	/** Family for existing planner/plan when grounded. */
	operationFamily?:
		| "trim"
		| "zoom"
		| "crop"
		| "speed"
		| "captions"
		| "loudness"
		| "title"
		| "callout"
		| "transition";
	derivedHint?: Record<string, unknown>;
}

export type SkillChatOperationV1 = "add" | "adjust" | "remove" | "list";

export type SkillTargetTypeV1 =
	| "EXPLICIT_RANGE"
	| "SEMANTIC_EVENT"
	| "SELECTION"
	| "PREVIOUS_EDIT"
	| "PENDING_PROPOSAL"
	| "WHOLE_PROGRAMME";

export interface EditingSkillV1 {
	skill: string;
	intentKinds: EditorialIntentKindV1[];
	classification: SkillAutonomyClassV1;
	supported: boolean;
	executionReady: boolean;
	requiredEvidence: string[];
	groundingStrategy: string;
	verificationStrategy: string;
	conflicts: string[];
	preservationRules: string[];
	rendererRequirements: string[];
	productGapRank?: number;
	notes?: string;
	/** Chat Skill Engine routing metadata (describes existing executors; no HOW logic). */
	chatAvailable?: boolean;
	operations?: SkillChatOperationV1[];
	acceptedTargetTypes?: SkillTargetTypeV1[];
	modificationOps?: string[];
	evidenceKinds?: Array<"transcript" | "cursor" | "visual" | "story" | "document">;
	directEntry?: string | null;
	autonomousEntry?: string | null;
	acceptsSemanticTarget?: boolean;
}

export type EditorialImprovementV1 =
	| "EDITORIALLY_IMPROVED"
	| "TECHNICALLY_VALID_NO_CLEAR_IMPROVEMENT"
	| "POSSIBLY_WORSE"
	| "UNCHANGED"
	| "INSUFFICIENT_TO_JUDGE";

export interface FinalResultSelfReviewV1 {
	version: 1;
	technicallyValid: boolean;
	editorialImprovement: EditorialImprovementV1;
	storyContinuity: "OK" | "RISK" | "UNKNOWN";
	pacing: "OK" | "STILL_SLOW" | "OVER_CUT" | "UNKNOWN";
	attentionFlow: "OK" | "WEAK" | "UNKNOWN";
	captionQuality: "OK" | "SKIP" | "UNKNOWN";
	audioQuality: "OK" | "SKIP" | "UNKNOWN";
	joinQuality: "PASS" | "FAIL" | "NOT_RUN";
	durationObjective: "MET" | "PARTIAL" | "N_A";
	preservation: "OK" | "RISK" | "UNKNOWN";
	notes: string[];
	replanSuggested: boolean;
	revisionBudgetRemaining: number;
}
