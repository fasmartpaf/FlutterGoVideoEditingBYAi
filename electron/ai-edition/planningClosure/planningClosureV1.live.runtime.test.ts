/**
 * Planning Closure V1 live/offline regressions.
 * Planning + bounded investigation only — no edit execution.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
import type { InvestigationEvidenceSet } from "../videoInvestigator/types";
import {
	analyzePlanRedundancy,
	leaksExecution,
	PLANNING_CLOSURE_V1_PROVIDER_ID,
	runPlanningClosureV1,
} from "./index";

function led(events: TemporalEventLedger["events"]): TemporalEventLedger {
	return {
		meta: {
			assetId: "live",
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

function buildChain(events: TemporalEventLedger["events"], intent: string, sp?: SpeechEvidence) {
	const ledger = led(events);
	const claims = buildClaimPromotionSet({ ledger, lazy: false });
	const source = buildSourceStoryV2(
		buildSourceStoryEvidenceInput({
			assetId: "live",
			sourceDurationSec: 20,
			ledger,
			claimPromotion: claims,
			speechEvidence: sp,
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
		buildEditPlanV1({ sourceStoryV2: source, targetStoryV1: target, editGapV1: gap }),
	).plan;
	return { source, target, gap, plan, ledger, claims };
}

function mockInv(partial: Partial<InvestigationEvidenceSet> = {}): InvestigationEvidenceSet {
	return {
		version: 1,
		assetId: "live",
		timebase: "SOURCE_MEDIA_TIME",
		questionSummary: partial.questionSummary ?? "live mock",
		focusRange: { startSourceTimeSec: 10, endSourceTimeSec: 14 },
		stopReason: partial.stopReason ?? "sufficient_evidence",
		coverage: {
			sourceDurationSec: 20,
			rangesInspected: [{ startSourceTimeSec: 10, endSourceTimeSec: 14 }],
			frameTimesSec: [12],
			roiCount: 1,
			modalitiesTouched: ["visual"],
			absenceIsStrong: false,
		},
		observations: partial.observations ?? [],
		claims: partial.claims ?? [],
		toolTrace: [],
		metrics: {
			memoryQueryMs: 0,
			planningMs: 1,
			toolExecutionMs: 2,
			verificationMs: 1,
			totalInvestigationMs: 4,
			frameCacheHits: 1,
			frameCacheMisses: 0,
			newlyExtractedFrames: 0,
			roiExtractMs: 0,
			transcriptRetrievalMs: 0,
			cursorRetrievalMs: 0,
			investigatorModelCalls: 0,
			stepsUsed: 2,
			toolCalls: 2,
			policyVersion: "v1.1",
		},
		internalBriefing: "",
		additionalFrames: [],
		providerId: "CURRENT_OPENSCREEN_INVESTIGATOR_V1_1",
		...partial,
	};
}

describe("Planning Closure V1 live regressions", () => {
	it("A–D: unknown target / Case2 / Case4 / Settings — plan only", async () => {
		resetClaimPromotionSeqForTests();
		resetSourceStoryV2SeqForTests();
		resetTargetStoryV1SeqForTests();
		resetEditGapSeqForTests();
		resetEditPlanSeqForTests();
		const t0 = performance.now();

		// A. Unknown UI target
		const unknown = buildChain(
			[
				{
					id: "e_s",
					assetId: "live",
					startSourceTimeSec: 10,
					endSourceTimeSec: 14,
					type: "speech",
					modalities: ["speech"],
					summary: "click the control",
					claims: [],
					evidence: [],
					confidence: "high",
				},
			],
			"Emphasize the Publish button I click.",
			speech([
				{
					startSourceTimeSec: 10,
					endSourceTimeSec: 14,
					text: "Emphasize the Publish button I click.",
				},
			]),
		);
		const unknownPlan = {
			...unknown.plan,
			items: [
				{
					id: "plan_unknown",
					gapIds: ["gap_u"],
					sourceBeatIds: unknown.source.beats.slice(0, 1).map((b) => b.id),
					targetBeatIds: [] as string[],
					editorialIntent: "Identify Publish button near click (unclear_focus)",
					candidateStrategies: [
						{
							family: "needs_more_evidence" as const,
							rationale: "UI identity unknown",
							feasibility: "needs_more_evidence" as const,
							risk: "low" as const,
							rankScore: 100,
							evidenceRequirements: ["identify target UI region"],
						},
					],
					preferredStrategy: "needs_more_evidence" as const,
					priority: "high" as const,
					feasibility: "needs_more_evidence" as const,
					constraints: [] as string[],
					preservationRefs: [] as string[],
					provenanceRefs: [] as string[],
					confidence: 0.4,
					evidenceRange: { startSourceTimeSec: 10, endSourceTimeSec: 14 },
				},
			],
		};
		const a = await runPlanningClosureV1({
			initialPlan: unknownPlan,
			sourceStoryV2: unknown.source,
			targetStoryV1: unknown.target,
			editGapV1: unknown.gap,
			evidence: {
				assetId: "live",
				sourceDurationSec: 20,
				userMessage: "Emphasize the Publish button I click.",
				contextNeeds: classifyMediaContextNeeds("Emphasize the Publish button I click."),
				ledger: unknown.ledger,
				cursorInteractions: [{ sourceTimeSec: 12, interactionType: "click" }],
			},
			investigate: async () =>
				mockInv({
					claims: [
						{
							id: "ic_p",
							hypothesis: "Publish button near cursor",
							verdict: "not_verified",
							rationale: "label still ambiguous",
							evidence: [],
						},
					],
				}),
		});
		expect(a.evidenceRequests.length).toBeGreaterThan(0);
		expect(a.planVersions.length).toBeGreaterThan(1);

		// B. Case 2
		const case2 = buildChain(
			[
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
		let case2Inv = 0;
		const b = await runPlanningClosureV1({
			initialPlan: case2.plan,
			sourceStoryV2: case2.source,
			targetStoryV1: case2.target,
			editGapV1: case2.gap,
			evidence: {
				assetId: "live",
				sourceDurationSec: 20,
				userMessage: "Make this professional.",
				contextNeeds: classifyMediaContextNeeds("Make this professional."),
				ledger: case2.ledger,
			},
			investigate: async () => {
				case2Inv += 1;
				return mockInv({});
			},
		});
		expect(b.stopReason === "no_requests_needed" || case2Inv <= 1).toBe(true);
		expect(JSON.stringify(b)).not.toMatch(/Upwork workflow|restart recording action/i);

		// C. Case 4
		const case4 = buildChain(
			[
				{
					id: "e_corr",
					assetId: "live",
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
			speech([
				{ startSourceTimeSec: 8, endSourceTimeSec: 9, text: "open the timeline panel" },
				{ startSourceTimeSec: 9.2, endSourceTimeSec: 10, text: "I meant the effects panel" },
			]),
		);
		let case4Inv = 0;
		const c = await runPlanningClosureV1({
			initialPlan: case4.plan,
			sourceStoryV2: case4.source,
			targetStoryV1: case4.target,
			editGapV1: case4.gap,
			evidence: {
				assetId: "live",
				sourceDurationSec: 20,
				userMessage: "Make this shorter and clearer.",
				contextNeeds: classifyMediaContextNeeds("Make this shorter and clearer."),
				ledger: case4.ledger,
			},
			investigate: async () => {
				case4Inv += 1;
				return mockInv({});
			},
		});
		expect(case4Inv).toBe(0);
		expect(c.stopReason).toBe("no_requests_needed");
		const redundancy = analyzePlanRedundancy(case4.plan);

		// D. Settings
		const settings = buildChain(
			[
				{
					id: "e_s",
					assetId: "live",
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
			speech([{ startSourceTimeSec: 4, endSourceTimeSec: 5, text: "I'm opening Settings." }]),
		);
		const d = await runPlanningClosureV1({
			initialPlan: settings.plan,
			sourceStoryV2: settings.source,
			targetStoryV1: settings.target,
			editGapV1: settings.gap,
			evidence: {
				assetId: "live",
				sourceDurationSec: 20,
				userMessage: "Zoom into Settings when I open it.",
				contextNeeds: classifyMediaContextNeeds("Zoom into Settings when I open it."),
				ledger: settings.ledger,
			},
			investigate: async () =>
				mockInv({
					stopReason: "insufficient_evidence",
					claims: [
						{
							id: "ic_s",
							hypothesis: "Settings opened",
							verdict: "not_verified",
							rationale: "no Settings UI",
							evidence: [],
						},
					],
				}),
		});
		const dFinal = d.planVersions[d.planVersions.length - 1]!.plan;
		expect(dFinal.items.every((i) => i.preferredStrategy !== "zoom")).toBe(true);

		const latencyMs = performance.now() - t0;
		const artifact = {
			providerId: PLANNING_CLOSURE_V1_PROVIDER_ID,
			latencyMs,
			unknownTarget: {
				requests: a.evidenceRequests.length,
				rounds: a.metrics.closureRounds,
				stopReason: a.stopReason,
				versions: a.planVersions.length,
				cacheHits: a.metrics.cacheHitsApprox,
				orchCalls: a.metrics.orchestrationModelCalls,
				latency: a.metrics.latencyMs,
			},
			case2: {
				requests: b.evidenceRequests.length,
				invCalls: case2Inv,
				stopReason: b.stopReason,
				orchCalls: b.metrics.orchestrationModelCalls,
			},
			case4: {
				requests: c.evidenceRequests.length,
				invCalls: case4Inv,
				stopReason: c.stopReason,
				planItems: case4.plan.items.length,
				redundancy,
				preferred: case4.plan.items.map((i) => i.preferredStrategy),
			},
			settings: {
				requests: d.evidenceRequests.length,
				stopReason: d.stopReason,
				preferred: dFinal.items.map((i) => i.preferredStrategy),
				noZoom: dFinal.items.every((i) => i.preferredStrategy !== "zoom"),
			},
		};

		expect(leaksExecution(JSON.stringify(artifact))).toBe(false);
		const outDir = path.join(process.cwd(), "tmp/perception-benchmark/planning-closure-v1");
		mkdirSync(outDir, { recursive: true });
		writeFileSync(path.join(outDir, "live-regressions.json"), JSON.stringify(artifact, null, 2));
		expect(latencyMs).toBeLessThan(30_000);
	});
});
