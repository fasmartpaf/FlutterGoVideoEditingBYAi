/**
 * Unit tests for watch-video clean-room reuse algorithms + reuse specialist path.
 */
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildTemporalEventLedger } from "../../temporalEventLedger";
import {
	appendVisualSpecialistToLedger,
	buildBoundedSampleCandidates,
	dedupeByDhash,
	dhashFromGray,
	extractSourceResolutionCrop,
	hammingDistance,
	mergeSpecialistIntoInvestigation,
	OCR_PREPROCESS_VERSION,
	preprocessForOcr,
	REUSE_VISUAL_PROVIDER_ID,
	runReuseVisualV1,
	specialistHasVerifiedOpenFromOcr,
	specialistObservedText,
	UnavailableOcrEngine,
} from "../index";
import type { VisualSpecialistResult } from "../types";

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

describe("Reuse Visual V1 — algorithms", () => {
	it("1 — dHash deterministic on identical gray", () => {
		const gray = new Uint8Array(9 * 8);
		for (let i = 0; i < gray.length; i++) gray[i] = (i * 17) % 256;
		const a = dhashFromGray(gray);
		const b = dhashFromGray(gray);
		expect(a).toBe(b);
		expect(hammingDistance(a, b)).toBe(0);
	});

	it("2 — near-identical frames dedupe; protected survives", () => {
		const h = 0b10101010n;
		const out = dedupeByDhash(
			[
				{ id: "a", sourceTimeSec: 1, hash: h, reason: "periodic" },
				{ id: "b", sourceTimeSec: 1.2, hash: h, reason: "periodic" },
				{
					id: "c",
					sourceTimeSec: 1.3,
					hash: h,
					protected: true,
					reason: "interaction",
				},
			],
			{ distance: 6 },
		);
		expect(out.afterCount).toBe(2);
		expect(out.kept.some((k) => k.id === "c")).toBe(true);
		expect(out.dropped.some((d) => d.id === "b")).toBe(true);
	});

	it("3 — important protected frame not removed by max_keep", () => {
		const out = dedupeByDhash(
			[
				{ id: "p", sourceTimeSec: 5, hash: 1n, protected: true, reason: "interaction" },
				{ id: "1", sourceTimeSec: 1, hash: 2n, reason: "periodic" },
				{ id: "2", sourceTimeSec: 2, hash: 3n, reason: "periodic" },
				{ id: "3", sourceTimeSec: 3, hash: 4n, reason: "periodic" },
			],
			{ maxKeep: 2 },
		);
		expect(out.kept.some((k) => k.id === "p")).toBe(true);
		expect(out.afterCount).toBeLessThanOrEqual(2);
	});

	it("4–5 — scene + periodic + interaction combine in bounded range", () => {
		const c = buildBoundedSampleCandidates({
			startSourceTimeSec: 14,
			endSourceTimeSec: 20,
			periodicSec: 2,
			sceneTimesSec: [15.5],
			changeTimesSec: [16.2],
			interactionTimesSec: [18.0],
		});
		expect(c.some((x) => x.reason === "periodic")).toBe(true);
		expect(c.some((x) => x.reason === "scene")).toBe(true);
		expect(c.some((x) => x.reason === "change")).toBe(true);
		const inter = c.find((x) => x.sourceTimeSec === 18);
		expect(inter?.protected).toBe(true);
		expect(c.every((x) => x.sourceTimeSec >= 14 && x.sourceTimeSec <= 20)).toBe(true);
	});

	it("14 — OCR ≠ action (Upwork)", () => {
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
				providerId: REUSE_VISUAL_PROVIDER_ID,
			},
			internalNotes: [],
		};
		expect(specialistObservedText(specialist, "Upwork")).toBe(true);
		expect(specialistHasVerifiedOpenFromOcr(specialist, "Upwork")).toBe(false);
	});

	it("9–11 — OCR unavailable status is honest", async () => {
		const eng = new UnavailableOcrEngine();
		const r = await eng.recognize("/tmp/nope.jpg");
		expect(r.status).toBe("unavailable");
		expect(r.lines).toEqual([]);
		expect(r.error).toBeTruthy();
	});

	it("21 — specialist budgets + 0 LLM", async () => {
		const set = await runReuseVisualV1({
			videoPath: null,
			investigation: fakeInvestigation(),
			budgets: { maxOcrCalls: 0, maxSourceResCrops: 0 },
			ocrEngine: new UnavailableOcrEngine(),
		});
		expect(set.metrics.extraModelCalls).toBe(0);
		expect(set.metrics.providerId).toBe(REUSE_VISUAL_PROVIDER_ID);
		expect(set.metrics.sourceCrops).toBe(0);
	});

	it("22 — no GT leakage without video", async () => {
		const set = await runReuseVisualV1({
			videoPath: null,
			investigation: fakeInvestigation(),
			ocrEngine: new UnavailableOcrEngine(),
		});
		expect(JSON.stringify(set).toLowerCase()).not.toMatch(/restart recording/);
	});

	it("19 — ledger integration never verifies open from OCR", () => {
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
					text: 'Readable text: "Settings". Visible text ≠ user action.',
					sourceTimeSec: 5,
					ocr: {
						engine: "macos_vision",
						lines: [{ text: "Settings", confidence: 0.9 }],
						joinedText: "Settings",
					},
					provenance: [{ modality: "ocr", sourceTimeSec: 5 }],
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
				providerId: REUSE_VISUAL_PROVIDER_ID,
			},
			internalNotes: [],
		};
		const merged = appendVisualSpecialistToLedger(ledger, specialist, "a1");
		expect(merged.events.some((e) => e.type === "observed_visible_text")).toBe(true);
		expect(
			merged.events.some((e) =>
				e.claims.some((c) => c.epistemic === "verified" && /opened settings/i.test(c.text)),
			),
		).toBe(false);
		const inv = mergeSpecialistIntoInvestigation(fakeInvestigation(), specialist);
		expect(inv.internalBriefing).toMatch(/REUSE_VISUAL_V1/);
	});
});

describe.runIf(canCase2)("Reuse Visual V1 — Case 2 / OCR path", () => {
	it("6–8,12,18 — source-res ROI + preprocess + OCR Restart", async () => {
		const cacheDir = path.join(os.tmpdir(), `os-reuse-case2-${Date.now()}`);
		await fs.mkdir(cacheDir, { recursive: true });
		const crop = await extractSourceResolutionCrop({
			videoPath: CASE2,
			sourceTimeSec: 18.0,
			preset: "bottom_center",
			cacheDir,
			ffmpegPath: FFMPEG,
		});
		expect(crop).not.toBeNull();
		expect(crop!.fromSourceMedia).toBe(true);

		const prep = await preprocessForOcr({
			imagePath: crop!.imagePath,
			cacheDir,
			ffmpegPath: FFMPEG,
		});
		expect(prep.version).toBe(OCR_PREPROCESS_VERSION);
		expect(prep.applied).toBe(true);
		expect(prep.outputWidth).toBeGreaterThanOrEqual(1000);

		const inv = fakeInvestigation(19.89);
		inv.additionalFrames[0]!.sourceTimeSec = 18;
		inv.additionalFrames[0]!.note = "investigator ROI bottom_center";
		inv.observations[0]!.startSourceTimeSec = 18;
		inv.observations[0]!.endSourceTimeSec = 18;
		inv.coverage.rangesInspected = [{ startSourceTimeSec: 14, endSourceTimeSec: 19.89 }];
		inv.focusRange = { startSourceTimeSec: 0, endSourceTimeSec: 19.89 };

		const set = await runReuseVisualV1({
			videoPath: CASE2,
			investigation: inv,
			cacheDir,
			ffmpegPath: FFMPEG,
			changeTimesSec: [16.5, 18.0],
			budgets: {
				maxOcrCalls: 4,
				maxSourceResCrops: 5,
				maxSpecialistFrames: 6,
				maxHighResRoiExtracted: 5,
				maxBeforeAfterPairs: 0,
			},
		});

		expect(set.metrics.providerId).toBe(REUSE_VISUAL_PROVIDER_ID);
		expect(set.metrics.extraModelCalls).toBe(0);
		expect(set.metrics.sourceCrops).toBeGreaterThan(0);
		expect(
			(set.metrics.candidatesBeforeDedupe ?? 0) >= (set.metrics.candidatesAfterDedupe ?? 0),
		).toBe(true);
		if (!specialistObservedText(set, "Restart")) {
			const { writeFileSync, mkdirSync } = await import("node:fs");
			mkdirSync(path.join(process.cwd(), "tmp/perception-benchmark/reuse-visual-v1"), {
				recursive: true,
			});
			writeFileSync(
				path.join(process.cwd(), "tmp/perception-benchmark/reuse-visual-v1/ocr-miss.json"),
				JSON.stringify(
					{
						notes: set.internalNotes,
						ocr: set.ocrResults,
						obs: set.observations.map((o) => ({ kind: o.kind, text: o.text, ocr: o.ocr })),
						metrics: set.metrics,
					},
					null,
					2,
				),
			);
		}
		expect(specialistObservedText(set, "Restart")).toBe(true);
		expect(JSON.stringify(set.observations)).not.toMatch(/user restarted/i);

		// Cache warm path
		const set2 = await runReuseVisualV1({
			videoPath: CASE2,
			investigation: inv,
			cacheDir,
			ffmpegPath: FFMPEG,
			changeTimesSec: [16.5, 18.0],
			budgets: { maxOcrCalls: 4, maxSourceResCrops: 5, maxSpecialistFrames: 6 },
		});
		expect((set2.metrics.ocrCacheHits ?? 0) + (set2.metrics.ocrCacheMisses ?? 0)).toBeGreaterThan(
			0,
		);

		const out = path.join(process.cwd(), "tmp/perception-benchmark/reuse-visual-v1");
		await fs.mkdir(out, { recursive: true });
		await fs.writeFile(
			path.join(out, "case02-reuse.json"),
			JSON.stringify(
				{
					provider: REUSE_VISUAL_PROVIDER_ID,
					metrics: set.metrics,
					ocrJoined: set.ocrResults.map((o) => ({
						status: o.status,
						text: o.lines.map((l) => l.text).join(" · "),
						preprocess: o.preprocess,
					})),
					restartRecognized: specialistObservedText(set, "Restart"),
					gtInjected: false,
				},
				null,
				2,
			),
		);
	}, 120_000);
});
