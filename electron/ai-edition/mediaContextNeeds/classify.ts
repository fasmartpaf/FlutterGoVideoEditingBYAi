/**
 * Deterministic media-context classifier — semantic request families, no LLM.
 *
 * Canonical owner of turn-local visual / speech / cursor routing.
 * Legacy `promptWantsVisualEvidence` defers to `needs.visual` from this module.
 *
 * Policy (Recovery 2):
 * 1. deterministic edit → minimal
 * 2. speech-specific → speech only
 * 3. visual-specific → visual
 * 4. cross-modal → visual + speech
 * 5. editorial/whole-media → multimodal
 * 6. product capability / definition → no media
 * 7. safer fallback: recording-context language → mediaUnderstanding (not starvation)
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
/** Follow-ups that reverse/adjust a prior verified edit without full editorial cognition. */
const DETERMINISTIC_FOLLOWUP_EDIT =
	/\b(?:undo|revert)\s+(?:that\s+|the\s+)?(?:last\s+)?(?:change|edit|mutation|zoom|trim|speed)s?\b|\bremove\s+(?:that\s+|the\s+)?(?:last\s+)?zoom\b|\b(?:make\s+(?:the\s+)?captions?\s+smaller|captions?\s+smaller)\b|\b(?:turn|switch)\s+(?:the\s+)?captions?\s+off\b|\bdon'?t\s+speed\s+(?:that|this|it)\b|\bkeep\s+the\s+pause\s+at\s+the\s+beginning\b|\bmake\s+the\s+audio\s+(?:a\s+little\s+)?(?:quieter|louder)\b|\brestore\s+(?:the\s+)?previous\b|\bprevious\s+version\s+was\s+better\b/i;
const ASPECT_ONLY = /^(?:change\s+)?aspect(?:\s*ratio)?\b|^set\s*aspect\b|\b(?:9:16|16:9|1:1)\b/i;

const SPEECH_INSPECTION_FAMILIES: ReadonlyArray<{ id: string; pattern: RegExp }> = [
	{
		id: "what-said",
		pattern:
			/\b(?:what\s+(?:did|was|do)\s+(?:i|we|they|you)\s+say|what\s+(?:am\s+i|are\s+we)\s+saying|what\s+(?:was|is)\s+said|what\s+i\s+(?:first\s+)?(?:say|said)|what\s+i\s+will\s+(?:say|do)|summarize\s+(?:what\s+i\s+said|the\s+narration|my\s+(?:speech|narration))|did\s+i\s+correct\s+myself|how\s+i\s+correct(?:ed)?\s+myself|what\s+(?:was\s+)?my\s+(?:final\s+)?(?:intended\s+)?meaning)\b/i,
	},
	{
		id: "listen-spoken",
		pattern:
			/\b(?:listen(?:\s+carefully)?|watch\s+and\s+listen|what\s+i\s+(?:first\s+)?(?:say|said)|i\s+mean(?:t)?\b|actually\s+(?:i\s+)?(?:mean|meant|said)|correct(?:ed)?\s+myself|spoken\s+correction|first\s+i\s+said|then\s+i\s+(?:said|changed|corrected)|i\s+changed\s+(?:my\s+)?(?:mind|wording))\b/i,
	},
	{
		id: "transcript-ask",
		pattern:
			/\b(?:transcri(?:be|ption|pt)|caption(?:s|ing)?|subtitl(?:e|es|ing)|spoken\s+words?|voice[\s-]?over)\b/i,
	},
	{
		id: "around-speech",
		pattern:
			/\b(?:hear|heard|audio\s+say|narrat(?:e|ion|ing)|what\s+i(?:'m| am)\s+explaining|dead\s+air|silences?)\b/i,
	},
];

/**
 * Narrow look-at-the-pixels requests — visual frames, no STT by default.
 */
const VISUAL_INSPECTION_FAMILIES: ReadonlyArray<{ id: string; pattern: RegExp }> = [
	{
		id: "visible-on-screen",
		pattern:
			/\b(?:what\s+is\s+visible|what\s+is\s+visibly\s+happening|what(?:'s| is| are)\s+(?:on\s+)?(?:the\s+)?screen|what\s+appears|what\s+do\s+you\s+see|visible\s+on\s+screen|what\s+visibly\s+happens|what\s+happens\s+visually|tell\s+me\s+what\s+visibly\s+happens|describe\s+what\s+happens\s+on\s+screen|what\s+(?:apps?|applications?|screens?)\s+(?:are\s+)?visible|is\s+there\s+a\s+webcam|webcam\b|applications?\s+or\s+screens?)\b/i,
	},
	{
		id: "stability-change",
		pattern:
			/\b(?:mostly\s+stable|screen\s+(?:mostly\s+)?(?:stable|static|unchanged)|little\s+happening|stayed\s+the\s+same|much\s+visual\s+change|major\s+visual\s+changes?|did\s+(?:the\s+)?screen\s+change|anything\s+(?:moving|changing)|visual\s+changes?|screen\s+change\s+much|mostly\s+unchanged)\b/i,
	},
	{
		id: "ui-events",
		pattern:
			/\b(?:brief\s+ui|ui\s+changes?|describe\s+ui|call\s+out\s+any\s+(?:brief\s+)?ui|menus?|popovers?|notifications?|temporary\s+states?|toasts?|popup)\b/i,
	},
	{
		id: "appear-ask",
		pattern:
			/\b(?:did\s+(?:any\s+|a\s+)?(?:menu|notification|popover|toast|dialog|modal|popup)\s+appear|what\s+popup\s+appears?)\b/i,
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

const MEDIA_UNDERSTANDING_FAMILIES: ReadonlyArray<{ id: string; pattern: RegExp }> = [
	{
		id: "watch-media",
		pattern:
			/\b(?:watch|look\s+(?:through|at|over)|go\s+through|check|inspect|analy[sz]e|review|examine)\s+(?:(?:a|an|the|this|my|complete|entire|whole|full)\s+)*(?:video|recording|footage|clip)\b/i,
	},
	{
		id: "what-happening",
		pattern:
			/\b(?:what\s+is\s+happening|what(?:'s| is)\s+going\s+on|what\s+happens|tell\s+me\s+what\s+(?:this|the)\s+recording|what\s+(?:is\s+)?this\s+recording\s+(?:is\s+)?about|what\s+this\s+recording\s+is\s+about|understand\s+this\s+recording|including\s+what\s+i(?:'m| am)\s+explaining|what\s+i\s+did\s+(?:here|in\s+this)|what\s+(?:happened|i\s+did)\s+here)\b/i,
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
	{
		id: "cross-modal",
		pattern:
			/\b(?:did\s+(?:what\s+i\s+said|i\s+(?:actually\s+)?(?:do|open|show))|compare\s+what\s+i\s+(?:say|said|am\s+saying)|what\s+matches?,\s*what\s+differs|cannot\s+be\s+verified|said\s+.*\s+(?:happen|show|open|visible)|speech\s+.*\s+visual|visual\s+.*\s+speech|actually\s+(?:happen|open|show)|open\s+what\s+i\s+mentioned|things?\s+i\s+talk(?:ed)?\s+about|what\s+i\s+(?:talk|say|said)\s+about\s+actually\s+appear|did\s+the\s+things\s+i\s+talk|listen(?:\s+carefully)?.{0,80}(?:screen|visible|happened)|(?:what\s+i\s+(?:first\s+)?(?:say|said)|correct(?:ed)?\s+myself).{0,120}(?:screen|visible|verify))\b/i,
	},
];

const EDITING_CONTEXT_FAMILIES: ReadonlyArray<{ id: string; pattern: RegExp }> = [
	{
		id: "polish-professional",
		pattern:
			/\b(?:professional|polish(?:ed)?|clean\s+(?:up|this)|tighten|improve\s+(?:the\s+)?(?:pacing|flow|clarity)|make\s+this\s+(?:video|recording|screen\s+recording|pro\b|presentable|suitable)|edit\s+this\s+(?:video|recording)|edit\s+this\s+like\s+a\s+professional|tutorial|demo(?:\s+video)?|product\s+demo|social\s+post|easier\s+to\s+follow|more\s+concise|much\s+more\s+concise|make\s+(?:this\s+)?(?:much\s+)?shorter|look(?:s|ing)?\s+professional|clearer|client\s+presentation|presentable|prepare\s+this|for\s+a\s+client|ready\s+to\s+publish|make\s+it\s+ready|do\s+whatever\s+safe)\b/i,
	},
	{
		id: "creative-edit",
		pattern:
			/\b(?:feel\s+like\s+a\s+polished|turn\s+this\s+into|editing\s+brain|auto[\s-]?enhance|improve\s+this(?:\s+(?:video|recording|tutorial))?|keep\s+(?:almost\s+)?everything|do\s+not\s+remove|don'?t\s+over[\s-]?edit|without\s+over[\s-]?edit|safe\s+edits?|what\s+(?:safe\s+)?edits?|what\s+would\s+you\s+(?:change|propose|edit)|what\s+should\s+i\s+change|propose(?:\s+\w+)?\s+edits?|fix\s+the\s+pacing|anything\s+boring|trim\s+silences?|remove\s+(?:more\s+)?(?:unnecessary\s+)?(?:the\s+)?(?:pauses?|silences?|dead\s+air))\b/i,
	},
	{
		id: "duration-target",
		pattern:
			/\b(?:under|less\s+than|below)\s+(?:(?:a|an|the|about|around)\s+)?\d+\s*(?:se(?:c(?:ond)?s?)?|s)\b|\bkeep\s+it\s+under\s+\d+/i,
	},
	{
		id: "pacing-speed-followup",
		pattern:
			/\b(?:slow\s+parts?|navigation|low[\s-]?info(?:rmation)?).{0,20}faster\b|\ba\s+little\s+faster\b|\bspeed\s+up\b|\bfaster\s+navigation\b/i,
	},
	{
		id: "editorial-judgment",
		pattern:
			/\b(?:where would zoom|zoom would actually help|anywhere a zoom|\bzoom\b.*\bhelp\b|what edits would you not|edits would you not make|what is distracting|unnecessary parts)\b/i,
	},
];

/** Product capability / definition — do not analyze the current recording. */
const CAPABILITY_OR_DEFINITION =
	/\b(?:can\s+openscreen|does\s+openscreen|is\s+\w[\w-]*\s+supported|what\s+does\s+(?:crop(?:ping)?|trim(?:ming)?|zoom(?:ing)?|stabiliz\w*|denoise|upscal\w*)\s+(?:do|mean)|how\s+do(?:es)?\s+(?:cropping|trimming|zoom(?:ing)?)\s+work)\b/i;

/**
 * Language that implies the current recording / screen is in play.
 * Used only as a safer fallback after specific families miss — not a keyword trap
 * for historical case strings alone.
 */
const RECORDING_CONTEXT =
	/\b(?:this|the|my|our)\s+(?:recording|video|footage|clip|screen|project|demo)\b|\b(?:recording|video|footage|clip)\b|\b(?:on\s+)?(?:the\s+)?screen\b|\bwebcam\b|\bvisual\b|\bstable\b|\bpacing\b|\bedit(?:s|ing|orial)?\b|\bimprov(?:e|ing)\b|\bprofessional\b|\bshorter\b|\bclearer\b|\bpause?s?\b|\bnarrat|transcript|popup|application|visible|chang(?:e|es|ing)|demo|polish|propose|what\s+i\s+did\b/i;

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
		DETERMINISTIC_FOLLOWUP_EDIT.test(text) ||
		(ASPECT_ONLY.test(text) && text.length < 80)
	);
}

function isCapabilityOrDefinition(text: string): boolean {
	if (CAPABILITY_OR_DEFINITION.test(text)) return true;
	// "What does X mean/do?" without pointing at this recording
	if (
		/\bwhat\s+does\s+\w[\w-]*\s+(?:do|mean)\b/i.test(text) &&
		!/\b(?:this|my|the)\s+(?:recording|video|screen|footage)\b/i.test(text)
	) {
		return true;
	}
	return false;
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

	const timestampLocal =
		/\b(?:at|around|near)\s+\d+(?:\.\d+)?\s*(?:s|sec|seconds?)?\b/i.test(text) &&
		!/\b(?:this|the|my|entire|whole|complete|full)\s+(?:recording|video|footage|clip)\b/i.test(
			text,
		) &&
		!/\bover\s+time\b|\bbeginning\s+to\s+end\b|\bcompare\s+what\s+i\b/i.test(text) &&
		text.length < 120;

	// Local timestamp look ("what happens at 12 seconds?") is not whole-recording understanding.
	if (timestampLocal && !editingHit && !speechHit) {
		return needsOf("visualInspection", {
			visual: true,
			speech: false,
			cursor: false,
			injectSpeech: false,
		});
	}

	// Deterministic timeline math — keep cheap unless speech/visual language is also present.
	if (isCheapDeterministic(text) && !speechHit && !visualHit && !understandingHit && !editingHit) {
		return needsOf("deterministicEdit", {
			visual: false,
			speech: false,
			cursor: false,
			injectSpeech: false,
		});
	}

	// Product Q&A / definitions — no recording analysis.
	if (
		isCapabilityOrDefinition(text) &&
		!editingHit &&
		!understandingHit &&
		!visualHit &&
		!speechHit
	) {
		return { ...EMPTY_MEDIA_CONTEXT_NEEDS, category: "fallback" };
	}

	// Editing-brain readiness — multimodal prepare.
	if (editingHit) {
		return needsOf("editingContext", {
			visual: true,
			speech: true,
			cursor: true,
			injectSpeech: true,
		});
	}

	// Whole-recording / cross-modal understanding.
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

	// Safer fallback: recording/screen/edit context → understand media, don't starve.
	if (RECORDING_CONTEXT.test(text)) {
		return needsOf("mediaUnderstanding", {
			visual: true,
			speech: true,
			cursor: true,
			injectSpeech: true,
		});
	}

	return { ...EMPTY_MEDIA_CONTEXT_NEEDS, category: "fallback" };
}

/** Test/diagnostic — which family bucket won. */
export function matchedMediaContextCategory(userMessage: string): MediaRequestCategory {
	return classifyMediaContextNeeds(userMessage).category;
}
