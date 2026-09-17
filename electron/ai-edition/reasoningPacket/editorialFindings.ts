/**
 * Editorial evidence synthesis V1 — compact evidence-backed findings for Bounded packets.
 * Findings are NOT edit commands. Reuses Edit Gap taxonomy.
 *
 * Critical fix vs V4: project EditGapV1.gaps (not nonexistent .items).
 */

import type { EditGapItem, EditGapPreserved, EditGapV1 } from "../editGap/types";
import type { EditPlanV1 } from "../editPlan/types";
import type { VideoMemoryV1 } from "../videoMemory";
import type { CorrectionScaffold } from "./correctionScaffold";
import type { FocalTargetCandidate } from "./focalTargets";
import type { PacketEpistemicItem } from "./types";

export type FindingDisposition = "IMPROVE_CANDIDATE" | "PRESERVE" | "LEAVE_AS_IS" | "UNKNOWN";

export type EditorialFinding = {
	id: string;
	/** Edit Gap category or close alias */
	kind: string;
	/** @deprecated alias of kind — kept for V3/V4 validators */
	category: string;
	range: { startSec: number | null; endSec: number | null };
	evidenceRefs: string[];
	confidence: "high" | "medium" | "low";
	preservationImpact: "preserve" | "soft" | "editable";
	statement: string;
	issue?: string;
	whyItMatters?: string;
	epistemicState: "observed" | "spoken" | "supported" | "unknown" | "preserve" | "inferred";
	sourceLayer:
		| "edit_gap"
		| "edit_plan"
		| "known_hint"
		| "focal"
		| "preserve"
		| "speech"
		| "correction"
		| "memory_hint"
		| "synthesis";
	disposition: FindingDisposition;
	linkedClaimIds: string[];
	linkedBeatIds: string[];
	/** Visibility ≠ action note when temporary UI */
	actionClaimForbidden?: boolean;
	auditDisposition?: "keep" | "downgrade" | "reject";
	auditNote?: string;
};

export type EditorialFindingCoverage = {
	status: "SUFFICIENT" | "THIN_BUT_VALID" | "INSUFFICIENT";
	findingSourceCounts: Record<string, number>;
	improveCandidateCount: number;
	preserveCount: number;
	leaveAsIsCount: number;
	unknownCount: number;
	editableEvidencePresent: boolean;
	preservationEvidencePresent: boolean;
	gapGapsAvailable: number;
	gapGapsProjected: number;
	notes: string[];
};

export type EditorialFindingsBuildResult = {
	findings: EditorialFinding[];
	coverage: EditorialFindingCoverage;
	rejected: EditorialFinding[];
};

const GENERIC_PLAN = /^preserve this meaning while pursuing the target viewer experience/i;
const WEAK_OCR_CROP =
	/source-resolution\s+(?:bottom_center|top_chrome|crop)|pixel(?:s)?\s+from\s+\d/i;
const MENU_CHROME = /\bfile\s*[·•|]\s*edit\s*[·•|]|cursor\s*[·•|]\s*file\b/i;
const TEMP_UI =
	/\b(?:restart\s+recording|recording\s+(?:hud|control)|temporary\s+(?:ui|hud)|hud)\b/i;
const CORRECTION_TEXT =
	/\b(?:i\s+mean(?:t)?|actually|correct(?:ed)?\s+myself|rather|instead|supersed)\b/i;

function gapItems(editGapV1: EditGapV1 | null | undefined): EditGapItem[] {
	if (!editGapV1) return [];
	const any = editGapV1 as EditGapV1 & { items?: EditGapItem[] };
	// Prefer real field; tolerate offline fixtures that still use items
	if (Array.isArray(any.gaps) && any.gaps.length) return any.gaps;
	if (Array.isArray(any.items) && any.items.length) return any.items;
	return Array.isArray(any.gaps) ? any.gaps : [];
}

function dispositionFromGap(category: string): FindingDisposition {
	if (category === "preservation_requirement") return "PRESERVE";
	if (category === "missing_target_support" || category === "unsupported_story_implication") {
		return "UNKNOWN";
	}
	return "IMPROVE_CANDIDATE";
}

function normKey(f: EditorialFinding): string {
	const t = (f.issue || f.statement).toLowerCase().replace(/\s+/g, " ").slice(0, 80);
	const r = f.range.startSec != null ? Math.round(f.range.startSec) : -1;
	return `${f.kind}|${f.disposition}|${r}|${t}`;
}

function scoreFinding(f: EditorialFinding): number {
	let s = 0;
	if (f.disposition === "IMPROVE_CANDIDATE") s += 50;
	if (f.disposition === "PRESERVE") s += 30;
	if (f.disposition === "LEAVE_AS_IS") s += 20;
	if (f.disposition === "UNKNOWN") s += 10;
	if (f.sourceLayer === "edit_gap") s += 40;
	if (f.sourceLayer === "correction") s += 35;
	if (f.sourceLayer === "memory_hint") s += 28;
	if (f.sourceLayer === "known_hint") s += 22;
	if (f.sourceLayer === "focal") s += 15;
	if (f.sourceLayer === "edit_plan") s += 8;
	if (f.sourceLayer === "preserve") s += 5;
	if (f.range.startSec != null) s += 15;
	if (f.confidence === "high") s += 10;
	if (f.confidence === "medium") s += 5;
	if (f.kind === "hesitation_or_correction_friction") s += 12;
	if (f.kind === "distracting_temporary_ui") s += 12;
	if (GENERIC_PLAN.test(f.statement)) s -= 50;
	if (WEAK_OCR_CROP.test(f.statement)) s -= 40;
	if (MENU_CHROME.test(f.statement)) s -= 30;
	return s;
}

export function auditEditorialFindings(findings: EditorialFinding[]): {
	audited: EditorialFinding[];
	kept: EditorialFinding[];
	rejected: EditorialFinding[];
	downgraded: EditorialFinding[];
} {
	const seen = new Set<string>();
	const audited: EditorialFinding[] = [];
	const rejected: EditorialFinding[] = [];
	const downgraded: EditorialFinding[] = [];

	for (const raw of findings) {
		const f = { ...raw, category: raw.kind || raw.category };
		const key = normKey(f);
		if (seen.has(key)) {
			f.auditDisposition = "reject";
			f.auditNote = "duplicate";
			rejected.push(f);
			audited.push(f);
			continue;
		}
		seen.add(key);

		if (GENERIC_PLAN.test(f.statement) && f.range.startSec == null) {
			f.auditDisposition = "reject";
			f.auditNote = "generic_plan_boilerplate";
			rejected.push(f);
			audited.push(f);
			continue;
		}

		if (
			WEAK_OCR_CROP.test(f.statement) &&
			!TEMP_UI.test(f.statement) &&
			f.disposition === "IMPROVE_CANDIDATE"
		) {
			f.auditDisposition = "reject";
			f.auditNote = "tool_derived_ocr_crop_without_editorial_signal";
			rejected.push(f);
			audited.push(f);
			continue;
		}

		if (MENU_CHROME.test(f.statement) && f.kind === "passive_context_noise") {
			f.auditDisposition = "downgrade";
			f.auditNote = "menu_chrome_noise";
			f.confidence = "low";
			f.disposition = "LEAVE_AS_IS";
			f.preservationImpact = "soft";
			downgraded.push(f);
			audited.push(f);
			continue;
		}

		f.auditDisposition = "keep";
		audited.push(f);
	}

	const kept = audited
		.filter((f) => f.auditDisposition === "keep" || f.auditDisposition === "downgrade")
		.sort((a, b) => scoreFinding(b) - scoreFinding(a));

	// Compact ranked set: prefer improve, then preserve, leave-as-is, unknown
	const improve = kept.filter((f) => f.disposition === "IMPROVE_CANDIDATE").slice(0, 6);
	const preserve = kept.filter((f) => f.disposition === "PRESERVE").slice(0, 3);
	const leave = kept.filter((f) => f.disposition === "LEAVE_AS_IS").slice(0, 2);
	const unknown = kept.filter((f) => f.disposition === "UNKNOWN").slice(0, 2);
	const finalKept = [...improve, ...preserve, ...leave, ...unknown].slice(0, 10);

	return { audited, kept: finalKept, rejected, downgraded };
}

function fromGapItem(it: EditGapItem): EditorialFinding {
	const disposition = dispositionFromGap(it.category);
	return {
		id: it.id,
		kind: it.category,
		category: it.category,
		range: {
			startSec: it.provenance.sourceRange?.startSourceTimeSec ?? null,
			endSec: it.provenance.sourceRange?.endSourceTimeSec ?? null,
		},
		evidenceRefs: [
			...it.provenance.sourceBeatIds.slice(0, 3),
			...(it.provenance.correctionIds ?? []).slice(0, 2),
		],
		confidence: it.confidence,
		preservationImpact: disposition === "PRESERVE" ? "preserve" : "editable",
		statement: (it.problemStatement || it.desiredChange).slice(0, 200),
		issue: it.problemStatement.slice(0, 200),
		whyItMatters: it.desiredChange.slice(0, 160),
		epistemicState: /spoken/i.test(it.sourceEpistemic)
			? "spoken"
			: /unknown/i.test(it.sourceEpistemic)
				? "unknown"
				: "observed",
		sourceLayer: "edit_gap",
		disposition,
		linkedClaimIds: [],
		linkedBeatIds: it.provenance.sourceBeatIds.slice(0, 4),
		actionClaimForbidden: it.category === "distracting_temporary_ui",
	};
}

function fromPreserved(p: EditGapPreserved): EditorialFinding {
	return {
		id: p.id,
		kind: "preservation_requirement",
		category: "preservation_requirement",
		range: { startSec: null, endSec: null },
		evidenceRefs: p.sourceBeatIds.slice(0, 3),
		confidence: "high",
		preservationImpact: "preserve",
		statement: p.text.slice(0, 180),
		issue: undefined,
		whyItMatters: p.reason.slice(0, 120),
		epistemicState: "preserve",
		sourceLayer: "edit_gap",
		disposition: "PRESERVE",
		linkedClaimIds: [],
		linkedBeatIds: p.sourceBeatIds.slice(0, 4),
	};
}

function fromCorrectionScaffold(
	scaffold: CorrectionScaffold | null | undefined,
): EditorialFinding[] {
	if (!scaffold?.present || scaffold.items.length < 2) return [];
	const out: EditorialFinding[] = [];
	const initial = scaffold.items.find((i) => i.role === "initial_intention");
	const corrected = scaffold.items.find((i) => i.role === "corrected_intention");
	if (initial && corrected) {
		out.push({
			id: `corr_friction_${initial.claimId ?? "0"}`,
			kind: "hesitation_or_correction_friction",
			category: "hesitation_or_correction_friction",
			range: {
				startSec: initial.sourceTimeSec,
				endSec: corrected.sourceTimeSec,
			},
			evidenceRefs: [initial.claimId, corrected.claimId].filter(Boolean) as string[],
			confidence: "high",
			preservationImpact: "editable",
			statement: `Speaker corrected: "${initial.text.slice(0, 80)}" → "${corrected.text.slice(0, 80)}"`,
			issue: "Spoken self-correction creates friction for viewers",
			whyItMatters: "May warrant clarifying or trimming superseded wording — not an action claim",
			epistemicState: "spoken",
			sourceLayer: "correction",
			disposition: "IMPROVE_CANDIDATE",
			linkedClaimIds: [initial.claimId, corrected.claimId].filter(Boolean) as string[],
			linkedBeatIds: [],
			actionClaimForbidden: true,
		});
		out.push({
			id: `corr_preserve_${corrected.claimId ?? "1"}`,
			kind: "preservation_requirement",
			category: "preservation_requirement",
			range: {
				startSec: corrected.sourceTimeSec,
				endSec: corrected.sourceTimeSec,
			},
			evidenceRefs: [corrected.claimId].filter(Boolean) as string[],
			confidence: "high",
			preservationImpact: "preserve",
			statement: `Preserve corrected meaning: ${corrected.text.slice(0, 140)}`,
			whyItMatters: "Corrected intention should survive any edit",
			epistemicState: "preserve",
			sourceLayer: "correction",
			disposition: "PRESERVE",
			linkedClaimIds: [corrected.claimId].filter(Boolean) as string[],
			linkedBeatIds: [],
			actionClaimForbidden: true,
		});
	}
	return out;
}

function fromMemoryHints(memory: VideoMemoryV1 | null | undefined): EditorialFinding[] {
	if (!memory) return [];
	const out: EditorialFinding[] = [];
	for (const [i, h] of memory.temporaryUiHints.slice(0, 4).entries()) {
		out.push({
			id: `mem_temp_ui_${i}`,
			kind: "distracting_temporary_ui",
			category: "distracting_temporary_ui",
			range: { startSec: null, endSec: null },
			evidenceRefs: [`temporaryUi:${i}`],
			confidence: "medium",
			preservationImpact: "editable",
			statement: h.slice(0, 180),
			issue: "Temporary UI / recording control may distract",
			whyItMatters:
				"Visual distraction candidate — does NOT prove the user performed the labeled action",
			epistemicState: "observed",
			sourceLayer: "memory_hint",
			disposition: "IMPROVE_CANDIDATE",
			linkedClaimIds: [],
			linkedBeatIds: [],
			actionClaimForbidden: true,
		});
	}
	for (const [i, h] of memory.passiveChromeHints.slice(0, 3).entries()) {
		out.push({
			id: `mem_passive_${i}`,
			kind: "passive_context_noise",
			category: "passive_context_noise",
			range: { startSec: null, endSec: null },
			evidenceRefs: [`passiveChrome:${i}`],
			confidence: "medium",
			preservationImpact: "soft",
			statement: h.slice(0, 160),
			issue: "Passive chrome visible",
			whyItMatters: "Often LEAVE_AS_IS unless distracting — not proof of opening the app",
			epistemicState: "observed",
			sourceLayer: "memory_hint",
			disposition: "LEAVE_AS_IS",
			linkedClaimIds: [],
			linkedBeatIds: [],
			actionClaimForbidden: true,
		});
	}
	return out;
}

function fromKnown(known: PacketEpistemicItem[]): EditorialFinding[] {
	const out: EditorialFinding[] = [];
	for (const k of known) {
		const text = k.text;
		if (WEAK_OCR_CROP.test(text) && !TEMP_UI.test(text)) continue;
		if (MENU_CHROME.test(text) && !TEMP_UI.test(text)) continue;
		if (
			TEMP_UI.test(text) ||
			/temporary|hud|recording\s+control/i.test(text + (k.provenanceNote ?? ""))
		) {
			out.push({
				id: `known_temp_${out.length}`,
				kind: "distracting_temporary_ui",
				category: "distracting_temporary_ui",
				range: { startSec: k.sourceTimeSec ?? null, endSec: k.sourceTimeSec ?? null },
				evidenceRefs: [k.claimId ?? text.slice(0, 24)],
				confidence: "medium",
				preservationImpact: "editable",
				statement: text.slice(0, 180),
				issue: "Temporary UI visible",
				whyItMatters: "Distraction candidate; restart/open action remains UNKNOWN unless proven",
				epistemicState: "observed",
				sourceLayer: "known_hint",
				disposition: "IMPROVE_CANDIDATE",
				linkedClaimIds: k.claimId ? [k.claimId] : [],
				linkedBeatIds: [],
				actionClaimForbidden: true,
			});
			continue;
		}
		if (/unclear|focus|noise|mismatch|pacing|hesitat|dead.?air/i.test(text)) {
			out.push({
				id: `known_${out.length}`,
				kind: /pacing|dead.?air|hesitat/i.test(text)
					? "pacing_excess"
					: /focus/i.test(text)
						? "unclear_focus"
						: "passive_context_noise",
				category: /pacing|dead.?air|hesitat/i.test(text)
					? "pacing_excess"
					: /focus/i.test(text)
						? "unclear_focus"
						: "passive_context_noise",
				range: { startSec: k.sourceTimeSec ?? null, endSec: k.sourceTimeSec ?? null },
				evidenceRefs: [k.claimId ?? text.slice(0, 24)],
				confidence: "low",
				preservationImpact: "soft",
				statement: text.slice(0, 180),
				epistemicState: "observed",
				sourceLayer: "known_hint",
				disposition: "IMPROVE_CANDIDATE",
				linkedClaimIds: k.claimId ? [k.claimId] : [],
				linkedBeatIds: [],
			});
		}
	}
	return out;
}

function leaveAsIsStableNarration(input: {
	spoken: PacketEpistemicItem[];
	selectedSpeechCount: number;
	improveCount: number;
	userMessage: string;
}): EditorialFinding[] {
	if (input.improveCount > 0) return [];
	if (input.selectedSpeechCount < 2 && input.spoken.length < 2) return [];
	if (!/\bprofessional|improv|polish|edit|zoom\b/i.test(input.userMessage)) return [];
	return [
		{
			id: "leave_stable_narration",
			kind: "stable_useful_section",
			category: "stable_useful_section",
			range: { startSec: null, endSec: null },
			evidenceRefs: input.spoken.slice(0, 2).map((s) => s.claimId ?? s.text.slice(0, 20)),
			confidence: "medium",
			preservationImpact: "soft",
			statement:
				"Narration appears continuous and useful; no grounded improve candidates from available evidence",
			whyItMatters: "Stable useful speech over a screen can be intentional — do not invent polish",
			epistemicState: "supported",
			sourceLayer: "synthesis",
			disposition: "LEAVE_AS_IS",
			linkedClaimIds: [],
			linkedBeatIds: [],
		},
	];
}

function computeCoverage(input: {
	findings: EditorialFinding[];
	gapAvailable: number;
	gapProjected: number;
	editableEvidencePresent: boolean;
	preservationEvidencePresent: boolean;
}): EditorialFindingCoverage {
	const findingSourceCounts: Record<string, number> = {};
	let improve = 0;
	let preserve = 0;
	let leave = 0;
	let unknown = 0;
	for (const f of input.findings) {
		findingSourceCounts[f.sourceLayer] = (findingSourceCounts[f.sourceLayer] ?? 0) + 1;
		if (f.disposition === "IMPROVE_CANDIDATE") improve += 1;
		else if (f.disposition === "PRESERVE") preserve += 1;
		else if (f.disposition === "LEAVE_AS_IS") leave += 1;
		else unknown += 1;
	}

	const notes: string[] = [];
	let status: EditorialFindingCoverage["status"] = "SUFFICIENT";

	if (input.gapAvailable > 0 && input.gapProjected === 0) {
		status = "INSUFFICIENT";
		notes.push("Edit Gap had gaps but none projected — synthesis failure");
	} else if (improve > 0 || (preserve > 0 && leave > 0)) {
		status = "SUFFICIENT";
		notes.push("Improve and/or preserve+leave-as-is present");
	} else if (preserve > 0 || leave > 0) {
		if (input.editableEvidencePresent && improve === 0 && input.gapAvailable === 0) {
			status = "THIN_BUT_VALID";
			notes.push("Preserve/leave-as-is only; no upstream editable gap evidence");
		} else if (input.editableEvidencePresent && improve === 0 && input.gapAvailable > 0) {
			status = "INSUFFICIENT";
			notes.push("Upstream editable evidence existed but no improve candidates kept");
		} else {
			status = "THIN_BUT_VALID";
			notes.push("Preserve-only / leave-as-is may be honest for this recording");
		}
	} else if (input.findings.length === 0) {
		status = input.editableEvidencePresent ? "INSUFFICIENT" : "THIN_BUT_VALID";
		notes.push(
			input.editableEvidencePresent
				? "No findings despite evidence"
				: "Empty findings; no editable evidence",
		);
	}

	return {
		status,
		findingSourceCounts,
		improveCandidateCount: improve,
		preserveCount: preserve,
		leaveAsIsCount: leave,
		unknownCount: unknown,
		editableEvidencePresent: input.editableEvidencePresent,
		preservationEvidencePresent: input.preservationEvidencePresent,
		gapGapsAvailable: input.gapAvailable,
		gapGapsProjected: input.gapProjected,
		notes,
	};
}

export function buildEditorialFindings(input: {
	userMessage: string;
	editGapV1?: EditGapV1 | null;
	editPlanV1?: EditPlanV1 | null;
	known: PacketEpistemicItem[];
	spoken: PacketEpistemicItem[];
	focalTargets: FocalTargetCandidate[];
	preservationConstraints: string[];
	correctionScaffold?: CorrectionScaffold | null;
	memory?: VideoMemoryV1 | null;
	selectedSpeechCount?: number;
}): EditorialFinding[] {
	return synthesizeEditorialFindings(input).findings;
}

export function synthesizeEditorialFindings(input: {
	userMessage: string;
	editGapV1?: EditGapV1 | null;
	editPlanV1?: EditPlanV1 | null;
	known: PacketEpistemicItem[];
	spoken: PacketEpistemicItem[];
	focalTargets: FocalTargetCandidate[];
	preservationConstraints: string[];
	correctionScaffold?: CorrectionScaffold | null;
	memory?: VideoMemoryV1 | null;
	selectedSpeechCount?: number;
}): EditorialFindingsBuildResult {
	const raw: EditorialFinding[] = [];
	const editorialAsk = /\bprofessional|improv|polish|shorter|clearer|edit|zoom|focus\b/i.test(
		input.userMessage,
	);
	if (
		!editorialAsk &&
		!input.editGapV1 &&
		!input.editPlanV1 &&
		!input.correctionScaffold?.present
	) {
		return {
			findings: [],
			coverage: {
				status: "THIN_BUT_VALID",
				findingSourceCounts: {},
				improveCandidateCount: 0,
				preserveCount: 0,
				leaveAsIsCount: 0,
				unknownCount: 0,
				editableEvidencePresent: false,
				preservationEvidencePresent: false,
				gapGapsAvailable: 0,
				gapGapsProjected: 0,
				notes: ["not_an_editorial_ask"],
			},
			rejected: [],
		};
	}

	const gaps = gapItems(input.editGapV1);
	let gapProjected = 0;
	for (const it of gaps.slice(0, 12)) {
		raw.push(fromGapItem(it));
		gapProjected += 1;
	}
	for (const p of input.editGapV1?.preserved?.slice(0, 4) ?? []) {
		raw.push(fromPreserved(p));
	}

	if (input.editPlanV1?.items?.length) {
		for (const it of input.editPlanV1.items.slice(0, 6)) {
			if (raw.some((f) => f.id === it.id || f.id === `plan_${it.id}`)) continue;
			const statement = it.editorialIntent.slice(0, 200);
			if (GENERIC_PLAN.test(statement)) continue;
			if (it.preferredStrategy === "no_safe_edit") {
				raw.push({
					id: `plan_${it.id}`,
					kind: "no_safe_edit",
					category: "no_safe_edit",
					range: {
						startSec: it.evidenceRange?.startSourceTimeSec ?? null,
						endSec: it.evidenceRange?.endSourceTimeSec ?? null,
					},
					evidenceRefs: it.provenanceRefs.slice(0, 3),
					confidence: "medium",
					preservationImpact: "soft",
					statement,
					epistemicState: "inferred",
					sourceLayer: "edit_plan",
					disposition: "LEAVE_AS_IS",
					linkedClaimIds: [],
					linkedBeatIds: it.sourceBeatIds.slice(0, 3),
				});
				continue;
			}
			raw.push({
				id: `plan_${it.id}`,
				kind: it.preferredStrategy ?? "plan_item",
				category: it.preferredStrategy ?? "plan_item",
				range: {
					startSec: it.evidenceRange?.startSourceTimeSec ?? null,
					endSec: it.evidenceRange?.endSourceTimeSec ?? null,
				},
				evidenceRefs: [it.id, ...it.gapIds.slice(0, 2)],
				confidence: it.confidence >= 0.7 ? "high" : "medium",
				preservationImpact: /preserv/i.test(it.preferredStrategy ?? "") ? "preserve" : "soft",
				statement,
				epistemicState: "inferred",
				sourceLayer: "edit_plan",
				disposition: /preserv/i.test(it.preferredStrategy ?? "") ? "PRESERVE" : "IMPROVE_CANDIDATE",
				linkedClaimIds: [],
				linkedBeatIds: it.sourceBeatIds.slice(0, 3),
			});
		}
	}

	raw.push(...fromCorrectionScaffold(input.correctionScaffold));
	raw.push(...fromMemoryHints(input.memory));
	raw.push(...fromKnown(input.known));

	// Spoken correction text without scaffold
	for (const s of input.spoken) {
		if (!CORRECTION_TEXT.test(s.text) && s.provenanceNote !== "correction") continue;
		if (raw.some((f) => f.sourceLayer === "correction")) break;
		raw.push({
			id: `spoken_corr_${raw.length}`,
			kind: "hesitation_or_correction_friction",
			category: "hesitation_or_correction_friction",
			range: { startSec: s.sourceTimeSec ?? null, endSec: s.sourceTimeSec ?? null },
			evidenceRefs: [s.claimId ?? s.text.slice(0, 24)],
			confidence: "medium",
			preservationImpact: "editable",
			statement: s.text.slice(0, 180),
			epistemicState: "spoken",
			sourceLayer: "speech",
			disposition: "IMPROVE_CANDIDATE",
			linkedClaimIds: s.claimId ? [s.claimId] : [],
			linkedBeatIds: [],
			actionClaimForbidden: true,
		});
	}

	const wantsZoom = /\bzoom|crop|focus\b/i.test(input.userMessage);
	if (wantsZoom) {
		for (const f of input.focalTargets.slice(0, 4)) {
			if (f.visibilityConfidence === "low" && f.targetKind === "unknown_salient") continue;
			raw.push({
				id: `focal_${f.id}`,
				kind: "unclear_focus",
				category: "unclear_focus",
				range: f.range,
				evidenceRefs: f.evidenceRefs,
				confidence: f.visibilityConfidence === "high" ? "high" : "medium",
				preservationImpact: "soft",
				statement: `Focal evidence region: ${f.subject.slice(0, 120)}`,
				issue: "Visible focal region exists — zoom decision is separate",
				whyItMatters: "Evidence of focus, not an instruction to zoom",
				epistemicState: "observed",
				sourceLayer: "focal",
				disposition: "IMPROVE_CANDIDATE",
				linkedClaimIds: [],
				linkedBeatIds: [],
			});
		}
	}

	for (const p of input.preservationConstraints.slice(0, 4)) {
		if (GENERIC_PLAN.test(p)) continue;
		raw.push({
			id: `preserve_${raw.length}`,
			kind: "preservation_requirement",
			category: "preservation_requirement",
			range: { startSec: null, endSec: null },
			evidenceRefs: ["preserve"],
			confidence: "high",
			preservationImpact: "preserve",
			statement: p.slice(0, 180),
			epistemicState: "preserve",
			sourceLayer: "preserve",
			disposition: "PRESERVE",
			linkedClaimIds: [],
			linkedBeatIds: [],
		});
	}

	const preImprove = raw.filter((f) => f.disposition === "IMPROVE_CANDIDATE").length;
	raw.push(
		...leaveAsIsStableNarration({
			spoken: input.spoken,
			selectedSpeechCount: input.selectedSpeechCount ?? input.spoken.length,
			improveCount: preImprove,
			userMessage: input.userMessage,
		}),
	);

	const { kept, rejected } = auditEditorialFindings(raw);

	const editableEvidencePresent =
		gaps.some((g) => dispositionFromGap(g.category) === "IMPROVE_CANDIDATE") ||
		(input.memory?.temporaryUiHints.length ?? 0) > 0 ||
		raw.some(
			(f) =>
				f.disposition === "IMPROVE_CANDIDATE" &&
				(f.sourceLayer === "correction" ||
					f.sourceLayer === "memory_hint" ||
					f.sourceLayer === "edit_gap"),
		);

	const coverage = computeCoverage({
		findings: kept,
		gapAvailable: gaps.length,
		gapProjected,
		editableEvidencePresent,
		preservationEvidencePresent:
			kept.some((f) => f.disposition === "PRESERVE") || input.preservationConstraints.length > 0,
	});

	return { findings: kept, coverage, rejected };
}

export function groupFindingsForSerialize(findings: EditorialFinding[]): {
	improve: EditorialFinding[];
	preserve: EditorialFinding[];
	leaveAsIs: EditorialFinding[];
	unknown: EditorialFinding[];
} {
	return {
		improve: findings.filter((f) => f.disposition === "IMPROVE_CANDIDATE"),
		preserve: findings.filter((f) => f.disposition === "PRESERVE"),
		leaveAsIs: findings.filter((f) => f.disposition === "LEAVE_AS_IS"),
		unknown: findings.filter((f) => f.disposition === "UNKNOWN"),
	};
}
