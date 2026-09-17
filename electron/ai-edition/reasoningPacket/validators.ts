/**
 * Bounded response validators — V3 + Editorial Evidence Synthesis V1 sidecars.
 */

import type { CrossModalEvidenceRelation } from "./crossModal";
import { validateEditorialDecisions } from "./editorialDecisions";
import type { EditorialFinding } from "./editorialFindings";
import { validateFocalTargetDecisions } from "./focalDecisions";
import type { FocalTargetCandidate } from "./focalTargets";

export type ValidatorHit = {
	rule: string;
	severity: "reject" | "downgrade" | "flag";
	excerpt: string;
	note: string;
};

export type BoundedValidationResult = {
	ok: boolean;
	hits: ValidatorHit[];
	text: string;
	notes: string[];
	incomplete?: boolean;
};

const AGREEMENT =
	/\b(?:no\s+discrepanc\w*|everything\s+matches|fully\s+consistent|confirmed\s+match|perfectly\s+match|no\s+differences?\b|speech\s+and\s+(?:the\s+)?(?:screen|visuals?)\s+(?:are|seem|look)\s+consistent)\b/i;

const GENERIC_ADVICE: Array<{ id: string; pattern: RegExp }> = [
	{ id: "add_transitions", pattern: /\badd\s+(?:smooth\s+)?transitions?\b/i },
	{
		id: "improve_mic",
		pattern:
			/\b(?:improve|enhance)\s+(?:the\s+)?(?:microphone|mic|audio\s+clarity|audio\s+quality)\b/i,
	},
	{ id: "add_zooms", pattern: /\badd\s+(?:more\s+)?zooms?\b|\buse\s+more\s+zooms?\b/i },
	{ id: "add_animations", pattern: /\badd\s+animations?\b/i },
	{ id: "add_captions", pattern: /\badd\s+captions?\b/i },
	{ id: "improve_pacing", pattern: /\bimprove\s+(?:the\s+)?pacing\b/i },
];

const ACTION_FROM_VISIBILITY =
	/\b(?:the\s+user\s+)?(?:restarted|did\s+restart|opened\s+settings|opened\s+upwork|clicked\s+restart)\b(?![^.]{0,40}\b(?:unknown|uncertain|cannot\s+verif|not\s+proven|remains\s+unknown)\b)/i;

export function validateCrossModalResponse(input: {
	text: string;
	relations: CrossModalEvidenceRelation[];
}): BoundedValidationResult {
	const hits: ValidatorHit[] = [];
	let text = input.text;
	const notes: string[] = [];

	const unverified = input.relations.filter(
		(r) =>
			r.visualSupport === "NOT_VISUALLY_VERIFIED" ||
			r.visualSupport === "UNKNOWN" ||
			r.visualSupport === "CONTRADICTED",
	);

	if (unverified.length > 0 && AGREEMENT.test(text)) {
		hits.push({
			rule: "cross_modal_false_agreement",
			severity: "downgrade",
			excerpt: text.match(AGREEMENT)?.[0] ?? "agreement phrase",
			note: "Cannot promote NOT_VISUALLY_VERIFIED/UNKNOWN/CONTRADICTED to match",
		});
		text = text
			.replace(AGREEMENT, "cannot be visually verified from the selected evidence")
			.replace(/\bwith\s+no\s+discrepanc\w*\b/gi, "")
			.replace(/\bno\s+discrepanc\w*\b/gi, "cannot verify")
			.replace(/\s{2,}/g, " ")
			.trim();
		notes.push(
			"Downgraded unsupported agreement claim; unverified spoken claims remain cannot_verify.",
		);
		if (!/cannot\s+verif/i.test(text)) {
			text +=
				"\n\nNote: Some spoken claims are NOT_VISUALLY_VERIFIED in the evidence packet and must not be treated as matches.";
		}
	}

	return { ok: hits.length === 0, hits, text, notes };
}

export function validateFocalTargetResponse(input: {
	text: string;
	candidates: FocalTargetCandidate[];
	userMessage: string;
	decisions?: Array<{ id: string; decision: string }>;
}): BoundedValidationResult {
	const hits: ValidatorHit[] = [];
	const notes: string[] = [];
	const text = input.text;
	const wantsZoom = /\bzoom|crop|focus|highlight\b/i.test(input.userMessage);
	if (!wantsZoom || input.candidates.length === 0) {
		return { ok: true, hits, text, notes };
	}

	const sidecar = validateFocalTargetDecisions({
		text,
		candidates: input.candidates,
	});
	for (const h of sidecar.hits) {
		hits.push({ rule: h.rule, severity: h.severity, excerpt: h.rule, note: h.note });
	}
	if (sidecar.incomplete) notes.push("focal_sidecar_incomplete");

	return {
		ok: hits.every((h) => h.severity !== "reject"),
		hits,
		text,
		notes,
		incomplete: sidecar.incomplete,
	};
}

export function validateEditorialSpecificity(input: {
	text: string;
	findings: EditorialFinding[];
	requireSidecar?: boolean;
}): BoundedValidationResult {
	const hits: ValidatorHit[] = [];
	let text = input.text;
	const notes: string[] = [];
	let incomplete = false;

	const noChange =
		/\bdon'?t\s+see\s+a\s+(?:safe\s+)?recording-specific|no\s+recording-specific\s+change|no\s+safe\s+edit|does\s+not\s+show\s+a\s+safe\b/i.test(
			text,
		);

	if (input.requireSidecar !== false && input.findings.length > 0) {
		const side = validateEditorialDecisions({ text, findings: input.findings });
		for (const h of side.hits) {
			hits.push({ rule: h.rule, severity: h.severity, excerpt: h.rule, note: h.note });
		}
		incomplete = side.incomplete;
	}

	// temporary UI visibility must not become restart action
	const tempFindings = input.findings.filter(
		(f) => f.kind === "distracting_temporary_ui" || f.actionClaimForbidden,
	);
	if (tempFindings.length > 0 && ACTION_FROM_VISIBILITY.test(text)) {
		hits.push({
			rule: "visibility_to_action",
			severity: "reject",
			excerpt: "restarted/opened from visibility",
			note: "Temporary UI visibility cannot become a verified user action",
		});
	}

	for (const g of GENERIC_ADVICE) {
		if (!g.pattern.test(text)) continue;
		const grounded = input.findings.some((f) => {
			const blob = `${f.kind}${f.category}${f.statement}`;
			if (g.id === "add_zooms") return /focus|zoom|unclear_focus/i.test(blob);
			if (g.id === "improve_mic") return /audio|speech|dead_air|pacing/i.test(blob);
			if (g.id === "improve_pacing") return /pacing|dead_air|hesitation|repetition/i.test(blob);
			if (g.id === "add_transitions") return /transition|continuity|weak_transition/i.test(blob);
			if (g.id === "add_captions") return /caption|clarity|speech/i.test(blob);
			return false;
		});
		if (!grounded) {
			hits.push({
				rule: `generic_${g.id}`,
				severity: "downgrade",
				excerpt: g.id,
				note: "recommendation_without_grounding",
			});
		}
	}

	if (hits.some((h) => h.rule.startsWith("generic_"))) {
		notes.push("Flagged unsupported generic polish recommendations.");
		const improve = input.findings.filter((f) => f.disposition === "IMPROVE_CANDIDATE");
		if (improve.length === 0) {
			if (!noChange) {
				text +=
					"\n\nI don't see a recording-specific change I'd make here based on the available editorial findings.";
			}
		} else {
			const refs = improve
				.slice(0, 2)
				.map((f) => `${f.kind}: ${f.statement.slice(0, 80)}`)
				.join("; ");
			text += `\n\n(Grounded findings to prefer: ${refs})`;
		}
	}

	const recommends =
		/\b(?:recommend|suggest|should|trim|zoom|crop|remove|hide|cut)\b/i.test(text) && !noChange;
	if (recommends && input.findings.length > 0) {
		const citesFinding = input.findings.some(
			(f) =>
				text.includes(f.id) ||
				text.toLowerCase().includes(f.kind.toLowerCase().slice(0, 12)) ||
				(f.range.startSec != null && text.includes(String(Math.floor(f.range.startSec)))),
		);
		if (!citesFinding && hits.every((h) => !h.rule.startsWith("generic_"))) {
			hits.push({
				rule: "recommendation_without_finding_ref",
				severity: "flag",
				excerpt: "recommendation",
				note: "Editorial recommendation should reference an EDITORIAL_FINDINGS item",
			});
		}
	}

	// Preserve findings must not be silently removed
	for (const f of input.findings.filter((x) => x.disposition === "PRESERVE")) {
		const removePreserve =
			new RegExp(`\\b(?:remove|delete|cut)\\b[^.\\n]{0,40}${f.id}`, "i").test(text) ||
			(/\bremove\b/i.test(text) &&
				f.statement.length > 20 &&
				text.includes(f.statement.slice(0, 24)));
		if (removePreserve) {
			hits.push({
				rule: "preserve_removal",
				severity: "reject",
				excerpt: f.id,
				note: "Preserve finding must not become a removal recommendation",
			});
		}
	}

	return {
		ok: hits.filter((h) => h.severity === "reject").length === 0,
		hits,
		text,
		notes,
		incomplete,
	};
}

export function applyBoundedResponseValidators(input: {
	text: string;
	userMessage: string;
	relations: CrossModalEvidenceRelation[];
	focalCandidates: FocalTargetCandidate[];
	editorialFindings: EditorialFinding[];
	decisionKind?: string;
}): BoundedValidationResult {
	const notes: string[] = [];
	const hits: ValidatorHit[] = [];
	let text = input.text;
	let incomplete = false;

	const cm = validateCrossModalResponse({ text, relations: input.relations });
	text = cm.text;
	hits.push(...cm.hits);
	notes.push(...cm.notes);

	const focal = validateFocalTargetResponse({
		text,
		candidates: input.focalCandidates,
		userMessage: input.userMessage,
	});
	hits.push(...focal.hits);
	notes.push(...focal.notes);
	incomplete = incomplete || Boolean(focal.incomplete);

	const requireSidecar =
		input.decisionKind === "EDITORIAL_DIAGNOSIS" ||
		(/\bprofessional|improv|polish\b/i.test(input.userMessage) &&
			input.editorialFindings.length > 0);

	const ed = validateEditorialSpecificity({
		text,
		findings: input.editorialFindings,
		requireSidecar,
	});
	text = ed.text;
	hits.push(...ed.hits);
	notes.push(...ed.notes);
	incomplete = incomplete || Boolean(ed.incomplete);

	return {
		ok:
			hits.filter((h) => h.severity !== "reject").length >= 0 &&
			hits.every((h) => h.severity !== "reject"),
		hits,
		text,
		notes,
		incomplete,
	};
}
