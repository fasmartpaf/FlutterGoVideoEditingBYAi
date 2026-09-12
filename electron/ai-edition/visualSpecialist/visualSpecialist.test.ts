/**
 * Behavioral invariants for Visual Evidence Specialist V1.
 */
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildTemporalEventLedger, createVideoEvidenceStore } from "../temporalEventLedger";
import { runMasterVideoInvestigatorV1 } from "../videoInvestigator";
import {
	appendVisualSpecialistToLedger,
	cropRectForPreset,
	extractSourceResolutionCrop,
	mergeSpecialistIntoInvestigation,
	runVisualSpecialistV1,
	specialistHasVerifiedOpenFromOcr,
	specialistObservedText,
	UnavailableOcrEngine,
} from "./index";
import type { VisualSpecialistResult } from "./types";

const FFMPEG = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");
const CASE2 =
	"/Users/osama/Library/Application Support/openscreen/recordings/recording-1789020958404.mp4";
const canCase2 = existsSync(CASE2) && existsSync(FFMPEG);

function fakeInvestigation(endSec = 20) {
	return {
		version: 1 as const,
		assetId: "a1",
		timebase: "SOURCE_MEDIA_TIME" as const,
		questionSummary: "test",
		focusRange: { startSourceTimeSec: 0, endSourceTimeSec: endSec },
		stopReason: "sufficient_evidence" as const,
		coverage: {
			sourceDurationSec: endSec,
			rangesInspected: [{ startSourceTimeSec: endSec - 6, endSourceTimeSec: endSec }],
			frameTimesSec: [endSec - 4, endSec - 2],
			roiCount: 1,
			modalitiesTouched: ["visual" as const, "ledger" as const],
			absenceIsStrong: false,
		},
		observations: [
			{
				id: "obs_1",
				kind: "roi" as const,
				startSourceTimeSec: endSec - 0.5,
				endSourceTimeSec: endSec - 0.5,
				text: "ROI bottom_center",
				evidence: [],
			},
		],
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
			investigatorModelCalls: 0 as const,
			stepsUsed: 1,
			toolCalls: 1,
		},
		internalBriefing: "brief",
		additionalFrames: [
			{
				sourceTimeSec: endSec - 0.5,
				imagePath: "/tmp/missing.jpg",
				width: 100,
				height: 50,
				byteLength: 10,
				note: "investigator ROI bottom_center",
			},
		],
	};
}

describe("Visual Evidence Specialist V1", () => {
	it("1–2 — source-res crop rect is from source pixels, not 1280 upscale", () => {
		const r = cropRectForPreset("bottom_center", 3024, 1964);
		expect(r.w).toBeGreaterThan(1000);
		expect(r.h).toBeGreaterThan(300);
		expect(r.y + r.h).toBeLessThanOrEqual(1964);
	});

	it("4–5 — OCR text is observed visibility, not navigation action", () => {
		const specialist: VisualSpecialistResult = {
			version: 1,
			observations: [
				{
					id: "vo_1",
					kind: "visible_text",
					epistemic: "observed",
					text: 'Readable text: "Upwork". Visible text ≠ user action.',
					sourceTimeSec: 1,
					ocr: {
						engine: "macos_vision",
						lines: [{ text: "Upwork", confidence: 1 }],
						joinedText: "Upwork",
					},
					provenance: [{ modality: "ocr", sourceTimeSec: 1 }],
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
				ocrCalls: 1,
				beforeAfterPairs: 0,
				imageBytes: 0,
				extraModelCalls: 0,
				engine: "macos_vision",
			},
			internalNotes: [],
		};
		expect(specialistObservedText(specialist, "Upwork")).toBe(true);
		expect(specialistHasVerifiedOpenFromOcr(specialist, "Upwork")).toBe(false);
	});

	it("8 — specialist budget enforced", async () => {
		const set = await runVisualSpecialistV1({
			videoPath: null,
			investigation: fakeInvestigation(),
			budgets: { maxOcrCalls: 0, maxSourceResCrops: 0 },
			ocrEngine: new UnavailableOcrEngine(),
		});
		expect(set.metrics.sourceCrops).toBe(0);
		expect(set.metrics.ocrCalls).toBe(0);
		expect(set.metrics.extraModelCalls).toBe(0);
	});

	it("9 — no repeated unbounded loop without video", async () => {
		const a = await runVisualSpecialistV1({
			videoPath: null,
			investigation: fakeInvestigation(),
			ocrEngine: new UnavailableOcrEngine(),
		});
		const b = await runVisualSpecialistV1({
			videoPath: null,
			investigation: fakeInvestigation(),
			ocrEngine: new UnavailableOcrEngine(),
		});
		expect(a.metrics.totalMs).toBeLessThan(100);
		expect(b.metrics.ocrCalls).toBe(0);
	});

	it("17–18 — ledger + InvestigationEvidenceSet integration", () => {
		const ledger = buildTemporalEventLedger({
			assetId: "a1",
			sourceDurationSec: 20,
			frames: [{ sourceTimeSec: 18, reason: "periodic" }],
		});
		const specialist: VisualSpecialistResult = {
			version: 1,
			observations: [
				{
					id: "vo_1",
					kind: "visible_text",
					epistemic: "observed",
					text: 'Readable text: "Hello". Visible text ≠ user action.',
					sourceTimeSec: 18,
					temporallyUncertain: true,
					ocr: {
						engine: "macos_vision",
						lines: [{ text: "Hello", confidence: 0.9 }],
						joinedText: "Hello",
					},
					provenance: [{ modality: "ocr", sourceTimeSec: 18, note: "test" }],
				},
			],
			crops: [],
			ocrResults: [],
			metrics: {
				sourceCropMs: 0,
				ocrMs: 1,
				diffMs: 0,
				totalMs: 1,
				sourceCrops: 0,
				ocrCalls: 1,
				beforeAfterPairs: 0,
				imageBytes: 0,
				extraModelCalls: 0,
				engine: "macos_vision",
			},
			internalNotes: ['OCR: "Hello"'],
		};
		const mergedLedger = appendVisualSpecialistToLedger(ledger, specialist, "a1");
		expect(mergedLedger.events.some((e) => e.type === "observed_visible_text")).toBe(true);
		expect(
			mergedLedger.events.some((e) =>
				e.claims.some((c) => c.epistemic === "verified" && /opened/i.test(c.text)),
			),
		).toBe(false);
		const store = createVideoEvidenceStore(mergedLedger);
		expect(store.visualInRange(17, 19).some((e) => e.type === "observed_visible_text")).toBe(true);

		const inv = mergeSpecialistIntoInvestigation(fakeInvestigation(), specialist);
		expect(inv.internalBriefing).toMatch(/VISUAL_SPECIALIST_V1/);
		expect(inv.observations.some((o) => /Hello/.test(o.text))).toBe(true);
	});

	it("19 — no internal JSON leakage patterns in observation prose contract", () => {
		const text =
			"Near the end, a small recording-control tooltip reading Restart recording becomes visible.";
		expect(text).not.toMatch(/VISUAL_SPECIALIST|ocrResults|confidence=/);
	});

	it("22 — GT cannot enter specialist (no Restart without OCR evidence)", async () => {
		const set = await runVisualSpecialistV1({
			videoPath: null,
			investigation: fakeInvestigation(),
			ocrEngine: new UnavailableOcrEngine(),
		});
		expect(JSON.stringify(set).toLowerCase()).not.toMatch(/restart recording/);
	});

	it("deterministic edit path stays cheap via investigator skip", async () => {
		const inv = await runMasterVideoInvestigatorV1({
			userMessage: "trim silences",
			needs: {
				category: "deterministicEdit",
				visual: false,
				speech: false,
				cursor: false,
				injectSpeech: false,
			},
			assetId: "a1",
			sourceDurationSec: 20,
			videoPath: null,
		});
		expect(inv!.stopReason).toBe("deterministic_edit_skip");
		const vs = await runVisualSpecialistV1({
			videoPath: null,
			investigation: inv!,
			ocrEngine: new UnavailableOcrEngine(),
		});
		expect(vs.metrics.sourceCrops).toBe(0);
	});
});

describe.runIf(canCase2)("Visual Specialist Case 2 source-res OCR", () => {
	it("12 — source-res bottom crop OCR can read Restart without GT injection", async () => {
		const cacheDir = path.join(os.tmpdir(), `os-vs-case2-${Date.now()}`);
		const crop = await extractSourceResolutionCrop({
			videoPath: CASE2,
			sourceTimeSec: 18.0,
			preset: "bottom_center",
			cacheDir,
			ffmpegPath: FFMPEG,
		});
		expect(crop).not.toBeNull();
		expect(crop!.fromSourceMedia).toBe(true);
		expect(crop!.width).toBeGreaterThan(1000);

		const inv = fakeInvestigation(19.89);
		inv.additionalFrames[0]!.note = "investigator ROI bottom_center";
		inv.observations[0]!.startSourceTimeSec = 18;
		inv.focusRange = { startSourceTimeSec: 0, endSourceTimeSec: 19.89 };

		const set = await runVisualSpecialistV1({
			videoPath: CASE2,
			investigation: inv,
			cacheDir,
			ffmpegPath: FFMPEG,
			budgets: { maxBeforeAfterPairs: 1, maxOcrCalls: 3, maxSourceResCrops: 4 },
		});

		expect(set.metrics.extraModelCalls).toBe(0);
		expect(set.metrics.sourceCrops).toBeGreaterThan(0);
		expect(specialistObservedText(set, "Restart recording")).toBe(true);
		// Must not invent action
		expect(JSON.stringify(set.observations)).not.toMatch(/user restarted/i);

		const out = path.join(process.cwd(), "tmp/perception-benchmark/visual-specialist-v1");
		const { mkdirSync, writeFileSync } = await import("node:fs");
		mkdirSync(out, { recursive: true });
		writeFileSync(
			path.join(out, "case02-specialist.json"),
			JSON.stringify(
				{
					provider: "CURRENT_OPENSCREEN_VISUAL_SPECIALIST_V1",
					crop: {
						width: crop!.width,
						height: crop!.height,
						source: `${crop!.sourceWidth}x${crop!.sourceHeight}`,
						fromSourceMedia: crop!.fromSourceMedia,
						ms: crop!.ms,
					},
					metrics: set.metrics,
					ocrJoined: set.ocrResults.map((o) => o.lines.map((l) => l.text).join(" · ")),
					restartRecognized: specialistObservedText(set, "Restart recording"),
					gtInjected: false,
				},
				null,
				2,
			),
		);
	}, 60_000);
});
