/**
 * Compact trusted editorial briefing for the final model turn (Recovery 4).
 * Keeps Gap/Plan/Proposal in the message without re-dumping full evidence JSON.
 */

import type { EditGapV1 } from "../editGap/types";
import type { EditPlanV1 } from "../editPlan/types";
import type { EditProposalV1 } from "../editProposal/types";
import type { TargetStoryV1 } from "../targetStory/v1/types";

const CONCRETE_EDIT_FAMILIES =
	/\b(?:add\s+)?(?:zooms?|zoom(?:ing)?|crops?|cropping|trims?|trimming|captions?|annotations?|graphics?|transitions?|speed\s+(?:up|changes?)|smart[\s-]?zooms?)\b|\bzoom\s+into\b|\bcut\s+(?:the\s+)?(?:pauses?|silences?|boring)\b|\bremove\s+all\s+boring\b|\bcrop(?:ping)?\s+(?:unnecessary|away|out)\b/i;

export function hasConcreteEditRecommendation(text: string): boolean {
	if (!CONCRETE_EDIT_FAMILIES.test(text)) return false;
	// Meta-denials that mention a family while refusing it are not recommendations.
	if (
		/\b(?:inventing|without|don'?t|do\s+not|no\s+safe|not\s+(?:yet\s+)?(?:recommend|enough)|avoid|unsupported)\b[\s\S]{0,80}\b(?:zooms?|trims?|crops?)\b/i.test(
			text,
		) ||
		/\b(?:zooms?|trims?|crops?)\b[\s\S]{0,80}\b(?:would be guesswork|not\s+grounded|unsupported|without a grounded)\b/i.test(
			text,
		)
	) {
		// Still a recommendation if an imperative recipe is also present.
		if (
			/(?<!don'?t\s)(?<!do\s+not\s)(?<!never\s)(?<!avoid\s)\b(?:add|apply|use|insert)\s+(?:a\s+|some\s+)?(?:zooms?|trims?|crops?)\b|\bzoom\s+into\b|\bcut\s+(?:the\s+)?(?:pauses?|silences?|boring)\b/i.test(
				text,
			)
		) {
			return true;
		}
		return false;
	}
	return true;
}

export function planSupportsConcreteEdits(plan: EditPlanV1 | null | undefined): {
	supported: Set<string>;
	hasActionable: boolean;
	hasNeedsMoreEvidence: boolean;
	preservationOnly: boolean;
} {
	const supported = new Set<string>();
	let hasNeedsMoreEvidence = false;
	if (!plan?.items?.length) {
		return {
			supported,
			hasActionable: false,
			hasNeedsMoreEvidence: false,
			preservationOnly: true,
		};
	}
	for (const item of plan.items) {
		const pref = item.preferredStrategy;
		if (!pref) continue;
		if (pref === "needs_more_evidence") hasNeedsMoreEvidence = true;
		if (
			pref === "trim" ||
			pref === "zoom" ||
			pref === "crop" ||
			pref === "speed" ||
			pref === "caption" ||
			pref === "annotation" ||
			pref === "graphic"
		) {
			supported.add(pref);
		}
	}
	const hasActionable = supported.size > 0;
	const preservationOnly =
		!hasActionable &&
		plan.items.every(
			(i) =>
				i.preferredStrategy === "preserve" ||
				i.preferredStrategy === "no_safe_edit" ||
				i.preferredStrategy === "needs_more_evidence" ||
				!i.preferredStrategy,
		);
	return { supported, hasActionable, hasNeedsMoreEvidence, preservationOnly };
}

/** Strip / rewrite concrete edit advice that Plan does not support. */
export function enforceFinalPlanConsistency(input: {
	userFacingText: string;
	plan: EditPlanV1 | null | undefined;
	gap: EditGapV1 | null | undefined;
	/**
	 * Families grounded by the local product surface this turn
	 * (caption layout / dead-air / orchestration). Merged with Edit Plan support.
	 */
	extraSupportedFamilies?: Iterable<string> | null;
}): { text: string; strippedConcreteAdvice: boolean; reason?: string } {
	const text = input.userFacingText.trim();
	if (!text) return { text, strippedConcreteAdvice: false };

	const support = planSupportsConcreteEdits(input.plan);
	if (input.extraSupportedFamilies) {
		for (const f of input.extraSupportedFamilies) {
			support.supported.add(f);
			if (
				f === "trim" ||
				f === "zoom" ||
				f === "crop" ||
				f === "caption" ||
				f === "speed" ||
				f === "annotation" ||
				f === "graphic"
			) {
				support.hasActionable = true;
				support.preservationOnly = false;
			}
		}
	}
	if (!hasConcreteEditRecommendation(text)) {
		return { text, strippedConcreteAdvice: false };
	}

	// Allow only families the plan (or local surface) explicitly supports.
	const mentionsZoom = /\bzooms?\b|\bzoom(?:ing)?\b|\bzoom\s+into\b/i.test(text);
	const mentionsTrim = /\btrims?\b|\btrimming\b|\bcut\s+(?:the\s+)?(?:pauses?|silences?)/i.test(
		text,
	);
	const mentionsCrop = /\bcrops?\b|\bcropping\b|\breframe\b/i.test(text);
	const mentionsCaption = /\bcaptions?\b/i.test(text);
	const mentionsAnnotation = /\bannotations?\b/i.test(text);
	const mentionsGraphic = /\bgraphics?\b|\btitle\s+card\b|\blower[\s-]?third\b/i.test(text);
	const mentionsSpeed = /\bspeed\s+(?:up|change)|playback\s+rate/i.test(text);
	const mentionsTransition =
		/\b(?:add|apply|use|with)\s+(?:a\s+|some\s+)?transitions?\b|\bclip[- ]to[- ]clip\s+transitions?\b/i.test(
			text,
		) &&
		!/\b(?:can'?t|cannot|don'?t|aren'?t|not\s+(?:yet\s+)?(?:supported|verified))\b.{0,40}\btransitions?\b/i.test(
			text,
		);

	const violations: string[] = [];
	if (mentionsZoom && !support.supported.has("zoom")) violations.push("zoom");
	if (mentionsTrim && !support.supported.has("trim")) violations.push("trim");
	if (mentionsCrop && !support.supported.has("crop")) violations.push("crop");
	if (mentionsCaption && !support.supported.has("caption")) violations.push("caption");
	if (mentionsAnnotation && !support.supported.has("annotation")) violations.push("annotation");
	if (mentionsGraphic && !support.supported.has("graphic")) violations.push("graphic");
	if (mentionsSpeed && !support.supported.has("speed")) violations.push("speed");
	if (mentionsTransition) violations.push("transition");

	if (!violations.length) {
		return { text, strippedConcreteAdvice: false };
	}

	// Rewrite: keep diagnostic prose if present, replace concrete advice with honesty.
	const honest = support.hasNeedsMoreEvidence
		? "I can see this recording and understand the request, but I don't yet have a sufficiently grounded on-screen target or evidence window to recommend a concrete edit. Your project was not changed."
		: support.preservationOnly || !support.hasActionable
			? "From the current evidence, I don't see a safe, recording-specific edit I'd recommend right now. The important meaning in this take should stay intact; inventing tool recipes without a grounded target would be guesswork. Your project was not changed."
			: `I should only recommend edits the evidence supports. I removed unsupported ${violations.join("/")} advice that wasn't grounded in the trusted edit plan. Your project was not changed.`;

	// Prefer keeping understanding paragraphs that don't contain concrete edit recipes.
	const kept = text
		.split(/\n{2,}/)
		.filter((para) => !hasConcreteEditRecommendation(para))
		.join("\n\n")
		.trim();

	const merged = kept ? `${kept}\n\n${honest}` : honest;
	return {
		text: merged,
		strippedConcreteAdvice: true,
		reason: `unsupported concrete advice: ${violations.join(",")}`,
	};
}

export function buildTrustedEditorialBriefing(input: {
	target?: TargetStoryV1 | null;
	gap?: EditGapV1 | null;
	plan?: EditPlanV1 | null;
	proposal?: EditProposalV1 | null;
}): string {
	const lines: string[] = [
		"",
		"TRUSTED_EDITORIAL_PLAN (Recovery 4 — authoritative for concrete edit advice)",
		"Concrete user-facing edit recommendations (zoom/trim/crop/caption/annotation/speed/graphic)",
		"MUST correspond to preferredStrategy on an Edit Plan item below.",
		"If the plan is preservation-only or needs_more_evidence, do NOT invent zooms, trims, or other tool recipes.",
		"Prefer honest 'no safe recording-specific edit yet' over generic professional-video advice.",
		"",
	];

	if (input.target) {
		lines.push(`viewerGoal: ${input.target.viewerGoal.slice(0, 220)}`);
		lines.push(`objectiveKind: ${input.target.objectiveKind}`);
		lines.push(`desiredArc: ${input.target.desiredArc.slice(0, 220)}`);
		const changeBeats = input.target.targetBeats.filter((b) => b.disposition !== "preserve");
		lines.push(
			`targetBeats: ${input.target.targetBeats.length} (non-preserve dispositions: ${changeBeats.length})`,
		);
		for (const b of changeBeats.slice(0, 8)) {
			lines.push(
				`  ${b.id} disposition=${b.disposition} pacing=${b.pacingIntent} ← ${b.sourceBeatIds.join(",")}`,
			);
		}
		if (input.target.removeCandidates.length) {
			lines.push("removeCandidates (editorial only — not trim commands):");
			for (const r of input.target.removeCandidates.slice(0, 6)) {
				lines.push(`  - ${r.text.slice(0, 120)}`);
			}
		}
		if (input.target.unsupportedRequests.length) {
			lines.push("unsupportedRequests:");
			for (const u of input.target.unsupportedRequests.slice(0, 4)) {
				lines.push(`  - ${u.requestText}: ${u.note.slice(0, 140)}`);
			}
		}
		lines.push("");
	}

	if (input.gap) {
		const actionable = input.gap.gaps.filter((g) => g.category !== "preservation_requirement");
		lines.push(
			`editGaps: ${input.gap.gaps.length} total, ${actionable.length} actionable (non-preservation)`,
		);
		for (const g of actionable.slice(0, 8)) {
			const range = g.provenance.sourceRange
				? `${g.provenance.sourceRange.startSourceTimeSec.toFixed(1)}–${g.provenance.sourceRange.endSourceTimeSec.toFixed(1)}s`
				: "range:?";
			lines.push(
				`  [${g.category}] ${range}: ${g.problemStatement.slice(0, 140)} → ${g.desiredChange.slice(0, 100)}`,
			);
		}
		lines.push("");
	}

	if (input.plan) {
		const support = planSupportsConcreteEdits(input.plan);
		lines.push(
			`editPlan items: ${input.plan.items.length}; actionableFamilies=[${[...support.supported].join(",") || "none"}]; preservationOnly=${support.preservationOnly}`,
		);
		for (const item of input.plan.items.slice(0, 10)) {
			lines.push(
				`  ${item.id} preferred=${item.preferredStrategy ?? "?"} :: ${item.editorialIntent.slice(0, 140)}`,
			);
		}
		if (input.plan.summary) {
			lines.push(`planSummary: ${input.plan.summary.slice(0, 220)}`);
		}
		lines.push("");
	}

	const propCount = input.proposal?.proposals?.length ?? 0;
	lines.push(
		`editProposals ready: ${propCount} (0 can be correct — do not invent edits to fill this)`,
	);
	lines.push(
		"HARD RULE: Never recommend zoom/crop/trim/annotation/speed/caption/graphic unless preferredStrategy above lists that family.",
	);
	return lines.join("\n");
}

export function appendTrustedEditorialBriefing(
	userMessage: string | { role: "user"; content: unknown },
	briefing: string,
): string | { role: "user"; content: unknown } {
	if (!briefing.trim()) return userMessage;
	if (typeof userMessage === "string") {
		return `${userMessage}\n${briefing}`;
	}
	const content = userMessage.content;
	if (typeof content === "string") {
		return { role: "user", content: `${content}\n${briefing}` };
	}
	if (Array.isArray(content)) {
		return {
			role: "user",
			content: [...content, { type: "text", text: briefing }],
		};
	}
	return {
		role: "user",
		content: [
			{ type: "text", text: String(content ?? "") },
			{ type: "text", text: briefing },
		],
	};
}
