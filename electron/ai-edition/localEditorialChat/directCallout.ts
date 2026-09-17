/**
 * Direct CALLOUT / visual-emphasis mutations (0 LLM).
 * Callout = annotations[] figure (arrow) + optional stored label text.
 * Tracked via legacyEditor.calloutOverlayIds (never titles/captions).
 * WHERE reuses selectDirectZoomFocus evidence (READ-only; Zoom frozen).
 * User times = CURRENT PROGRAMME time → programmeToRawSec.
 * ZOOM / TRIM / SPEED / CAPTIONS / TITLE are frozen.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { executeAgentTool } from "../agent-tools";
import { programmeDurationWithSpeed, programmeToRawSec } from "./directSpeed";
import {
	type CursorSampleLite,
	type DirectZoomFocusTrace,
	loadCursorSamplesFromSidecar,
	selectDirectZoomFocus,
} from "./directZoomFocus";
import type { LocalEditorialRequestV1 } from "./types";

/** Default on-screen duration when user omits an end time. */
export const DEFAULT_CALLOUT_DURATION_SEC = 3;

const SIZE_LADDER = [8, 10, 12, 14, 16, 20, 24] as const;
const POS_STEP = 3;
const TIME_STEP_SEC = 0.5;

export type CalloutStyleOp =
	| "bigger"
	| "smaller"
	| "higher"
	| "lower"
	| "left"
	| "right"
	| "longer"
	| "shorter"
	| "earlier"
	| "later";

type Ann = AxcutDocument["annotations"][number];

function legacyBlob(doc: AxcutDocument): Record<string, unknown> {
	return { ...((doc.legacyEditor as Record<string, unknown> | null) ?? {}) };
}

function calloutIds(doc: AxcutDocument): string[] {
	const raw = legacyBlob(doc).calloutOverlayIds;
	return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

function withCalloutIds(doc: AxcutDocument, ids: string[]): AxcutDocument {
	const legacy = legacyBlob(doc);
	return {
		...doc,
		legacyEditor: { ...legacy, calloutOverlayIds: [...new Set(ids)] },
	};
}

function annText(a: Ann): string {
	return String(a.textContent ?? a.content ?? "").trim();
}

function isCaptionAnn(a: Ann): boolean {
	return (a as { annotationSource?: string }).annotationSource === "auto-caption";
}

function isTitleTracked(doc: AxcutDocument, id: string): boolean {
	const raw = legacyBlob(doc).titleOverlayIds;
	const ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
	return ids.includes(id);
}

/** Figure callouts only — never captions or title overlays. */
export function listCalloutAnnotations(doc: AxcutDocument): Ann[] {
	const anns = doc.annotations ?? [];
	const tracked = new Set(calloutIds(doc));
	const byId = anns.filter((a) => tracked.has(a.id) && a.type === "figure" && !isCaptionAnn(a));
	if (byId.length > 0) return byId;
	return anns.filter(
		(a) =>
			a.type === "figure" &&
			!isCaptionAnn(a) &&
			!isTitleTracked(doc, a.id) &&
			Boolean(a.figureData),
	);
}

export function extractCalloutText(raw: string): string | null {
	const t = raw.trim();
	const q =
		t.match(/\blabel\s+saying\s+['"]([^'"]+)['"]/i)?.[1] ??
		t.match(/\bsaying\s+['"]([^'"]+)['"]/i)?.[1] ??
		t.match(/\bcallout\s+(?:saying\s+|text\s+|with\s+(?:text\s+)?)['"]([^'"]+)['"]/i)?.[1] ??
		t.match(/\bchange\s+(?:that|it|the\s+callout(?:\s+text)?)\s+to\s+['"]([^'"]+)['"]/i)?.[1] ??
		t.match(/\bchange\s+(?:the\s+)?text\s+to\s+['"]([^'"]+)['"]/i)?.[1] ??
		t.match(/\btext\s+to\s+['"]([^'"]+)['"]/i)?.[1] ??
		null;
	return q?.trim() ? q.trim() : null;
}

export function extractCalloutStyleOp(normalized: string): CalloutStyleOp | null {
	const n = normalized.toLowerCase();
	if (/\b(?:bigger|larger|too\s+small)\b/.test(n)) return "bigger";
	if (/\b(?:smaller|too\s+(?:big|large))\b/.test(n)) return "smaller";
	if (/\b(?:higher|up(?:ward)?)\b/.test(n)) return "higher";
	if (/\b(?:lower|down(?:ward)?)\b/.test(n) && !/\bsize\b/.test(n)) return "lower";
	if (/\bleft\b/.test(n)) return "left";
	if (/\bright\b/.test(n) && !/\bright\s+now\b/.test(n)) return "right";
	if (/\blonger\b/.test(n) || /\bkeep\b.+\bon\s+screen\b/.test(n)) return "longer";
	if (/\bearlier\b/.test(n) && /\bdisappear|end|shorter\b/.test(n)) return "shorter";
	if (/\bdisappear\b.+\bearlier\b|\bone\s+second\s+earlier\b/.test(n)) return "shorter";
	if (/\bearlier\b/.test(n)) return "earlier";
	if (/\blater\b/.test(n)) return "later";
	return null;
}

/** Phrase naming a callout: "the Export callout". */
export function extractReferencedCalloutPhrase(raw: string): string | null {
	const t = raw.trim();
	const quoted =
		t.match(/\b(?:the|that)\s+["']([^"']+)["']\s+callout\b/i)?.[1] ??
		t.match(/\b["']([^"']+)["']\s+callout\b/i)?.[1] ??
		null;
	if (quoted?.trim()) return quoted.trim();
	const named =
		t.match(
			/\b(?:the|that)\s+((?:(?!\bcallout\b)[^\s"']+(?:\s+(?!\bcallout\b)[^\s"']+){0,6}))\s+callout\b/i,
		)?.[1] ?? null;
	if (!named?.trim()) return null;
	const phrase = named.trim();
	if (/^(?:that|this|the|a|an|first|second|last|ending|opening|final|middle)$/i.test(phrase)) {
		return null;
	}
	return phrase;
}

function nextSize(current: number, dir: "up" | "down"): number {
	if (dir === "up") {
		return SIZE_LADDER.find((s) => s > current + 0.5) ?? Math.min(32, Math.round(current * 1.2));
	}
	const down = [...SIZE_LADDER].reverse().find((s) => s < current - 0.5);
	return down ?? Math.max(6, Math.round(current * 0.85));
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
		return { error: "There isn't enough timeline media to place a callout yet." };
	}
	if (request.range && !request.range.singleTimestamp && !request.range.nearTimestamp) {
		const start = Math.max(0, request.range.startSec);
		const end = Math.min(dur, request.range.endSec);
		if (end <= start + 0.05) {
			return { error: `That time range is outside the current ${dur.toFixed(1)}s programme.` };
		}
		return { startSec: start, endSec: end };
	}
	if (request.range?.nearTimestamp || request.range?.singleTimestamp) {
		const at = Math.max(0, Math.min(dur, request.range.startSec));
		const half = DEFAULT_CALLOUT_DURATION_SEC / 2;
		return {
			startSec: Math.max(0, at - half),
			endSec: Math.min(dur, at + half),
		};
	}
	return {
		startSec: 0,
		endSec: Math.min(dur, DEFAULT_CALLOUT_DURATION_SEC),
	};
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
			error: `I couldn't map ${progStart.toFixed(1)}s–${progEnd.toFixed(1)}s onto the timeline for a callout.`,
		};
	}
	return { startSec: rawStart, endSec: rawEnd };
}

function primaryMediaPath(doc: AxcutDocument): string | null {
	const id = doc.project.primaryAssetId ?? doc.assets[0]?.id;
	const asset = doc.assets.find((a) => a.id === id) ?? doc.assets[0];
	return asset?.originalPath ?? null;
}

function resolveWhere(args: {
	document: AxcutDocument;
	request: LocalEditorialRequestV1;
	progStart: number;
	progEnd: number;
	cursorSamples?: CursorSampleLite[] | null;
}): { x: number; y: number; trace: DirectZoomFocusTrace; arrowDirection: string } {
	const samples =
		args.cursorSamples && args.cursorSamples.length > 0
			? args.cursorSamples
			: loadCursorSamplesFromSidecar(primaryMediaPath(args.document));
	const userFocus =
		args.request.zoomUserFocus ??
		(args.request.target && /\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?/.test(args.request.target)
			? (() => {
					const m = args.request.target!.match(/(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/);
					if (!m) return null;
					const a = Number(m[1]);
					const b = Number(m[2]);
					// Accept 0–1 or 0–100
					return {
						cx: a > 1.5 ? a / 100 : a,
						cy: b > 1.5 ? b / 100 : b,
					};
				})()
			: null);
	const requiresSpecific = /\b(?:button|click|this|that|export|control|icon|menu|here)\b/i.test(
		args.request.rawText,
	);
	const trace = selectDirectZoomFocus({
		startSec: args.progStart,
		endSec: args.progEnd,
		userFocus,
		cursorSamples: samples,
	});
	let cx = trace.selectedFocus.cx;
	let cy = trace.selectedFocus.cy;
	if (requiresSpecific && trace.focusSource === "center" && samples.length === 0) {
		// Keep center but offset slightly so we don't claim a grounded object.
		cx = 0.55;
		cy = 0.42;
	}
	// Place arrow slightly above the focal so it points down at the target.
	const x = Math.min(90, Math.max(6, Math.round(cx * 100) - 4));
	const y = Math.min(88, Math.max(6, Math.round(cy * 100) - 8));
	return { x, y, trace, arrowDirection: "down" };
}

function calloutsByTimeline(list: Ann[]): Ann[] {
	return [...list].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

function resolveTargetCallout(
	doc: AxcutDocument,
	request: LocalEditorialRequestV1,
): Ann | { error: string } | { ambiguous: string } {
	const callouts = listCalloutAnnotations(doc);
	if (callouts.length === 0) {
		return { error: "There isn't a callout on the timeline to adjust." };
	}
	const ordered = calloutsByTimeline(callouts);
	const raw = request.rawText.toLowerCase();
	const wantText = extractReferencedCalloutPhrase(request.rawText);
	if (wantText && wantText.length > 1) {
		const needle = wantText.toLowerCase();
		const hits = callouts.filter((t) => {
			const hay = annText(t).toLowerCase();
			if (!hay) return false;
			return hay === needle || hay.includes(needle) || (needle.includes(hay) && hay.length >= 3);
		});
		if (hits.length === 1) return hits[0]!;
		if (hits.length > 1) {
			return {
				ambiguous: `Several callouts match “${wantText}” — say which time or which one (first/second).`,
			};
		}
		return { error: `I couldn't find a callout matching “${wantText}”.` };
	}
	if (/\b(?:ending|last|final)\s+callout\b/.test(raw)) return ordered[ordered.length - 1]!;
	if (/\b(?:first|opening)\s+callout\b/.test(raw)) return ordered[0]!;
	if (/\bsecond\s+callout\b/.test(raw) && ordered.length >= 2) return ordered[1]!;
	if (request.range) {
		const mid = ((request.range.startSec + request.range.endSec) / 2) * 1000;
		const hit = ordered.find((t) => mid >= t.startMs - 80 && mid <= t.endMs + 80);
		if (hit) return hit;
		if (/\baround\b|\bnear\b|\bat\b/.test(raw)) {
			const near = ordered.find((t) => Math.abs((t.startMs + t.endMs) / 2 - mid) < 2500);
			if (near) return near;
		}
	}
	if (callouts.length === 1) return callouts[0]!;
	const ids = calloutIds(doc);
	for (let i = ids.length - 1; i >= 0; i--) {
		const hit = callouts.find((t) => t.id === ids[i]);
		if (hit) return hit;
	}
	return ordered[ordered.length - 1]!;
}

export function applyDirectCalloutAdd(args: {
	document: AxcutDocument;
	request: LocalEditorialRequestV1;
	cursorSamples?: CursorSampleLite[] | null;
}): {
	document: AxcutDocument;
	mutated: boolean;
	userFacingText: string;
	families: string[];
	focusTrace?: DirectZoomFocusTrace | null;
} {
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
	const where = resolveWhere({
		document: args.document,
		request: args.request,
		progStart: span.startSec,
		progEnd: span.endSec,
		cursorSamples: args.cursorSamples,
	});
	const text = args.request.calloutText?.trim() || extractCalloutText(args.request.rawText) || "";

	const beforeIds = new Set((args.document.annotations ?? []).map((a) => a.id));
	const result = executeAgentTool(
		args.document,
		"addGraphic",
		JSON.stringify({
			kind: "figure",
			text,
			startSec: raw.startSec,
			endSec: raw.endSec,
			x: where.x,
			y: where.y,
			width: 12,
			height: 12,
			arrowDirection: where.arrowDirection,
		}),
		{ editsAllowed: true },
	);
	if (!result.ok || !result.document) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: result.summary || "I couldn't place that callout on the timeline.",
			families: [],
		};
	}
	const added = (result.document.annotations ?? []).filter((a) => !beforeIds.has(a.id));
	const nextIds = [...calloutIds(result.document), ...added.map((a) => a.id)];
	const doc = withCalloutIds(result.document, nextIds);
	const whereNote =
		where.trace.focusSource === "click"
			? "over the click in that range"
			: where.trace.focusSource === "dwell"
				? "over the cursor dwell in that range"
				: where.trace.focusSource === "user"
					? "at the target you named"
					: "at a safe emphasis point";
	const textNote = text ? ` labeled “${text}”` : "";
	return {
		document: doc,
		mutated: true,
		userFacingText: `I added a callout${textNote} from ${span.startSec.toFixed(1)}s to ${span.endSec.toFixed(1)}s ${whereNote}.`,
		families: ["callout"],
		focusTrace: where.trace,
	};
}

export function applyDirectCalloutRemove(args: {
	document: AxcutDocument;
	request: LocalEditorialRequestV1;
}): {
	document: AxcutDocument;
	mutated: boolean;
	userFacingText: string;
	families: string[];
} {
	const target = resolveTargetCallout(args.document, args.request);
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
	if (isCaptionAnn(target) || isTitleTracked(args.document, target.id)) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: "I won't remove captions or titles when asked to remove a callout.",
			families: [],
		};
	}
	const nextAnns = (args.document.annotations ?? []).filter((a) => a.id !== target.id);
	const ids = calloutIds(args.document).filter((id) => id !== target.id);
	const doc = withCalloutIds({ ...args.document, annotations: nextAnns }, ids);
	const label = annText(target);
	return {
		document: doc,
		mutated: true,
		userFacingText: label ? `I removed the callout “${label}”.` : "I removed that callout.",
		families: ["callout"],
	};
}

export function applyDirectCalloutAdjust(args: {
	document: AxcutDocument;
	request: LocalEditorialRequestV1;
}): {
	document: AxcutDocument;
	mutated: boolean;
	userFacingText: string;
	families: string[];
} {
	const target = resolveTargetCallout(args.document, args.request);
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
	if (isCaptionAnn(target) || isTitleTracked(args.document, target.id)) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: "That target is not a callout.",
			families: [],
		};
	}

	const newText =
		args.request.calloutText?.trim() ||
		(/\bchange\b.+\bto\b/i.test(args.request.rawText)
			? extractCalloutText(args.request.rawText)
			: null);
	const op =
		args.request.calloutStyleOp ?? extractCalloutStyleOp(args.request.rawText.toLowerCase());

	let patch: Record<string, unknown> = { annotationId: target.id };
	let receipt = "";

	if (newText && newText !== annText(target)) {
		patch = { ...patch, text: newText };
		receipt = `I changed the callout text to “${newText}”.`;
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
		receipt = `I moved that callout to ${args.request.range.startSec.toFixed(1)}s–${args.request.range.endSec.toFixed(1)}s.`;
	} else if (op) {
		const w = target.size?.width ?? 12;
		const x = target.position?.x ?? 50;
		const y = target.position?.y ?? 40;
		const startSec = target.startMs / 1000;
		const endSec = target.endMs / 1000;
		switch (op) {
			case "bigger": {
				const next = nextSize(w, "up");
				patch = { ...patch, width: next, height: next };
				receipt = "I made the callout larger.";
				break;
			}
			case "smaller": {
				const next = nextSize(w, "down");
				patch = { ...patch, width: next, height: next };
				receipt = "I made the callout smaller.";
				break;
			}
			case "higher": {
				patch = { ...patch, y: Math.max(4, y - POS_STEP) };
				receipt = "I moved the callout higher.";
				break;
			}
			case "lower": {
				patch = { ...patch, y: Math.min(90, y + POS_STEP) };
				receipt = "I moved the callout down a little.";
				break;
			}
			case "left": {
				patch = { ...patch, x: Math.max(4, x - POS_STEP) };
				receipt = "I moved the callout a little to the left.";
				break;
			}
			case "right": {
				patch = { ...patch, x: Math.min(90, x + POS_STEP) };
				receipt = "I moved the callout a little to the right.";
				break;
			}
			case "longer": {
				const step = /\bone\s+second\b/i.test(args.request.rawText) ? 1 : TIME_STEP_SEC;
				patch = { ...patch, startSec, endSec: endSec + step };
				receipt = "I kept the callout on screen a little longer.";
				break;
			}
			case "shorter": {
				const step = /\bone\s+second\b/i.test(args.request.rawText) ? 1 : TIME_STEP_SEC;
				patch = {
					...patch,
					startSec,
					endSec: Math.max(startSec + 0.4, endSec - step),
				};
				receipt = "I made the callout disappear a little earlier.";
				break;
			}
			case "earlier": {
				const step = /\bhalf\b/i.test(args.request.rawText) ? 0.5 : TIME_STEP_SEC;
				const nextStart = Math.max(0, startSec - step);
				const dur = endSec - startSec;
				patch = { ...patch, startSec: nextStart, endSec: nextStart + dur };
				receipt = "I showed the callout a little earlier.";
				break;
			}
			case "later": {
				patch = {
					...patch,
					startSec: startSec + TIME_STEP_SEC,
					endSec: endSec + TIME_STEP_SEC,
				};
				receipt = "I moved the callout a little later.";
				break;
			}
		}
	} else {
		return {
			document: args.document,
			mutated: false,
			userFacingText:
				"I need a clearer callout change (for example “make it smaller” or “change the text to '…'”).",
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
			userFacingText: result.summary || "I couldn't update that callout.",
			families: [],
		};
	}
	const prevIds = calloutIds(args.document).filter((id) => id !== target.id);
	const doc = withCalloutIds(result.document, [...prevIds, target.id]);
	return {
		document: doc,
		mutated: true,
		userFacingText: receipt || "I updated the callout.",
		families: ["callout"],
	};
}
