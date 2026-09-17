/**
 * Direct TITLE / TEXT OVERLAY mutations (0 LLM).
 * Titles are addGraphic → annotations[] text regions.
 * Tracked via legacyEditor.titleOverlayIds so captions stay untouched.
 * User times are CURRENT PROGRAMME time (map via programmeToRawSec).
 * ZOOM / TRIM / SPEED / CAPTIONS are frozen.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { executeAgentTool } from "../agent-tools";
import { programmeDurationWithSpeed, programmeToRawSec } from "./directSpeed";
import type { LocalEditorialRequestV1 } from "./types";

/** Default on-screen duration when user omits timing (product default). */
export const DEFAULT_TITLE_DURATION_SEC = 3;

const TITLE_SIZE_LADDER = [28, 36, 44, 52, 60, 72, 96] as const;
const Y_STEP = 4;
const TIME_STEP_SEC = 0.5;

export type TitleStyleOp =
	| "bigger"
	| "smaller"
	| "higher"
	| "lower"
	| "center"
	| "top"
	| "longer"
	| "shorter"
	| "earlier"
	| "later";

type TitleAnn = AxcutDocument["annotations"][number];

function legacyBlob(doc: AxcutDocument): Record<string, unknown> {
	return { ...((doc.legacyEditor as Record<string, unknown> | null) ?? {}) };
}

function titleIds(doc: AxcutDocument): string[] {
	const legacy = legacyBlob(doc);
	const raw = legacy.titleOverlayIds;
	return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

function withTitleIds(doc: AxcutDocument, ids: string[]): AxcutDocument {
	const legacy = legacyBlob(doc);
	return {
		...doc,
		legacyEditor: { ...legacy, titleOverlayIds: [...new Set(ids)] },
	};
}

function annText(a: TitleAnn): string {
	return String(a.textContent ?? a.content ?? "").trim();
}

function isCaptionAnn(a: TitleAnn): boolean {
	return (a as { annotationSource?: string }).annotationSource === "auto-caption";
}

/** Title overlays: tracked ids first, then heuristic text (never captions). */
export function listTitleAnnotations(doc: AxcutDocument): TitleAnn[] {
	const anns = doc.annotations ?? [];
	const tracked = new Set(titleIds(doc));
	const byId = anns.filter((a) => tracked.has(a.id) && a.type === "text" && !isCaptionAnn(a));
	if (byId.length > 0) return byId;
	return anns.filter(
		(a) =>
			a.type === "text" &&
			!isCaptionAnn(a) &&
			annText(a).length > 0 &&
			(a.style?.fontSize ?? 0) >= 32 &&
			(a.position?.y ?? 100) <= 40,
	);
}

function nextSize(current: number, dir: "up" | "down"): number {
	if (dir === "up") {
		return (
			TITLE_SIZE_LADDER.find((s) => s > current + 0.5) ?? Math.min(120, Math.round(current * 1.15))
		);
	}
	const down = [...TITLE_SIZE_LADDER].reverse().find((s) => s < current - 0.5);
	return down ?? Math.max(18, Math.round(current * 0.85));
}

function programmeDur(doc: AxcutDocument): number {
	return programmeDurationWithSpeed(doc);
}

function resolveProgrammeSpan(
	doc: AxcutDocument,
	request: LocalEditorialRequestV1,
): { startSec: number; endSec: number } | { error: string } {
	const dur = programmeDur(doc);
	if (!(dur > 0.05)) {
		return { error: "There isn't enough timeline media to place a title yet." };
	}
	const placement = request.titlePlacement;
	if (request.range && !request.range.singleTimestamp && !request.range.nearTimestamp) {
		let start = Math.max(0, request.range.startSec);
		let end = Math.min(dur, request.range.endSec);
		if (end <= start + 0.05) {
			return { error: `That time range is outside the current ${dur.toFixed(1)}s programme.` };
		}
		return { startSec: start, endSec: end };
	}
	if (placement === "end") {
		const end = dur;
		const start = Math.max(0, end - DEFAULT_TITLE_DURATION_SEC);
		return { startSec: start, endSec: end };
	}
	// beginning / default
	const start = 0;
	const end = Math.min(dur, DEFAULT_TITLE_DURATION_SEC);
	return { startSec: start, endSec: end };
}

function toRawSpan(
	doc: AxcutDocument,
	progStart: number,
	progEnd: number,
): { startSec: number; endSec: number } | { error: string } {
	const rawStart = programmeToRawSec(doc, progStart);
	const rawEnd = programmeToRawSec(doc, progEnd);
	if (rawStart == null || rawEnd == null || !(rawEnd > rawStart + 0.05)) {
		return {
			error: `I couldn't map ${progStart.toFixed(1)}s–${progEnd.toFixed(1)}s onto the timeline for a title.`,
		};
	}
	return { startSec: rawStart, endSec: rawEnd };
}

export function extractTitleText(raw: string): string | null {
	const t = raw.trim();
	const q =
		t.match(/\btitle\s+['"]([^'"]+)['"]/i)?.[1] ??
		t.match(/\bsaying\s+['"]([^'"]+)['"]/i)?.[1] ??
		t.match(/\bshow\s+['"]([^'"]+)['"]/i)?.[1] ??
		t.match(/\badd\s+(?:the\s+)?(?:title\s+)?['"]([^'"]+)['"]/i)?.[1] ??
		t.match(/\bchange\s+(?:that|it|the\s+title)\s+to\s+['"]([^'"]+)['"]/i)?.[1] ??
		t.match(/\breplace\s+['"][^'"]+['"]\s+with\s+['"]([^'"]+)['"]/i)?.[1] ??
		null;
	return q?.trim() ? q.trim() : null;
}

export function extractTitleReplace(raw: string): { from: string; to: string } | null {
	const m = raw.match(/\breplace\s+['"]([^'"]+)['"]\s+with\s+['"]([^'"]+)['"]/i);
	if (m?.[1] && m[2]) return { from: m[1], to: m[2] };
	return null;
}

export function extractTitleStyleOp(normalized: string): TitleStyleOp | null {
	const n = normalized.toLowerCase();
	if (/\b(?:bigger|larger|too\s+small)\b/.test(n)) return "bigger";
	if (/\b(?:smaller|too\s+(?:big|large))\b/.test(n)) return "smaller";
	if (/\b(?:in\s+the\s+)?center|centre\b/.test(n) && /\btitle|it|them\b/.test(n)) return "center";
	if (/\b(?:to\s+the\s+)?top\b/.test(n) && /\btitle|it|move|put\b/.test(n)) return "top";
	if (/\b(?:higher|up(?:ward)?)\b/.test(n)) return "higher";
	if (/\b(?:lower|down(?:ward)?)\b/.test(n) && !/\bsize\b/.test(n)) return "lower";
	if (
		/\blonger\b/.test(n) ||
		/\bkeep\b.+\bon\s+screen\b/.test(n) ||
		/\bone\s+second\s+longer\b/.test(n)
	) {
		return "longer";
	}
	if (/\bearlier\b/.test(n) && /\bdisappear|end|shorter\b/.test(n)) return "shorter";
	if (/\bdisappear\b.+\bearlier\b|\bone\s+second\s+earlier\b/.test(n)) return "shorter";
	if (/\bearlier\b/.test(n) && /\bstart\b/.test(n)) return "earlier";
	if (/\blater\b/.test(n)) return "later";
	if (/\bstart\b.+\bearlier\b|\bhalf\s+(?:a\s+)?sec/.test(n) && /\bearlier\b/.test(n)) {
		return "earlier";
	}
	return null;
}

export function extractTitlePlacement(normalized: string): "beginning" | "end" | null {
	const n = normalized.toLowerCase();
	if (/\b(?:at\s+the\s+)?(?:beginning|start|opening)\b/.test(n)) return "beginning";
	if (/\b(?:at\s+the\s+)?(?:end|ending|closing)\b/.test(n)) return "end";
	return null;
}

/** Phrase naming a title: "the Export Settings title". */
export function extractReferencedTitlePhrase(raw: string): string | null {
	const t = raw.trim();
	const quoted =
		t.match(/\b(?:the|that)\s+["']([^"']+)["']\s+title\b/i)?.[1] ??
		t.match(/\b["']([^"']+)["']\s+title\b/i)?.[1] ??
		null;
	if (quoted?.trim()) return quoted.trim();
	const named =
		t.match(
			/\b(?:the|that)\s+((?:(?!\btitle\b)[^\s"']+(?:\s+(?!\btitle\b)[^\s"']+){0,8}))\s+title\b/i,
		)?.[1] ?? null;
	if (!named?.trim()) return null;
	const phrase = named.trim();
	if (/^(?:that|this|the|a|an|first|second|last|ending|opening|final|middle)$/i.test(phrase)) {
		return null;
	}
	return phrase;
}

function titlesByTimeline(titles: TitleAnn[]): TitleAnn[] {
	return [...titles].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

function resolveTargetTitle(
	doc: AxcutDocument,
	request: LocalEditorialRequestV1,
): TitleAnn | { error: string } | { ambiguous: string } {
	const titles = listTitleAnnotations(doc);
	if (titles.length === 0) {
		return { error: "There isn't a title on the timeline to adjust." };
	}
	const ordered = titlesByTimeline(titles);
	const raw = request.rawText.toLowerCase();
	const wantText = extractReferencedTitlePhrase(request.rawText);
	const needle = wantText?.toLowerCase() ?? null;
	if (needle && needle.length > 1) {
		const hits = titles.filter((t) => {
			const hay = annText(t).toLowerCase();
			return hay === needle || hay.includes(needle) || needle.includes(hay);
		});
		if (hits.length === 1) return hits[0]!;
		if (hits.length > 1) {
			return {
				ambiguous: `Several titles match “${wantText}” — say which time or which one (first/last).`,
			};
		}
		return {
			error: `I couldn't find a title matching “${wantText}”.`,
		};
	}
	if (/\b(?:ending|last|final)\s+title\b/.test(raw) || /\btitle\s+at\s+the\s+end\b/.test(raw)) {
		return ordered[ordered.length - 1]!;
	}
	if (
		/\b(?:first|opening|beginning)\s+title\b/.test(raw) ||
		/\btitle\s+at\s+the\s+(?:beginning|start)\b/.test(raw)
	) {
		return ordered[0]!;
	}
	if (/\bsecond\s+title\b/.test(raw) && ordered.length >= 2) return ordered[1]!;
	if (request.range) {
		const mid = ((request.range.startSec + request.range.endSec) / 2) * 1000;
		const hit = ordered.find((t) => mid >= t.startMs - 50 && mid <= t.endMs + 50);
		if (hit) return hit;
	}
	if (titles.length === 1) return titles[0]!;
	// Most recently edited: prefer last id in the title registry, else latest start.
	const ids = titleIds(doc);
	if (ids.length > 0) {
		for (let i = ids.length - 1; i >= 0; i--) {
			const hit = titles.find((t) => t.id === ids[i]);
			if (hit) return hit;
		}
	}
	return ordered[ordered.length - 1]!;
}

export function applyDirectTitleAdd(args: {
	document: AxcutDocument;
	request: LocalEditorialRequestV1;
}): {
	document: AxcutDocument;
	mutated: boolean;
	userFacingText: string;
	families: string[];
} {
	const text = args.request.titleText?.trim() || extractTitleText(args.request.rawText) || null;
	if (!text) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: "I need the title text (for example “add the title 'OpenScreen Tutorial'”).",
			families: [],
		};
	}
	const span = resolveProgrammeSpan(args.document, args.request);
	if ("error" in span) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: span.error,
			families: [],
		};
	}
	const raw = toRawSpan(args.document, span.startSec, span.endSec);
	if ("error" in raw) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: raw.error,
			families: [],
		};
	}

	const beforeIds = new Set((args.document.annotations ?? []).map((a) => a.id));
	const result = executeAgentTool(
		args.document,
		"addGraphic",
		JSON.stringify({
			kind: "title",
			text,
			startSec: raw.startSec,
			endSec: raw.endSec,
		}),
		{ editsAllowed: true },
	);
	if (!result.ok || !result.document) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: result.summary || "I couldn't place that title on the timeline.",
			families: [],
		};
	}
	const added = (result.document.annotations ?? []).filter((a) => !beforeIds.has(a.id));
	const nextIds = [...titleIds(result.document), ...added.map((a) => a.id)];
	const doc = withTitleIds(result.document, nextIds);
	const where =
		args.request.titlePlacement === "end"
			? "at the end"
			: args.request.titlePlacement === "beginning" || !args.request.range
				? "at the beginning"
				: `from ${span.startSec.toFixed(1)}s to ${span.endSec.toFixed(1)}s`;
	return {
		document: doc,
		mutated: true,
		userFacingText: `I added “${text}” ${where}.`,
		families: ["title"],
	};
}

export function applyDirectTitleRemove(args: {
	document: AxcutDocument;
	request: LocalEditorialRequestV1;
}): {
	document: AxcutDocument;
	mutated: boolean;
	userFacingText: string;
	families: string[];
} {
	const target = resolveTargetTitle(args.document, args.request);
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
	const dropId = target.id;
	if (isCaptionAnn(target)) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: "I won't remove captions when asked to remove a title.",
			families: [],
		};
	}
	const nextAnns = (args.document.annotations ?? []).filter((a) => a.id !== dropId);
	const ids = titleIds(args.document).filter((id) => id !== dropId);
	const doc = withTitleIds({ ...args.document, annotations: nextAnns }, ids);
	return {
		document: doc,
		mutated: true,
		userFacingText: `I removed the title “${annText(target)}”.`,
		families: ["title"],
	};
}

export function applyDirectTitleAdjust(args: {
	document: AxcutDocument;
	request: LocalEditorialRequestV1;
}): {
	document: AxcutDocument;
	mutated: boolean;
	userFacingText: string;
	families: string[];
} {
	const target = resolveTargetTitle(args.document, args.request);
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
	if (isCaptionAnn(target)) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: "That target is a caption — captions are separate from titles.",
			families: [],
		};
	}

	const replace = extractTitleReplace(args.request.rawText);
	const newText =
		args.request.titleText?.trim() ||
		(replace
			? annText(target).replace(
					new RegExp(replace.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
					replace.to,
				)
			: null) ||
		(/\bchange\b.+\bto\b/i.test(args.request.rawText)
			? extractTitleText(args.request.rawText)
			: null);

	const op = args.request.titleStyleOp ?? extractTitleStyleOp(args.request.rawText.toLowerCase());

	let patch: Record<string, unknown> = { annotationId: target.id };
	let receipt = "";

	if (newText && newText !== annText(target)) {
		patch = { ...patch, text: newText };
		receipt = `I changed the title to “${newText}”.`;
	} else if (args.request.range && !args.request.range.singleTimestamp) {
		const raw = toRawSpan(args.document, args.request.range.startSec, args.request.range.endSec);
		if ("error" in raw) {
			return {
				document: args.document,
				mutated: false,
				userFacingText: raw.error,
				families: [],
			};
		}
		patch = { ...patch, startSec: raw.startSec, endSec: raw.endSec };
		receipt = `I moved that title to ${args.request.range.startSec.toFixed(1)}s–${args.request.range.endSec.toFixed(1)}s.`;
	} else if (op) {
		const fontSize = target.style?.fontSize ?? 44;
		const y = target.position?.y ?? 16;
		const startSec = target.startMs / 1000;
		const endSec = target.endMs / 1000;
		switch (op) {
			case "bigger": {
				const next = nextSize(fontSize, "up");
				patch = { ...patch, fontSize: next };
				receipt = `I made the title larger (about ${next}px).`;
				break;
			}
			case "smaller": {
				const next = nextSize(fontSize, "down");
				patch = { ...patch, fontSize: next };
				receipt = `I made the title smaller (about ${next}px).`;
				break;
			}
			case "higher": {
				const next = Math.max(4, y - Y_STEP);
				patch = { ...patch, y: next };
				receipt = `I moved the title higher.`;
				break;
			}
			case "lower": {
				const next = Math.min(90, y + Y_STEP);
				patch = { ...patch, y: next };
				receipt = `I moved the title down a little.`;
				break;
			}
			case "center": {
				patch = { ...patch, x: 50, y: 50, textAlign: "center" };
				receipt = `I put the title in the center.`;
				break;
			}
			case "top": {
				patch = { ...patch, y: 12 };
				receipt = `I moved the title to the top.`;
				break;
			}
			case "longer": {
				const step = /\bone\s+second\b/i.test(args.request.rawText) ? 1 : TIME_STEP_SEC;
				patch = { ...patch, startSec, endSec: endSec + step };
				receipt = `I kept the title on screen a little longer.`;
				break;
			}
			case "shorter": {
				const step = /\bone\s+second\b/i.test(args.request.rawText) ? 1 : TIME_STEP_SEC;
				const nextEnd = Math.max(startSec + 0.4, endSec - step);
				patch = { ...patch, startSec, endSec: nextEnd };
				receipt = `I made the title disappear a little earlier.`;
				break;
			}
			case "earlier": {
				const step = /\bhalf\b/i.test(args.request.rawText) ? 0.5 : TIME_STEP_SEC;
				const nextStart = Math.max(0, startSec - step);
				const dur = endSec - startSec;
				patch = { ...patch, startSec: nextStart, endSec: nextStart + dur };
				receipt = `I started the title a little earlier.`;
				break;
			}
			case "later": {
				const step = TIME_STEP_SEC;
				patch = { ...patch, startSec: startSec + step, endSec: endSec + step };
				receipt = `I moved the title a little later.`;
				break;
			}
		}
	} else {
		return {
			document: args.document,
			mutated: false,
			userFacingText:
				"I need a clearer title change (for example “make it bigger” or “change that to '…'”).",
			families: [],
		};
	}

	const result = executeAgentTool(args.document, "setAnnotation", JSON.stringify(patch), {
		editsAllowed: true,
	});
	if (!result.ok || !result.document) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: result.summary || "I couldn't update that title.",
			families: [],
		};
	}
	// Keep title id registry intact; mark this overlay as most-recently edited.
	const prevIds = titleIds(args.document).filter((id) => id !== target.id);
	const doc = withTitleIds(result.document, [...prevIds, target.id]);
	return {
		document: doc,
		mutated: true,
		userFacingText: receipt || "I updated the title.",
		families: ["title"],
	};
}
