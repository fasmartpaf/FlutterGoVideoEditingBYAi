/**
 * Constrained Edit Proposal V1 — behavioral tests (0 LLM). Never executes.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { buildClaimPromotionSet, resetClaimPromotionSeqForTests } from "../claimPromotion";
import { buildEditGapV1, resetEditGapSeqForTests, validateAndSanitizeEditGapV1 } from "../editGap";
import {
	buildEditPlanV1,
	resetEditPlanSeqForTests,
	validateAndSanitizeEditPlanV1,
} from "../editPlan";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import {
	buildSourceStoryEvidenceInput,
	buildSourceStoryV2,
	resetSourceStoryV2SeqForTests,
} from "../sourceStory/v2";
import type { SpeechEvidence } from "../speechEvidence/types";
import { buildTargetStoryV1, resetTargetStoryV1SeqForTests } from "../targetStory/v1";
import type { TemporalEventLedger } from "../temporalEventLedger/types";
import {
	buildEditProposalV1,
	EDIT_PROPOSAL_V1_PROVIDER_ID,
	evaluateEditProposalRubric,
	leaksExecution,
	prepareEditProposalForTurn,
	resetEditProposalSeqForTests,
	validateAndSanitizeEditProposalV1,
} from "./index";

beforeEach(() => {
	resetEditProposalSeqForTests();
	resetEditPlanSeqForTests();
	resetEditGapSeqForTests();
	resetTargetStoryV1SeqForTests();
	resetSourceStoryV2SeqForTests();
	resetClaimPromotionSeqForTests();
});

function speechEv(segments: SpeechEvidence["segments"]): SpeechEvidence {
	return {
		assetId: "a1",
		sourceDurationSec: 20,
		segments,
		status: "available",
		audioStreamPresent: true,
		timings: {
			audioProbeMs: 0,
			audioExtractMs: 0,
			sttMs: 0,
			transcriptParseMs: 0,
			transcriptCacheMs: 0,
			segmentCount: segments.length,
			cacheHit: true,
		},
	};
}

function ledger(events: TemporalEventLedger["events"]): TemporalEventLedger {
	return {
		meta: {
			assetId: "a1",
			sourceDurationSec: 20,
			timebase: "SOURCE_MEDIA_TIME",
			builtAtIso: new Date().toISOString(),
			constructionMs: 1,
			additionalModelCalls: 0,
			eventCount: events.length,
			claimCount: 0,
			evidenceRefCount: 0,
		},
		events,
	};
}

function chain(events: TemporalEventLedger["events"], intent: string, speech?: SpeechEvidence) {
	const led = ledger(events);
	const claims = buildClaimPromotionSet({ ledger: led, lazy: false });
	const source = buildSourceStoryV2(
		buildSourceStoryEvidenceInput({
			assetId: "a1",
			sourceDurationSec: 20,
			ledger: led,
			claimPromotion: claims,
			speechEvidence: speech,
			frames: [],
			changes: [
				{
					fromSourceTimeSec: 16,
					toSourceTimeSec: 18,
					score: 0.2,
					classification: "significant",
				},
			],
		}),
	);
	const target = buildTargetStoryV1({ sourceStoryV2: source, userIntent: intent });
	const gap = validateAndSanitizeEditGapV1(
		buildEditGapV1({ sourceStoryV2: source, targetStoryV1: target, userIntent: intent }),
	).gap;
	const plan = validateAndSanitizeEditPlanV1(
		buildEditPlanV1({ sourceStoryV2: source, targetStoryV1: target, editGapV1: gap }),
	).plan;
	const proposal = validateAndSanitizeEditProposalV1(
		buildEditProposalV1({
			sourceStoryV2: source,
			targetStoryV1: target,
			editGapV1: gap,
			editPlanV1: plan,
		}),
	).proposal;
	return { source, target, gap, plan, proposal };
}

describe("Constrained Edit Proposal V1", () => {
	it("1–4. evidence, landing, survival, damage fields present on mutating proposals", () => {
		const { proposal } = chain(
			[
				{
					id: "e_corr",
					assetId: "a1",
					startSourceTimeSec: 8,
					endSourceTimeSec: 10,
					type: "spoken_correction",
					modalities: ["speech"],
					summary: "correction",
					claims: [],
					evidence: [],
					confidence: "high",
				},
			],
			"Make this shorter and clearer.",
			speechEv([
				{ startSourceTimeSec: 8, endSourceTimeSec: 9, text: "open the timeline panel" },
				{ startSourceTimeSec: 9.2, endSourceTimeSec: 10, text: "I meant the effects panel" },
			]),
		);
		expect(proposal.providerId).toBe(EDIT_PROPOSAL_V1_PROVIDER_ID);
		const mutating = proposal.proposals.filter((p) =>
			["proposal_ready", "provisional", "no_safe_proposal"].includes(p.status),
		);
		expect(mutating.length).toBeGreaterThan(0);
		for (const p of mutating) {
			expect(p.evidenceJustification.length).toBeGreaterThan(10);
			expect(p.evidenceRefs.length).toBeGreaterThan(0);
			expect(p.mustSurvive.length + p.damageRisks.length).toBeGreaterThan(0);
			if (p.landing) {
				expect(p.landing.finalizedForApply).toBe(false);
				expect(p.landing.timebase).toBe("SOURCE_MEDIA_TIME");
			}
		}
		expect(proposal.metrics.additionalModelCalls).toBe(0);
	});

	it("5. Case 4 — trim proposal preserves corrected meaning", () => {
		const { proposal } = chain(
			[
				{
					id: "e_corr",
					assetId: "a1",
					startSourceTimeSec: 8,
					endSourceTimeSec: 10,
					type: "spoken_correction",
					modalities: ["speech"],
					summary: "correction",
					claims: [],
					evidence: [],
					confidence: "high",
				},
			],
			"Make this shorter and clearer.",
			speechEv([
				{ startSourceTimeSec: 8, endSourceTimeSec: 9, text: "open the timeline panel" },
				{ startSourceTimeSec: 9.2, endSourceTimeSec: 10, text: "I meant the effects panel" },
			]),
		);
		const trimish = proposal.proposals.filter((p) => p.preferredStrategy === "trim");
		expect(trimish.length).toBeGreaterThan(0);
		for (const p of trimish) {
			expect(
				p.mustSurvive.some((m) => /corrected|effects|preserve/i.test(m.text)) ||
					p.constraints.some((c) => /preserve|corrected/i.test(c)) ||
					p.damageRisks.some((d) => d.kind === "corrected_intent" || d.kind === "speech_meaning"),
			).toBe(true);
			if (p.proposedCall) {
				expect(p.proposedCall.status).toBe("proposal_only");
				expect(p.proposedCall.notExecuted).toBe(true);
				expect(p.proposedCall.toolName).toBe("addTrim");
			}
		}
		expect(JSON.stringify(proposal)).not.toMatch(/zoom.{0,30}(timeline|effects)\s+panel/i);
	});

	it("6. Case 2 — HUD does not auto-justify unsafe trim/crop", () => {
		const { proposal } = chain(
			[
				{
					id: "e_r",
					assetId: "a1",
					startSourceTimeSec: 18,
					endSourceTimeSec: 19,
					type: "observed_visible_text",
					modalities: ["visual"],
					summary: "Observed visible text: Restart recording",
					claims: [{ id: "c", text: "Restart recording", epistemic: "observed", evidence: [] }],
					evidence: [],
					confidence: "high",
				},
			],
			"Make this professional.",
		);
		expect(JSON.stringify(proposal)).not.toMatch(/restart recording action/i);
		const crop = proposal.proposals.filter((p) => p.preferredStrategy === "crop");
		for (const p of crop) {
			expect(p.status).toBe("no_safe_proposal");
		}
		// Trim may be provisional/ready/no_safe — but must carry damage awareness
		for (const p of proposal.proposals.filter((x) => x.preferredStrategy === "trim")) {
			expect(
				p.damageRisks.length + (p.landing ? 1 : 0) + (p.status === "no_safe_proposal" ? 1 : 0),
			).toBeGreaterThan(0);
		}
	});

	it("7. Upwork — no proposal targeting workflow", () => {
		const { proposal } = chain(
			[
				{
					id: "e_up",
					assetId: "a1",
					startSourceTimeSec: 3,
					endSourceTimeSec: 3,
					type: "passive_chrome",
					modalities: ["visual"],
					summary: "Passive chrome: Upwork (tab)",
					claims: [],
					evidence: [],
					confidence: "medium",
				},
			],
			"Make this professional.",
		);
		expect(JSON.stringify(proposal.proposals)).not.toMatch(
			/trim.{0,30}upwork|zoom.{0,30}upwork|upwork workflow/i,
		);
	});

	it("8. Settings — no zoom proposal", () => {
		const { proposal } = chain(
			[
				{
					id: "e_s",
					assetId: "a1",
					startSourceTimeSec: 4,
					endSourceTimeSec: 5,
					type: "speech",
					modalities: ["speech"],
					summary: "I'm opening Settings.",
					claims: [],
					evidence: [],
					confidence: "high",
				},
			],
			"Zoom into Settings when I open it.",
			speechEv([{ startSourceTimeSec: 4, endSourceTimeSec: 5, text: "I'm opening Settings." }]),
		);
		expect(proposal.proposals.every((p) => p.preferredStrategy !== "zoom")).toBe(true);
		expect(
			proposal.proposals.some(
				(p) =>
					p.status === "no_safe_proposal" ||
					p.preferredStrategy === "avoid_implication" ||
					p.status === "needs_more_evidence",
			) || proposal.deferredPlanItemIds.length > 0,
		).toBe(true);
	});

	it("9. stable narration — no manufactured zoom", () => {
		const { proposal } = chain(
			[
				{
					id: "e_n",
					assetId: "a1",
					startSourceTimeSec: 1,
					endSourceTimeSec: 12,
					type: "speech",
					modalities: ["speech"],
					summary: "Narration",
					claims: [],
					evidence: [],
					confidence: "high",
				},
			],
			"Make this professional and concise.",
			speechEv([
				{
					startSourceTimeSec: 1,
					endSourceTimeSec: 12,
					text: "This recording shows the main workspace.",
				},
			]),
		);
		expect(proposal.proposals.every((p) => p.preferredStrategy !== "zoom")).toBe(true);
	});

	it("10–12. no execution / proposal_only / not finalized", () => {
		const { proposal } = chain(
			[
				{
					id: "e_corr",
					assetId: "a1",
					startSourceTimeSec: 8,
					endSourceTimeSec: 10,
					type: "spoken_correction",
					modalities: ["speech"],
					summary: "correction",
					claims: [],
					evidence: [],
					confidence: "high",
				},
			],
			"Make this shorter and clearer.",
			speechEv([
				{ startSourceTimeSec: 8, endSourceTimeSec: 9, text: "timeline" },
				{ startSourceTimeSec: 9.2, endSourceTimeSec: 10, text: "effects panel" },
			]),
		);
		const blob = JSON.stringify(proposal);
		expect(leaksExecution(blob)).toBe(false);
		for (const p of proposal.proposals) {
			if (p.proposedCall) {
				expect(p.proposedCall.status).toBe("proposal_only");
				expect(p.proposedCall.notExecuted).toBe(true);
			}
			if (p.landing) expect(p.landing.finalizedForApply).toBe(false);
		}
		expect(blob).not.toMatch(/mutateTimeline|applyEdit/i);
	});

	it("13. quality rubric + prepare path", () => {
		const { source, target, gap, plan, proposal } = chain(
			[
				{
					id: "e_r",
					assetId: "a1",
					startSourceTimeSec: 18,
					endSourceTimeSec: 19,
					type: "observed_visible_text",
					modalities: ["visual"],
					summary: "Observed visible text: Restart recording",
					claims: [{ id: "c", text: "Restart recording", epistemic: "observed", evidence: [] }],
					evidence: [],
					confidence: "high",
				},
			],
			"Make this professional.",
		);
		const rubric = evaluateEditProposalRubric(proposal);
		expect(rubric.noExecutionLeakage).toBe(true);
		expect(rubric.compactness).toBe(true);
		expect(rubric.epistemicHonesty).toBe(true);

		const prep = prepareEditProposalForTurn({
			contextNeeds: classifyMediaContextNeeds("Make this professional and polish pacing."),
			sourceStoryV2: source,
			targetStoryV1: target,
			editGapV1: gap,
			editPlanV1: plan,
		});
		expect(prep?.providerId).toBe(EDIT_PROPOSAL_V1_PROVIDER_ID);

		const skip = prepareEditProposalForTurn({
			contextNeeds: classifyMediaContextNeeds("What is on screen?"),
			sourceStoryV2: source,
			targetStoryV1: target,
			editGapV1: gap,
			editPlanV1: plan,
		});
		expect(skip).toBeNull();
	});

	it("14. no GT leakage; edit-quality metrics present", () => {
		const { proposal } = chain(
			[
				{
					id: "e_r",
					assetId: "a1",
					startSourceTimeSec: 18,
					endSourceTimeSec: 19,
					type: "observed_visible_text",
					modalities: ["visual"],
					summary: "Observed visible text: Restart recording",
					claims: [{ id: "c", text: "Restart recording", epistemic: "observed", evidence: [] }],
					evidence: [],
					confidence: "high",
				},
			],
			"Make this professional.",
		);
		expect(JSON.stringify(proposal)).not.toMatch(/CASE2_LOCKED|ground.?truth|GT_/i);
		expect(proposal.quality.proposalCount).toBe(proposal.proposals.length);
		expect(typeof proposal.quality.avgBoundaryConfidence).toBe("number");
	});
});
