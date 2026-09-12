/**
 * Lightweight editing-intent hints from the user message — deterministic, no LLM.
 * Guides the Target Story prompt; the model still produces the full Target Story.
 */

import type { EditingIntent, TargetStoryObjectiveKind } from "./types";

export function inferEditingIntentHints(userMessage: string): EditingIntent {
	const text = userMessage.trim();
	const lower = text.toLowerCase();

	const constraints: string[] = [];
	if (
		/\bdo\s+not\s+remove\b|\bdon'?t\s+remove\b|\bkeep\s+(?:almost\s+)?everything\b|\bkeep\s+every\b|\bwithout\s+(?:over[\s-]?edit|removing)\b|\bdon'?t\s+over[\s-]?edit\b/i.test(
			text,
		)
	) {
		constraints.push("do not remove / do not over-edit; preserve content");
	}
	if (
		/\bkeep\s+(?:the\s+)?(?:useful\s+)?explanation\b|\bkeep\s+every\s+spoken\b|\bkeep\s+(?:all\s+)?spoken\b/i.test(
			text,
		)
	) {
		constraints.push("preserve spoken explanation");
	}
	if (/\bmuch\s+more\s+concise\b|\bmake\s+this\s+(?:much\s+)?shorter\b|\bshorten\b/i.test(text)) {
		constraints.push("prioritize brevity while keeping important explanation");
	}

	const desiredQualities: string[] = [];
	if (/\bpolish|professional|tutorial|clear|easy(?:ier)?\s+to\s+follow|deliberate\b/i.test(text)) {
		desiredQualities.push("clarity", "intentional pacing", "easy-to-follow progression");
	}
	if (/\bconcise|shorter|tighten|brief\b/i.test(text)) {
		desiredQualities.push("brevity", "essential explanation");
	}
	if (/\benergetic|social\s+media|hook\b/i.test(text)) {
		desiredQualities.push("faster entry", "higher pacing");
	}
	if (desiredQualities.length === 0) {
		desiredQualities.push("clear progression");
	}

	let objective: TargetStoryObjectiveKind = "custom";
	if (/\btestimonial|customer\s+story|product\s+launch\b/i.test(text)) {
		objective = "repurpose";
	} else if (/\brestructure|reorder|rearrange\b/i.test(text)) {
		objective = "restructure";
	} else if (
		/\bmuch\s+more\s+concise\b|\bmake\s+this\s+(?:much\s+)?shorter\b|\bshorten\b|\btighten\b/i.test(
			text,
		) &&
		!/\bkeep\s+(?:almost\s+)?everything\b|\bdo\s+not\s+remove\b/i.test(text)
	) {
		objective = "shorten";
	} else if (/\bfocus|attention\s+on\b/i.test(text)) {
		objective = "focus";
	} else if (
		/\beasier\s+to\s+follow|clarif|clearer\b/i.test(text) &&
		!/\bpolish|professional\b/i.test(text)
	) {
		objective = "clarify";
	} else if (/\bpolish|professional|tutorial|demo\b/i.test(text)) {
		objective = "polish";
	}

	const preserveMeaning =
		/\bkeep\b|\bpreserve\b|\bdon'?t\s+remove\b|\bdo\s+not\s+remove\b|\bwithout\s+over[\s-]?edit/i.test(
			lower,
		) ||
		objective === "clarify" ||
		objective === "polish";

	return {
		objective,
		constraints,
		desiredQualities: [...new Set(desiredQualities)],
		preserveMeaning,
	};
}
