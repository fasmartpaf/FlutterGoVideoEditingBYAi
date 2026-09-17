/**
 * Edit Plan V1 live/offline regressions — Case 2 / Case 4 / narrated.
 * Planning only (0 LLM). Does not execute edits.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildClaimPromotionSet, resetClaimPromotionSeqForTests } from "../claimPromotion";
import { buildEditGapV1, resetEditGapSeqForTests, validateAndSanitizeEditGapV1 } from "../editGap";
import {
	buildSourceStoryEvidenceInput,
	buildSourceStoryV2,
	resetSourceStoryV2SeqForTests,
} from "../sourceStory/v2";
import type { SpeechEvidence } from "../speechEvidence/types";
import { buildTargetStoryV1, resetTargetStoryV1SeqForTests } from "../targetStory/v1";
import type { TemporalEventLedger } from "../temporalEventLedger/types";
import {
	buildEditPlanV1,
	EDIT_PLAN_V1_PROVIDER_ID,
	evaluateEditPlanRubric,
	leaksExecutableToolArgs,
	resetEditPlanSeqForTests,
	validateAndSanitizeEditPlanV1,
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

function runPlan(events: TemporalEventLedger["events"], intent: string, speechEv?: SpeechEvidence) {
	const ledger = led(events);
	const claims = buildClaimPromotionSet({ ledger, lazy: false });
	const source = buildSourceStoryV2(
		buildSourceStoryEvidenceInput({
			assetId: "live",
			sourceDurationSec: 20,
			ledger,
			claimPromotion: claims,
			speechEvidence: speechEv,
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
	const target = buildTargetStoryV1({ sourceStoryV2: source, userIntent: intent });
	const gap = validateAndSanitizeEditGapV1(
		buildEditGapV1({ sourceStoryV2: source, targetStoryV1: target, userIntent: intent }),
	).gap;
	const plan = validateAndSanitizeEditPlanV1(
		buildEditPlanV1({
			sourceStoryV2: source,
			targetStoryV1: target,
			editGapV1: gap,
		}),
	).plan;
	return { source, target, gap, plan };
}

describe("Edit Plan V1 live regressions", () => {
	it("Case 2 / Case 4 / narrated — plan only, no execution", () => {
		resetClaimPromotionSeqForTests();
		resetSourceStoryV2SeqForTests();
		resetTargetStoryV1SeqForTests();
		resetEditGapSeqForTests();
		resetEditPlanSeqForTests();
		const t0 = performance.now();

		const case2 = runPlan(
			[
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
			],
			"Make this professional.",
		);

		expect(case2.plan.providerId).toBe(EDIT_PLAN_V1_PROVIDER_ID);
		expect(
			case2.plan.items.some((i) =>
				i.candidateStrategies.some((s) =>
					["trim", "crop", "preserve", "no_safe_edit"].includes(s.family),
				),
			),
		).toBe(true);
		expect(JSON.stringify(case2.plan)).not.toMatch(/restart recording action|Upwork workflow/i);
		expect(leaksExecutableToolArgs(JSON.stringify(case2.plan))).toBe(false);

		const case4 = runPlan(
			[
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
			],
			"Make this shorter and clearer.",
			speech([
				{ startSourceTimeSec: 8, endSourceTimeSec: 9, text: "open the timeline panel" },
				{ startSourceTimeSec: 9.2, endSourceTimeSec: 10, text: "I meant the effects panel" },
			]),
		);
		expect(
			case4.plan.items.some((i) =>
				i.candidateStrategies.some((s) => s.family === "trim" || s.family === "preserve"),
			),
		).toBe(true);
		expect(JSON.stringify(case4.plan)).not.toMatch(/zoom.{0,30}(timeline|effects)\s+panel/i);

		const narrated = runPlan(
			[
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
			],
			"Make this professional and concise.",
			speech([
				{
					startSourceTimeSec: 1,
					endSourceTimeSec: 12,
					text: "This recording shows the main workspace and how the toolbar relates to effects.",
				},
			]),
		);
		expect(narrated.plan.items.every((i) => i.preferredStrategy !== "zoom")).toBe(true);

		const latencyMs = performance.now() - t0;
		const artifact = {
			providerId: EDIT_PLAN_V1_PROVIDER_ID,
			latencyMs,
			case2: {
				gapsConsumed: case2.plan.metrics.gapsConsumed,
				planItems: case2.plan.metrics.planItemsGenerated,
				strategies: case2.plan.metrics.candidateStrategiesGenerated,
				unsupported: case2.plan.metrics.unsupportedStrategies,
				conflicts: case2.plan.metrics.conflicts,
				needsMoreEvidence: case2.plan.metrics.needsMoreEvidenceItems,
				modelCalls: case2.plan.metrics.additionalModelCalls,
				serializedBytes: case2.plan.metrics.serializedBytesApprox,
				summary: case2.plan.summary,
				preferred: case2.plan.items.map((i) => i.preferredStrategy),
				rubric: evaluateEditPlanRubric(case2.plan, case2.gap.gaps.length),
			},
			case4: {
				gapsConsumed: case4.plan.metrics.gapsConsumed,
				planItems: case4.plan.metrics.planItemsGenerated,
				strategies: case4.plan.metrics.candidateStrategiesGenerated,
				unsupported: case4.plan.metrics.unsupportedStrategies,
				conflicts: case4.plan.metrics.conflicts,
				needsMoreEvidence: case4.plan.metrics.needsMoreEvidenceItems,
				modelCalls: case4.plan.metrics.additionalModelCalls,
				serializedBytes: case4.plan.metrics.serializedBytesApprox,
				summary: case4.plan.summary,
				preferred: case4.plan.items.map((i) => i.preferredStrategy),
				rubric: evaluateEditPlanRubric(case4.plan, case4.gap.gaps.length),
			},
			narrated: {
				gapsConsumed: narrated.plan.metrics.gapsConsumed,
				planItems: narrated.plan.metrics.planItemsGenerated,
				strategies: narrated.plan.metrics.candidateStrategiesGenerated,
				unsupported: narrated.plan.metrics.unsupportedStrategies,
				conflicts: narrated.plan.metrics.conflicts,
				needsMoreEvidence: narrated.plan.metrics.needsMoreEvidenceItems,
				modelCalls: narrated.plan.metrics.additionalModelCalls,
				serializedBytes: narrated.plan.metrics.serializedBytesApprox,
				summary: narrated.plan.summary,
				preferred: narrated.plan.items.map((i) => i.preferredStrategy),
				rubric: evaluateEditPlanRubric(narrated.plan, narrated.gap.gaps.length),
			},
		};

		const outDir = path.join(process.cwd(), "tmp/perception-benchmark/edit-plan-v1");
		mkdirSync(outDir, { recursive: true });
		writeFileSync(path.join(outDir, "live-regressions.json"), JSON.stringify(artifact, null, 2));

		expect(case2.plan.metrics.additionalModelCalls).toBe(0);
		expect(case4.plan.metrics.additionalModelCalls).toBe(0);
		expect(narrated.plan.metrics.additionalModelCalls).toBe(0);
		expect(latencyMs).toBeLessThan(30_000);
	});
});
