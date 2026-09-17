/**
 * Direct CAPTION document mutations (0 LLM).
 * Captions are a view over transcript + legacyEditor.captions settings.
 * ZOOM / TRIM / SPEED are frozen — do not touch them.
 */

import {
	type CaptionSettings,
	deriveCaptionCues,
	getCaptionSettings,
	patchCaptionSettings,
} from "../../../src/lib/ai-edition/captions";
import { setDocumentWordText } from "../../../src/lib/ai-edition/document/transcript";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { LocalEditorialRequestV1 } from "./types";

/** Bounded font-size ladder (px @ 1080p). */
export const CAPTION_SIZE_LADDER = [24, 32, 40, 48, 56, 64, 72, 96] as const;
const INSET_STEP = 2.5;
const WORDS_STEP = 1;

export type CaptionStyleOp =
	| "smaller"
	| "larger"
	| "higher"
	| "lower"
	| "bottom"
	| "top"
	| "center"
	| "easier_read"
	| "fewer_words"
	| "longer_on_screen";

function nextSize(current: number, direction: "up" | "down"): number {
	if (direction === "up") {
		const hit = CAPTION_SIZE_LADDER.find((s) => s > current + 0.5);
		return hit ?? Math.min(200, Math.round(current * 1.15));
	}
	const downs = [...CAPTION_SIZE_LADDER].reverse().find((s) => s < current - 0.5);
	return downs ?? Math.max(12, Math.round(current * 0.85));
}

export function captionSettingsSnapshot(doc: AxcutDocument, aspect = 16 / 9): CaptionSettings {
	return getCaptionSettings(doc, aspect);
}

export function applyDirectCaptionStyle(args: {
	document: AxcutDocument;
	request: LocalEditorialRequestV1;
	aspectValue?: number;
}): {
	document: AxcutDocument;
	mutated: boolean;
	userFacingText: string;
	families: string[];
} {
	const aspect = args.aspectValue ?? 16 / 9;
	const cur = getCaptionSettings(args.document, aspect);
	if (!cur.enabled) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: "Captions aren't enabled, so there's no caption style to change.",
			families: [],
		};
	}

	const op = args.request.captionStyleOp ?? extractCaptionStyleOp(args.request.rawText);
	if (!op) {
		return {
			document: args.document,
			mutated: false,
			userFacingText:
				"I need a clearer caption style change (for example “make them smaller” or “move them higher”).",
			families: [],
		};
	}

	let patch: Partial<CaptionSettings> = {};
	let receipt = "";

	switch (op) {
		case "smaller": {
			const fontSize = nextSize(cur.fontSize, "down");
			if (fontSize === cur.fontSize) {
				return {
					document: args.document,
					mutated: false,
					userFacingText: "Captions are already at the smallest supported size.",
					families: [],
				};
			}
			patch = { fontSize };
			receipt = `I made the captions smaller (about ${fontSize}px at 1080p).`;
			break;
		}
		case "larger": {
			const fontSize = nextSize(cur.fontSize, "up");
			if (fontSize === cur.fontSize) {
				return {
					document: args.document,
					mutated: false,
					userFacingText: "Captions are already at the largest supported size.",
					families: [],
				};
			}
			patch = { fontSize };
			receipt = `I made the captions larger (about ${fontSize}px at 1080p).`;
			break;
		}
		case "higher": {
			if (cur.anchorV === "bottom") {
				const insetY = Math.min(50, cur.insetY + INSET_STEP);
				patch = { insetY };
				receipt = `I moved the captions a little higher (inset ${insetY.toFixed(1)}% from the bottom).`;
			} else {
				const insetY = Math.max(0, cur.insetY - INSET_STEP);
				patch = { insetY };
				receipt = `I moved the captions a little higher (inset ${insetY.toFixed(1)}% from the top).`;
			}
			break;
		}
		case "lower": {
			if (cur.anchorV === "bottom") {
				const insetY = Math.max(0, cur.insetY - INSET_STEP);
				patch = { insetY };
				receipt = `I moved the captions a little lower (inset ${insetY.toFixed(1)}% from the bottom).`;
			} else {
				const insetY = Math.min(50, cur.insetY + INSET_STEP);
				patch = { insetY };
				receipt = `I moved the captions a little lower (inset ${insetY.toFixed(1)}% from the top).`;
			}
			break;
		}
		case "bottom": {
			patch = { anchorV: "bottom", insetY: Math.min(cur.insetY, 8) };
			receipt = "I put the captions at the bottom of the frame.";
			break;
		}
		case "top": {
			patch = { anchorV: "top", insetY: Math.min(Math.max(cur.insetY, 4), 12) };
			receipt = "I put the captions near the top of the frame.";
			break;
		}
		case "center": {
			patch = { anchorH: "center", insetX: 0 };
			receipt = "I centered the captions horizontally.";
			break;
		}
		case "easier_read": {
			patch = {
				backgroundEnabled: true,
				backgroundOpacity: Math.max(0.55, cur.backgroundOpacity),
				fontWeight: "bold",
				fontSize: cur.fontSize < 40 ? nextSize(cur.fontSize, "up") : cur.fontSize,
			};
			receipt = "I made the captions easier to read (background plate + bold).";
			break;
		}
		case "fewer_words": {
			const maxWordsPerLine = Math.max(cur.minWordsPerLine, cur.maxWordsPerLine - WORDS_STEP);
			if (maxWordsPerLine === cur.maxWordsPerLine) {
				return {
					document: args.document,
					mutated: false,
					userFacingText: "Captions already show as few words per line as the settings allow.",
					families: [],
				};
			}
			patch = { maxWordsPerLine };
			receipt = `I reduced caption density to about ${maxWordsPerLine} words at once.`;
			break;
		}
		case "longer_on_screen": {
			// Existing model has no per-cue dwell; fewer words → slightly longer per cue.
			const maxWordsPerLine = Math.max(cur.minWordsPerLine, cur.maxWordsPerLine - WORDS_STEP);
			patch = { maxWordsPerLine };
			receipt = `I shortened each caption line so cues stay on screen a bit longer (max ${maxWordsPerLine} words).`;
			break;
		}
		default:
			return {
				document: args.document,
				mutated: false,
				userFacingText: "I couldn't apply that caption style change.",
				families: [],
			};
	}

	const next = patchCaptionSettings(args.document, patch, aspect);
	const after = getCaptionSettings(next, aspect);
	const changed =
		after.fontSize !== cur.fontSize ||
		after.insetY !== cur.insetY ||
		after.anchorV !== cur.anchorV ||
		after.anchorH !== cur.anchorH ||
		after.backgroundEnabled !== cur.backgroundEnabled ||
		after.fontWeight !== cur.fontWeight ||
		after.maxWordsPerLine !== cur.maxWordsPerLine ||
		after.backgroundOpacity !== cur.backgroundOpacity;

	if (!changed) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: "That caption style is already in place.",
			families: [],
		};
	}

	return {
		document: next,
		mutated: true,
		userFacingText: receipt,
		families: ["captions"],
	};
}

function normalizeMatchText(s: string): string {
	return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Correct caption text by editing transcript words (SSOT). No re-STT.
 * Priority: exact phrase match across words → single cue containing phrase → ambiguity.
 */
export function applyDirectCaptionTextCorrection(args: {
	document: AxcutDocument;
	request: LocalEditorialRequestV1;
	aspectValue?: number;
}): {
	document: AxcutDocument;
	mutated: boolean;
	userFacingText: string;
	families: string[];
} {
	const aspect = args.aspectValue ?? 16 / 9;
	const replace = args.request.captionTextReplace;
	if (!replace?.to?.trim()) {
		return {
			document: args.document,
			mutated: false,
			userFacingText:
				"I need the corrected caption text (for example “change this caption to 'OpenScreen Editor'”).",
			families: [],
		};
	}
	const toText = replace.to.trim();
	const fromText = replace.from?.trim() || null;

	const settings = getCaptionSettings(args.document, aspect);
	if (!settings.enabled) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: "Captions aren't enabled, so there's no caption text to correct.",
			families: [],
		};
	}

	const assetId =
		args.document.project.primaryAssetId ??
		args.document.assets.find((a) => a.kind !== "audio")?.id ??
		null;
	if (!assetId) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: "I couldn't find a video asset to correct captions on.",
			families: [],
		};
	}
	const transcript =
		args.document.transcripts.find((t) => t.assetId === assetId) ??
		args.document.transcripts[0] ??
		null;
	if (!transcript?.words?.length) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: "There's no transcript text to correct yet.",
			families: [],
		};
	}

	const words = transcript.words.filter((w) => w.text.trim().length > 0);
	const needle = normalizeMatchText(fromText ?? toText);
	const searchNeedle = fromText ? normalizeMatchText(fromText) : null;

	// Find contiguous word spans matching `from` (or exact cue text when only `to` given).
	type Span = { start: number; end: number; text: string };
	const spans: Span[] = [];
	if (searchNeedle) {
		for (let i = 0; i < words.length; i++) {
			let acc = "";
			for (let j = i; j < words.length; j++) {
				acc = acc ? `${acc} ${words[j]!.text}` : words[j]!.text;
				const n = normalizeMatchText(acc);
				if (n === searchNeedle) {
					spans.push({ start: i, end: j, text: acc });
					break;
				}
				if (!searchNeedle.startsWith(n) && n.length >= searchNeedle.length) break;
			}
		}
	} else {
		// "change this caption to X" without from: match existing cue equal to something? Prefer
		// cues that differ from toText — use playhead/range if provided, else refuse ambiguity.
		const cues = deriveCaptionCues(args.document, settings, {});
		const atSec = args.request.captionAtSec;
		const range = args.request.range;
		let targetCue = cues.find((c) => {
			if (atSec != null) {
				const t = atSec * 1000;
				return t >= c.startMs && t < c.endMs;
			}
			if (range?.singleTimestamp) {
				const t = range.startSec * 1000;
				return t >= c.startMs && t < c.endMs;
			}
			return false;
		});
		if (!targetCue && cues.length === 1) targetCue = cues[0];
		if (!targetCue) {
			return {
				document: args.document,
				mutated: false,
				userFacingText:
					"I need a clearer caption to correct — name the current text (replace '…' with '…'), or point at a time.",
				families: [],
			};
		}
		const cueNorm = normalizeMatchText(targetCue.text);
		for (let i = 0; i < words.length; i++) {
			let acc = "";
			for (let j = i; j < words.length; j++) {
				acc = acc ? `${acc} ${words[j]!.text}` : words[j]!.text;
				if (normalizeMatchText(acc) === cueNorm) {
					spans.push({ start: i, end: j, text: acc });
					break;
				}
			}
			if (spans.length) break;
		}
	}

	if (spans.length === 0) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: fromText
				? `I couldn't find “${fromText}” in the captions to replace.`
				: "I couldn't match that caption text in the transcript.",
			families: [],
		};
	}
	if (spans.length > 1 && !args.request.range && args.request.captionAtSec == null) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: `“${fromText ?? needle}” appears ${spans.length} times — say which time (e.g. around 12 seconds) so I don't change the wrong caption.`,
			families: [],
		};
	}

	let span = spans[0]!;
	if (args.request.captionAtSec != null || args.request.range?.singleTimestamp) {
		const t = args.request.captionAtSec ?? args.request.range?.startSec ?? 0;
		const hit = spans.find((s) => {
			const a = words[s.start]!;
			const b = words[s.end]!;
			return t >= a.startSec - 0.05 && t <= b.endSec + 0.05;
		});
		if (hit) span = hit;
	}

	const toParts = toText.split(/\s+/).filter(Boolean);
	const spanLen = span.end - span.start + 1;
	let doc = args.document;

	if (toParts.length === spanLen) {
		for (let k = 0; k < spanLen; k++) {
			const w = words[span.start + k]!;
			doc = setDocumentWordText(doc, assetId, w.id, toParts[k]!);
		}
	} else if (toParts.length === 1) {
		// Collapse multi-word phrase into first word; blank the rest (preserves timing envelope).
		doc = setDocumentWordText(doc, assetId, words[span.start]!.id, toText);
		for (let k = 1; k < spanLen; k++) {
			doc = setDocumentWordText(doc, assetId, words[span.start + k]!.id, "");
		}
	} else if (toParts.length < spanLen) {
		for (let k = 0; k < toParts.length; k++) {
			doc = setDocumentWordText(doc, assetId, words[span.start + k]!.id, toParts[k]!);
		}
		for (let k = toParts.length; k < spanLen; k++) {
			doc = setDocumentWordText(doc, assetId, words[span.start + k]!.id, "");
		}
	} else {
		// More words in replacement than span: put full text on first word; blank rest.
		doc = setDocumentWordText(doc, assetId, words[span.start]!.id, toText);
		for (let k = 1; k < spanLen; k++) {
			doc = setDocumentWordText(doc, assetId, words[span.start + k]!.id, "");
		}
	}

	return {
		document: doc,
		mutated: true,
		userFacingText: fromText
			? `I changed the caption from “${fromText}” to “${toText}”.`
			: `I changed the caption to “${toText}”.`,
		families: ["captions"],
	};
}

export function extractCaptionStyleOp(normalized: string): CaptionStyleOp | null {
	const n = normalized.toLowerCase();
	if (
		/\bfewer\s+words\b|\bless\s+words\b|\bshow\s+fewer\b|\bshorter\s+(?:lines?|captions?)\b/.test(n)
	) {
		return "fewer_words";
	}
	if (
		/\blonger\s+on\s+screen\b|\bdisappear(?:s|ing)?\s+too\s+quickly\b|\bkeep\s+(?:each\s+)?caption\b.+\blonger\b/.test(
			n,
		)
	) {
		return "longer_on_screen";
	}
	if (/\beasier\s+to\s+read\b|\bmore\s+readable\b|\breadability\b|\bhard\s+to\s+read\b/.test(n)) {
		return "easier_read";
	}
	if (/\b(?:at\s+the\s+)?bottom\b/.test(n) && /\bcaption|subtitle|them|put|move\b/.test(n)) {
		return "bottom";
	}
	if (/\b(?:at\s+the\s+)?top\b/.test(n) && /\bcaption|subtitle|them|put|move\b/.test(n)) {
		return "top";
	}
	if (/\bcenter(?:ed|re)?\b/.test(n) && /\bcaption|subtitle|them\b/.test(n)) {
		return "center";
	}
	if (/\b(?:higher|up(?:ward)?|raise)\b/.test(n) && /\bcaption|subtitle|them|move\b/.test(n)) {
		return "higher";
	}
	if (
		/\b(?:lower|down(?:ward)?|drop)\b/.test(n) &&
		/\bcaption|subtitle|them|move\b/.test(n) &&
		!/\bsize\b/.test(n)
	) {
		return "lower";
	}
	if (
		/\b(?:bigger|larger|too\s+small|increase\s+(?:the\s+)?(?:size|font))\b/.test(n) ||
		/\bmake\s+(?:them|the\s+captions?|captions?)\s+(?:a\s+little\s+)?(?:bigger|larger)\b/.test(n)
	) {
		return "larger";
	}
	if (
		/\b(?:smaller|too\s+(?:big|large)|reduce\s+(?:the\s+)?(?:size|font)|down\s+in\s+size)\b/.test(
			n,
		) ||
		/\bmake\s+(?:them|the\s+captions?|captions?)\s+(?:a\s+little\s+)?smaller\b/.test(n)
	) {
		return "smaller";
	}
	return null;
}

export function extractCaptionTextReplace(raw: string): { from: string | null; to: string } | null {
	const t = raw.trim();
	const replaceQuoted =
		t.match(/\breplace\s+['"]([^'"]+)['"]\s+with\s+['"]([^'"]+)['"]/i) ??
		t.match(/\bchange\s+['"]([^'"]+)['"]\s+to\s+['"]([^'"]+)['"]/i) ??
		t.match(/\bfix\s+(?:this\s+)?caption\s+to\s+(?:say\s+)?['"]([^'"]+)['"]/i);
	if (replaceQuoted) {
		if (replaceQuoted.length >= 3 && replaceQuoted[2]) {
			return { from: replaceQuoted[1]!, to: replaceQuoted[2]! };
		}
		if (replaceQuoted[1] && !replaceQuoted[2]) {
			return { from: null, to: replaceQuoted[1]! };
		}
	}
	const changeThis = t.match(
		/\b(?:change|fix)\s+(?:this|that|the)\s+caption\s+to\s+(?:say\s+)?['"]([^'"]+)['"]/i,
	);
	if (changeThis?.[1]) return { from: null, to: changeThis[1] };
	const changeThisUnquoted = t.match(
		/\b(?:change|fix)\s+(?:this|that|the)\s+caption\s+to\s+(?:say\s+)?(.+)$/i,
	);
	if (changeThisUnquoted?.[1] && !/\breplace\b/i.test(t)) {
		const to = changeThisUnquoted[1].trim().replace(/^['"]|['"]$/g, "");
		if (to.length > 0 && to.length < 120) return { from: null, to };
	}
	return null;
}
