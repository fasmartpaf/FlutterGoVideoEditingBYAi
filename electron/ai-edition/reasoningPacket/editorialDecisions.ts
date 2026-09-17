/**
 * Editorial decision sidecar — machine-checkable bridge from findings → model judgment.
 * Not shown to end users.
 */

import type { EditorialFinding } from "./editorialFindings";

export type EditorialDecisionDisposition =
	| "IMPROVE"
	| "PRESERVE"
	| "IGNORE"
	| "INSUFFICIENT_EVIDENCE";

export type EditorialDecision = {
	findingId: string;
	disposition: EditorialDecisionDisposition;
	rationale: string;
};

const BLOCK = /EDITORIAL_DECISIONS\s*:\s*(\[[\s\S]*?\])(?=\n\s*[A-Z][A-Z_ ]+:|\n\n|$)/i;
const LINE =
	/\{\s*"?findingId"?\s*:\s*"([^"]+)"\s*,\s*"?disposition"?\s*:\s*"?(IMPROVE|PRESERVE|IGNORE|INSUFFICIENT_EVIDENCE)"?\s*(?:,\s*"?rationale"?\s*:\s*"([^"]*)")?\s*\}/gi;
const LINE_COMPACT =
	/(?:findingId|id)\s*[=:]\s*([a-zA-Z0-9_-]+)\s*[,; ]+\s*(?:disposition|decision)\s*[=:]\s*(IMPROVE|PRESERVE|IGNORE|INSUFFICIENT_EVIDENCE)/gi;

export function parseEditorialDecisions(text: string): {
	present: boolean;
	decisions: EditorialDecision[];
	parseNotes: string[];
} {
	const notes: string[] = [];
	const decisions: EditorialDecision[] = [];
	const block = text.match(BLOCK);
	const body = block?.[1] ?? text;

	if (!/EDITORIAL_DECISIONS/i.test(text)) {
		return { present: false, decisions: [], parseNotes: ["missing_EDITORIAL_DECISIONS_marker"] };
	}

	let m: RegExpExecArray | null;
	LINE.lastIndex = 0;
	m = LINE.exec(body);
	while (m !== null) {
		decisions.push({
			findingId: m[1]!,
			disposition: m[2] as EditorialDecisionDisposition,
			rationale: m[3] ?? "",
		});
		m = LINE.exec(body);
	}
	if (decisions.length === 0) {
		LINE_COMPACT.lastIndex = 0;
		m = LINE_COMPACT.exec(body);
		while (m !== null) {
			decisions.push({
				findingId: m[1]!,
				disposition: m[2] as EditorialDecisionDisposition,
				rationale: "",
			});
			m = LINE_COMPACT.exec(body);
		}
	}
	if (decisions.length === 0) notes.push("marker_present_but_unparsed");
	return { present: true, decisions, parseNotes: notes };
}

export function validateEditorialDecisions(input: { text: string; findings: EditorialFinding[] }): {
	ok: boolean;
	incomplete: boolean;
	hits: Array<{ rule: string; severity: "reject" | "downgrade" | "flag"; note: string }>;
	decisions: EditorialDecision[];
} {
	const hits: Array<{ rule: string; severity: "reject" | "downgrade" | "flag"; note: string }> = [];
	const parsed = parseEditorialDecisions(input.text);
	if (input.findings.length === 0) {
		return { ok: true, incomplete: false, hits, decisions: [] };
	}
	if (!parsed.present) {
		hits.push({
			rule: "editorial_sidecar_missing",
			severity: "flag",
			note: "EDITORIAL_DECISIONS sidecar required for EDITORIAL_DIAGNOSIS",
		});
		return { ok: false, incomplete: true, hits, decisions: [] };
	}

	const ids = new Set(input.findings.map((f) => f.id));
	for (const d of parsed.decisions) {
		if (!ids.has(d.findingId)) {
			hits.push({
				rule: "invented_finding_id",
				severity: "reject",
				note: `Unknown findingId ${d.findingId}`,
			});
		}
		const f = input.findings.find((x) => x.id === d.findingId);
		if (f?.disposition === "PRESERVE" && d.disposition === "IMPROVE") {
			// soft: improving a preserve finding is odd but IMPROVE on preserve means "protect" mis-map
		}
		if (
			f?.disposition === "PRESERVE" &&
			/\b(?:remove|delete|trim|cut)\b/i.test(d.rationale) &&
			d.disposition === "IMPROVE"
		) {
			hits.push({
				rule: "preserve_to_removal",
				severity: "reject",
				note: `Preserve finding ${d.findingId} must not become removal`,
			});
		}
	}

	const material = input.findings.filter(
		(f) => f.disposition === "IMPROVE_CANDIDATE" || f.disposition === "PRESERVE",
	);
	for (const f of material.slice(0, 8)) {
		if (!parsed.decisions.some((d) => d.findingId === f.id)) {
			hits.push({
				rule: "finding_unevaluated",
				severity: "flag",
				note: `Missing decision for ${f.id}`,
			});
		}
	}

	return {
		ok: hits.every((h) => h.severity !== "reject"),
		incomplete: hits.some(
			(h) => h.rule === "editorial_sidecar_missing" || h.rule === "finding_unevaluated",
		),
		hits,
		decisions: parsed.decisions,
	};
}
