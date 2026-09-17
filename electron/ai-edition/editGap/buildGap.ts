/**
 * Deterministic Edit Gap V1 builder — Source Story V2 vs Target Story V1.
 * 0 LLM calls.
 */

import type { SourceStoryV2, SourceStoryV2Beat } from "../sourceStory/v2/types";
import { isPassiveAppContext, isRecordingChromeContext } from "../targetStory/v1/guards";
import type { TargetStoryV1, TargetStoryV1Beat } from "../targetStory/v1/types";
import {
	assertsForbiddenRestartActionCleanup,
	assertsForbiddenUpworkWorkflowRemoval,
	sanitizeGapProse,
} from "./guards";
import type {
	EditGapImportance,
	EditGapInput,
	EditGapItem,
	EditGapPreserved,
	EditGapUnresolved,
	EditGapV1,
} from "./types";
import { EDIT_GAP_V1_PROVIDER_ID } from "./types";

let seq = 0;
function nextId(prefix: string): string {
	seq += 1;
	return `${prefix}_${seq}`;
}

export function resetEditGapSeqForTests(): void {
	seq = 0;
}

function sourceBeatById(source: SourceStoryV2, id: string): SourceStoryV2Beat | undefined {
	return source.beats.find((b) => b.id === id);
}

function rangeFromSourceBeats(
	source: SourceStoryV2,
	ids: string[],
): { startSourceTimeSec: number; endSourceTimeSec: number } | undefined {
	const beats = ids.map((id) => sourceBeatById(source, id)).filter(Boolean) as SourceStoryV2Beat[];
	if (!beats.length) return undefined;
	return {
		startSourceTimeSec: Math.min(...beats.map((b) => b.startSourceTimeSec)),
		endSourceTimeSec: Math.max(...beats.map((b) => b.endSourceTimeSec)),
	};
}

function importanceFromScore(score: number): EditGapImportance {
	if (score >= 8) return "critical";
	if (score >= 5.5) return "high";
	if (score >= 3) return "medium";
	return "low";
}

function scoreGap(input: {
	disposition?: string;
	contradiction?: boolean;
	coreCommunication?: boolean;
	sourceImportance?: number;
	shorten?: boolean;
	polish?: boolean;
	confusionRisk?: boolean;
	unsupportedRisk?: boolean;
}): number {
	let s = 0;
	if (input.disposition === "remove_candidate") s += 4;
	if (input.disposition === "de_emphasize") s += 2.5;
	if (input.disposition === "preserve") s += 3;
	if (input.contradiction) s += 4;
	if (input.coreCommunication) s += 3.5;
	if ((input.sourceImportance ?? 0) >= 4) s += 2;
	if (input.shorten) s += 1.5;
	if (input.polish) s += 1.2;
	if (input.confusionRisk) s += 3;
	if (input.unsupportedRisk) s += 4;
	return s;
}

function pushGap(
	gaps: EditGapItem[],
	seen: Set<string>,
	item: Omit<EditGapItem, "id"> & { id?: string },
): void {
	const beatKey = `${item.category}|${[...item.provenance.sourceBeatIds].sort().join(",")}|${[
		...item.provenance.targetBeatIds,
	]
		.sort()
		.join(",")}`;
	const textKey = `${item.category}|${item.problemStatement.slice(0, 80)}`;
	const categorySourceKey = `${item.category}|${[...item.provenance.sourceBeatIds].sort().join(",")}`;
	if (seen.has(beatKey) || seen.has(textKey) || seen.has(categorySourceKey)) return;
	// Soft cap noisy categories (editorial compactness)
	const noisy = new Set([
		"distracting_temporary_ui",
		"passive_context_noise",
		"pacing_excess",
		"unclear_focus",
		"weak_transition",
	]);
	if (noisy.has(item.category)) {
		const count = gaps.filter((g) => g.category === item.category).length;
		if (count >= 2) return;
	}
	seen.add(beatKey);
	seen.add(textKey);
	seen.add(categorySourceKey);
	const text = {
		...item,
		id: item.id ?? nextId("gap"),
		problemStatement: sanitizeGapProse(item.problemStatement),
		desiredChange: sanitizeGapProse(item.desiredChange),
		constraints: item.constraints.map(sanitizeGapProse),
	};
	if (assertsForbiddenRestartActionCleanup(JSON.stringify(text))) return;
	if (assertsForbiddenUpworkWorkflowRemoval(JSON.stringify(text))) return;
	gaps.push(text as EditGapItem);
}

function targetBeatsForSource(target: TargetStoryV1, sourceBeatId: string): TargetStoryV1Beat[] {
	return target.targetBeats.filter((tb) => tb.sourceBeatIds.includes(sourceBeatId));
}

/**
 * Build EditGapV1 from Source Story V2 + Target Story V1.
 */
export function buildEditGapV1(input: EditGapInput): EditGapV1 {
	const t0 = performance.now();
	seq = 0;
	const source = input.sourceStoryV2;
	const target = input.targetStoryV1;
	const gaps: EditGapItem[] = [];
	const preserved: EditGapPreserved[] = [];
	const unresolved: EditGapUnresolved[] = [];
	const hardConstraints: string[] = [];
	const seen = new Set<string>();

	const shorten = target.objectiveKind === "shorten";
	const polish = target.objectiveKind === "polish" || target.objectiveKind === "clarify";
	const clarify = target.objectiveKind === "clarify" || polish;

	hardConstraints.push("do not invent source events");
	hardConstraints.push("do not select editing tools or emit edit commands");
	if (!/restructure|reorder/i.test(target.editingIntent.objective + target.continuityIntent)) {
		hardConstraints.push("preserve source chronology unless user requested restructuring");
	}

	// --- Preservation requirements from Target preserve list ---
	for (const p of target.preserve) {
		const tbs = target.targetBeats.filter(
			(tb: TargetStoryV1Beat) =>
				p.sourceBeatIds.some((id: string) => tb.sourceBeatIds.includes(id)) ||
				(p.sourceBeatIds.length === 0 && /corrected|explanation|spoken/i.test(p.text)),
		);
		const sourceBeatIds =
			p.sourceBeatIds.length > 0
				? p.sourceBeatIds
				: tbs.flatMap((tb: TargetStoryV1Beat) => tb.sourceBeatIds);
		const targetBeatIds = tbs.map((tb: TargetStoryV1Beat) => tb.id);
		preserved.push({
			id: nextId("pv"),
			text: p.text,
			sourceBeatIds,
			targetBeatIds,
			reason: p.reason,
		});
		pushGap(gaps, seen, {
			category: "preservation_requirement",
			problemStatement: `Later shortening/polishing must not discard: ${p.text}`,
			desiredChange: "Preserve this meaning while pursuing the target viewer experience.",
			importance: importanceFromScore(
				scoreGap({
					disposition: "preserve",
					coreCommunication: /corrected|explanation|spoken|transition/i.test(p.text),
					polish,
					shorten,
				}),
			),
			confidence: "high",
			sourceEpistemic: "supported",
			provenance: {
				sourceBeatIds,
				targetBeatIds,
				sourceRange: rangeFromSourceBeats(source, sourceBeatIds),
			},
			constraints: [`preserve: ${p.text.slice(0, 120)}`],
		});
		hardConstraints.push(`preserve: ${p.text.slice(0, 100)}`);
	}

	// --- Per target beat dispositions ---
	for (const tb of target.targetBeats) {
		const sBeats = tb.sourceBeatIds
			.map((id: string) => sourceBeatById(source, id))
			.filter(Boolean) as SourceStoryV2Beat[];
		const sourceImportance = Math.max(0, ...sBeats.map((b: SourceStoryV2Beat) => b.importance));
		const hasCorrection = sBeats.some(
			(b: SourceStoryV2Beat) =>
				b.purposeHint === "correction" ||
				b.spoken.some((s) => s.kind === "spoken_correction") ||
				(tb.provenance.correctionIds?.length ?? 0) > 0,
		);
		const hasContradiction = sBeats.some((b: SourceStoryV2Beat) => b.contradictions.length > 0);
		const hasRecordingChrome = sBeats.some((b: SourceStoryV2Beat) =>
			b.context.some((c) => isRecordingChromeContext(c.text)),
		);
		const hasPassive = sBeats.some((b: SourceStoryV2Beat) =>
			b.context.some((c) => isPassiveAppContext(c.text)),
		);
		const hasUnresolvedAction = sBeats.some((b: SourceStoryV2Beat) => b.actions.length > 0);

		const skipEmphasisGaps = false; // Recovery 4: always evaluate editorial deltas

		// Pacing compress on preserve beats still yields actionable pacing gaps.
		if (tb.pacingIntent === "compress" && tb.disposition === "preserve" && (shorten || polish)) {
			pushGap(gaps, seen, {
				category: "pacing_excess",
				problemStatement: `This phase can feel slow or low-density for the desired ${target.objectiveKind} experience: ${tb.viewerShouldUnderstand.slice(0, 100)}`,
				desiredChange:
					"Compress low-value friction in this evidence window while preserving meaning-bearing content listed in constraints.",
				importance: importanceFromScore(
					scoreGap({
						disposition: "de_emphasize",
						shorten,
						polish,
						sourceImportance,
					}),
				),
				confidence: "medium",
				sourceEpistemic: "supported",
				provenance: {
					sourceBeatIds: tb.sourceBeatIds,
					targetBeatIds: [tb.id],
					sourceRange: rangeFromSourceBeats(source, tb.sourceBeatIds),
				},
				constraints: hardConstraints.filter((c) => /preserve/i.test(c)).slice(0, 2),
			});
		}

		if (hasCorrection && (clarify || shorten || polish)) {
			pushGap(gaps, seen, {
				category: "hesitation_or_correction_friction",
				problemStatement:
					"Initial mistaken spoken intent adds confusion before the corrected meaning is clear.",
				desiredChange:
					"Reduce confusion from the superseded intention while preserving the corrected meaning.",
				importance: importanceFromScore(
					scoreGap({
						disposition: tb.disposition,
						confusionRisk: true,
						coreCommunication: true,
						sourceImportance,
						shorten,
						polish: clarify,
					}),
				),
				confidence: "high",
				sourceEpistemic: "spoken",
				provenance: {
					sourceBeatIds: tb.sourceBeatIds,
					targetBeatIds: [tb.id],
					correctionIds: tb.provenance.correctionIds,
					sourceRange: rangeFromSourceBeats(source, tb.sourceBeatIds),
				},
				constraints: ["preserve corrected Effects/corrected meaning; do not invent panel opens"],
			});
			hardConstraints.push("preserve corrected spoken meaning; do not invent panel-open actions");
		}

		if (hasContradiction) {
			pushGap(gaps, seen, {
				category: "unsupported_story_implication",
				problemStatement: "Speech asserts an action or UI state that visuals do not confirm.",
				desiredChange:
					"Final viewer experience should avoid implying the unverified action was completed.",
				importance: importanceFromScore(
					scoreGap({
						contradiction: true,
						unsupportedRisk: true,
						polish,
						sourceImportance,
					}),
				),
				confidence: "high",
				sourceEpistemic: "contradicted",
				provenance: {
					sourceBeatIds: tb.sourceBeatIds,
					targetBeatIds: [tb.id],
					contradictionIds: tb.provenance.contradictionIds,
					sourceRange: rangeFromSourceBeats(source, tb.sourceBeatIds),
				},
				constraints: ["do not invent verified UI state from speech alone"],
			});
			unresolved.push({
				id: nextId("ur"),
				kind: "epistemic_honesty",
				text: "Contradiction requires honesty in the final story — no fabricated confirmation.",
				sourceBeatIds: tb.sourceBeatIds,
				targetBeatIds: [tb.id],
			});
		}

		if (
			hasRecordingChrome &&
			(tb.disposition === "remove_candidate" || tb.disposition === "de_emphasize" || polish)
		) {
			pushGap(gaps, seen, {
				category: "distracting_temporary_ui",
				problemStatement:
					"Supported temporary recording-control UI (e.g. Restart recording tooltip) distracts from the intended application story.",
				desiredChange:
					"De-emphasize or remove the distracting recording UI from the viewer experience without claiming a restart action occurred.",
				importance: importanceFromScore(
					scoreGap({
						disposition: tb.disposition === "preserve" ? "de_emphasize" : tb.disposition,
						polish: true,
						sourceImportance,
					}),
				),
				confidence: "high",
				sourceEpistemic: "observed",
				provenance: {
					sourceBeatIds: tb.sourceBeatIds,
					targetBeatIds: [tb.id],
					sourceContextIds: tb.provenance.sourceContextIds,
					sourceRange: rangeFromSourceBeats(source, tb.sourceBeatIds),
				},
				constraints: ["do not imply the user restarted recording"],
			});
			hardConstraints.push("do not imply restart action occurred");
		}

		if (hasPassive && !hasRecordingChrome) {
			// Only emit passive_context_noise if Target explicitly de-emphasizes / ignores it
			const passiveNoise =
				target.deEmphasize.some((d: { text: string }) =>
					/passive|upwork|Ignore passive/i.test(d.text),
				) || tb.deEmphasize.some((d: string) => /passive|Background context/i.test(d));
			if (passiveNoise) {
				pushGap(gaps, seen, {
					category: "passive_context_noise",
					problemStatement:
						"Passive browser/app chrome is visible but is not part of the desired viewer story.",
					desiredChange:
						"Keep passive context from becoming a narrative focus; do not treat it as a workflow.",
					importance: "low",
					confidence: "medium",
					sourceEpistemic: "observed",
					provenance: {
						sourceBeatIds: tb.sourceBeatIds,
						targetBeatIds: [tb.id],
						sourceRange: rangeFromSourceBeats(source, tb.sourceBeatIds),
					},
					constraints: ["do not imply Upwork (or similar) was opened or worked on"],
				});
				hardConstraints.push("do not imply Upwork was opened");
			}
		}

		if (hasUnresolvedAction) {
			// Honesty only — never "remove restart action"
			unresolved.push({
				id: nextId("ur"),
				kind: "epistemic_honesty",
				text: "Unknown/unverified actions cannot become edit assumptions.",
				sourceBeatIds: tb.sourceBeatIds,
				targetBeatIds: [tb.id],
			});
			hardConstraints.push("unknown actions cannot become edit assumptions");
		}

		if (!skipEmphasisGaps && tb.disposition === "remove_candidate" && !hasRecordingChrome) {
			pushGap(gaps, seen, {
				category: shorten ? "pacing_excess" : "clarity_gap",
				problemStatement: `Target marks this phase as remove-candidate: ${tb.viewerShouldUnderstand.slice(0, 120)}`,
				desiredChange:
					"Reduce or omit this phase from the viewer experience if it does not carry essential meaning (editorial candidate — not a trim command).",
				importance: importanceFromScore(
					scoreGap({ disposition: "remove_candidate", shorten, polish, sourceImportance }),
				),
				confidence: tb.confidence,
				sourceEpistemic: "unknown",
				provenance: {
					sourceBeatIds: tb.sourceBeatIds,
					targetBeatIds: [tb.id],
					sourceRange: rangeFromSourceBeats(source, tb.sourceBeatIds),
				},
				constraints: [],
			});
		} else if (
			!skipEmphasisGaps &&
			tb.disposition === "de_emphasize" &&
			!hasRecordingChrome &&
			!hasCorrection
		) {
			pushGap(gaps, seen, {
				category: tb.pacingIntent === "compress" ? "pacing_excess" : "unclear_focus",
				problemStatement: `Target wants lower emphasis on: ${tb.viewerShouldUnderstand.slice(0, 120)}`,
				desiredChange: "De-emphasize this phase so it does not dominate the finished experience.",
				importance: importanceFromScore(
					scoreGap({ disposition: "de_emphasize", shorten, polish, sourceImportance }),
				),
				confidence: tb.confidence,
				sourceEpistemic: "observed",
				provenance: {
					sourceBeatIds: tb.sourceBeatIds,
					targetBeatIds: [tb.id],
					sourceRange: rangeFromSourceBeats(source, tb.sourceBeatIds),
				},
				constraints: [],
			});
		}

		if (
			!skipEmphasisGaps &&
			tb.pacingIntent === "compress" &&
			(shorten || polish) &&
			!hasRecordingChrome
		) {
			pushGap(gaps, seen, {
				category: "pacing_excess",
				problemStatement:
					"Current pacing in this phase is slower/looser than the desired viewer experience.",
				desiredChange: "Tighten pacing while preserving required meaning.",
				importance: importanceFromScore(
					scoreGap({ disposition: "de_emphasize", shorten, sourceImportance }),
				),
				confidence: "medium",
				sourceEpistemic: "observed",
				provenance: {
					sourceBeatIds: tb.sourceBeatIds,
					targetBeatIds: [tb.id],
					sourceRange: rangeFromSourceBeats(source, tb.sourceBeatIds),
				},
				constraints: preserved.slice(0, 3).map((p) => `preserve: ${p.text.slice(0, 80)}`),
			});
		}

		if (
			sBeats.some(
				(b: SourceStoryV2Beat) =>
					b.purposeHint === "transition" || b.facts.some((f) => /visual change/i.test(f.text)),
			) &&
			polish &&
			tb.disposition === "preserve"
		) {
			pushGap(gaps, seen, {
				category: "weak_transition",
				problemStatement:
					"Application/UI transition should feel intentional and clear in the finished experience.",
				desiredChange: "Maintain clear, intentional transition of the meaningful visual change.",
				importance: importanceFromScore(
					scoreGap({
						disposition: "preserve",
						polish: true,
						sourceImportance,
						coreCommunication: true,
					}),
				),
				confidence: "medium",
				sourceEpistemic: "supported",
				provenance: {
					sourceBeatIds: tb.sourceBeatIds,
					targetBeatIds: [tb.id],
					sourceFactIds: tb.provenance.sourceFactIds,
					sourceRange: rangeFromSourceBeats(source, tb.sourceBeatIds),
				},
				constraints: ["preserve meaningful application transition"],
			});
		}
	}

	// --- Target removeCandidates / deEmphasize lists (may not be on a beat) ---
	for (const r of target.removeCandidates) {
		if (/Restart|recording-control|HUD|tooltip/i.test(r.text)) {
			if (!r.sourceBeatIds.length) continue;
			pushGap(gaps, seen, {
				category: "distracting_temporary_ui",
				problemStatement: r.text,
				desiredChange:
					"Remove or de-emphasize distracting temporary recording UI from the viewer experience (visibility is supported; restart action is not).",
				importance: "high",
				confidence: "high",
				sourceEpistemic: "observed",
				provenance: {
					sourceBeatIds: r.sourceBeatIds,
					targetBeatIds: targetBeatsForSource(target, r.sourceBeatIds[0] ?? "").map((t) => t.id),
					sourceRange: rangeFromSourceBeats(source, r.sourceBeatIds),
				},
				constraints: ["do not imply the user restarted recording"],
			});
		}
	}

	for (const d of target.deEmphasize) {
		if (/Ignore passive|passive context|Upwork/i.test(d.text)) {
			if (!d.sourceBeatIds.length) continue;
			pushGap(gaps, seen, {
				category: "passive_context_noise",
				problemStatement: d.text,
				desiredChange: "Do not let passive chrome become a narrative workflow.",
				importance: "low",
				confidence: "medium",
				sourceEpistemic: "observed",
				provenance: {
					sourceBeatIds: d.sourceBeatIds,
					targetBeatIds: targetBeatsForSource(target, d.sourceBeatIds[0] ?? "").map((t) => t.id),
				},
				constraints: ["do not imply Upwork was opened"],
			});
		}
		if (/mistaken|Initial mistaken|superseded/i.test(d.text)) {
			if (!d.sourceBeatIds.length && !(source.corrections.length > 0)) continue;
			pushGap(gaps, seen, {
				category: "hesitation_or_correction_friction",
				problemStatement: d.text,
				desiredChange: "Reduce emphasis on superseded spoken intention.",
				importance: "medium",
				confidence: "high",
				sourceEpistemic: "spoken",
				provenance: {
					sourceBeatIds: d.sourceBeatIds,
					targetBeatIds: d.sourceBeatIds.length
						? targetBeatsForSource(target, d.sourceBeatIds[0] ?? "").map((t) => t.id)
						: [],
					correctionIds: source.corrections.map((c) => c.id),
				},
				constraints: ["preserve corrected meaning"],
			});
		}
	}

	// --- Missing target support ---
	for (const u of target.unsupportedRequests) {
		pushGap(gaps, seen, {
			category: "missing_target_support",
			problemStatement: u.note,
			desiredChange:
				"Acknowledge the desired target cannot be fully achieved from verified source footage — do not fabricate missing material.",
			importance: "critical",
			confidence: "high",
			sourceEpistemic: "unknown",
			provenance: { sourceBeatIds: [], targetBeatIds: [] },
			constraints: ["do not fabricate missing footage or UI state"],
			unresolvedReason: u.requestText,
		});
		unresolved.push({
			id: nextId("ur"),
			kind: "missing_target_support",
			text: u.note,
		});
	}

	for (const u of target.unresolved) {
		if (u.kind === "contradiction") {
			let sourceBeatIds = u.sourceBeatIds ?? [];
			if (!sourceBeatIds.length) {
				const matched = source.contradictions.filter(
					(c: (typeof source.contradictions)[number]) =>
						u.text.toLowerCase().includes(c.claim.slice(0, 24).toLowerCase()) ||
						c.claim.toLowerCase().includes(u.text.slice(0, 24).toLowerCase()),
				);
				sourceBeatIds = source.beats
					.filter((b: SourceStoryV2Beat) =>
						b.contradictions.some((x) => matched.some((m) => m.id === x.id || m.claim === x.text)),
					)
					.map((b: SourceStoryV2Beat) => b.id);
				if (!sourceBeatIds.length && source.contradictions.length) {
					sourceBeatIds = source.beats
						.filter((b: SourceStoryV2Beat) => b.contradictions.length > 0)
						.map((b: SourceStoryV2Beat) => b.id);
				}
			}
			if (!sourceBeatIds.length) continue;

			const targetBeatIds = target.targetBeats
				.filter((tb: TargetStoryV1Beat) =>
					sourceBeatIds.some((id: string) => tb.sourceBeatIds.includes(id)),
				)
				.map((tb: TargetStoryV1Beat) => tb.id);
			pushGap(gaps, seen, {
				category: "unsupported_story_implication",
				problemStatement: u.text,
				desiredChange: "Keep the finished story epistemically honest about this item.",
				importance: "high",
				confidence: "high",
				sourceEpistemic: "contradicted",
				provenance: {
					sourceBeatIds,
					targetBeatIds,
					sourceRange: rangeFromSourceBeats(source, sourceBeatIds),
				},
				constraints: [],
			});
		} else if (u.kind === "unresolved_action") {
			unresolved.push({
				id: nextId("ur"),
				kind: "epistemic_honesty",
				text: u.text,
				sourceBeatIds: u.sourceBeatIds,
			});
		}
	}

	// --- Source corrections global ---
	for (const c of source.corrections) {
		const relatedBeats = source.beats
			.filter(
				(b: SourceStoryV2Beat) =>
					b.purposeHint === "correction" ||
					(b.startSourceTimeSec <= c.endSourceTimeSec &&
						b.endSourceTimeSec >= c.startSourceTimeSec &&
						b.spoken.some((s) => s.kind === "spoken_correction" || s.kind === "spoken_intention")),
			)
			.map((b: SourceStoryV2Beat) => b.id);
		const targetBeatIds = target.targetBeats
			.filter((tb: TargetStoryV1Beat) =>
				relatedBeats.some((id: string) => tb.sourceBeatIds.includes(id)),
			)
			.map((tb: TargetStoryV1Beat) => tb.id);
		pushGap(gaps, seen, {
			category: "hesitation_or_correction_friction",
			problemStatement: `Spoken correction from “${c.fromText.slice(0, 60)}” to “${c.toText.slice(0, 60)}”.`,
			desiredChange: "Preserve corrected meaning; reduce friction from the superseded intent.",
			importance: "high",
			confidence: "high",
			sourceEpistemic: "spoken",
			provenance: {
				sourceBeatIds: relatedBeats,
				targetBeatIds,
				correctionIds: [c.id],
				sourceRange: {
					startSourceTimeSec: c.startSourceTimeSec,
					endSourceTimeSec: c.endSourceTimeSec,
				},
			},
			constraints: ["preserve corrected meaning", "do not invent panel-open actions"],
		});
	}

	// Compact: keep highest importance, max ~16
	const sorted = [...gaps].sort((a, b) => {
		const rank = { critical: 4, high: 3, medium: 2, low: 1 };
		return rank[b.importance] - rank[a.importance] || a.id.localeCompare(b.id);
	});
	const compact = sorted.slice(0, 16);

	const summaryParts = [
		preserved.length ? `Preserve ${preserved.length} meaning-bearing item(s).` : null,
		compact.find((g) => g.category === "hesitation_or_correction_friction")
			? "Reduce correction/repetition friction."
			: null,
		compact.find((g) => g.category === "distracting_temporary_ui")
			? "De-emphasize recording HUD / temporary UI."
			: null,
		compact.find(
			(g) => g.category === "weak_transition" || g.category === "preservation_requirement",
		)
			? "Maintain accurate application transition / core explanation."
			: null,
		compact.find((g) => g.category === "unsupported_story_implication")
			? "Avoid unsupported action implications."
			: null,
		compact.find((g) => g.category === "missing_target_support")
			? "Note requested targets lacking source support."
			: null,
		compact.find((g) => g.category === "pacing_excess")
			? "Tighten pacing where Target requests compression."
			: null,
	].filter(Boolean);

	const draft: EditGapV1 = {
		version: 1,
		providerId: EDIT_GAP_V1_PROVIDER_ID,
		assetId: source.assetId || target.assetId,
		summary: summaryParts.join(" ") || "No material editorial gaps detected.",
		gaps: compact,
		preserved,
		unresolved,
		hardConstraints: [...new Set(hardConstraints)],
		metrics: {
			sourceBeatsConsumed: source.beats.length,
			targetBeatsConsumed: target.targetBeats.length,
			gapsCreated: compact.length,
			preservationConstraints: preserved.length,
			missingSupportGaps: compact.filter((g) => g.category === "missing_target_support").length,
			serializedBytesApprox: 0,
			buildMs: performance.now() - t0,
			additionalModelCalls: 0,
			providerId: EDIT_GAP_V1_PROVIDER_ID,
		},
	};
	draft.metrics.serializedBytesApprox = JSON.stringify(draft).length;
	return draft;
}
