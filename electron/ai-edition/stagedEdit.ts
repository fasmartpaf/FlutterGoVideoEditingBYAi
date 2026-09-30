/**
 * Staged editing: a whole-video request ("make this a SaaS demo") runs as a
 * fixed sequence of stages — understand → cut & pacing → zoom & camera →
 * captions → graphics & motion → review & export. Each stage is its own
 * focused agent run: only that stage's tools, its own small reply budget,
 * and the previous stages' outcomes as context. A stage finishes before the
 * next one starts, the chat checklist shows where it is, and every stage
 * that changed the video leaves a preview frame in the chat.
 */

import type { AxcutDocument } from "../../src/lib/ai-edition/schema";
import type { TurnBudgetLimits } from "./deep-agent/local-cli-chat-model";

export type StageId = "understand" | "pacing" | "camera" | "captions" | "graphics" | "review";

export interface EditStage {
	id: StageId;
	/** Checklist text the user sees. */
	title: string;
	/** What the agent does in this stage. */
	instruction: string;
	/** Tools offered in this stage (read-only tools are always added). */
	tools: readonly string[];
	budget: TurnBudgetLimits;
	/** Show the user a frame of the edited video after this stage. */
	preview: boolean;
	/** Mechanical work (applying edits): runs on the faster model. Planning and review keep the user's model. */
	mechanical: boolean;
}

/** Looking is always allowed. */
export const READ_TOOLS = [
	"getVideoSummary",
	"getCurrentDocument",
	"getTranscript",
	"getTranscriptRange",
	"getTranscriptWords",
	"getCursorTrack",
	"sampleFrames",
	"listMotionTemplates",
	"listTransitions",
	"listCharacters",
	"listCursorThemes",
] as const;

const PACING_TOOLS = [
	"tightenPacing",
	"removeFillerWords",
	"addTrim",
	"addTrims",
	"setTrim",
	"removeTrim",
	"setClipRange",
	"splitClip",
	"moveClip",
	"removeClip",
	"duplicateClip",
] as const;

const CAMERA_TOOLS = [
	"addZoom",
	"addZooms",
	"setZoom",
	"addSpeed",
	"setSpeed",
	"setClipCrop",
	"setAspectRatio",
	"addCursorHighlight",
	"setEditorSettings",
	"setBackground",
	"addCameraFullscreen",
	"setCameraFullscreen",
	"removeModifier",
] as const;

const CAPTION_TOOLS = ["generateCaptions", "setCaptionSettings", "setWordText"] as const;

const GRAPHICS_TOOLS = [
	"createMotionClip",
	"createShowcaseVideo",
	"placeMotionClip",
	"addMotionOverlay",
	"setBrandKit",
	"addGraphic",
	"addAnnotation",
	"setAnnotation",
	"insertStartThumbnail",
	"addPrivacyCover",
	"setClipIncomingTransition",
	"removeModifier",
] as const;

const budget = (softSteps: number, finishSteps: number, hardSteps: number, softMin: number, finishMin: number): TurnBudgetLimits => ({
	softSteps,
	finishSteps,
	hardSteps,
	softMs: softMin * 60_000,
	finishMs: finishMin * 60_000,
});

export const EDIT_STAGES: readonly EditStage[] = [
	{
		id: "understand",
		title: "Understand the recording",
		instruction:
			"Look before editing, in ONE reply: getVideoSummary (the recording, already analysed: screen changes, still stretches, silences, key frames — Read its keyFrames), getTranscript (if there is no transcript and the recording has speech, call generateCaptions, then getTranscript) and getCursorTrack. Take extra frames with sampleFrames only if the summary is missing. Then reply with a short EDIT PLAN for the next stages: the story in one line, the key moments to keep (with times), what to cut, where zooms help, whether captions fit, which intro / callouts / closing CTA to add, and the target length. Make no edits in this stage.",
		tools: ["generateCaptions"],
		budget: budget(2, 3, 4, 2, 3),
		preview: false,
		mechanical: false,
	},
	{
		id: "pacing",
		title: "Cut & pacing",
		instruction:
			"Following your plan: remove dead air and filler words (tightenPacing / removeFillerWords), and cut off-topic, repeated or broken sections (addTrims), so the story flows and fits the target length. Keep sentences whole. Put all cuts in one or two replies.",
		tools: PACING_TOOLS,
		budget: budget(3, 4, 6, 2, 4),
		preview: true,
		mechanical: true,
	},
	{
		id: "camera",
		title: "Zoom & camera",
		instruction:
			"Following your plan: zoom in on the key actions (use the cursor track so the zoom lands where the action is; addZooms for several at once), speed up slow waiting parts, and polish the cursor for a screen recording: setEditorSettings with cursorSmoothing ~0.6, cursorSize ~1.4–1.8 (readable when zoomed out), cursorMotionBlur ~0.3, cursorClickBounce ~2.5, a clean theme unless the user wants a fun one (listCursorThemes); addCursorHighlight on the few clicks that matter. Set crop / aspect ratio / frame look only if the request or the platform needs it. All in one or two replies.",
		tools: CAMERA_TOOLS,
		budget: budget(3, 4, 6, 2, 4),
		preview: true,
		mechanical: true,
	},
	{
		id: "captions",
		title: "Captions",
		instruction:
			"If the video has speech: turn on burned-in captions with a clean, readable style that suits the video (setCaptionSettings), and fix clearly mis-heard product names or words (setWordText). If there is no speech, or captions don't fit the request, skip this stage.",
		tools: CAPTION_TOOLS,
		budget: budget(2, 3, 4, 2, 3),
		preview: true,
		mechanical: true,
	},
	{
		id: "graphics",
		title: "Graphics & motion",
		instruction:
			"Following your plan: add a branded intro and a closing call-to-action (createMotionClip, placed at start / end — for a product or SaaS video the intro is the productIntro template, which shows the real app in a browser window, not a plain title card), plus a few animated callouts, lower thirds or keyword pops on the footage where they help the story (addMotionOverlay). Use the brand kit — it already matches the video's colours. Keep text short and don't cover the UI the viewer needs to see. Look at the previewFrames each render returns. Batch independent renders in one reply.",
		tools: GRAPHICS_TOOLS,
		budget: budget(4, 6, 8, 4, 7),
		preview: true,
		mechanical: true,
	},
	{
		id: "review",
		title: "Review & export",
		instruction:
			"Check the finished edit: sampleFrames from:'timeline' (count 5) and Read the frames. Fix real problems (cut off, unreadable, covering the UI, blank, off-brand) in ONE batch. Do not export — the user presses Export when they are happy. Your final message is for the user: 2–3 sentences on what the finished video now does, plus one suggested next step.",
		tools: [...PACING_TOOLS, ...CAMERA_TOOLS, ...CAPTION_TOOLS, ...GRAPHICS_TOOLS],
		budget: budget(3, 5, 6, 3, 5),
		preview: false,
		mechanical: false,
	},
];

/** The full tool list for one stage (read tools + the stage's own), de-duplicated. */
export function stageToolNames(stage: EditStage): string[] {
	return [...new Set([...READ_TOOLS, ...stage.tools])];
}

const BROAD_VERB = /\b(make|create|produce|turn|build|edit|polish|improve|clean\s*up|finish|prepare)\b/i;
/** The thing being made is a whole video (misspellings like "vidoe" included). */
const WHOLE_VIDEO = /\b(vid(?:eo|oe|io|e)?s?|vedio|demo|tutorial|shorts?|reels?|promo|walkthrough|explainer|trailer|recording)\b/i;
/** Explicitly the whole thing, even when a part is also named. */
const EXPLICIT_WHOLE = /\b(whole|entire|complete|full)\s+(video|edit|recording|thing)\b|\bfull\s+edit\b|\bfrom\s+start\s+to\s+finish\b|\bend[-\s]to[-\s]end\b/i;
/** Names one part of the video — a targeted edit, not a whole-video one. */
const PART =
	/\b(intro|outro|opening|opener|ending|title|card|caption|subtitle|zoom|overlay|graphic|logo|thumbnail|cover|cta|call\s*to\s*action|lower\s*third|callout|badge|transition|music|audio|sound|background|wallpaper|blur|speed|crop|motion|animation|text|font|colou?r|section|part|scene|clip)s?\b/i;
/** The recording itself restyled ("make it look premium", "better look", "motion graphics into it"): one showcase render, not the staged edit. */
export const SHOWCASE_REQUEST =
	/\b(showcase|premium|branded|branding|restyle|re-?design|aesthetic|cinematic|apple[-\s]?like|minimal(?:ist)?|sleek|elegant|stylish|better\s+look\w*|look\w*\s+(?:\w+\s+){0,3}?(?:better|amazing|premium|professional|beautiful|clean|attractive|minimal|calm|modern|sleek|cinematic|elegant|stylish|bold|energetic|fresh|polished)|motion\s+graphics?\s+(?:in|into|on|over|to)\b)/i;

/** Asks that change a showcase already on the timeline (its look, shape, music, cards). */
const SHOWCASE_FOLLOW_UP =
	/\b(vertical|horizontal|9:16|16:9|tiktok|reels?|shorts?|style|look|design|layout|frame|background|cards?|steps?|theme|colou?rs?|music|song|beat|energetic|calm|bold|clean|dark|light|logo|intro|outro|tagline|faster|slower|zoom\w*|highlight\w*|draft|final|render)\b/i;
const NARROW = /\b\d+(?:\.\d+)?\s*(?:s|sec|secs|seconds)\b|\b\d{1,2}:\d{2}\b|\b(?:this|that)\s+(?:zoom|caption|overlay|clip|title|graphic)\b/i;

/**
 * True for a whole-video request ("make the SaaS video for fluttergo.ai",
 * "turn this into a 60-second product demo"); false for a targeted edit that
 * names a part ("make the intro amazing", "zoom at 0:12") or a question.
 */
export function isWholeVideoRequest(message: string, context: { hasShowcase?: boolean } = {}): boolean {
	const m = message.trim();
	// With a showcase on the timeline, changes go to the showcase, not a six-stage edit of it.
	if (context.hasShowcase) return false;
	if (m.length < 12) return false;
	if (m.endsWith("?") && !BROAD_VERB.test(m.split(/\s+/).slice(0, 3).join(" "))) return false;
	if (SHOWCASE_REQUEST.test(m)) return false;
	if (EXPLICIT_WHOLE.test(m)) return true;
	if (NARROW.test(m) || PART.test(m)) return false;
	return BROAD_VERB.test(m) && WHOLE_VIDEO.test(m);
}

export interface StageOutcome {
	stage: EditStage;
	status: "done" | "skipped" | "failed" | "stopped";
	summary: string;
	mutated: boolean;
	previewPath?: string;
}

/** The message that drives one stage. */
export function stagePrompt(
	stage: EditStage,
	index: number,
	request: string,
	earlier: StageOutcome[],
	total = EDIT_STAGES.length,
): string {
	const lines = [
		`STAGED EDIT — stage ${index + 1} of ${total}: ${stage.title.toUpperCase()}.`,
		`The user's request: "${request}"`,
	];
	if (earlier.length) {
		lines.push("Done so far:");
		for (const o of earlier) lines.push(`- ${o.stage.title}: ${o.summary}`);
	}
	lines.push(
		`Do ONLY this stage now: ${stage.instruction}`,
		`Budget: about ${stage.budget.softSteps} replies — batch independent tool calls into one reply.`,
		stage.id === "review"
			? 'When done, reply with {"message":"…"} for the user.'
			: 'When this stage is done reply with {"message":"<1–2 sentences: what this stage changed>"}, or {"message":"Skipped: <why>"} if it isn\'t useful for this video. Do not start the next stage — it runs next.',
	);
	return lines.join("\n");
}

/** The chat checklist for the stages, given how far the edit got. */
export function stagePlan(
	outcomes: StageOutcome[],
	current: number | null,
	stages: readonly EditStage[] = EDIT_STAGES,
): Array<{ text: string; status: "pending" | "in_progress" | "done" | "skipped" }> {
	return stages.map((stage, i) => {
		const o = outcomes[i];
		if (o) return { text: stage.title, status: o.status === "done" ? "done" : "skipped" };
		if (i === current) return { text: stage.title, status: "in_progress" };
		return { text: stage.title, status: "pending" };
	});
}

/** Clean a stage's reply into a one-paragraph summary. */
export function stageSummary(text: string | undefined, stage: EditStage): { summary: string; skipped: boolean } {
	const t = (text ?? "").replace(/\s+/g, " ").trim();
	if (!t) return { summary: "No changes needed.", skipped: true };
	const skipped = /^skipp?ed\b/i.test(t);
	const limit = stage.id === "understand" ? 1500 : 400;
	return { summary: t.length > limit ? `${t.slice(0, limit - 1)}…` : t, skipped };
}

/** The final chat message: the review stage's words, then what each stage did. */
export function stagedFinalMessage(outcomes: StageOutcome[]): string {
	const review = outcomes.find((o) => o.stage.id === "review" && o.status === "done");
	const parts: string[] = [];
	if (review) parts.push(review.summary);
	const stageLines = outcomes
		.filter((o) => o.stage.id !== "understand" && o.stage.id !== "review")
		.map((o) => `- **${o.stage.title}** — ${o.status === "done" ? o.summary : o.status === "skipped" ? `skipped (${o.summary.replace(/^skipp?ed:?\s*/i, "")})` : o.summary}`);
	if (stageLines.length) parts.push(stageLines.join("\n"));
	const stopped = outcomes.find((o) => o.status === "stopped" || o.status === "failed");
	if (stopped) parts.push(`Stopped during **${stopped.stage.title}** — the earlier stages are applied. Say "continue" to finish the rest.`);
	return parts.join("\n\n") || "Done.";
}

/** Time in the edited programme worth previewing after a stage. */
export function previewTimeSec(document: AxcutDocument, stage: EditStage, durationSec: number): number {
	if (stage.id === "graphics") {
		// First overlay if there is one, else just after the intro.
		const first = [...document.annotations].sort((a, b) => a.startMs - b.startMs)[0];
		if (first) return Math.min(durationSec - 0.1, first.startMs / 1000 + Math.min(1.5, (first.endMs - first.startMs) / 2000));
		return Math.min(durationSec - 0.1, 1.5);
	}
	return Math.max(0, durationSec * 0.4);
}

// --- targeted requests --------------------------------------------------------

const SCOPES: Array<{ match: RegExp; tools: readonly string[] }> = [
	{
		// The whole recording restyled: one render, plus the brand kit it uses.
		match: SHOWCASE_REQUEST,
		tools: ["createShowcaseVideo", "setBrandKit"],
	},
	{
		match: /\b(motion|graphics?|intro|outro|opener|title|overlay|lower\s*third|callout|badge|cta|call\s*to\s*action|logo|animat\w*|thumbnail|cover|brand\w*|card)s?\b/i,
		tools: GRAPHICS_TOOLS,
	},
	{ match: /\b(captions?|subtitles?|transcript)\b/i, tools: CAPTION_TOOLS },
	{
		match: /\b(zoom\w*|camera|cursor|mouse|crop\w*|aspect|vertical|portrait|square|9:16|1:1|16:9|background|wallpaper|padding|shadow|rounded|frame\s+look|speed\s*up|slow\s*down)\b/i,
		tools: CAMERA_TOOLS,
	},
	{
		match: /\b(cut\w*|trim\w*|shorter|shorten|silences?|dead\s*air|pauses?|filler|tighten|pacing|remove\s+the\s+part|length)\b/i,
		tools: PACING_TOOLS,
	},
	{ match: /\b(music|audio|sound|volume|voice)\b/i, tools: ["addAudio", "setAudio", "importMedia", "removeModifier"] },
	{ match: /\b(blur|hide|privacy|redact|email|password)\b/i, tools: ["addPrivacyCover", "addAnnotation", "setAnnotation", "removeModifier"] },
];

/**
 * A targeted request only gets the tools for what it names: "make the intro
 * amazing" can render and place motion graphics, but cannot cut, caption or
 * zoom. Null when the request names no specific area (the agent keeps every
 * tool). Read tools are always included.
 */
export function requestToolScope(message: string, context: { hasShowcase?: boolean } = {}): string[] | null {
	const tools = new Set<string>();
	for (const scope of SCOPES) if (scope.match.test(message)) for (const t of scope.tools) tools.add(t);
	if (context.hasShowcase && SHOWCASE_FOLLOW_UP.test(message)) for (const t of ["createShowcaseVideo", "setBrandKit"]) tools.add(t);
	if (tools.size === 0) return null;
	return [...new Set([...READ_TOOLS, ...tools])];
}

/** Heavy models (slow per reply) and the fast model mechanical work runs on instead. */
const HEAVY_MODEL = /\b(opus|fable)\b|opus|fable/i;
export const FAST_CLAUDE_MODEL = "sonnet";

/**
 * The Claude model for a piece of work: mechanical steps (applying cuts,
 * placing graphics, adjusting zooms) run on Sonnet when the user picked a
 * heavy model; planning and review keep the user's choice. Other agents and
 * lighter models are left alone.
 */
export function modelForWork(agentId: string, chosen: string | undefined, mechanical: boolean): string | undefined {
	if (!mechanical || agentId !== "claude") return chosen;
	if (!chosen || HEAVY_MODEL.test(chosen)) return FAST_CLAUDE_MODEL;
	return chosen;
}

