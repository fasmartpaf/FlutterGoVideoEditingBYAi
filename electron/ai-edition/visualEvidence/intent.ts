/**
 * Visual-intent helpers for diagnostics and prepare fallbacks.
 *
 * Canonical routing lives in `classifyMediaContextNeeds` (mediaContextNeeds).
 * `promptWantsVisualEvidence` is a thin boolean view of `needs.visual` so Bug-2
 * and the classifier cannot disagree on whether frames should be prepared.
 *
 * `matchedVisualIntentFamily` keeps the legacy family names for tests / logs;
 * it is not an independent production gate.
 */

import { classifyMediaContextNeeds } from "../mediaContextNeeds";

/** Explicit non-vision commands (timestamp cuts, tool-name edits). */
const METADATA_ONLY_PATTERN =
	/^(?:delete|cut|trim|remove)\s+[\d:.\s–—\-toand]+(?:seconds?|s)?\.?$/i;

/**
 * Legacy visual family labels (Bug-2). Diagnostic only — production uses classify.
 */
const VISUAL_INTENT_FAMILIES: ReadonlyArray<{ id: string; pattern: RegExp }> = [
	{
		id: "see-screen",
		pattern:
			/\b(?:what\s+do\s+you\s+see|what(?:'s| is| are)\s+(?:on\s+)?(?:the\s+)?screen|what\s+is\s+happening|what\s+appears|what\s+happens)\b/i,
	},
	{
		id: "inspect-media",
		pattern:
			/\b(?:check|inspect|analyze|analyse|review|watch|see|look\s+at|look\s+into|describe|examine)\s+(?:a\s+|the\s+|this\s+|my\s+)?(?:video|recording|footage|clip|screen)\b/i,
	},
	{
		id: "frames",
		pattern:
			/\b(?:each\s+frame|every\s+frame|read\s+(?:a\s+|the\s+|each\s+|every\s+)?frames?|frame\s+by\s+frame|across\s+(?:the\s+)?frames?)\b/i,
	},
	{
		id: "about-video",
		pattern:
			/\b(?:what\s+about\s+(?:this\s+|the\s+|my\s+)?(?:video|recording|it)|guide\s+me\s+(?:about|on|through)\s+(?:this\s+|the\s+|my\s+)?(?:video|recording|it)|tell\s+me\s+about\s+(?:this\s+|the\s+|my\s+)?(?:video|recording))\b/i,
	},
	{
		id: "visual-edit-cues",
		pattern:
			/\b(?:button|screen\b|ui\b|framing|zoom\s+into|focus\s+on|professional|improve\s+visually|animation|where\s+i\s+click|layout|look(?:s|ing)?\b|visual(?:ly)?|dashboard|panel|dialog|modal|reframe|composition|compose|blur\b|highlight|on[\s-]?screen|click(?:ed|ing)?\s+(?:the\s+)?\w+|cursor\s+click)\b/i,
	},
];

/** Production gate: same answer as `classifyMediaContextNeeds(...).visual`. */
export function promptWantsVisualEvidence(userMessage: string): boolean {
	return classifyMediaContextNeeds(userMessage).visual;
}

/** Test/diagnostic helper — which legacy family fired (or null). */
export function matchedVisualIntentFamily(userMessage: string): string | null {
	const text = userMessage.trim();
	if (!text) return null;
	if (METADATA_ONLY_PATTERN.test(text)) return null;
	if (
		/^(?:delete|cut|trim|remove)\b/i.test(text) &&
		/\d/.test(text) &&
		!VISUAL_INTENT_FAMILIES.some((f) => f.pattern.test(text))
	) {
		return null;
	}
	for (const family of VISUAL_INTENT_FAMILIES) {
		if (family.pattern.test(text)) return family.id;
	}
	return null;
}
