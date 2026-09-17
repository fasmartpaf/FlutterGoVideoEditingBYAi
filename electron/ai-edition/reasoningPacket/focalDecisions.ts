/**
 * Focal-target decision sidecar — required for FOCAL_EDIT_JUDGMENT.
 */

import type { FocalTargetCandidate } from "./focalTargets";

export type FocalDecisionKind = "HELPFUL" | "NOT_HELPFUL" | "INSUFFICIENT_EVIDENCE";

export type FocalTargetDecision = {
	candidateId: string;
	decision: FocalDecisionKind;
	reason: string;
};

const BLOCK = /FOCAL_TARGET_DECISIONS\s*:\s*(\[[\s\S]*?\])(?=\n\s*[A-Z][A-Z_ ]+:|\n\n|$)/i;
const LINE =
	/\{\s*"?(?:candidateId|id)"?\s*:\s*"([^"]+)"\s*,\s*"?decision"?\s*:\s*"?(HELPFUL|NOT_HELPFUL|INSUFFICIENT_EVIDENCE)"?\s*(?:,\s*"?reason"?\s*:\s*"([^"]*)")?\s*\}/gi;
const COMPACT = /([a-zA-Z0-9_-]+)\s*[=:]\s*(HELPFUL|NOT_HELPFUL|INSUFFICIENT_EVIDENCE)/gi;

export function parseFocalTargetDecisions(text: string): {
	present: boolean;
	decisions: FocalTargetDecision[];
	parseNotes: string[];
} {
	const notes: string[] = [];
	const decisions: FocalTargetDecision[] = [];
	if (!/FOCAL_TARGET_DECISIONS/i.test(text)) {
		return { present: false, decisions: [], parseNotes: ["missing_FOCAL_TARGET_DECISIONS_marker"] };
	}
	const block = text.match(BLOCK);
	const body = block?.[1] ?? text;
	let m: RegExpExecArray | null;
	LINE.lastIndex = 0;
	m = LINE.exec(body);
	while (m !== null) {
		decisions.push({
			candidateId: m[1]!,
			decision: m[2] as FocalDecisionKind,
			reason: m[3] ?? "",
		});
		m = LINE.exec(body);
	}
	if (decisions.length === 0) {
		COMPACT.lastIndex = 0;
		m = COMPACT.exec(body);
		while (m !== null) {
			if (m[1]!.toUpperCase().includes("FOCAL") || m[1]!.includes("_")) {
				decisions.push({
					candidateId: m[1]!,
					decision: m[2] as FocalDecisionKind,
					reason: "",
				});
			}
			m = COMPACT.exec(body);
		}
	}
	if (decisions.length === 0) notes.push("marker_present_but_unparsed");
	return { present: true, decisions, parseNotes: notes };
}

export function validateFocalTargetDecisions(input: {
	text: string;
	candidates: FocalTargetCandidate[];
}): {
	ok: boolean;
	incomplete: boolean;
	hits: Array<{ rule: string; severity: "reject" | "downgrade" | "flag"; note: string }>;
	decisions: FocalTargetDecision[];
} {
	const hits: Array<{ rule: string; severity: "reject" | "downgrade" | "flag"; note: string }> = [];
	if (input.candidates.length === 0) {
		return { ok: true, incomplete: false, hits, decisions: [] };
	}
	const parsed = parseFocalTargetDecisions(input.text);
	if (!parsed.present) {
		hits.push({
			rule: "focal_sidecar_missing",
			severity: "flag",
			note: "FOCAL_TARGET_DECISIONS sidecar required",
		});
		return { ok: false, incomplete: true, hits, decisions: [] };
	}
	const ids = new Set(input.candidates.map((c) => c.id));
	for (const d of parsed.decisions) {
		if (!ids.has(d.candidateId)) {
			hits.push({
				rule: "invented_candidate_id",
				severity: "reject",
				note: `Unknown candidateId ${d.candidateId}`,
			});
		}
	}
	for (const c of input.candidates) {
		if (!parsed.decisions.some((d) => d.candidateId === c.id)) {
			hits.push({
				rule: "candidate_unevaluated",
				severity: "flag",
				note: `Missing decision for ${c.id}`,
			});
		}
	}
	return {
		ok: hits.every((h) => h.severity !== "reject"),
		incomplete: hits.some(
			(h) => h.rule === "focal_sidecar_missing" || h.rule === "candidate_unevaluated",
		),
		hits,
		decisions: parsed.decisions,
	};
}
