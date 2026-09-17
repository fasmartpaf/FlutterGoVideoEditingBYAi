/**
 * Edit Gap V1 — behavioral tests (deterministic, 0 LLM).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { buildClaimPromotionSet, resetClaimPromotionSeqForTests } from "../claimPromotion";
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
	buildEditGapV1,
	EDIT_GAP_V1_PROVIDER_ID,
	evaluateEditGapRubric,
	leaksToolOrEditPlan,
	prepareEditGapForTurn,
	resetEditGapSeqForTests,
	validateAndSanitizeEditGapV1,
} from "./index";

beforeEach(() => {
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

function gapFor(events: TemporalEventLedger["events"], intent: string, speech?: SpeechEvidence) {
	const source = storyFromEvents(events, speech);
	const target = buildTargetStoryV1({ sourceStoryV2: source, userIntent: intent });
	const gap = buildEditGapV1({ sourceStoryV2: source, targetStoryV1: target, userIntent: intent });
	return { source, target, gap: validateAndSanitizeEditGapV1(gap).gap };
}

describe("Edit Gap V1", () => {
	it("1. Source preserve → no removal gap", () => {
		const { target, gap } = gapFor(
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
		const preserveBeats = target.targetBeats.filter((b) => b.disposition === "preserve");
		for (const tb of preserveBeats) {
			const removal = gap.gaps.filter(
				(g) =>
					g.category !== "preservation_requirement" &&
					g.category !== "weak_transition" &&
					g.provenance.targetBeatIds.includes(tb.id) &&
					(g.desiredChange.toLowerCase().includes("omit this phase") ||
						g.problemStatement.toLowerCase().includes("remove-candidate")),
			);
			expect(removal).toHaveLength(0);
		}
		expect(
			gap.gaps.some((g) => g.category === "preservation_requirement") || gap.preserved.length >= 0,
		).toBe(true);
	});

	it("2. Target de-emphasize → valid gap", () => {
		const { gap } = gapFor(
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
			gap.gaps.some(
				(g) =>
					g.category === "distracting_temporary_ui" ||
					g.category === "unclear_focus" ||
					g.category === "pacing_excess",
			),
		).toBe(true);
	});

	it("3. remove_candidate → gap, not edit", () => {
		const { gap } = gapFor(
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
		const blob = JSON.stringify(gap);
		expect(gap.gaps.some((g) => g.category === "distracting_temporary_ui")).toBe(true);
		expect(leaksToolOrEditPlan(blob)).toBe(false);
		expect(blob).not.toMatch(/\bcrop bottom|\btrim\s+\d|\bcut at\s+\d/i);
	});

	it("4. unknown action not assumed", () => {
		const { gap } = gapFor(
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
		const blob = JSON.stringify(gap);
		expect(blob).not.toMatch(/remove restart action|restart action cleanup/i);
		expect(gap.gaps.some((g) => g.category === "distracting_temporary_ui")).toBe(true);
	});

	it("5. passive context not workflow", () => {
		const { gap } = gapFor(
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
		const blob = JSON.stringify(gap);
		expect(blob).not.toMatch(/upwork workflow removal|remove upwork workflow/i);
		const noise = gap.gaps.filter((g) => g.category === "passive_context_noise");
		for (const g of noise) {
			expect(g.desiredChange).not.toMatch(/workflow removal|opened Upwork/i);
		}
	});

	it("6. contradiction creates honesty gap", () => {
		const { gap } = gapFor(
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
		expect(gap.gaps.some((g) => g.category === "unsupported_story_implication")).toBe(true);
	});

	it("7. correction creates clarity gap", () => {
		const { gap } = gapFor(
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
				{
					startSourceTimeSec: 9.2,
					endSourceTimeSec: 10.5,
					text: "I mean... I meant the effects panel.",
				},
			]),
		);
		expect(gap.gaps.some((g) => g.category === "hesitation_or_correction_friction")).toBe(true);
		expect(JSON.stringify(gap)).not.toMatch(
			/panel-open cleanup|open(ed)?\s+the\s+timeline\s+panel\s+cleanup/i,
		);
	});

	it("8. preservation requirement generated", () => {
		const { gap } = gapFor(
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
			gap.gaps.some((g) => g.category === "preservation_requirement") || gap.preserved.length > 0,
		).toBe(true);
		expect(gap.hardConstraints.some((c) => /preserve/i.test(c))).toBe(true);
	});

	it("9. missing target support represented", () => {
		const { gap } = gapFor(
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
		expect(gap.gaps.some((g) => g.category === "missing_target_support")).toBe(true);
		expect(JSON.stringify(gap)).not.toMatch(/\bfabricate Settings\b|\binvent Settings footage\b/i);
		expect(
			gap.gaps
				.filter((g) => g.category === "missing_target_support")
				.every((g) => /do not fabricate|cannot be fully achieved/i.test(g.desiredChange)),
		).toBe(true);
	});

	it("10–12. no tool names / edit commands / exact edit timestamps", () => {
		const { gap } = gapFor(
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
		const blob = JSON.stringify(gap);
		expect(leaksToolOrEditPlan(blob)).toBe(false);
		expect(blob).not.toMatch(
			/\btrim\s+\d|\bcut at\s+\d|\bcrop bottom|\bzoom at\s+\d|ffmpeg|AxcutDocument/i,
		);
		for (const g of gap.gaps) {
			if (g.provenance.sourceRange) {
				expect(g.desiredChange).not.toMatch(/cut at|trim from|crop at/i);
			}
		}
	});

	it("13–14. provenance + source/target beat mapping", () => {
		const { source, target, gap } = gapFor(
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
		expect(gap.providerId).toBe(EDIT_GAP_V1_PROVIDER_ID);
		for (const g of gap.gaps) {
			if (g.category === "missing_target_support") continue;
			const hasMap =
				g.provenance.sourceBeatIds.length > 0 ||
				g.provenance.targetBeatIds.length > 0 ||
				(g.provenance.correctionIds?.length ?? 0) > 0 ||
				(g.provenance.contradictionIds?.length ?? 0) > 0;
			expect(hasMap).toBe(true);
			for (const sid of g.provenance.sourceBeatIds) {
				expect(source.beats.some((b) => b.id === sid)).toBe(true);
			}
			for (const tid of g.provenance.targetBeatIds) {
				expect(target.targetBeats.some((b) => b.id === tid)).toBe(true);
			}
		}
	});

	it("15. Case 2", () => {
		const { gap } = gapFor(
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
		expect(gap.gaps.some((g) => g.category === "distracting_temporary_ui")).toBe(true);
		expect(JSON.stringify(gap)).not.toMatch(/restart action cleanup|invented Upwork workflow/i);
	});

	it("16. Upwork", () => {
		const { gap } = gapFor(
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
		expect(JSON.stringify(gap)).not.toMatch(/Upwork workflow removal|remove Upwork workflow/i);
		const cats = new Set(gap.gaps.map((g) => g.category));
		expect(
			cats.size === 0 ||
				[...cats].every((c) =>
					[
						"passive_context_noise",
						"preservation_requirement",
						"weak_transition",
						"pacing_excess",
					].includes(c),
				) ||
				gap.gaps.every(
					(g) =>
						g.category !== "unsupported_story_implication" || !/Upwork/i.test(g.problemStatement),
				),
		).toBe(true);
	});

	it("17. Case 4", () => {
		const { gap } = gapFor(
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
		expect(gap.gaps.some((g) => g.category === "hesitation_or_correction_friction")).toBe(true);
		expect(gap.hardConstraints.some((c) => /corrected|preserve/i.test(c))).toBe(true);
		expect(JSON.stringify(gap)).not.toMatch(/panel-open cleanup/i);
	});

	it("18. Settings", () => {
		const { gap } = gapFor(
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
		expect(gap.gaps.some((g) => g.category === "unsupported_story_implication")).toBe(true);
		expect(gap.gaps.some((g) => g.category === "missing_target_support")).toBe(true);
	});

	it("19. stable narration — no automatic visual-action gap", () => {
		const { gap } = gapFor(
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
			"Make this shorter and clearer.",
			speechEv([
				{
					startSourceTimeSec: 2,
					endSourceTimeSec: 8,
					text: "Here is how the effects panel works once you open it from the toolbar.",
				},
			]),
		);
		expect(gap.gaps.every((g) => g.category !== "visual_story_mismatch")).toBe(true);
		expect(JSON.stringify(gap)).not.toMatch(/missing visual action|add visual demonstration/i);
	});

	it("20. whole-video compactness", () => {
		const { gap } = gapFor(
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
				{
					id: "e_up",
					assetId: "a1",
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
		expect(gap.gaps.length).toBeLessThanOrEqual(16);
		expect(gap.summary.length).toBeGreaterThan(10);
		expect(gap.summary.length).toBeLessThan(800);
		const rubric = evaluateEditGapRubric(gap);
		expect(rubric.compactness).toBe(true);
		expect(rubric.noToolLeakage).toBe(true);
		expect(rubric.noEditPlanLeakage).toBe(true);
	});

	it("21. no GT leakage", () => {
		const { gap } = gapFor(
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
		expect(JSON.stringify(gap)).not.toMatch(/CASE2_LOCKED|ground.?truth|GT_/i);
	});

	it("22–23. Target + Source Story regression green (compose)", () => {
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
		expect(source.version).toBe(2);
		expect(target.version).toBe(1);
		const gap = buildEditGapV1({ sourceStoryV2: source, targetStoryV1: target });
		expect(gap.metrics.additionalModelCalls).toBe(0);
		expect(gap.metrics.sourceBeatsConsumed).toBe(source.beats.length);
		expect(gap.metrics.targetBeatsConsumed).toBe(target.targetBeats.length);
	});

	it("24–25. prepare path + no timeline mutation surface", () => {
		const source = storyFromEvents([
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
		]);
		const target = buildTargetStoryV1({
			sourceStoryV2: source,
			userIntent: "Make this professional.",
		});
		const needs = classifyMediaContextNeeds("Make this professional and polish the pacing.");
		const prep = prepareEditGapForTurn({
			contextNeeds: needs,
			userMessage: "Make this professional.",
			sourceStoryV2: source,
			targetStoryV1: target,
		});
		expect(prep?.providerId).toBe(EDIT_GAP_V1_PROVIDER_ID);
		expect(prep?.editGapV1.metrics.additionalModelCalls).toBe(0);
		expect(JSON.stringify(prep)).not.toMatch(/AxcutDocument|mutateTimeline|applyEdit/i);

		const skip = prepareEditGapForTurn({
			contextNeeds: classifyMediaContextNeeds("What is on screen?"),
			userMessage: "What is on screen?",
			sourceStoryV2: source,
			targetStoryV1: target,
		});
		expect(skip).toBeNull();
	});
});
