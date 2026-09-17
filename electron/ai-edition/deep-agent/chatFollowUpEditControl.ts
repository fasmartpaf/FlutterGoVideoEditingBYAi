/**
 * Deterministic chat follow-up edits after a professional autonomous turn.
 * Runs under deterministic_edit authority — not inventing geometry.
 */

import {
	getCaptionSettings,
	patchCaptionSettings,
} from "../../../src/lib/ai-edition/captions/settings";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";

export function isChatFollowUpEditControl(text: string): boolean {
	return (
		/\b(?:undo|revert)\s+(?:that\s+|the\s+)?(?:last\s+)?(?:change|edit|mutation|zoom|trim|speed)s?\b/i.test(
			text,
		) ||
		/\bremove\s+(?:that\s+|the\s+)?(?:last\s+)?zoom\b/i.test(text) ||
		/\b(?:make\s+(?:the\s+)?captions?\s+smaller|captions?\s+smaller)\b/i.test(text) ||
		/\b(?:turn|switch)\s+(?:the\s+)?captions?\s+off\b|\bcaptions?\s+off\b/i.test(text) ||
		/\bmake\s+the\s+audio\s+(?:a\s+little\s+)?(?:quieter|louder)\b/i.test(text) ||
		/\brestore\s+(?:the\s+)?previous\b|\bprevious\s+version\s+was\s+better\b/i.test(text)
	);
}

export function applyChatFollowUpEditControl(args: {
	document: AxcutDocument;
	userMessage: string;
	aspectValue?: number;
}): { document: AxcutDocument; mutated: boolean; userFacingText: string } {
	const t = args.userMessage.trim();
	let doc = args.document;
	const aspect = args.aspectValue ?? 16 / 9;

	if (/\bremove\s+(?:that\s+|the\s+)?(?:last\s+)?zoom\b/i.test(t)) {
		const zooms = [...(doc.zoomRanges ?? [])];
		if (zooms.length === 0) {
			return {
				document: doc,
				mutated: false,
				userFacingText: "There isn't a zoom on the timeline to remove.",
			};
		}
		zooms.pop();
		doc = { ...doc, zoomRanges: zooms };
		return {
			document: doc,
			mutated: true,
			userFacingText: "I removed the latest zoom from the timeline.",
		};
	}

	if (/\b(?:undo|revert)\s+(?:that\s+|the\s+)?(?:last\s+)?zoom\b/i.test(t)) {
		const zooms = [...(doc.zoomRanges ?? [])];
		if (zooms.length === 0) {
			return {
				document: doc,
				mutated: false,
				userFacingText: "There isn't a zoom on the timeline to remove.",
			};
		}
		zooms.pop();
		doc = { ...doc, zoomRanges: zooms };
		return {
			document: doc,
			mutated: true,
			userFacingText: "I removed the latest zoom from the timeline.",
		};
	}

	if (/\b(?:undo|revert)\s+(?:that\s+|the\s+)?(?:last\s+)?(?:change|edit|mutation)\b/i.test(t)) {
		const zooms = [...(doc.zoomRanges ?? [])];
		if (zooms.length > 0) {
			zooms.pop();
			doc = { ...doc, zoomRanges: zooms };
			return {
				document: doc,
				mutated: true,
				userFacingText:
					"I undid the latest zoom. For a full rewind of the chat turn, use the rewind control on that message.",
			};
		}
		const trims = [...(doc.timeline?.trimRanges ?? [])];
		if (trims.length > 0) {
			trims.pop();
			doc = {
				...doc,
				timeline: { ...doc.timeline, trimRanges: trims },
			};
			return {
				document: doc,
				mutated: true,
				userFacingText:
					"I removed the latest trim. For a full rewind of the chat turn, use the rewind control on that message.",
			};
		}
		return {
			document: doc,
			mutated: false,
			userFacingText:
				"I couldn't find a recent zoom or trim to undo in the document. Use the rewind control on the chat message for a full restore.",
		};
	}

	if (/\b(?:make\s+(?:the\s+)?captions?\s+smaller|captions?\s+smaller)\b/i.test(t)) {
		const cur = getCaptionSettings(doc, aspect);
		if (!cur.enabled) {
			return {
				document: doc,
				mutated: false,
				userFacingText: "Captions aren't enabled, so there's no caption size to change.",
			};
		}
		const nextSize = Math.max(12, Math.round(cur.fontSize * 0.85));
		doc = patchCaptionSettings(doc, { fontSize: nextSize }, aspect);
		return {
			document: doc,
			mutated: true,
			userFacingText: `I made the captions a bit smaller (about ${nextSize}px at 1080p).`,
		};
	}

	if (/\bmake\s+the\s+audio\s+(?:a\s+little\s+)?quieter\b/i.test(t)) {
		const legacy = { ...((doc.legacyEditor as Record<string, unknown>) ?? {}) };
		const cur = typeof legacy.audioGainDb === "number" ? legacy.audioGainDb : 0;
		legacy.audioGainDb = cur - 2;
		doc = { ...doc, legacyEditor: legacy };
		return {
			document: doc,
			mutated: true,
			userFacingText: "I turned the audio down a little.",
		};
	}

	if (/\bmake\s+the\s+audio\s+(?:a\s+little\s+)?louder\b/i.test(t)) {
		const legacy = { ...((doc.legacyEditor as Record<string, unknown>) ?? {}) };
		const cur = typeof legacy.audioGainDb === "number" ? legacy.audioGainDb : 0;
		legacy.audioGainDb = cur + 2;
		doc = { ...doc, legacyEditor: legacy };
		return {
			document: doc,
			mutated: true,
			userFacingText: "I turned the audio up a little.",
		};
	}

	return {
		document: doc,
		mutated: false,
		userFacingText: "I couldn't apply that follow-up edit automatically.",
	};
}
