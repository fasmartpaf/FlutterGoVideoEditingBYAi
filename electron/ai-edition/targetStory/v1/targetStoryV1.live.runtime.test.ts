/**
 * Target Story V1 live/offline regressions — Case 2 / Case 4 / narrated.
 * Deterministic V1 only (0 LLM). Does not execute edits.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildClaimPromotionSet, resetClaimPromotionSeqForTests } from "../../claimPromotion";
import {
	buildSourceStoryEvidenceInput,
	buildSourceStoryV2,
	resetSourceStoryV2SeqForTests,
} from "../../sourceStory/v2";
import type { SpeechEvidence } from "../../speechEvidence/types";
import type { TemporalEventLedger } from "../../temporalEventLedger/types";
import {
	buildTargetStoryV1,
	resetTargetStoryV1SeqForTests,
	TARGET_STORY_V1_PROVIDER_ID,
	targetStoryFromV1,
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

describe("Target Story V1 live regressions", () => {
	it("Case 2 / Case 4 / narrated — professional intent, no edits", () => {
		resetClaimPromotionSeqForTests();
		resetSourceStoryV2SeqForTests();
		resetTargetStoryV1SeqForTests();
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

		const claims = buildClaimPromotionSet({ ledger: case2Ledger, lazy: false });
		const source = buildSourceStoryV2(
			buildSourceStoryEvidenceInput({
				assetId: "live",
				sourceDurationSec: 20,
				ledger: case2Ledger,
				claimPromotion: claims,
				changes: [
					{
						fromSourceTimeSec: 2,
						toSourceTimeSec: 4,
						score: 0.2,
						classification: "significant",
					},
					{
						fromSourceTimeSec: 17,
						toSourceTimeSec: 19,
						score: 0.2,
						classification: "significant",
					},
				],
			}),
		);
		const case2 = buildTargetStoryV1({
			sourceStoryV2: source,
			userIntent: "Make this professional.",
		});

		const case4Ledger = led([
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
			{
				id: "e_xd",
				assetId: "live",
				startSourceTimeSec: 8,
				endSourceTimeSec: 10,
				type: "contradiction",
				modalities: ["speech", "visual"],
				summary: "panel open not confirmed",
				claims: [],
				evidence: [],
				confidence: "medium",
			},
		]);
		const case4Source = buildSourceStoryV2(
			buildSourceStoryEvidenceInput({
				assetId: "live",
				sourceDurationSec: 20,
				ledger: case4Ledger,
				claimPromotion: buildClaimPromotionSet({ ledger: case4Ledger, lazy: false }),
				speechEvidence: speech([
					{ startSourceTimeSec: 8, endSourceTimeSec: 9, text: "open the timeline panel" },
					{ startSourceTimeSec: 9.2, endSourceTimeSec: 10, text: "I meant the effects panel" },
				]),
			}),
		);
		const case4 = buildTargetStoryV1({
			sourceStoryV2: case4Source,
			userIntent: "Make this shorter and clearer.",
		});

		const narratedSource = buildSourceStoryV2(
			buildSourceStoryEvidenceInput({
				assetId: "live",
				sourceDurationSec: 16.9,
				speechEvidence: speech([
					{
						startSourceTimeSec: 0,
						endSourceTimeSec: 4.5,
						text: "Today I am going to show you the open screen editor.",
					},
					{
						startSourceTimeSec: 4.5,
						endSourceTimeSec: 8.5,
						text: "First we look at the timeline and how clips are arranged.",
					},
				]),
				changes: [
					{
						fromSourceTimeSec: 8,
						toSourceTimeSec: 10,
						score: 0.12,
						classification: "significant",
					},
				],
			}),
		);
		const narrated = buildTargetStoryV1({
			sourceStoryV2: narratedSource,
			userIntent: "Make this professional.",
		});

		const ms = performance.now() - t0;
		const outDir = path.join(process.cwd(), "tmp/perception-benchmark/target-story-v1");
		mkdirSync(outDir, { recursive: true });
		writeFileSync(
			path.join(outDir, "live-regressions.json"),
			JSON.stringify(
				{
					providerId: TARGET_STORY_V1_PROVIDER_ID,
					ms,
					case2,
					case4,
					narrated,
					legacyCase2: targetStoryFromV1(case2),
				},
				null,
				2,
			),
		);

		expect(case2.providerId).toBe(TARGET_STORY_V1_PROVIDER_ID);
		expect(case2.metrics.additionalModelCalls).toBe(0);
		expect(case2.targetBeats.every((b) => b.sourceBeatIds.length > 0)).toBe(true);
		expect(JSON.stringify(case2.targetBeats.map((b) => b.emphasize))).not.toMatch(
			/Upwork workflow/i,
		);
		expect(
			case2.removeCandidates.some((r) => /Restart/i.test(r.text)) ||
				case2.deEmphasize.some((d) => /Restart/i.test(d.text)),
		).toBe(true);

		expect(case4.preserve.some((p) => /corrected/i.test(p.text))).toBe(true);
		expect(JSON.stringify(case4)).not.toMatch(/show Timeline then Effects/i);

		expect(
			narrated.targetBeats.some((b) =>
				/Spoken|spoken|editor|timeline/i.test(b.viewerShouldUnderstand),
			),
		).toBe(true);
		expect(ms).toBeLessThan(500);

		// eslint-disable-next-line no-console
		console.log(
			`[target-story-v1] case2 beats=${case2.targetBeats.length} removeCandidates=${case2.removeCandidates.length}; case4 preserve=${case4.preserve.length}; narrated beats=${narrated.targetBeats.length}; ${ms.toFixed(1)}ms`,
		);
	});
});
