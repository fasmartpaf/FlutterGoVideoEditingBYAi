/**
 * Session receipts for professional Chat turns — answer "what changed?"
 * without a provider call (and without inventing timeline edits).
 */

import { getCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";

export interface ProfessionalSessionReceiptV1 {
	projectId: string;
	atIso: string;
	userFacingText: string;
	stepsCommitted: number;
	families: string[];
	assessmentLabel?: string;
}

const receiptsByProject = new Map<string, ProfessionalSessionReceiptV1>();

export function rememberProfessionalSessionReceipt(receipt: ProfessionalSessionReceiptV1): void {
	receiptsByProject.set(receipt.projectId, receipt);
}

export function getProfessionalSessionReceipt(
	projectId: string,
): ProfessionalSessionReceiptV1 | null {
	return receiptsByProject.get(projectId) ?? null;
}

export function clearProfessionalSessionReceiptsForTests(): void {
	receiptsByProject.clear();
}

/** "What improvements did you make?" / "what changed?" — not a new edit. */
export function isChatPriorEditExplainRequest(text: string): boolean {
	const t = text.trim();
	return (
		/\bwhat(?:'s|s|\s+are|\s+were)?\s+(?:the\s+)?improv/i.test(t) ||
		/\bwhat\s+(?:did\s+you|have\s+you)\s+(?:change|edit|improv|do)\b/i.test(t) ||
		/\bwhat\s+changes?\s+(?:did|have)\b/i.test(t) ||
		/\bsummar(?:y|ize)\s+(?:the\s+)?(?:edits?|changes?|improv)/i.test(t) ||
		/\bwhat\s+(?:was|is)\s+(?:changed|edited|improved)\b/i.test(t)
	);
}

function describeLiveDocumentState(document: AxcutDocument): string[] {
	const lines: string[] = [];
	const legacy = (document.legacyEditor as Record<string, unknown> | null) ?? {};
	const gain = typeof legacy.audioGainDb === "number" ? legacy.audioGainDb : null;
	const captionsOn = getCaptionSettings(document, 16 / 9).enabled;
	const zooms = document.zoomRanges?.length ?? 0;
	const trims = document.timeline?.trimRanges?.length ?? 0;
	const speeds =
		(document.timeline?.speedRanges?.length ?? 0) +
		((legacy.speedRegions as unknown[] | undefined)?.length ?? 0);

	if (captionsOn) {
		lines.push(
			"Captions are enabled — they appear on the preview while you play, not as a separate timeline clip.",
		);
	}
	if (gain != null && Math.abs(gain) >= 0.5) {
		lines.push(
			`Audio level is adjusted (${gain > 0 ? "+" : ""}${Math.round(gain)} dB) — you'll hear it on playback; the timeline tracks look the same.`,
		);
	}
	if (trims > 0)
		lines.push(`There ${trims === 1 ? "is" : "are"} ${trims} trim range(s) on the timeline.`);
	if (zooms > 0)
		lines.push(`There ${zooms === 1 ? "is" : "are"} ${zooms} zoom(s) on the timeline.`);
	if (speeds > 0)
		lines.push(`There ${speeds === 1 ? "is" : "are"} ${speeds} speed change(s) applied.`);
	return lines;
}

export function answerChatPriorEditExplain(args: { projectId: string; document: AxcutDocument }): {
	userFacingText: string;
} {
	const receipt = getProfessionalSessionReceipt(args.projectId);
	const live = describeLiveDocumentState(args.document);

	if (receipt && receipt.stepsCommitted > 0) {
		const where = live.length > 0 ? `\n\nHow to see it now:\n- ${live.join("\n- ")}` : "";
		return {
			userFacingText: `${receipt.userFacingText.trim()}${where}`,
		};
	}

	if (live.length > 0) {
		return {
			userFacingText: `Here's what's currently on this project:\n- ${live.join("\n- ")}\n\nThere isn't a clearer pacing/framing reshape on the timeline yet — captions and audio polish don't add new track clips.`,
		};
	}

	if (receipt) {
		return {
			userFacingText:
				receipt.userFacingText.trim() ||
				"I reviewed the recording but didn't keep a verified change on the project.",
		};
	}

	return {
		userFacingText:
			"I don't have a recent professional-edit receipt for this project yet. Ask me to make the video professional (or to remove pauses), and I'll apply verified changes when they're safe.",
	};
}
