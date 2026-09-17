/**
 * Edit Gap V1 live/offline regressions — Case 2 / Case 4 / narrated.
 * Deterministic only (0 LLM). Does not execute edits.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildClaimPromotionSet, resetClaimPromotionSeqForTests } from "../claimPromotion";
import {
	buildSourceStoryEvidenceInput,
	buildSourceStoryV2,
	resetSourceStoryV2SeqForTests,
} from "../sourceStory/v2";
import type { SpeechEvidence } from "../speechEvidence/types";
import { buildTargetStoryV1, resetTargetStoryV1SeqForTests } from "../targetStory/v1";
import type { TemporalEventLedger } from "../temporalEventLedger/types";
import {
	buildEditGapV1,
	EDIT_GAP_V1_PROVIDER_ID,
	evaluateEditGapRubric,
	leaksToolOrEditPlan,
	resetEditGapSeqForTests,
	validateAndSanitizeEditGapV1,
} from "./index";

function led(events: TemporalEventLedger["events"], dur = 20): TemporalEventLedger {
	return {
		meta: {
			assetId: "live",
			sourceDurationSec: dur,
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

function speech(segments: SpeechEvidence["segments"]): SpeechEvidence {
	return {
		assetId: "live",
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

describe("Edit Gap V1 live regressions", () => {
	it("Case 2 / Case 4 / narrated — Edit Gap only, no edits", () => {
		resetClaimPromotionSeqForTests();
		resetSourceStoryV2SeqForTests();
		resetTargetStoryV1SeqForTests();
		resetEditGapSeqForTests();
		const t0 = performance.now();

		const case2Ledger = led([
			{
				id: "e_file",
				assetId: "live",
				startSourceTimeSec: 2,
				endSourceTimeSec: 2,
				type: "observed_visible_text",
				modalities: ["visual"],
				summary: "Observed visible text: File",
				claims: [{ id: "c1", text: "File", epistemic: "observed", evidence: [] }],
				evidence: [],
				confidence: "high",
			},
			{
				id: "e_diff",
				assetId: "live",
				startSourceTimeSec: 2,
				endSourceTimeSec: 4,
				type: "visual_transition",
				modalities: ["visual"],
				summary: "App transition",
				claims: [],
				evidence: [],
				confidence: "medium",
			},
			{
				id: "e_r",
				assetId: "live",
				startSourceTimeSec: 18,
				endSourceTimeSec: 19,
				type: "observed_visible_text",
				modalities: ["visual"],
				summary: "Observed visible text: Restart recording",
				claims: [{ id: "c2", text: "Restart recording", epistemic: "observed", evidence: [] }],
				evidence: [],
				confidence: "high",
			},
			{
				id: "e_up",
				assetId: "live",
				startSourceTimeSec: 6,
				endSourceTimeSec: 6,
				type: "passive_chrome",
				modalities: ["visual"],
				summary: "Passive chrome: Upwork (tab)",
				claims: [],
				evidence: [],
				confidence: "medium",
			},
		]);

		const claims2 = buildClaimPromotionSet({ ledger: case2Ledger, lazy: false });
		const source2 = buildSourceStoryV2(
			buildSourceStoryEvidenceInput({
				assetId: "live",
				sourceDurationSec: 20,
				ledger: case2Ledger,
				claimPromotion: claims2,
				frames: [],
				changes: [
					{
						fromSourceTimeSec: 2,
						toSourceTimeSec: 4,
						score: 0.3,
						classification: "significant",
					},
				],
			}),
		);
		const target2 = buildTargetStoryV1({
			sourceStoryV2: source2,
			userIntent: "Make this professional.",
		});
		const gap2 = validateAndSanitizeEditGapV1(
			buildEditGapV1({
				sourceStoryV2: source2,
				targetStoryV1: target2,
				userIntent: "Make this professional.",
			}),
		).gap;

		expect(gap2.providerId).toBe(EDIT_GAP_V1_PROVIDER_ID);
		expect(gap2.gaps.some((g) => g.category === "distracting_temporary_ui")).toBe(true);
		expect(JSON.stringify(gap2)).not.toMatch(/restart action cleanup|Upwork workflow removal/i);
		expect(leaksToolOrEditPlan(JSON.stringify(gap2))).toBe(false);

		const case4Ledger = led([
			{
				id: "e_corr",
				assetId: "live",
				startSourceTimeSec: 8,
				endSourceTimeSec: 10,
				type: "spoken_correction",
				modalities: ["speech"],
				summary: "correction timeline → effects",
				claims: [],
				evidence: [],
				confidence: "high",
			},
			{
				id: "e_xd",
				assetId: "live",
				startSourceTimeSec: 8,
				endSourceTimeSec: 10,
				type: "contradiction",
				modalities: ["speech", "visual"],
				summary: "Speech asserts panel open without visual",
				claims: [],
				evidence: [],
				confidence: "medium",
			},
		]);
		const speech4 = speech([
			{ startSourceTimeSec: 8, endSourceTimeSec: 9, text: "open the timeline panel" },
			{ startSourceTimeSec: 9.2, endSourceTimeSec: 10, text: "I meant the effects panel" },
		]);
		const claims4 = buildClaimPromotionSet({ ledger: case4Ledger, lazy: false });
		const source4 = buildSourceStoryV2(
			buildSourceStoryEvidenceInput({
				assetId: "live",
				sourceDurationSec: 20,
				ledger: case4Ledger,
				claimPromotion: claims4,
				speechEvidence: speech4,
				frames: [],
				changes: [],
			}),
		);
		const target4 = buildTargetStoryV1({
			sourceStoryV2: source4,
			userIntent: "Make this shorter and clearer.",
		});
		const gap4 = validateAndSanitizeEditGapV1(
			buildEditGapV1({
				sourceStoryV2: source4,
				targetStoryV1: target4,
				userIntent: "Make this shorter and clearer.",
			}),
		).gap;
		expect(gap4.gaps.some((g) => g.category === "hesitation_or_correction_friction")).toBe(true);
		expect(
			gap4.gaps.some((g) => g.category === "preservation_requirement") || gap4.preserved.length > 0,
		).toBe(true);
		expect(JSON.stringify(gap4)).not.toMatch(/panel-open cleanup|trim\s+\d/i);

		const narrLedger = led([
			{
				id: "e_n",
				assetId: "live",
				startSourceTimeSec: 1,
				endSourceTimeSec: 12,
				type: "speech",
				modalities: ["speech"],
				summary: "Narrated explanation",
				claims: [],
				evidence: [],
				confidence: "high",
			},
		]);
		const narrSpeech = speech([
			{
				startSourceTimeSec: 1,
				endSourceTimeSec: 12,
				text: "This recording shows the main workspace and how the toolbar relates to effects.",
			},
		]);
		const claimsN = buildClaimPromotionSet({ ledger: narrLedger, lazy: false });
		const sourceN = buildSourceStoryV2(
			buildSourceStoryEvidenceInput({
				assetId: "live",
				sourceDurationSec: 20,
				ledger: narrLedger,
				claimPromotion: claimsN,
				speechEvidence: narrSpeech,
				frames: [],
				changes: [],
			}),
		);
		const targetN = buildTargetStoryV1({
			sourceStoryV2: sourceN,
			userIntent: "Make this shorter and clearer.",
		});
		const gapN = validateAndSanitizeEditGapV1(
			buildEditGapV1({
				sourceStoryV2: sourceN,
				targetStoryV1: targetN,
				userIntent: "Make this shorter and clearer.",
			}),
		).gap;
		expect(gapN.gaps.every((g) => g.category !== "visual_story_mismatch")).toBe(true);
		expect(JSON.stringify(gapN)).not.toMatch(/missing visual action/i);

		const latencyMs = performance.now() - t0;
		const artifact = {
			providerId: EDIT_GAP_V1_PROVIDER_ID,
			latencyMs,
			case2: {
				sourceBeats: source2.beats.length,
				targetBeats: target2.targetBeats.length,
				gaps: gap2.gaps.length,
				preservationConstraints: gap2.preserved.length,
				missingSupport: gap2.metrics.missingSupportGaps,
				modelCalls: gap2.metrics.additionalModelCalls,
				serializedBytes: gap2.metrics.serializedBytesApprox,
				summary: gap2.summary,
				categories: gap2.gaps.map((g) => g.category),
				rubric: evaluateEditGapRubric(gap2),
			},
			case4: {
				sourceBeats: source4.beats.length,
				targetBeats: target4.targetBeats.length,
				gaps: gap4.gaps.length,
				preservationConstraints: gap4.preserved.length,
				missingSupport: gap4.metrics.missingSupportGaps,
				modelCalls: gap4.metrics.additionalModelCalls,
				serializedBytes: gap4.metrics.serializedBytesApprox,
				summary: gap4.summary,
				categories: gap4.gaps.map((g) => g.category),
				rubric: evaluateEditGapRubric(gap4),
			},
			narrated: {
				sourceBeats: sourceN.beats.length,
				targetBeats: targetN.targetBeats.length,
				gaps: gapN.gaps.length,
				preservationConstraints: gapN.preserved.length,
				missingSupport: gapN.metrics.missingSupportGaps,
				modelCalls: gapN.metrics.additionalModelCalls,
				serializedBytes: gapN.metrics.serializedBytesApprox,
				summary: gapN.summary,
				categories: gapN.gaps.map((g) => g.category),
				rubric: evaluateEditGapRubric(gapN),
			},
		};

		const outDir = path.join(process.cwd(), "tmp/perception-benchmark/edit-gap-v1");
		mkdirSync(outDir, { recursive: true });
		writeFileSync(path.join(outDir, "live-regressions.json"), JSON.stringify(artifact, null, 2));

		expect(gap2.metrics.additionalModelCalls).toBe(0);
		expect(gap4.metrics.additionalModelCalls).toBe(0);
		expect(gapN.metrics.additionalModelCalls).toBe(0);
		expect(latencyMs).toBeLessThan(30_000);
	});
});
