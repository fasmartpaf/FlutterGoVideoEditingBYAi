/**
 * Parse professional-edit intent from chat text (0 LLM).
 */

import type { AutonomyLevel, EditFamily, ProfessionalEditIntentV1 } from "./types";

const PROCEED_PHRASES =
	/\b(yes\s+perform|yes\s+proceed|yes\s+do\s+it|yeah\s+do\s+it|yep\s+do\s+it|proceed|go\s+ahead|apply\s+(?:it|these|that|this)|okay\s+apply|ok\s+apply|sounds\s+good|make\s+that\s+change|you\s+decide|do\s+it|make\s+it\s+so|just\s+do\s+it|perform\s+(?:the\s+)?(?:edits?|plan)|ok\s+remove|yes\s+remove|remove\s+(?:a\s+)?some|do\s+whatever\s+needed)\b/i;

/** Bare affirmation — only treat as proceed when a pending proposal exists (caller checks). */
export const BARE_AFFIRM_RE =
	/^(?:yes|yeah|yep|yup|ok|okay|sure|please|do\s+that|that\s+works)(?:\.|!)?$/i;

export function isBareAffirmation(text: string): boolean {
	return BARE_AFFIRM_RE.test(text.trim());
}

export function isVerbalProceed(text: string): boolean {
	return PROCEED_PHRASES.test(text.trim());
}

/** Strong proceed phrases (never requires pending proposal). */
export function isStrongVerbalProceed(text: string): boolean {
	return PROCEED_PHRASES.test(text.trim());
}

/** Explicit ask to cut silence / non-speech gaps (typo-tolerant). */
export function isExplicitPauseRemovalRequest(text: string): boolean {
	const t = text.trim().toLowerCase();
	return (
		/\b(?:remove|cut|shorten|delete).{0,80}(?:pauses?|silences?|dead\s*air)\b/i.test(t) ||
		/\b(?:pauses?|silences?|dead\s*air).{0,40}(?:remove|cut|delete)\b/i.test(t) ||
		/\b(?:no\s+voice|not\s+(?:a\s+)?voice|without\s+(?:a\s+)?voice|where\s+(?:there\s+)?is\s+no\s+voice).{0,40}(?:remove|cut|delete)\b/i.test(
			t,
		) ||
		/\b(?:remove|cut|delete).{0,60}(?:no\s+voice|not\s+(?:a\s+)?voice|without\s+voice)\b/i.test(t)
	);
}

/** Optional filler between duration cue and number: "under a 12 sec", "below about 10s". */
const DURATION_FILLER = `(?:(?:a|an|the|about|around|approx(?:imately)?)\\s+)?`;

/** "under/less than/below [a] N sec(ond)s" — local duration target (0 LLM). */
const UNDER_DURATION_RE = new RegExp(
	`\\b(?:under|less\\s+than|below)\\s+${DURATION_FILLER}(\\d+)\\s*(?:se(?:c(?:ond)?s?)?|s)\\b`,
	"i",
);

/** Action requests that authorize applying a bounded safe plan (not plan-only). */
function isActionAuthorizeRequest(t: string): boolean {
	return (
		/\byou\s+decide\b|\bwhatever\s+works\b|\buse\s+whatever\s+safe\b|\bdo\s+whatever\s+safe\b|\bdo\s+whatever\s+needed\b/i.test(
			t,
		) ||
		/\b(?:please\s+)?(?:improve|polish|fix\s+(?:this|it)|clean\s+(?:this|it)\s+up)\b/i.test(t) ||
		/\bmake\s+(?:this|the|a|it)\s+(?:\w+\s+){0,3}(?:professional|better|tighter|shorter|ready)\b/i.test(
			t,
		) ||
		/\bmake\s+(?:it|this)\s+professional\b/i.test(t) ||
		/\bedit\s+this\s+like\s+a\s+professional\b/i.test(t) ||
		/\bready\s+to\s+publish\b/i.test(t) ||
		// Duration compress: "make … under 12 sec", "keep it under a 12 seconds"
		UNDER_DURATION_RE.test(t) ||
		/\bmake\s+(?:this|the|a|it)?\s*(?:video\s+)?(?:under|shorter|tighter)\b/i.test(t) ||
		/\bok\s+remove\b|\bremove\s+(?:a\s+)?some\b|\bremove\s+(?:some\s+)?(?:of\s+)?(?:them|those)\b/i.test(
			t,
		) ||
		/\b(?:add|put)\s+(?:a\s+|the\s+)?(?:transitions?|zooms?|unzooms?)\b/i.test(t) ||
		/\bzooming\b|\bunzooming\b|\btransations?\b/i.test(t) ||
		isExplicitPauseRemovalRequest(t)
	);
}

export function parseProfessionalEditIntent(userMessage: string): ProfessionalEditIntentV1 {
	const t = userMessage.trim().toLowerCase();
	const professional =
		/\bprofessional\b/.test(t) ||
		/\bpolish\b/.test(t) ||
		/\bclean\s+(?:this|it|up)\b/.test(t) ||
		/\bimprove\b/.test(t) ||
		/\bmake\s+(?:this|it|the\s+video)\s+better\b/.test(t);
	const tighter =
		/\b(shorten|tighten|make\b.{0,20}\bshorter)\b/.test(t) ||
		UNDER_DURATION_RE.test(t) ||
		/\b\d+\s*[-–]\s*\d+\s*se/.test(t) ||
		isExplicitPauseRemovalRequest(userMessage);

	let targetDurationMinSec: number | null = null;
	let targetDurationMaxSec: number | null = null;
	let targetDurationSec: number | null = null;

	const range = t.match(/\b(\d+)\s*[-–]\s*(\d+)\s*se/);
	const under = t.match(UNDER_DURATION_RE);
	const about = t.match(
		new RegExp(
			`\\b(?:about|around|~)\\s+${DURATION_FILLER}(\\d+)\\s*(?:se(?:c(?:ond)?s?)?|s)\\b`,
			"i",
		),
	);
	if (range) {
		targetDurationMinSec = Number(range[1]);
		targetDurationMaxSec = Number(range[2]);
		targetDurationSec = targetDurationMaxSec;
	} else if (under) {
		targetDurationMaxSec = Number(under[1]);
		targetDurationSec = targetDurationMaxSec;
	} else if (about) {
		targetDurationSec = Number(about[1]);
		targetDurationMaxSec = targetDurationSec;
	}

	const preserveImportant =
		(/\b(preserve|keep|don'?t\s+delete|do\s+not\s+delete|important)\b/.test(t) || professional) &&
		!/\bok\s+remove\b|\bremove\s+(?:a\s+)?some\b|\bremove\s+(?:the\s+)?(?:less\s+important|lower[\s-]?value)\b/.test(
			t,
		);

	const allowOptionalContentRemoval =
		/\bok\s+remove\b|\bremove\s+(?:a\s+)?some\b|\bremove\s+(?:some\s+)?(?:of\s+)?(?:them|those)\b|\bcut\s+(?:some|less\s+important)\b|\blower[\s-]?value\b|\bsupporting\s+explanation\b|\bauthorize[sd]?\s+removing\b|\bauthorizes\s+removing\b/i.test(
			t,
		);

	const mentioned: EditFamily[] = [];
	if (/\btrim|\bpause|\bsilence|\bdead\s*air/.test(t)) mentioned.push("trim");
	if (/\bzoom|\bunzoom|\breframe/.test(t)) mentioned.push("zoom");
	if (/\bcrop|\breframe/.test(t)) mentioned.push("crop");
	if (/\bspeed/.test(t)) mentioned.push("speed");
	if (/\bcaption|\bsubtitle/.test(t)) mentioned.push("captions");
	if (/\baudio|\bloud|\bvolume|\bnormalize/.test(t)) mentioned.push("loudness");
	if (/\btransition|\bdissolve|\btransation/.test(t)) mentioned.push("transitions");

	const requestedUnsupported: EditFamily[] = [];
	// transitions are now authorable (CUT|DISSOLVE) — no longer auto-unsupported

	const wantCaptions = /\bcaption|\bsubtitle|\benable captions|\badd (?:a )?caption/.test(t)
		? true
		: professional
			? "auto"
			: "auto";
	const captionOnly =
		wantCaptions === true &&
		/\b(?:add|enable|show|put|turn\s+on)\s+(?:a\s+|the\s+)?(?:captions?|subtitles?)\b/.test(t) &&
		!professional &&
		!tighter &&
		!/\bzoom|\btrim|\bspeed|\bpacing|\bprofessional\b/.test(t);

	const allowedFamilies: EditFamily[] = captionOnly
		? ["captions"]
		: ["trim", "captions", "loudness", "zoom", "crop", "speed", "title", "callout", "transitions"];
	const explicitlyRequestedFamilies = captionOnly
		? (["captions"] as EditFamily[])
		: [...new Set(mentioned)];
	void mentioned;

	let autonomy: AutonomyLevel = "ask_once";
	if (isVerbalProceed(userMessage) || isActionAuthorizeRequest(t) || captionOnly) {
		autonomy = "you_decide";
	} else if (/\bjust\s+(?:plan|propose)\b/.test(t)) {
		autonomy = "plan_only";
	}

	const wantAudioImprove = /\baudio|\bloud|\bvolume/.test(t)
		? true
		: professional
			? "auto"
			: "auto";

	return {
		version: 1,
		rawText: userMessage.trim(),
		requestedOutcome: professional
			? "MAKE_PROFESSIONAL"
			: tighter || allowOptionalContentRemoval
				? "MAKE_TIGHTER"
				: "CUSTOM",
		targetDurationSec,
		targetDurationMaxSec,
		targetDurationMinSec,
		preserveImportant,
		allowOptionalContentRemoval,
		allowedFamilies,
		requestedUnsupported: [...new Set(requestedUnsupported)],
		explicitlyRequestedFamilies,
		autonomy,
		wantCaptions,
		wantAudioImprove: captionOnly ? false : wantAudioImprove,
		pacingPreference:
			tighter || targetDurationMaxSec != null || allowOptionalContentRemoval
				? "tighter"
				: "unspecified",
	};
}

export function isProfessionalEditRequest(userMessage: string): boolean {
	const intent = parseProfessionalEditIntent(userMessage);
	const t = userMessage.trim().toLowerCase();
	return (
		intent.requestedOutcome === "MAKE_PROFESSIONAL" ||
		intent.requestedOutcome === "MAKE_TIGHTER" ||
		intent.targetDurationMaxSec != null ||
		intent.allowOptionalContentRemoval ||
		intent.explicitlyRequestedFamilies.length > 0 ||
		isVerbalProceed(userMessage) ||
		isExplicitPauseRemovalRequest(userMessage) ||
		/\bimprove\b/.test(t) ||
		/\bmake\s+(?:this|it)\s+better\b/.test(t) ||
		/\bedit\s+this\s+like\s+a\s+professional\b/.test(t) ||
		/\bready\s+to\s+publish\b/.test(t) ||
		/\bfix\s+the\s+pacing\b/.test(t) ||
		/\bdo\s+whatever\s+safe\b/.test(t) ||
		/\bzoom|\bunzoom|\btransition|\btransation\b|\bcaption|\bsubtitle\b/.test(t)
	);
}
