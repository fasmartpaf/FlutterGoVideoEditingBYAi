/**
 * Deterministic Constrained Edit Proposal V1 builder.
 * 0 LLM calls. Proposals only — never executes tools or mutates AxcutDocument.
 */

import type { EditGapV1 } from "../editGap/types";
import { defaultEditCapabilityRegistry, mergeCapabilities } from "../editPlan/capabilities";
import type { EditPlanItem, EditPlanV1, EditStrategyFamily } from "../editPlan/types";
import type { SourceStoryV2, SourceStoryV2Beat } from "../sourceStory/v2/types";
import type { TargetStoryV1 } from "../targetStory/v1/types";
import {
	assertsForbiddenRestartActionProposal,
	assertsForbiddenSettingsZoomProposal,
	assertsForbiddenUpworkProposal,
	sanitizeProposalProse,
} from "./guards";
import type {
	ContinuityRiskLevel,
	EditProposalInput,
	EditProposalItem,
	EditProposalV1,
	ProposalDamageRisk,
	ProposalEvidenceRef,
	ProposalLanding,
	ProposalStatus,
	ProposalSurvivalRequirement,
	ProposedToolCallShape,
} from "./types";
import {
	EDIT_PROPOSAL_V1_PROVIDER_ID,
	isNonMutatingStrategy,
	planItemIsProposalCandidate,
} from "./types";

let seq = 0;
function nextId(prefix: string): string {
	seq += 1;
	return `${prefix}_${seq}`;
}

export function resetEditProposalSeqForTests(): void {
	seq = 0;
}

function beatById(source: SourceStoryV2, id: string): SourceStoryV2Beat | undefined {
	return source.beats.find((b) => b.id === id);
}

function toolNameFor(family: EditStrategyFamily): string | null {
	switch (family) {
		case "trim":
			return "addTrim";
		case "crop":
			return "setClipCrop";
		case "zoom":
			return "addZoom";
		case "speed":
			return "addSpeed";
		case "caption":
			return "generateCaptions";
		case "annotation":
			return "addAnnotation";
		case "graphic":
			return "addGraphic";
		default:
			return null;
	}
}

function maxRisk(a: ContinuityRiskLevel, b: ContinuityRiskLevel): ContinuityRiskLevel {
	const rank = { low: 1, medium: 2, high: 3, blocking: 4 };
	return rank[a] >= rank[b] ? a : b;
}

function collectMustSurvive(gap: EditGapV1, item: EditPlanItem): ProposalSurvivalRequirement[] {
	const out: ProposalSurvivalRequirement[] = [];
	for (const p of gap.preserved) {
		const overlap =
			p.sourceBeatIds.length === 0 ||
			p.sourceBeatIds.some((id) => item.sourceBeatIds.includes(id)) ||
			/corrected|explanation|effects|spoken|transition/i.test(p.text);
		if (overlap) {
			out.push({
				id: p.id,
				text: p.text,
				sourceBeatIds: p.sourceBeatIds,
				reason: p.reason,
			});
		}
	}
	for (const c of item.constraints) {
		if (/preserve/i.test(c)) {
			out.push({
				id: nextId("surv"),
				text: c,
				sourceBeatIds: item.sourceBeatIds,
				reason: "plan constraint",
			});
		}
	}
	return out;
}

function deriveLanding(
	source: SourceStoryV2,
	item: EditPlanItem,
	gap: EditGapV1,
): ProposalLanding | undefined {
	if (item.evidenceRange) {
		const start = item.evidenceRange.startSourceTimeSec;
		const end = item.evidenceRange.endSourceTimeSec;
		if (end > start && end - start <= 12) {
			return {
				timebase: "SOURCE_MEDIA_TIME",
				startSourceTimeSec: start,
				endSourceTimeSec: end,
				boundaryBasis: "plan_item.evidenceRange (SOURCE_MEDIA_TIME context)",
				boundaryConfidence: end - start <= 4 ? "medium" : "low",
				finalizedForApply: false,
			};
		}
	}

	// Correction-driven: prefer correction interval from Source Story
	if (/correction|hesitation|superseded/i.test(item.editorialIntent)) {
		const corr = source.corrections[0];
		if (corr) {
			return {
				timebase: "SOURCE_MEDIA_TIME",
				startSourceTimeSec: corr.startSourceTimeSec,
				endSourceTimeSec: Math.min(corr.endSourceTimeSec, corr.startSourceTimeSec + 3),
				boundaryBasis: "sourceStory.corrections speech interval (superseded wording window)",
				boundaryConfidence: "medium",
				finalizedForApply: false,
			};
		}
	}

	const beats = item.sourceBeatIds
		.map((id) => beatById(source, id))
		.filter(Boolean) as SourceStoryV2Beat[];
	if (beats.length) {
		const start = Math.min(...beats.map((b) => b.startSourceTimeSec));
		const end = Math.max(...beats.map((b) => b.endSourceTimeSec));
		// Prefer spoken-correction sub-span when present
		const spoken = beats.flatMap((b) =>
			b.spoken.filter((s) => s.kind === "spoken_intention" || s.kind === "spoken_correction"),
		);
		if (/correction|hesitation/i.test(item.editorialIntent) && spoken.length >= 2) {
			const first = spoken[0]!;
			return {
				timebase: "SOURCE_MEDIA_TIME",
				startSourceTimeSec: first.startSourceTimeSec,
				endSourceTimeSec: first.endSourceTimeSec,
				boundaryBasis: "first superseded spoken span within beat (not full correction chain)",
				boundaryConfidence: "medium",
				finalizedForApply: false,
			};
		}
		if (end - start <= 8) {
			return {
				timebase: "SOURCE_MEDIA_TIME",
				startSourceTimeSec: start,
				endSourceTimeSec: end,
				boundaryBasis: "source beat span",
				boundaryConfidence: "low",
				finalizedForApply: false,
			};
		}
	}

	const gapItem = gap.gaps.find((g) => item.gapIds.includes(g.id));
	if (gapItem?.provenance.sourceRange) {
		const r = gapItem.provenance.sourceRange;
		if (r.endSourceTimeSec - r.startSourceTimeSec <= 8) {
			return {
				timebase: "SOURCE_MEDIA_TIME",
				startSourceTimeSec: r.startSourceTimeSec,
				endSourceTimeSec: r.endSourceTimeSec,
				boundaryBasis: "edit gap provenance sourceRange",
				boundaryConfidence: "low",
				finalizedForApply: false,
			};
		}
	}

	return undefined;
}

function assessDamage(
	item: EditPlanItem,
	landing: ProposalLanding | undefined,
	mustSurvive: ProposalSurvivalRequirement[],
	source: SourceStoryV2,
): {
	risks: ProposalDamageRisk[];
	continuity: ContinuityRiskLevel;
	preservation: ContinuityRiskLevel;
} {
	const risks: ProposalDamageRisk[] = [];
	let continuity: ContinuityRiskLevel = "low";
	let preservation: ContinuityRiskLevel = "low";

	const pref = item.preferredStrategy!;

	if (pref === "trim" && landing) {
		const overlapsPreserve = mustSurvive.some((m) => {
			if (!m.sourceBeatIds.length) return /corrected|effects|explanation/i.test(m.text);
			return m.sourceBeatIds.some((id) => {
				const b = beatById(source, id);
				if (!b) return false;
				return (
					b.startSourceTimeSec < landing.endSourceTimeSec &&
					b.endSourceTimeSec > landing.startSourceTimeSec
				);
			});
		});
		if (overlapsPreserve) {
			risks.push({
				kind: "corrected_intent",
				level: "blocking",
				description: "Proposed trim overlaps preserved corrected meaning / core explanation.",
				mitigation: "Narrow landing to superseded wording only, or emit no_safe_proposal.",
			});
			preservation = "blocking";
		}
		if (/correction|hesitation/i.test(item.editorialIntent)) {
			risks.push({
				kind: "speech_meaning",
				level: "medium",
				description:
					"Trimming spoken correction may create an unnatural jump if silence/visual continuity is not considered.",
				mitigation: "Prefer superseded-intent span only; keep corrected Effects meaning intact.",
			});
			continuity = maxRisk(continuity, "medium");
		}
		if (landing.endSourceTimeSec - landing.startSourceTimeSec > 5) {
			risks.push({
				kind: "visual_continuity",
				level: "high",
				description: "Wide trim window increases continuity and meaning-loss risk.",
				mitigation: "Tighten boundary or mark provisional / no_safe_proposal.",
			});
			continuity = maxRisk(continuity, "high");
		}
	}

	if (pref === "crop" || pref === "zoom") {
		if (/temporary|HUD|recording|tooltip/i.test(item.editorialIntent)) {
			risks.push({
				kind: "essential_ui",
				level: "high",
				description:
					"Spatial crop/zoom against temporary HUD may remove or obscure essential application content underneath.",
				mitigation: "Require crop-safety evidence; otherwise no_safe_proposal.",
			});
			continuity = maxRisk(continuity, "high");
		}
		if (/settings|panel|publish/i.test(item.editorialIntent) && item.confidence < 0.7) {
			risks.push({
				kind: "unsupported_implication",
				level: "blocking",
				description: "Focal target is insufficiently grounded for a targeted spatial edit.",
				mitigation: "needs_more_evidence or no_safe_proposal.",
			});
			preservation = maxRisk(preservation, "blocking");
		}
	}

	if (pref === "speed") {
		risks.push({
			kind: "audio_clarity",
			level: "high",
			description: "Speed changes on speech-bearing regions may harm intelligibility.",
			mitigation: "Prefer silence trim; avoid speeding corrected explanation.",
		});
		continuity = maxRisk(continuity, "high");
	}

	if (!landing && (pref === "trim" || pref === "zoom" || pref === "crop" || pref === "speed")) {
		risks.push({
			kind: "other",
			level: "blocking",
			description: "No safe landing interval could be derived from evidence.",
			mitigation: "no_safe_proposal until boundaries are grounded.",
		});
		continuity = "blocking";
	}

	return { risks, continuity, preservation };
}

function buildEvidenceJustification(
	item: EditPlanItem,
	gap: EditGapV1,
	refs: ProposalEvidenceRef[],
): string {
	const gaps = gap.gaps.filter((g) => item.gapIds.includes(g.id));
	const gapText = gaps.map((g) => g.problemStatement).join(" ");
	return sanitizeProposalProse(
		`Plan intent: ${item.editorialIntent}. Gap grounding: ${gapText || "plan provenance"}. Strategy: ${item.preferredStrategy}. Refs: ${refs.map((r) => r.id).join(", ") || "none"}.`,
	);
}

function buildRefs(item: EditPlanItem, gap: EditGapV1): ProposalEvidenceRef[] {
	const refs: ProposalEvidenceRef[] = [
		{ kind: "plan_item", id: item.id, note: item.editorialIntent.slice(0, 120) },
	];
	for (const gid of item.gapIds) {
		const g = gap.gaps.find((x) => x.id === gid);
		refs.push({
			kind: "gap",
			id: gid,
			note: g?.category ?? "gap",
		});
	}
	for (const sid of item.sourceBeatIds) {
		refs.push({ kind: "source_beat", id: sid, note: "source beat provenance" });
	}
	for (const pid of item.preservationRefs) {
		refs.push({ kind: "preservation", id: pid, note: "preservation ref" });
	}
	return refs;
}

function proposedCallFor(
	item: EditPlanItem,
	landing: ProposalLanding | undefined,
	status: ProposalStatus,
): ProposedToolCallShape | undefined {
	if (
		status === "no_safe_proposal" ||
		status === "needs_more_evidence" ||
		status === "unsupported"
	) {
		return undefined;
	}
	const family = item.preferredStrategy!;
	const toolName = toolNameFor(family);
	if (!toolName) return undefined;

	let provisionalArgs: Record<string, unknown> = {};
	if (family === "trim" && landing) {
		provisionalArgs = {
			startSec: landing.startSourceTimeSec,
			endSec: landing.endSourceTimeSec,
			note: "SOURCE_MEDIA_TIME provisional — not applied; requires speech-boundary review before execute",
		};
	} else if (family === "zoom" && landing) {
		provisionalArgs = {
			startSec: landing.startSourceTimeSec,
			endSec: landing.endSourceTimeSec,
			note: "focal region not finalized — spatial target must be evidence-grounded before execute",
		};
	} else if (family === "crop") {
		provisionalArgs = {
			note: "cropRegion not finalized — requires crop-safety evidence before execute",
		};
	} else if (family === "speed" && landing) {
		provisionalArgs = {
			startSec: landing.startSourceTimeSec,
			endSec: landing.endSourceTimeSec,
			note: "rate not finalized — speech intelligibility must be checked before execute",
		};
	} else if (family === "caption") {
		provisionalArgs = {
			note: "caption scope provisional — no word-level rewrite emitted",
		};
	} else {
		provisionalArgs = { note: "provisional shape only" };
	}

	return {
		status: "proposal_only",
		notExecuted: true,
		toolFamily: family,
		toolName,
		provisionalArgs,
		argsConfidence: landing?.boundaryConfidence === "high" ? "medium" : "low",
	};
}

function decideStatus(input: {
	item: EditPlanItem;
	landing?: ProposalLanding;
	continuity: ContinuityRiskLevel;
	preservation: ContinuityRiskLevel;
	capsOk: boolean;
}): ProposalStatus {
	const { item, landing, continuity, preservation, capsOk } = input;
	if (!capsOk) return "unsupported";
	if (
		item.feasibility === "needs_more_evidence" ||
		item.preferredStrategy === "needs_more_evidence"
	) {
		return "needs_more_evidence";
	}
	if (preservation === "blocking" || continuity === "blocking") return "no_safe_proposal";
	if (!landing && ["trim", "zoom", "crop", "speed"].includes(item.preferredStrategy ?? "")) {
		return "no_safe_proposal";
	}
	// Case 2 HUD: crop without proven safety → no_safe_proposal
	if (
		item.preferredStrategy === "crop" &&
		/temporary|HUD|recording|tooltip/i.test(item.editorialIntent)
	) {
		return "no_safe_proposal";
	}
	// Wide/low-confidence landings stay provisional
	if (landing && (landing.boundaryConfidence === "low" || continuity === "high")) {
		return "provisional";
	}
	if (item.confidence < 0.5) return "provisional";
	return "proposal_ready";
}

function proposalFromPlanItem(
	item: EditPlanItem,
	source: SourceStoryV2,
	_target: TargetStoryV1,
	gap: EditGapV1,
	caps: ReturnType<typeof defaultEditCapabilityRegistry>,
): EditProposalItem | null {
	const pref = item.preferredStrategy;
	if (!pref || isNonMutatingStrategy(pref)) {
		// Emit explicit no_safe / deferred only for no_safe_edit & needs_more_evidence as proposal records
		if (pref === "no_safe_edit" || pref === "needs_more_evidence") {
			return {
				id: nextId("prop"),
				planItemId: item.id,
				gapIds: item.gapIds,
				sourceBeatIds: item.sourceBeatIds,
				targetBeatIds: item.targetBeatIds,
				status: pref === "needs_more_evidence" ? "needs_more_evidence" : "no_safe_proposal",
				priority: item.priority,
				intent: sanitizeProposalProse(item.editorialIntent),
				evidenceJustification: sanitizeProposalProse(
					`Non-mutating plan outcome: ${pref}. ${item.editorialIntent}`,
				),
				evidenceRefs: buildRefs(item, gap),
				mustSurvive: collectMustSurvive(gap, item),
				damageRisks: [
					{
						kind: "other",
						level: "low",
						description: "No mutating proposal emitted for this plan item.",
					},
				],
				continuityRisk: "low",
				preservationViolationRisk: "low",
				preferredStrategy: pref,
				constraints: item.constraints.map(sanitizeProposalProse),
				confidence: item.confidence,
				rejectionReason:
					pref === "needs_more_evidence"
						? "Insufficient evidence for a concrete landing."
						: "Plan declared no safe edit.",
			};
		}
		return null;
	}

	if (!planItemIsProposalCandidate(item) && pref !== "trim") {
		// allow avoid already handled
	}

	const blob = JSON.stringify(item);
	if (
		assertsForbiddenUpworkProposal(blob) ||
		assertsForbiddenRestartActionProposal(blob) ||
		assertsForbiddenSettingsZoomProposal(blob + item.editorialIntent)
	) {
		return {
			id: nextId("prop"),
			planItemId: item.id,
			gapIds: item.gapIds,
			sourceBeatIds: item.sourceBeatIds,
			targetBeatIds: item.targetBeatIds,
			status: "no_safe_proposal",
			priority: item.priority,
			intent: sanitizeProposalProse(item.editorialIntent),
			evidenceJustification: "Rejected by epistemic safety guards.",
			evidenceRefs: buildRefs(item, gap),
			mustSurvive: collectMustSurvive(gap, item),
			damageRisks: [
				{
					kind: "unsupported_implication",
					level: "blocking",
					description: "Proposal would violate epistemic invariants.",
				},
			],
			continuityRisk: "blocking",
			preservationViolationRisk: "blocking",
			preferredStrategy: pref,
			constraints: item.constraints.map(sanitizeProposalProse),
			confidence: item.confidence,
			rejectionReason: "Epistemic safety rejection (Upwork/restart/Settings).",
		};
	}

	const refs = buildRefs(item, gap);
	const landing = deriveLanding(source, item, gap);
	const mustSurvive = collectMustSurvive(gap, item);
	const { risks, continuity, preservation } = assessDamage(item, landing, mustSurvive, source);

	const key =
		pref === "trim"
			? "trim"
			: pref === "crop"
				? "crop"
				: pref === "zoom"
					? "zoom"
					: pref === "speed"
						? "speed"
						: pref === "caption"
							? "captions"
							: pref === "annotation"
								? "annotation"
								: pref === "graphic"
									? "graphic"
									: null;
	const capsOk = key ? (caps as Record<string, boolean>)[key] === true : false;

	let status = decideStatus({ item, landing, continuity, preservation, capsOk });

	// Correction trim: if landing overlaps full correction including corrected meaning, block
	if (pref === "trim" && /correction|hesitation/i.test(item.editorialIntent) && landing) {
		const corr = source.corrections[0];
		if (corr && landing.endSourceTimeSec >= corr.endSourceTimeSec - 0.05) {
			// Landing covers entire correction including corrected end — too aggressive
			if (landing.startSourceTimeSec <= corr.startSourceTimeSec + 0.05) {
				status = "provisional";
				risks.push({
					kind: "corrected_intent",
					level: "high",
					description:
						"Landing spans full correction chain; must not remove corrected Effects meaning.",
					mitigation: "Restrict to superseded Timeline wording only.",
				});
			}
		}
	}

	const proposedCall =
		status === "proposal_ready" || status === "provisional"
			? proposedCallFor(item, landing, status)
			: undefined;

	return {
		id: nextId("prop"),
		planItemId: item.id,
		gapIds: item.gapIds,
		sourceBeatIds: item.sourceBeatIds,
		targetBeatIds: item.targetBeatIds,
		status,
		priority: item.priority,
		intent: sanitizeProposalProse(item.editorialIntent),
		evidenceJustification: buildEvidenceJustification(item, gap, refs),
		evidenceRefs: refs,
		landing,
		mustSurvive,
		damageRisks: risks,
		continuityRisk: continuity,
		preservationViolationRisk: preservation,
		preferredStrategy: pref,
		proposedCall,
		constraints: [
			...item.constraints.map(sanitizeProposalProse),
			"proposal_only — do not execute",
			"do not mutate AxcutDocument",
		],
		confidence: item.confidence,
		rejectionReason:
			status === "no_safe_proposal"
				? (risks.find((r) => r.level === "blocking")?.description ?? "No safe concrete proposal.")
				: status === "needs_more_evidence"
					? "Needs more evidence before landing."
					: undefined,
	};
}

/**
 * Build EditProposalV1 from the trusted plan (prefer post-closure plan).
 */
export function buildEditProposalV1(input: EditProposalInput): EditProposalV1 {
	const t0 = performance.now();
	seq = 0;
	const caps = mergeCapabilities(input.availableCapabilities);

	const closure = input.planningClosureV1;
	const finalSnap =
		closure && closure.planVersions.length
			? closure.planVersions[closure.planVersions.length - 1]
			: null;

	const plan: EditPlanV1 = finalSnap?.plan ?? input.editPlanV1;
	const source: SourceStoryV2 = finalSnap?.sourceStoryV2 ?? input.sourceStoryV2;
	const target: TargetStoryV1 = finalSnap?.targetStoryV1 ?? input.targetStoryV1;
	const gap: EditGapV1 = finalSnap?.editGapV1 ?? input.editGapV1;

	const proposals: EditProposalItem[] = [];
	const deferred: string[] = [];

	for (const item of plan.items) {
		// Preserve/avoid are deferred unless correction friction still needs a provisional trim shape
		if (item.preferredStrategy === "avoid_implication") {
			deferred.push(item.id);
			continue;
		}
		if (item.preferredStrategy === "preserve") {
			const wantsProvisionalTrim =
				/correction|hesitation|superseded/i.test(item.editorialIntent) &&
				item.candidateStrategies.some((s) => s.family === "trim");
			if (!wantsProvisionalTrim) {
				deferred.push(item.id);
				continue;
			}
			// Synthesize a provisional trim proposal from the preserve+trim conflict case
			const synthetic: EditPlanItem = {
				...item,
				preferredStrategy: "trim",
				feasibility: "supported",
			};
			const prop = proposalFromPlanItem(synthetic, source, target, gap, caps);
			if (prop) {
				prop.status = prop.status === "proposal_ready" ? "provisional" : prop.status;
				prop.damageRisks = [
					...prop.damageRisks,
					{
						kind: "corrected_intent",
						level: "high",
						description: "Plan preferred preserve due to conflict; trim remains provisional only.",
						mitigation: "Narrow to superseded wording; never remove corrected meaning.",
					},
				];
				prop.intent = sanitizeProposalProse(
					`Provisional trim candidate under preservation conflict: ${item.editorialIntent}`,
				);
				proposals.push(prop);
			} else {
				deferred.push(item.id);
			}
			continue;
		}
		const prop = proposalFromPlanItem(item, source, target, gap, caps);
		if (!prop) {
			deferred.push(item.id);
			continue;
		}
		const blob = JSON.stringify(prop);
		if (
			assertsForbiddenUpworkProposal(blob) ||
			assertsForbiddenRestartActionProposal(blob) ||
			assertsForbiddenSettingsZoomProposal(blob)
		) {
			deferred.push(item.id);
			continue;
		}
		proposals.push(prop);
		if (proposals.length >= 16) break;
	}

	// Compact: prefer unique planItem clusters
	const seen = new Set<string>();
	const compact: EditProposalItem[] = [];
	for (const p of proposals) {
		const key = `${p.preferredStrategy}|${p.status}|${p.sourceBeatIds.join(",")}|${p.intent.slice(0, 40)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		compact.push(p);
	}

	const ready = compact.filter((p) => p.status === "proposal_ready").length;
	const noSafe = compact.filter((p) => p.status === "no_safe_proposal").length;
	const provisional = compact.filter((p) => p.status === "provisional").length;
	const needs = compact.filter((p) => p.status === "needs_more_evidence").length;
	const unsupported = compact.filter((p) => p.status === "unsupported").length;
	const boundaryScores = compact.map((p) =>
		p.landing?.boundaryConfidence === "high"
			? 1
			: p.landing?.boundaryConfidence === "medium"
				? 0.6
				: p.landing
					? 0.3
					: 0,
	);
	const avgBoundary =
		boundaryScores.length === 0
			? 0
			: boundaryScores.reduce((a, b) => a + b, 0) / boundaryScores.length;

	const summaryParts = [
		ready ? `${ready} proposal-ready item(s).` : null,
		provisional ? `${provisional} provisional (boundary/continuity caution).` : null,
		noSafe ? `${noSafe} no-safe-proposal (honest refusal).` : null,
		needs ? `${needs} still need evidence.` : null,
		"No edits executed.",
	].filter(Boolean);

	const draft: EditProposalV1 = {
		version: 1,
		providerId: EDIT_PROPOSAL_V1_PROVIDER_ID,
		assetId: plan.assetId || source.assetId,
		summary: summaryParts.join(" ") || "No mutating proposals.",
		proposals: compact.slice(0, 16),
		deferredPlanItemIds: deferred,
		hardConstraints: [
			...new Set([
				...plan.hardConstraints,
				...gap.hardConstraints,
				"proposal_only — do not execute",
				"do not mutate AxcutDocument",
			]),
		],
		quality: {
			proposalCount: compact.length,
			proposalReadyCount: ready,
			noSafeProposalCount: noSafe,
			provisionalCount: provisional,
			needsMoreEvidenceCount: needs,
			unsupportedCount: unsupported,
			avgBoundaryConfidence: avgBoundary,
			highContinuityRiskCount: compact.filter(
				(p) => p.continuityRisk === "high" || p.continuityRisk === "blocking",
			).length,
			preservationBlockingCount: compact.filter((p) => p.preservationViolationRisk === "blocking")
				.length,
		},
		metrics: {
			planItemsConsumed: plan.items.length,
			proposalsGenerated: compact.length,
			serializedBytesApprox: 0,
			buildMs: performance.now() - t0,
			additionalModelCalls: 0,
			providerId: EDIT_PROPOSAL_V1_PROVIDER_ID,
		},
	};
	draft.metrics.serializedBytesApprox = JSON.stringify(draft).length;
	return draft;
}
