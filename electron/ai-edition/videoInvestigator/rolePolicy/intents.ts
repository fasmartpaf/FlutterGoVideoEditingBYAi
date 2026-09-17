/**
 * Deterministic investigation intent classification — 0 LLM calls.
 * Reuses mediaContextNeeds flags where possible.
 */

import type { MediaContextNeeds } from "../../mediaContextNeeds";
import type { InvestigationIntent } from "./types";

const END_HINT =
	/\b(near the end|at the end|ending|final (few )?(seconds?|moments?)|last\s+(few\s+)?(seconds?|moments?)|wrap(?:ping)? up|closing)\b/i;
const BEGIN_HINT =
	/\b(at the (start|beginning)|near the (start|beginning)|first\s+(few\s+)?seconds?|opening moments?)\b/i;
const TEMP_UI =
	/\b(popup|pop-?up|tooltip|toast|banner|notification|brief|temporary|hud|overlay)\b/i;
const ACTION_VERIFY =
	/\b(did i|did we|open(?:ed)?|navigat(?:e|ed)|work(?:ed)? on|click(?:ed)?|restart(?:ed)?|select(?:ed)?)\b/i;
const SPEECH_ONLY =
	/\b(what did i say|what did we say|transcript|spoken|hear me|my words|say near|said near)\b/i;
const CORRECTION = /\b(correction|i meant|actually|rather|instead of|timeline|effects)\b/i;
const SETTINGS = /\bsettings?\b/i;
const UPWORK = /\bupwork\b/i;
const OCR_TEXT = /\b(read|text|label|ocr|what (does|do) it say|visible text)\b/i;
const CURSOR = /\b(cursor|click|mouse|pointer)\b/i;
const CHRONOLOGY =
	/\b(chronolog|timeline of|what happened (first|next|then)|walk me through|whole (video|recording)|entire (video|recording)|from (start|beginning) to (end|finish))\b/i;
const VISUAL =
	/\b(visibl|appear|on screen|ui|panel|menu|tab|what happens|look(?:ed|ing)?|see|saw)\b/i;
const CONTRADICTION = /\b(contradict|mismatch|inconsisten|but (the )?screen|vs\.? visual)\b/i;

export function classifyInvestigationIntents(
	userMessage: string,
	needs: MediaContextNeeds,
): InvestigationIntent[] {
	const q = userMessage.trim();
	const intents = new Set<InvestigationIntent>();

	if (
		CHRONOLOGY.test(q) ||
		(needs.category === "mediaUnderstanding" &&
			!END_HINT.test(q) &&
			!BEGIN_HINT.test(q) &&
			!SPEECH_ONLY.test(q) &&
			!ACTION_VERIFY.test(q) &&
			!TEMP_UI.test(q))
	) {
		if (CHRONOLOGY.test(q)) intents.add("chronology");
		if (!END_HINT.test(q) && !BEGIN_HINT.test(q) && !SPEECH_ONLY.test(q) && CHRONOLOGY.test(q)) {
			intents.add("whole_media_understanding");
		}
	}

	if (SPEECH_ONLY.test(q) || needs.category === "speechInspection") {
		intents.add("speech_content");
	}
	if (CORRECTION.test(q) && (needs.speech || SPEECH_ONLY.test(q) || /timeline|effects/i.test(q))) {
		intents.add("spoken_correction");
		intents.add("contradiction_check");
	}
	if (TEMP_UI.test(q) || (END_HINT.test(q) && VISUAL.test(q))) {
		intents.add("temporary_ui");
		intents.add("visual_state");
	}
	if (OCR_TEXT.test(q) || TEMP_UI.test(q)) {
		intents.add("text_ui_reading");
	}
	if (ACTION_VERIFY.test(q) || UPWORK.test(q) || (SETTINGS.test(q) && ACTION_VERIFY.test(q))) {
		intents.add("action_verification");
	}
	if (SETTINGS.test(q) && (ACTION_VERIFY.test(q) || /opening/i.test(q))) {
		intents.add("contradiction_check");
		intents.add("action_verification");
	}
	if (CURSOR.test(q) || needs.cursor) {
		if (ACTION_VERIFY.test(q) || CURSOR.test(q)) intents.add("cursor_interaction");
	}
	if (VISUAL.test(q) || needs.visual || needs.category === "visualInspection") {
		intents.add("visual_state");
	}
	if (CONTRADICTION.test(q)) intents.add("contradiction_check");

	// Editing context / whole media fallback
	if (needs.category === "editingContext" || needs.category === "mediaUnderstanding") {
		if (intents.size === 0) intents.add("whole_media_understanding");
	}

	// Speech-only questions should not also force temporary_ui / OCR unless asked
	if (
		(intents.has("speech_content") && SPEECH_ONLY.test(q) && !VISUAL.test(q) && !TEMP_UI.test(q)) ||
		/\b(what did i say|what did we say)\b/i.test(q)
	) {
		if (!TEMP_UI.test(q) && !ACTION_VERIFY.test(q)) {
			intents.delete("temporary_ui");
			intents.delete("text_ui_reading");
			intents.delete("visual_state");
			intents.delete("whole_media_understanding");
			intents.delete("chronology");
			intents.add("speech_content");
		}
	}

	if (intents.size === 0) {
		if (needs.speech && !needs.visual) intents.add("speech_content");
		else if (needs.visual && !needs.speech) intents.add("visual_state");
		else intents.add("whole_media_understanding");
	}

	return [...intents];
}

export function wantsWholeVideoHierarchy(intents: InvestigationIntent[]): boolean {
	return intents.includes("chronology") || intents.includes("whole_media_understanding");
}

export function isSpeechPrimary(intents: InvestigationIntent[], userMessage: string): boolean {
	if (/\b(what did i say|what did we say|transcript only)\b/i.test(userMessage)) {
		return !/\b(open|popup|visible on screen|ui change|brief popup)\b/i.test(userMessage);
	}
	return (
		intents.includes("speech_content") &&
		!intents.includes("action_verification") &&
		!intents.includes("temporary_ui") &&
		!intents.includes("visual_state") &&
		!/\b(open|popup|visible|screen|ui)\b/i.test(userMessage)
	);
}
