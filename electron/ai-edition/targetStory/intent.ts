/**
 * Lightweight editing-intent hints from the user message — deterministic, no LLM.
 * Guides the Target Story prompt; the model still produces the full Target Story.
 *
 * Recovery 4: compound intents (e.g. shorter + keep important explanation) must
 * retain the primary editorial objective; preservation wording is a constraint,
 * not a cancel of shorten/polish.
 */

import type { EditingIntent, TargetStoryObjectiveKind } from "./types";

export function inferEditingIntentHints(userMessage: string): EditingIntent {
	const text = userMessage.trim();
	const lower = text.toLowerCase();

	const wantsShorten =
		/\bmuch\s+more\s+concise\b|\bmake\s+this\s+(?:video\s+|recording\s+)?(?:much\s+)?shorter\b|\bshorten\b|\btighten\b|\bremove\s+(?:the\s+)?(?:unnecessary\s+)?(?:pauses?|silences?|dead\s+air)\b|\bcut\s+(?:the\s+)?(?:pauses?|boring)\b/i.test(
			text,
		);
	const wantsPolish =
		/\bpolish|professional|presentable|product\s+demo|tutorial|demo\b|\bmake\s+this\s+(?:video\s+|recording\s+)?(?:look\s+)?(?:more\s+)?(?:pro\b|engaging|cleaner|clean)\b|\bimprove\s+this\b|\bsafe\s+edits?\b/i.test(
			text,
		);
	const wantsClarify =
		/\beasier\s+to\s+follow|clarif|clearer\b|\bwithout\s+removing\s+the\s+important\b/i.test(text);
	const keepEverything =
		/\bkeep\s+(?:almost\s+)?everything\b|\bdo\s+not\s+remove\b|\bdon'?t\s+remove\b|\bdon'?t\s+over[\s-]?edit\b|\bwithout\s+over[\s-]?edit\b/i.test(
			text,
		);
	/** Preserve important meaning while still allowing compression of low-value material. */
	const preserveImportant =
		/\bkeep\s+(?:the\s+)?(?:useful\s+|important\s+)?explanation\b|\bwithout\s+removing\s+the\s+important\b|\bpreserve\s+(?:the\s+)?(?:important|meaning|explanation)\b|\bkeep\s+(?:the\s+)?(?:final\s+)?(?:conclusion|corrected)\b/i.test(
			text,
		);

	const constraints: string[] = [];
	if (keepEverything) {
		constraints.push("do not remove / do not over-edit; preserve content");
	}
	if (preserveImportant || wantsClarify) {
		constraints.push("preserve important spoken explanation / meaning-bearing content");
	}
	if (wantsShorten) {
		constraints.push("prioritize brevity while keeping important explanation");
	}

	const desiredQualities: string[] = [];
	if (wantsPolish || /\bclear|easy(?:ier)?\s+to\s+follow|deliberate\b/i.test(text)) {
		desiredQualities.push("clarity", "intentional pacing", "easy-to-follow progression");
	}
	if (wantsShorten || /\bconcise|brief\b/i.test(text)) {
		desiredQualities.push("brevity", "essential explanation");
	}
	if (/\benergetic|social\s+media|hook|engaging\b/i.test(text)) {
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
	} else if (wantsShorten && !keepEverything) {
		// "without removing the important explanation" must NOT cancel shorten.
		objective = "shorten";
	} else if (/\bfocus|attention\s+on\b/i.test(text) && !wantsPolish && !wantsShorten) {
		objective = "focus";
	} else if (wantsClarify && !wantsPolish && !wantsShorten) {
		objective = "clarify";
	} else if (wantsPolish) {
		objective = "polish";
	} else if (
		/\bsafe\s+edits?|what\s+would\s+you\s+(?:change|propose)|what\s+should\s+i\s+change\b/i.test(
			text,
		)
	) {
		objective = "polish";
	}

	const preserveMeaning =
		preserveImportant ||
		keepEverything ||
		/\bkeep\b|\bpreserve\b/i.test(lower) ||
		objective === "clarify" ||
		objective === "polish" ||
		objective === "shorten";

	return {
		objective,
		constraints: [...new Set(constraints)],
		desiredQualities: [...new Set(desiredQualities)],
		preserveMeaning,
	};
}
