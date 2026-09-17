// ponytail: port of axcut's AxcutDeepAgentService (apps/server/src/services/
// axcut-deep-agent.ts). Wraps LangChain's `createAgent` (LangGraph ReAct graph)
// with our existing document tools and emits agent.text / agent.toolStart /
// agent.toolEnd / agent.error events into a sink the chat-service pipes through
// `webContents.send`.
//
// It used to wrap `createDeepAgent` from the `deepagents` package. That factory
// stacks three middlewares unconditionally — filesystem, todo-list, sub-agents —
// which handed the model EIGHT extra tools (ls / read_file / write_file /
// edit_file / glob / grep / write_todos / task) bound to an EMPTY in-memory
// backend, plus ~5 800 characters of system prompt promising a filesystem this
// app does not have. Nothing here used any of it, and the cost was not
// cosmetic: asked what cursor telemetry the project holds, the model ran
// `ls {"path":"/"}` then `glob {"pattern":"**/*"}` against that empty sandbox
// and reported, in good faith, that the project contains no pointer data. A
// fabricated proof of absence. `createDeepAgent` has no option to drop those
// middlewares (they are in `REQUIRED_MIDDLEWARE_NAMES`), so the fix is to stop
// going through it: `createAgent` is what it wrapped, minus the sandbox.

import { existsSync } from "node:fs";
import { anthropicPromptCachingMiddleware, createAgent, tool } from "langchain";
import { z } from "zod";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
// ponytail: the legend is DERIVED from the depth→scale table, not retyped. Both
// tool descriptions used to assert "depth 1–6 maps to 1.0×–3.5×" — a formula
// (`depth/2 + 0.5`) that was purged from two rendering sites and survived here,
// wrong at both ends of a table that actually runs 1.25× to 5.0×.
import { ZOOM_DEPTH_LEGEND } from "../../../src/lib/ai-edition/timeline/zoom-scale";
import { candidateBinaryPaths } from "../../stt/gpuDetector";
import { getSttManager } from "../../stt/index";
import {
	addAnnotationArgs,
	addAudioArgs,
	addCameraFullscreenArgs,
	addClipArgs,
	addGraphicArgs,
	addSpeedArgs,
	addTrimArgs,
	addTrimsArgs,
	addZoomArgs,
	addZoomsArgs,
	type CursorTelemetryLoad,
	documentSnapshotForModel,
	executeAgentTool,
	exportProjectArgs,
	generateCaptionsArgs,
	getCursorTrackArgs,
	getTranscriptArgs,
	getTranscriptRangeArgs,
	getTranscriptWordsArgs,
	isMutatingTool,
	listSourcesArgs,
	moveClipArgs,
	recordScreenArgs,
	removeClipArgs,
	removeModifierArgs,
	removeTrimArgs,
	replaceTimelineArgs,
	resolveCursorAssetId,
	setAnnotationArgs,
	setAspectRatioArgs,
	setAudioArgs,
	setBackgroundArgs,
	setCameraFullscreenArgs,
	setClipCropArgs,
	setClipRangeArgs,
	setSpeedArgs,
	setTrimArgs,
	setWordTextArgs,
	setZoomArgs,
} from "../agent-tools";
import {
	APPLY_PREVIEW_V1_PROVIDER_ID,
	type ApplyPreflight,
	prepareApplyPreviewDiagnostics,
} from "../applyPreview";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import { buildClaimPromotionSet, type ClaimPromotionSet } from "../claimPromotion";
import {
	type ContextTelemetryV1,
	emptyContextTelemetry,
	estimateCostUsd,
	estimateImageTokens,
	extractUsageFromChatModelEnd,
	GPT4O_PRICING,
	measureTextComponent,
	measureUserMessageParts,
} from "../contextTelemetry";
import { type EditGapV1, prepareEditGapForTurn } from "../editGap";
import {
	appendTrustedEditorialBriefing,
	buildTrustedEditorialBriefing,
	enforceFinalPlanConsistency,
} from "../editorialGrounding";
import {
	type EditorialRecommendationProductSurfaceResult,
	runEditorialRecommendationProductSurface,
} from "../editorialRecommendationProductSurface";
import { type EditPlanV1, prepareEditPlanForTurn } from "../editPlan";
import { type EditProposalV1, prepareEditProposalForTurn } from "../editProposal";
import { verifyAndSanitizeUserFacingNarration } from "../groundedDiagnosis";
import { mediaDirsFromDocument, shouldGrantLocalWatch } from "../local-agents";
import {
	applyLocalEditorialControlWithBrain,
	classifyLocalEditorialTurn,
	clearLocalEditorialPendingProposal,
	getLocalEditorialPendingProposal,
	recordProfessionalOrchestratorLocalOutcome,
	setLocalEditorialPendingProposal,
	shouldHandleLocalEditorialWithoutCloud,
} from "../localEditorialChat";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import {
	bindFinalResponseToTransactionTruth,
	emptyMutationTelemetry,
	type MutationMode,
	type MutationTelemetry,
	resolveMutationAuthority,
} from "../mutationAuthority";
import { type PlanningClosureResult, preparePlanningClosureForTurn } from "../planningClosure";
import {
	isProfessionalEditRequest,
	type PlanAuthorizationV1,
	type ProfessionalEditOrchestratorResultV1,
	runProfessionalEditOrchestrator,
	stripFalseProjectEditsDisabledClaim,
	stripRepeatedProceedAsks,
	stripUnsupportedTransitionClaims,
} from "../professionalEditOrchestrator";
import {
	appendSourceStoryToUserMessage,
	constrainSourceStoryWithV2,
	parseAndValidateSourceStory,
	prepareSourceStoryForTurn,
	type SourceStory,
	type SourceStoryV2,
	sourceStoryFromV2,
} from "../sourceStory";
import {
	prepareSpeechEvidenceForTurn,
	resolveInjectedSpeechStatus,
	type SpeechEvidence,
	speechStatusPromptGuidance,
	stripInternalEvidenceJsonBlocks,
} from "../speechEvidence";
import {
	appendTargetStoryToUserMessage,
	constrainTargetStoryWithV1,
	parseAndValidateTargetStory,
	prepareTargetStoryForTurn,
	type TargetStory,
	type TargetStoryV1,
	targetStoryFromV1,
} from "../targetStory";
import { applyChatFollowUpEditControl, isChatFollowUpEditControl } from "./chatFollowUpEditControl";
import {
	answerChatPriorEditExplain,
	isChatPriorEditExplainRequest,
	rememberProfessionalSessionReceipt,
} from "./chatProfessionalSessionReceipt";

/** Durable plan authorization across chat turns (same project). */
const professionalEditAuthByProject = new Map<string, PlanAuthorizationV1>();

export function clearProfessionalEditAuthorizationCache(): void {
	professionalEditAuthByProject.clear();
}

import {
	appendReasoningPacketToUserMessage,
	applyBoundedResponseValidators,
	applyRequiredModalitiesToNeeds,
	assertReasoningPacketDelivered,
	buildBoundedProjectProjection,
	buildBoundedSystemPrompt,
	buildReasoningPacketV1,
	type CognitionPhase,
	extractProviderBoundUserText,
	resolveCognitionPhase,
	resolveDeterministicFastPath,
	resolveRequiredModalities,
	resolveToolNeedPolicy,
	type SpeechMediaState,
	selectBoundedHistoryConstraints,
	serializeReasoningPacket,
	type ToolNeedPolicy,
	toolGateFromPolicy,
} from "../reasoningPacket";
import { buildLedgerFromPreparedEvidence, type TemporalEventLedger } from "../temporalEventLedger";
import { buildEditReviewAttachment, type EditReviewAttachment } from "../uiConsent";
import { userFacingMediaNarrationGuidance } from "../userFacingNarration";
import {
	appendInvestigatorToUserMessage,
	type InvestigationEvidenceSet,
	runMasterVideoInvestigatorV1_1,
	userFacingLeaksInvestigatorInternals,
} from "../videoInvestigator";
import {
	buildVideoMemoryV1,
	classifyVideoMemoryQuery,
	fingerprintProgramme,
	fingerprintSourceAsset,
	retrieveFromVideoMemory,
	type VideoMemoryQueryClass,
	type VideoMemoryV1,
} from "../videoMemory";
import { buildCompactSystemPrompt } from "../videoMemory/compactSystem";
import {
	formatCoverageBriefing,
	speechAlignmentTimes,
	type VisualEvidenceCoverage,
} from "../videoMemory/coverage";
import { frameBudgetForQuery, selectFramesForRetrieval } from "../videoMemory/framePolicy";
import {
	appendPackedContextToUserMessage,
	packProviderContextFromMemory,
} from "../videoMemory/packProviderContext";
import {
	type AttachedFrameMeta,
	BOUNDED_REASONING_V1_ID,
	type ContextPackingMode,
	isBoundedReasoningPacking,
	isCompactPacking,
	isMemoryBackedPacking,
	isRetrievalPacking,
	resolveContextPackingMode,
	VIDEO_MEMORY_RETRIEVAL_CLOSURE_V1_ID,
	VIDEO_MEMORY_RETRIEVAL_PRODUCTION_V1_ID,
} from "../videoMemory/productionPath";
import { classifyQueryScope } from "../videoMemory/queryScope";
import {
	getDefaultVideoMemorySessionStore,
	mergeProgrammeStoryForPut,
	type VideoMemorySessionStore,
} from "../videoMemory/sessionStore";
import { evaluateEvidenceSufficiency } from "../videoMemory/sufficiency";
import { filterToolsByGate, toolGateForQuery } from "../videoMemory/toolGate";
import { prepareVisualEvidenceForTurn } from "../visualEvidence";
import { buildVisualEvidenceUserContent, toAgentUserMessage } from "../visualEvidence/attach";
import { interactionInstantsFromSamples } from "../visualEvidence/sample";
import {
	auditUserFacingSemanticLanguage,
	parseAndValidateVisualSemanticGrounding,
	semanticGroundingEvidenceFromPrepared,
	type VisualSemanticGrounding,
} from "../visualEvidence/semantic";
import {
	appendVisualSpecialistToLedger,
	mergeSpecialistIntoInvestigation,
	runReuseVisualV1,
	runVisualSpecialistV1,
	type VisualSpecialistResult,
} from "../visualSpecialist";
import {
	createOpenScreenChatModel,
	messageContentToText,
	messageContentToThinking,
	type OpenScreenChatModelConfig,
} from "./chat-model";
import {
	type AgentFailureReason,
	type AgentResponseStatus,
	classifyEmptyModelCompletion,
	classifyMissingUserFacingResponse,
	classifyProviderThrownError,
} from "./deliveryStatus";

export interface OpenScreenAgentSink {
	text: (delta: string) => void;
	/** Streaming delta from the model's reasoning block (Anthropic/MiniMax
	 * thinking). Provider-agnostic — for providers without thinking this is
	 * never called. The chat panel uses it to surface the reasoning phase
	 * that would otherwise be invisible "dead air" while the model thinks. */
	thinking: (delta: string) => void;
	toolStart: (name: string, args: unknown) => void;
	toolEnd: (name: string, ok: boolean, summary?: string) => void;
	error: (message: string) => void;
}

// The tool arg schemas live in agent-tools.ts (imported above) — one source of truth for
// both the executor's validation and the LangChain `tool()`s built here. Only the empty /
// inline read-tool schemas below stay local.

/**
 * The block appended when the user has turned "Project edits" off.
 *
 * ponytail: the executor's refusal is the wall (see `consentRequired` in
 * agent-tools.ts) but a wall alone does not fix the measured defect. The
 * workbench scores `dsl.consent.no-silent-edit` on the tool_calls the model
 * EMITS, not on what the executor did with them, so a turn that fires three
 * writes and has them all refused still reads as a silent-edit attempt — and
 * rightly: the model tried. Only the prompt can stop the emission. Two layers,
 * neither sufficient alone.
 */
const CONSENT_PROMPT_BLOCK = [
	"",
	"PROJECT EDITS ARE CURRENTLY DISABLED by the user, who asked to be consulted before the timeline changes.",
	"- Read freely: getCurrentDocument and getTranscript work as usual.",
	"- Do NOT call any tool that writes (addTrim, setTrim, setClipRange, addClip, setClipCrop, moveClip, replaceTimeline, add*/set* effects, remove*, recordScreen, generateCaptions, setAspectRatio, setBackground). Every one of them will be refused, so calling them wastes the turn and tells the user nothing.",
	"- Instead: say precisely what you would change — which tool, which times, which ids — and ask the user to confirm. Be specific enough that they can say yes to it.",
	"- Never state or imply that an edit was applied. If the user confirms and you are still refused, tell them the 'Project edits' setting in Settings → AI has to be re-enabled first.",
].join("\n");

/**
 * Semantic/editorial turns use proposal_only mutation authority even when Settings
 * "Project edits" is ON. Do NOT claim Settings is disabled — that was a product bug.
 */
const PROPOSAL_ONLY_PROMPT_BLOCK = [
	"",
	"MUTATION AUTHORITY: PROPOSAL_ONLY for this turn (Settings Project edits may still be ON).",
	"- Do NOT call write tools; they will be refused by mutation authority.",
	"- Propose reviewable edits and point to any Edit Review / Apply card.",
	"- If the user already said “yes proceed” / “you decide” for a bounded plan, do NOT ask “Would you like to proceed?” again.",
	"- NEVER say Project edits are disabled or ask them to re-enable Settings → AI unless you were explicitly told settingsEditsAllowed=false.",
	"- Do NOT promise clip-to-clip transitions; that field is not verified. Text enter animations (addAnnotation textAnimation) are different.",
	"- Never state an edit was applied unless a verified Apply Preview commit happened.",
].join("\n");

/** Honest family-level KEEP receipt when orch text was stripped empty. */
function buildFamilyKeepFallback(families: string[]): string {
	const bits: string[] = [];
	if (families.includes("transitions")) {
		bits.push(
			"I left transitions unchanged because the current programme doesn't have a join where a dissolve would improve the cut",
		);
	}
	if (families.includes("zoom")) {
		bits.push(
			"I left zooming alone because I couldn't ground a useful focus region on the current programme",
		);
	}
	if (bits.length === 0) {
		return "I reviewed this recording and did not find a safe verified change to apply yet.";
	}
	return `I reviewed the current cut. ${bits.join(". ")}.`;
}

// ponytail: exported so a test can assert that what the model receives is this
// string and NOTHING else — the deepagents regression was invisible precisely
// because the middlewares appended their prompts downstream of this constant.
const BASE_SYSTEM_PROMPT = [
	"You are OpenScreen's in-app agent. The user talks to you inside the app — not Cursor, not a terminal.",
	"You are connected to the local OpenScreen CLI engine. You can list capture sources, record a window or screen, transcribe captions, edit the timeline, and export.",
	"Help them record, cut silences, tighten pacing, add captions, reframe, and export.",
	"Be concise, action-oriented, and reference the timeline or transcript by time when relevant.",
	"You can call the tools below against the live document snapshot; the runtime executes each edit and feeds the result back into the loop.",
	"The AxcutDocument is the single source of truth. The timeline, the transcript editor, and the chat panel are all direct editors of the same document — when the user places a clip on the timeline, the document updates immediately, and when the timeline is empty, the document has no clips. Your edits operate on the live document, so preserve the user's placed clips.",
	"",
	"Time-bases (do not mix them up): clips and trims are in SOURCE-time seconds of an asset; zooms, speed regions, annotations and camera-fullscreen regions are in VIRTUAL (edited-timeline) seconds — the position on the ruler after clips + trims are applied. getCurrentDocument returns all of them, clearly labelled.",
	"",
	// ponytail: these describe what each tool is FOR, deliberately without quoting
	// user phrasings. A phrase→tool table reads as helpful and is not: it swaps the
	// model's language understanding for a lookup, so it covers the wordings we
	// happened to list and silently misses every paraphrase — and every language
	// other than English. Say what the tool does; let the model do the matching.
	"How the tools map to intent — pick the most specific one, and prefer the smallest edit that satisfies the request:",
	"- Silences, pauses and dead stretches are removed as trims INSIDE the placed clip. Send them together with addTrims once you know the ranges; addTrim is for a single cut or a correction. The placed clip stays the canonical cut; it is not rebuilt to drop them.",
	"- Changing where a clip starts or ends within its source is setClipRange — the clip's in/out, distinct from a trim. addClip places an unused recording already in this project onto the timeline (projectQueue.unusedAssets lists them; beforeClipId works like moveClip). setClipCrop sets a clip's cropRegion in 0–1 frame fractions; pass crop: null to clear it.",
	`- addZoom takes a virtual-timeline span (depth is an ordinal 1–6 selecting from a fixed table — ${ZOOM_DEPTH_LEGEND} — never a multiplier; focus in 0–1 frame fractions). addSpeed changes pacing over a span. addAnnotation puts text on screen and can set textAnimation (fade, rise, pop, slide-left, typewriter, pulse) — that is the official text enter animation, not a clip-to-clip video transition. This document has no clip-transition field; say so if asked. addGraphic creates a title, lower third, badge, CTA, bar, arrow, or image overlay and places it on the timeline — preview and export already composite it; there is no extra merge step. addCameraFullscreen enlarges the webcam, and only does something where assets[].hasCameraTrack is true.`,
	"- addAudio lays an imported voiceover or music file over a span. It plays an asset the project already has (kind 'audio'); importing or recording one is the editor's job, not a tool you have — so when the project has none, say so rather than naming an id that does not exist. gainDb and fadeInSec/fadeOutSec are the official level and fades. There is no multi-band EQ field; say so if asked.",
	"- moveClip changes the order of placed clips, one call per clip that moves, preserving ids, source ranges, trims and anchored effects. replaceTimeline rebuilds the timeline from kept intervals and sorts them, so it cannot reorder anything.",
	"- Deleting is a first-class action, not a workaround: removeTrim, removeModifier, removeClip. Never fake a deletion by re-adding an element or zeroing it out (span 0, speed 1×) — that leaves it in the document and misreports what you did.",
	"- listSources lists screens, windows and microphones the user can record. recordScreen starts a headless capture through the local CLI (pass window title or display index, and durationSec). generateCaptions runs on-device Whisper. exportProject renders MP4/GIF. setAspectRatio and setBackground change the output frame (e.g. 9:16) and wallpaper.",
	"- addAnnotation type 'text' is titles, labels and CTAs (Try Now, Visit …, Subscribe) — visual graphics in the export, not clickable links. type 'image' is a PNG/JPEG overlay (pass image as a data URI, or text to bake a plate). type 'figure' is an arrow callout. type 'blur' hides part of the recording (faces, logos, UI chrome) with a mosaic or blur cover — it does not reconstruct the background. Style with color, backgroundColor, fontSize and textAnimation.",
	"If nothing in the list does what was asked, say so; do not approximate it with a bigger tool.",
	"",
	"One-pass finish (promo, tutorial, demo, social post): read mediaCapabilities and mediaContext (textual outline) plus projectQueue; use getTranscript only if you need more speech detail; state a short plan grounded in THIS recording's evidence; apply the smallest tools only when the user has consented to edits and evidence supports the landing; re-read getCurrentDocument and report only what landed. Do not pretend you re-inspected pixels when mediaCapabilities.visualFrames is false. Dead air → addTrims only when transcript/silence evidence supports ranges. Portrait/social → setAspectRatio (9:16 / 1:1) plus crop or cursor-anchored zoom only when available evidence identifies a focus target — never invent faces/logos/buttons. Captions → generateCaptions, then setWordText for fixes. Ending CTA / title / lower third → addGraphic only when the request and evidence support it. Unused take → addClip from projectQueue.unusedAssets. Music → addAudio only when an audio asset exists; duck with gainDb over speech spans. Do NOT invent 'opening hook zooms', smart-zoom recipes, or generic professional-video tool lists when TRUSTED_EDITORIAL_PLAN is attached or when no grounded Edit Plan strategy prefers that family. Do not invent clip-to-clip transitions, saved templates, generated voice, brand kits, multi-band EQ, clickable links, or paid generation costs — those are not fields on this document.",
	"",
	"Trusted editorial chain (when TRUSTED_EDITORIAL_PLAN appears in the user message): Source Story → Target Story → Edit Gap → Edit Plan are authoritative for concrete edit families (zoom/trim/crop/caption/annotation/speed/graphic). Prefer honest 'no safe recording-specific edit yet' or 'needs more grounded evidence' over inventing zooms/trims. User intent does not override missing evidence.",
	"Mutation authority: on semantic/editorial turns, write tools refuse before changing the document. Propose via the Edit Review card; never claim an edit was applied unless the user approved Apply Preview.",
	"",
	"Evidence contract (read mediaCapabilities on the snapshot — do not invent channels):",
	"- timelineMetadata: you MAY confidently state facts present on AxcutDocument (durations, clip/trim ranges, zooms, annotations, aspect, effects, source↔virtual mapping).",
	'- cursorTelemetry: when true (or after getCursorTrack succeeds), you MAY state pointer coordinates, motion, timing, and interaction kinds the track records. You must NOT map a click at (cx,cy) to a named UI control (e.g. "Publish") — semanticUi is required for that, and it is false unless such evidence exists.',
	'- transcript: when true, you MAY quote/paraphrase spoken content from transcript data. When false/missing, do NOT claim there is no audio — missing transcript means transcription is unavailable or not run; only project facts that prove silence/no-mic support "no audio".',
	"- visualFrames: when false, you must NOT claim you watched the video, inspected frames, saw on-screen text/buttons, judged sharpness/exposure/color/composition from pixels, detected scene changes, or identified what appeared after a click. Say those conclusions are unavailable from current evidence. visibleMedia and mediaContext never make visualFrames true.",
	'- semanticUi: named control / OCR / a11y grounding. Cursor coords alone never authorize "clicked Publish".',
	"Stay useful: still execute deterministic edits supported by available evidence (e.g. delete 10.2–13.5s; zoom at a cursor click time when telemetry supports it). For requests that need unavailable visual/semantic evidence, say so (or ask) rather than inventing labels.",
	"",
	"Cursor telemetry: while the screen was captured, OpenScreen may have recorded where the pointer went. assets[].hasCursorTelemetry in getCurrentDocument says which assets carry it, and getCursorTrack returns positions over time and pointer shape — coordinates and timing, not UI labels.",
	"Blindness is not evidence for CURSOR/TRANSCRIPT tools: when a tool reports reason 'unavailable', that is a runtime limit, not proof the project lacks data. Only an explicit negative — reason 'no-sidecar', or hasCursorTelemetry false — supports telling the user that telemetry is absent. This rule does NOT grant visualFrames.",
	"",
	"Honesty rules: if a request has NO matching tool (e.g. deleting an asset/recording), say so plainly — do not substitute a different edit and report it as the requested one. After your edits, if you are at all unsure the document ended up as intended, call getCurrentDocument and reconcile what you claim with the real state; each tool result already tells you exactly what it did, so never report a change the results don't support.",
	"",
	"The open project's snapshot is attached to this turn. That is the timeline the user is looking at. Do not ask whether they have already added footage. When they ask to improve, tighten, caption, reframe, or export, use the tools on THIS document.",
	"visibleMedia lists recording files in the open project (inventory only). mediaContext is a textual/derived outline (kept spans, speech/silence, notes) rebuilt on open — not a visual inspection. Prefer mediaContext and mediaCapabilities for planning. Do not extract ffmpeg stills yourself unless the user asks to re-scan or a needed part is missing from textual evidence — OpenScreen may already attach sampled VISUAL EVIDENCE frames on this turn when mediaCapabilities.visualFrames is true. A transcript is optional for planning edits that do not need speech text; it is not visual understanding.",
	"",
	'When mediaCapabilities.visualFrames is true: the user message includes a bounded set of timestamped JPEG samples (periodic / cursor interaction / clip boundaries / optional change midpoints) plus measured adjacent transition markers (minimal / moderate / significant pixel-difference scores). You MAY describe what labelled frames show and how visible state differs across a transition (e.g. "around 5s the visible editor content changes from X to Y"). Transition markers mean pixels changed — not that a named control was used. You must NOT claim you inspected every frame, invent events between samples, or state exact click targets. Distinguish: (1) directly visible in a supplied frame, (2) inferred between samples, (3) timeline metadata, (4) cursor telemetry, (5) transcript. semanticUi remains false — reading text in a frame is opportunistic, not a validated UI index.',
	'When mediaCapabilities.visualSemanticEvidence is true (always with visualFrames): in the SAME turn, emit a turn-local VISUAL_SEMANTIC_GROUNDING JSON block (observations + transitions + staticRanges with coveredFrameTimes, referenceObservationTimeSec, layoutState, contentState) for INTERNAL structured grounding before the user-facing answer. Do NOT show that JSON to the user unless they explicitly ask for raw/structured data. Every attached frame timestamp must be covered. Every staticRange reference MUST match an observation — a new compressed semantic state needs an observation at that timestamp. Fully static compression only when layoutState and contentState are both stable; if layout is stable but visible content changes, say so (do not call it materially unchanged). Separate OBSERVED vs INFERRED. Use confidence high|medium|low honestly. Every moderate or significant measured pixel transition must appear in transitions (semantic cause may be uncertain). Prefer "Across the sampled frames…"; never "throughout the video" or "I inspected every frame". Prefer getTranscriptRange near visual events. ' +
		speechStatusPromptGuidance() +
		" Spoken words are not proof of named UI actions. visualSemanticEvidence does NOT make semanticUi true and must not be written into the project document.",
	"When mediaCapabilities.sourceStory is true: in the SAME turn, emit a turn-local SOURCE_STORY JSON block (overallSummary + storyBeats with purpose, SOURCE_MEDIA_TIME ranges, evidence provenance) for INTERNAL chronological understanding before the user-facing answer. Story is communication meaning — not a transcript dump, not one beat per frame, not an edit plan. Do NOT show SOURCE_STORY JSON to the user unless they ask for raw/structured data. Do not persist it to the project.",
	"When mediaCapabilities.targetStory is true: in the SAME turn AFTER SOURCE_STORY, emit a turn-local TARGET_STORY JSON block (objective, audienceExperience, editingIntent, targetBeats mapped to sourceBeatIds, preserve/change, optional uncertainties) describing the DESIRED VIEWER EXPERIENCE for the user's editing request. Not trim/zoom/crop/transition/tool commands. changeNeeded:false is valid when a source beat already fits. Do NOT invent missing source material. Do NOT execute edits. Do NOT show TARGET_STORY JSON to the user unless they ask for raw/structured data. Do not persist it to the project.",
	"",
	userFacingMediaNarrationGuidance(),
].join("\n");

const OPEN_PROJECT_PROMPT_BLOCK = [
	"",
	"OPEN PROJECT (live editor document — work on this, do not ask if it exists):",
].join("\n");

/** The system prompt for a turn. The open-project snapshot is optional so
 *  surface tests can still pin the static wording without a live document. */
export function buildSystemPrompt(options: {
	/** Settings → AI "Project edits" toggle (user preference). */
	editsAllowed: boolean;
	/**
	 * When Settings edits are ON but this turn is proposal_only / read_only,
	 * use the proposal-only block — never claim Settings is disabled.
	 */
	mutationMode?: "proposal_only" | "read_only" | "deterministic_edit" | "consented_apply";
	openProject?: Record<string, unknown>;
}): string {
	let base = BASE_SYSTEM_PROMPT;
	if (options.editsAllowed === false) {
		base = BASE_SYSTEM_PROMPT + CONSENT_PROMPT_BLOCK;
	} else if (options.mutationMode === "proposal_only" || options.mutationMode === "read_only") {
		base = BASE_SYSTEM_PROMPT + PROPOSAL_ONLY_PROMPT_BLOCK;
	}
	if (!options.openProject) return base;
	return `${base}${OPEN_PROJECT_PROMPT_BLOCK}\n${JSON.stringify(options.openProject)}`;
}

/** The prompt of a normal (edits-allowed) turn — the overwhelmingly common
 *  case, and the string the surface tests measure the wire against. */
export const SYSTEM_PROMPT = buildSystemPrompt({ editsAllowed: true });

export const TOOL_DESCRIPTIONS: Record<string, string> = {
	getCurrentDocument:
		"Read a compact snapshot of the current project: mediaCapabilities (which evidence channels you have), mediaContext (textual/derived outline — not pixels), visibleMedia (file inventory only), assets (with durations), timeline clips and trim ranges (source-time), projectQueue (open clips with full file vs placed vs edited duration, plus unusedAssets not on the timeline), and the zoom / speed / annotation effects (virtual, edited-timeline time). Call this before editing if the snapshot in the system prompt may be stale. Reuse mediaContext and mediaCapabilities; do not claim pixel inspection when visualFrames is false. The AxcutDocument is the single source of truth — your edits should preserve the user's placed clips and any timeline state they have already set up.",
	getTranscript:
		"Read transcript segments (speech and silence) in SOURCE media time for an asset. Optional startSec/endSec restrict to a window — prefer that near a visual event. Omit assetId for the primary asset. Times are source seconds, not virtual timeline. Speech text is not proof of a named UI click.",
	getTranscriptRange:
		"Read transcript segments overlapping a SOURCE-time window (startSourceTimeSec/endSourceTimeSec). Use this to correlate speech with a visual change or cursor event. Same evidence as getTranscript with a range — never invents visual facts from speech.",
	getCursorTrack:
		"Read the recorded pointer track for an asset: where the cursor was over time, downsampled to a readable rate. Each point carries atSec (the asset's own source clock), virtualSec (the same instant on the edited timeline — the coordinate addZoom takes, null when no clip carries it), cx/cy as 0–1 fractions of the frame, and `shape`, an index into the pointer bitmaps the recording used (equal values are the same pointer; a change means the pointer changed, e.g. arrow to text caret). Points that are not plain moves carry `kind`; points a trim cuts out of playback carry `trimmed`. These are real samples, not a summary — reading what the pointer was doing is yours. Omit assetId for the primary asset. It answers `available:false` in two DIFFERENT ways you must not confuse: reason 'no-sidecar' means this asset was checked and genuinely has no telemetry, while reason 'unavailable' means it could not be read from here.",
	getTranscriptWords:
		'Read the transcript one WORD at a time for an asset: each word\'s id, text, start/end seconds, and — only when it is not plain transcription — `source` ("user" for a word the user corrected, "synth" for one they typed in) and `originalText` (what the transcriber had heard before the correction). This is the ONLY read that gives you the ids setWordText takes; getTranscript answers in segments, whose ids belong to a different namespace and are not accepted there. A whole transcript is large, so pass startSec/endSec to read just the passage you mean to fix. Omit assetId for the primary asset.',
	setWordText:
		"Correct ONE word's text, by the id getTranscriptWords returns. This changes the TRANSCRIPT and nothing else: the captions follow it, the film is untouched and no audio is cut. Use it when the transcriber misheard something — a name, a technical term — and the user asks for it to read correctly. Passing an empty string BLANKS the word: it keeps its place in the media but leaves the captions, which is how a junk token like \"(inaudible)\" is removed without cutting the speech around it. Writing the transcriber's own text back clears the correction. This is NOT how you make a spoken word go away — that removes only the label and leaves the film saying it; use addTrim, which cuts the audio with it.",
	addTrim:
		"Add ONE trim range: a cut of a span inside a clip (this source-time span will not be played or exported) that does NOT split the clip. Times are in seconds of the asset's source time. This is the preferred (and for 'remove silences' requests, the only) way to handle silences; it preserves the user's placed clips and only adds a cut. When you have several cuts to make, use addTrims and send them together — this one is for a single cut or a later correction. A cut belongs to ONE clip: `clipId` is inferred when a single clip covers the range, but when several clips draw on the same asset over it the call FAILS and lists them — pass the `clipId` you mean (ids come from getCurrentDocument).",
	addTrims:
		"Add MANY trim ranges in one call: `ranges` is a list, each entry taking exactly the fields addTrim takes. Use this whenever you have more than one cut to make — 'remove the silences' on a half-hour recording is hundreds of cuts, and sending them one at a time costs one round trip each. Each range stands or falls ALONE: one that cannot be placed is refused by itself and listed in `refused` with its index and the reason, while every other range is still applied. Nothing is rolled back, so a single bad bound never costs you the rest. The result leads with requested / appliedCount / refusedCount so you can see a partial outcome without re-reading the document — report what was refused rather than claiming the whole list landed.",
	setTrim:
		"Move or resize an existing trim range by id. Times are source-time seconds. The cut follows to whichever clip the new range lands in, when that clip is unambiguous.",
	setClipRange:
		"Set a clip's in/out points (source-time seconds) to shorten its head or tail — distinct from a trim (which cuts a span inside the clip). All clips are re-laid back-to-back afterwards, so downstream clips shift automatically. Use this ONLY when the user explicitly asks to shorten or extend a user-placed clip. Do NOT use this for 'remove silences' or 'cut pauses' — for those, use addTrim.",
	addClip:
		"Place an unused recording already in this project onto the timeline as a new clip. assetId must name a video asset from getCurrentDocument — projectQueue.unusedAssets lists the ones not yet placed. beforeClipId works like moveClip (omit or null to put it last). Optional sourceStartSec/sourceEndSec crop the file's in/out; omit them to place the full file. This cannot import a file from disk. Audio assets belong on addAudio, not here.",
	setClipCrop:
		"Set a clip's cropRegion in 0–1 fractions of the source frame (x, y, width, height). Pass crop: null to restore the full frame. This is a per-clip crop, not a zoom — use addZoom when the picture should magnify over a span.",
	moveClip:
		"Reorder a placed clip: move `clipId` so it plays just before `beforeClipId` (pass null, or omit it, to move it last). Ids come from getCurrentDocument, where each clip carries its `index` and its label in `reason`. This preserves every clip id, every source range, every trim, and the zooms / speed regions / annotations anchored to each clip. This is the tool for 'swap these clips', 'put X first' and 'change the clip order' — replaceTimeline cannot reorder anything.",
	replaceTimeline:
		"Replace the whole timeline with the given kept intervals of the primary asset's source time. Everything outside the intervals becomes a trim. The intervals are SORTED, so this can never reorder clips — use moveClip for that. DO NOT use this for 'cut silences' or 'remove pauses' — the user has likely placed clips on the timeline that you'd be discarding. Use this ONLY when the user explicitly asks you to rebuild the timeline from scratch (e.g. 'start over with the kept intervals from the transcript'). It is refused when it would merge away, shorten or drop an existing clip; the refusal names them and the tool to use instead.",
	addZoom: `Add a zoom-in over a span of the edited timeline (virtual seconds). depth is an ORDINAL 1–6, not a factor: it selects a magnification from a fixed table (${ZOOM_DEPTH_LEGEND}), so the default depth 3 renders at 1.80×. The result reports renderedScale — quote that, never the depth, when telling the user how strong the zoom is. focus is the zoom centre in 0–1 fractions of the frame (default centre). When the recording's pointer telemetry can be read for the footage under the span, the result also carries \`cursorAnchor\`: \`focus\` echoes the value this call used (including the default, if you left it out), \`cursor\` is where the pointer ACTUALLY was over the span the zoom landed on — the median of the recorded samples, \`spread\` being how far the farthest one strays from it — and \`offset\` is the distance between the two, in frame fractions. It is a measurement, not a correction: nothing is moved and no call is refused over it, and a zoom framing a slide, a face, or a region the pointer never enters is a legitimate choice. \`available:false\` names what it found instead (\`no-samples\`, \`trimmed-out\`). Its ABSENCE means no telemetry was read for that footage — never that the recording has none; assets[].hasCursorTelemetry and getCursorTrack are what answer that. Use for 'zoom in on …' and the smart-zoom pass.`,
	addZooms: `Add MANY zooms in one call: \`regions\` is a list, each entry taking exactly the fields addZoom takes (same depth table, ${ZOOM_DEPTH_LEGEND}). Use this for the smart-zoom pass, where you have decided every zoom before emitting the first one — sending them one at a time costs one round trip each. Each region stands or falls ALONE: one that covers no clip is refused by itself and listed in \`refused\` with its index and the reason, while the others are still applied. The result leads with requested / appliedCount / refusedCount, and each applied entry carries its renderedScale — quote that, never the depth — plus the same \`cursorAnchor\` addZoom reports, whenever the footage under that region has readable pointer telemetry.`,
	setZoom: `Move, resize, or restyle an existing zoom by id (virtual-timeline seconds). Only the fields you pass are changed. depth selects from the same table (${ZOOM_DEPTH_LEGEND}); if the zoom carries a customScale (getCurrentDocument shows it as depthIsOverridden), that custom value is what renders, and passing depth clears it so the depth takes effect — the result says so. The result reports the resulting renderedScale, and — when the footage under the span has readable pointer telemetry — the same \`cursorAnchor\` addZoom reports, measured against the zoom's EFFECTIVE focus, so a call that moved only the span still learns what its unchanged focus is now looking at.`,
	addSpeed:
		"Add a speed-change region over a span of the edited timeline (virtual seconds). speed > 1 fast-forwards, < 1 slows down (default 1.5×). Use to speed through slow stretches without cutting them.",
	setSpeed:
		"Move, resize, or change the multiplier of an existing speed region by id (virtual-timeline seconds). Only the fields you pass are changed.",
	addAnnotation:
		"Add an on-screen graphic over a span of the edited timeline (virtual seconds). type is text (titles, labels, CTAs such as Try Now), image (PNG/JPEG overlay), figure (arrow callout) or blur (mosaic/blur a region). For image, pass image as a data URI, or text to bake a local plate. x/y/width/height are frame percentages (0–100). color, backgroundColor, fontSize, fontWeight and textAlign style a text/CTA. textAnimation is the official enter animation: none, fade, rise, pop, slide-left, typewriter, or pulse — not a clip-to-clip video transition. The graphic is already composited in preview and export. CTAs in the export are visual only; they are not clickable links.",
	addGraphic:
		"Create a graphic and place it on the footage (virtual seconds). kind is title, lowerThird, badge, cta, bar, figure (arrow), or image. text/subtext label it; image is an optional PNG/JPEG data URI for kind image (omit it to bake a local plate from the text). Layout defaults to a FlutterGo-style position; override with x/y/width/height (frame %). This writes an official annotation — preview and export already merge it onto the video. Prefer this over addAnnotation when the user asks for a title, CTA, lower third, badge, or logo.",
	setAnnotation:
		"Move, resize, restyle, or edit an existing annotation by id (virtual-timeline seconds). Only the fields you pass are changed. Style and textAnimation apply to text/CTA; image replaces an overlay's pixels (data URI); arrowDirection to a figure; blurKind/blurShape to a blur.",
	addCameraFullscreen:
		"Add a camera-fullscreen region over a span of the edited timeline (virtual seconds): the webcam fills the frame for that span. This only does something when the footage under that span comes from an asset with a linked webcam — check assets[].hasCameraTrack (or hasAnyCamera) in getCurrentDocument first. On footage with no camera the call is refused rather than storing a region that would render nothing; say so instead of retrying.",
	setCameraFullscreen:
		"Move or resize an existing camera-fullscreen region by id (virtual-timeline seconds). Only the fields you pass are changed. Refused if the new span lands on footage with no linked webcam.",
	addAudio:
		"Lay an ALREADY-IMPORTED audio file over the recording across a span of the edited timeline (virtual seconds): a voiceover, or a music bed. assetId must name an asset whose kind is 'audio' — getCurrentDocument lists them; nothing here can import a file from disk or record one, so if there is none, say so instead of guessing an id. Omit endSec to play the whole file from offsetSec. kind picks the lane ('voiceover' or 'music'). offsetSec is where in the FILE playback starts, gainDb its level (0 unchanged, negative ducks it), fadeInSec/fadeOutSec its official fades. There is no multi-band EQ. A voiceover-lane track is also what gets transcribed, so the lane is not only cosmetic.",
	setAudio:
		"Move, resize, re-level, fade, re-lane, mute, loop or re-point an existing audio track by id (virtual-timeline seconds). Only the fields you pass are changed. Use it to duck a bed under narration (gainDb), to fade in/out (fadeInSec/fadeOutSec), to shift what part of the file plays (offsetSec), or to move it between the voiceover and music lanes (kind). This is level and fade, not parametric EQ. The whole track is edited, not one fragment of it, so a track split across a cut stays one thing.",
	removeTrim:
		"Delete a trim range by id — the cut is undone and that span plays/exports again. This is how you 'remove a trim'; never re-add a trim to undo one.",
	removeModifier:
		"Delete a modifier (zoom / speed / annotation / camera-fullscreen / audio) by id; the kind is resolved from the id. This is how you 'remove'/'delete' one — never neutralise it (span 0, speed 1×), which leaves it in the document. For a trim use removeTrim; for a clip use removeClip.",
	removeClip:
		"Delete a placed clip by id; remaining clips close the gap and effects anchored to it are dropped. Use only when the user asks to remove a clip — to shorten one, use setClipRange.",
	setAspectRatio:
		"Set the project's output aspect ratio to a W:H token such as 9:16, 16:9, or 1:1. Preview and export both use this.",
	setBackground:
		"Set the wallpaper behind the recording: a bundled wallpaper index 1–18, a /wallpapers/wallpaperN.jpg path, a CSS color, or a CSS gradient.",
	listSources:
		"List capturable displays, windows and microphones on this computer via the local OpenScreen CLI. Use this before recordScreen so the user can pick a source.",
	recordScreen:
		"Record a window or display through the local OpenScreen CLI and replace the live project with that take. Pass window (title substring) or display (index from listSources). durationSec defaults to 15. Optional mic and systemAudio. This is how you start recording when the user asks — do not tell them you cannot record.",
	generateCaptions:
		"Transcribe the current project's audio on-device with Whisper and write caption annotations into the project. Re-running replaces earlier auto-captions.",
	exportProject:
		"Export the current project to MP4 or GIF through the local OpenScreen CLI (GPU compositor). Omit out to write under the app exports folder. quality is medium|good|source.",
};

// ponytail: mutable document holder so a write-tool that updates the snapshot
// is observed by the NEXT tool call inside the same agent turn. LangChain's
// `tool()` factory captures the document by reference via the holder, so
// each tool sees the latest mutated snapshot.
type DocumentHolder = { current: AxcutDocument };

/**
 * The runtime's door onto recorded cursor telemetry.
 *
 * ponytail: an INTERFACE, injected, because everything that can actually read a
 * sidecar lives behind Electron's path allow-list, and `electron/ai-edition/`
 * deliberately imports nothing from `electron`. It takes an assetId plus the
 * path the DOCUMENT already holds — never a path the model chose.
 *
 * When no reader is injected the tool answers "unavailable", which is honest and
 * useless; a reader that is wired everywhere except production would be a
 * quieter version of the bug being fixed, so `handlers.ts` is the one caller
 * that matters and there is a test for the unwired case.
 */
export interface CursorTelemetryReader {
	read(input: { assetId: string; originalPath: string | null }): Promise<CursorTelemetryLoad>;
	/** Cheap "is there a sidecar?" check, run once per turn for every asset so
	 *  `getCurrentDocument` can report `hasCursorTelemetry` without reading the
	 *  file. A reader may omit it; the snapshot then reports null (not checked). */
	probe?(input: { assetId: string; originalPath: string | null }): Promise<boolean>;
}

export interface CliEngineResult {
	ok: boolean;
	resultJson: string;
	document?: AxcutDocument;
	summary?: string;
}

export interface CliEngine {
	run(
		name: "listSources" | "recordScreen" | "generateCaptions" | "exportProject",
		args: unknown,
		document: AxcutDocument,
	): Promise<CliEngineResult>;
}

interface ToolRuntime {
	cursor?: CursorTelemetryReader;
	availableByAssetId?: Record<string, boolean>;
	cli?: CliEngine;
	visualFramesSupplied?: boolean;
}

const CLI_PROCESS_TOOLS: ReadonlySet<string> = new Set([
	"listSources",
	"recordScreen",
	"generateCaptions",
	"exportProject",
]);

/**
 * The tools whose RESULT depends on the recorded pointer track, so the async
 * wrapper knows to do the read before entering the synchronous executor.
 *
 * ponytail: the zoom writes are on this list, not only the reader. A `focus`
 * that nothing reports back on is a `focus` nobody can check — the write
 * answered `ok` whether it framed the pointer or the opposite corner. They pass
 * no assetId, so the read resolves to the primary asset and the executor reports
 * the anchor ONLY for fragments whose clip draws on that same asset: measured
 * against the right media, or left off, never inferred from the wrong one.
 *
 * No cache. The read is a local JSON parse, `addZooms` is what keeps a whole
 * zoom pass to one call rather than N, and nothing on this path memoises today —
 * a cache here would be one more thing to invalidate for a saving nobody has
 * measured.
 */
const TOOLS_READING_CURSOR: ReadonlySet<string> = new Set([
	"getCursorTrack",
	"addZoom",
	"addZooms",
	"setZoom",
]);

// One document tool: run it through the shared executor, advance the holder so
// the next tool in the turn sees the edit, and emit exactly ONE start/end pair
// carrying the executor's REAL verdict.
//
// ponytail: reads go through here too, and that is the point. The read tools
// used to emit nothing of their own and be announced only by the `on_tool_end`
// branch of the stream loop, which hard-coded `ok: true` — so a `getTranscript`
// that came back `{"error":"No transcript for asset …"}` was reported as a
// success, and every write was announced twice (once truthfully here, once as
// `ok: true` there). One factory, one pair, one verdict. `executeAgentTool`
// never throws, so `execution.ok` is the only honest signal available.
function documentTool<S extends z.ZodType>(
	holder: DocumentHolder,
	sink: OpenScreenAgentSink,
	name: string,
	schema: S,
	editsAllowed: boolean,
	runtime: ToolRuntime,
	mutationMode: MutationMode,
	telemetry: MutationTelemetry,
) {
	return tool(
		async (args: z.infer<S>) => {
			sink.toolStart(name, args);
			if (isMutatingTool(name)) {
				telemetry.mutatingToolsAttempted.push(name);
			}
			if (CLI_PROCESS_TOOLS.has(name) && runtime.cli) {
				if (
					(editsAllowed === false ||
						mutationMode === "proposal_only" ||
						mutationMode === "read_only") &&
					isMutatingTool(name)
				) {
					const execution = executeAgentTool(holder.current, name, JSON.stringify(args), {
						editsAllowed: false,
						mutationMode,
					});
					if (!execution.ok && isMutatingTool(name)) {
						try {
							const parsed = JSON.parse(execution.resultJson) as { code?: string };
							telemetry.mutatingToolsRejected.push({
								name,
								code: parsed.code ?? "refused",
							});
						} catch {
							telemetry.mutatingToolsRejected.push({ name, code: "refused" });
						}
					}
					sink.toolEnd(name, execution.ok, execution.summary);
					return execution.resultJson;
				}
				const execution = await runtime.cli.run(
					name as "listSources" | "recordScreen" | "generateCaptions" | "exportProject",
					args,
					holder.current,
				);
				if (execution.document) holder.current = execution.document;
				if (execution.ok && isMutatingTool(name)) {
					telemetry.mutatingToolsExecuted.push(name);
				}
				sink.toolEnd(name, execution.ok, execution.summary);
				return execution.resultJson;
			}
			const load = TOOLS_READING_CURSOR.has(name)
				? await loadCursorTelemetry(holder.current, args, runtime)
				: undefined;
			const execution = executeAgentTool(holder.current, name, JSON.stringify(args), {
				editsAllowed,
				mutationMode,
				cursorTelemetry: { availableByAssetId: runtime.availableByAssetId, load },
				visualFramesSupplied: runtime.visualFramesSupplied,
			});
			if (execution.document) holder.current = execution.document;
			if (isMutatingTool(name)) {
				if (execution.ok) telemetry.mutatingToolsExecuted.push(name);
				else {
					try {
						const parsed = JSON.parse(execution.resultJson) as { code?: string };
						telemetry.mutatingToolsRejected.push({
							name,
							code: parsed.code ?? "refused",
						});
					} catch {
						telemetry.mutatingToolsRejected.push({ name, code: "refused" });
					}
				}
			}
			sink.toolEnd(name, execution.ok, execution.summary);
			return execution.resultJson;
		},
		{ name, description: TOOL_DESCRIPTIONS[name], schema },
	);
}

/** Reads the sidecar for whichever asset the call names, defaulting to the
 *  primary one — the same resolution the executor will use to report it. */
async function loadCursorTelemetry(
	document: AxcutDocument,
	args: unknown,
	runtime: ToolRuntime,
): Promise<CursorTelemetryLoad> {
	const requested = (args as { assetId?: unknown } | null)?.assetId;
	const assetId = resolveCursorAssetId(document, typeof requested === "string" ? requested : null);
	if (!assetId) return { status: "unavailable", assetId: null };
	if (!runtime.cursor) {
		return { status: "unavailable", assetId };
	}
	const asset = document.assets.find((a) => a.id === assetId);
	try {
		return await runtime.cursor.read({ assetId, originalPath: asset?.originalPath ?? null });
	} catch (error) {
		// A reader that throws is still "we could not look" — never "there is
		// none". Collapsing the two is the exact failure this tool exists to stop.
		return {
			status: "unavailable",
			assetId,
			note: `Cursor telemetry could not be read: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * The complete tool surface handed to the model. Exported so a test can assert
 * its exact shape — the count is the cheapest tripwire for a dependency that
 * starts injecting tools of its own again.
 *
 * ponytail: the write tools are built even when `editsAllowed` is false, and
 * that is deliberate. Withholding them would make the model answer "I have no
 * tool for that" — a lie, and one that hides the setting instead of surfacing
 * it. It has to be able to NAME the edit it is asking permission for.
 */
export function buildTools(
	holder: DocumentHolder,
	sink: OpenScreenAgentSink,
	editsAllowed = true,
	runtime: ToolRuntime = {},
	mutationMode: MutationMode = "deterministic_edit",
	telemetry?: MutationTelemetry,
) {
	const tel =
		telemetry ??
		emptyMutationTelemetry({
			requestClass: "fallback",
			mutationMode,
			mutatingToolsExposed: true,
		});
	tel.mutatingToolsExposed = true;
	const build = <S extends z.ZodType>(name: string, schema: S) =>
		documentTool(holder, sink, name, schema, editsAllowed, runtime, mutationMode, tel);
	return [
		build("getCurrentDocument", z.object({})),
		build("getTranscript", getTranscriptArgs),
		build("getTranscriptRange", getTranscriptRangeArgs),
		build("getTranscriptWords", getTranscriptWordsArgs),
		build("getCursorTrack", getCursorTrackArgs),
		build("setWordText", setWordTextArgs),
		build("addTrim", addTrimArgs),
		build("addTrims", addTrimsArgs),
		build("setTrim", setTrimArgs),
		build("setClipRange", setClipRangeArgs),
		build("addClip", addClipArgs),
		build("setClipCrop", setClipCropArgs),
		build("moveClip", moveClipArgs),
		build("replaceTimeline", replaceTimelineArgs),
		build("addZoom", addZoomArgs),
		build("addZooms", addZoomsArgs),
		build("setZoom", setZoomArgs),
		build("addSpeed", addSpeedArgs),
		build("setSpeed", setSpeedArgs),
		build("addAnnotation", addAnnotationArgs),
		build("addGraphic", addGraphicArgs),
		build("setAnnotation", setAnnotationArgs),
		build("addCameraFullscreen", addCameraFullscreenArgs),
		build("setCameraFullscreen", setCameraFullscreenArgs),
		build("addAudio", addAudioArgs),
		build("setAudio", setAudioArgs),
		build("removeTrim", removeTrimArgs),
		build("removeModifier", removeModifierArgs),
		build("removeClip", removeClipArgs),
		build("setAspectRatio", setAspectRatioArgs),
		build("setBackground", setBackgroundArgs),
		build("listSources", listSourcesArgs),
		build("recordScreen", recordScreenArgs),
		build("generateCaptions", generateCaptionsArgs),
		build("exportProject", exportProjectArgs),
	];
}

/**
 * Prompt caching for the Anthropic-wire providers, which `createDeepAgent`
 * used to add for us (`isAnthropicModel` → `anthropicPromptCachingMiddleware`).
 * Dropping it silently would have made every Anthropic and MiniMax turn re-pay
 * for the full prompt — a cost and latency regression invisible to the offline
 * tests, which all run on the OpenAI-compatible path.
 *
 * The class-name probe is deepagents' own test, kept verbatim so MiniMax (which
 * rides `ChatAnthropic` because its wire format is Anthropic's) keeps caching.
 * `unsupportedModelBehavior: "ignore"` means a model that turns out not to
 * support cache breakpoints degrades instead of throwing.
 */
export function anthropicCachingMiddleware(chatModel: { getName?: () => string }) {
	if (chatModel.getName?.() !== "ChatAnthropic") return [];
	return [
		anthropicPromptCachingMiddleware({
			unsupportedModelBehavior: "ignore",
			minMessagesToCache: 1,
		}),
	];
}

export interface InvokeArgs {
	document: AxcutDocument;
	model: OpenScreenChatModelConfig;
	history: Array<{ role: "user" | "assistant" | "system"; content: string }>;
	userMessage: string;
	sink: OpenScreenAgentSink;
	/** `config.allowAgentEdits !== false`, resolved by the chat-service. When
	 *  false the write tools refuse and the prompt tells the model to ask.
	 *  Defaults to allowed so a caller that predates the flag behaves as before. */
	editsAllowed?: boolean;
	/** Injected by `chat-service` from the Electron layer. Absent in tests and in
	 *  the workbench unless one is supplied on purpose. */
	cursor?: CursorTelemetryReader;
	/** Optional CLI engine for listSources / recordScreen / generateCaptions / export. */
	cli?: CliEngine;
	/** Optional override for speech evidence disk cache (tests). */
	speechCacheDir?: string;
	/**
	 * Context packing mode for A/B:
	 * CURRENT_FULL_CONTEXT (default) vs VIDEO_MEMORY_RETRIEVAL.
	 * Also overridable via OPENSCREEN_CONTEXT_PACKING.
	 */
	contextPacking?: ContextPackingMode;
	/** Optional session store for same-video follow-up reuse (tests / harness). */
	videoMemorySessionStore?: VideoMemorySessionStore;
	/** Stable document id for session cache keying (defaults to project.id). */
	videoMemoryDocumentId?: string;
	/**
	 * Experimental Bounded Reliability V2 — abort after N on_chat_model_end events.
	 * When exceeded, return provider_error with failureReason model_call_budget_exceeded.
	 */
	maxProviderModelCalls?: number;
}

/** One cheap probe per asset, run before the tools are built so the very first
 *  `getCurrentDocument` can already say whether telemetry exists. */
async function probeCursorTelemetry(
	document: AxcutDocument,
	cursor: CursorTelemetryReader | undefined,
): Promise<Record<string, boolean> | undefined> {
	if (!cursor?.probe) return undefined;
	const entries = await Promise.all(
		document.assets.map(async (asset) => {
			try {
				return [
					asset.id,
					await cursor.probe!({ assetId: asset.id, originalPath: asset.originalPath ?? null }),
				] as const;
			} catch {
				// A probe that throws leaves the asset OUT of the map, which the
				// snapshot renders as null — "not checked". Recording it as `false`
				// would turn our failure into a claim about the user's project.
				return null;
			}
		}),
	);
	const map: Record<string, boolean> = {};
	for (const entry of entries) {
		if (entry) map[entry[0]] = entry[1];
	}
	return map;
}

/**
 * ponytail: `on_tool_start` / `on_tool_end` are observed and DROPPED, not
 * forwarded to the sink. `documentTool` already announced the call with the
 * real arguments and the executor's real verdict; this branch has no access to
 * the tool's return value, so it could only ever invent `ok: true` — which is
 * exactly how a REFUSED `replaceTimeline` and a `getTranscript` that returned
 * `{"error":"No transcript…"}` both came out green. Every write was announced
 * twice, the second time as a success. A stream branch must never fabricate a
 * verdict: a tool built outside `documentTool` should be silent here (and get
 * caught by the "one pair per call" test) rather than quietly mislabelled.
 *
 * They are excluded from `nonChatEvents` as well, so the empty-response
 * diagnostic keeps listing only genuinely unhandled events.
 */
const SILENT_TOOL_EVENTS: ReadonlySet<string> = new Set(["on_tool_start", "on_tool_end"]);

export interface InvokeResult {
	text: string;
	document: AxcutDocument;
	mutated: boolean;
	/**
	 * Delivery contract (Recovery 3). `completed` requires non-empty
	 * user-facing `text` (unless a future intentional-silent product path
	 * is introduced — none today).
	 */
	status?: AgentResponseStatus;
	/** Typed failure code — never dump raw into user-facing prose. */
	failureReason?: AgentFailureReason;
	/** HTTP status when a provider/transport error carried one. */
	providerHttpStatus?: number;
	/** Structured raw provider diagnostics — never user-facing. */
	providerDiagnostics?: import("./deliveryStatus").ProviderErrorDiagnostics;
	/** User-safe failure sentence for chat/toast (not the diagnostic dump). */
	userMessage?: string;
	/** Set when the stream finished without producing a final text (e.g. all
	 * chunks had empty `content`, or the provider returned no
	 * `content_block_delta` events). Carries a short diagnostic describing
	 * what the LangChain layer actually saw. */
	reason?: string;
	/**
	 * Turn-local validated VISUAL_SEMANTIC_GROUNDING from this response.
	 * Never persisted to .openscreen. Absent when frames were not supplied or
	 * the model omitted/failed validation (turn continues with ordinary prose).
	 */
	visualSemanticGrounding?: VisualSemanticGrounding;
	speechEvidence?: SpeechEvidence[];
	/**
	 * Turn-local validated SOURCE_STORY. Never persisted to .openscreen.
	 * Absent when not requested or validation failed (turn continues with prose).
	 */
	sourceStory?: SourceStory;
	/**
	 * Turn-local validated TARGET_STORY (editingContext). Never persisted.
	 * Absent when not requested, Source Story missing, or validation failed.
	 */
	targetStory?: TargetStory;
	/**
	 * Turn-local Temporal Event Ledger V1 (deterministic, 0 extra LLM calls).
	 * Internal cognition memory — never dumped into normal user-facing prose.
	 */
	temporalEventLedger?: TemporalEventLedger;
	/**
	 * Turn-local Master Video Investigator V1 evidence set (bounded tools).
	 * Internal only — never dumped into normal user-facing prose.
	 */
	investigationEvidence?: InvestigationEvidenceSet;
	/**
	 * Turn-local Visual Evidence Specialist V1 result (source-res crop + OCR).
	 * Internal only — never dumped into normal user-facing prose.
	 */
	visualSpecialist?: VisualSpecialistResult;
	/**
	 * Turn-local Claim Promotion V1 set (deterministic; sits above ledger).
	 * Internal only — never dumped into normal user-facing prose.
	 */
	claimPromotion?: ClaimPromotionSet;
	/**
	 * Turn-local Source Story V2 (evidence-grounded deterministic structure).
	 * Internal only — never dumped into normal user-facing prose.
	 */
	sourceStoryV2?: SourceStoryV2;
	/**
	 * Turn-local Target Story V1 (viewer experience from Source Story V2 + intent).
	 * Internal only — never executes edits.
	 */
	targetStoryV1?: TargetStoryV1;
	/**
	 * Turn-local Edit Gap V1 (editorial delta Source Story V2 ↔ Target Story V1).
	 * Internal only — not an Edit Plan; does not select tools or mutate AxcutDocument.
	 */
	editGapV1?: EditGapV1;
	/**
	 * Turn-local Edit Plan V1 (gap → candidate strategies / tool families).
	 * Internal only — does not execute edits or mutate AxcutDocument.
	 */
	editPlanV1?: EditPlanV1;
	/**
	 * Turn-local Planning→Investigation Closure V1 (bounded evidence loop).
	 * Internal only — does not execute edits or mutate AxcutDocument.
	 */
	planningClosureV1?: PlanningClosureResult;
	/**
	 * Turn-local Constrained Edit Proposal V1 (precise proposals, not applied).
	 * Internal only — does not execute tools or mutate AxcutDocument.
	 */
	editProposalV1?: EditProposalV1;
	/**
	 * Local-first Professional Edit Orchestrator result (0 paid LLM).
	 * Present when the professional “You decide” path ran and returned early.
	 */
	professionalEditOrchestratorV1?: import("../professionalEditOrchestrator").ProfessionalEditOrchestratorResultV1;
	/**
	 * Consent + Apply Preview V1 preflight diagnostics only.
	 * Never auto-applies; mutation requires explicit consent outside this path.
	 */
	applyPreviewV1?: {
		providerId: typeof APPLY_PREVIEW_V1_PROVIDER_ID;
		preflight: ApplyPreflight;
		mutations: 0;
		additionalOrchestrationModelCalls: 0;
	};
	/**
	 * UI Consent Surface V1 — human-facing review cards (0 LLM).
	 * Apply still requires explicit user consent via applyPreview IPC.
	 */
	editReview?: EditReviewAttachment;
	/** Single Mutation Authority V1 telemetry for this turn. */
	mutationAuthority?: MutationTelemetry;
	/** Turn-level context / cost telemetry (audit; does not alter prompts). */
	contextTelemetry?: ContextTelemetryV1;
	/** Video Memory V1 index built this turn (foundation; not production retrieval switch). */
	videoMemoryV1?: VideoMemoryV1;
	/** Retrieval production path telemetry (when VIDEO_MEMORY_RETRIEVAL* is active). */
	retrievalPath?: {
		identity:
			| typeof VIDEO_MEMORY_RETRIEVAL_PRODUCTION_V1_ID
			| typeof VIDEO_MEMORY_RETRIEVAL_CLOSURE_V1_ID
			| typeof BOUNDED_REASONING_V1_ID;
		packingMode: ContextPackingMode;
		queryClass: VideoMemoryQueryClass;
		queryScope?: string;
		frameMeta: AttachedFrameMeta[];
		visualCoverage?: VisualEvidenceCoverage | null;
		packedContextChars: number;
		ranInvestigator: boolean;
		sufficiencyReason: string;
		sessionReuse: boolean;
		sourceMemoryHit: boolean;
		programmeMemoryHit: boolean;
		ledgerReused: boolean;
		claimsReused: boolean;
		sourceStoryReused: boolean;
		sourceFingerprint: string | null;
		programmeFingerprint: string | null;
		sttCacheHit: boolean | null;
		visualCacheHits: number | null;
		visualCacheMisses: number | null;
		toolsExposed: number;
		toolGateNotes: string | null;
		/** Tool names actually bound for this turn (Bounded audit). */
		toolNames?: string[];
		cognitionPhase?: CognitionPhase;
	};
	/**
	 * Bounded Reasoning V1 diagnostics — exact packet/system/tools sent (experimental path).
	 * Absent on FULL / Retrieval / Compact.
	 */
	boundedDiagnostics?: {
		identity: typeof BOUNDED_REASONING_V1_ID;
		phase: CognitionPhase;
		packet: import("../reasoningPacket").ReasoningPacketV1;
		packetChars: number;
		packetSerializedText: string;
		systemPolicyChars: number;
		systemPolicyText: string;
		toolSchemaChars: number;
		toolNames: string[];
		mutatingToolCount: number;
		projectProjectionChars: number;
		historyConstraintCount: number;
		imagesAttached: number;
		/** Quality Closure V3 — text actually bound for provider (post-append). */
		providerBoundUserTextPreview?: string;
		packetDelivered?: boolean;
	};
}

export async function invokeOpenScreenAgent(args: InvokeArgs): Promise<InvokeResult> {
	const { model, history, userMessage, sink } = args;
	const editsAllowed = args.editsAllowed !== false;

	let workingDocument = args.document;
	const holder: DocumentHolder = { current: workingDocument };
	const initialDocumentJSON = JSON.stringify(workingDocument);
	const projectKeyEarly = String(workingDocument.project.id ?? "unknown");
	let localEditorialRequest = classifyLocalEditorialTurn(userMessage, projectKeyEarly);

	// Local-first Chat control: direct / restore / constraint / semantic brain — prefer 0 provider.
	// Runs before model construction so missing/429 OpenAI cannot block ordinary edits.
	if (editsAllowed && shouldHandleLocalEditorialWithoutCloud(userMessage, projectKeyEarly)) {
		let cursorSamplesEarly: Array<{
			atSec: number;
			cx: number;
			cy: number;
			visible?: boolean;
			interactionType?: string;
		}> | null = null;
		try {
			if (args.cursor?.read) {
				const assetId = workingDocument.project.primaryAssetId ?? workingDocument.assets[0]?.id;
				const asset = workingDocument.assets.find((a) => a.id === assetId);
				const load = await args.cursor.read({
					assetId: assetId ?? "",
					originalPath: asset?.originalPath ?? null,
				});
				if (load && "samples" in load && Array.isArray(load.samples)) {
					cursorSamplesEarly = load.samples.map(
						(s: {
							timeMs?: number;
							atSec?: number;
							cx?: number;
							cy?: number;
							visible?: boolean;
							interactionType?: string;
						}) => ({
							atSec:
								typeof s.atSec === "number"
									? s.atSec
									: typeof s.timeMs === "number"
										? s.timeMs / 1000
										: 0,
							cx: Number(s.cx),
							cy: Number(s.cy),
							visible: s.visible,
							interactionType: s.interactionType,
						}),
					);
				}
			}
		} catch {
			cursorSamplesEarly = null;
		}
		const early = await applyLocalEditorialControlWithBrain({
			projectId: projectKeyEarly,
			document: workingDocument,
			userMessage,
			assetId: workingDocument.project.primaryAssetId ?? null,
			cursorSamples: cursorSamplesEarly,
			chatModelConfig: model,
		});
		localEditorialRequest = early.request;
		if (early.handled && !early.needsProfessionalOrchestrator) {
			holder.current = early.document;
			const mutationTelemetryEarly = emptyMutationTelemetry({
				requestClass: "deterministicEdit",
				mutationMode: "deterministic_edit",
				mutatingToolsExposed: true,
				documentFingerprintBefore: early.documentFingerprintBefore,
			});
			mutationTelemetryEarly.documentFingerprintAfterReasoning = early.documentFingerprintAfter;
			mutationTelemetryEarly.persistedMutationCount = early.mutated ? 1 : 0;
			mutationTelemetryEarly.finalResponseClaim = early.mutated
				? "verified_applied"
				: "no_mutation";
			if (early.mutated) {
				mutationTelemetryEarly.mutatingToolsExecuted.push("localEditorialChat");
			}
			sink.text(early.userFacingText);
			return {
				text: early.userFacingText,
				document: holder.current,
				mutated: early.mutated,
				status: "completed",
				mutationAuthority: mutationTelemetryEarly,
			};
		}
	}

	// ponytail: build a fresh agent per turn (same pattern as axcut). The
	// runtime side-effects (langgraph thread) are tied to the agent instance —
	// checkpoint-based stateful threads can land later by passing a
	// `checkpointer`; for v1 each turn is single-shot.
	const chatModel = await createOpenScreenChatModel({
		...model,
		mediaDirs: shouldGrantLocalWatch(model.localAgentPermission, Boolean(model.watchGranted))
			? mediaDirsFromDocument(workingDocument)
			: [],
	});
	const availableByAssetId = await probeCursorTelemetry(workingDocument, args.cursor);

	const turnT0 = Date.now();
	let visualPrepMs = 0;
	let sttPrepMs = 0;
	let investigatorMs = 0;
	let cognitionMs = 0;
	let providerMs = 0;
	let modelCallCount = 0;
	const usageAcc = {
		inputTokens: 0,
		outputTokens: 0,
		reasoningTokens: 0,
		cachedInputTokens: 0,
		gotAny: false,
	};

	const contextNeedsRaw = classifyMediaContextNeeds(userMessage);
	const packingMode = resolveContextPackingMode(args.contextPacking);
	const boundedMode = isBoundedReasoningPacking(packingMode);
	/** Evidence/memory path shared by Retrieval + Bounded. */
	const retrievalMode = isMemoryBackedPacking(packingMode);
	const compactMode = isCompactPacking(packingMode);
	const requiredModalitiesEarly = boundedMode
		? resolveRequiredModalities({
				userMessage,
				contextNeeds: contextNeedsRaw,
				queryClass: classifyVideoMemoryQuery(userMessage, contextNeedsRaw),
			})
		: null;
	const contextNeeds =
		boundedMode && requiredModalitiesEarly
			? applyRequiredModalitiesToNeeds(contextNeedsRaw, requiredModalitiesEarly)
			: contextNeedsRaw;
	const queryClass = classifyVideoMemoryQuery(userMessage, contextNeeds);
	const queryScope = classifyQueryScope(userMessage, queryClass);
	const cognitionPhase: CognitionPhase | null = boundedMode
		? resolveCognitionPhase({ userMessage, contextNeeds, queryClass }).phase
		: null;
	let toolNeedPolicy: ToolNeedPolicy | null = null;
	const frameBudget = frameBudgetForQuery(queryClass, queryScope);
	const sessionStore = args.videoMemorySessionStore ?? getDefaultVideoMemorySessionStore();
	const memoryDocumentId =
		args.videoMemoryDocumentId ?? workingDocument.project.id ?? "openscreen-project";
	let sessionReuse = false;
	let sourceMemoryHit = false;
	let programmeMemoryHit = false;
	let ledgerReused = false;
	let claimsReused = false;
	let sourceStoryReused = false;
	let frameMeta: AttachedFrameMeta[] = [];
	let visualCoverage: VisualEvidenceCoverage | null = null;
	let packedContextChars = 0;
	let ranInvestigator = false;
	let sufficiencyReason = "full_context_default";
	let toolGateNotes: string | null = null;
	let toolsExposedCount = 0;
	let retrievalPathTelemetry: InvokeResult["retrievalPath"];
	let boundedDiagnostics: InvokeResult["boundedDiagnostics"];
	let exposedToolNames: string[] = [];

	const authority = resolveMutationAuthority({
		contextNeeds,
		editsAllowed,
	});
	const agentEditsAllowed = authority.agentEditsAllowed;
	const fingerprintBefore = fingerprintDocument(workingDocument).value;
	const mutationTelemetry = emptyMutationTelemetry({
		requestClass: contextNeeds.category,
		mutationMode: authority.mode,
		mutatingToolsExposed: true,
		documentFingerprintBefore: fingerprintBefore,
	});

	// Chat follow-up edit control (undo zoom / smaller captions / quieter audio).
	// Must run under deterministic_edit so the mutated document ships to the renderer.
	if (
		editsAllowed &&
		authority.mode === "deterministic_edit" &&
		isChatFollowUpEditControl(userMessage)
	) {
		const follow = applyChatFollowUpEditControl({
			document: workingDocument,
			userMessage,
		});
		mutationTelemetry.documentFingerprintAfterReasoning = fingerprintDocument(
			follow.document,
		).value;
		mutationTelemetry.persistedMutationCount = follow.mutated ? 1 : 0;
		mutationTelemetry.finalResponseClaim = follow.mutated ? "verified_applied" : "no_mutation";
		if (follow.mutated) {
			mutationTelemetry.mutatingToolsExecuted.push("chatFollowUpEditControl");
		}
		return {
			text: follow.userFacingText,
			document: follow.document,
			mutated: follow.mutated,
			status: "completed",
			mutationAuthority: mutationTelemetry,
		};
	}

	// "What improvements did you make?" — answer from session receipt + live doc (0 LLM).
	if (isChatPriorEditExplainRequest(userMessage)) {
		const explained = answerChatPriorEditExplain({
			projectId: String(workingDocument.project.id ?? memoryDocumentId),
			document: workingDocument,
		});
		mutationTelemetry.documentFingerprintAfterReasoning = fingerprintBefore;
		mutationTelemetry.persistedMutationCount = 0;
		mutationTelemetry.finalResponseClaim = "no_mutation";
		sink.text(explained.userFacingText);
		return {
			text: explained.userFacingText,
			document: workingDocument,
			mutated: false,
			status: "completed",
			mutationAuthority: mutationTelemetry,
		};
	}

	// Early session peek (asset id from document before prep).
	const peekAssetId =
		workingDocument.project.primaryAssetId ??
		workingDocument.assets.find((a) => a.kind !== "audio")?.id ??
		null;
	const cachedBundle =
		peekAssetId && retrievalMode
			? sessionStore.get(memoryDocumentId, peekAssetId, workingDocument)
			: null;
	if (cachedBundle) {
		sourceMemoryHit = true;
		sessionReuse = cachedBundle.turnCount > 0;
		programmeMemoryHit = Boolean(cachedBundle.sourceStoryV2);
	}

	const tVisual0 = Date.now();
	let visual = await prepareVisualEvidenceForTurn({
		document: workingDocument,
		userMessage,
		provider: model.provider,
		cursor: args.cursor,
		contextNeeds,
		...(retrievalMode
			? {
					maxFrames: frameBudget.maxExtract,
					skipVisualAttachment: frameBudget.maxFrames === 0,
					coverageFirst: frameBudget.coverageFirst,
					queryScope,
				}
			: {}),
	});
	visualPrepMs = Date.now() - tVisual0;

	// Retrieval: attach explicit reasons for whatever frames survived the budget.
	if (retrievalMode && visual.prepared?.frames?.length) {
		const selected = selectFramesForRetrieval({
			frames: visual.prepared.frames,
			queryClass,
			memory: cachedBundle?.memory ?? null,
			queryScope,
			userMessage,
			durationSec: visual.prepared.sourceDurationSec,
			changes: visual.prepared.changes,
		});
		frameMeta = selected.meta;
		visualCoverage = selected.coverage;
		if (selected.frames.length !== visual.prepared.frames.length) {
			const content = await buildVisualEvidenceUserContent(userMessage, selected.frames, {
				changes: visual.prepared.changes,
				includeSemanticGrounding: true,
			});
			const reasonLines = [
				"FRAME_ATTACH_REASONS (deterministic selection):",
				...frameMeta.map(
					(m, i) => `  ${i + 1}. t=${m.sourceTimeSec.toFixed(2)}s reason=${m.reason} — ${m.note}`,
				),
				"",
			].join("\n");
			visual.userMessage = toAgentUserMessage([
				{ type: "text", text: reasonLines },
				...(Array.isArray(content) ? content : []),
			]);
			visual.prepared = { ...visual.prepared, frames: selected.frames };
			visual.visualFramesSupplied = selected.frames.length > 0;
		} else if (frameMeta.length) {
			const reasonLines = [
				"FRAME_ATTACH_REASONS (deterministic selection):",
				...frameMeta.map(
					(m, i) => `  ${i + 1}. t=${m.sourceTimeSec.toFixed(2)}s reason=${m.reason} — ${m.note}`,
				),
				"",
			].join("\n");
			const c = visual.userMessage.content;
			if (Array.isArray(c)) {
				visual.userMessage = {
					role: "user",
					content: [{ type: "text", text: reasonLines }, ...c],
				};
			}
		}
	}
	const visualFramesSupplied = visual.visualFramesSupplied;

	const tStt0 = Date.now();
	const speechPrep = await prepareSpeechEvidenceForTurn({
		document: workingDocument,
		userMessage,
		contextNeeds,
		deps: {
			getSttManager: () => getSttManager(),
			resolveSttBinary: () => {
				for (const candidate of candidateBinaryPaths()) {
					if (candidate && existsSync(candidate)) return candidate;
				}
				return null;
			},
			cacheDir: args.speechCacheDir,
		},
	}).catch((err) => {
		console.warn(
			"[speech-evidence] prepare failed; continuing without transcript",
			err instanceof Error ? err.message : String(err),
		);
		return { document: workingDocument, prepared: null as null };
	});
	sttPrepMs = Date.now() - tStt0;
	workingDocument = speechPrep.document;
	holder.current = workingDocument;
	const speechEvidence = speechPrep.prepared?.evidence;
	const primarySpeech = speechEvidence?.[0];
	const audioStream =
		primarySpeech?.audioStreamPresent ??
		(speechEvidence?.some((e) => e.audioStreamPresent === true)
			? true
			: speechEvidence?.every((e) => e.audioStreamPresent === false)
				? false
				: null);
	// Injection is separate from preparation (and from on-document transcript existence).
	const speechStatus = resolveInjectedSpeechStatus({
		injectSpeech: contextNeeds.injectSpeech,
		primarySpeech,
		document: workingDocument,
	});

	const primaryAsset =
		workingDocument.assets.find((a) => a.id === workingDocument.project.primaryAssetId) ??
		workingDocument.assets.find((a) => a.kind !== "audio") ??
		null;
	const sourceDurationSec = primarySpeech?.sourceDurationSec ?? primaryAsset?.durationSec ?? 0;

	if (
		retrievalMode &&
		queryClass === "cross_modal" &&
		frameBudget.maxFrames > 0 &&
		!visual.prepared?.frames?.length
	) {
		const retry = await prepareVisualEvidenceForTurn({
			document: workingDocument,
			userMessage,
			provider: model.provider,
			cursor: args.cursor,
			contextNeeds: { ...contextNeeds, visual: true, speech: true, injectSpeech: true },
			maxFrames: frameBudget.maxExtract,
			skipVisualAttachment: false,
			coverageFirst: true,
			queryScope,
		});
		visual = retry;
		visualPrepMs += 0;
		if (visual.prepared?.frames?.length) {
			const selected = selectFramesForRetrieval({
				frames: visual.prepared.frames,
				queryClass,
				memory: cachedBundle?.memory ?? null,
				queryScope,
				userMessage,
				durationSec: visual.prepared.sourceDurationSec ?? sourceDurationSec,
				changes: visual.prepared.changes,
			});
			frameMeta = selected.meta;
			visualCoverage = selected.coverage;
			visual.prepared = { ...visual.prepared, frames: selected.frames };
			visual.visualFramesSupplied = selected.frames.length > 0;
		}
	}

	if (retrievalMode && visual.prepared?.frames?.length && queryClass === "cross_modal") {
		const segs = primarySpeech?.segments ?? [];
		const aligned = speechAlignmentTimes({
			windows: segs.map((s) => ({
				startSec: s.startSourceTimeSec,
				endSec: s.endSourceTimeSec,
			})),
			durationSec: sourceDurationSec,
		});
		if (aligned.length) {
			const selected = selectFramesForRetrieval({
				frames: visual.prepared.frames,
				queryClass,
				memory:
					cachedBundle?.memory ??
					({
						speechWindows: segs.map((s) => ({
							startSec: s.startSourceTimeSec,
							endSec: s.endSourceTimeSec,
							preview: (s.text ?? "").slice(0, 80),
						})),
						sourceDurationSec,
					} as never),
				priorityTimesSec: aligned,
				queryScope,
				userMessage,
				durationSec: sourceDurationSec,
				changes: visual.prepared.changes,
			});
			frameMeta = selected.meta;
			visualCoverage = selected.coverage;
			if (selected.frames !== visual.prepared.frames) {
				const content = await buildVisualEvidenceUserContent(userMessage, selected.frames, {
					changes: visual.prepared.changes,
					includeSemanticGrounding: true,
				});
				const reasonLines = [
					"FRAME_ATTACH_REASONS (deterministic selection):",
					...frameMeta.map(
						(m, i) => `  ${i + 1}. t=${m.sourceTimeSec.toFixed(2)}s reason=${m.reason} — ${m.note}`,
					),
					"",
				].join("\n");
				visual.userMessage = toAgentUserMessage([
					{ type: "text", text: reasonLines },
					...(Array.isArray(content) ? content : []),
				]);
				visual.prepared = { ...visual.prepared, frames: selected.frames };
				visual.visualFramesSupplied = selected.frames.length > 0;
			}
		}
	}

	let cursorEventTimes: number[] = [];
	let cursorInteractions: Array<{ sourceTimeSec: number; interactionType?: string }> = [];
	if (contextNeeds.cursor && args.cursor && primaryAsset) {
		try {
			const load = await args.cursor.read({
				assetId: primaryAsset.id,
				originalPath: primaryAsset.originalPath,
			});
			if (load.status === "ok") {
				cursorEventTimes = interactionInstantsFromSamples(load.samples).map((i) => i.sourceTimeSec);
				cursorInteractions = load.samples
					.filter((s) => {
						const kind = typeof s.interactionType === "string" ? s.interactionType : "";
						return Boolean(kind) && kind !== "move";
					})
					.map((s) => ({
						sourceTimeSec: s.timeMs / 1000,
						interactionType: s.interactionType ?? undefined,
					}));
			}
		} catch {
			/* cursor optional for story */
		}
	}

	// Master Video Investigator V1.1 — role-policy grounding, bounded tools
	// (0 investigator model calls), then feeds a compact briefing (+ optional
	// stills) into the existing agent turn.
	let investigationEvidence: InvestigationEvidenceSet | null = null;
	let visualSpecialist: VisualSpecialistResult | null = null;
	const canReuseLedger =
		retrievalMode &&
		Boolean(cachedBundle?.ledger) &&
		sourceMemoryHit &&
		frameBudget.maxFrames === 0;
	const earlyLedger = canReuseLedger
		? cachedBundle!.ledger
		: primaryAsset && sourceDurationSec > 0
			? buildLedgerFromPreparedEvidence({
					assetId: primaryAsset.id,
					sourceDurationSec,
					speechEvidence: primarySpeech,
					frames: visual.prepared?.frames,
					changes: visual.prepared?.changes,
					cursorInteractions,
				})
			: null;
	ledgerReused = Boolean(canReuseLedger && earlyLedger);
	let storyLedger = earlyLedger;
	let storyClaims: ClaimPromotionSet | null = null;
	if (ledgerReused && cachedBundle?.claims) {
		storyClaims = cachedBundle.claims;
		claimsReused = true;
	}

	// Bootstrap memory for sufficiency before Investigator (retrieval path).
	let bootMemory: VideoMemoryV1 | null =
		cachedBundle?.memory ??
		(earlyLedger && primaryAsset
			? buildVideoMemoryV1({
					document: workingDocument,
					assetId: primaryAsset.id,
					ledger: earlyLedger,
					claims: null,
					analysisCoverage: {
						speech: Boolean(primarySpeech),
						visual: Boolean(visual.prepared?.frames?.length),
						cursor: Boolean(cursorInteractions?.length),
						investigator: false,
					},
				})
			: null);
	const bootRetrieval = bootMemory
		? retrieveFromVideoMemory(bootMemory, userMessage, contextNeeds)
		: null;
	const sufficiency =
		bootMemory && bootRetrieval
			? evaluateEvidenceSufficiency({
					queryClass,
					queryScope,
					retrieval: bootRetrieval,
					memory: bootMemory,
					hasSpeechEvidence: Boolean(primarySpeech && primarySpeech.status === "available"),
					attachedFrameCount: visual.prepared?.frames?.length ?? 0,
					visualCoverage,
					isColdStart: !sourceMemoryHit,
				})
			: {
					sufficient: false,
					runInvestigator: true,
					deepenHints: [] as string[],
					reason: "full_context_or_no_memory",
				};
	sufficiencyReason = retrievalMode ? sufficiency.reason : "full_context_always_investigate";
	const shouldRunInvestigator =
		Boolean(earlyLedger && primaryAsset) && (retrievalMode ? sufficiency.runInvestigator : true);

	const tInvestigator0 = Date.now();
	if (shouldRunInvestigator && earlyLedger && primaryAsset) {
		ranInvestigator = true;
		try {
			const earlyClaims = buildClaimPromotionSet({
				ledger: earlyLedger,
				userQuery: userMessage,
				lazy: true,
			});
			storyClaims = earlyClaims;
			investigationEvidence = await runMasterVideoInvestigatorV1_1({
				userMessage,
				needs: contextNeeds,
				assetId: primaryAsset.id,
				sourceDurationSec,
				videoPath: primaryAsset.originalPath,
				speechEvidence: primarySpeech,
				frames: visual.prepared?.frames,
				changes: visual.prepared?.changes,
				cursorInteractions,
				ledger: earlyLedger,
				claimPromotion: earlyClaims,
			});
			if (
				investigationEvidence &&
				investigationEvidence.stopReason !== "deterministic_edit_skip" &&
				primaryAsset.originalPath
			) {
				try {
					visualSpecialist = await runReuseVisualV1({
						videoPath: primaryAsset.originalPath,
						investigation: investigationEvidence,
						changeTimesSec: visual.prepared?.changes?.map(
							(c) => c.toSourceTimeSec ?? c.fromSourceTimeSec,
						),
					});
					investigationEvidence = mergeSpecialistIntoInvestigation(
						investigationEvidence,
						visualSpecialist,
					);
				} catch (err) {
					console.warn(
						"[visual-specialist-reuse] failed; falling back to Visual Specialist V1",
						err instanceof Error ? err.message : String(err),
					);
					try {
						visualSpecialist = await runVisualSpecialistV1({
							videoPath: primaryAsset.originalPath,
							investigation: investigationEvidence,
						});
						investigationEvidence = mergeSpecialistIntoInvestigation(
							investigationEvidence,
							visualSpecialist,
						);
					} catch (err2) {
						console.warn(
							"[visual-specialist] failed; continuing with investigator evidence only",
							err2 instanceof Error ? err2.message : String(err2),
						);
					}
				}
			}
			if (visualSpecialist && storyLedger) {
				storyLedger = appendVisualSpecialistToLedger(
					storyLedger,
					visualSpecialist,
					primaryAsset.id,
				);
				storyClaims = buildClaimPromotionSet({
					ledger: storyLedger,
					specialist: visualSpecialist,
					investigation: investigationEvidence,
					userQuery: userMessage,
					lazy: true,
				});
			}
			// Retrieval path: attach briefing text but limit extra stills to budget remainder.
			if (retrievalMode && investigationEvidence) {
				const invForAttach =
					frameBudget.maxFrames === 0
						? { ...investigationEvidence, additionalFrames: [] }
						: {
								...investigationEvidence,
								additionalFrames: investigationEvidence.additionalFrames.slice(
									0,
									Math.max(0, frameBudget.maxFrames - (visual.prepared?.frames?.length ?? 0)),
								),
							};
				visual.userMessage = await appendInvestigatorToUserMessage(
					visual.userMessage,
					invForAttach,
				);
			} else {
				visual.userMessage = await appendInvestigatorToUserMessage(
					visual.userMessage,
					investigationEvidence,
				);
			}
		} catch (err) {
			console.warn(
				"[video-investigator] investigation failed; continuing without briefing",
				err instanceof Error ? err.message : String(err),
			);
		}
	} else if (earlyLedger && primaryAsset && !storyClaims) {
		// Still build claims locally without Investigator when retrieval skips deepen.
		storyClaims = buildClaimPromotionSet({
			ledger: earlyLedger,
			userQuery: userMessage,
			lazy: true,
		});
	}
	investigatorMs = Date.now() - tInvestigator0;

	const tCognition0 = Date.now();
	let sourceStoryPrep = prepareSourceStoryForTurn({
		contextNeeds,
		sourceDurationSec,
		speechEvidence: primarySpeech,
		frames: visual.prepared?.frames,
		changes: visual.prepared?.changes,
		cursorEventTimes,
		assetId: primaryAsset?.id,
		ledger: storyLedger,
		claimPromotion: storyClaims,
		investigation: investigationEvidence,
		useV2: true,
	});
	if (retrievalMode && programmeMemoryHit && cachedBundle?.sourceStoryV2 && sourceStoryPrep) {
		sourceStoryPrep = {
			...sourceStoryPrep,
			storyV2: cachedBundle.sourceStoryV2,
			requested: true,
		};
		sourceStoryReused = true;
	}
	const targetStoryPrep = prepareTargetStoryForTurn({
		contextNeeds,
		userMessage,
		sourceStoryRequested: sourceStoryPrep?.requested === true,
		sourceStoryV2: sourceStoryPrep?.storyV2,
		useV1: true,
	});
	const editGapPrep = prepareEditGapForTurn({
		contextNeeds,
		userMessage,
		sourceStoryV2: sourceStoryPrep?.storyV2,
		targetStoryV1: targetStoryPrep?.targetV1,
	});
	const editPlanPrep = prepareEditPlanForTurn({
		contextNeeds,
		sourceStoryV2: sourceStoryPrep?.storyV2,
		targetStoryV1: targetStoryPrep?.targetV1,
		editGapV1: editGapPrep?.editGapV1,
	});

	// Planning→Investigation Closure V1 — only when Edit Plan still needs evidence.
	// Recomputes cognition chain; never executes edits / never mutates AxcutDocument.
	let planningClosureV1: PlanningClosureResult | undefined;
	let closedSourceStoryV2 = sourceStoryPrep?.storyV2;
	let closedTargetStoryV1 = targetStoryPrep?.targetV1;
	let closedEditGapV1 = editGapPrep?.editGapV1;
	let closedEditPlanV1 = editPlanPrep?.editPlanV1;
	if (
		editPlanPrep?.editPlanV1 &&
		sourceStoryPrep?.storyV2 &&
		targetStoryPrep?.targetV1 &&
		editGapPrep?.editGapV1 &&
		primaryAsset
	) {
		try {
			const closurePrep = await preparePlanningClosureForTurn({
				contextNeeds,
				sourceStoryV2: sourceStoryPrep.storyV2,
				targetStoryV1: targetStoryPrep.targetV1,
				editGapV1: editGapPrep.editGapV1,
				editPlanV1: editPlanPrep.editPlanV1,
				evidence: {
					assetId: primaryAsset.id,
					sourceDurationSec,
					userMessage,
					contextNeeds,
					videoPath: primaryAsset.originalPath,
					ledger: storyLedger,
					claimPromotion: storyClaims,
					speechEvidence: primarySpeech,
					frames: visual.prepared?.frames,
					changes: visual.prepared?.changes,
					cursorInteractions,
					cursorEventTimes,
				},
			});
			if (closurePrep) {
				planningClosureV1 = closurePrep.closure;
				closedEditPlanV1 = closurePrep.finalPlan;
				const finalSnap =
					closurePrep.closure.planVersions[closurePrep.closure.planVersions.length - 1];
				if (finalSnap && closurePrep.closure.metrics.closureRounds > 0) {
					closedSourceStoryV2 = finalSnap.sourceStoryV2;
					closedTargetStoryV1 = finalSnap.targetStoryV1;
					closedEditGapV1 = finalSnap.editGapV1;
				}
			}
		} catch (err) {
			console.warn(
				"[planning-closure] failed; continuing with initial Edit Plan",
				err instanceof Error ? err.message : String(err),
			);
		}
	}

	const editProposalPrep =
		closedEditPlanV1 && closedSourceStoryV2 && closedTargetStoryV1 && closedEditGapV1
			? prepareEditProposalForTurn({
					contextNeeds,
					sourceStoryV2: closedSourceStoryV2,
					targetStoryV1: closedTargetStoryV1,
					editGapV1: closedEditGapV1,
					editPlanV1: closedEditPlanV1,
					planningClosureV1,
				})
			: null;
	cognitionMs = Date.now() - tCognition0;

	const historyConstraints = boundedMode
		? selectBoundedHistoryConstraints(history.map((h) => ({ role: h.role, content: h.content })))
		: [];
	const openProjectSnapshotEarly = documentSnapshotForModel(
		workingDocument,
		{ availableByAssetId },
		{
			visualFramesSupplied,
			audioStream,
			speechStatus,
			sourceStoryRequested: sourceStoryPrep?.requested === true,
			targetStoryRequested: targetStoryPrep?.requested === true,
		},
	);
	const fullSnapshotChars = JSON.stringify(openProjectSnapshotEarly).length;
	const boundedProjection = boundedMode
		? buildBoundedProjectProjection({
				document: workingDocument,
				visualFramesSupplied,
				speechStatus,
				fullSnapshotChars,
			})
		: null;

	const speechMediaStateForPacket: SpeechMediaState = (() => {
		if (speechStatus === "not_requested") return "not_requested";
		if (primarySpeech?.status) return primarySpeech.status as SpeechMediaState;
		if (
			speechStatus === "no_audio" ||
			speechStatus === "no_speech_detected" ||
			speechStatus === "unavailable" ||
			speechStatus === "failed" ||
			speechStatus === "available"
		) {
			return speechStatus;
		}
		return "unknown";
	})();

	let prebuiltBoundedPacket: ReturnType<typeof buildReasoningPacketV1> | null = null;
	let bootMemoryEarly: ReturnType<typeof buildVideoMemoryV1> | null = null;
	if (boundedMode && primaryAsset && storyLedger) {
		bootMemoryEarly = buildVideoMemoryV1({
			document: workingDocument,
			assetId: primaryAsset.id,
			ledger: storyLedger,
			claims: storyClaims,
			sourceStoryV2: closedSourceStoryV2 ?? sourceStoryPrep?.storyV2,
			analysisCoverage: {
				speech: Boolean(primarySpeech),
				visual: Boolean(visual.prepared?.frames?.length),
				cursor: Boolean(cursorInteractions?.length),
				investigator: Boolean(investigationEvidence),
			},
		});
		prebuiltBoundedPacket = buildReasoningPacketV1({
			phase: cognitionPhase ?? "UNDERSTAND",
			userMessage,
			queryClass,
			queryScope,
			contextNeeds,
			requiredModalities:
				requiredModalitiesEarly ??
				resolveRequiredModalities({ userMessage, contextNeeds, queryClass }),
			memory: bootMemoryEarly,
			claims: storyClaims,
			sourceStoryV2: closedSourceStoryV2 ?? sourceStoryPrep?.storyV2,
			targetStoryV1: closedTargetStoryV1 ?? targetStoryPrep?.targetV1,
			editGapV1: closedEditGapV1 ?? editGapPrep?.editGapV1,
			editPlanV1: closedEditPlanV1 ?? editPlanPrep?.editPlanV1,
			investigatorBriefing: investigationEvidence?.internalBriefing ?? null,
			frameMeta,
			visualCoverage,
			projectProjection: boundedProjection!.projection,
			historyConstraints,
			imagesAttached: frameMeta.length,
			speechMediaState: speechMediaStateForPacket,
			cursorEvidencePresent: Boolean(cursorInteractions?.length),
		});
		toolNeedPolicy = resolveToolNeedPolicy({
			phase: cognitionPhase ?? "UNDERSTAND",
			packetEvidenceSufficient: prebuiltBoundedPacket.sufficiency.packetEvidenceSufficient,
			missingEvidenceKinds: prebuiltBoundedPacket.sufficiency.missingEvidenceKinds,
			speechWindows: prebuiltBoundedPacket.selectedSpeech.length,
			frameCount: prebuiltBoundedPacket.frameMeta.length,
			queryClass,
		});
		prebuiltBoundedPacket = {
			...prebuiltBoundedPacket,
			toolPolicyNote: toolNeedPolicy.reason,
		};
	}

	const toolsBuilt = buildTools(
		holder,
		sink,
		agentEditsAllowed,
		{
			cursor: args.cursor,
			availableByAssetId,
			cli: args.cli,
			visualFramesSupplied,
		},
		authority.mode,
		mutationTelemetry,
	);
	const gate = boundedMode
		? toolGateFromPolicy(
				toolNeedPolicy ??
					resolveToolNeedPolicy({
						phase: cognitionPhase ?? "UNDERSTAND",
						packetEvidenceSufficient: false,
						missingEvidenceKinds: ["unbuilt"],
						speechWindows: 0,
						frameCount: 0,
						queryClass,
					}),
				cognitionPhase ?? "UNDERSTAND",
			)
		: compactMode
			? toolGateForQuery(queryClass)
			: null;
	const tools = gate ? filterToolsByGate(toolsBuilt, gate) : toolsBuilt;
	toolsExposedCount = tools.length;
	exposedToolNames = tools.map((t) => t.name);
	toolGateNotes = gate?.notes ?? null;

	const openProjectSnapshot = openProjectSnapshotEarly;

	const systemPromptText = boundedMode
		? buildBoundedSystemPrompt({
				phase: cognitionPhase ?? "UNDERSTAND",
				projectProjectionJson: JSON.stringify(boundedProjection!.projection),
				editsAllowed,
				mutationMode: authority.mode,
			})
		: compactMode
			? buildCompactSystemPrompt({
					editsAllowed,
					mutationMode: authority.mode,
					queryClass,
					openProjectSnapshot,
				})
			: buildSystemPrompt({
					editsAllowed,
					mutationMode: authority.mode,
					openProject: openProjectSnapshot,
				});
	const toolSchemaText = JSON.stringify(
		tools.map((t) => ({
			name: t.name,
			description: typeof t.description === "string" ? t.description : "",
		})),
	);

	// APPLY/VERIFY fast path — no provider call (Bounded only).
	if (boundedMode && cognitionPhase) {
		const fast = resolveDeterministicFastPath({
			phase: cognitionPhase,
			contextNeeds,
			userMessage,
		});
		if (fast.kind === "skip_provider") {
			return {
				text: fast.userText,
				document: holder.current,
				mutated: false,
				status: "completed",
				retrievalPath: {
					identity: BOUNDED_REASONING_V1_ID,
					packingMode,
					queryClass,
					queryScope,
					frameMeta,
					visualCoverage,
					packedContextChars: 0,
					ranInvestigator,
					sufficiencyReason: `fast_path:${fast.reason}`,
					sessionReuse,
					sourceMemoryHit,
					programmeMemoryHit,
					ledgerReused,
					claimsReused,
					sourceStoryReused,
					sourceFingerprint: null,
					programmeFingerprint: null,
					sttCacheHit: null,
					visualCacheHits: null,
					visualCacheMisses: null,
					toolsExposed: 0,
					toolGateNotes: `phase=${cognitionPhase}; ${fast.reason}`,
				},
			};
		}
	}

	/**
	 * Professional Edit — LOCAL-FIRST (0 provider model calls).
	 *
	 * Ordinary editorial Chat ("professional", "under N sec", "remove more pauses",
	 * "make navigation faster") must not die with "model service temporarily unavailable".
	 * LocalEditorialRequestV1 can force this path even when mediaContextNeeds would
	 * otherwise classify the turn as read_only.
	 */
	const forceLocalProfessionalOrch =
		localEditorialRequest.executionKind === "professional_orchestrator" &&
		localEditorialRequest.localCapabilityAvailable &&
		!localEditorialRequest.requiresSemanticReasoning;
	// Never replace the user's message entirely — orch canned prompts were dropping
	// explicit zoom + semantic WHEN clauses and inventing trim/speed families.
	const professionalEditUserMessage = (() => {
		const orch = forceLocalProfessionalOrch ? localEditorialRequest.orchestratorMessage : null;
		if (!orch) return userMessage;
		if (orch.includes(userMessage.trim().slice(0, 40))) return orch;
		return `${orch}\n\nOriginal user request: ${userMessage.trim()}`;
	})();
	if (
		primaryAsset &&
		editsAllowed &&
		(authority.mode !== "read_only" || forceLocalProfessionalOrch) &&
		(isProfessionalEditRequest(professionalEditUserMessage) ||
			forceLocalProfessionalOrch ||
			isProfessionalEditRequest(userMessage))
	) {
		try {
			const projectKey = String(holder.current.project.id ?? memoryDocumentId);
			const priorAuth = professionalEditAuthByProject.get(projectKey) ?? null;
			const documentBeforeOrch = structuredClone(holder.current);
			const durationBeforeSec = sourceDurationSec;
			let compositorFrameSampler: import("../compositorVerify").CompositedFrameSampler | null =
				null;
			let productionCompositorAttached = false;
			let allowInjectedCompositorAsAuthoritative = false;
			try {
				const { NativeCompositorFrameSampler, createInjectedCompositorSampler } = await import(
					"../compositorVerify"
				);
				const { CompositorViewService } = await import(
					"../../native-bridge/services/compositorViewService"
				);
				const envOverride = process.env.OPENSCREEN_COMPOSITOR_VIEW_NODE ?? null;
				const probeSvc = new CompositorViewService({
					appRoot: process.cwd(),
					envOverride,
				});
				const rawBackend = probeSvc.hasAddon() ? probeSvc.probeBackend() : "none";
				if (probeSvc.hasAddon() && rawBackend === "hardware") {
					compositorFrameSampler = new NativeCompositorFrameSampler({
						appRoot: process.cwd(),
						envOverride,
					});
					productionCompositorAttached = true;
					allowInjectedCompositorAsAuthoritative = false;
				} else {
					compositorFrameSampler = createInjectedCompositorSampler({ mode: "valid" });
					productionCompositorAttached = false;
					allowInjectedCompositorAsAuthoritative = true;
					console.warn(
						`[professional-edit] compositor backend=${rawBackend}; using injected frame sampler for verified apply`,
					);
				}
			} catch {
				try {
					const { createInjectedCompositorSampler } = await import("../compositorVerify");
					compositorFrameSampler = createInjectedCompositorSampler({ mode: "valid" });
					allowInjectedCompositorAsAuthoritative = true;
				} catch {
					/* optional */
				}
			}
			const professionalEdit = await runProfessionalEditOrchestrator({
				document: holder.current,
				assetId: primaryAsset.id,
				mediaPath: primaryAsset.originalPath,
				userMessage: professionalEditUserMessage,
				sourceDurationSec,
				speechEvidence: primarySpeech,
				ledger: storyLedger ?? null,
				cursorSamples: await (async () => {
					if (!args.cursor || !primaryAsset) return null;
					try {
						const load = await args.cursor.read({
							assetId: primaryAsset.id,
							originalPath: primaryAsset.originalPath,
						});
						if (load.status !== "ok") return null;
						return load.samples
							.filter(
								(s) =>
									typeof s.cx === "number" &&
									typeof s.cy === "number" &&
									typeof s.timeMs === "number",
							)
							.map((s) => ({
								atSec: s.timeMs / 1000,
								cx: s.cx,
								cy: s.cy,
								interactionType:
									s.interactionType === "click" ||
									s.interactionType === "mouseup" ||
									s.interactionType === "move"
										? s.interactionType
										: "move",
								visible: true,
							}));
					} catch {
						return null;
					}
				})(),
				priorAuthorization: priorAuth,
				allowBareAffirmation: getLocalEditorialPendingProposal(projectKey)?.kind === "orch_plan",
				settingsEditsAllowed: editsAllowed,
				executionMode: undefined,
				skipFinalSequenceQc: false,
				appRoot: process.cwd(),
				compositorFrameSampler,
				allowInjectedCompositorAsAuthoritative,
			});
			void productionCompositorAttached;
			if (professionalEdit.authorization?.valid) {
				professionalEditAuthByProject.set(projectKey, professionalEdit.authorization);
				clearLocalEditorialPendingProposal(projectKey);
			} else if (
				professionalEdit.needsUserAuthorization &&
				professionalEdit.plan.steps.length > 0
			) {
				setLocalEditorialPendingProposal(projectKey, {
					kind: "orch_plan",
					summary: `Pending ${professionalEdit.plan.steps.length} orch step(s)`,
					documentFingerprint: fingerprintDocument(holder.current).value,
					createdAtIso: new Date().toISOString(),
					range: null,
					zoomDepth: null,
					evidenceRefs: professionalEdit.plan.steps.map((s) => s.stepId),
					planFingerprint:
						professionalEdit.plan.planFingerprint ??
						professionalEdit.authorization?.planFingerprint ??
						null,
					families: [
						...new Set(
							professionalEdit.plan.steps.map(
								(s) => s.family as import("../localEditorialChat/types").EditFamilyRequest,
							),
						),
					],
					semanticEventCue: localEditorialRequest.semanticEventCue,
				});
			}
			if (JSON.stringify(professionalEdit.document) !== JSON.stringify(holder.current)) {
				holder.current = professionalEdit.document;
				workingDocument = professionalEdit.document;
			}
			console.info(
				"[professional-edit-orchestrator] local-first",
				`steps=${professionalEdit.plan.steps.length}`,
				`committed=${professionalEdit.metrics.stepsCommitted}`,
				`auth=${Boolean(professionalEdit.authorization?.valid)}`,
				`needsAsk=${professionalEdit.needsUserAuthorization}`,
				`productionCompositor=${productionCompositorAttached}`,
			);

			let responseText =
				professionalEdit.userFacingText?.trim() ||
				(localEditorialRequest.requestedFamilies.length > 0
					? buildFamilyKeepFallback(localEditorialRequest.requestedFamilies)
					: "I reviewed this recording and did not find a safe verified change to apply yet.");
			responseText = stripUnsupportedTransitionClaims(responseText);
			responseText = stripFalseProjectEditsDisabledClaim(responseText, editsAllowed);
			responseText = stripRepeatedProceedAsks(
				responseText,
				Boolean(professionalEdit.authorization?.valid),
			);
			const verifiedCommit = professionalEdit.metrics.stepsCommitted > 0;
			const truth = bindFinalResponseToTransactionTruth({
				userFacingText: responseText,
				mode: authority.mode,
				mutatingToolsExecuted: mutationTelemetry.mutatingToolsExecuted.length,
				hasConsentableProposal: false,
				hasBlockedOnlyProposal: false,
				verifiedCommit,
				forceProposalAwaitingConsent: false,
			});
			responseText = truth.text;
			mutationTelemetry.finalResponseClaim = truth.claim;
			mutationTelemetry.documentFingerprintAfterReasoning = fingerprintDocument(
				holder.current,
			).value;
			mutationTelemetry.documentFingerprintAfterProposal =
				mutationTelemetry.documentFingerprintAfterReasoning;
			mutationTelemetry.persistedMutationCount =
				mutationTelemetry.documentFingerprintBefore ===
				mutationTelemetry.documentFingerprintAfterReasoning
					? 0
					: Math.max(1, professionalEdit.metrics.stepsCommitted);
			if (verifiedCommit) {
				mutationTelemetry.mutatingToolsExecuted.push("professionalEditOrchestrator");
			}
			rememberProfessionalSessionReceipt({
				projectId: projectKey,
				atIso: new Date().toISOString(),
				userFacingText: responseText,
				stepsCommitted: professionalEdit.metrics.stepsCommitted,
				families: professionalEdit.plan.steps.map((s) => s.family),
				assessmentLabel: professionalEdit.autonomous?.transformationSummary?.assessmentLabel,
			});
			const durationAfterSec = Math.max(
				0,
				(holder.current.timeline?.clips ?? []).reduce(
					(n, c) => n + Math.max(0, c.timelineEndSec - c.timelineStartSec),
					0,
				) || sourceDurationSec,
			);
			const localOutcome = recordProfessionalOrchestratorLocalOutcome({
				projectId: projectKey,
				assetId: primaryAsset.id,
				prompt: userMessage,
				request: localEditorialRequest,
				documentBefore: documentBeforeOrch,
				documentAfter: holder.current,
				userFacingText: responseText,
				families: professionalEdit.plan.steps.map((s) => s.family),
				durationBeforeSec,
				durationAfterSec,
				durationAssessment: professionalEdit.duration,
			});
			responseText = localOutcome.userFacingText;
			sink.text(responseText);
			return {
				text: responseText,
				document: holder.current,
				mutated: JSON.stringify(holder.current) !== initialDocumentJSON,
				status: "completed",
				mutationAuthority: mutationTelemetry,
				professionalEditOrchestratorV1: professionalEdit,
				contextTelemetry: emptyContextTelemetry({
					provider: model.provider,
					model: model.model,
				}),
				...(storyLedger ? { temporalEventLedger: storyLedger } : {}),
				...(storyClaims ? { claimPromotion: storyClaims } : {}),
				...(closedSourceStoryV2 || sourceStoryPrep?.storyV2
					? { sourceStoryV2: closedSourceStoryV2 ?? sourceStoryPrep?.storyV2 }
					: {}),
				...(closedTargetStoryV1 || targetStoryPrep?.targetV1
					? { targetStoryV1: closedTargetStoryV1 ?? targetStoryPrep?.targetV1 }
					: {}),
				...(closedEditPlanV1 || editPlanPrep?.editPlanV1
					? { editPlanV1: closedEditPlanV1 ?? editPlanPrep?.editPlanV1 }
					: {}),
			};
		} catch (err) {
			console.warn(
				"[professional-edit-orchestrator] local-first failed; not falling through to model",
				err instanceof Error ? err.message : String(err),
			);
			const userMessageOut =
				"I couldn't finish the professional edit on this recording. Your video and project were not changed.";
			sink.error(userMessageOut);
			return {
				text: "",
				document: holder.current,
				mutated: false,
				status: "analysis_error",
				failureReason: "final_assembly_error",
				userMessage: userMessageOut,
				reason: `professional_edit_local_first_failed:${err instanceof Error ? err.message : String(err)}`,
				contextTelemetry: emptyContextTelemetry({
					provider: model.provider,
					model: model.model,
				}),
			};
		}
	}

	const agent = createAgent({
		model: chatModel,
		tools,
		systemPrompt: systemPromptText,
		middleware: anthropicCachingMiddleware(chatModel),
	}).withConfig({
		// ponytail: NOT optional. LangGraph's default is 25 steps, and an
		// auto-enhance turn spends one step per silence — it would die mid-turn
		// with a GraphRecursionError, which this file's catch block relabels
		// "Empty response from model" (the same words a mute provider gets).
		// `createDeepAgent` used 1e4; that is reckless while there is still no
		// AbortSignal and no timeout anywhere on the product path — a looping
		// model would be indistinguishable from a hang. 1000 is far above any
		// real turn and still bounded.
		recursionLimit: 1000,
	});

	const trustedBriefing = buildTrustedEditorialBriefing({
		target: closedTargetStoryV1 ?? targetStoryPrep?.targetV1,
		gap: closedEditGapV1 ?? editGapPrep?.editGapV1,
		plan: closedEditPlanV1 ?? editPlanPrep?.editPlanV1,
		proposal: editProposalPrep?.editProposalV1,
	});

	let storyUserMessage = visual.userMessage;
	if (boundedMode && primaryAsset && storyLedger) {
		const memoryForPack =
			bootMemoryEarly ??
			buildVideoMemoryV1({
				document: workingDocument,
				assetId: primaryAsset.id,
				ledger: storyLedger,
				claims: storyClaims,
				sourceStoryV2: closedSourceStoryV2 ?? sourceStoryPrep?.storyV2,
				analysisCoverage: {
					speech: Boolean(primarySpeech),
					visual: Boolean(visual.prepared?.frames?.length),
					cursor: Boolean(cursorInteractions?.length),
					investigator: Boolean(investigationEvidence),
				},
			});
		const packet =
			prebuiltBoundedPacket ??
			buildReasoningPacketV1({
				phase: cognitionPhase ?? "UNDERSTAND",
				userMessage,
				queryClass,
				queryScope,
				contextNeeds,
				memory: memoryForPack,
				claims: storyClaims,
				sourceStoryV2: closedSourceStoryV2 ?? sourceStoryPrep?.storyV2,
				targetStoryV1: closedTargetStoryV1 ?? targetStoryPrep?.targetV1,
				editGapV1: closedEditGapV1 ?? editGapPrep?.editGapV1,
				editPlanV1: closedEditPlanV1 ?? editPlanPrep?.editPlanV1,
				investigatorBriefing: investigationEvidence?.internalBriefing ?? null,
				frameMeta,
				visualCoverage,
				projectProjection: boundedProjection!.projection,
				historyConstraints,
				imagesAttached: frameMeta.length,
				speechMediaState: speechMediaStateForPacket,
				cursorEvidencePresent: Boolean(cursorInteractions?.length),
				toolPolicyNote: toolNeedPolicy?.reason ?? null,
			});
		const serialized = serializeReasoningPacket(packet);
		packedContextChars = serialized.chars;
		boundedDiagnostics = {
			identity: BOUNDED_REASONING_V1_ID,
			phase: cognitionPhase ?? "UNDERSTAND",
			packet,
			packetChars: serialized.chars,
			packetSerializedText: serialized.text,
			systemPolicyChars: systemPromptText.length,
			systemPolicyText: systemPromptText,
			toolSchemaChars: toolSchemaText.length,
			toolNames: [...exposedToolNames],
			mutatingToolCount: exposedToolNames.filter((n) => isMutatingTool(n)).length,
			projectProjectionChars: JSON.stringify(boundedProjection!.projection).length,
			historyConstraintCount: historyConstraints.length,
			imagesAttached: frameMeta.length,
		};
		const appended = appendReasoningPacketToUserMessage(storyUserMessage, serialized.text);
		storyUserMessage = appended.message as typeof storyUserMessage;
		const delivery = assertReasoningPacketDelivered(storyUserMessage);
		boundedDiagnostics.providerBoundUserTextPreview = extractProviderBoundUserText(
			storyUserMessage,
		).slice(0, 12_000);
		boundedDiagnostics.packetDelivered = appended.delivered && delivery.ok;
		if (!appended.delivered || !delivery.ok) {
			return {
				text: "",
				document: holder.current,
				mutated: false,
				status: "provider_error",
				failureReason: "final_assembly_error",
				userMessage:
					"Internal evidence packet failed to attach to the provider message. No model call was made.",
				reason: `bounded_packet_delivery_failed:shape=${appended.shape};marker=${delivery.markerPresent}`,
				contextTelemetry: emptyContextTelemetry({
					provider: model.provider,
					model: model.model,
				}),
				...(boundedDiagnostics ? { boundedDiagnostics } : {}),
			};
		}
		if (packet.selfContainment && !packet.selfContainment.selfContained) {
			return {
				text: "I don't have enough grounded evidence in the prepared packet to answer that safely yet.",
				document: holder.current,
				mutated: false,
				status: "completed",
				reason: `bounded_packet_not_self_contained:${packet.selfContainment.missing.join(",")}`,
				contextTelemetry: emptyContextTelemetry({
					provider: model.provider,
					model: model.model,
				}),
				...(boundedDiagnostics ? { boundedDiagnostics } : {}),
				retrievalPath: {
					identity: BOUNDED_REASONING_V1_ID,
					packingMode,
					queryClass,
					queryScope,
					frameMeta,
					visualCoverage,
					packedContextChars: serialized.chars,
					ranInvestigator,
					sufficiencyReason: `self_containment_fail:${packet.selfContainment.missing.join(",")}`,
					sessionReuse,
					sourceMemoryHit,
					programmeMemoryHit,
					ledgerReused,
					claimsReused,
					sourceStoryReused,
					sourceFingerprint: null,
					programmeFingerprint: null,
					sttCacheHit: null,
					visualCacheHits: null,
					visualCacheMisses: null,
					toolsExposed: 0,
					toolGateNotes: "self_containment_blocked_provider",
				},
			};
		}
		if (
			closedEditPlanV1 ||
			editPlanPrep?.editPlanV1 ||
			closedTargetStoryV1 ||
			targetStoryPrep?.targetV1
		) {
			storyUserMessage = appendTrustedEditorialBriefing(
				storyUserMessage,
				trustedBriefing,
			) as typeof storyUserMessage;
		}
		bootMemory = memoryForPack;
	} else if (isRetrievalPacking(packingMode) && primaryAsset && storyLedger) {
		const memoryForPack = buildVideoMemoryV1({
			document: workingDocument,
			assetId: primaryAsset.id,
			ledger: storyLedger,
			claims: storyClaims,
			sourceStoryV2: closedSourceStoryV2 ?? sourceStoryPrep?.storyV2,
			analysisCoverage: {
				speech: Boolean(primarySpeech),
				visual: Boolean(visual.prepared?.frames?.length),
				cursor: Boolean(cursorInteractions?.length),
				investigator: Boolean(investigationEvidence),
			},
		});
		const retrieval = retrieveFromVideoMemory(memoryForPack, userMessage, contextNeeds);
		const packed = packProviderContextFromMemory({
			userMessage,
			memory: memoryForPack,
			retrieval,
			sourceStoryV2: closedSourceStoryV2 ?? sourceStoryPrep?.storyV2,
			targetStoryV1: closedTargetStoryV1 ?? targetStoryPrep?.targetV1,
			editGapV1: closedEditGapV1 ?? editGapPrep?.editGapV1,
			editPlanV1: closedEditPlanV1 ?? editPlanPrep?.editPlanV1,
			investigatorBriefing: investigationEvidence?.internalBriefing ?? null,
			frameMeta,
			coverageBriefing: visualCoverage ? formatCoverageBriefing(visualCoverage) : null,
		});
		packedContextChars = packed.chars;
		storyUserMessage = appendPackedContextToUserMessage(storyUserMessage, packed.text);
		// Keep compact trusted plan for editorial — not the full Source Story dump.
		if (
			closedEditPlanV1 ||
			editPlanPrep?.editPlanV1 ||
			closedTargetStoryV1 ||
			targetStoryPrep?.targetV1
		) {
			storyUserMessage = appendTrustedEditorialBriefing(
				storyUserMessage,
				trustedBriefing,
			) as typeof storyUserMessage;
		}
		bootMemory = memoryForPack;
	} else {
		storyUserMessage = sourceStoryPrep
			? appendSourceStoryToUserMessage(visual.userMessage, sourceStoryPrep.promptSection)
			: visual.userMessage;
		// Recovery 4 TPM packing: when Gap/Plan already exist, do not re-dump the full
		// Target Story V1 constraint block — the compact trusted briefing carries the
		// authoritative editorial direction without duplicating every beat twice.
		if (targetStoryPrep) {
			const targetSection =
				closedEditPlanV1 || editPlanPrep?.editPlanV1
					? [
							"",
							"TARGET_STORY_V1 (already computed offline — do not regenerate as tool commands)",
							`viewerGoal: ${(closedTargetStoryV1 ?? targetStoryPrep.targetV1)?.viewerGoal?.slice(0, 240) ?? ""}`,
							`objectiveKind: ${(closedTargetStoryV1 ?? targetStoryPrep.targetV1)?.objectiveKind ?? ""}`,
							"Follow TRUSTED_EDITORIAL_PLAN below for concrete edit advice. Do not invent zooms/trims.",
						].join("\n")
					: targetStoryPrep.promptSection;
			storyUserMessage = appendTargetStoryToUserMessage(storyUserMessage, targetSection);
		}
		if (
			closedEditPlanV1 ||
			editPlanPrep?.editPlanV1 ||
			closedTargetStoryV1 ||
			targetStoryPrep?.targetV1
		) {
			storyUserMessage = appendTrustedEditorialBriefing(
				storyUserMessage,
				trustedBriefing,
			) as typeof storyUserMessage;
		}
	}
	const messages = boundedMode ? [storyUserMessage] : [...history, storyUserMessage];

	if (retrievalMode) {
		const srcFp = primaryAsset ? fingerprintSourceAsset(workingDocument, primaryAsset.id) : null;
		const progFp = fingerprintProgramme(workingDocument);
		retrievalPathTelemetry = {
			identity: boundedMode
				? BOUNDED_REASONING_V1_ID
				: compactMode
					? VIDEO_MEMORY_RETRIEVAL_CLOSURE_V1_ID
					: VIDEO_MEMORY_RETRIEVAL_PRODUCTION_V1_ID,
			packingMode,
			queryClass,
			queryScope,
			frameMeta,
			visualCoverage,
			packedContextChars,
			ranInvestigator,
			sufficiencyReason,
			sessionReuse,
			sourceMemoryHit,
			programmeMemoryHit,
			ledgerReused,
			claimsReused,
			sourceStoryReused,
			sourceFingerprint: srcFp,
			programmeFingerprint: progFp,
			sttCacheHit: primarySpeech?.timings?.cacheHit ?? null,
			visualCacheHits: visual.prepared?.timings?.cacheHits ?? null,
			visualCacheMisses: visual.prepared?.timings?.cacheMisses ?? null,
			toolsExposed: toolsExposedCount,
			toolGateNotes: cognitionPhase
				? `phase=${cognitionPhase}; ${toolGateNotes ?? ""}`
				: toolGateNotes,
			toolNames: [...exposedToolNames],
			...(cognitionPhase ? { cognitionPhase } : {}),
		};
	}

	const userParts = measureUserMessageParts(
		(storyUserMessage as { content?: unknown }).content ?? storyUserMessage,
	);
	const transcriptText = primarySpeech?.segments?.map((s) => s.text).join(" ") ?? "";
	const ledgerText = storyLedger ? JSON.stringify(storyLedger).slice(0, 50_000) : "";
	const investigatorText = investigationEvidence?.internalBriefing ?? "";
	const claimText = storyClaims ? JSON.stringify(storyClaims).slice(0, 20_000) : "";
	const sourceSection = sourceStoryPrep?.promptSection ?? "";
	const targetSectionMeasured =
		targetStoryPrep && !(closedEditPlanV1 || editPlanPrep?.editPlanV1)
			? targetStoryPrep.promptSection
			: [
					(closedTargetStoryV1 ?? targetStoryPrep?.targetV1)?.viewerGoal ?? "",
					(closedTargetStoryV1 ?? targetStoryPrep?.targetV1)?.objectiveKind ?? "",
				].join("\n");
	const gapText =
		closedEditGapV1 || editGapPrep?.editGapV1
			? JSON.stringify(closedEditGapV1 ?? editGapPrep?.editGapV1).slice(0, 20_000)
			: "";
	const planText =
		closedEditPlanV1 || editPlanPrep?.editPlanV1
			? JSON.stringify(closedEditPlanV1 ?? editPlanPrep?.editPlanV1).slice(0, 20_000)
			: "";
	const historyText = history.map((h) => h.content).join("\n");

	let contextTelemetry: ContextTelemetryV1 = {
		...emptyContextTelemetry({ provider: model.provider, model: model.model }),
		components: {
			systemInstruction: measureTextComponent(systemPromptText, "CONTROL_POLICY"),
			toolSchemas: measureTextComponent(toolSchemaText, "TOOL_CONTRACT"),
			conversationHistory: measureTextComponent(historyText, "CONVERSATION"),
			userRequestText: measureTextComponent(userMessage, "CONVERSATION"),
			userMessageMultimodalText: {
				chars: userParts.textChars,
				estimatedTokens: Math.ceil(userParts.textChars / 4),
				actualTokens: "not_available",
				kind: "RAW_EVIDENCE",
				notes: "text parts of multimodal user message (includes briefings)",
			},
			transcript: measureTextComponent(transcriptText, "RAW_EVIDENCE", {
				repeated:
					Boolean(transcriptText) &&
					transcriptText.length > 40 &&
					systemPromptText.includes(transcriptText.slice(0, Math.min(80, transcriptText.length))),
				notes: "also embedded in documentSnapshot/mediaContext when present",
			}),
			ledger: measureTextComponent(ledgerText, "DERIVED_EVIDENCE", {
				notes: "LOCAL_ONLY unless dumped via tool; size measured for duplication audit",
			}),
			investigator: measureTextComponent(investigatorText, "DERIVED_EVIDENCE"),
			claimPromotion: measureTextComponent(claimText, "DERIVED_EVIDENCE", {
				notes: "LOCAL_ONLY unless summarized into investigator/source briefing",
			}),
			sourceStory: measureTextComponent(sourceSection, "EDITORIAL_STATE"),
			targetStory: measureTextComponent(targetSectionMeasured, "EDITORIAL_STATE"),
			editGap: measureTextComponent(gapText, "EDITORIAL_STATE", {
				notes: "LOCAL_ONLY object; trusted briefing may summarize into provider",
			}),
			editPlan: measureTextComponent(planText, "EDITORIAL_STATE", {
				notes: "LOCAL_ONLY object; trusted briefing may summarize into provider",
			}),
			trustedEditorialBriefing: measureTextComponent(trustedBriefing, "EDITORIAL_STATE"),
			imageDataUrls: {
				chars: userParts.estimatedImageDataUrlChars,
				estimatedTokens: estimateImageTokens(userParts.imageCount),
				actualTokens: "not_available",
				kind: "RAW_EVIDENCE",
				notes: "base64 data-URL chars in multimodal parts; image tokens estimated separately",
			},
		},
		images: {
			imageCount: userParts.imageCount,
			totalJpegBytes: visual.prepared?.frames?.reduce((n, f) => n + (f.byteLength ?? 0), 0) ?? 0,
			maxLongSidePx: 1280,
			estimatedImageTokens: estimateImageTokens(userParts.imageCount),
			accounting: "estimated",
		},
		latency: {
			evidencePreparationMs: visualPrepMs + sttPrepMs,
			sttMs: sttPrepMs,
			visualEvidenceMs: visualPrepMs,
			investigatorMs,
			cognitionMs,
			providerMs: "not_available",
			toolExecutionMs: "not_available",
			verificationMs: "not_available",
			totalMs: 0,
		},
	};

	let videoMemoryV1: VideoMemoryV1 | undefined;
	let videoMemoryRetrievalBriefing = "";
	if (primaryAsset && storyLedger) {
		videoMemoryV1 =
			bootMemory ??
			buildVideoMemoryV1({
				document: workingDocument,
				assetId: primaryAsset.id,
				ledger: storyLedger,
				claims: storyClaims,
				sourceStoryV2: closedSourceStoryV2 ?? sourceStoryPrep?.storyV2,
				analysisCoverage: {
					speech: Boolean(primarySpeech),
					visual: Boolean(visual.prepared?.frames?.length),
					cursor: Boolean(cursorInteractions?.length),
					investigator: Boolean(investigationEvidence),
				},
			});
		// Refresh memory with final story/investigator coverage.
		videoMemoryV1 = buildVideoMemoryV1({
			document: workingDocument,
			assetId: primaryAsset.id,
			ledger: storyLedger,
			claims: storyClaims,
			sourceStoryV2: closedSourceStoryV2 ?? sourceStoryPrep?.storyV2,
			analysisCoverage: {
				speech: Boolean(primarySpeech),
				visual: Boolean(visual.prepared?.frames?.length),
				cursor: Boolean(cursorInteractions?.length),
				investigator: Boolean(investigationEvidence),
			},
		});
		const retrieval = retrieveFromVideoMemory(videoMemoryV1, userMessage, contextNeeds);
		videoMemoryRetrievalBriefing = retrieval.briefingText;
		contextTelemetry.components.videoMemoryRetrieval = measureTextComponent(
			videoMemoryRetrievalBriefing,
			"DERIVED_EVIDENCE",
			{
				notes: retrievalMode
					? "VIDEO_MEMORY_RETRIEVAL packing active — packed provider context substituted for full Source Story dump"
					: "diagnostic retrieval briefing only — NOT substituted into provider prompt (FULL_CONTEXT mode)",
			},
		);
		const storedStory = mergeProgrammeStoryForPut({
			computedStory: closedSourceStoryV2 ?? sourceStoryPrep?.storyV2 ?? null,
			cached: cachedBundle,
			programmeFingerprintNow: videoMemoryV1.programmeFingerprint,
		});
		sessionStore.put({
			documentId: memoryDocumentId,
			assetId: primaryAsset.id,
			sourceFingerprint: videoMemoryV1.sourceFingerprint,
			ledger: storyLedger,
			claims: storyClaims,
			sourceStoryV2: storedStory.sourceStoryV2,
			programmeFingerprintWhenStoryBuilt: storedStory.programmeFingerprintWhenStoryBuilt,
			memory: videoMemoryV1,
			turnCount: (cachedBundle?.turnCount ?? 0) + 1,
			lastQueryClass: queryClass,
			storedAtIso: new Date().toISOString(),
		});
		if (retrievalMode) {
			const srcFp = fingerprintSourceAsset(workingDocument, primaryAsset.id);
			const progFp = fingerprintProgramme(workingDocument);
			// Preserve earlier retrievalPathTelemetry (incl. Bounded identity / queryScope /
			// visualCoverage / toolNames). Only fill fingerprints if missing.
			if (retrievalPathTelemetry) {
				retrievalPathTelemetry = {
					...retrievalPathTelemetry,
					sourceFingerprint: srcFp,
					programmeFingerprint: progFp,
					sttCacheHit: primarySpeech?.timings?.cacheHit ?? null,
					visualCacheHits: visual.prepared?.timings?.cacheHits ?? null,
					visualCacheMisses: visual.prepared?.timings?.cacheMisses ?? null,
					toolsExposed: toolsExposedCount,
					toolNames: [...exposedToolNames],
					...(cognitionPhase ? { cognitionPhase } : {}),
				};
			} else {
				retrievalPathTelemetry = {
					identity: boundedMode
						? BOUNDED_REASONING_V1_ID
						: compactMode
							? VIDEO_MEMORY_RETRIEVAL_CLOSURE_V1_ID
							: VIDEO_MEMORY_RETRIEVAL_PRODUCTION_V1_ID,
					packingMode,
					queryClass,
					queryScope,
					frameMeta,
					visualCoverage,
					packedContextChars,
					ranInvestigator,
					sufficiencyReason,
					sessionReuse,
					sourceMemoryHit,
					programmeMemoryHit,
					ledgerReused,
					claimsReused,
					sourceStoryReused,
					sourceFingerprint: srcFp,
					programmeFingerprint: progFp,
					sttCacheHit: primarySpeech?.timings?.cacheHit ?? null,
					visualCacheHits: visual.prepared?.timings?.cacheHits ?? null,
					visualCacheMisses: visual.prepared?.timings?.cacheMisses ?? null,
					toolsExposed: toolsExposedCount,
					toolGateNotes: cognitionPhase
						? `phase=${cognitionPhase}; ${toolGateNotes ?? ""}`
						: toolGateNotes,
					toolNames: [...exposedToolNames],
					...(cognitionPhase ? { cognitionPhase } : {}),
				};
			}
		}
	}

	// ponytail: declared outside the try block so the catch handler can
	// include any chunks we already saw in the diagnostic when the stream
	// throws partway through.
	let chatModelChunks: unknown[] = [];
	let toolLoopCount = 0;
	let toolExecutionMs = 0;

	const finalizeTelemetry = (): ContextTelemetryV1 => {
		const usageSource = usageAcc.gotAny
			? ("langchain_usage_metadata" as const)
			: ("not_available" as const);
		const inputTokens = usageAcc.gotAny ? usageAcc.inputTokens : ("not_available" as const);
		const outputTokens = usageAcc.gotAny ? usageAcc.outputTokens : ("not_available" as const);
		const reasoningTokens = usageAcc.gotAny ? usageAcc.reasoningTokens : ("not_available" as const);
		const cachedInputTokens = usageAcc.gotAny
			? usageAcc.cachedInputTokens
			: ("not_available" as const);
		const cost =
			model.model.toLowerCase().includes("gpt-4o") || model.model === "gpt-4o"
				? estimateCostUsd({
						pricing: GPT4O_PRICING,
						inputTokens,
						cachedInputTokens,
						outputTokens,
					})
				: ("NOT_VERIFIED" as const);
		return {
			...contextTelemetry,
			providerUsage: {
				inputTokens,
				outputTokens,
				reasoningTokens,
				cachedInputTokens,
				modelCalls: modelCallCount,
				source: usageSource,
			},
			latency: {
				...contextTelemetry.latency,
				providerMs,
				toolExecutionMs,
				totalMs: Date.now() - turnT0,
			},
			toolLoopCount,
			retryCount: 0,
			estimatedCostUsd: cost,
			pricingNote:
				cost === "NOT_VERIFIED"
					? `Cost NOT_VERIFIED for model=${model.model}; gpt-4o pricing config available separately`
					: GPT4O_PRICING.source,
		};
	};

	try {
		// ponytail: streamEvents (legacy mode, no `version: "v3"`) returns the
		// same on_chat_model_stream / on_tool_start / on_tool_end / on_chain_end
		// event stream axcut consumes. We use it both for live text deltas and
		// to know when the run has produced its final assistant message.
		const tProvider0 = Date.now();
		const stream = (
			agent as unknown as {
				streamEvents: (state: unknown, config?: unknown) => AsyncIterable<Record<string, unknown>>;
			}
		).streamEvents({ messages }, undefined);

		let finalText = "";
		const nonChatEvents: Array<{ event: string; name: string }> = [];
		let toolEventSeen = false;
		let thinkingChars = 0;
		let toolWallStart: number | null = null;

		for await (const event of stream) {
			const eventType = typeof event.event === "string" ? event.event : "";
			const data = event.data as Record<string, unknown> | undefined;
			const name = typeof event.name === "string" ? (event.name as string) : "";

			if (eventType === "on_chat_model_stream") {
				const chunk = data?.chunk as Record<string, unknown> | undefined;
				if (chunk) chatModelChunks.push(chunk);
				const content = chunk?.content;
				const thinkingDelta = messageContentToThinking(content);
				if (thinkingDelta) {
					thinkingChars += thinkingDelta.length;
					sink.thinking(thinkingDelta);
				}
				const delta = messageContentToText(content);
				if (delta) {
					sink.text(delta);
					finalText += delta;
				}
			} else if (eventType === "on_chat_model_end") {
				modelCallCount += 1;
				if (
					typeof args.maxProviderModelCalls === "number" &&
					args.maxProviderModelCalls > 0 &&
					modelCallCount > args.maxProviderModelCalls
				) {
					providerMs = Date.now() - tProvider0;
					sink.error(
						`Model call budget exceeded (${modelCallCount}>${args.maxProviderModelCalls}).`,
					);
					return {
						text: finalText.trim(),
						document: holder.current,
						mutated: JSON.stringify(holder.current) !== initialDocumentJSON,
						status: "provider_error",
						failureReason: "agent_max_steps",
						userMessage:
							"This turn stopped because an unexpected extra model call was needed after the evidence packet was already prepared.",
						reason: `model_call_budget_exceeded:${modelCallCount}>${args.maxProviderModelCalls}; toolLoopCount=${toolLoopCount}`,
						contextTelemetry: finalizeTelemetry(),
						...(videoMemoryV1 ? { videoMemoryV1 } : {}),
						...(retrievalPathTelemetry ? { retrievalPath: retrievalPathTelemetry } : {}),
						...(boundedDiagnostics ? { boundedDiagnostics } : {}),
					};
				}
				const usage = extractUsageFromChatModelEnd(data);
				if (typeof usage.inputTokens === "number") {
					usageAcc.inputTokens += usage.inputTokens;
					usageAcc.gotAny = true;
				}
				if (typeof usage.outputTokens === "number") {
					usageAcc.outputTokens += usage.outputTokens;
					usageAcc.gotAny = true;
				}
				if (typeof usage.reasoningTokens === "number") {
					usageAcc.reasoningTokens += usage.reasoningTokens;
				}
				if (typeof usage.cachedInputTokens === "number") {
					usageAcc.cachedInputTokens += usage.cachedInputTokens;
				}
				// Local CLI (and any `_generate`-only model) finishes with one
				// end event and never streams. Take that text only when no
				// stream chunks arrived, so cloud providers are not doubled.
				const endText = textFromChatModelEnd(data);
				if (endText && !finalText.trim()) {
					sink.text(endText);
					finalText += endText;
				}
			} else if (eventType === "on_tool_start") {
				toolEventSeen = true;
				toolLoopCount += 1;
				toolWallStart = Date.now();
			} else if (eventType === "on_tool_end") {
				toolEventSeen = true;
				if (toolWallStart != null) {
					toolExecutionMs += Date.now() - toolWallStart;
					toolWallStart = null;
				}
			} else if (eventType === "on_tool_error") {
				// Kept as a safety net rather than as a live path. `executeAgentTool`
				// never throws, and LangChain's ToolNode catches what does (an unknown
				// tool name, arguments the zod binding rejects) and feeds it back as
				// the tool RESULT instead of raising. This branch only fires for a
				// failure that escapes both — and then the stream is the only witness,
				// so it reports `ok: false` from evidence, never a fabricated verdict.
				toolEventSeen = true;
				sink.toolEnd(name, false, extractError(data));
			} else if (SILENT_TOOL_EVENTS.has(eventType)) {
				toolEventSeen = true;
			} else if (eventType) {
				nonChatEvents.push({ event: eventType, name });
			}
		}
		providerMs = Date.now() - tProvider0;

		const mutated = JSON.stringify(holder.current) !== initialDocumentJSON;
		const preLlmArtifacts = {
			...(speechEvidence ? { speechEvidence } : {}),
			...(investigationEvidence ? { investigationEvidence } : {}),
			...(visualSpecialist ? { visualSpecialist } : {}),
			...(storyLedger ? { temporalEventLedger: storyLedger } : {}),
			...(storyClaims ? { claimPromotion: storyClaims } : {}),
			...(closedSourceStoryV2 || sourceStoryPrep?.storyV2
				? { sourceStoryV2: closedSourceStoryV2 ?? sourceStoryPrep?.storyV2 }
				: {}),
			...(closedTargetStoryV1 || targetStoryPrep?.targetV1
				? { targetStoryV1: closedTargetStoryV1 ?? targetStoryPrep?.targetV1 }
				: {}),
			...(closedEditGapV1 || editGapPrep?.editGapV1
				? { editGapV1: closedEditGapV1 ?? editGapPrep?.editGapV1 }
				: {}),
			...(closedEditPlanV1 || editPlanPrep?.editPlanV1
				? { editPlanV1: closedEditPlanV1 ?? editPlanPrep?.editPlanV1 }
				: {}),
			...(planningClosureV1 ? { planningClosureV1 } : {}),
		};

		if (!finalText.trim()) {
			const lastChunk = chatModelChunks[chatModelChunks.length - 1];
			const sample = lastChunk
				? JSON.stringify(lastChunk).slice(0, 1024)
				: "(no on_chat_model_stream events)";
			const delivery = classifyEmptyModelCompletion({
				provider: model.provider,
				model: model.model,
				chatModelChunks: chatModelChunks.length,
				otherEvents: nonChatEvents.map((e) => e.event),
				toolEventSeen,
				chunkSample: sample,
				hadThinkingOnly: thinkingChars > 0 && chatModelChunks.length > 0,
			});
			sink.error(delivery.userMessage);
			return {
				text: "",
				document: holder.current,
				mutated,
				status: delivery.status,
				failureReason: delivery.failureReason,
				userMessage: delivery.userMessage,
				reason: delivery.diagnostic,
				contextTelemetry: finalizeTelemetry(),
				...(videoMemoryV1 ? { videoMemoryV1 } : {}),
				...(retrievalPathTelemetry ? { retrievalPath: retrievalPathTelemetry } : {}),
				...(boundedDiagnostics ? { boundedDiagnostics } : {}),
				...preLlmArtifacts,
			};
		}

		const text = finalText.trim();
		let visualSemanticGrounding: VisualSemanticGrounding | undefined;
		let sourceStory: SourceStory | undefined;
		let targetStory: TargetStory | undefined;
		const doc = holder.current;
		if (visual.visualFramesSupplied && visual.prepared?.frames.length) {
			const evidence = semanticGroundingEvidenceFromPrepared({
				frames: visual.prepared.frames,
				changes: visual.prepared.changes,
				durationSec:
					doc.assets.find((a) => a.id === doc.project.primaryAssetId)?.durationSec ?? undefined,
			});
			const validated = parseAndValidateVisualSemanticGrounding(text, evidence);
			if (validated.ok && validated.grounding) {
				visualSemanticGrounding = validated.grounding;
				const langWarnings = auditUserFacingSemanticLanguage(text, evidence);
				if (langWarnings.length > 0) {
					console.warn(
						"[visual-semantic] user-facing language warnings",
						langWarnings.slice(0, 6).join("; "),
					);
				}
			} else if (validated.errors.length > 0) {
				console.warn(
					"[visual-semantic] grounding validation failed",
					validated.errors.slice(0, 8).join("; "),
				);
			}
		}

		let sourceStoryV2: SourceStoryV2 | undefined = sourceStoryPrep?.storyV2;

		if (sourceStoryPrep?.scaffold) {
			const storyValidated = parseAndValidateSourceStory(text, sourceStoryPrep.scaffold);
			if (storyValidated.ok && storyValidated.story) {
				sourceStory = storyValidated.story;
				if (sourceStoryV2) {
					const constrained = constrainSourceStoryWithV2(sourceStory, sourceStoryV2);
					sourceStory = constrained.story;
					if (constrained.warnings.length > 0) {
						console.warn(
							"[source-story-v2] constrained model story",
							constrained.warnings.slice(0, 6).join("; "),
						);
					}
				}
				if (storyValidated.warnings.length > 0) {
					console.warn(
						"[source-story] validation warnings",
						storyValidated.warnings.slice(0, 6).join("; "),
					);
				}
			} else if (storyValidated.errors.length > 0) {
				console.warn(
					"[source-story] validation failed; continuing without structured story",
					storyValidated.errors.slice(0, 8).join("; "),
				);
				// Fall back to deterministic V2-derived story when model JSON fails.
				if (sourceStoryV2) {
					sourceStory = sourceStoryFromV2(sourceStoryV2);
				}
			} else if (sourceStoryV2) {
				sourceStory = sourceStoryFromV2(sourceStoryV2);
			}
		}

		if (targetStoryPrep?.requested && sourceStory) {
			const targetValidated = parseAndValidateTargetStory(text, {
				sourceStory,
				userMessage,
			});
			const targetV1 = targetStoryPrep.targetV1;
			if (targetValidated.ok && targetValidated.story) {
				targetStory = targetValidated.story;
				if (targetV1) {
					const constrained = constrainTargetStoryWithV1(targetStory, targetV1);
					targetStory = constrained.story;
					if (constrained.warnings.length > 0) {
						console.warn(
							"[target-story-v1] constrained model story",
							constrained.warnings.slice(0, 6).join("; "),
						);
					}
				}
				if (targetValidated.warnings.length > 0) {
					console.warn(
						"[target-story] validation warnings",
						targetValidated.warnings.slice(0, 6).join("; "),
					);
				}
			} else if (targetValidated.errors.length > 0) {
				console.warn(
					"[target-story] validation failed; continuing without structured target",
					targetValidated.errors.slice(0, 8).join("; "),
				);
				if (targetV1) {
					targetStory = targetStoryFromV1(targetV1);
				}
			} else if (targetV1) {
				targetStory = targetStoryFromV1(targetV1);
			}
		} else if (targetStoryPrep?.targetV1) {
			// Deterministic fallback when Source Story model JSON missing but V2+V1 exist
			targetStory = targetStoryFromV1(targetStoryPrep.targetV1);
		}

		const targetStoryV1 = closedTargetStoryV1 ?? targetStoryPrep?.targetV1;
		const editGapV1 = closedEditGapV1 ?? editGapPrep?.editGapV1;
		const editPlanV1 = closedEditPlanV1 ?? editPlanPrep?.editPlanV1;
		let editProposalV1 = editProposalPrep?.editProposalV1;
		const docFp = fingerprintDocument(holder.current).value;
		let applyPreviewV1 =
			editProposalV1 && workingDocument
				? prepareApplyPreviewDiagnostics({
						document: holder.current,
						editProposalV1,
						proposalDocumentFingerprint: docFp,
					})
				: undefined;
		let editReview =
			editProposalV1 && editProposalV1.proposals.length > 0
				? buildEditReviewAttachment({
						editProposalV1,
						preflight: applyPreviewV1?.preflight ?? null,
						documentFingerprint: docFp,
					})
				: undefined;

		// Product Surface V1 — wire local caption/dead-air/orchestration into chat cards.
		let localProductSurface: EditorialRecommendationProductSurfaceResult | null = null;
		if (primaryAsset && authority.mode !== "read_only") {
			try {
				localProductSurface = await runEditorialRecommendationProductSurface({
					document: holder.current,
					assetId: primaryAsset.id,
					mediaPath: primaryAsset.originalPath,
					userMessage,
					speechEvidence: primarySpeech,
					preparedChanges: visual.prepared?.changes ?? null,
					ledger: storyLedger ?? null,
				});
				const localCanApply =
					localProductSurface.editReview?.cards.some((c) => c.canApply) === true;
				const planCanApply = editReview?.cards.some((c) => c.canApply) === true;
				if (localCanApply && (!planCanApply || localProductSurface.intents.wantCaptions)) {
					editProposalV1 = localProductSurface.editProposalV1 ?? editProposalV1;
					applyPreviewV1 = localProductSurface.applyPreviewV1 ?? applyPreviewV1;
					editReview = localProductSurface.editReview ?? editReview;
					console.info(
						"[editorial-product-surface]",
						`families=${localProductSurface.supportedFamilies.join(",") || "none"}`,
						`notes=${localProductSurface.notes.slice(0, 4).join(";")}`,
					);
				} else if (localProductSurface.supportedFamilies.length > 0) {
					console.info(
						"[editorial-product-surface] grounded families without replacing plan proposal",
						localProductSurface.supportedFamilies.join(","),
					);
				}
			} catch (err) {
				console.warn(
					"[editorial-product-surface] failed; continuing with plan path",
					err instanceof Error ? err.message : String(err),
				);
			}
		}

		// Professional Edit Execution Orchestrator V1 — multi-step verified sequence.
		let professionalEdit: ProfessionalEditOrchestratorResultV1 | null = null;
		if (primaryAsset && authority.mode !== "read_only" && isProfessionalEditRequest(userMessage)) {
			try {
				const projectKey = String(holder.current.project.id ?? memoryDocumentId);
				const priorAuth = professionalEditAuthByProject.get(projectKey) ?? null;
				professionalEdit = await runProfessionalEditOrchestrator({
					document: holder.current,
					assetId: primaryAsset.id,
					mediaPath: primaryAsset.originalPath,
					userMessage,
					sourceDurationSec,
					speechEvidence: primarySpeech,
					ledger: storyLedger ?? null,
					cursorSamples: await (async () => {
						if (!args.cursor || !primaryAsset) return null;
						try {
							const load = await args.cursor.read({
								assetId: primaryAsset.id,
								originalPath: primaryAsset.originalPath,
							});
							if (load.status !== "ok") return null;
							return load.samples
								.filter(
									(s) =>
										typeof s.cx === "number" &&
										typeof s.cy === "number" &&
										typeof s.timeMs === "number",
								)
								.map((s) => ({
									atSec: s.timeMs / 1000,
									cx: s.cx,
									cy: s.cy,
									interactionType:
										s.interactionType === "click" ||
										s.interactionType === "mouseup" ||
										s.interactionType === "move"
											? s.interactionType
											: "move",
									visible: true,
								}));
						} catch {
							return null;
						}
					})(),
					priorAuthorization: priorAuth,
					settingsEditsAllowed: editsAllowed,
					executionMode: undefined,
					skipFinalSequenceQc: false,
					appRoot: process.cwd(),
				});
				if (professionalEdit.authorization?.valid) {
					professionalEditAuthByProject.set(projectKey, professionalEdit.authorization);
				}
				if (JSON.stringify(professionalEdit.document) !== JSON.stringify(holder.current)) {
					holder.current = professionalEdit.document;
					workingDocument = professionalEdit.document;
				}
				console.info(
					"[professional-edit-orchestrator]",
					`steps=${professionalEdit.plan.steps.length}`,
					`committed=${professionalEdit.metrics.stepsCommitted}`,
					`auth=${Boolean(professionalEdit.authorization?.valid)}`,
					`needsAsk=${professionalEdit.needsUserAuthorization}`,
				);
			} catch (err) {
				console.warn(
					"[professional-edit-orchestrator] failed; continuing",
					err instanceof Error ? err.message : String(err),
				);
			}
		}

		if (closedSourceStoryV2) {
			sourceStoryV2 = closedSourceStoryV2;
		}

		// Structured visual/speech/story evidence JSON is internal infrastructure.
		// Always strip it from the user-facing reply unless the user explicitly
		// asked for raw/structured data.
		const wantsRaw = /\b(raw|structured)\s+(json|data|output)\b/i.test(userMessage);
		let responseText = wantsRaw ? text : stripInternalEvidenceJsonBlocks(text);

		// Grounded diagnosis verifier: block “background tab → invented browsing”
		// (e.g. Upwork tab ≠ navigating job listings). Prompt-only is not enough.
		if (!wantsRaw && visualSemanticGrounding) {
			const speechText = (speechEvidence ?? [])
				.flatMap((e) => e.segments.map((s) => s.text))
				.join(" ");
			const verified = verifyAndSanitizeUserFacingNarration({
				userFacingText: responseText,
				grounding: visualSemanticGrounding,
				speechText,
			});
			if (verified.violations.length > 0) {
				console.warn(
					"[grounded-diagnosis] removed ungrounded active-surface claims",
					verified.violations
						.slice(0, 4)
						.map((v) => `${v.app}:${v.reason}`)
						.join("; "),
				);
				responseText = verified.text;
			}
		}

		if (userFacingLeaksInvestigatorInternals(responseText)) {
			console.warn("[video-investigator] stripping leaked investigator internals from user text");
			responseText = responseText
				.replace(/INVESTIGATOR_EVIDENCE_BRIEFING[\s\S]*?(?=\n\n|$)/gi, "")
				.replace(/\b(ic_\d+|obs_\d+)\b/g, "")
				.trim();
		}

		// Recovery 4: concrete edit families in user prose must match trusted Edit Plan
		// OR local product-surface / professional-orchestrator grounded families.
		if (!wantsRaw) {
			const orchFamilies =
				professionalEdit?.plan.steps.map((s) => (s.family === "captions" ? "caption" : s.family)) ??
				[];
			const planGate = enforceFinalPlanConsistency({
				userFacingText: responseText,
				plan: editPlanV1,
				gap: editGapV1,
				extraSupportedFamilies: [
					...(localProductSurface?.supportedFamilies ?? []),
					...orchFamilies,
				],
			});
			if (planGate.strippedConcreteAdvice) {
				console.warn(
					"[editorial-grounding] stripped unsupported concrete edit advice",
					planGate.reason,
				);
				responseText = planGate.text;
			}
		}

		// When local surface has a consentable card (or a grounded no-op offer for
		// an explicit caption/pause ask), prefer that copy over the preservation-only
		// honesty boilerplate from the old Edit Plan gate.
		const localOffer = localProductSurface?.userFacingOffer?.trim();
		const hasLocalConsentCard =
			localProductSurface?.editReview?.cards.some((c) => c.canApply) === true;
		if (
			!professionalEdit &&
			localOffer &&
			(hasLocalConsentCard ||
				localProductSurface?.intents.wantCaptions ||
				localProductSurface?.intents.wantTighter)
		) {
			const looksLikeNoEditBoilerplate =
				/don't see a safe, recording-specific edit/i.test(responseText) ||
				/inventing tool recipes without a grounded target/i.test(responseText) ||
				/don't yet have a sufficiently grounded on-screen target/i.test(responseText);
			if (hasLocalConsentCard || looksLikeNoEditBoilerplate || !responseText.trim()) {
				responseText = localOffer;
			}
		}

		// Prefer professional-orchestrator user-facing result when present.
		if (professionalEdit?.userFacingText?.trim()) {
			responseText = professionalEdit.userFacingText;
		}

		// Professional Edit owns this turn end-to-end (plan / ask-once / verified apply).
		// Do NOT also attach a parallel product-surface "Apply edit" card — that produces
		// the contradictory UI: chat says captions were enabled while ADD CAPTIONS waits.
		if (professionalEdit) {
			editReview = undefined;
			editProposalV1 = null;
			applyPreviewV1 = null;
		}

		responseText = stripUnsupportedTransitionClaims(responseText);
		responseText = stripFalseProjectEditsDisabledClaim(responseText, editsAllowed);
		responseText = stripRepeatedProceedAsks(
			responseText,
			Boolean(professionalEdit?.authorization?.valid),
		);

		// Bounded Quality Closure V3 — cross-modal / focal / editorial validators.
		if (boundedMode && !wantsRaw && boundedDiagnostics?.packet) {
			const pkt = boundedDiagnostics.packet;
			const validated = applyBoundedResponseValidators({
				text: responseText,
				userMessage,
				relations: pkt.crossModalRelations ?? [],
				focalCandidates: pkt.focalTargetCandidates ?? [],
				editorialFindings: pkt.editorialFindings ?? [],
				decisionKind: pkt.decisionKind,
			});
			if (validated.hits.length > 0 || validated.incomplete) {
				console.warn(
					"[bounded-validators]",
					validated.hits.map((h) => `${h.rule}:${h.severity}`).join("; "),
					validated.incomplete ? "incomplete" : "",
				);
				responseText = validated.text;
			}
		}

		const hasConsentableProposal = Boolean(editReview?.cards.some((c) => c.canApply) === true);
		const hasBlockedOnlyProposal = Boolean(editReview?.cards.length && !hasConsentableProposal);
		const verifiedCommit = (professionalEdit?.metrics.stepsCommitted ?? 0) > 0;
		const truth = bindFinalResponseToTransactionTruth({
			userFacingText: responseText,
			mode: authority.mode,
			mutatingToolsExecuted: mutationTelemetry.mutatingToolsExecuted.length,
			hasConsentableProposal,
			hasBlockedOnlyProposal,
			verifiedCommit,
			// When a consent card is still present, never treat orchestrator copy as
			// fully applied — forces rewrite if text claims applied while card waits.
			forceProposalAwaitingConsent: hasConsentableProposal && !professionalEdit,
		});
		responseText = truth.text;
		mutationTelemetry.finalResponseClaim = truth.claim;
		mutationTelemetry.documentFingerprintAfterReasoning = fingerprintDocument(holder.current).value;
		mutationTelemetry.documentFingerprintAfterProposal =
			mutationTelemetry.documentFingerprintAfterReasoning;
		mutationTelemetry.proposalId = editProposalV1?.proposals?.[0]?.id ?? null;
		mutationTelemetry.proposalReadiness = editProposalV1?.proposals?.[0]?.status ?? null;
		mutationTelemetry.persistedMutationCount =
			mutationTelemetry.documentFingerprintBefore ===
			mutationTelemetry.documentFingerprintAfterReasoning
				? 0
				: Math.max(
						mutationTelemetry.mutatingToolsExecuted.length,
						professionalEdit?.metrics.stepsCommitted ?? 0,
					);
		if (professionalEdit) {
			rememberProfessionalSessionReceipt({
				projectId: String(holder.current.project.id ?? memoryDocumentId),
				atIso: new Date().toISOString(),
				userFacingText: responseText,
				stepsCommitted: professionalEdit.metrics.stepsCommitted,
				families: professionalEdit.plan.steps.map((s) => s.family),
				assessmentLabel: professionalEdit.autonomous?.transformationSummary?.assessmentLabel,
			});
		}
		if (visual.prepared?.frames) {
			mutationTelemetry.providerUsage.framesAttached = visual.prepared.frames.length;
			mutationTelemetry.providerUsage.totalImageBytes = visual.prepared.frames.reduce(
				(n, f) => n + (f.byteLength ?? 0),
				0,
			);
		}

		// Recovery 3: raw model text may be non-empty (JSON-only / internals-only)
		// while sanitizers leave nothing user-facing. That is never a successful turn.
		if (!responseText.trim()) {
			const delivery = classifyMissingUserFacingResponse({
				provider: model.provider,
				model: model.model,
				rawLen: text.length,
				cause:
					text.trim().length > 0 ? "sanitizer_removed_all_text" : "missing_user_facing_response",
			});
			sink.error(delivery.userMessage);
			return {
				text: "",
				document: holder.current,
				mutated: JSON.stringify(holder.current) !== initialDocumentJSON,
				status: delivery.status,
				failureReason: delivery.failureReason,
				userMessage: delivery.userMessage,
				reason: delivery.diagnostic,
				contextTelemetry: finalizeTelemetry(),
				...(videoMemoryV1 ? { videoMemoryV1 } : {}),
				...(retrievalPathTelemetry ? { retrievalPath: retrievalPathTelemetry } : {}),
				...(boundedDiagnostics ? { boundedDiagnostics } : {}),
				...preLlmArtifacts,
				...(visualSemanticGrounding ? { visualSemanticGrounding } : {}),
				...(sourceStory ? { sourceStory } : {}),
				...(targetStory ? { targetStory } : {}),
			};
		}

		// Temporal Event Ledger V1 — rebuild after semantic parse so optional
		// model-derived surfaces attach as modelDerived observations.
		let temporalEventLedger: TemporalEventLedger | undefined;
		let claimPromotion: ClaimPromotionSet | undefined;
		if (primaryAsset && sourceDurationSec > 0) {
			temporalEventLedger = buildLedgerFromPreparedEvidence({
				assetId: primaryAsset.id,
				sourceDurationSec,
				speechEvidence: primarySpeech,
				frames: visual.prepared?.frames,
				changes: visual.prepared?.changes,
				cursorInteractions,
				semanticGrounding: visualSemanticGrounding,
			});
			if (visualSpecialist) {
				temporalEventLedger = appendVisualSpecialistToLedger(
					temporalEventLedger,
					visualSpecialist,
					primaryAsset.id,
				);
			}
			// Claim Promotion V1 — above ledger; 0 extra LLM calls.
			claimPromotion = buildClaimPromotionSet({
				ledger: temporalEventLedger,
				specialist: visualSpecialist,
				investigation: investigationEvidence,
				userQuery: args.userMessage,
				lazy: true,
			});
		}

		return {
			text: responseText,
			document: holder.current,
			mutated: JSON.stringify(holder.current) !== initialDocumentJSON,
			status: "completed",
			mutationAuthority: mutationTelemetry,
			contextTelemetry: finalizeTelemetry(),
			...(videoMemoryV1 ? { videoMemoryV1 } : {}),
			...(retrievalPathTelemetry ? { retrievalPath: retrievalPathTelemetry } : {}),
			...(boundedDiagnostics ? { boundedDiagnostics } : {}),
			...(visualSemanticGrounding ? { visualSemanticGrounding } : {}),
			...(speechEvidence ? { speechEvidence } : {}),
			...(sourceStory ? { sourceStory } : {}),
			...(sourceStoryV2 ? { sourceStoryV2 } : {}),
			...(targetStory ? { targetStory } : {}),
			...(targetStoryV1 ? { targetStoryV1 } : {}),
			...(editGapV1 ? { editGapV1 } : {}),
			...(editPlanV1 ? { editPlanV1 } : {}),
			...(planningClosureV1 ? { planningClosureV1 } : {}),
			...(editProposalV1 ? { editProposalV1 } : {}),
			...(applyPreviewV1 ? { applyPreviewV1 } : {}),
			...(editReview ? { editReview } : {}),
			...(temporalEventLedger ? { temporalEventLedger } : {}),
			...(investigationEvidence ? { investigationEvidence } : {}),
			...(visualSpecialist ? { visualSpecialist } : {}),
			...(claimPromotion ? { claimPromotion } : {}),
		};
	} catch (err) {
		const preLlmArtifacts = {
			...(speechEvidence ? { speechEvidence } : {}),
			...(investigationEvidence ? { investigationEvidence } : {}),
			...(visualSpecialist ? { visualSpecialist } : {}),
			...(storyLedger ? { temporalEventLedger: storyLedger } : {}),
			...(storyClaims ? { claimPromotion: storyClaims } : {}),
			...(closedSourceStoryV2 || sourceStoryPrep?.storyV2
				? { sourceStoryV2: closedSourceStoryV2 ?? sourceStoryPrep?.storyV2 }
				: {}),
			...(closedTargetStoryV1 || targetStoryPrep?.targetV1
				? { targetStoryV1: closedTargetStoryV1 ?? targetStoryPrep?.targetV1 }
				: {}),
			...(closedEditGapV1 || editGapPrep?.editGapV1
				? { editGapV1: closedEditGapV1 ?? editGapPrep?.editGapV1 }
				: {}),
			...(closedEditPlanV1 || editPlanPrep?.editPlanV1
				? { editPlanV1: closedEditPlanV1 ?? editPlanPrep?.editPlanV1 }
				: {}),
			...(planningClosureV1 ? { planningClosureV1 } : {}),
		};
		// Local CLI failures (not logged in, binary missing) are already a
		// sentence the user can act on. Do not wrap them in the diagnostic dump
		// meant for mute/broken cloud providers.
		if (model.provider === "local-cli") {
			const message = err instanceof Error ? err.message : String(err);
			sink.error(message);
			return {
				text: "",
				document: holder.current,
				mutated: JSON.stringify(holder.current) !== initialDocumentJSON,
				status: "provider_error",
				failureReason: "local_cli_error",
				userMessage: message,
				reason: message,
				contextTelemetry: finalizeTelemetry(),
				...(videoMemoryV1 ? { videoMemoryV1 } : {}),
				...(retrievalPathTelemetry ? { retrievalPath: retrievalPathTelemetry } : {}),
				...(boundedDiagnostics ? { boundedDiagnostics } : {}),
				...preLlmArtifacts,
			};
		}
		const lastChunkSample = (
			chatModelChunks[chatModelChunks.length - 1]
				? JSON.stringify(chatModelChunks[chatModelChunks.length - 1])
				: "(no on_chat_model_stream events)"
		).slice(0, 1024);
		const delivery = classifyProviderThrownError(err, {
			provider: model.provider,
			model: model.model,
			chunkSample: lastChunkSample,
		});
		sink.error(delivery.userMessage);
		return {
			text: "",
			document: holder.current,
			mutated: JSON.stringify(holder.current) !== initialDocumentJSON,
			status: delivery.status,
			failureReason: delivery.failureReason,
			providerHttpStatus: delivery.httpStatus,
			...(delivery.providerDiagnostics
				? { providerDiagnostics: delivery.providerDiagnostics }
				: {}),
			userMessage: delivery.userMessage,
			reason: delivery.diagnostic,
			contextTelemetry: finalizeTelemetry(),
			...(videoMemoryV1 ? { videoMemoryV1 } : {}),
			...(retrievalPathTelemetry ? { retrievalPath: retrievalPathTelemetry } : {}),
			...(boundedDiagnostics ? { boundedDiagnostics } : {}),
			...preLlmArtifacts,
		};
	}
}

/** Full assistant text from `on_chat_model_end`. Local CLI uses this path. */
export function textFromChatModelEnd(data: Record<string, unknown> | undefined): string {
	if (!data) return "";
	const output = data.output;
	if (!output || typeof output !== "object") return "";
	return messageContentToText((output as { content?: unknown }).content);
}

function extractError(data: Record<string, unknown> | undefined): string | undefined {
	if (!data) return undefined;
	const error = data.error;
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return undefined;
}

// ponytail: re-exported for the agent-facing surface, but be honest about who
// uses it — no production code calls it. Its only real consumers are the
// workbench (`lib/wire.ts`, `lib/oracles.ts`), which import it straight from
// agent-tools anyway, and the tests. It is kept because the mutating/non-mutating
// split is a property of the agent surface, and this module is that surface.
export { isMutatingTool };
