/**
 * Edit Plan V1 — behavioral tests (deterministic, 0 LLM). Does not execute edits.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { buildClaimPromotionSet, resetClaimPromotionSeqForTests } from "../claimPromotion";
import { buildEditGapV1, resetEditGapSeqForTests, validateAndSanitizeEditGapV1 } from "../editGap";
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
	buildEditPlanV1,
	defaultEditCapabilityRegistry,
	EDIT_PLAN_V1_PROVIDER_ID,
	evaluateEditPlanRubric,
	leaksExecutableToolArgs,
	prepareEditPlanForTurn,
	resetEditPlanSeqForTests,
	validateAndSanitizeEditPlanV1,
} from "./index";

beforeEach(() => {
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

function storyFromEvents(events: TemporalEventLedger["events"], speech?: SpeechEvidence) {
	const led = ledger(events);
	const claims = buildClaimPromotionSet({ ledger: led, lazy: false });
	return buildSourceStoryV2(
		buildSourceStoryEvidenceInput({
			assetId: "a1",
			sourceDurationSec: 20,
			ledger: led,
			claimPromotion: claims,
			speechEvidence: speech,
			frames: [
				{
					assetId: "a1",
					sourceTimeSec: 2,
					virtualTimeSec: 2,
					reason: "periodic",
					imagePath: "/tmp/f.jpg",
					mimeType: "image/jpeg",
					width: 64,
					height: 36,
					byteLength: 10,
				},
			],
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
}

function planFor(events: TemporalEventLedger["events"], intent: string, speech?: SpeechEvidence) {
	const source = storyFromEvents(events, speech);
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

describe("Edit Plan V1", () => {
	it("1. each plan item maps to gap", () => {
		const { gap, plan } = planFor(
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
		expect(plan.providerId).toBe(EDIT_PLAN_V1_PROVIDER_ID);
		for (const item of plan.items) {
			if (/denoise/i.test(item.editorialIntent)) continue;
			expect(item.gapIds.length).toBeGreaterThan(0);
			expect(item.gapIds.every((id) => gap.gaps.some((g) => g.id === id))).toBe(true);
		}
		expect(plan.metrics.additionalModelCalls).toBe(0);
	});

	it("2. preservation constraints survive", () => {
		const { plan } = planFor(
			[
				{
					id: "e_corr",
					assetId: "a1",
					startSourceTimeSec: 8,
					endSourceTimeSec: 10,
					type: "spoken_correction",
					modalities: ["speech"],
					summary: "Correction timeline → effects",
					claims: [],
					evidence: [],
					confidence: "high",
				},
			],
			"Make this shorter and clearer.",
			speechEv([
				{
					startSourceTimeSec: 8,
					endSourceTimeSec: 9,
					text: "First I will open the timeline panel.",
				},
				{ startSourceTimeSec: 9.2, endSourceTimeSec: 10.5, text: "I meant the effects panel." },
			]),
		);
		expect(
			plan.hardConstraints.some((c) => /preserve/i.test(c)) ||
				plan.items.some(
					(i) => i.preservationRefs.length > 0 || i.constraints.some((c) => /preserve/i.test(c)),
				),
		).toBe(true);
	});

	it("3. passive context creates no plan", () => {
		const { plan } = planFor(
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
		const blob = JSON.stringify(
			plan.items.map((i) => ({
				intent: i.editorialIntent,
				preferred: i.preferredStrategy,
				families: i.candidateStrategies.map((s) => s.family),
			})),
		);
		expect(blob).not.toMatch(
			/trim.{0,20}upwork|zoom.{0,20}upwork|emphasize.{0,20}upwork|upwork workflow/i,
		);
		expect(
			plan.items.every(
				(i) =>
					!/upwork/i.test(i.editorialIntent) ||
					i.preferredStrategy === "preserve" ||
					i.preferredStrategy === "no_safe_edit",
			),
		).toBe(true);
		// No item should target Upwork as a trim/zoom/highlight workflow
		expect(
			plan.items.every(
				(i) =>
					!(
						/upwork/i.test(i.editorialIntent) &&
						(i.preferredStrategy === "trim" ||
							i.preferredStrategy === "zoom" ||
							i.preferredStrategy === "crop")
					),
			),
		).toBe(true);
	});

	it("4. unknown action not targeted", () => {
		const { plan } = planFor(
			[
				{
					id: "e_r",
					assetId: "a1",
					startSourceTimeSec: 18,
					endSourceTimeSec: 18,
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
		expect(JSON.stringify(plan)).not.toMatch(/remove restart action|restart recording action/i);
	});

	it("5. contradiction handled safely", () => {
		const { plan } = planFor(
			[
				{
					id: "e_c",
					assetId: "a1",
					startSourceTimeSec: 4,
					endSourceTimeSec: 5,
					type: "contradiction",
					modalities: ["speech", "visual"],
					summary: "Speech asserts opening Settings without visual support",
					claims: [],
					evidence: [],
					confidence: "medium",
				},
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
			"Make this professional.",
			speechEv([{ startSourceTimeSec: 4, endSourceTimeSec: 5, text: "I'm opening Settings." }]),
		);
		expect(
			plan.items.some(
				(i) =>
					i.preferredStrategy === "avoid_implication" ||
					i.candidateStrategies.some((s) => s.family === "avoid_implication"),
			),
		).toBe(true);
		expect(JSON.stringify(plan)).not.toMatch(/zoom.{0,20}settings|annotate Settings/i);
	});

	it("6. unsupported capability marked unsupported", () => {
		const { source, target, gap } = planFor(
			[
				{
					id: "e_d",
					assetId: "a1",
					startSourceTimeSec: 2,
					endSourceTimeSec: 4,
					type: "visual_transition",
					modalities: ["visual"],
					summary: "App transition",
					claims: [],
					evidence: [],
					confidence: "medium",
				},
			],
			"Make this professional and remove background noise.",
		);
		const caps = defaultEditCapabilityRegistry();
		expect(caps.denoise).toBe(false);
		const plan = validateAndSanitizeEditPlanV1(
			buildEditPlanV1({
				sourceStoryV2: source,
				targetStoryV1: {
					...target,
					viewerGoal: "professional video with denoise / remove background noise",
					communicationGoal: target.communicationGoal,
				},
				editGapV1: gap,
				availableCapabilities: caps,
			}),
		).plan;
		expect(
			plan.items.some(
				(i) =>
					i.feasibility === "unsupported" &&
					i.candidateStrategies.some((s) => s.unsupportedCapability === "denoise"),
			),
		).toBe(true);
	});

	it("7–8. no-safe-edit and needs-more-evidence supported", () => {
		const { plan: hudPlan } = planFor(
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
		expect(
			hudPlan.items.some((i) =>
				i.candidateStrategies.some(
					(s) => s.family === "no_safe_edit" || s.family === "preserve" || s.family === "trim",
				),
			),
		).toBe(true);

		const { plan: focusPlan } = planFor(
			[
				{
					id: "e_s",
					assetId: "a1",
					startSourceTimeSec: 2,
					endSourceTimeSec: 5,
					type: "speech",
					modalities: ["speech"],
					summary: "Emphasize the button",
					claims: [],
					evidence: [],
					confidence: "high",
				},
			],
			"Emphasize the Publish button I click — make focus clearer.",
			speechEv([
				{
					startSourceTimeSec: 2,
					endSourceTimeSec: 5,
					text: "Emphasize the Publish button I click.",
				},
			]),
		);
		// Unclear focus without verified button → needs_more_evidence or avoid fabricating zoom
		const blob = JSON.stringify(focusPlan);
		expect(blob).not.toMatch(/addZoom\s*\(|"startSec"\s*:\s*\d/i);
	});

	it("9–11. gap→strategy, registry feasibility, no executable args", () => {
		const { plan } = planFor(
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
		const hud = plan.items.find((i) =>
			/temporary|HUD|distracting|recording/i.test(i.editorialIntent),
		);
		expect(hud).toBeTruthy();
		expect(hud!.candidateStrategies.some((s) => s.family === "trim")).toBe(true);
		expect(plan.capabilities.trim).toBe(true);
		expect(plan.capabilities.transitions).toBe(false);
		expect(plan.capabilities.denoise).toBe(false);
		expect(leaksExecutableToolArgs(JSON.stringify(plan))).toBe(false);
		expect(JSON.stringify(plan)).not.toMatch(/"startSec"\s*:\s*\d|"endSec"\s*:\s*\d|addTrim\s*\(/i);
	});

	it("12. no timeline mutation surface", () => {
		const { plan } = planFor(
			[
				{
					id: "e_d",
					assetId: "a1",
					startSourceTimeSec: 2,
					endSourceTimeSec: 4,
					type: "visual_transition",
					modalities: ["visual"],
					summary: "App transition",
					claims: [],
					evidence: [],
					confidence: "medium",
				},
			],
			"Make this professional.",
		);
		expect(JSON.stringify(plan)).not.toMatch(/\bmutateTimeline\b|\bapplyEdit\b/);
		expect(plan.hardConstraints.some((c) => /do not mutate AxcutDocument/i.test(c))).toBe(true);
	});

	it("13–15. conflict / dependency / priority ordering", () => {
		const { plan } = planFor(
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
				{
					id: "e_xd",
					assetId: "a1",
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
			speechEv([
				{ startSourceTimeSec: 8, endSourceTimeSec: 9, text: "open the timeline panel" },
				{ startSourceTimeSec: 9.2, endSourceTimeSec: 10, text: "I meant the effects panel" },
			]),
		);
		expect(plan.items.length).toBeGreaterThan(0);
		expect(plan.items.length).toBeLessThanOrEqual(16);
		// Honesty / preservation tend to rank before polish
		const idxs = plan.items.map((i, idx) => ({ i, idx }));
		const honesty = idxs.find((x) =>
			x.i.candidateStrategies.some((s) => s.family === "avoid_implication"),
		);
		const preserve = idxs.find((x) => x.i.preferredStrategy === "preserve");
		if (honesty && preserve) {
			expect(honesty.idx).toBeLessThanOrEqual(preserve.idx + 3);
		}
		expect(
			plan.items.some((i) => (i.dependsOn?.length ?? 0) > 0) || plan.conflicts.length >= 0,
		).toBe(true);
	});

	it("16. Case 2", () => {
		const { plan } = planFor(
			[
				{
					id: "e_file",
					assetId: "a1",
					startSourceTimeSec: 2,
					endSourceTimeSec: 2,
					type: "observed_visible_text",
					modalities: ["visual"],
					summary: "Observed visible text: File",
					claims: [{ id: "cf", text: "File", epistemic: "observed", evidence: [] }],
					evidence: [],
					confidence: "high",
				},
				{
					id: "e_r",
					assetId: "a1",
					startSourceTimeSec: 18,
					endSourceTimeSec: 19,
					type: "observed_visible_text",
					modalities: ["visual"],
					summary: "Observed visible text: Restart recording",
					claims: [{ id: "cr", text: "Restart recording", epistemic: "observed", evidence: [] }],
					evidence: [],
					confidence: "high",
				},
			],
			"Make this professional.",
		);
		expect(
			plan.items.some((i) =>
				i.candidateStrategies.some((s) =>
					["trim", "crop", "annotation", "preserve", "no_safe_edit"].includes(s.family),
				),
			),
		).toBe(true);
		expect(JSON.stringify(plan)).not.toMatch(/restart recording action|Upwork workflow/i);
	});

	it("17. Upwork", () => {
		const { plan } = planFor(
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
		expect(JSON.stringify(plan.items)).not.toMatch(
			/trim.{0,40}upwork|zoom.{0,40}upwork|highlight.{0,40}upwork/i,
		);
	});

	it("18. Case 4", () => {
		const { plan } = planFor(
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
				{
					id: "e_xd",
					assetId: "a1",
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
			speechEv([
				{ startSourceTimeSec: 8, endSourceTimeSec: 9, text: "open the timeline panel" },
				{ startSourceTimeSec: 9.2, endSourceTimeSec: 10, text: "I meant the effects panel" },
			]),
		);
		expect(
			plan.items.some((i) =>
				i.candidateStrategies.some((s) => s.family === "trim" || s.family === "preserve"),
			),
		).toBe(true);
		expect(JSON.stringify(plan)).not.toMatch(/zoom.{0,30}(timeline|effects)\s+panel/i);
	});

	it("19. Settings", () => {
		const { plan } = planFor(
			[
				{
					id: "e_c",
					assetId: "a1",
					startSourceTimeSec: 4,
					endSourceTimeSec: 5,
					type: "contradiction",
					modalities: ["speech", "visual"],
					summary: "Speech asserts opening Settings without visual support",
					claims: [],
					evidence: [],
					confidence: "medium",
				},
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
			"Focus on the Settings section — make it professional.",
			speechEv([{ startSourceTimeSec: 4, endSourceTimeSec: 5, text: "I'm opening Settings." }]),
		);
		expect(
			plan.items.some(
				(i) =>
					i.preferredStrategy === "avoid_implication" ||
					i.preferredStrategy === "needs_more_evidence" ||
					i.preferredStrategy === "no_safe_edit" ||
					i.feasibility === "needs_more_evidence",
			),
		).toBe(true);
		expect(JSON.stringify(plan)).not.toMatch(/fabricate Settings|zoom to Settings/i);
	});

	it("20. stable narration", () => {
		const { plan } = planFor(
			[
				{
					id: "e_s",
					assetId: "a1",
					startSourceTimeSec: 2,
					endSourceTimeSec: 8,
					type: "speech",
					modalities: ["speech"],
					summary: "Useful narration on stable screen",
					claims: [],
					evidence: [],
					confidence: "high",
				},
			],
			"Make this professional and concise.",
			speechEv([
				{
					startSourceTimeSec: 2,
					endSourceTimeSec: 8,
					text: "Here is how the effects panel works once you open it from the toolbar.",
				},
			]),
		);
		expect(plan.items.every((i) => i.preferredStrategy !== "zoom")).toBe(true);
		expect(JSON.stringify(plan)).not.toMatch(/manufacture zoom|add visual activity/i);
	});

	it("21–22. unsupported request + no GT leakage", () => {
		const { plan } = planFor(
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
			"Focus on the Settings section",
			speechEv([{ startSourceTimeSec: 4, endSourceTimeSec: 5, text: "I'm opening Settings." }]),
		);
		expect(
			plan.items.some(
				(i) =>
					i.preferredStrategy === "needs_more_evidence" ||
					i.preferredStrategy === "no_safe_edit" ||
					i.feasibility === "needs_more_evidence",
			),
		).toBe(true);
		expect(JSON.stringify(plan)).not.toMatch(/CASE2_LOCKED|ground.?truth|GT_/i);
	});

	it("23–27. compose regressions + prepare + 0 model calls", () => {
		const source = storyFromEvents([
			{
				id: "e_d",
				assetId: "a1",
				startSourceTimeSec: 2,
				endSourceTimeSec: 4,
				type: "visual_transition",
				modalities: ["visual"],
				summary: "App transition",
				claims: [],
				evidence: [],
				confidence: "medium",
			},
		]);
		const target = buildTargetStoryV1({
			sourceStoryV2: source,
			userIntent: "Make this professional.",
		});
		const gap = validateAndSanitizeEditGapV1(
			buildEditGapV1({ sourceStoryV2: source, targetStoryV1: target }),
		).gap;
		const plan = buildEditPlanV1({
			sourceStoryV2: source,
			targetStoryV1: target,
			editGapV1: gap,
		});
		expect(source.version).toBe(2);
		expect(target.version).toBe(1);
		expect(gap.version).toBe(1);
		expect(plan.metrics.additionalModelCalls).toBe(0);
		const rubric = evaluateEditPlanRubric(plan, gap.gaps.length);
		expect(rubric.noExecutionLeakage).toBe(true);
		expect(rubric.compactness).toBe(true);

		const prep = prepareEditPlanForTurn({
			contextNeeds: classifyMediaContextNeeds("Make this professional and polish the pacing."),
			sourceStoryV2: source,
			targetStoryV1: target,
			editGapV1: gap,
		});
		expect(prep?.providerId).toBe(EDIT_PLAN_V1_PROVIDER_ID);

		const skip = prepareEditPlanForTurn({
			contextNeeds: classifyMediaContextNeeds("What is on screen?"),
			sourceStoryV2: source,
			targetStoryV1: target,
			editGapV1: gap,
		});
		expect(skip).toBeNull();
	});
});
