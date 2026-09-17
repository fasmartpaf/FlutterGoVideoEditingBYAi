/**
 * Deterministic Edit Plan V1 — Edit Gap → candidate strategies.
 * 0 LLM calls. Does not execute tools or mutate AxcutDocument.
 */

import type { EditGapCategory, EditGapItem, EditGapV1 } from "../editGap/types";
import type { SourceStoryV2 } from "../sourceStory/v2/types";
import type { TargetStoryV1 } from "../targetStory/v1/types";
import {
	defaultEditCapabilityRegistry,
	isFamilySupported,
	mergeCapabilities,
} from "./capabilities";
import {
	assertsForbiddenRestartActionPlan,
	assertsForbiddenUnverifiedPanelZoom,
	assertsForbiddenUpworkPlan,
	sanitizePlanProse,
} from "./guards";
import type {
	CandidateStrategy,
	EditCapabilityRegistry,
	EditPlanConflict,
	EditPlanFeasibility,
	EditPlanInput,
	EditPlanItem,
	EditPlanPriority,
	EditPlanV1,
	EditStrategyFamily,
} from "./types";
import { EDIT_PLAN_V1_PROVIDER_ID } from "./types";

let seq = 0;
function nextId(prefix: string): string {
	seq += 1;
	return `${prefix}_${seq}`;
}

export function resetEditPlanSeqForTests(): void {
	seq = 0;
}

function confNum(c: string): number {
	if (c === "high") return 0.85;
	if (c === "medium") return 0.6;
	return 0.35;
}

function priorityRank(p: EditPlanPriority): number {
	return { critical: 4, high: 3, medium: 2, low: 1 }[p];
}

function orderBucket(category: EditGapCategory): number {
	// 1 honesty, 2 preservation, 3 pacing, 4 clarity/focus, 5 distracting UI, 6 polish
	switch (category) {
		case "unsupported_story_implication":
		case "missing_target_support":
			return 1;
		case "preservation_requirement":
			return 2;
		case "pacing_excess":
		case "pacing_too_fast":
		case "repetition":
		case "hesitation_or_correction_friction":
			return 3;
		case "unclear_focus":
		case "clarity_gap":
		case "speech_visual_mismatch":
		case "visual_story_mismatch":
			return 4;
		case "distracting_temporary_ui":
		case "passive_context_noise":
			return 5;
		case "weak_transition":
		case "continuity_gap":
		default:
			return 6;
	}
}

function feasFor(caps: EditCapabilityRegistry, family: EditStrategyFamily): EditPlanFeasibility {
	if (family === "needs_more_evidence") return "needs_more_evidence";
	if (!isFamilySupported(caps, family)) return "unsupported";
	if (family === "caption") return "partially_supported"; // CLI/STT dependent
	return "supported";
}

function strat(
	caps: EditCapabilityRegistry,
	family: EditStrategyFamily,
	rationale: string,
	rankScore: number,
	risk: CandidateStrategy["risk"] = "medium",
	extra?: Partial<CandidateStrategy>,
): CandidateStrategy {
	const feasibility = feasFor(caps, family);
	return {
		family,
		rationale: sanitizePlanProse(rationale),
		feasibility,
		risk,
		rankScore: feasibility === "unsupported" ? rankScore - 50 : rankScore,
		...(feasibility === "unsupported" ? { unsupportedCapability: family } : {}),
		...extra,
	};
}

function pickPreferred(strategies: CandidateStrategy[]): EditStrategyFamily | undefined {
	const ranked = [...strategies].sort((a, b) => b.rankScore - a.rankScore);
	const best = ranked.find(
		(s) => s.feasibility === "supported" || s.feasibility === "partially_supported",
	);
	return best?.family ?? ranked[0]?.family;
}

function overallFeasibility(strategies: CandidateStrategy[]): EditPlanFeasibility {
	const pref = pickPreferred(strategies);
	const s = strategies.find((x) => x.family === pref);
	return s?.feasibility ?? "unsupported";
}

function collectPreservation(
	gap: EditGapV1,
	sourceBeatIds: string[],
): { refs: string[]; constraints: string[] } {
	const refs: string[] = [];
	const constraints: string[] = [...gap.hardConstraints];
	for (const p of gap.preserved) {
		const overlap =
			p.sourceBeatIds.length === 0 || p.sourceBeatIds.some((id) => sourceBeatIds.includes(id));
		if (overlap || /corrected|explanation|spoken|transition/i.test(p.text)) {
			refs.push(p.id);
			constraints.push(`preserve: ${p.text.slice(0, 120)}`);
		}
	}
	for (const g of gap.gaps) {
		if (g.category === "preservation_requirement") {
			constraints.push(...g.constraints);
		}
	}
	return { refs, constraints: [...new Set(constraints.map(sanitizePlanProse))] };
}

function skipPassiveAsWorkflow(gap: EditGapItem): boolean {
	return (
		gap.category === "passive_context_noise" ||
		/upwork|passive context/i.test(gap.problemStatement + gap.desiredChange)
	);
}

function strategiesForGap(
	gap: EditGapItem,
	caps: EditCapabilityRegistry,
	target: TargetStoryV1,
	source: SourceStoryV2,
): CandidateStrategy[] {
	const shorten = target.objectiveKind === "shorten";
	const polish = target.objectiveKind === "polish" || target.objectiveKind === "clarify";

	switch (gap.category) {
		case "preservation_requirement":
			return [
				strat(caps, "preserve", "Meaning-bearing content must survive later edits.", 100, "low"),
			];

		case "distracting_temporary_ui": {
			const out: CandidateStrategy[] = [];
			if (caps.trim) {
				out.push(
					strat(
						caps,
						"trim",
						"If temporary UI sits in disposable tail/low-value content, shorten that phase without claiming a restart action.",
						90,
						"medium",
					),
				);
			}
			if (caps.crop) {
				out.push(
					strat(
						caps,
						"crop",
						"If underlying application content must remain, reframe to reduce HUD prominence when safe.",
						70,
						"medium",
					),
				);
			}
			if (caps.annotation) {
				out.push(
					strat(
						caps,
						"annotation",
						"Cover/blur transient recording chrome only if underlying content must stay and crop/trim are unsafe.",
						50,
						"high",
					),
				);
			}
			out.push(
				strat(
					caps,
					"preserve",
					"Keep as-is if no safe edit exists without damaging meaning.",
					30,
					"low",
				),
			);
			out.push(
				strat(
					caps,
					"no_safe_edit",
					"Declare no safe edit if HUD overlays essential content and current tools would damage meaning.",
					20,
					"low",
				),
			);
			return out;
		}

		case "hesitation_or_correction_friction": {
			const out: CandidateStrategy[] = [
				strat(
					caps,
					"trim",
					"Shorten/remove superseded spoken wording while preserving corrected meaning.",
					shorten || polish ? 92 : 75,
					"medium",
				),
				strat(
					caps,
					"preserve",
					"Retain full correction chain if authenticity/transparency outweighs compression.",
					55,
					"low",
				),
			];
			if (caps.captions) {
				out.push(
					strat(
						caps,
						"caption",
						"Optionally reinforce corrected wording for clarity without inventing panel visuals.",
						40,
						"low",
					),
				);
			}
			out.push(
				strat(
					caps,
					"speed",
					"Compress surrounding pause only if speech clarity remains intact.",
					35,
					"high",
				),
			);
			return out;
		}

		case "unsupported_story_implication":
			return [
				strat(
					caps,
					"avoid_implication",
					"Avoid presenting unverified actions (e.g. Settings opened) as completed; do not invent visuals.",
					95,
					"low",
				),
				strat(
					caps,
					"trim",
					"De-emphasize unsupported spoken implication when consistent with Target Story — never fabricate UI.",
					70,
					"medium",
				),
				strat(
					caps,
					"preserve",
					"Keep spoken contradiction visible only if Target requires honesty/transparency.",
					45,
					"low",
				),
			];

		case "missing_target_support":
			return [
				strat(
					caps,
					"needs_more_evidence",
					"Desired target lacks verified source support — do not fabricate footage or UI state.",
					100,
					"low",
					{
						feasibility: "needs_more_evidence",
						evidenceRequirements: [
							"verified visual state for requested focus",
							"or revise Target Story away from unsupported request",
						],
					},
				),
				strat(
					caps,
					"no_safe_edit",
					"No safe visual strategy exists for unsupported source requests.",
					80,
					"low",
				),
			];

		case "pacing_excess":
		case "repetition": {
			const out: CandidateStrategy[] = [
				strat(
					caps,
					"trim",
					"Shorten low-value pause/repetition without removing preserved explanation.",
					88,
					"medium",
				),
			];
			if (caps.speed) {
				out.push(
					strat(
						caps,
						"speed",
						"Prefer speed over trim when visual continuity matters more than silence removal.",
						60,
						"medium",
					),
				);
			}
			out.push(
				strat(
					caps,
					"preserve",
					"Do not compress meaningful explanation solely for duration.",
					40,
					"low",
				),
			);
			return out;
		}

		case "pacing_too_fast":
			return [
				strat(caps, "preserve", "Do not further compress already-fast material.", 90, "low"),
				strat(
					caps,
					"speed",
					"Only if Target explicitly wants slower pacing and speech remains intelligible.",
					30,
					"high",
				),
			];

		case "unclear_focus": {
			// Recovery 4: lexical "button|control|click|cursor" is NOT enough for zoom.
			const groundedFocus = source.beats.some((b) => {
				if (!gap.provenance.sourceBeatIds.includes(b.id)) return false;
				const verifiedAction = b.actions.some(
					(a) => a.epistemic === "verified" || a.epistemic === "observed",
				);
				const namedUiFact = b.facts.some(
					(f) =>
						(f.epistemic === "verified" || f.epistemic === "supported") &&
						/\b(button|panel|menu|dialog|modal|tab|sidebar|toolbar|window)\b/i.test(f.text) &&
						!/\bupwork|restart\s+recording|chrome\s+tab\b/i.test(f.text),
				);
				return verifiedAction || namedUiFact;
			});
			if (!groundedFocus) {
				return [
					strat(
						caps,
						"needs_more_evidence",
						"Focal UI target is not sufficiently grounded for a targeted zoom/annotation.",
						100,
						"low",
						{
							feasibility: "needs_more_evidence",
							evidenceRequirements: [
								"inspect relevant source range",
								"identify target UI region / semantic identity",
							],
						},
					),
					strat(caps, "preserve", "Preserve until focal evidence is available.", 70, "low"),
				];
			}
			const out: CandidateStrategy[] = [];
			if (caps.zoom) {
				out.push(
					strat(
						caps,
						"zoom",
						"Direct attention to grounded focal target if visually supported.",
						85,
						"medium",
					),
				);
			}
			if (caps.crop) {
				out.push(strat(caps, "crop", "Reframe to elevate grounded focal region.", 70, "medium"));
			}
			if (caps.annotation) {
				out.push(
					strat(
						caps,
						"annotation",
						"Annotate when zoom would obscure needed context.",
						55,
						"medium",
					),
				);
			}
			out.push(strat(caps, "preserve", "Preserve if emphasis tools would mislead.", 35, "low"));
			return out;
		}

		case "weak_transition":
		case "continuity_gap":
			return [
				strat(
					caps,
					"preserve",
					"Maintain intentional application transition; clip transitions are unsupported.",
					90,
					"low",
				),
				strat(
					caps,
					"trim",
					"Only tighten surrounding dead air if transition meaning stays intact.",
					50,
					"medium",
				),
				strat(
					caps,
					"no_safe_edit",
					"Do not invent dissolve/wipe — transitions capability unavailable.",
					40,
					"low",
					{ unsupportedCapability: "transitions" },
				),
			];

		case "clarity_gap":
			return [
				strat(
					caps,
					"trim",
					"Reduce low-value material that obscures the core point.",
					75,
					"medium",
				),
				strat(
					caps,
					"caption",
					"Reinforce clarity with captions when speech is available and Target asks for clarity.",
					55,
					"low",
				),
				strat(caps, "preserve", "Preserve if clarity risk comes from cutting meaning.", 45, "low"),
			];

		case "speech_visual_mismatch":
		case "visual_story_mismatch":
			return [
				strat(
					caps,
					"avoid_implication",
					"Prefer epistemic honesty over inventing matching visuals.",
					90,
					"low",
				),
				strat(caps, "preserve", "Keep mismatch visible if Target values transparency.", 50, "low"),
				strat(
					caps,
					"needs_more_evidence",
					"Investigate mismatch range before visual edits.",
					60,
					"low",
					{
						feasibility: "needs_more_evidence",
						evidenceRequirements: ["re-inspect mismatched speech/visual window"],
					},
				),
			];

		case "passive_context_noise":
			// Should rarely become a plan item — caller skips; fallback preserve only
			return [
				strat(
					caps,
					"preserve",
					"Passive chrome is not an editing target under generic professional intent.",
					100,
					"low",
				),
			];

		default:
			return [strat(caps, "preserve", "No specific intervention mapped; preserve.", 50, "low")];
	}
}

function buildItemFromGap(
	gap: EditGapItem,
	editGap: EditGapV1,
	caps: EditCapabilityRegistry,
	target: TargetStoryV1,
	source: SourceStoryV2,
): EditPlanItem | null {
	if (skipPassiveAsWorkflow(gap) && gap.category === "passive_context_noise") {
		return null;
	}

	const strategies = strategiesForGap(gap, caps, target, source)
		.map((s) => ({
			...s,
			rationale: sanitizePlanProse(s.rationale),
		}))
		.filter((s) => {
			const blob = `${s.family} ${s.rationale}`;
			return (
				!assertsForbiddenUpworkPlan(blob) &&
				!assertsForbiddenRestartActionPlan(blob) &&
				!assertsForbiddenUnverifiedPanelZoom(blob)
			);
		})
		.sort((a, b) => b.rankScore - a.rankScore);

	if (!strategies.length) return null;

	const { refs, constraints } = collectPreservation(editGap, gap.provenance.sourceBeatIds);
	const allConstraints = [
		...constraints,
		...gap.constraints.map(sanitizePlanProse),
		"do not invent source events",
		"do not emit executable tool arguments",
	];

	if (gap.category === "distracting_temporary_ui") {
		allConstraints.push("do not imply the user restarted recording");
	}
	if (gap.category === "hesitation_or_correction_friction") {
		allConstraints.push("preserve corrected spoken meaning; do not invent panel opens");
	}
	if (gap.category === "unsupported_story_implication") {
		allConstraints.push("do not invent verified UI state from speech alone");
	}

	const preferred = pickPreferred(strategies);
	const priority = gap.importance as EditPlanPriority;

	return {
		id: nextId("plan"),
		gapIds: [gap.id],
		sourceBeatIds: gap.provenance.sourceBeatIds,
		targetBeatIds: gap.provenance.targetBeatIds,
		editorialIntent: sanitizePlanProse(`${gap.desiredChange} (${gap.category})`),
		candidateStrategies: strategies,
		preferredStrategy: preferred,
		priority,
		feasibility: overallFeasibility(strategies),
		constraints: [...new Set(allConstraints)],
		preservationRefs: refs,
		provenanceRefs: [
			...gap.provenance.sourceBeatIds,
			...(gap.provenance.correctionIds ?? []),
			...(gap.provenance.contradictionIds ?? []),
		],
		confidence: confNum(gap.confidence),
		evidenceRange: gap.provenance.sourceRange,
	};
}

function detectConflicts(items: EditPlanItem[]): EditPlanConflict[] {
	const conflicts: EditPlanConflict[] = [];
	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) {
			const a = items[i]!;
			const b = items[j]!;
			const shareBeats = a.sourceBeatIds.some((id) => b.sourceBeatIds.includes(id));
			if (!shareBeats) continue;

			const aTrim = a.preferredStrategy === "trim";
			const bPreserve =
				b.preferredStrategy === "preserve" ||
				b.preservationRefs.length > 0 ||
				b.gapIds.some(() => a.constraints.some((c) => /preserve:/i.test(c)));
			const bTrim = b.preferredStrategy === "trim";
			const aPreserve = a.preferredStrategy === "preserve" || a.preservationRefs.length > 0;

			if ((aTrim && bPreserve) || (bTrim && aPreserve)) {
				const id = nextId("cf");
				const note = "Trim preference conflicts with preservation on overlapping source beats.";
				const resolution =
					"Prefer preserve/partial trim of low-value only; keep preserved meaning.";
				conflicts.push({
					id,
					itemIds: [a.id, b.id],
					kind: "preserve_vs_remove",
					note,
					resolution,
				});
				a.conflictsWith = [...(a.conflictsWith ?? []), b.id];
				b.conflictsWith = [...(b.conflictsWith ?? []), a.id];
				a.conflictNotes = [...(a.conflictNotes ?? []), note];
				b.conflictNotes = [...(b.conflictNotes ?? []), note];
				// Downgrade aggressive trim when conflict
				if (aTrim && aPreserve === false) {
					const safer = a.candidateStrategies.find((s) => s.family === "preserve");
					if (safer) a.preferredStrategy = "preserve";
				}
				if (bTrim && bPreserve === false) {
					const safer = b.candidateStrategies.find((s) => s.family === "preserve");
					if (safer) b.preferredStrategy = "preserve";
				}
			}

			if (
				(a.preferredStrategy === "crop" || a.preferredStrategy === "zoom") &&
				(b.preferredStrategy === "crop" || b.preferredStrategy === "zoom") &&
				a.id !== b.id
			) {
				// mild note only
			}

			if (
				(a.preferredStrategy === "speed" && /speech|spoken|explanation/i.test(b.editorialIntent)) ||
				(b.preferredStrategy === "speed" && /speech|spoken|explanation/i.test(a.editorialIntent))
			) {
				const id = nextId("cf");
				const note = "Speed on speech-bearing content may harm clarity.";
				conflicts.push({
					id,
					itemIds: [a.id, b.id],
					kind: "speech_vs_speed",
					note,
					resolution: "Prefer trim of silence/pause or preserve speech clarity.",
				});
				if (a.preferredStrategy === "speed") {
					const safer = a.candidateStrategies.find(
						(s) => s.family === "trim" || s.family === "preserve",
					);
					if (safer) a.preferredStrategy = safer.family;
				}
				if (b.preferredStrategy === "speed") {
					const safer = b.candidateStrategies.find(
						(s) => s.family === "trim" || s.family === "preserve",
					);
					if (safer) b.preferredStrategy = safer.family;
				}
			}
		}
	}
	return conflicts;
}

function wireDependencies(items: EditPlanItem[]): void {
	const preserveItems = items.filter(
		(i) =>
			i.preferredStrategy === "preserve" || i.editorialIntent.includes("preservation_requirement"),
	);
	const correctionItems = items.filter((i) => /correction|hesitation/i.test(i.editorialIntent));
	for (const c of correctionItems) {
		const deps = preserveItems
			.filter((p) => p.sourceBeatIds.some((id) => c.sourceBeatIds.includes(id)) || p.id !== c.id)
			.map((p) => p.id)
			.slice(0, 2);
		if (deps.length) c.dependsOn = deps;
	}
}

/**
 * Build EditPlanV1 from trusted Edit Gap + Source/Target stories.
 */
export function buildEditPlanV1(input: EditPlanInput): EditPlanV1 {
	const t0 = performance.now();
	seq = 0;
	const caps = mergeCapabilities(input.availableCapabilities);
	const { editGapV1: gap, sourceStoryV2: source, targetStoryV1: target } = input;

	const items: EditPlanItem[] = [];
	const seenGapCats = new Set<string>();

	const orderedGaps = [...gap.gaps].sort((a, b) => {
		const ob = orderBucket(a.category) - orderBucket(b.category);
		if (ob !== 0) return ob;
		return priorityRank(b.importance) - priorityRank(a.importance);
	});

	for (const g of orderedGaps) {
		// Merge equivalent category+sourceBeat clusters
		const mergeKey = `${g.category}|${[...g.provenance.sourceBeatIds].sort().join(",")}`;
		if (seenGapCats.has(mergeKey) && g.category !== "preservation_requirement") {
			// Attach gap id onto existing item if present
			const existing = items.find(
				(it) =>
					it.gapIds.length &&
					gap.gaps.find((x) => x.id === it.gapIds[0])?.category === g.category &&
					it.sourceBeatIds.join(",") === g.provenance.sourceBeatIds.join(","),
			);
			if (existing && !existing.gapIds.includes(g.id)) {
				existing.gapIds.push(g.id);
			}
			continue;
		}
		seenGapCats.add(mergeKey);

		const item = buildItemFromGap(g, gap, caps, target, source);
		if (!item) continue;

		const blob = JSON.stringify(item);
		if (
			assertsForbiddenUpworkPlan(blob) ||
			assertsForbiddenRestartActionPlan(blob) ||
			assertsForbiddenUnverifiedPanelZoom(blob)
		) {
			continue;
		}
		items.push(item);
		if (items.length >= 16) break;
	}

	// Explicit unsupported denoise request from target objective language
	const wantDenoise = /denoise|background noise|remove noise/i.test(
		target.viewerGoal + target.communicationGoal + target.editingIntent.objective,
	);
	if (wantDenoise && !caps.denoise) {
		items.unshift({
			id: nextId("plan"),
			gapIds: [],
			sourceBeatIds: [],
			targetBeatIds: [],
			editorialIntent: "Improve speech cleanliness (requested) — denoise unsupported.",
			candidateStrategies: [
				strat(caps, "no_safe_edit", "Denoise capability not available in OpenScreen.", 100, "low", {
					feasibility: "unsupported",
					unsupportedCapability: "denoise",
				}),
			],
			preferredStrategy: "no_safe_edit",
			priority: "medium",
			feasibility: "unsupported",
			constraints: ["do not substitute unrelated tools for denoise"],
			preservationRefs: [],
			provenanceRefs: [],
			confidence: 0.9,
		});
	}

	wireDependencies(items);
	const conflicts = detectConflicts(items);

	const sorted = [...items].sort((a, b) => {
		const ga = gap.gaps.find((g) => g.id === a.gapIds[0]);
		const gb = gap.gaps.find((g) => g.id === b.gapIds[0]);
		const oa = ga ? orderBucket(ga.category) : 9;
		const ob = gb ? orderBucket(gb.category) : 9;
		if (oa !== ob) return oa - ob;
		return priorityRank(b.priority) - priorityRank(a.priority) || a.id.localeCompare(b.id);
	});

	const candidateCount = sorted.reduce((n, i) => n + i.candidateStrategies.length, 0);
	const unsupportedStrategies = sorted.reduce(
		(n, i) => n + i.candidateStrategies.filter((s) => s.feasibility === "unsupported").length,
		0,
	);
	const needsMore = sorted.filter(
		(i) => i.feasibility === "needs_more_evidence" || i.preferredStrategy === "needs_more_evidence",
	).length;

	const summaryParts = [
		sorted.some((i) => i.preferredStrategy === "preserve")
			? "Honor preservation constraints."
			: null,
		sorted.some((i) => /correction/i.test(i.editorialIntent))
			? "Address correction friction without inventing panels."
			: null,
		sorted.some((i) => /temporary|HUD|distracting/i.test(i.editorialIntent))
			? "Rank safe HUD de-emphasis strategies (no restart-action edits)."
			: null,
		sorted.some((i) => i.preferredStrategy === "avoid_implication")
			? "Avoid unsupported action implications."
			: null,
		needsMore ? "Flag needs-more-evidence where focus is ungrounded." : null,
		conflicts.length ? `Resolve ${conflicts.length} strategy conflict(s) toward preserve.` : null,
	].filter(Boolean);

	const draft: EditPlanV1 = {
		version: 1,
		providerId: EDIT_PLAN_V1_PROVIDER_ID,
		assetId: gap.assetId || source.assetId || target.assetId,
		summary: summaryParts.join(" ") || "No actionable editorial plan items.",
		items: sorted.slice(0, 16),
		conflicts,
		capabilities: caps,
		hardConstraints: [
			...new Set([
				...gap.hardConstraints.map(sanitizePlanProse),
				"do not execute edits",
				"do not mutate AxcutDocument",
				"do not emit executable tool arguments",
			]),
		],
		metrics: {
			gapsConsumed: gap.gaps.length,
			planItemsGenerated: 0,
			candidateStrategiesGenerated: candidateCount,
			unsupportedStrategies,
			conflicts: conflicts.length,
			needsMoreEvidenceItems: needsMore,
			serializedBytesApprox: 0,
			buildMs: performance.now() - t0,
			additionalModelCalls: 0,
			providerId: EDIT_PLAN_V1_PROVIDER_ID,
		},
	};
	draft.metrics.planItemsGenerated = draft.items.length;
	draft.metrics.serializedBytesApprox = JSON.stringify(draft).length;
	return draft;
}

export { defaultEditCapabilityRegistry };
