/**
 * Professional Edit Execution Orchestrator V1 — contracts.
 */

export const PROFESSIONAL_EDIT_ORCHESTRATOR_V1_ID =
	"CURRENT_OPENSCREEN_PROFESSIONAL_EDIT_EXECUTION_ORCHESTRATOR_V1" as const;

export const PROFESSIONAL_EDIT_POLICY_VERSION = "v1.0" as const;

export type EditFamily =
	| "trim"
	| "zoom"
	| "crop"
	| "speed"
	| "captions"
	| "loudness"
	| "title"
	| "callout"
	| "transitions"
	| "other";

export type AutonomyLevel = "ask_once" | "you_decide" | "plan_only";

export interface ProfessionalEditIntentV1 {
	version: 1;
	rawText: string;
	requestedOutcome: "MAKE_PROFESSIONAL" | "MAKE_TIGHTER" | "CUSTOM";
	targetDurationSec: number | null;
	targetDurationMaxSec: number | null;
	targetDurationMinSec: number | null;
	preserveImportant: boolean;
	/** User authorized cutting some lower-value / supporting content toward a duration target. */
	allowOptionalContentRemoval: boolean;
	allowedFamilies: EditFamily[];
	requestedUnsupported: EditFamily[];
	/** Families the user explicitly asked for this turn (zoom/transitions/…). */
	explicitlyRequestedFamilies: EditFamily[];
	autonomy: AutonomyLevel;
	wantCaptions: boolean | "auto";
	wantAudioImprove: boolean | "auto";
	pacingPreference: "tighter" | "natural" | "unspecified";
}

export interface PackedEditorialSegmentV1 {
	id: string;
	startSec: number;
	endSec: number;
	speechText: string;
	visualSummary: string;
	activity: "none" | "low" | "medium" | "high" | "unknown";
	deadAirSec: number;
	preservation: "important" | "optional" | "expendable" | "uncertain";
	evidenceRefs: string[];
}

export interface PackedEditorialTranscriptV1 {
	version: 1;
	assetId: string;
	sourceDurationSec: number;
	segments: PackedEditorialSegmentV1[];
	buildMs: number;
}

export interface ProfessionalEditStoryV1 {
	version: 1;
	communicates: string;
	mustSurviveSpeech: string[];
	expendablePauses: Array<{ startSec: number; endSec: number; reason: string }>;
	majorVisualStates: string[];
	targetDurationSec: number | null;
	essentialRanges: Array<{ startSec: number; endSec: number; reason: string }>;
	optionalRanges: Array<{ startSec: number; endSec: number; reason: string }>;
	uncertainRanges: Array<{ startSec: number; endSec: number; reason: string }>;
	structureHint: string;
}

export type PlanStepReadiness =
	| "READY"
	| "STALE_REPLAN_REQUIRED"
	| "NO_LONGER_NEEDED"
	| "BLOCKED"
	| "MISSING_ARGS"
	| "UNSUPPORTED";

export interface ProfessionalEditPlanStepV1 {
	stepId: string;
	family: EditFamily;
	reason: string;
	sourceStartSec?: number;
	sourceEndSec?: number;
	programmeHintSec?: number;
	operationType: string;
	operationArgs: Record<string, unknown>;
	evidenceRefs: string[];
	preservationRefs: string[];
	expectedEffect: string;
	executionReadiness: PlanStepReadiness;
	verificationRequirement: "apply_preview" | "loudness_settings" | "none";
	order: number;
	optional: boolean;
	proposalItemId?: string;
}

export interface ProfessionalEditPlanV1 {
	version: 1;
	planId: string;
	planFingerprint: string;
	intent: ProfessionalEditIntentV1;
	steps: ProfessionalEditPlanStepV1[];
	requestedButUnsupported: EditFamily[];
	maxOperations: number;
	summary: string;
}

export type DurationObjectiveKind =
	| "ACHIEVABLE_SAFE"
	| "ACHIEVABLE_WITH_OPTIONAL_CONTENT_REMOVAL"
	| "NOT_ACHIEVABLE_WITHOUT_IMPORTANT_CONTENT_LOSS"
	| "INSUFFICIENT_EVIDENCE";

export interface DurationObjectiveAssessmentV1 {
	kind: DurationObjectiveKind;
	originalDurationSec: number;
	targetMaxSec: number | null;
	projectedSafeDurationSec: number;
	removableSafeSec: number;
	notes: string[];
}

export interface PlanAuthorizationV1 {
	planFingerprint: string;
	authorizedAtIso: string;
	sourcePhrase: string;
	scope: "bounded_plan_execution";
	valid: boolean;
}

export interface StepExecutionReceiptV1 {
	stepId: string;
	status: "committed" | "rolled_back" | "skipped" | "failed" | "blocked";
	reason: string;
	documentFingerprintBefore: string;
	documentFingerprintAfter: string | null;
	verificationNotes: string[];
}

export interface ProfessionalEditExecutionSessionV1 {
	sessionId: string;
	originalDocumentFingerprint: string;
	currentDocumentFingerprint: string;
	planFingerprint: string;
	authorization: PlanAuthorizationV1 | null;
	completed: StepExecutionReceiptV1[];
	skipped: StepExecutionReceiptV1[];
	failed: StepExecutionReceiptV1[];
	contextInvalidations: number;
	finalProgrammeDurationSec: number | null;
	operationBudget: number;
	operationsUsed: number;
	/** Loudness settings-path receipt (not ApplyPreview). */
	loudnessReceipt?: {
		terminalStatus: string;
		verificationNotes: string[];
		family: "loudness";
		appliedGainDb?: number | null;
	} | null;
}

export interface ProfessionalEditFinalAssessmentV1 {
	requestedObjective: string;
	achievedDurationSec: number | null;
	originalDurationSec: number;
	importantContentPreserved: boolean | "unknown";
	operationsApplied: string[];
	operationsSkipped: Array<{ family: string; reason: string }>;
	unsupportedRequested: EditFamily[];
	finalSequenceQc: "PASS" | "PASS_WITH_WARNINGS" | "FAIL" | "INSUFFICIENT_EVIDENCE" | "NOT_RUN";
	warnings: string[];
	anotherPassUseful: boolean;
	userFacingSummary: string;
	/** Quality Closure V1 */
	professionalKind?:
		| "TECHNICALLY_VERIFIED"
		| "PROFESSIONALLY_IMPROVED"
		| "NO_MATERIAL_IMPROVEMENT_AVAILABLE"
		| "NEEDS_REVIEW";
	warningDispositions?: import("./warningDisposition").FinalSequenceWarningDispositionV1[];
	capabilityUtilization?: import("./utilization").ProfessionalEditCapabilityUtilizationV1;
}

export interface TargetedInvestigationResultV1 {
	question: string;
	range: { startSec: number; endSec: number };
	focalFound: boolean;
	focal?: { cx: number; cy: number; kind: string };
	notes: string[];
	additionalDecodePasses: number;
	evidenceRefs: string[];
}

export interface ProfessionalEditOrchestratorResultV1 {
	providerId: typeof PROFESSIONAL_EDIT_ORCHESTRATOR_V1_ID;
	intent: ProfessionalEditIntentV1;
	packed: PackedEditorialTranscriptV1;
	story: ProfessionalEditStoryV1;
	duration: DurationObjectiveAssessmentV1;
	plan: ProfessionalEditPlanV1;
	authorization: PlanAuthorizationV1 | null;
	session: ProfessionalEditExecutionSessionV1;
	document: import("../../../src/lib/ai-edition/schema").AxcutDocument;
	finalSequenceQc:
		| import("../finalSequenceCutQualityVerify").FinalSequenceCutQualityResultV1
		| null;
	assessment: ProfessionalEditFinalAssessmentV1;
	userFacingText: string;
	needsUserAuthorization: boolean;
	capabilityUtilization: import("./utilization").ProfessionalEditCapabilityUtilizationV1;
	loudness: import("./loudnessCoord").LoudnessCoordinationResultV1 | null;
	focalAnalysis: import("../editorialFocalEvidence").EditorialFocalAnalysisBundleV1 | null;
	decisionTable: import("./decisionTable").ProfessionalFamilyDecisionV1[];
	/** Local Professional Editorial Planner V1 output (Temporal Context consumed). */
	planner: import("../professionalEditorialPlanner").ProfessionalEditorialPlannerResultV1 | null;
	/** Autonomous Professional Editor / Director layer (V1). */
	autonomous?: {
		sourceStory: import("../autonomousProfessionalEditor").MultimodalSourceStoryV1;
		targetStory: import("../autonomousProfessionalEditor").TargetEditStoryV1;
		intentPlan: import("../autonomousProfessionalEditor").EditorialIntentPlanV1;
		compiled: import("../autonomousProfessionalEditor").CompiledIntentResultV1[];
		selfReview: import("../autonomousProfessionalEditor").FinalResultSelfReviewV1 | null;
		finalEditorialQualityReview?: import("../autonomousProfessionalEditor/finalEditorialQualityReview").FinalEditorialQualityReviewV1;
		transformationDecisions?: import("../autonomousProfessionalEditor/transformationDecision").EditorialTransformationDecisionV1[];
		revisionUsed?: number;
		transformationSummary?: import("./transformationSummary").ProfessionalEditTransformationSummaryV1;
		skillConsideration?: import("./transformationSummary").SkillConsiderationRowV1[];
		editorialPauseDecisions?: import("./editorialPause").EditorialPauseDecisionV1[];
		readableStories?: {
			sourceStoryMd: string;
			targetStoryMd: string;
			storyDiffMd: string;
		};
		videoProblemMap?: import("../autonomousProfessionalEditor/videoProblemMap").VideoProblemMapV1;
		grounding?: {
			projectId: string;
			assetId: string;
			mediaPath: string | null;
			documentFingerprintBefore: string;
			documentFingerprintAfter: string;
			mediaFingerprint: string;
		};
	};
	warningDispositions: import("./warningDisposition").FinalSequenceWarningDispositionV1[];
	metrics: {
		paidAiCalls: 0;
		autoUnverifiedMutations: 0;
		totalMs: number;
		stepsCommitted: number;
		stepsRolledBack: number;
		visualAnalysisRan?: boolean;
		temporalContextConsumed?: boolean;
	};
}
