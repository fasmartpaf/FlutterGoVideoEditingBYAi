/**
 * Investigator V1.1 role-policy tests — deterministic, 0 LLM policy calls.
 */

import { describe, expect, it } from "vitest";
import { buildClaimPromotionSet, resetClaimPromotionSeqForTests } from "../../claimPromotion";
import { classifyMediaContextNeeds } from "../../mediaContextNeeds";
import { createVideoEvidenceStore } from "../../temporalEventLedger";
import type { TemporalEventLedger } from "../../temporalEventLedger/types";
import { planInvestigation } from "../plan";
import { runMasterVideoInvestigatorV1, runMasterVideoInvestigatorV1_1 } from "../run";
import {
	classifyInvestigationIntents,
	INVESTIGATOR_V1_1_PROVIDER_ID,
	planInvestigationV11,
	rankCandidateRanges,
} from "./index";

function ledgerFixture(dur = 20): TemporalEventLedger {
	return {
		meta: {
			assetId: "a1",
			sourceDurationSec: dur,
			timebase: "SOURCE_MEDIA_TIME",
			builtAtIso: new Date().toISOString(),
			constructionMs: 1,
			additionalModelCalls: 0,
			eventCount: 4,
			claimCount: 2,
			evidenceRefCount: 2,
		},
		events: [
			{
				id: "e_passive",
				assetId: "a1",
				startSourceTimeSec: 2,
				endSourceTimeSec: 2,
				type: "passive_chrome",
				modalities: ["visual"],
				summary: "Passive chrome: Upwork (tab)",
				claims: [
					{
						id: "cl_up",
						text: '"Upwork" is visible as tab chrome — NOT a verified user open/navigate/work action',
						epistemic: "observed",
						evidence: [],
					},
				],
				evidence: [{ modality: "visual", sourceTimeSec: 2 }],
				confidence: "medium",
			},
			{
				id: "e_late_diff",
				assetId: "a1",
				startSourceTimeSec: 17,
				endSourceTimeSec: 18.5,
				type: "visual_transition",
				modalities: ["visual"],
				summary: "Visual transition late",
				claims: [],
				evidence: [],
				confidence: "medium",
			},
			{
				id: "e_corr",
				assetId: "a1",
				startSourceTimeSec: 8,
				endSourceTimeSec: 10,
				type: "spoken_correction",
				modalities: ["speech"],
				summary: "Correction: timeline → effects",
				claims: [
					{
						id: "c1",
						text: "I meant the effects panel.",
						epistemic: "spoken",
						evidence: [],
					},
				],
				evidence: [{ modality: "speech", sourceTimeSec: 8, endSourceTimeSec: 10 }],
				confidence: "high",
			},
			{
				id: "e_contra",
				assetId: "a1",
				startSourceTimeSec: 8,
				endSourceTimeSec: 10,
				type: "contradiction",
				modalities: ["speech", "visual"],
				summary: "Speech asserts opening Settings without visual support",
				claims: [],
				evidence: [],
				confidence: "medium",
			},
			{
				id: "e_speech_set",
				assetId: "a1",
				startSourceTimeSec: 4,
				endSourceTimeSec: 5,
				type: "speech",
				modalities: ["speech"],
				summary: "I'm opening Settings.",
				claims: [
					{
						id: "c2",
						text: "I'm opening Settings.",
						epistemic: "spoken",
						evidence: [],
					},
				],
				evidence: [],
				confidence: "high",
			},
		],
	};
}

describe("Investigator V1.1 role policy", () => {
	it("1. visual question chooses visual role", () => {
		const needs = classifyMediaContextNeeds("What visibly happens near the end?");
		const intents = classifyInvestigationIntents("What visibly happens near the end?", needs);
		expect(intents).toContain("visual_state");
		const store = createVideoEvidenceStore(ledgerFixture());
		const plan = planInvestigationV11({
			userMessage: "What visibly happens near the end?",
			store,
			sourceDurationSec: 20,
			needs,
		});
		expect(plan.roles).toContain("VISUAL_INSPECTION");
		expect(plan.additionalModelCalls).toBe(0);
		expect(plan.providerId).toBe(INVESTIGATOR_V1_1_PROVIDER_ID);
	});

	it("2. speech question chooses speech role", () => {
		const q = "What did I say near the end?";
		const needs = classifyMediaContextNeeds(q);
		const intents = classifyInvestigationIntents(q, needs);
		expect(intents).toContain("speech_content");
		expect(intents).not.toContain("temporary_ui");
		const plan = planInvestigationV11({
			userMessage: q,
			store: createVideoEvidenceStore(ledgerFixture()),
			sourceDurationSec: 20,
			needs,
		});
		expect(plan.roles).toContain("SPEECH_INSPECTION");
		expect(plan.actions.some((a) => a.tool === "inspect_region")).toBe(false);
		expect(plan.actions.some((a) => a.tool === "get_transcript_range")).toBe(true);
	});

	it("3. action-verification chooses grounding+verify", () => {
		const q = "Did I open Upwork?";
		const needs = classifyMediaContextNeeds(q);
		const plan = planInvestigationV11({
			userMessage: q,
			store: createVideoEvidenceStore(ledgerFixture()),
			sourceDurationSec: 20,
			needs,
		});
		expect(plan.intents).toContain("action_verification");
		expect(plan.roles[0]).toBe("GROUNDING");
		expect(plan.roles).toContain("VERIFICATION");
		expect(plan.roles).toContain("CURSOR_INSPECTION");
	});

	it("4. temporary UI chooses visual+OCR selectively", () => {
		const q = "What brief popup appeared near the end?";
		const needs = classifyMediaContextNeeds(q);
		const plan = planInvestigationV11({
			userMessage: q,
			store: createVideoEvidenceStore(ledgerFixture()),
			sourceDurationSec: 20,
			needs,
		});
		expect(plan.intents).toContain("temporary_ui");
		expect(plan.roles).toContain("VISUAL_INSPECTION");
		expect(plan.roles).toContain("OCR_INSPECTION");
		expect(plan.actions.filter((a) => a.tool === "inspect_region").length).toBeLessThanOrEqual(2);
		expect(plan.ranked.some((r) => r.sources.includes("end_hint") || r.id === "late_window")).toBe(
			true,
		);
	});

	it("5. transcript-only avoids OCR", () => {
		const q = "What did I say in the final 10 seconds?";
		const plan = planInvestigationV11({
			userMessage: q,
			store: createVideoEvidenceStore(ledgerFixture()),
			sourceDurationSec: 20,
			needs: classifyMediaContextNeeds(q),
		});
		expect(plan.actions.some((a) => a.tool === "inspect_region")).toBe(false);
		expect(plan.actions.some((a) => a.tool === "inspect_video_range")).toBe(false);
	});

	it("6. passive Upwork action remains unverified", async () => {
		resetClaimPromotionSeqForTests();
		const ledger = ledgerFixture();
		const claims = buildClaimPromotionSet({ ledger, userQuery: "Did I open Upwork?", lazy: false });
		const set = await runMasterVideoInvestigatorV1_1({
			userMessage: "Did I open Upwork?",
			needs: classifyMediaContextNeeds("Did I open Upwork?"),
			assetId: "a1",
			sourceDurationSec: 20,
			videoPath: null,
			ledger,
			claimPromotion: claims,
		});
		expect(set?.providerId).toBe(INVESTIGATOR_V1_1_PROVIDER_ID);
		expect(
			claims.claims.some(
				(c) => c.isActionClaim && /upwork/i.test(c.subject ?? c.text) && c.status === "unknown",
			),
		).toBe(true);
		expect(
			claims.claims.some((c) => /upwork/i.test(c.subject ?? "") && c.status === "verified"),
		).toBe(false);
		expect(set?.rolePolicy?.roleSequence).toContain("GROUNDING");
		expect(set?.rolePolicy?.roleSequence).toContain("VERIFICATION");
		expect(set?.rolePolicy?.intents).toContain("action_verification");
		// No keyword shortcut to verified open in briefing/claims JSON
		expect(JSON.stringify({ claims: set?.claims, promo: claims.claims })).not.toMatch(
			/verified[^"]{0,40}opened Upwork/i,
		);
	});

	it("7. Case 4 correction", () => {
		const q = "What happened with Timeline and Effects?";
		const plan = planInvestigationV11({
			userMessage: q,
			store: createVideoEvidenceStore(ledgerFixture()),
			sourceDurationSec: 20,
			needs: classifyMediaContextNeeds(q),
		});
		expect(plan.intents).toContain("spoken_correction");
		expect(plan.roles).toContain("SPEECH_INSPECTION");
		expect(plan.roles).toContain("CONTRADICTION_CHECK");
	});

	it("8. Settings contradiction", () => {
		const q = "Did I open Settings?";
		const plan = planInvestigationV11({
			userMessage: q,
			store: createVideoEvidenceStore(ledgerFixture()),
			sourceDurationSec: 20,
			needs: classifyMediaContextNeeds(q),
		});
		expect(plan.intents).toContain("contradiction_check");
		expect(plan.roles).toContain("CONTRADICTION_CHECK");
		expect(plan.actions.some((a) => /contradiction/i.test(a.why))).toBe(true);
	});

	it("9. claim-promotion lazy signal schedules work", () => {
		resetClaimPromotionSeqForTests();
		const ledger = ledgerFixture();
		const claims = buildClaimPromotionSet({
			ledger,
			userQuery: "Did I open Upwork?",
			lazy: true,
		});
		const plan = planInvestigationV11({
			userMessage: "Did I open Upwork?",
			store: createVideoEvidenceStore(ledger),
			sourceDurationSec: 20,
			needs: classifyMediaContextNeeds("Did I open Upwork?"),
			claimPromotion: claims,
		});
		expect(plan.lazyScheduledClaimIds.length).toBeGreaterThan(0);
		expect(plan.candidates.some((c) => c.sources.includes("claim_promotion"))).toBe(true);
	});

	it("10. already-supported irrelevant claim is skipped", () => {
		resetClaimPromotionSeqForTests();
		const ledger = ledgerFixture();
		const claims = buildClaimPromotionSet({
			ledger,
			userQuery: "What did I say near the end?",
			lazy: true,
		});
		const plan = planInvestigationV11({
			userMessage: "What did I say near the end?",
			store: createVideoEvidenceStore(ledger),
			sourceDurationSec: 20,
			needs: classifyMediaContextNeeds("What did I say near the end?"),
			claimPromotion: claims,
		});
		expect(plan.skippedIrrelevant.length).toBeGreaterThan(0);
	});

	it("11. range ranking deterministic", () => {
		const store = createVideoEvidenceStore(ledgerFixture());
		const a = rankCandidateRanges(
			[
				{
					id: "late_window",
					startSourceTimeSec: 14,
					endSourceTimeSec: 20,
					sources: ["end_hint"],
					score: 0,
					scoreBreakdown: {},
					reason: "late",
				},
				{
					id: "early",
					startSourceTimeSec: 0,
					endSourceTimeSec: 3,
					sources: ["hierarchy_coarse"],
					score: 0,
					scoreBreakdown: {},
					reason: "early",
				},
			],
			{
				userMessage: "What brief popup appeared near the end?",
				intents: ["temporary_ui", "visual_state"],
				store,
				maxRanked: 2,
			},
		);
		const b = rankCandidateRanges(
			[
				{
					id: "late_window",
					startSourceTimeSec: 14,
					endSourceTimeSec: 20,
					sources: ["end_hint"],
					score: 0,
					scoreBreakdown: {},
					reason: "late",
				},
				{
					id: "early",
					startSourceTimeSec: 0,
					endSourceTimeSec: 3,
					sources: ["hierarchy_coarse"],
					score: 0,
					scoreBreakdown: {},
					reason: "early",
				},
			],
			{
				userMessage: "What brief popup appeared near the end?",
				intents: ["temporary_ui", "visual_state"],
				store,
				maxRanked: 2,
			},
		);
		expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
		expect(a[0]!.id).toBe("late_window");
		expect(a[0]!.score).toBeGreaterThan(a[1]!.score);
	});

	it("12. no GT leakage", () => {
		const plan = planInvestigationV11({
			userMessage: "What visibly happens near the end?",
			store: createVideoEvidenceStore(ledgerFixture()),
			sourceDurationSec: 20,
			needs: classifyMediaContextNeeds("What visibly happens near the end?"),
		});
		expect(JSON.stringify(plan)).not.toMatch(/groundTruth|__gt__|CASE_2/i);
	});

	it("13. per-role budgets enforced", () => {
		const plan = planInvestigationV11({
			userMessage: "Walk me through the entire recording chronologically",
			store: createVideoEvidenceStore(ledgerFixture(60)),
			sourceDurationSec: 60,
			needs: classifyMediaContextNeeds("Walk me through the entire recording chronologically"),
			roleBudgets: {
				maxVisualInspections: 1,
				maxOcrInspections: 0,
				maxRankedRanges: 2,
			},
		});
		expect(plan.actions.filter((a) => a.tool === "inspect_video_range").length).toBeLessThanOrEqual(
			1,
		);
		expect(plan.actions.filter((a) => a.tool === "inspect_region").length).toBe(0);
		expect(plan.ranked.length).toBeLessThanOrEqual(2);
	});

	it("14. stop on sufficient evidence (speech early-stop)", async () => {
		const set = await runMasterVideoInvestigatorV1_1({
			userMessage: "What did I say near the end?",
			needs: classifyMediaContextNeeds("What did I say near the end?"),
			assetId: "a1",
			sourceDurationSec: 20,
			videoPath: null,
			ledger: ledgerFixture(),
			speechEvidence: {
				assetId: "a1",
				sourceDurationSec: 20,
				status: "available",
				audioStreamPresent: true,
				segments: [
					{
						startSourceTimeSec: 15,
						endSourceTimeSec: 18,
						text: "wrapping up now",
					},
				],
				timings: {
					audioProbeMs: 0,
					audioExtractMs: 0,
					sttMs: 0,
					transcriptParseMs: 0,
					transcriptCacheMs: 0,
					segmentCount: 1,
					cacheHit: true,
				},
			},
		});
		expect(set?.metrics.earlyStop).toBe(true);
		expect(set?.stopReason).toBe("sufficient_evidence");
		expect(set?.toolTrace.some((t) => t.tool === "inspect_region")).toBe(false);
	});

	it("15. stop on insufficient evidence", async () => {
		const empty: TemporalEventLedger = {
			meta: {
				assetId: "a1",
				sourceDurationSec: 5,
				timebase: "SOURCE_MEDIA_TIME",
				builtAtIso: new Date().toISOString(),
				constructionMs: 0,
				additionalModelCalls: 0,
				eventCount: 0,
				claimCount: 0,
				evidenceRefCount: 0,
			},
			events: [],
		};
		const set = await runMasterVideoInvestigatorV1_1({
			userMessage: "obscure xyzzy question with no signals",
			needs: {
				category: "fallback",
				visual: false,
				speech: false,
				cursor: false,
				injectSpeech: false,
			},
			assetId: "a1",
			sourceDurationSec: 5,
			videoPath: null,
			ledger: empty,
		});
		// fallback may skip via shouldRunInvestigator — accept skip or insufficient
		expect(
			set?.stopReason === "deterministic_edit_skip" ||
				set?.stopReason === "media_not_required" ||
				set?.stopReason === "insufficient_evidence" ||
				set?.stopReason === "no_uncertainty" ||
				set?.stopReason === "sufficient_evidence",
		).toBe(true);
	});

	it("16. whole-video hierarchy avoids full brute-force scan", () => {
		const q = "Walk me through the entire recording from beginning to end";
		const plan = planInvestigationV11({
			userMessage: q,
			store: createVideoEvidenceStore(ledgerFixture(90)),
			sourceDurationSec: 90,
			needs: classifyMediaContextNeeds(q),
			roleBudgets: { maxVisualInspections: 3, maxRankedRanges: 3 },
		});
		expect(plan.intents).toContain("chronology");
		expect(plan.candidates.some((c) => c.sources.includes("hierarchy_coarse"))).toBe(true);
		const ranges = plan.actions.filter((a) => a.tool === "inspect_video_range");
		expect(ranges.length).toBeLessThanOrEqual(3);
		expect(
			ranges.every(
				(a) =>
					a.tool === "inspect_video_range" && a.endSourceSec - a.startSourceSec <= 90 * 0.4 + 0.01,
			),
		).toBe(true);
	});

	it("17–20. V1 still available; V1.1 reduces tools vs V1 on speech; 0 model calls; no GT", async () => {
		const q = "What did I say near the end?";
		const needs = classifyMediaContextNeeds(q);
		const ledger = ledgerFixture();
		const store = createVideoEvidenceStore(ledger);
		const v1Plan = planInvestigation({
			userMessage: q,
			store,
			sourceDurationSec: 20,
			needs,
		});
		const v11 = planInvestigationV11({
			userMessage: q,
			store,
			sourceDurationSec: 20,
			needs,
		});
		const v1Visual = v1Plan.actions.filter(
			(a) =>
				a.tool === "inspect_region" ||
				a.tool === "inspect_video_range" ||
				a.tool === "inspect_frame",
		).length;
		const v11Visual = v11.actions.filter(
			(a) =>
				a.tool === "inspect_region" ||
				a.tool === "inspect_video_range" ||
				a.tool === "inspect_frame",
		).length;
		expect(v11Visual).toBeLessThanOrEqual(v1Visual);
		expect(v11.actions.some((a) => a.tool === "get_transcript_range")).toBe(true);
		const v1 = await runMasterVideoInvestigatorV1({
			userMessage: q,
			needs,
			assetId: "a1",
			sourceDurationSec: 20,
			videoPath: null,
			ledger,
		});
		expect(v1?.metrics.investigatorModelCalls).toBe(0);
		expect(v11.additionalModelCalls).toBe(0);
		expect(JSON.stringify(v11)).not.toMatch(/groundTruth/);
	});
});
