/**
 * Focal-target candidates for editorial/zoom questions — Reliability V2.
 * Retrieval identifies candidates; model decides ZOOM_HELPFUL / NOT / INSUFFICIENT.
 */

import type { AttachedFrameMeta } from "../videoMemory/productionPath";
import type { PacketEpistemicItem } from "./types";

export type FocalTargetCandidate = {
	id: string;
	range: { startSec: number; endSec: number };
	subject: string;
	evidenceRefs: string[];
	targetKind:
		| "ui_region"
		| "editor_area"
		| "temporary_hud"
		| "transition_region"
		| "cursor_focus"
		| "ocr_text_region"
		| "unknown_salient";
	visibilityConfidence: "high" | "medium" | "low";
	reasonCandidate: string;
};

const ZOOM_ASK = /\bzoom\b/i;

export function wantsFocalTargets(userMessage: string, queryClass: string): boolean {
	// V4: do not attach focal candidates to every editorial ask — only zoom/focus judgment.
	return (
		ZOOM_ASK.test(userMessage) ||
		/\bfocal|focus\s+on|where would\s+a\s+zoom|annotation\s+emphasis\b/i.test(userMessage) ||
		(queryClass === "editorial" && /\bzoom|crop|focus|highlight\b/i.test(userMessage))
	);
}

export function buildFocalTargetCandidates(input: {
	userMessage: string;
	queryClass: string;
	frameMeta: AttachedFrameMeta[];
	known: PacketEpistemicItem[];
	spoken: PacketEpistemicItem[];
}): FocalTargetCandidate[] {
	if (!wantsFocalTargets(input.userMessage, input.queryClass)) return [];

	const out: FocalTargetCandidate[] = [];
	let i = 0;

	for (const f of input.frameMeta) {
		if (
			f.reason === "editorial_focus" ||
			f.reason === "relevance_deepen" ||
			f.reason === "event_region"
		) {
			i += 1;
			out.push({
				id: `focal_frame_${i}`,
				range: { startSec: f.sourceTimeSec, endSec: f.sourceTimeSec + 1.5 },
				subject: f.note.slice(0, 120) || `salient frame @ ${f.sourceTimeSec.toFixed(2)}s`,
				evidenceRefs: [`frame:${f.sourceTimeSec.toFixed(2)}`, f.reason],
				targetKind:
					f.reason === "event_region"
						? "transition_region"
						: f.reason === "editorial_focus"
							? "editor_area"
							: "unknown_salient",
				visibilityConfidence: "medium",
				reasonCandidate: `Attached for ${f.reason}; evaluate whether a specific visible subject warrants zoom`,
			});
		}
	}

	for (const k of input.known) {
		if (!/visible text|ocr|readable text|crop|region/i.test(k.text + (k.provenanceNote ?? ""))) {
			continue;
		}
		if (out.length >= 8) break;
		i += 1;
		const t = k.sourceTimeSec ?? 0;
		out.push({
			id: `focal_ocr_${i}`,
			range: { startSec: t, endSec: t + 2 },
			subject: k.text.slice(0, 140),
			evidenceRefs: [k.claimId ?? `known:${i}`],
			targetKind: /hud|restart|recording/i.test(k.text) ? "temporary_hud" : "ocr_text_region",
			visibilityConfidence: "medium",
			reasonCandidate:
				"OCR/visible-text region — decide ZOOM_HELPFUL only if a concrete readable focal target exists",
		});
	}

	// Coverage-only frames as weak candidates when nothing else
	if (out.length === 0) {
		for (const f of input.frameMeta.slice(0, 3)) {
			i += 1;
			out.push({
				id: `focal_coverage_${i}`,
				range: { startSec: f.sourceTimeSec, endSec: f.sourceTimeSec + 1 },
				subject: `Coverage sample @ ${f.sourceTimeSec.toFixed(2)}s`,
				evidenceRefs: [`frame:${f.sourceTimeSec.toFixed(2)}`],
				targetKind: "unknown_salient",
				visibilityConfidence: "low",
				reasonCandidate: "Coverage sample only — may be INSUFFICIENT_EVIDENCE for zoom",
			});
		}
	}

	return out.slice(0, 8);
}
