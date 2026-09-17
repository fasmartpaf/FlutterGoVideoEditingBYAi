/**
 * Parse chat user text into local product intents (0 LLM).
 */

import type { ProductEditorialIntents } from "./types";

export function parseProductEditorialIntents(userMessage: string): ProductEditorialIntents {
	const t = userMessage.trim().toLowerCase();
	const wantCaptions =
		/\bcaptions?\b/.test(t) ||
		/\bsubtitles?\b/.test(t) ||
		/\benable\b.{0,24}\btranscript\b/.test(t) ||
		/\bfrom\s+the\s+transcript\b/.test(t);

	const wantTighter =
		/\b(shorten|tighten|remove|cut|trim)\b.{0,48}\b(pause|pauses|silence|silences|dead[\s-]?air)\b/.test(
			t,
		) ||
		/\b(pause|pauses|silence|silences|dead[\s-]?air)\b.{0,24}\b(shorten|tighten|remove|cut|trim)\b/.test(
			t,
		) ||
		/\bmake\b.{0,24}\b(shorter|tighter)\b/.test(t) ||
		/\bless\s+than\s+\d+\s*se/.test(t) ||
		/\bunder\s+\d+\s*se/.test(t) ||
		/\b\d+\s*se(?:c|conds?)?\b.{0,12}\bvideo\b/.test(t);

	const wantProfessional =
		/\bprofessional\b/.test(t) || /\bpolish\b/.test(t) || /\bclean\s+(?:this|it|up)\b/.test(t);

	const wantClarity =
		/\b(clearer|clarity|louder|volume|easier\s+to\s+follow)\b/.test(t) ||
		/\bimprove\b.{0,16}\b(audio|sound)\b/.test(t);

	let targetDurationSec: number | null = null;
	const lessThan = t.match(/\bless\s+than\s+(\d+)\s*se/);
	const under = t.match(/\bunder\s+(\d+)\s*se/);
	if (lessThan?.[1]) targetDurationSec = Number(lessThan[1]);
	else if (under?.[1]) targetDurationSec = Number(under[1]);

	return {
		wantCaptions,
		wantTighter,
		wantProfessional,
		wantClarity,
		targetDurationSec,
		rawGoalText: userMessage.trim(),
	};
}

/** Whether this turn should spend ffmpeg on dead-air detection. */
export function shouldRunDeadAir(intents: ProductEditorialIntents): boolean {
	return intents.wantTighter || intents.wantProfessional || intents.targetDurationSec != null;
}

/** Goal text for bounded reasoning. */
export function goalTextForReasoning(intents: ProductEditorialIntents): string {
	if (intents.wantCaptions && !intents.wantTighter && !intents.wantProfessional) {
		return "Enable captions from the transcript";
	}
	if (intents.wantTighter && !intents.wantCaptions) {
		return "Make this tighter — shorten safe pauses";
	}
	if (intents.wantProfessional) {
		return intents.rawGoalText || "Make this more professional";
	}
	return intents.rawGoalText || "Review safe local edits";
}
