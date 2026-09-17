/**
 * Source Story V2 live/offline regression — Case 2-like evidence path.
 * Deterministic: ledger → claims → SourceStoryV2 (0 LLM for truth).
 *
 * Run: npx vitest --run electron/ai-edition/sourceStory/v2/sourceStoryV2.live.runtime.test.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildClaimPromotionSet, resetClaimPromotionSeqForTests } from "../../claimPromotion";
import type { TemporalEventLedger } from "../../temporalEventLedger/types";
import type { VisualSpecialistResult } from "../../visualSpecialist/types";
import {
	buildSourceStoryEvidenceInput,
	buildSourceStoryV2,
	SOURCE_STORY_V2_PROVIDER_ID,
} from "./index";

function case2Ledger(): TemporalEventLedger {
	return {
		meta: {
			assetId: "case02",
			sourceDurationSec: 22,
			timebase: "SOURCE_MEDIA_TIME",
			builtAtIso: new Date().toISOString(),
			constructionMs: 2,
			additionalModelCalls: 0,
			eventCount: 5,
			claimCount: 3,
			evidenceRefCount: 5,
		},
		events: [
			{
				id: "e_file",
				assetId: "case02",
				startSourceTimeSec: 2.0,
				endSourceTimeSec: 2.2,
				type: "observed_visible_text",
				modalities: ["visual"],
				summary: "Observed visible text: File",
				claims: [{ id: "c_file", text: "File", epistemic: "observed", evidence: [] }],
				evidence: [{ modality: "visual", sourceTimeSec: 2 }],
				confidence: "high",
			},
			{
				id: "e_diff",
				assetId: "case02",
				startSourceTimeSec: 2.0,
				endSourceTimeSec: 4.0,
				type: "visual_transition",
				modalities: ["visual"],
				summary: "Visual transition (menu open → closed neighborhood)",
				claims: [],
				evidence: [],
				confidence: "medium",
			},
			{
				id: "e_up",
				assetId: "case02",
				startSourceTimeSec: 6,
				endSourceTimeSec: 6,
				type: "passive_chrome",
				modalities: ["visual"],
				summary: "Passive chrome: Upwork (tab)",
				claims: [],
				evidence: [],
				confidence: "medium",
			},
			{
				id: "e_restart",
				assetId: "case02",
				startSourceTimeSec: 18.5,
				endSourceTimeSec: 19.2,
				type: "observed_visible_text",
				modalities: ["visual"],
				summary: "Observed visible text: Restart recording",
				claims: [
					{
						id: "c_restart",
						text: "Restart recording",
						epistemic: "observed",
						evidence: [],
					},
				],
				evidence: [{ modality: "visual", sourceTimeSec: 18.8, note: "source-res OCR ROI" }],
				confidence: "high",
			},
			{
				id: "e_late_diff",
				assetId: "case02",
				startSourceTimeSec: 17.5,
				endSourceTimeSec: 19,
				type: "observed_visual_diff",
				modalities: ["visual"],
				summary: "Temporary UI / late visual change",
				claims: [],
				evidence: [],
				confidence: "medium",
			},
		],
	};
}

function restartSpecialist(): VisualSpecialistResult {
	return {
		version: 1,
		observations: [
			{
				id: "vo_restart",
				kind: "temporary_ui_interval",
				epistemic: "observed",
				text: "Observed visible text: Restart recording",
				sourceTimeSec: 18.8,
				region: {
					presetOrReason: "bottom_hud",
					fromSourceMedia: true,
					imagePath: "/tmp/case02-restart.jpg",
					width: 1360,
					height: 432,
				},
				ocr: {
					engine: "macos_vision",
					lines: [{ text: "Restart recording", confidence: 0.93 }],
					joinedText: "Restart recording",
				},
				provenance: [{ modality: "ocr", sourceTimeSec: 18.8 }],
			},
		],
		crops: [
			{
				id: "crop_restart",
				sourceTimeSec: 18.8,
				videoPath: "case02.mp4",
				crop: { x: 100, y: 1500, w: 1360, h: 432 },
				sourceWidth: 3024,
				sourceHeight: 1964,
				imagePath: "/tmp/case02-restart.jpg",
				width: 1360,
				height: 432,
				byteLength: 40000,
				fromSourceMedia: true,
				presetOrReason: "bottom_hud",
				ms: 40,
			},
		],
		ocrResults: [
			{
				engine: "macos_vision",
				status: "available",
				imagePath: "/tmp/case02-restart.jpg",
				width: 1360,
				height: 432,
				lines: [{ text: "Restart recording", confidence: 0.93 }],
				ms: 50,
			},
		],
		metrics: {
			sourceCropMs: 40,
			ocrMs: 50,
			diffMs: 0,
			totalMs: 100,
			sourceCrops: 1,
			ocrCalls: 1,
			beforeAfterPairs: 0,
			imageBytes: 40000,
			extraModelCalls: 0,
			engine: "macos_vision",
		},
		internalNotes: ["Case 2 Restart OCR"],
	};
}

describe("Source Story V2 live regression (Case 2 evidence path)", () => {
	it("prepare → claims → SourceStoryV2 without hallucinated restart action", () => {
		resetClaimPromotionSeqForTests();
		const t0 = performance.now();
		const ledger = case2Ledger();
		const specialist = restartSpecialist();
		const claims = buildClaimPromotionSet({
			ledger,
			specialist,
			userQuery: "What visibly happens near the end / what brief UI appears?",
			lazy: true,
		});
		const evidenceInput = buildSourceStoryEvidenceInput({
			assetId: "case02",
			sourceDurationSec: 22,
			ledger,
			claimPromotion: claims,
			frames: [
				{
					assetId: "case02",
					sourceTimeSec: 2,
					virtualTimeSec: 2,
					reason: "periodic",
					imagePath: "/tmp/f2.jpg",
					mimeType: "image/jpeg",
					width: 64,
					height: 36,
					byteLength: 10,
				},
				{
					assetId: "case02",
					sourceTimeSec: 18.8,
					virtualTimeSec: 18.8,
					reason: "periodic",
					imagePath: "/tmp/f18.jpg",
					mimeType: "image/jpeg",
					width: 64,
					height: 36,
					byteLength: 10,
				},
			],
			changes: [
				{
					fromSourceTimeSec: 2,
					toSourceTimeSec: 4,
					score: 0.18,
					classification: "significant",
				},
				{
					fromSourceTimeSec: 17.5,
					toSourceTimeSec: 19,
					score: 0.22,
					classification: "significant",
				},
			],
		});
		const story = buildSourceStoryV2(evidenceInput);
		const latencyMs = performance.now() - t0;

		const outDir = path.join(process.cwd(), "tmp/perception-benchmark/source-story-v2");
		mkdirSync(outDir, { recursive: true });
		const outPath = path.join(outDir, "case02-source-story-v2.json");
		writeFileSync(
			outPath,
			JSON.stringify(
				{
					providerId: SOURCE_STORY_V2_PROVIDER_ID,
					latencyMs,
					evidenceMetrics: evidenceInput.metrics,
					claimMetrics: claims.metrics,
					story,
				},
				null,
				2,
			),
		);

		expect(story.providerId).toBe(SOURCE_STORY_V2_PROVIDER_ID);
		expect(story.metrics.additionalModelCalls).toBe(0);
		expect(story.beats.length).toBeGreaterThan(0);
		expect(story.beats.length).toBeLessThanOrEqual(12);

		const blobFacts = JSON.stringify(story.beats.flatMap((b) => b.facts));
		const blobCtx = JSON.stringify([
			...story.persistentContext,
			...story.beats.flatMap((b) => b.context),
		]);
		expect(blobFacts + blobCtx).toMatch(/Restart recording|File|visual change/i);
		expect(blobFacts).not.toMatch(/User restarted the recording/i);
		expect(JSON.stringify(story.persistentContext) + blobCtx).toMatch(/Upwork/i);
		expect(JSON.stringify(story.beats.flatMap((b) => b.facts))).not.toMatch(
			/opened Upwork|worked on Upwork/i,
		);
		expect(story.unresolved.some((u) => /restart/i.test(u.text))).toBe(true);
		expect(latencyMs).toBeLessThan(500);

		// eslint-disable-next-line no-console
		console.log(
			`[source-story-v2] wrote ${outPath} beats=${story.beats.length} facts=${story.metrics.factCount} latencyMs=${latencyMs.toFixed(1)}`,
		);
		// eslint-disable-next-line no-console
		console.log("[source-story-v2] mediaSummary:", story.mediaSummary);
		for (const b of story.beats) {
			// eslint-disable-next-line no-console
			console.log(
				`  ${b.id} ${b.startSourceTimeSec.toFixed(1)}-${b.endSourceTimeSec.toFixed(1)}s [${b.purposeHint}] ${b.summary.slice(0, 140)}`,
			);
		}
	});
});
