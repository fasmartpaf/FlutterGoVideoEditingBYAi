/**
 * Target Story V1 — behavioral tests (deterministic, 0 LLM for grounding).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { buildClaimPromotionSet, resetClaimPromotionSeqForTests } from "../../claimPromotion";
import { classifyMediaContextNeeds } from "../../mediaContextNeeds";
import {
	buildSourceStoryEvidenceInput,
	buildSourceStoryV2,
	resetSourceStoryV2SeqForTests,
} from "../../sourceStory/v2";
import type { SpeechEvidence } from "../../speechEvidence/types";
import type { TemporalEventLedger } from "../../temporalEventLedger/types";
import { prepareTargetStoryForTurn } from "../prepare";
import type { TargetStory } from "../types";
import {
	buildTargetStoryV1,
	constrainTargetStoryWithV1,
	leaksToolInstructions,
	resetTargetStoryV1SeqForTests,
	TARGET_STORY_V1_PROVIDER_ID,
	targetStoryFromV1,
} from "./index";

beforeEach(() => {
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

function storyFromEvents(
	events: TemporalEventLedger["events"],
	speech?: SpeechEvidence,
	extra?: { specialist?: Parameters<typeof buildClaimPromotionSet>[0]["specialist"] },
) {
	const led = ledger(events);
	const claims = buildClaimPromotionSet({
		ledger: led,
		specialist: extra?.specialist,
		lazy: false,
	});
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

describe("Target Story V1", () => {
	it("1. target beats reference source beats", () => {
		const source = storyFromEvents([
			{
				id: "e1",
				assetId: "a1",
				startSourceTimeSec: 2,
				endSourceTimeSec: 3,
				type: "visual_transition",
				modalities: ["visual"],
				summary: "Visual transition",
				claims: [],
				evidence: [],
				confidence: "medium",
			},
		]);
		const target = buildTargetStoryV1({
			sourceStoryV2: source,
			userIntent: "Make this professional.",
		});
		expect(target.providerId).toBe(TARGET_STORY_V1_PROVIDER_ID);
		expect(target.targetBeats.length).toBeGreaterThan(0);
		for (const b of target.targetBeats) {
			expect(b.sourceBeatIds.length).toBeGreaterThan(0);
			expect(b.sourceBeatIds.every((id) => source.beats.some((sb) => sb.id === id))).toBe(true);
		}
		expect(target.metrics.additionalModelCalls).toBe(0);
	});

	it("2–3. passive context and unknown action not promoted", () => {
		const source = storyFromEvents([
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
		]);
		const target = buildTargetStoryV1({
			sourceStoryV2: source,
			userIntent: "Make this professional.",
		});
		const blob = JSON.stringify(target);
		expect(blob).not.toMatch(/emphasize the Upwork workflow|Upwork workflow/i);
		expect(
			target.targetBeats.every(
				(b) => !/opened Upwork|worked on Upwork/i.test(b.viewerShouldUnderstand),
			),
		).toBe(true);
		expect(target.unresolved.some((u) => /restart|unknown|not verified/i.test(u.text))).toBe(true);
		expect(blob).not.toMatch(/show user restarted recording/i);
	});

	it("4. contradiction affects target story", () => {
		const source = storyFromEvents(
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
			speechEv([{ startSourceTimeSec: 4, endSourceTimeSec: 5, text: "I'm opening Settings." }]),
		);
		const target = buildTargetStoryV1({
			sourceStoryV2: source,
			userIntent: "Make this professional.",
		});
		expect(target.unresolved.some((u) => u.kind === "contradiction")).toBe(true);
		expect(JSON.stringify(target)).not.toMatch(/Show the Settings workflow/i);
	});

	it("5. spoken correction handled", () => {
		const source = storyFromEvents(
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
		const target = buildTargetStoryV1({
			sourceStoryV2: source,
			userIntent: "Make this concise and professional.",
		});
		expect(target.preserve.some((p) => /corrected/i.test(p.text))).toBe(true);
		expect(target.deEmphasize.some((d) => /mistaken|Initial/i.test(d.text))).toBe(true);
		expect(JSON.stringify(target)).not.toMatch(/show Timeline then Effects/i);
	});

	it("6–7. unsupported request marker, not source fact", () => {
		const source = storyFromEvents(
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
			speechEv([{ startSourceTimeSec: 4, endSourceTimeSec: 5, text: "I'm opening Settings." }]),
		);
		const target = buildTargetStoryV1({
			sourceStoryV2: source,
			userIntent: "Focus on the Settings section",
		});
		expect(
			target.unsupportedRequests.some((u) => u.status === "requested_but_not_source_supported"),
		).toBe(true);
		expect(
			target.targetBeats.every(
				(b) => !/completed Settings workflow/i.test(b.viewerShouldUnderstand),
			),
		).toBe(true);
	});

	it("8–9. no tool names / no edit timestamps", () => {
		const source = storyFromEvents([
			{
				id: "e1",
				assetId: "a1",
				startSourceTimeSec: 1,
				endSourceTimeSec: 2,
				type: "visual_transition",
				modalities: ["visual"],
				summary: "change",
				claims: [],
				evidence: [],
				confidence: "medium",
			},
		]);
		const target = buildTargetStoryV1({
			sourceStoryV2: source,
			userIntent: "Make this professional.",
		});
		const blob = JSON.stringify(target);
		expect(leaksToolInstructions(blob)).toBe(false);
		expect(blob).not.toMatch(/\btrim\s+\d|\bzoom\s+at\s+\d/i);

		const bad: TargetStory = {
			objective: "Add a zoom at 12.4s and trim 1.2 seconds",
			audienceExperience: "Use dissolve transition",
			style: { pacing: "faster" },
			editingIntent: {
				objective: "polish",
				constraints: [],
				desiredQualities: ["clarity"],
				preserveMeaning: true,
			},
			targetBeats: [
				{
					id: "t1",
					sourceBeatIds: source.beats[0] ? [source.beats[0].id] : ["sb1"],
					purpose: "intro",
					desiredOutcome: "Add zoom at 12.4s",
					importance: "essential",
					pacing: "preserve",
					changeNeeded: true,
					rationale: "trim 2s",
				},
			],
			preserve: [],
			change: [],
		};
		const { warnings, story } = constrainTargetStoryWithV1(bad, target);
		expect(warnings.length).toBeGreaterThan(0);
		expect(leaksToolInstructions(JSON.stringify(story))).toBe(false);
	});

	it("10–11. preserve/de-emphasize/remove + temporary UI", () => {
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
		expect(
			target.preserve.length + target.deEmphasize.length + target.removeCandidates.length,
		).toBeGreaterThan(0);
		expect(
			target.removeCandidates.some((r) => /Restart|recording/i.test(r.text)) ||
				target.deEmphasize.some((d) => /Restart|recording/i.test(d.text)),
		).toBe(true);
	});

	it("12. Upwork invariant", () => {
		const source = storyFromEvents([
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
		]);
		const target = buildTargetStoryV1({
			sourceStoryV2: source,
			userIntent: "Make this professional.",
		});
		expect(
			target.targetBeats.every(
				(b) => !/Upwork workflow|emphasize.*Upwork|focus on Upwork/i.test(b.viewerShouldUnderstand),
			),
		).toBe(true);
		expect(
			target.targetBeats.every((b) => b.emphasize.every((e) => !/Upwork workflow/i.test(e))),
		).toBe(true);
		expect(JSON.stringify(target.targetBeats.map((b) => b.emphasize))).not.toMatch(
			/Upwork workflow/i,
		);
	});

	it("13. Case 2 invariant", () => {
		const source = storyFromEvents([
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
		]);
		const target = buildTargetStoryV1({
			sourceStoryV2: source,
			userIntent: "Make this professional.",
		});
		expect(
			target.targetBeats.every(
				(b) => !/feature.*restart|show.*user restarted/i.test(b.viewerShouldUnderstand),
			),
		).toBe(true);
		expect(
			target.targetBeats.every((b) =>
				b.emphasize.every((e) => !/User restarted the recording/i.test(e)),
			),
		).toBe(true);
		expect(
			target.removeCandidates.some((r) => /Restart/i.test(r.text)) ||
				target.deEmphasize.some((d) => /Restart/i.test(d.text)),
		).toBe(true);
	});

	it("14. Case 4 invariant", () => {
		const source = storyFromEvents(
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
			speechEv([
				{ startSourceTimeSec: 8, endSourceTimeSec: 9, text: "open the timeline panel" },
				{ startSourceTimeSec: 9.2, endSourceTimeSec: 10, text: "I meant the effects panel" },
			]),
		);
		const target = buildTargetStoryV1({
			sourceStoryV2: source,
			userIntent: "Make this professional and concise.",
		});
		expect(JSON.stringify(target)).not.toMatch(/show Timeline then Effects/i);
		expect(target.preserve.some((p) => /corrected/i.test(p.text))).toBe(true);
	});

	it("15. Settings invariant", () => {
		const source = storyFromEvents(
			[
				{
					id: "e_xd",
					assetId: "a1",
					startSourceTimeSec: 4,
					endSourceTimeSec: 5,
					type: "contradiction",
					modalities: ["speech", "visual"],
					summary: "Settings contradiction",
					claims: [],
					evidence: [],
					confidence: "medium",
				},
			],
			speechEv([{ startSourceTimeSec: 4, endSourceTimeSec: 5, text: "I'm opening Settings." }]),
		);
		const target = buildTargetStoryV1({
			sourceStoryV2: source,
			userIntent: "Make this professional.",
		});
		expect(target.unresolved.some((u) => /settings|completed|avoid/i.test(u.text))).toBe(true);
	});

	it("16. stable visual + narration", () => {
		const source = storyFromEvents(
			[],
			speechEv([
				{ startSourceTimeSec: 2, endSourceTimeSec: 5, text: "Today I explain the timeline." },
				{
					startSourceTimeSec: 6,
					endSourceTimeSec: 9,
					text: "Next I cover the effects panel idea.",
				},
			]),
		);
		const target = buildTargetStoryV1({
			sourceStoryV2: source,
			userIntent: "Make this clearer.",
		});
		expect(
			target.targetBeats.some((b) => /Spoken|spoken|explain/i.test(b.viewerShouldUnderstand)),
		).toBe(true);
	});

	it("17–19. whole-video arc, provenance, no GT", () => {
		const source = storyFromEvents(
			[
				{
					id: "e1",
					assetId: "a1",
					startSourceTimeSec: 1,
					endSourceTimeSec: 2,
					type: "visual_transition",
					modalities: ["visual"],
					summary: "start change",
					claims: [],
					evidence: [],
					confidence: "medium",
				},
				{
					id: "e2",
					assetId: "a1",
					startSourceTimeSec: 10,
					endSourceTimeSec: 12,
					type: "visual_transition",
					modalities: ["visual"],
					summary: "mid change",
					claims: [],
					evidence: [],
					confidence: "medium",
				},
			],
			speechEv([{ startSourceTimeSec: 0.5, endSourceTimeSec: 2, text: "Intro today." }]),
		);
		const target = buildTargetStoryV1({
			sourceStoryV2: source,
			userIntent: "Make this engaging.",
		});
		expect(target.desiredArc.length).toBeGreaterThan(10);
		expect(target.provenance.sourceBeatIds.length).toBe(source.beats.length);
		expect(JSON.stringify(target)).not.toMatch(/groundTruth|__gt__/i);
		const legacy = targetStoryFromV1(target);
		expect(legacy.targetBeats.every((b) => b.sourceBeatIds.length > 0)).toBe(true);
	});

	it("20–22. prepare path, Source Story gate, no autonomous edits", () => {
		const source = storyFromEvents([
			{
				id: "e1",
				assetId: "a1",
				startSourceTimeSec: 1,
				endSourceTimeSec: 2,
				type: "visual_transition",
				modalities: ["visual"],
				summary: "change",
				claims: [],
				evidence: [],
				confidence: "medium",
			},
		]);
		const prep = prepareTargetStoryForTurn({
			contextNeeds: classifyMediaContextNeeds("Make this professional."),
			userMessage: "Make this professional.",
			sourceStoryRequested: true,
			sourceStoryV2: source,
			useV1: true,
		});
		expect(prep?.providerId).toBe(TARGET_STORY_V1_PROVIDER_ID);
		expect(prep?.targetV1).toBeTruthy();
		expect(prep?.promptSection).toMatch(/TARGET_STORY_V1_EVIDENCE/);
		expect(prep?.promptSection).toMatch(/NOT an edit list/i);
		expect(prep?.promptSection).toMatch(/Do not run editing tools/i);

		const skip = prepareTargetStoryForTurn({
			contextNeeds: classifyMediaContextNeeds("Trim the first 2 seconds"),
			userMessage: "Trim the first 2 seconds",
			sourceStoryRequested: false,
		});
		expect(skip).toBeNull();
	});
});
