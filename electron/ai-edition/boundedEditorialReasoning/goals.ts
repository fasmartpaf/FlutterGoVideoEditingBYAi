/**
 * Deterministic goal normalization — no LLM for obvious intents.
 */

import type { EditorialGoalKind } from "./types";

export function normalizeEditorialGoal(text: string): {
	goal: EditorialGoalKind;
	matchedPhrase?: string;
} {
	const t = text.trim().toLowerCase();
	if (!t) return { goal: "CUSTOM_TEXT" };

	const professional = [
		"make this professional",
		"make it look professional",
		"make this more professional",
		"polish this",
		"polish this recording",
		"make it professional",
		"professionalize",
	];
	for (const p of professional) {
		if (t.includes(p) || t === "professional" || t.includes("more professional")) {
			return { goal: "MAKE_PROFESSIONAL", matchedPhrase: p };
		}
	}

	const tighter = [
		"make this shorter",
		"make it shorter",
		"tighten this",
		"tighten this up",
		"make this tighter",
		"cut the dead air",
		"remove pauses",
		"shorten this",
	];
	for (const p of tighter) {
		if (t.includes(p)) return { goal: "MAKE_TIGHTER", matchedPhrase: p };
	}

	if (
		t.includes("caption") ||
		t.includes("subtitle") ||
		t.includes("accessibility") ||
		t.includes("hard of hearing")
	) {
		return { goal: "IMPROVE_ACCESSIBILITY", matchedPhrase: "captions/accessibility" };
	}

	if (
		t.includes("clarity") ||
		t.includes("clearer") ||
		t.includes("easier to follow") ||
		t.includes("louder") ||
		t.includes("volume")
	) {
		return { goal: "IMPROVE_CLARITY", matchedPhrase: "clarity" };
	}

	return { goal: "CUSTOM_TEXT" };
}
