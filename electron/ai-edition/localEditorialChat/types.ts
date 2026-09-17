/**
 * LocalEditorialRequestV1 — Chat as a local-first control surface.
 * Concepts, not raw strings. No LLM required to parse or route.
 */

export const LOCAL_EDITORIAL_INTENTS = [
	"PROFESSIONALIZE",
	"TARGET_DURATION",
	"RELAX_PRESERVATION_FOR_TARGET_DURATION",
	"REMOVE_PAUSES",
	"SHORTEN_PAUSES",
	"CHANGE_PACING",
	"SPEED_UP",
	"SLOW_DOWN",
	"ADD_ZOOM",
	"REMOVE_ZOOM",
	"ADJUST_ZOOM",
	"CROP",
	"REMOVE_CROP",
	"CAPTIONS",
	"ENABLE_CAPTIONS",
	"CAPTION_STYLE",
	"CORRECT_CAPTION",
	"TITLE",
	"ADJUST_TITLE",
	"REMOVE_TITLE",
	"CALLOUT",
	"ADJUST_CALLOUT",
	"REMOVE_CALLOUT",
	"TRANSITION",
	"ADJUST_TRANSITION",
	"REMOVE_TRANSITION",
	"AUDIO_LEVEL",
	"REMOVE_EDIT",
	"UNDO_LAST_EDIT",
	"RESTORE_PREVIOUS",
	"PRESERVE_RANGE",
	"REMOVE_RANGE",
	"REVISE_PREVIOUS_EDIT",
	"MULTI_FAMILY_VISUAL",
	"UNKNOWN",
] as const;

export type LocalEditorialIntent = (typeof LOCAL_EDITORIAL_INTENTS)[number];

export type DurationTargetHardness = "PREFERENCE" | "STRONG" | "MUST" | null;

export type EditFamilyRequest =
	| "trim"
	| "speed"
	| "zoom"
	| "transitions"
	| "captions"
	| "title"
	| "callout"
	| "crop"
	| "loudness";

export type LocalRouteClass =
	| "LOCAL_RESOLVED"
	| "LOCAL_PARTIAL"
	| "SEMANTIC_ESCALATION_REQUIRED"
	| "UNSUPPORTED";

export type RelativeAdjustment =
	| "MORE_AGGRESSIVE"
	| "LESS_AGGRESSIVE"
	| "A_LITTLE"
	| "MORE"
	| "LESS"
	| null;

export type PreserveClass =
	| "IMPORTANT_EXPLANATION"
	| "IMPORTANT_ACTION"
	| "SPEECH"
	| "INTRODUCTION"
	| "NATURAL_BREATHING"
	| null;

export interface LocalEditorialRequestV1 {
	version: 1;
	rawText: string;
	intent: LocalEditorialIntent;
	/** Secondary intents when one utterance packs multiple (e.g. duration + preserve). */
	secondaryIntents: LocalEditorialIntent[];
	target: string | null;
	constraints: string[];
	preserve: PreserveClass[];
	durationTargetSec: number | null;
	durationTargetMaxSec: number | null;
	durationHardness: DurationTargetHardness;
	/** User explicitly allowed cutting some lower-value content to hit a duration. */
	relaxPreservationForDuration: boolean;
	requestedFamilies: EditFamilyRequest[];
	relativeAdjustment: RelativeAdjustment;
	referencedPreviousEdit:
		| "last_zoom"
		| "last_speed"
		| "last_trim"
		| "last_title"
		| "last_callout"
		| "last_transition"
		| "last_caption"
		| "last_edit_batch"
		| "previous_document"
		| "lower_value_content"
		| null;
	range: {
		startSec: number;
		endSec: number;
		singleTimestamp?: boolean;
		relativeEdge?: "first" | "last" | null;
		nearTimestamp?: boolean;
	} | null;
	/**
	 * Zoom concept slots (compositional).
	 * DIRECT path uses these; AUTONOMOUS path leaves direction null / authorization propose.
	 */
	zoomDirection: "in" | "out" | "reset" | null;
	/** Absolute depth 1–6 when user named intensity / scale. */
	zoomDepth: 1 | 2 | 3 | 4 | 5 | 6 | null;
	/** Absolute scale when user said e.g. 1.5x (mapped onto nearest depth when applied). */
	zoomScale: number | null;
	/**
	 * Explicit playback multiplier when user said e.g. 2x / 0.75x.
	 * Null = use product default for SPEED_UP (1.5) or SLOW_DOWN (0.75).
	 */
	speedMultiplier: number | null;
	/**
	 * Caption style / layout op for CAPTION_STYLE (size, position, density, readability).
	 */
	captionStyleOp:
		| "smaller"
		| "larger"
		| "higher"
		| "lower"
		| "bottom"
		| "top"
		| "center"
		| "easier_read"
		| "fewer_words"
		| "longer_on_screen"
		| null;
	/** Caption text correction: replace `from` (optional) with `to`. */
	captionTextReplace: { from: string | null; to: string } | null;
	/** Optional programme/source second for grounding “this caption”. */
	captionAtSec: number | null;
	/** Explicit title / overlay text when user quoted it. */
	titleText: string | null;
	/** beginning / end placement when user said so. */
	titlePlacement: "beginning" | "end" | null;
	/** Relative title style / timing op. */
	titleStyleOp:
		| "bigger"
		| "smaller"
		| "higher"
		| "lower"
		| "center"
		| "top"
		| "longer"
		| "shorter"
		| "earlier"
		| "later"
		| null;
	/** Explicit callout label text when user quoted it. */
	calloutText: string | null;
	/** Relative callout style / timing / position op. */
	calloutStyleOp:
		| "bigger"
		| "smaller"
		| "higher"
		| "lower"
		| "left"
		| "right"
		| "longer"
		| "shorter"
		| "earlier"
		| "later"
		| null;
	/** CUT | DISSOLVE when user named a supported transition type. */
	transitionKind: "cut" | "dissolve" | null;
	/** Dissolve half-window seconds when explicit. */
	transitionDurationSec: number | null;
	/** Relative transition duration / type op. */
	transitionStyleOp:
		| "shorter"
		| "longer"
		| "quicker"
		| "slower"
		| "to_dissolve"
		| "to_cut"
		| "to_fade"
		| "other_direction"
		| "list_available"
		| null;
	/** Optional programme playhead for nearest-join targeting. */
	playheadProgrammeSec?: number | null;
	/** How focus was / should be chosen for DIRECT zoom-in. */
	zoomFocusSource: "user" | "cursor" | "focal" | "center" | "click" | "dwell" | null;
	/** Explicit user focus point when supplied. */
	zoomUserFocus: { cx: number; cy: number } | null;
	/** EXECUTE = user authorized the edit; PROPOSE = autonomous usefulness gate. */
	zoomAuthorization: "execute" | "propose" | null;
	/** User-described event cue ("when I switch to the landing page") for WHERE resolution. */
	semanticEventCue: string | null;
	confidence: number;
	requiresSemanticReasoning: boolean;
	localCapabilityAvailable: boolean;
	/** How the router should execute. */
	executionKind:
		| "professional_orchestrator"
		| "direct_document"
		| "session_restore"
		| "constraint_only"
		| "semantic_understanding"
		| "escalate_cloud"
		| "none";
	routeClass: LocalRouteClass;
	/** Normalized message to feed existing professional orchestrator (0 LLM). */
	orchestratorMessage: string | null;
	/** True when resolved using prior turn session state. */
	resolvedFromConversation: boolean;
	/**
	 * Deterministic high-confidence match vs unresolved (needs brain) vs reasoned.
	 * UNRESOLVED is not KEEP / not-an-edit / unsafe.
	 */
	parseStatus: "HIGH_CONFIDENCE" | "UNRESOLVED" | "REASONED";
	/** Editorial authority for KEEP-bypass and confirmation semantics. */
	authority: "USER_EXPLICIT" | "USER_CONFIRMED" | "AUTONOMOUS" | "ADVISORY" | null;
	/** High-level semantic goal when known. */
	semanticGoal:
		| "EXPLICIT_EDIT"
		| "PROFESSIONALIZE"
		| "IMPROVE_PACING"
		| "EMPHASIZE"
		| "SHORTEN"
		| "RECOMMEND"
		| "INSPECT"
		| "CONFIRM_PENDING"
		| "REJECT_PENDING"
		| "MODIFY_PENDING"
		| "UNKNOWN"
		| null;
	/** Validated SemanticSkillRequest when brain or deterministic mapping produced one. */
	semanticSkillRequest: import("./semanticContract").SemanticSkillRequestV1 | null;
}

export interface DurationConstraintDecisionV1 {
	version: 1;
	requestedDurationSec: number | null;
	currentDurationSec: number;
	safeAchievableDurationSec: number;
	targetAchievable: boolean;
	operationsConsidered: string[];
	operationsApplied: string[];
	protectedContentPreventingTarget: string[];
	notes: string[];
}

export interface LocalEditorialSessionRevisionV1 {
	atIso: string;
	prompt: string;
	intent: LocalEditorialIntent;
	document: import("../../../src/lib/ai-edition/schema").AxcutDocument;
	documentFingerprint: string;
	committedFamilies: string[];
	userFacingText: string;
}

export interface LocalEditorialSessionStateV1 {
	projectId: string;
	assetId: string | null;
	constraints: string[];
	preserve: PreserveClass[];
	latestPlanId: string | null;
	committedOperations: string[];
	revisions: LocalEditorialSessionRevisionV1[];
	durationTargetSec: number | null;
	durationHardness: DurationTargetHardness;
	/** User authorized cutting some lower-value content toward the duration target. */
	userRelaxedPreservation: boolean;
	currentProgrammeDurationSec: number | null;
	lastAssistantDecision: string | null;
	lastWithheldReason: string | null;
	requestedFamilies: EditFamilyRequest[];
	originalUserGoal: string | null;
	/**
	 * Pending proposed/resolved edit awaiting confirmation ("yes" / "go ahead").
	 * In-memory only for this process — does not survive app restart.
	 */
	pendingProposal: LocalEditorialPendingProposalV1 | null;
}

export type PendingActionStatusV1 =
	| "PROPOSED"
	| "MODIFIED"
	| "CONFIRMED"
	| "REJECTED"
	| "EXECUTED"
	| "STALE";

export interface LocalEditorialPendingProposalV1 {
	kind:
		| "direct_zoom"
		| "orch_plan"
		| "advice_zoom"
		| "advice_callout"
		| "advice_title"
		| "advice_speed"
		| "advice_trim"
		| "advice_transition"
		| "semantic_edit";
	summary: string;
	documentFingerprint: string;
	createdAtIso: string;
	/**
	 * Resolved apply range. Zoom advice stores RAW virtual seconds; callout/title/
	 * speed/trim/transition advice stores programme (compressed) seconds —
	 * see parameters.rangeClock.
	 */
	range: { startSec: number; endSec: number } | null;
	zoomDepth: 1 | 2 | 3 | 4 | 5 | 6 | null;
	evidenceRefs: string[];
	/** Orchestrator plan fingerprint when kind is orch_plan. */
	planFingerprint: string | null;
	families: EditFamilyRequest[];
	semanticEventCue: string | null;
	/** Frozen WHAT from understanding (optional for legacy pending). */
	semanticSkillRequest?: import("./semanticContract").SemanticSkillRequestV1 | null;
	requiresConfirmation?: boolean;
	status?: PendingActionStatusV1;
	parameters?: {
		zoomDepth?: 1 | 2 | 3 | 4 | 5 | 6 | null;
		speedMultiplier?: number | null;
		intensity?: "stronger" | "weaker" | null;
		/** Intent the frozen executor must use on confirm (not always ADD_ZOOM). */
		executeIntent?: LocalEditorialIntent | null;
		titleText?: string | null;
		calloutText?: string | null;
		/** How `range` is clocked for apply. Default raw for zoom kinds. */
		rangeClock?: "raw" | "programme" | null;
		/** Transition pending may pin a near-timestamp join probe. */
		nearTimestamp?: boolean | null;
		/** Clip id for the stored transition join (structural validate on confirm). */
		transitionClipId?: string | null;
		/** Exact programme join second stored at propose time. */
		joinProgrammeSec?: number | null;
		/** Frozen transition kind chosen at propose (confirm must not re-parse "yes"). */
		transitionKind?: "cut" | "dissolve" | null;
	};
}
