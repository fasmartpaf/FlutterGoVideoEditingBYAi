/**
 * Deterministic media-context classifier — semantic request families, no LLM.
 *
 * Canonical owner of turn-local visual / speech / cursor routing.
 * Legacy `promptWantsVisualEvidence` defers to `needs.visual` from this module.
 *
 * Organized by family priority so narrow visual questions do not drag in STT,
 * and editing-brain requests obtain speech without requiring the word "transcribe".
 */

import type { MediaContextNeeds, MediaRequestCategory } from "./types";
import { EMPTY_MEDIA_CONTEXT_NEEDS } from "./types";

const DETERMINISTIC_EDIT = /^(?:delete|cut|trim|remove)\s+[\d:.\s–—\-toand]+(?:seconds?|s)?\.?$/i;
const DETERMINISTIC_EDIT_LOOSE =
	/\b(?:delete|remove|cut|trim)\s+\d+(\.\d+)?\s*[–—-]\s*\d+(\.\d+)?\s*(s|sec|seconds?)?\b/i;
/** "Trim the first two seconds." — ordinal / word-count timeline math. */
const DETERMINISTIC_TRIM_ORDINAL =
	/^(?:delete|cut|trim|remove)\s+(?:the\s+)?(?:first|last|initial|final)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:seconds?|s)?\.?$/i;
/** "Set speed to 1.2x from 4–8 seconds." — rate math, not perception. */
const DETERMINISTIC_SPEED = /\b(?:set\s+)?(?:speed|playback\s+rate|rate)\s+(?:to\s+)?[\d.]+x?\b/i;
const ASPECT_ONLY = /^(?:change\s+)?aspect(?:\s*ratio)?\b|^set\s*aspect\b|\b(?:9:16|16:9|1:1)\b/i;

const SPEECH_INSPECTION_FAMILIES: ReadonlyArray<{ id: string; pattern: RegExp }> = [
	{
		id: "what-said",
		pattern:
			/\b(?:what\s+(?:did|was|do)\s+(?:i|we|they|you)\s+say|what\s+(?:am\s+i|are\s+we)\s+saying|what\s+(?:was|is)\s+said)\b/i,
	},
	{
		id: "transcript-ask",
		pattern:
			/\b(?:transcri(?:be|ption|pt)|caption(?:s|ing)?|subtitl(?:e|es|ing)|spoken\s+words?|voice[\s-]?over)\b/i,
	},
	{
		id: "around-speech",
		pattern: /\b(?:hear|heard|audio\s+say|narrat(?:e|ion|ing)|what\s+i(?:'m| am)\s+explaining)\b/i,
	},
];

/**
 * Narrow look-at-the-pixels requests — visual frames, no STT by default.
 * Absorbs Bug-2 see-screen / frames / UI-event families that are not whole-media.
 */
const VISUAL_INSPECTION_FAMILIES: ReadonlyArray<{ id: string; pattern: RegExp }> = [
	{
		id: "visible-on-screen",
		pattern:
			/\b(?:what\s+is\s+visible|what(?:'s| is| are)\s+(?:on\s+)?(?:the\s+)?screen|what\s+appears|what\s+do\s+you\s+see|visible\s+on\s+screen|what\s+visibly\s+happens|what\s+happens\s+visually|tell\s+me\s+what\s+visibly\s+happens|describe\s+what\s+happens\s+on\s+screen)\b/i,
	},
	{
		id: "ui-events",
		pattern:
			/\b(?:brief\s+ui|ui\s+changes?|describe\s+ui|call\s+out\s+any\s+(?:brief\s+)?ui|menus?|popovers?|notifications?|temporary\s+states?|toasts?)\b/i,
	},
	{
		id: "appear-ask",
		pattern:
			/\b(?:did\s+(?:any\s+|a\s+)?(?:menu|notification|popover|toast|dialog|modal)\s+appear)\b/i,
	},
	{
		id: "frames",
		pattern:
			/\b(?:each\s+frame|every\s+frame|read\s+(?:a\s+|the\s+|each\s+|every\s+)?frames?|frame\s+by\s+frame|across\s+(?:the\s+)?frames?)\b/i,
	},
	{
		id: "panel-region",
		pattern:
			/\b(?:right|left|top|bottom)\s+panel\b|\bat\s+\d+(\.\d+)?\s*(s|sec|seconds?)?\b.*\b(?:screen|panel|ui|window)\b|\b(?:screen|panel|ui|window)\b.*\bat\s+\d+/i,
	},
	{
		id: "around-visual",
		pattern:
			/\b(?:around|at|near)\s+\d+(\.\d+)?\s*(s|sec|seconds?)?\b.*\b(?:visible|appear|see|screen|look)\b|\b(?:look|see)\b.*\b(?:around|at)\s+\d+/i,
	},
	{
		id: "visual-edit-cues",
		pattern:
			/\b(?:zoom\s+into|focus\s+on|button|framing|improve\s+visually|animation|where\s+i\s+click|layout|dashboard|panel|dialog|modal|reframe|composition|compose|blur\b|highlight|on[\s-]?screen|click(?:ed|ing)?\s+(?:the\s+)?\w+|cursor\s+click)\b/i,
	},
];

/**
 * Whole-recording / watch-and-understand requests.
 * Prefer this over narrow visualInspection when the user asks to watch the media
 * or explain what happens from beginning to end (Case 2 → mediaUnderstanding).
 */
const MEDIA_UNDERSTANDING_FAMILIES: ReadonlyArray<{ id: string; pattern: RegExp }> = [
	{
		id: "watch-media",
		pattern:
			/\b(?:watch|look\s+(?:through|at|over)|go\s+through|check|inspect|analy[sz]e|review|examine)\s+(?:(?:a|an|the|this|my|complete|entire|whole|full)\s+)*(?:video|recording|footage|clip)\b/i,
	},
	{
		id: "what-happening",
		pattern:
			/\b(?:what\s+is\s+happening|what(?:'s| is)\s+going\s+on|what\s+happens|tell\s+me\s+what\s+(?:this|the)\s+recording|what\s+(?:is\s+)?this\s+recording\s+(?:is\s+)?about|what\s+this\s+recording\s+is\s+about|understand\s+this\s+recording|including\s+what\s+i(?:'m| am)\s+explaining)\b/i,
	},
	{
		id: "about-recording",
		pattern:
			/\b(?:tell\s+me\s+about\s+(?:this\s+|the\s+|my\s+)?(?:video|recording)|analy[sz]e\s+this\s+(?:video|recording)|inspect\s+this\s+(?:video|recording)|review\s+(?:this\s+|the\s+)?(?:footage|recording|video)|what\s+about\s+(?:this\s+|the\s+|my\s+)?(?:video|recording|it)|guide\s+me\s+(?:about|on|through)\s+(?:this\s+|the\s+|my\s+)?(?:video|recording|it))\b/i,
	},
	{
		id: "beginning-to-end",
		pattern:
			/\b(?:from\s+(?:the\s+)?beginning\s+to\s+(?:the\s+)?end|beginning\s+to\s+end)\b.*\b(?:happens|changes|recording|video|explain|describe|watch|visibly|visually)\b|\b(?:happens|changes|explain|describe|watch|visibly|visually|recording|video)\b.*\b(?:from\s+(?:the\s+)?beginning\s+to\s+(?:the\s+)?end|beginning\s+to\s+end)\b/i,
	},
];

const EDITING_CONTEXT_FAMILIES: ReadonlyArray<{ id: string; pattern: RegExp }> = [
	{
		id: "polish-professional",
		pattern:
			/\b(?:professional|polish(?:ed)?|clean\s+up|tighten|improve\s+(?:the\s+)?(?:pacing|flow)|make\s+this\s+(?:video|recording|screen\s+recording)|edit\s+this\s+(?:video|recording)|tutorial|demo\s+video|social\s+post|easier\s+to\s+follow|more\s+concise|much\s+more\s+concise|make\s+this\s+(?:much\s+)?shorter|look(?:s|ing)?\s+professional)\b/i,
	},
	{
		id: "creative-edit",
		pattern:
			/\b(?:feel\s+like\s+a\s+polished|turn\s+this\s+into|editing\s+brain|auto[\s-]?enhance|improve\s+this\s+(?:video|recording|tutorial)|keep\s+(?:almost\s+)?everything|do\s+not\s+remove|don'?t\s+over[\s-]?edit|without\s+over[\s-]?edit)\b/i,
	},
];

function firstMatch(
	families: ReadonlyArray<{ id: string; pattern: RegExp }>,
	text: string,
): string | null {
	for (const family of families) {
		if (family.pattern.test(text)) return family.id;
	}
	return null;
}

function needsOf(
	category: MediaRequestCategory,
	flags: Pick<MediaContextNeeds, "visual" | "speech" | "cursor" | "injectSpeech">,
): MediaContextNeeds {
	return { category, ...flags };
}

function isCheapDeterministic(text: string): boolean {
	return (
		DETERMINISTIC_EDIT.test(text) ||
		DETERMINISTIC_EDIT_LOOSE.test(text) ||
		DETERMINISTIC_TRIM_ORDINAL.test(text) ||
		DETERMINISTIC_SPEED.test(text) ||
		(ASPECT_ONLY.test(text) && text.length < 80)
	);
}

/**
 * Classify what evidence channels this turn should prepare / inject.
 * Pure function — never calls a model.
 */
export function classifyMediaContextNeeds(userMessage: string): MediaContextNeeds {
	const text = userMessage.trim();
	if (!text) return { ...EMPTY_MEDIA_CONTEXT_NEEDS };

	const speechHit = firstMatch(SPEECH_INSPECTION_FAMILIES, text);
	const visualHit = firstMatch(VISUAL_INSPECTION_FAMILIES, text);
	const understandingHit = firstMatch(MEDIA_UNDERSTANDING_FAMILIES, text);
	const editingHit = firstMatch(EDITING_CONTEXT_FAMILIES, text);

	// Deterministic timeline math — keep cheap unless speech/visual language is also present.
	if (isCheapDeterministic(text) && !speechHit && !visualHit && !understandingHit && !editingHit) {
		return needsOf("deterministicEdit", {
			visual: false,
			speech: false,
			cursor: false,
			injectSpeech: false,
		});
	}

	// Editing-brain readiness (future unified brain entry) — multimodal prepare.
	if (editingHit) {
		return needsOf("editingContext", {
			visual: true,
			speech: true,
			cursor: true,
			injectSpeech: true,
		});
	}

	// Whole-recording understanding — visual + speech when relevant; not Story yet.
	// Case 2 ("Watch this complete recording… what visibly happens…") lands here:
	// whole-media watch + beginning-to-end narrative → mediaUnderstanding, not narrow
	// visualInspection (even though UI-event language is also present).
	if (understandingHit) {
		return needsOf("mediaUnderstanding", {
			visual: true,
			speech: true,
			cursor: true,
			injectSpeech: true,
		});
	}

	// Narrow speech question — do not force visual frames.
	if (speechHit && !visualHit) {
		return needsOf("speechInspection", {
			visual: false,
			speech: true,
			cursor: false,
			injectSpeech: true,
		});
	}

	// Narrow visual question — do not force STT.
	if (visualHit && !speechHit) {
		return needsOf("visualInspection", {
			visual: true,
			speech: false,
			cursor: false,
			injectSpeech: false,
		});
	}

	// Both inspection signals in one prompt → treat as understanding.
	if (speechHit && visualHit) {
		return needsOf("mediaUnderstanding", {
			visual: true,
			speech: true,
			cursor: false,
			injectSpeech: true,
		});
	}

	return { ...EMPTY_MEDIA_CONTEXT_NEEDS, category: "fallback" };
}

/** Test/diagnostic — which family bucket won. */
export function matchedMediaContextCategory(userMessage: string): MediaRequestCategory {
	return classifyMediaContextNeeds(userMessage).category;
}
