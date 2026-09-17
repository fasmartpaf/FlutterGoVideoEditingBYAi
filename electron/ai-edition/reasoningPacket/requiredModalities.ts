/**
 * Required modalities for Bounded Reasoning — separate from queryClass.
 * Identity: CURRENT_OPENSCREEN_BOUNDED_REASONING_V1 (Reliability V2)
 */

import type { MediaContextNeeds } from "../mediaContextNeeds/types";
import type { VideoMemoryQueryClass } from "../videoMemory";

export type RequiredModalities = {
	speech: boolean;
	visual: boolean;
	cursor: boolean;
	ocr: boolean;
	reason: string;
};

/** Phrase families that force speech even if a narrow visual cue also matched. */
const SPEECH_FORCE =
	/\b(?:listen(?:\s+carefully)?|watch\s+and\s+listen|what\s+(?:did\s+)?i\s+(?:first\s+)?(?:say|said)|what\s+i\s+will\s+(?:say|do)|how\s+i\s+correct(?:ed)?\s+myself|correct(?:ed)?\s+myself|i\s+mean(?:t)?\b|first\s+i\s+said|then\s+i\s+(?:said|changed|corrected)|compare\s+what\s+i\s+(?:say|said)|what\s+matches?,\s*what\s+differs)\b/i;

const VISUAL_FORCE =
	/\b(?:on\s+screen|visibl(?:e|y)|what\s+(?:actually\s+)?happened|verify|frames?|zoom|settings|upwork|restart|panel|ui|cursor)\b/i;

const CROSS_FORCE =
	/\b(?:compare\s+what\s+i|matches?,\s*what\s+differs|cannot\s+(?:be\s+)?verify|listen(?:\s+carefully)?.{0,80}(?:screen|visible)|(?:say|said|correct).{0,120}(?:screen|visible|verify))\b/i;

/**
 * Resolve required modalities from message + existing MediaContextNeeds + queryClass.
 * Never invents evidence — only declares what must be prepared.
 */
export function resolveRequiredModalities(input: {
	userMessage: string;
	contextNeeds: MediaContextNeeds;
	queryClass: VideoMemoryQueryClass;
}): RequiredModalities {
	const msg = input.userMessage;
	const speechForce = SPEECH_FORCE.test(msg);
	const visualForce = VISUAL_FORCE.test(msg);
	const crossForce = CROSS_FORCE.test(msg) || input.queryClass === "cross_modal";

	let speech = input.contextNeeds.speech || speechForce || crossForce;
	let visual =
		input.contextNeeds.visual ||
		visualForce ||
		crossForce ||
		input.queryClass === "visual" ||
		input.queryClass === "editorial" ||
		input.queryClass === "action_verify";
	let cursor =
		input.contextNeeds.cursor ||
		(/\bcursor\b/i.test(msg) && visual) ||
		input.queryClass === "editorial";
	let ocr =
		/\b(?:ocr|read(?:able)?\s+text|label|button\s+text|settings)\b/i.test(msg) ||
		input.queryClass === "editorial" ||
		input.queryClass === "action_verify";

	// Pure speech inspection: do not force visual/OCR.
	if (
		input.queryClass === "speech" &&
		!crossForce &&
		!/\b(?:screen|visible|happened|verify|zoom)\b/i.test(msg)
	) {
		visual = false;
		cursor = false;
		ocr = false;
		speech = true;
	}

	const reasons: string[] = [];
	if (speech) reasons.push("speech");
	if (visual) reasons.push("visual");
	if (cursor) reasons.push("cursor");
	if (ocr) reasons.push("ocr");
	if (speechForce) reasons.push("speech_phrase_family");
	if (crossForce) reasons.push("cross_modal_phrase");

	return {
		speech,
		visual,
		cursor,
		ocr,
		reason: reasons.join(",") || "none",
	};
}

/** Merge required modalities into MediaContextNeeds for prepare paths (Bounded). */
export function applyRequiredModalitiesToNeeds(
	needs: MediaContextNeeds,
	required: RequiredModalities,
): MediaContextNeeds {
	const speech = needs.speech || required.speech;
	const visual = needs.visual || required.visual;
	const cursor = needs.cursor || required.cursor;
	return {
		...needs,
		speech,
		visual,
		cursor,
		injectSpeech: needs.injectSpeech || speech,
		category:
			speech && visual
				? needs.category === "editingContext"
					? "editingContext"
					: "mediaUnderstanding"
				: speech && !visual
					? "speechInspection"
					: visual && !speech
						? "visualInspection"
						: needs.category,
	};
}
