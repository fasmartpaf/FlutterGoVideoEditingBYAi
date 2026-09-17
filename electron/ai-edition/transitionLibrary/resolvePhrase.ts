/**
 * Resolve a user phrase to Transition Registry id(s).
 * Compositional — displayName / tags / category / aliases — not phrase enumeration.
 * LOCAL ONLY. No cloud.
 */

import {
	type GpuBackend,
	getTransitionById,
	listUserAvailableTransitions,
	type TransitionRegistryEntry,
} from "./registry";

const ALIASES: Record<string, string[]> = {
	"openscreen.cut": ["cut", "hard cut", "no transition", "remove transition"],
	"openscreen.dissolve": ["dissolve", "crossfade", "cross fade", "cross-fade"],
	"gl.fade": ["fade", "fade transition"],
	"gl.dissolve": ["gl dissolve"],
	"gl.wipeLeft": ["wipe left", "left wipe", "wipe to the left", "wipe to left"],
	"gl.wipeRight": ["wipe right", "right wipe", "wipe to the right", "wipe to right"],
	"gl.wipeUp": ["wipe up", "up wipe"],
	"gl.wipeDown": ["wipe down", "down wipe"],
	"gl.slideLeft": ["slide left", "left slide", "slide to the left"],
	"gl.slideRight": ["slide right", "right slide", "slide to the right"],
	"gl.fadeblack": ["fade black", "fade to black", "dip to black"],
};

function normalizePhrase(raw: string): string {
	return raw
		.toLowerCase()
		.replace(/[_\-/]+/g, " ")
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function tokens(phrase: string): string[] {
	return normalizePhrase(phrase).split(" ").filter(Boolean);
}

function scoreEntry(entry: TransitionRegistryEntry, phrase: string, toks: string[]): number {
	const n = normalizePhrase(phrase);
	const name = normalizePhrase(entry.displayName);
	const idTail = entry.id.replace(/^gl\.|^openscreen\./, "").toLowerCase();
	let score = 0;
	if (n === name || n === normalizePhrase(idTail)) score += 100;
	if (name.includes(n) || n.includes(name)) score += 40;
	const aliases = ALIASES[entry.id] ?? [];
	for (const a of aliases) {
		const an = normalizePhrase(a);
		if (n === an) score += 90;
		else if (n.includes(an) || an.includes(n)) score += 35;
	}
	for (const tag of entry.tags) {
		const tn = normalizePhrase(tag);
		if (toks.includes(tn) || n.includes(tn)) score += 12;
	}
	const cat = normalizePhrase(entry.category);
	if (toks.includes(cat) || n.includes(cat)) score += 8;
	// Direction composition: "wipe" + "left" → wipeLeft
	const wantsWipe = toks.includes("wipe");
	const wantsSlide = toks.includes("slide");
	const wantsLeft = toks.includes("left");
	const wantsRight = toks.includes("right");
	const wantsUp = toks.includes("up");
	const wantsDown = toks.includes("down");
	if (wantsWipe && entry.category === "wipe") score += 20;
	if (wantsSlide && entry.category === "movement") score += 20;
	if (wantsLeft && /left/i.test(entry.id + entry.displayName)) score += 25;
	if (wantsRight && /right/i.test(entry.id + entry.displayName)) score += 25;
	if (wantsUp && /up/i.test(entry.id + entry.displayName)) score += 25;
	if (wantsDown && /down/i.test(entry.id + entry.displayName)) score += 25;
	return score;
}

export type TransitionPhraseResolution =
	| { status: "resolved"; transitionId: string; entry: TransitionRegistryEntry }
	| { status: "ambiguous"; candidates: TransitionRegistryEntry[]; message: string }
	| { status: "unsupported"; message: string }
	| { status: "none" };

/**
 * Resolve user language to a USER_AVAILABLE transition for the active GPU backend.
 */
export function resolveTransitionPhrase(
	raw: string,
	backend: GpuBackend = "metal",
): TransitionPhraseResolution {
	const phrase = normalizePhrase(raw);
	if (!phrase) return { status: "none" };
	// Strip command noise so "use wipe left here" still scores.
	const stripped = phrase
		.replace(
			/\b(add|use|put|apply|set|change|make|to|a|an|the|this|that|transition|between|clips?|here|please)\b/g,
			" ",
		)
		.replace(/\s+/g, " ")
		.trim();
	const query = stripped.length >= 2 ? stripped : phrase;
	const toks = tokens(query);
	const pool = listUserAvailableTransitions(backend);
	const ranked = pool
		.map((entry) => ({ entry, score: scoreEntry(entry, query, toks) }))
		.filter((x) => x.score >= 25)
		.sort((a, b) => b.score - a.score);
	if (ranked.length === 0) {
		// Explicit cut / remove language
		if (/\b(cut|hard cut|no transition|remove)\b/.test(phrase)) {
			const cut = getTransitionById("openscreen.cut");
			if (cut) return { status: "resolved", transitionId: cut.id, entry: cut };
		}
		return {
			status: "unsupported",
			message: `I don't have a transition matching “${raw.trim()}” on this GPU backend.`,
		};
	}
	const top = ranked[0]!;
	const near = ranked.filter((x) => x.score >= top.score - 10);
	if (near.length > 1 && near[1]!.score === top.score) {
		return {
			status: "ambiguous",
			candidates: near.map((x) => x.entry),
			message: `Which transition did you mean? ${near.map((x) => x.entry.displayName).join(", ")}`,
		};
	}
	return { status: "resolved", transitionId: top.entry.id, entry: top.entry };
}

/** Lightweight local search over displayName / category / tags. */
export function searchTransitions(
	query: string,
	backend: GpuBackend = "metal",
): TransitionRegistryEntry[] {
	const q = normalizePhrase(query);
	const pool = listUserAvailableTransitions(backend);
	if (!q) return pool;
	const toks = tokens(q);
	return pool
		.map((entry) => ({
			entry,
			score: scoreEntry(entry, q, toks),
			hay: normalizePhrase(entryHaystack(entry)),
		}))
		.filter((x) => x.score > 0 || x.hay.includes(q))
		.sort((a, b) => b.score - a.score)
		.map((x) => x.entry);
}

function entryHaystack(entry: TransitionRegistryEntry): string {
	return [entry.displayName, entry.category, ...entry.tags, entry.id].join(" ");
}
