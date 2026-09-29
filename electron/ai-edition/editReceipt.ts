/**
 * Turn receipts for Local CLI / agent edits.
 * Primary chat shows a short outcome; full tool lines stay on the message for
 * an expandable activity panel (Cursor-style Level 1 vs Level 2).
 */

export interface EditReceiptLine {
	name: string;
	summary: string;
}

/** Technical dump — for expandable activity details, not the chat bubble. */
export function formatEditReceipt(lines: EditReceiptLine[]): string {
	if (lines.length === 0) return "";
	const body = lines.map((line, i) => `${i + 1}. ${line.name}: ${line.summary}`).join("\n");
	return (
		`Receipt — applied ${lines.length} edit${lines.length === 1 ? "" : "s"}:\n${body}` +
		`\nUndo: use the chat rewind control on the previous user message to restore the project to before this turn.`
	);
}

/**
 * Drop contradictory "Your project was not changed" copy when tools already mutated.
 * Grounding honesty sometimes appends that boilerplate after a successful graphic place.
 */
export function stripFalseNotChangedClaim(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) return trimmed;
	return trimmed
		.split(/\n{2,}/)
		.filter((para) => !/\byour project was not changed\b/i.test(para))
		.join("\n\n")
		.trim();
}

/** Remove verbose "Receipt — applied N edits…" blocks from model / host text. */
export function stripEmbeddedReceipt(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) return trimmed;
	// Drop a receipt section anywhere (start or after prose), plus Undo lines.
	return trimmed
		.replace(/(?:^|\n+)Receipt\s*[—–-]\s*applied\s+\d+\s+edits?:[\s\S]*?(?=\n\n[A-Z]|\n*$)/gi, "")
		.replace(/\n*Undo:\s*use the chat rewind[^\n]*/gi, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

const REMOVE_LIKE =
	/^(removeModifier|removeAnnotation|removeGraphic|removeZoom|removeCursorHighlight|removePrivacyCover|removeClip)$/i;
const ADD_GRAPHIC_LIKE = /^(addGraphic|addAnnotation|addBeatGraphics)$/i;
const ADD_ZOOM_LIKE = /^(addZoom|updateZoom)$/i;
const MEDIA_LIKE = /^(importMedia|insertStartThumbnail|createMotionGraphicPreview)$/i;
const INSPECT_LIKE =
	/^(getCurrentDocument|listSources|listTransitions|getTranscript|getTranscriptWords|getCursorTrack|listCharacters)$/i;

function batchLabel(name: string, count: number, sampleSummary?: string): string {
	if (REMOVE_LIKE.test(name)) {
		return count === 1
			? "Removed an obsolete timeline overlay."
			: `Cleaned ${count} obsolete/duplicated timeline overlays.`;
	}
	if (ADD_GRAPHIC_LIKE.test(name)) {
		if (name === "addBeatGraphics") {
			return count === 1 ? "Added beat graphics." : `Added beat graphics (${count} batches).`;
		}
		return count === 1 ? "Added a graphic overlay." : `Added ${count} graphic overlays.`;
	}
	if (ADD_ZOOM_LIKE.test(name)) {
		return count === 1 ? "Added a zoom." : `Added ${count} zooms.`;
	}
	if (MEDIA_LIKE.test(name)) {
		if (name === "createMotionGraphicPreview") {
			return count === 1
				? "Created a motion graphic preview."
				: `Created ${count} motion graphic previews.`;
		}
		if (name === "insertStartThumbnail") return "Updated the start cover.";
		return count === 1 ? "Imported media onto the timeline." : `Imported media (${count}).`;
	}
	if (INSPECT_LIKE.test(name)) {
		return count === 1 ? "Inspected the project." : `Inspected the project (${count} reads).`;
	}
	if (sampleSummary && count === 1) {
		return sampleSummary.replace(/\s+/g, " ").trim().slice(0, 120);
	}
	return count === 1 ? `Applied ${name}.` : `Applied ${name} ×${count}.`;
}

/**
 * Compact, outcome-oriented summary of tool activity for the primary chat bubble
 * when the model did not write a short final message.
 */
export function summarizeToolActivity(lines: EditReceiptLine[]): string {
	if (lines.length === 0) return "";
	const groups = new Map<string, { count: number; sample?: string }>();
	for (const line of lines) {
		const key = line.name || "edit";
		const prev = groups.get(key);
		if (prev) {
			prev.count += 1;
		} else {
			groups.set(key, { count: 1, sample: line.summary });
		}
	}
	const parts: string[] = [];
	for (const [name, { count, sample }] of groups) {
		parts.push(batchLabel(name, count, sample));
	}
	if (parts.length === 1) return `Done — ${parts[0].replace(/\.$/, "")}.`;
	const head = parts.slice(0, -1).join(" ");
	const last = parts[parts.length - 1];
	return `Done — ${head.replace(/\.$/, "")}; ${last.charAt(0).toLowerCase()}${last.slice(1)}`;
}

/**
 * Prepare the user-facing assistant bubble: strip false "not changed" claims and
 * verbose receipts. Do not append a technical receipt — that lives on toolCalls.
 */
export function prepareAssistantContent(text: string, lines: EditReceiptLine[]): string {
	const cleaned = stripEmbeddedReceipt(stripFalseNotChangedClaim(text));
	if (cleaned) return cleaned;
	if (lines.length === 0) return cleaned;
	return summarizeToolActivity(lines);
}

/**
 * @deprecated Prefer prepareAssistantContent — receipts stay off the primary bubble.
 * Kept for callers/tests that still expect a receipt append when missing.
 */
export function appendEditReceiptIfNeeded(text: string, lines: EditReceiptLine[]): string {
	return prepareAssistantContent(text, lines);
}
