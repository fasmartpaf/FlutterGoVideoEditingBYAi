/**
 * Source Story V2 — evidence-grounded behavioral tests (0 LLM for truth structure).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { buildClaimPromotionSet, resetClaimPromotionSeqForTests } from "../../claimPromotion";
import { classifyMediaContextNeeds } from "../../mediaContextNeeds";
import type { SpeechEvidence } from "../../speechEvidence/types";
import type { TemporalEventLedger } from "../../temporalEventLedger/types";
import type { VisualChange, VisualEvidenceFrame } from "../../visualEvidence/types";
import { prepareSourceStoryForTurn } from "../prepare";
import type { SourceStory } from "../types";
import {
	buildSourceStoryEvidenceInput,
	buildSourceStoryV2,
	constrainSourceStoryWithV2,
	resetSourceStoryV2SeqForTests,
	SOURCE_STORY_V2_PROVIDER_ID,
	sourceStoryFromV2,
} from "./index";

beforeEach(() => {
	resetSourceStoryV2SeqForTests();
	resetClaimPromotionSeqForTests();
});

function speechEv(
	segments: SpeechEvidence["segments"],
	status: SpeechEvidence["status"] = "available",
): SpeechEvidence {
	return {
		assetId: "a1",
		sourceDurationSec: 20,
		segments,
		status,
		audioStreamPresent: status !== "no_audio",
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

function ledgerBase(events: TemporalEventLedger["events"] = []): TemporalEventLedger {
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

function frames(...times: number[]): VisualEvidenceFrame[] {
	return times.map((t) => ({
		assetId: "a1",
		sourceTimeSec: t,
		virtualTimeSec: t,
		reason: "periodic",
		imagePath: `/tmp/f-${t}.jpg`,
		mimeType: "image/jpeg",
		width: 64,
		height: 36,
		byteLength: 10,
	}));
}

describe("Source Story V2", () => {
	it("1. promoted supported claim becomes eligible story fact", () => {
		const ledger = ledgerBase([
			{
				id: "e1",
				assetId: "a1",
				startSourceTimeSec: 5,
				endSourceTimeSec: 6,
				type: "observed_visible_text",
				modalities: ["visual"],
				summary: "Observed visible text: Restart recording",
				claims: [{ id: "c1", text: "Restart recording", epistemic: "observed", evidence: [] }],
				evidence: [],
				confidence: "high",
			},
		]);
		const claims = buildClaimPromotionSet({ ledger, lazy: false });
		const input = buildSourceStoryEvidenceInput({
			assetId: "a1",
			sourceDurationSec: 20,
			ledger,
			claimPromotion: claims,
			changes: [
				{
					fromSourceTimeSec: 4.5,
					toSourceTimeSec: 5.5,
					score: 0.2,
					classification: "moderate",
				},
			],
			frames: frames(5),
		});
		const story = buildSourceStoryV2(input);
		expect(story.providerId).toBe(SOURCE_STORY_V2_PROVIDER_ID);
		const hasFactOrCtx = story.beats.some(
			(b) =>
				b.facts.some((f) => /Restart|visible/i.test(f.text)) ||
				b.context.some((c) => /Restart/i.test(c.text)),
		);
		expect(hasFactOrCtx).toBe(true);
		expect(story.metrics.additionalModelCalls).toBe(0);
	});

	it("2. unknown action does not become story fact", () => {
		const ledger = ledgerBase([
			{
				id: "e_up",
				assetId: "a1",
				startSourceTimeSec: 2,
				endSourceTimeSec: 2,
				type: "passive_chrome",
				modalities: ["visual"],
				summary: "Passive chrome: Upwork (tab)",
				claims: [],
				evidence: [],
				confidence: "medium",
			},
		]);
		const claims = buildClaimPromotionSet({ ledger, lazy: false });
		const story = buildSourceStoryV2(
			buildSourceStoryEvidenceInput({
				assetId: "a1",
				sourceDurationSec: 20,
				ledger,
				claimPromotion: claims,
				frames: frames(2),
			}),
		);
		const actionFacts = story.beats
			.flatMap((b) => b.facts)
			.filter((f) => /opened|worked|navigat/i.test(f.text));
		expect(actionFacts.length).toBe(0);
		expect(
			story.unresolved.some((u) => u.kind === "unresolved_action" || /unknown/i.test(u.epistemic)),
		).toBe(true);
	});

	it("3. contradicted action remains contradiction", () => {
		const ledger = ledgerBase([
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
				claims: [{ id: "cs", text: "I'm opening Settings.", epistemic: "spoken", evidence: [] }],
				evidence: [],
				confidence: "high",
			},
		]);
		const claims = buildClaimPromotionSet({ ledger, lazy: false });
		const story = buildSourceStoryV2(
			buildSourceStoryEvidenceInput({
				assetId: "a1",
				sourceDurationSec: 20,
				ledger,
				claimPromotion: claims,
				speechEvidence: speechEv([
					{ startSourceTimeSec: 4, endSourceTimeSec: 5, text: "I'm opening Settings." },
				]),
			}),
		);
		expect(story.contradictions.length).toBeGreaterThan(0);
		expect(
			story.beats.flatMap((b) => b.facts).every((f) => !/User opened Settings/i.test(f.text)),
		).toBe(true);
		expect(story.contradictions.every((c) => /not confirmed|contradict/i.test(c.claim))).toBe(true);
	});

	it("4. OCR text does not become action", () => {
		const ledger = ledgerBase([
			{
				id: "e_r",
				assetId: "a1",
				startSourceTimeSec: 18,
				endSourceTimeSec: 18,
				type: "observed_visible_text",
				modalities: ["visual"],
				summary: "Observed visible text: Restart recording",
				claims: [{ id: "cr", text: "Restart recording", epistemic: "observed", evidence: [] }],
				evidence: [],
				confidence: "high",
			},
		]);
		const claims = buildClaimPromotionSet({ ledger, lazy: false });
		const story = buildSourceStoryV2(
			buildSourceStoryEvidenceInput({
				assetId: "a1",
				sourceDurationSec: 20,
				ledger,
				claimPromotion: claims,
				frames: frames(18),
			}),
		);
		expect(JSON.stringify(story.beats.flatMap((b) => b.facts))).not.toMatch(/user restarted/i);
		expect(story.unresolved.some((u) => /restart/i.test(u.text) && u.epistemic === "unknown")).toBe(
			true,
		);
	});

	it("5. speech does not become visual action", () => {
		const story = buildSourceStoryV2(
			buildSourceStoryEvidenceInput({
				assetId: "a1",
				sourceDurationSec: 20,
				speechEvidence: speechEv([
					{
						startSourceTimeSec: 8,
						endSourceTimeSec: 10,
						text: "First I will open the timeline panel.",
					},
				]),
				frames: frames(8, 10),
			}),
		);
		const spoken = story.beats.flatMap((b) => b.spoken);
		expect(spoken.some((s) => /timeline/i.test(s.text))).toBe(true);
		expect(
			story.beats.flatMap((b) => b.facts).some((f) => /opened the timeline/i.test(f.text)),
		).toBe(false);
	});

	it("6. spoken correction supersedes earlier intent", () => {
		const story = buildSourceStoryV2(
			buildSourceStoryEvidenceInput({
				assetId: "a1",
				sourceDurationSec: 20,
				speechEvidence: speechEv([
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
				ledger: ledgerBase([
					{
						id: "e_corr",
						assetId: "a1",
						startSourceTimeSec: 9,
						endSourceTimeSec: 10.5,
						type: "spoken_correction",
						modalities: ["speech"],
						summary: "Correction: timeline → effects",
						claims: [],
						evidence: [],
						confidence: "high",
					},
				]),
			}),
		);
		expect(story.corrections.length).toBeGreaterThan(0);
		expect(story.corrections[0]!.toText).toMatch(/effects/i);
		expect(story.corrections[0]!.fromText).toMatch(/timeline/i);
	});

	it("7. Upwork passive tab invariant", () => {
		const ledger = ledgerBase([
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
		const claims = buildClaimPromotionSet({ ledger, lazy: false });
		const story = buildSourceStoryV2(
			buildSourceStoryEvidenceInput({
				assetId: "a1",
				sourceDurationSec: 20,
				ledger,
				claimPromotion: claims,
				frames: frames(3),
			}),
		);
		expect(
			story.persistentContext.some((c) => /upwork/i.test(c.text) && c.isContextOnly) ||
				story.beats.some((b) => b.context.some((c) => /upwork/i.test(c.text))),
		).toBe(true);
		const blob = JSON.stringify(story);
		expect(blob).not.toMatch(/opened Upwork|worked on Upwork|visited Upwork|navigated to Upwork/i);
	});

	it("8. Restart tooltip visibility vs restart action", () => {
		const ledger = ledgerBase([
			{
				id: "e_r",
				assetId: "a1",
				startSourceTimeSec: 17,
				endSourceTimeSec: 18,
				type: "observed_visible_text",
				modalities: ["visual"],
				summary: "Observed visible text: Restart recording",
				claims: [{ id: "cr", text: "Restart recording", epistemic: "observed", evidence: [] }],
				evidence: [],
				confidence: "high",
			},
		]);
		const claims = buildClaimPromotionSet({ ledger, lazy: false });
		const story = buildSourceStoryV2(
			buildSourceStoryEvidenceInput({
				assetId: "a1",
				sourceDurationSec: 20,
				ledger,
				claimPromotion: claims,
				changes: [
					{
						fromSourceTimeSec: 16,
						toSourceTimeSec: 17.5,
						score: 0.15,
						classification: "significant",
					},
				],
				frames: frames(17),
			}),
		);
		expect(JSON.stringify(story)).toMatch(/Restart recording/i);
		expect(story.beats.flatMap((b) => b.facts).every((f) => !/User restarted/i.test(f.text))).toBe(
			true,
		);
		expect(story.unresolved.some((u) => /restart/i.test(u.text) && u.epistemic === "unknown")).toBe(
			true,
		);
	});

	it("9. Settings keyword contradiction", () => {
		const ledger = ledgerBase([
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
		]);
		const claims = buildClaimPromotionSet({
			ledger,
			specialist: {
				version: 1,
				observations: [
					{
						id: "vo",
						kind: "visible_text",
						epistemic: "observed",
						text: "Settings",
						sourceTimeSec: 4.5,
						ocr: {
							engine: "macos_vision",
							lines: [{ text: "Settings", confidence: 0.9 }],
							joinedText: "Settings",
						},
						provenance: [],
					},
				],
				crops: [],
				ocrResults: [],
				metrics: {
					sourceCropMs: 0,
					ocrMs: 0,
					diffMs: 0,
					totalMs: 0,
					sourceCrops: 0,
					ocrCalls: 0,
					beforeAfterPairs: 0,
					imageBytes: 0,
					extraModelCalls: 0,
					engine: "macos_vision",
				},
				internalNotes: [],
			},
			lazy: false,
		});
		const story = buildSourceStoryV2(
			buildSourceStoryEvidenceInput({
				assetId: "a1",
				sourceDurationSec: 20,
				ledger,
				claimPromotion: claims,
				speechEvidence: speechEv([
					{ startSourceTimeSec: 4, endSourceTimeSec: 5, text: "I'm opening Settings." },
				]),
			}),
		);
		expect(
			story.contradictions.length > 0 ||
				story.unresolved.some((u) => /settings/i.test(u.text) && u.epistemic === "unknown"),
		).toBe(true);
		expect(
			story.beats.flatMap((b) => b.facts).every((f) => !/User opened Settings/i.test(f.text)),
		).toBe(true);
		expect(story.contradictions.every((c) => c.resolutionStatus === "contradicted")).toBe(true);
	});

	it("10–12. speech status contracts preserved", () => {
		for (const status of ["no_audio", "no_speech_detected", "unavailable"] as const) {
			const story = buildSourceStoryV2(
				buildSourceStoryEvidenceInput({
					assetId: "a1",
					sourceDurationSec: 10,
					speechEvidence: speechEv([], status),
					frames: frames(1, 5),
					changes: [
						{
							fromSourceTimeSec: 4,
							toSourceTimeSec: 5,
							score: 0.2,
							classification: "significant",
						},
					],
				}),
			);
			expect(story.speechStatus).toBe(status);
			expect(story.mediaSummary).not.toMatch(/transcription unavailable/i);
			if (status === "no_audio") {
				expect(story.mediaSummary).toMatch(/no_audio|no audio/i);
			}
		}
	});

	it("13. stable screen + narration", () => {
		const story = buildSourceStoryV2(
			buildSourceStoryEvidenceInput({
				assetId: "a1",
				sourceDurationSec: 20,
				speechEvidence: speechEv([
					{ startSourceTimeSec: 2, endSourceTimeSec: 4, text: "Now I talk about the timeline." },
					{ startSourceTimeSec: 6, endSourceTimeSec: 8, text: "Next I mention effects." },
				]),
				frames: frames(2, 6),
				changes: [],
			}),
		);
		expect(story.beats.some((b) => b.spoken.length > 0)).toBe(true);
		expect(story.beats.flatMap((b) => b.facts).some((f) => /opened|clicked/i.test(f.text))).toBe(
			false,
		);
	});

	it("14–15. meaningful transition creates beat; periodic frame alone does not", () => {
		const withChange = buildSourceStoryV2(
			buildSourceStoryEvidenceInput({
				assetId: "a1",
				sourceDurationSec: 20,
				frames: frames(10),
				changes: [
					{
						fromSourceTimeSec: 9,
						toSourceTimeSec: 10,
						score: 0.3,
						classification: "significant",
					},
				],
			}),
		);
		expect(withChange.beats.length).toBeGreaterThan(0);

		const framesOnly = buildSourceStoryV2(
			buildSourceStoryEvidenceInput({
				assetId: "a1",
				sourceDurationSec: 20,
				frames: frames(0, 2, 4, 6, 8, 10, 12, 14, 16, 18),
				changes: [],
			}),
		);
		// Should not create one beat per frame
		expect(framesOnly.beats.length).toBeLessThan(8);
	});

	it("16–18. provenance, timing, uncertainty", () => {
		const ledger = ledgerBase([
			{
				id: "e_up",
				assetId: "a1",
				startSourceTimeSec: 2,
				endSourceTimeSec: 2,
				type: "passive_chrome",
				modalities: ["visual"],
				summary: "Passive chrome: Upwork (tab)",
				claims: [],
				evidence: [],
				confidence: "medium",
			},
		]);
		const claims = buildClaimPromotionSet({ ledger, lazy: false });
		const story = buildSourceStoryV2(
			buildSourceStoryEvidenceInput({
				assetId: "a1",
				sourceDurationSec: 20,
				ledger,
				claimPromotion: claims,
				investigation: {
					version: 1,
					assetId: "a1",
					timebase: "SOURCE_MEDIA_TIME",
					questionSummary: "test",
					focusRange: { startSourceTimeSec: 0, endSourceTimeSec: 5 },
					stopReason: "sufficient_evidence",
					coverage: {
						sourceDurationSec: 20,
						rangesInspected: [],
						frameTimesSec: [],
						roiCount: 0,
						modalitiesTouched: ["ledger"],
						absenceIsStrong: false,
					},
					observations: [{ id: "obs_1", kind: "note", evidence: [], text: "note" } as never],
					claims: [],
					toolTrace: [],
					metrics: {
						memoryQueryMs: 0,
						planningMs: 0,
						toolExecutionMs: 0,
						verificationMs: 0,
						totalInvestigationMs: 0,
						frameCacheHits: 0,
						frameCacheMisses: 0,
						newlyExtractedFrames: 0,
						roiExtractMs: 0,
						transcriptRetrievalMs: 0,
						cursorRetrievalMs: 0,
						investigatorModelCalls: 0,
						stepsUsed: 0,
						toolCalls: 0,
					},
					internalBriefing: "",
					additionalFrames: [],
				},
			}),
		);
		expect(story.provenance.claimIds.length).toBeGreaterThan(0);
		expect(story.provenance.ledgerEventIds).toContain("e_up");
		expect(story.provenance.investigationObservationIds).toContain("obs_1");
		expect(story.beats.every((b) => b.endSourceTimeSec >= b.startSourceTimeSec)).toBe(true);
		expect(story.unresolved.length).toBeGreaterThan(0);
		expect(JSON.stringify(story)).not.toMatch(/groundTruth|__gt__/i);
	});

	it("19–21. investigator + omit irrelevant + retain unresolved", () => {
		const ledger = ledgerBase([
			{
				id: "e_up",
				assetId: "a1",
				startSourceTimeSec: 2,
				endSourceTimeSec: 2,
				type: "passive_chrome",
				modalities: ["visual"],
				summary: "Passive chrome: Upwork (tab)",
				claims: [],
				evidence: [],
				confidence: "medium",
			},
		]);
		const claims = buildClaimPromotionSet({
			ledger,
			userQuery: "What did I say near the end?",
			lazy: true,
		});
		const input = buildSourceStoryEvidenceInput({
			assetId: "a1",
			sourceDurationSec: 20,
			ledger,
			claimPromotion: claims,
			speechEvidence: speechEv([
				{ startSourceTimeSec: 15, endSourceTimeSec: 17, text: "Wrapping up now." },
			]),
			investigation: {
				version: 1,
				assetId: "a1",
				timebase: "SOURCE_MEDIA_TIME",
				questionSummary: "speech",
				focusRange: { startSourceTimeSec: 14, endSourceTimeSec: 20 },
				stopReason: "sufficient_evidence",
				coverage: {
					sourceDurationSec: 20,
					rangesInspected: [{ startSourceTimeSec: 14, endSourceTimeSec: 20 }],
					frameTimesSec: [],
					roiCount: 0,
					modalitiesTouched: ["speech", "ledger"],
					absenceIsStrong: false,
				},
				observations: [{ id: "obs_sp", kind: "transcript", evidence: [], text: "wrap" } as never],
				claims: [],
				toolTrace: [],
				metrics: {
					memoryQueryMs: 0,
					planningMs: 0,
					toolExecutionMs: 0,
					verificationMs: 0,
					totalInvestigationMs: 1,
					frameCacheHits: 0,
					frameCacheMisses: 0,
					newlyExtractedFrames: 0,
					roiExtractMs: 0,
					transcriptRetrievalMs: 0,
					cursorRetrievalMs: 0,
					investigatorModelCalls: 0,
					stepsUsed: 1,
					toolCalls: 1,
				},
				internalBriefing: "speech",
				additionalFrames: [],
			},
		});
		expect(input.investigation?.observationIds).toContain("obs_sp");
		const story = buildSourceStoryV2(input);
		expect(story.capabilities.hasInvestigation).toBe(true);
		expect(story.unresolved.some((u) => /upwork|action/i.test(u.text))).toBe(true);
	});

	it("22. whole-video compact beat hierarchy", () => {
		const changes: VisualChange[] = [
			{ fromSourceTimeSec: 2, toSourceTimeSec: 3, score: 0.2, classification: "significant" },
			{ fromSourceTimeSec: 8, toSourceTimeSec: 9, score: 0.2, classification: "significant" },
			{ fromSourceTimeSec: 14, toSourceTimeSec: 15, score: 0.2, classification: "significant" },
		];
		const story = buildSourceStoryV2(
			buildSourceStoryEvidenceInput({
				assetId: "a1",
				sourceDurationSec: 20,
				speechEvidence: speechEv([
					{ startSourceTimeSec: 0.5, endSourceTimeSec: 2, text: "Intro today." },
					{ startSourceTimeSec: 8, endSourceTimeSec: 9, text: "I meant the effects panel." },
					{ startSourceTimeSec: 16, endSourceTimeSec: 18, text: "Done." },
				]),
				frames: frames(0, 2, 4, 6, 8, 10, 12, 14, 16, 18),
				changes,
				ledger: ledgerBase([
					{
						id: "e_c",
						assetId: "a1",
						startSourceTimeSec: 8,
						endSourceTimeSec: 9,
						type: "spoken_correction",
						modalities: ["speech"],
						summary: "correction",
						claims: [],
						evidence: [],
						confidence: "high",
					},
				]),
			}),
		);
		expect(story.beats.length).toBeGreaterThan(1);
		expect(story.beats.length).toBeLessThanOrEqual(12);
		expect(story.beats.length).toBeLessThan(frames(0, 2, 4, 6, 8, 10, 12, 14, 16, 18).length);
	});

	it("23–25. constrain model prose; prepare V2; deterministicEdit cheap", () => {
		const ledger = ledgerBase([
			{
				id: "e_up",
				assetId: "a1",
				startSourceTimeSec: 2,
				endSourceTimeSec: 2,
				type: "passive_chrome",
				modalities: ["visual"],
				summary: "Passive chrome: Upwork (tab)",
				claims: [],
				evidence: [],
				confidence: "medium",
			},
		]);
		const claims = buildClaimPromotionSet({ ledger, lazy: false });
		const storyV2 = buildSourceStoryV2(
			buildSourceStoryEvidenceInput({
				assetId: "a1",
				sourceDurationSec: 20,
				ledger,
				claimPromotion: claims,
			}),
		);
		const bad: SourceStory = {
			sourceDurationSec: 20,
			overallSummary: "User opened Upwork and worked on Upwork.",
			contentType: "screen_recording",
			storyBeats: [
				{
					id: "b1",
					startSourceTimeSec: 0,
					endSourceTimeSec: 5,
					purpose: "navigation",
					summary: "User opened Upwork",
					interactionMeaning: "clicked Upwork",
					evidence: {},
					confidence: "high",
				},
			],
		};
		const { story, warnings } = constrainSourceStoryWithV2(bad, storyV2);
		expect(warnings.length).toBeGreaterThan(0);
		expect(story.overallSummary).not.toMatch(/User opened Upwork and worked/i);
		expect(story.storyBeats[0]!.summary).not.toMatch(/User opened Upwork/i);

		const derived = sourceStoryFromV2(storyV2);
		expect(derived.storyBeats.length).toBe(storyV2.beats.length);

		const prep = prepareSourceStoryForTurn({
			contextNeeds: classifyMediaContextNeeds("What happens in this recording?"),
			sourceDurationSec: 20,
			assetId: "a1",
			ledger,
			claimPromotion: claims,
			frames: frames(2),
			useV2: true,
		});
		expect(prep?.providerId).toBe(SOURCE_STORY_V2_PROVIDER_ID);
		expect(prep?.storyV2).toBeTruthy();
		expect(prep?.promptSection).toMatch(/SOURCE_STORY_V2_EVIDENCE/);
		expect(prep?.promptSection).toMatch(/NOT an action/);

		const editPrep = prepareSourceStoryForTurn({
			contextNeeds: classifyMediaContextNeeds("Trim the first 2 seconds"),
			sourceDurationSec: 20,
			frames: frames(1),
		});
		expect(editPrep).toBeNull();
	});
});
