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
import { verifyAndSanitizeUserFacingNarration } from "../groundedDiagnosis";
import { mediaDirsFromDocument, shouldGrantLocalWatch } from "../local-agents";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import {
	appendSourceStoryToUserMessage,
	parseAndValidateSourceStory,
	prepareSourceStoryForTurn,
	type SourceStory,
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
	parseAndValidateTargetStory,
	prepareTargetStoryForTurn,
	type TargetStory,
} from "../targetStory";
import { buildLedgerFromPreparedEvidence, type TemporalEventLedger } from "../temporalEventLedger";
import { userFacingMediaNarrationGuidance } from "../userFacingNarration";
import {
	appendInvestigatorToUserMessage,
	type InvestigationEvidenceSet,
	runMasterVideoInvestigatorV1,
	userFacingLeaksInvestigatorInternals,
} from "../videoInvestigator";
import { prepareVisualEvidenceForTurn } from "../visualEvidence";
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
	runVisualSpecialistV1,
	type VisualSpecialistResult,
} from "../visualSpecialist";
import {
	createOpenScreenChatModel,
	messageContentToText,
	messageContentToThinking,
	type OpenScreenChatModelConfig,
} from "./chat-model";

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
	"One-pass finish (promo, tutorial, demo, social post): read mediaCapabilities and mediaContext (textual outline) plus projectQueue; use getTranscript only if you need more speech detail; state a short plan; apply the smallest tools; re-read getCurrentDocument and report only what landed. Do not pretend you re-inspected pixels when mediaCapabilities.visualFrames is false. Dead air → addTrims when transcript/silence evidence supports it. Portrait/social → setAspectRatio (9:16 / 1:1) plus crop or cursor-anchored zoom from available evidence — do not invent what faces/logos look like without visualFrames. Captions → generateCaptions, then setWordText for fixes. Opening hook → zoom + addGraphic title on the first seconds. Ending CTA → addGraphic cta on the last seconds. Lower third / badge / logo plate → addGraphic. Unused take → addClip from projectQueue.unusedAssets. Music → addAudio only when an audio asset exists; duck with gainDb over speech spans. Do not invent clip-to-clip transitions, saved templates, generated voice, brand kits, multi-band EQ, clickable links, or paid generation costs — those are not fields on this document.",
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
	editsAllowed: boolean;
	openProject?: Record<string, unknown>;
}): string {
	const base = options.editsAllowed
		? BASE_SYSTEM_PROMPT
		: BASE_SYSTEM_PROMPT + CONSENT_PROMPT_BLOCK;
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
) {
	return tool(
		async (args: z.infer<S>) => {
			sink.toolStart(name, args);
			if (CLI_PROCESS_TOOLS.has(name) && runtime.cli) {
				if (editsAllowed === false && isMutatingTool(name)) {
					const execution = executeAgentTool(holder.current, name, JSON.stringify(args), {
						editsAllowed: false,
					});
					sink.toolEnd(name, execution.ok, execution.summary);
					return execution.resultJson;
				}
				const execution = await runtime.cli.run(
					name as "listSources" | "recordScreen" | "generateCaptions" | "exportProject",
					args,
					holder.current,
				);
				if (execution.document) holder.current = execution.document;
				sink.toolEnd(name, execution.ok, execution.summary);
				return execution.resultJson;
			}
			// ponytail: the ONE async step the pure executor cannot take. Reading a
			// sidecar is IO; `executeAgentTool` is synchronous by design (it is the
			// gate every mutation passes through, and it has to stay testable
			// without a filesystem). So the load happens here and its verdict —
			// including "I could not look" — goes in as data.
			const load = TOOLS_READING_CURSOR.has(name)
				? await loadCursorTelemetry(holder.current, args, runtime)
				: undefined;
			const execution = executeAgentTool(holder.current, name, JSON.stringify(args), {
				editsAllowed,
				cursorTelemetry: { availableByAssetId: runtime.availableByAssetId, load },
				visualFramesSupplied: runtime.visualFramesSupplied,
			});
			if (execution.document) holder.current = execution.document;
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
) {
	const build = <S extends z.ZodType>(name: string, schema: S) =>
		documentTool(holder, sink, name, schema, editsAllowed, runtime);
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
	/** Optional override for speech evidence disk cache (tests). */
	speechCacheDir?: string;
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
}

export async function invokeOpenScreenAgent(args: InvokeArgs): Promise<InvokeResult> {
	const { model, history, userMessage, sink } = args;
	const editsAllowed = args.editsAllowed !== false;

	let workingDocument = args.document;
	const holder: DocumentHolder = { current: workingDocument };
	const initialDocumentJSON = JSON.stringify(workingDocument);

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

	const contextNeeds = classifyMediaContextNeeds(userMessage);

	const visual = await prepareVisualEvidenceForTurn({
		document: workingDocument,
		userMessage,
		provider: model.provider,
		cursor: args.cursor,
		contextNeeds,
	});
	const visualFramesSupplied = visual.visualFramesSupplied;

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

	// Master Video Investigator V1 — starts from a pre-semantic ledger, runs
	// bounded deterministic tools (0 investigator model calls), then feeds a
	// compact briefing (+ optional stills) into the existing agent turn.
	let investigationEvidence: InvestigationEvidenceSet | null = null;
	let visualSpecialist: VisualSpecialistResult | null = null;
	const earlyLedger =
		primaryAsset && sourceDurationSec > 0
			? buildLedgerFromPreparedEvidence({
					assetId: primaryAsset.id,
					sourceDurationSec,
					speechEvidence: primarySpeech,
					frames: visual.prepared?.frames,
					changes: visual.prepared?.changes,
					cursorInteractions,
				})
			: null;
	if (earlyLedger && primaryAsset) {
		try {
			investigationEvidence = await runMasterVideoInvestigatorV1({
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
			});
			if (
				investigationEvidence &&
				investigationEvidence.stopReason !== "deterministic_edit_skip" &&
				primaryAsset.originalPath
			) {
				try {
					visualSpecialist = await runVisualSpecialistV1({
						videoPath: primaryAsset.originalPath,
						investigation: investigationEvidence,
					});
					investigationEvidence = mergeSpecialistIntoInvestigation(
						investigationEvidence,
						visualSpecialist,
					);
				} catch (err) {
					console.warn(
						"[visual-specialist] failed; continuing with investigator evidence only",
						err instanceof Error ? err.message : String(err),
					);
				}
			}
			visual.userMessage = await appendInvestigatorToUserMessage(
				visual.userMessage,
				investigationEvidence,
			);
		} catch (err) {
			console.warn(
				"[video-investigator] investigation failed; continuing without briefing",
				err instanceof Error ? err.message : String(err),
			);
		}
	}

	const sourceStoryPrep = prepareSourceStoryForTurn({
		contextNeeds,
		sourceDurationSec,
		speechEvidence: primarySpeech,
		frames: visual.prepared?.frames,
		changes: visual.prepared?.changes,
		cursorEventTimes,
	});
	const targetStoryPrep = prepareTargetStoryForTurn({
		contextNeeds,
		userMessage,
		sourceStoryRequested: sourceStoryPrep?.requested === true,
	});

	const tools = buildTools(holder, sink, editsAllowed, {
		cursor: args.cursor,
		availableByAssetId,
		cli: args.cli,
		visualFramesSupplied,
	});
	const agent = createAgent({
		model: chatModel,
		tools,
		systemPrompt: buildSystemPrompt({
			editsAllowed,
			openProject: documentSnapshotForModel(
				workingDocument,
				{ availableByAssetId },
				{
					visualFramesSupplied,
					audioStream,
					speechStatus,
					sourceStoryRequested: sourceStoryPrep?.requested === true,
					targetStoryRequested: targetStoryPrep?.requested === true,
				},
			),
		}),
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

	let storyUserMessage = sourceStoryPrep
		? appendSourceStoryToUserMessage(visual.userMessage, sourceStoryPrep.promptSection)
		: visual.userMessage;
	if (targetStoryPrep) {
		storyUserMessage = appendTargetStoryToUserMessage(
			storyUserMessage,
			targetStoryPrep.promptSection,
		);
	}
	const messages = [...history, storyUserMessage];

	// ponytail: declared outside the try block so the catch handler can
	// include any chunks we already saw in the diagnostic when the stream
	// throws partway through.
	let chatModelChunks: unknown[] = [];

	try {
		// ponytail: streamEvents (legacy mode, no `version: "v3"`) returns the
		// same on_chat_model_stream / on_tool_start / on_tool_end / on_chain_end
		// event stream axcut consumes. We use it both for live text deltas and
		// to know when the run has produced its final assistant message.
		const stream = (
			agent as unknown as {
				streamEvents: (state: unknown, config?: unknown) => AsyncIterable<Record<string, unknown>>;
			}
		).streamEvents({ messages }, undefined);

		let finalText = "";
		const nonChatEvents: Array<{ event: string; name: string }> = [];

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
					sink.thinking(thinkingDelta);
				}
				const delta = messageContentToText(content);
				if (delta) {
					sink.text(delta);
					finalText += delta;
				}
			} else if (eventType === "on_chat_model_end") {
				// Local CLI (and any `_generate`-only model) finishes with one
				// end event and never streams. Take that text only when no
				// stream chunks arrived, so cloud providers are not doubled.
				const endText = textFromChatModelEnd(data);
				if (endText && !finalText.trim()) {
					sink.text(endText);
					finalText += endText;
				}
			} else if (eventType === "on_tool_error") {
				// Kept as a safety net rather than as a live path. `executeAgentTool`
				// never throws, and LangChain's ToolNode catches what does (an unknown
				// tool name, arguments the zod binding rejects) and feeds it back as
				// the tool RESULT instead of raising. This branch only fires for a
				// failure that escapes both — and then the stream is the only witness,
				// so it reports `ok: false` from evidence, never a fabricated verdict.
				sink.toolEnd(name, false, extractError(data));
			} else if (eventType && !SILENT_TOOL_EVENTS.has(eventType)) {
				nonChatEvents.push({ event: eventType, name });
			}
		}

		const mutated = JSON.stringify(holder.current) !== initialDocumentJSON;
		if (!finalText.trim()) {
			// ponytail: surface the upstream payload so we can see why MiniMax
			// (or any other anthropic-shaped provider) is producing no text.
			// The chat-model chunks are the post-parse LangChain views of
			// each SSE event; their `content`/`additional_kwargs`/
			// `response_metadata` fields tell us whether the issue is in the
			// wire format, the parser, or our `messageContentToText` shape.
			// Capped at
			// 1 chunk + a 1kB slice to keep the toast readable.
			const lastChunk = chatModelChunks[chatModelChunks.length - 1];
			const sample = lastChunk
				? JSON.stringify(lastChunk).slice(0, 1024)
				: "(no on_chat_model_stream events)";
			const reason =
				`Empty response from model (provider=${model.provider}, ` +
				`model=${model.model}, chat_model_chunks=${chatModelChunks.length}, ` +
				`other_events=${nonChatEvents.length}:${nonChatEvents
					.slice(0, 5)
					.map((e) => e.event)
					.join(",")}). Last chunk: ${sample}`;
			sink.error(reason);
			return {
				text: "",
				document: holder.current,
				mutated,
				reason,
				...(investigationEvidence ? { investigationEvidence } : {}),
				...(visualSpecialist ? { visualSpecialist } : {}),
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

		if (sourceStoryPrep?.scaffold) {
			const storyValidated = parseAndValidateSourceStory(text, sourceStoryPrep.scaffold);
			if (storyValidated.ok && storyValidated.story) {
				sourceStory = storyValidated.story;
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
			}
		}

		if (targetStoryPrep?.requested && sourceStory) {
			const targetValidated = parseAndValidateTargetStory(text, {
				sourceStory,
				userMessage,
			});
			if (targetValidated.ok && targetValidated.story) {
				targetStory = targetValidated.story;
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
			}
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

		// Temporal Event Ledger V1 — rebuild after semantic parse so optional
		// model-derived surfaces attach as modelDerived observations.
		let temporalEventLedger: TemporalEventLedger | undefined;
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
		}

		return {
			text: responseText,
			document: holder.current,
			mutated: JSON.stringify(holder.current) !== initialDocumentJSON,
			...(visualSemanticGrounding ? { visualSemanticGrounding } : {}),
			...(speechEvidence ? { speechEvidence } : {}),
			...(sourceStory ? { sourceStory } : {}),
			...(targetStory ? { targetStory } : {}),
			...(temporalEventLedger ? { temporalEventLedger } : {}),
			...(investigationEvidence ? { investigationEvidence } : {}),
			...(visualSpecialist ? { visualSpecialist } : {}),
		};
	} catch (err) {
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
				reason: message,
				...(investigationEvidence ? { investigationEvidence } : {}),
				...(visualSpecialist ? { visualSpecialist } : {}),
			};
		}
		// ponytail: surface the LangChain/HTTP error (with name + truncated
		// stack) so we can tell whether the stream threw (e.g. MiniMax
		// returning a non-Anthropic JSON envelope that the SDK rejects) or
		// completed with empty content. Mirrors the diagnostic shape used in
		// the success-but-empty path above.
		const e = err instanceof Error ? err : new Error(String(err));
		const stackHead = (e.stack ?? "").split("\n").slice(0, 3).join(" | ");
		const reason =
			`Empty response from model (provider=${model.provider}, ` +
			`model=${model.model}, error=${e.name}: ${e.message}` +
			(stackHead ? ` stack=${stackHead}` : "") +
			`). Last chunk: ${(
				chatModelChunks[chatModelChunks.length - 1]
					? JSON.stringify(chatModelChunks[chatModelChunks.length - 1])
					: "(no on_chat_model_stream events)"
			).slice(0, 1024)}`;
		sink.error(reason);
		return {
			text: "",
			document: holder.current,
			mutated: JSON.stringify(holder.current) !== initialDocumentJSON,
			reason,
			...(investigationEvidence ? { investigationEvidence } : {}),
			...(visualSpecialist ? { visualSpecialist } : {}),
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
