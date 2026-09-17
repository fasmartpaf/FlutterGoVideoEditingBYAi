/**
 * Direct TRANSITION mutations (0 LLM).
 * Registry SSOT — USER_AVAILABLE transitions via setClipIncomingTransition.
 * Transitions belong to a JOIN (non-first timeline clip).
 * ZOOM / TRIM / SPEED / CAPTIONS / TITLE / CALLOUT are frozen.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { executeAgentTool } from "../agent-tools";
import {
	getTransitionById,
	listUserAvailableTransitions,
	resolveTransitionPhrase,
} from "../transitionLibrary";
import type { LocalEditorialRequestV1 } from "./types";

export const DEFAULT_DISSOLVE_HALF_SEC = 0.35;
const DURATION_LADDER = [0.15, 0.25, 0.35, 0.5, 0.7, 1.0, 1.4] as const;

export type TransitionKind = "cut" | "dissolve";
export type TransitionStyleOp =
	| "shorter"
	| "longer"
	| "quicker"
	| "slower"
	| "to_dissolve"
	| "to_cut"
	| "to_fade"
	| "other_direction"
	| "list_available";

type Clip = AxcutDocument["timeline"]["clips"][number];

function legacyBlob(doc: AxcutDocument): Record<string, unknown> {
	return { ...((doc.legacyEditor as Record<string, unknown> | null) ?? {}) };
}

function transitionClipIds(doc: AxcutDocument): string[] {
	const raw = legacyBlob(doc).transitionClipIds;
	return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

function withTransitionClipIds(doc: AxcutDocument, ids: string[]): AxcutDocument {
	const legacy = legacyBlob(doc);
	return {
		...doc,
		legacyEditor: { ...legacy, transitionClipIds: [...new Set(ids)] },
	};
}

function currentTransitionId(clip: Clip): string {
	const t = clip.incomingTransition;
	if (t?.transitionId) return t.transitionId;
	if (t?.kind === "cut") return "openscreen.cut";
	return "openscreen.dissolve";
}

/** Non-first clips = authorable joins, ordered by programme timeline start. */
export function listTransitionJoins(doc: AxcutDocument): Array<{
	clip: Clip;
	clipIndex: number;
	programmeJoinSec: number;
	kind: TransitionKind;
	durationSec: number;
	transitionId: string;
}> {
	const clips = doc.timeline?.clips ?? [];
	const out: Array<{
		clip: Clip;
		clipIndex: number;
		programmeJoinSec: number;
		kind: TransitionKind;
		durationSec: number;
		transitionId: string;
	}> = [];
	for (let i = 1; i < clips.length; i++) {
		const clip = clips[i]!;
		const t = clip.incomingTransition;
		const transitionId = currentTransitionId(clip);
		const kind: TransitionKind =
			transitionId === "openscreen.cut" || t?.kind === "cut" ? "cut" : "dissolve";
		const durationSec = kind === "cut" ? 0 : (t?.durationSec ?? DEFAULT_DISSOLVE_HALF_SEC);
		out.push({
			clip,
			clipIndex: i,
			programmeJoinSec: clip.timelineStartSec,
			kind,
			durationSec,
			transitionId,
		});
	}
	return out.sort((a, b) => a.programmeJoinSec - b.programmeJoinSec);
}

export function extractTransitionKind(raw: string): TransitionKind | null {
	const n = raw.toLowerCase();
	if (/\bdissolve\b|\bcross\s*-?\s*fade\b|\bcrossfade\b/.test(n)) return "dissolve";
	if (/\bfade\b/.test(n) && !/\bfade\s+to\s+black\b/.test(n)) return "dissolve";
	if (/\bsmoother\b|\bsoft(?:er|en)\b|\bsubtle\s+transition\b/.test(n)) return "dissolve";
	if (/\bhard\s+cuts?\b/.test(n) || /\b(?:to\s+(?:a\s+)?)cuts?\b/.test(n)) return "cut";
	return null;
}

export function extractTransitionStyleOp(normalized: string): TransitionStyleOp | null {
	const n = normalized.toLowerCase();
	if (
		/\bwhat\s+transitions?\s+(?:are\s+)?available\b/.test(n) ||
		/\blist\s+transitions?\b/.test(n)
	) {
		return "list_available";
	}
	if (/\bother\s+direction\b|\bopposite\s+direction\b|\bflip\s+(?:the\s+)?direction\b/.test(n)) {
		return "other_direction";
	}
	if (/\b(?:to\s+(?:a\s+)?)?dissolves?\b/.test(n) || /\bchange\b.+\bdissolve\b/.test(n)) {
		return "to_dissolve";
	}
	if (/\b(?:to\s+(?:a\s+)?)?cuts?\b/.test(n) || /\bhard\s+cut\b/.test(n)) return "to_cut";
	if (/\b(?:to\s+(?:a\s+)?)?fades?\b/.test(n) && !/\bfade\s+to\s+black\b/.test(n)) {
		return "to_fade";
	}
	if (/\b(?:shorter|quicker|faster|snappier)\b/.test(n)) return "shorter";
	if (/\b(?:longer|slower|more\s+gradual|smoother)\b/.test(n)) return "longer";
	return null;
}

function nextDuration(current: number, dir: "up" | "down"): number {
	if (dir === "up") {
		return DURATION_LADDER.find((s) => s > current + 0.02) ?? Math.min(2, current + 0.15);
	}
	const down = [...DURATION_LADDER].reverse().find((s) => s < current - 0.02);
	return down ?? Math.max(0.1, current - 0.1);
}

function flipDirectionId(id: string): string | null {
	const map: Record<string, string> = {
		"gl.wipeLeft": "gl.wipeRight",
		"gl.wipeRight": "gl.wipeLeft",
		"gl.wipeUp": "gl.wipeDown",
		"gl.wipeDown": "gl.wipeUp",
		"gl.slideLeft": "gl.slideRight",
		"gl.slideRight": "gl.slideLeft",
	};
	return map[id] ?? null;
}

function resolveJoinTarget(
	doc: AxcutDocument,
	request: LocalEditorialRequestV1,
):
	| { clipId: string; programmeJoinSec: number; clipIndex: number }
	| { error: string }
	| { ambiguous: string } {
	const joins = listTransitionJoins(doc);
	if (joins.length === 0) {
		return {
			error:
				"There isn't a clip join to put a transition on — transitions apply between clips, not mid-clip on a single continuous recording.",
		};
	}
	const raw = request.rawText.toLowerCase();
	if (/\b(?:first|opening)\s+transition\b/.test(raw) || /\bbetween\s+(?:clip\s+)?1\b/.test(raw)) {
		return {
			clipId: joins[0]!.clip.id,
			programmeJoinSec: joins[0]!.programmeJoinSec,
			clipIndex: joins[0]!.clipIndex,
		};
	}
	if (/\b(?:second)\s+transition\b/.test(raw) && joins.length >= 2) {
		return {
			clipId: joins[1]!.clip.id,
			programmeJoinSec: joins[1]!.programmeJoinSec,
			clipIndex: joins[1]!.clipIndex,
		};
	}
	if (/\b(?:last|ending|final)\s+transition\b/.test(raw)) {
		const j = joins[joins.length - 1]!;
		return {
			clipId: j.clip.id,
			programmeJoinSec: j.programmeJoinSec,
			clipIndex: j.clipIndex,
		};
	}
	const between = raw.match(/\bbetween\s+clip\s+(\d+)\s+and\s+(?:clip\s+)?(\d+)/i);
	if (between) {
		const right = Number(between[2]);
		const j = joins.find((x) => x.clipIndex === right - 1 || x.clipIndex === right);
		if (j) {
			return {
				clipId: j.clip.id,
				programmeJoinSec: j.programmeJoinSec,
				clipIndex: j.clipIndex,
			};
		}
	}
	// "around 10 seconds" / nearTimestamp from parse → nearest join
	const nearSec =
		request.range?.nearTimestamp || request.range?.singleTimestamp ? request.range.startSec : null;
	if (nearSec != null && Number.isFinite(nearSec)) {
		let best = joins[0]!;
		let bestDist = Math.abs(best.programmeJoinSec - nearSec);
		for (const j of joins) {
			const d = Math.abs(j.programmeJoinSec - nearSec);
			if (d < bestDist) {
				best = j;
				bestDist = d;
			}
		}
		return {
			clipId: best.clip.id,
			programmeJoinSec: best.programmeJoinSec,
			clipIndex: best.clipIndex,
		};
	}
	// Document-grounded: last authored transition clip, else sole join, else nearest to playhead.
	const remembered = transitionClipIds(doc);
	if (remembered.length > 0) {
		const lastId = remembered[remembered.length - 1]!;
		const j = joins.find((x) => x.clip.id === lastId);
		if (j) {
			return {
				clipId: j.clip.id,
				programmeJoinSec: j.programmeJoinSec,
				clipIndex: j.clipIndex,
			};
		}
	}
	if (joins.length === 1) {
		return {
			clipId: joins[0]!.clip.id,
			programmeJoinSec: joins[0]!.programmeJoinSec,
			clipIndex: joins[0]!.clipIndex,
		};
	}
	const playhead =
		typeof request.playheadProgrammeSec === "number" ? request.playheadProgrammeSec : null;
	if (playhead != null && Number.isFinite(playhead)) {
		let best = joins[0]!;
		let bestDist = Math.abs(best.programmeJoinSec - playhead);
		for (const j of joins) {
			const d = Math.abs(j.programmeJoinSec - playhead);
			if (d < bestDist) {
				best = j;
				bestDist = d;
			}
		}
		if (bestDist <= 2.5) {
			return {
				clipId: best.clip.id,
				programmeJoinSec: best.programmeJoinSec,
				clipIndex: best.clipIndex,
			};
		}
	}
	// Prefer a join that already has a non-cut transition (follow-up "make that longer").
	const active = joins.filter((j) => j.transitionId !== "openscreen.cut");
	if (active.length === 1) {
		return {
			clipId: active[0]!.clip.id,
			programmeJoinSec: active[0]!.programmeJoinSec,
			clipIndex: active[0]!.clipIndex,
		};
	}
	return {
		ambiguous:
			"There are several clip joins — say which one (for example “first transition” or “between clip 1 and 2”).",
	};
}

function applyTransitionId(args: {
	document: AxcutDocument;
	clipId: string;
	transitionId: string;
	durationSec?: number;
}): ReturnType<typeof executeAgentTool> {
	return executeAgentTool(
		args.document,
		"setClipIncomingTransition",
		JSON.stringify({
			clipId: args.clipId,
			transitionId: args.transitionId,
			...(args.transitionId === "openscreen.cut"
				? {}
				: { durationSec: args.durationSec ?? DEFAULT_DISSOLVE_HALF_SEC }),
		}),
		{ editsAllowed: true },
	);
}

export function applyDirectTransitionAdd(args: {
	document: AxcutDocument;
	request: LocalEditorialRequestV1;
}): {
	document: AxcutDocument;
	mutated: boolean;
	userFacingText: string;
	families: string[];
} {
	const listOp = extractTransitionStyleOp(args.request.rawText.toLowerCase());
	if (listOp === "list_available") {
		const names = listUserAvailableTransitions("metal").map((e) => e.displayName);
		return {
			document: args.document,
			mutated: false,
			userFacingText: `Available transitions: ${names.join(", ")}.`,
			families: ["transitions"],
		};
	}

	const target = resolveJoinTarget(args.document, args.request);
	if ("error" in target) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: target.error,
			families: [],
		};
	}
	if ("ambiguous" in target) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: target.ambiguous,
			families: [],
		};
	}

	const resolved = resolveTransitionPhrase(args.request.rawText, "metal");
	let transitionId = "openscreen.dissolve";
	if (resolved.status === "resolved") {
		transitionId = resolved.transitionId;
	} else if (resolved.status === "ambiguous") {
		return {
			document: args.document,
			mutated: false,
			userFacingText: resolved.message,
			families: [],
		};
	} else if (resolved.status === "unsupported") {
		const kind = extractTransitionKind(args.request.rawText);
		if (kind === "cut") transitionId = "openscreen.cut";
		else if (kind === "dissolve") transitionId = "openscreen.dissolve";
		else {
			return {
				document: args.document,
				mutated: false,
				userFacingText: resolved.message,
				families: [],
			};
		}
	} else {
		const kind =
			args.request.transitionKind ?? extractTransitionKind(args.request.rawText) ?? "dissolve";
		transitionId = kind === "cut" ? "openscreen.cut" : "openscreen.dissolve";
	}

	const durationSec =
		transitionId === "openscreen.cut"
			? 0
			: (args.request.transitionDurationSec ?? DEFAULT_DISSOLVE_HALF_SEC);
	const result = applyTransitionId({
		document: args.document,
		clipId: target.clipId,
		transitionId,
		durationSec,
	});
	if (!result.ok || !result.document) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: result.summary || "I couldn't set that transition.",
			families: [],
		};
	}
	const ids = [...transitionClipIds(args.document), target.clipId];
	const doc = withTransitionClipIds(result.document, ids);
	const entry = getTransitionById(transitionId);
	const durNote = transitionId === "openscreen.cut" ? "" : ` (${durationSec.toFixed(2)}s)`;
	return {
		document: doc,
		mutated: true,
		userFacingText: `I set ${entry?.displayName ?? transitionId} at the join near ${target.programmeJoinSec.toFixed(1)}s${durNote}.`,
		families: ["transitions"],
	};
}

export function applyDirectTransitionRemove(args: {
	document: AxcutDocument;
	request: LocalEditorialRequestV1;
}): {
	document: AxcutDocument;
	mutated: boolean;
	userFacingText: string;
	families: string[];
} {
	const target = resolveJoinTarget(args.document, args.request);
	if ("error" in target) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: target.error,
			families: [],
		};
	}
	if ("ambiguous" in target) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: target.ambiguous,
			families: [],
		};
	}
	const result = applyTransitionId({
		document: args.document,
		clipId: target.clipId,
		transitionId: "openscreen.cut",
	});
	if (!result.ok || !result.document) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: result.summary || "I couldn't remove that transition.",
			families: [],
		};
	}
	const ids = transitionClipIds(args.document).filter((id) => id !== target.clipId);
	const doc = withTransitionClipIds(result.document, ids);
	return {
		document: doc,
		mutated: true,
		userFacingText: `I removed the transition at ${target.programmeJoinSec.toFixed(1)}s (hard cut).`,
		families: ["transitions"],
	};
}

export function applyDirectTransitionAdjust(args: {
	document: AxcutDocument;
	request: LocalEditorialRequestV1;
}): {
	document: AxcutDocument;
	mutated: boolean;
	userFacingText: string;
	families: string[];
} {
	const listOp = extractTransitionStyleOp(args.request.rawText.toLowerCase());
	if (listOp === "list_available") {
		const names = listUserAvailableTransitions("metal").map((e) => e.displayName);
		return {
			document: args.document,
			mutated: false,
			userFacingText: `Available transitions: ${names.join(", ")}.`,
			families: ["transitions"],
		};
	}

	const target = resolveJoinTarget(args.document, args.request);
	if ("error" in target) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: target.error,
			families: [],
		};
	}
	if ("ambiguous" in target) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: target.ambiguous,
			families: [],
		};
	}
	const joins = listTransitionJoins(args.document);
	const current = joins.find((j) => j.clip.id === target.clipId)!;
	const op =
		args.request.transitionStyleOp ?? extractTransitionStyleOp(args.request.rawText.toLowerCase());
	const kindFromText = args.request.transitionKind ?? extractTransitionKind(args.request.rawText);

	let transitionId = current.transitionId;
	let durationSec = current.durationSec || DEFAULT_DISSOLVE_HALF_SEC;
	let receipt = "";

	// Prefer registry phrase resolution for replace ("change to wipe left").
	const phrase = resolveTransitionPhrase(args.request.rawText, "metal");
	const looksLikeReplace =
		/\b(change|switch|use|to|try|replace)\b/i.test(args.request.rawText) ||
		/\bwipe\b|\bslide\b|\bfade\s+black\b|\bdissolve\b/i.test(args.request.rawText);

	if (op === "other_direction") {
		const flipped = flipDirectionId(current.transitionId);
		if (!flipped) {
			return {
				document: args.document,
				mutated: false,
				userFacingText: "That transition doesn't have an opposite direction.",
				families: [],
			};
		}
		transitionId = flipped;
		receipt = `I flipped the direction to ${getTransitionById(flipped)?.displayName ?? flipped}.`;
	} else if (op === "to_cut" || kindFromText === "cut") {
		transitionId = "openscreen.cut";
		durationSec = 0;
		receipt = `I changed the transition at ${target.programmeJoinSec.toFixed(1)}s to a hard cut.`;
	} else if (
		phrase.status === "resolved" &&
		looksLikeReplace &&
		phrase.transitionId !== current.transitionId
	) {
		transitionId = phrase.transitionId;
		if (transitionId === "openscreen.cut") durationSec = 0;
		receipt = `I changed the transition to ${phrase.entry.displayName}.`;
	} else if (phrase.status === "ambiguous" && looksLikeReplace) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: phrase.message,
			families: [],
		};
	} else if (op === "to_dissolve" || op === "to_fade" || kindFromText === "dissolve") {
		transitionId = op === "to_fade" ? "gl.fade" : "openscreen.dissolve";
		durationSec = Math.max(durationSec, DEFAULT_DISSOLVE_HALF_SEC);
		receipt = `I changed the transition at ${target.programmeJoinSec.toFixed(1)}s to ${getTransitionById(transitionId)?.displayName ?? transitionId}.`;
	} else if (op === "shorter" || op === "quicker") {
		if (transitionId === "openscreen.cut") transitionId = "openscreen.dissolve";
		durationSec = nextDuration(durationSec || DEFAULT_DISSOLVE_HALF_SEC, "down");
		receipt = `I made the transition shorter (${durationSec.toFixed(2)}s).`;
	} else if (op === "longer" || op === "slower") {
		if (transitionId === "openscreen.cut") transitionId = "openscreen.dissolve";
		durationSec = nextDuration(durationSec || DEFAULT_DISSOLVE_HALF_SEC, "up");
		receipt = `I made the transition longer (${durationSec.toFixed(2)}s).`;
	} else if (args.request.transitionDurationSec != null) {
		if (transitionId === "openscreen.cut") transitionId = "openscreen.dissolve";
		durationSec = Math.min(2, Math.max(0.1, args.request.transitionDurationSec));
		receipt = `I set the transition to ${durationSec.toFixed(2)}s.`;
	} else if (phrase.status === "resolved") {
		transitionId = phrase.transitionId;
		receipt = `I set ${phrase.entry.displayName} at ${target.programmeJoinSec.toFixed(1)}s.`;
	} else {
		return {
			document: args.document,
			mutated: false,
			userFacingText:
				"I need a clearer transition change (for example “make it shorter” or “change it to wipe left”).",
			families: [],
		};
	}

	const result = applyTransitionId({
		document: args.document,
		clipId: target.clipId,
		transitionId,
		durationSec,
	});
	if (!result.ok || !result.document) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: result.summary || "I couldn't adjust that transition.",
			families: [],
		};
	}
	const ids = [...transitionClipIds(args.document), target.clipId];
	return {
		document: withTransitionClipIds(result.document, ids),
		mutated: true,
		userFacingText: receipt,
		families: ["transitions"],
	};
}
