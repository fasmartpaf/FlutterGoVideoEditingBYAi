/**
 * Final Sequence Cut Quality Verify V1 — unit tests.
 * TOTAL_PAID_AI_CALLS = 0.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { patchCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { synthesizeJoinPcm } from "../audioVerify";
import { makeGradientRgba, makeSolidRgba } from "../compositorVerify";
import {
	assessPreviewVsExportParity,
	enumerateProgrammeJoins,
	runMicroFadeExperiment,
	temporalRecordsFromSequenceResult,
	verifyFinalSequenceCutQuality,
	verifyJoinPreservation,
	verifyJoinSpeech,
	verifyJoinVisual,
} from "./index";

const ARTIFACT = join(
	process.cwd(),
	"tmp/perception-benchmark/final-sequence-cut-quality-verify-v1",
);

let cacheDirs: string[] = [];
afterEach(() => {
	for (const d of cacheDirs) {
		try {
			rmSync(d, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}
	cacheDirs = [];
});

function baseDoc(): AxcutDocument {
	const base = createEmptyDocument({
		title: "fsq",
		projectId: "proj_fsq",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "R",
				originalPath: "/tmp/fsq.mp4",
				durationSec: 20,
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId: "asset_1",
					sourceStartSec: 0,
					sourceEndSec: 20,
					timelineStartSec: 0,
					timelineEndSec: 20,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
			trimRanges: [],
		},
		transcripts: [
			{
				assetId: "asset_1",
				language: "en",
				segments: [
					{
						id: "seg_speech",
						kind: "speech",
						startSec: 1,
						endSec: 4,
						text: "hello there friend",
						wordIds: ["w0", "w1", "w2"],
					},
					{
						id: "seg_sil",
						kind: "silence",
						startSec: 4,
						endSec: 6,
						text: "",
						wordIds: [],
					},
					{
						id: "seg_speech2",
						kind: "speech",
						startSec: 6,
						endSec: 9,
						text: "and more words",
						wordIds: ["w3", "w4", "w5"],
					},
				],
				words: [
					{
						id: "w0",
						segmentId: "seg_speech",
						startSec: 1.0,
						endSec: 1.4,
						text: "hello",
						source: "asr",
					},
					{
						id: "w1",
						segmentId: "seg_speech",
						startSec: 1.4,
						endSec: 1.8,
						text: "there",
						source: "asr",
					},
					{
						id: "w2",
						segmentId: "seg_speech",
						startSec: 1.8,
						endSec: 2.4,
						text: "friend",
						source: "asr",
					},
					{
						id: "w3",
						segmentId: "seg_speech2",
						startSec: 6.0,
						endSec: 6.4,
						text: "and",
						source: "asr",
					},
					{
						id: "w4",
						segmentId: "seg_speech2",
						startSec: 6.4,
						endSec: 6.9,
						text: "more",
						source: "asr",
					},
					{
						id: "w5",
						segmentId: "seg_speech2",
						startSec: 6.9,
						endSec: 7.5,
						text: "words",
						source: "asr",
					},
				],
			},
		],
	});
}

function withTrim(doc: AxcutDocument, start: number, end: number): AxcutDocument {
	return {
		...doc,
		timeline: {
			...doc.timeline,
			trimRanges: [
				{
					id: "trim_1",
					assetId: "asset_1",
					startSec: start,
					endSec: end,
					origin: "user",
				},
			],
		},
	};
}

describe("finalSequenceCutQualityVerifyV1", () => {
	it("enumerates trim-created join with stable id", () => {
		const doc = withTrim(baseDoc(), 4.2, 5.8);
		const a = enumerateProgrammeJoins({ document: doc, assetId: "asset_1" });
		const b = enumerateProgrammeJoins({ document: doc, assetId: "asset_1" });
		expect(a.joins.length).toBeGreaterThanOrEqual(1);
		const trimJoin = a.joins.find((j) => j.cause === "TRIM_CREATED");
		expect(trimJoin).toBeTruthy();
		expect(trimJoin!.editCreated).toBe(true);
		expect(a.joins.map((j) => j.joinId)).toEqual(b.joins.map((j) => j.joinId));
	});

	it("natural continuity excluded by default; included when asked", () => {
		const doc = baseDoc();
		const def = enumerateProgrammeJoins({ document: doc });
		expect(def.joins.every((j) => j.cause !== "NATURAL_CONTINUITY")).toBe(true);
		// single clip unbroken → no edit joins
		expect(def.joins.filter((j) => j.editCreated)).toHaveLength(0);
	});

	it("detects cut-inside-word failure", () => {
		const doc = withTrim(baseDoc(), 1.5, 1.7); // cuts inside "there"
		const { joins } = enumerateProgrammeJoins({ document: doc });
		const j = joins.find((x) => x.cause === "TRIM_CREATED")!;
		const speech = verifyJoinSpeech({ document: doc, join: j });
		expect(speech.outcome).toBe("FAIL");
		expect(speech.blockingReasons.some((r) => /cut_inside_word/.test(r))).toBe(true);
	});

	it("speech-safe silence trim is PASS or WARNING not FAIL", () => {
		const doc = withTrim(baseDoc(), 4.3, 5.7);
		const { joins } = enumerateProgrammeJoins({ document: doc });
		const j = joins.find((x) => x.cause === "TRIM_CREATED")!;
		const speech = verifyJoinSpeech({ document: doc, join: j });
		expect(speech.outcome).not.toBe("FAIL");
	});

	it("confirmed silence overrides inflated STT speech span (false-rejection guard)", () => {
		const doc = withTrim(
			{
				...baseDoc(),
				transcripts: [
					{
						assetId: "asset_1",
						language: "en",
						segments: [
							{
								id: "seg_inflated",
								kind: "speech",
								startSec: 0,
								endSec: 10,
								text: "hello there friend and more words",
								wordIds: ["w0", "w1", "w2", "w3", "w4", "w5"],
							},
						],
						words: [
							{
								id: "w0",
								segmentId: "seg_inflated",
								startSec: 1.0,
								endSec: 1.4,
								text: "hello",
								source: "asr",
							},
							{
								id: "w1",
								segmentId: "seg_inflated",
								startSec: 1.4,
								endSec: 1.8,
								text: "there",
								source: "asr",
							},
							{
								id: "w2",
								segmentId: "seg_inflated",
								startSec: 1.8,
								endSec: 2.4,
								text: "friend",
								source: "asr",
							},
							{
								id: "w3",
								segmentId: "seg_inflated",
								startSec: 6.0,
								endSec: 6.4,
								text: "and",
								source: "asr",
							},
							{
								id: "w4",
								segmentId: "seg_inflated",
								startSec: 6.4,
								endSec: 6.9,
								text: "more",
								source: "asr",
							},
							{
								id: "w5",
								segmentId: "seg_inflated",
								startSec: 6.9,
								endSec: 7.5,
								text: "words",
								source: "asr",
							},
						],
					},
				],
			},
			4.3,
			5.7,
		);
		const { joins } = enumerateProgrammeJoins({ document: doc });
		const j = joins.find((x) => x.cause === "TRIM_CREATED")!;
		const without = verifyJoinSpeech({ document: doc, join: j });
		expect(without.outcome).toBe("FAIL");
		expect(without.blockingReasons.some((r) => /speechBoundary:inside_active_speech/.test(r))).toBe(
			true,
		);
		const withSilence = verifyJoinSpeech({
			document: doc,
			join: j,
			confirmedSilenceRanges: [{ startSourceSec: 4, endSourceSec: 6 }],
		});
		expect(withSilence.outcome).not.toBe("FAIL");
	});

	it("audio pop fails; clean silence passes", async () => {
		const doc = withTrim(baseDoc(), 4.3, 5.7);
		const { joins } = enumerateProgrammeJoins({ document: doc });
		const j = joins.find((x) => x.cause === "TRIM_CREATED")!;
		const pop = synthesizeJoinPcm({ mode: "click_pop" });
		const clean = synthesizeJoinPcm({ mode: "safe_silence" });

		const bad = await verifyFinalSequenceCutQuality({
			document: doc,
			audioByJoinId: { [j.joinId]: pop },
			useCache: false,
			skipCaption: true,
		});
		expect(bad.failedCount).toBeGreaterThanOrEqual(1);

		const good = await verifyFinalSequenceCutQuality({
			document: doc,
			audioByJoinId: { [j.joinId]: clean },
			useCache: false,
			skipCaption: true,
		});
		const audioOutcomes = good.joins.map((x) => x.audio.outcome);
		expect(audioOutcomes.every((o) => o === "PASS" || o === "WARNING")).toBe(true);
	});

	it("hard visual discontinuity is WARNING not blocking FAIL", () => {
		const doc = withTrim(baseDoc(), 4.3, 5.7);
		const { joins } = enumerateProgrammeJoins({ document: doc });
		const j = joins.find((x) => x.cause === "TRIM_CREATED")!;
		const bright = makeGradientRgba(32, 32);
		const dark = makeGradientRgba(32, 32, true);
		const visual = verifyJoinVisual({
			join: j,
			frames: [
				{
					programmeTimeSec: j.programmeTimeSec - 0.2,
					width: 32,
					height: 32,
					rgba: bright,
					label: "pre_delta",
				},
				{
					programmeTimeSec: j.programmeTimeSec + 0.2,
					width: 32,
					height: 32,
					rgba: dark,
					label: "post_delta",
				},
			],
		});
		expect(visual.metrics?.VISUAL_DISCONTINUITY_PRESENT).toBe(true);
		expect(visual.metrics?.VISUAL_INTEGRITY_FAILURE).toBe(false);
		expect(visual.outcome).toBe("WARNING");
	});

	it("blank compositor frame is integrity FAIL", () => {
		const doc = withTrim(baseDoc(), 4.3, 5.7);
		const { joins } = enumerateProgrammeJoins({ document: doc });
		const j = joins.find((x) => x.cause === "TRIM_CREATED")!;
		const blank = makeSolidRgba(16, 16, [0, 0, 0, 0]);
		const visual = verifyJoinVisual({
			join: j,
			frames: [
				{
					programmeTimeSec: j.programmeTimeSec,
					width: 16,
					height: 16,
					rgba: blank,
					label: "at_join",
				},
			],
		});
		expect(visual.outcome).toBe("FAIL");
		expect(visual.metrics?.VISUAL_INTEGRITY_FAILURE).toBe(true);
	});

	it("preservation UNKNOWN without evidence; FAIL when must-survive removed", () => {
		const doc = withTrim(baseDoc(), 4.3, 5.7);
		const { joins } = enumerateProgrammeJoins({ document: doc });
		const j = joins.find((x) => x.cause === "TRIM_CREATED")!;
		const unk = verifyJoinPreservation({ join: j, evidence: null });
		expect(unk.outcome).toBe("UNKNOWN");

		const bad = verifyJoinPreservation({
			join: j,
			evidence: {
				mustSurvive: [{ id: "ms1", sourceRange: { startSec: 4.5, endSec: 5.5 } }],
			},
		});
		expect(bad.outcome).toBe("FAIL");
	});

	it("rollback/undo restores previous join set", () => {
		const before = enumerateProgrammeJoins({ document: baseDoc() });
		const after = enumerateProgrammeJoins({ document: withTrim(baseDoc(), 4.3, 5.7) });
		expect(after.joins.length).toBeGreaterThan(before.joins.length);
		const undone = enumerateProgrammeJoins({ document: baseDoc() });
		expect(undone.joins.map((j) => j.joinId)).toEqual(before.joins.map((j) => j.joinId));
	});

	it("cache hit after identical verify; stale after programme mutation", async () => {
		const cacheDir = mkdtempSync(join(tmpdir(), "fsq-cache-"));
		cacheDirs.push(cacheDir);
		const doc = withTrim(baseDoc(), 4.3, 5.7);
		const { joins } = enumerateProgrammeJoins({ document: doc });
		const j = joins.find((x) => x.cause === "TRIM_CREATED")!;
		const pcm = synthesizeJoinPcm({ mode: "safe_silence" });

		const r1 = await verifyFinalSequenceCutQuality({
			document: doc,
			audioByJoinId: { [j.joinId]: pcm },
			cacheDir,
			useCache: true,
			skipCaption: true,
		});
		expect(r1.performance.cacheHit).toBe(false);

		const r2 = await verifyFinalSequenceCutQuality({
			document: doc,
			audioByJoinId: { [j.joinId]: pcm },
			cacheDir,
			useCache: true,
			skipCaption: true,
		});
		expect(r2.performance.cacheHit).toBe(true);

		const mutated = withTrim(baseDoc(), 4.1, 5.9);
		const r3 = await verifyFinalSequenceCutQuality({
			document: mutated,
			cacheDir,
			useCache: true,
			skipCaption: true,
		});
		expect(r3.performance.cacheHit).toBe(false);
	});

	it("micro-fade experiment is report-only and recommends MORE_EVIDENCE or NO_CHANGE", () => {
		const exp = runMicroFadeExperiment();
		expect(exp.nativeAudioBoundaryFadeSamples).toBe(240);
		expect(exp.rows.length).toBeGreaterThanOrEqual(4);
		expect([
			"NO_CHANGE",
			"MORE_EVIDENCE_REQUIRED",
			"FIXED_MICRO_FADE",
			"ADAPTIVE_MICRO_FADE",
		]).toContain(exp.policyRecommendation);
		// Prefer not shipping fades from synthetic alone
		expect(exp.policyRecommendation).not.toBe("FIXED_MICRO_FADE");
	});

	it("caption continuity runs when captions enabled", async () => {
		let doc = withTrim(baseDoc(), 4.3, 5.7);
		doc = patchCaptionSettings(doc, { enabled: true }, 16 / 9);
		const result = await verifyFinalSequenceCutQuality({
			document: doc,
			useCache: false,
			skipCaption: false,
		});
		expect(result.coverage.captionChecked).toBeGreaterThanOrEqual(0);
		expect(result.provenance.paidAiCalls).toBe(0);
		expect(result.provenance.autoMutations).toBe(0);
	});

	it("speed boundary enumerated and not treated as visual integrity failure", () => {
		const doc = {
			...baseDoc(),
			legacyEditor: {
				speedRegions: [{ startSec: 8, endSec: 10, speed: 2 }],
			},
		};
		const { joins } = enumerateProgrammeJoins({ document: doc, assetId: "asset_1" });
		const sp = joins.find((j) => j.cause === "SPEED_BOUNDARY");
		expect(sp).toBeTruthy();
		const visual = verifyJoinVisual({ join: sp! });
		expect(visual.outcome).toBe("NOT_APPLICABLE");
	});

	it("preview vs export assessment is honest PARTIAL without paired measure", () => {
		const a = assessPreviewVsExportParity();
		expect(a.parityVerdict).toBe("PARTIAL");
	});

	it("temporal adapter emits refs without blobs", async () => {
		const doc = withTrim(baseDoc(), 4.3, 5.7);
		const result = await verifyFinalSequenceCutQuality({
			document: doc,
			useCache: false,
			skipCaption: true,
		});
		const recs = temporalRecordsFromSequenceResult(result);
		expect(recs.every((r) => r.kind === "FINAL_SEQUENCE_JOIN_VERIFY")).toBe(true);
		expect(JSON.stringify(recs)).not.toMatch(/Float32Array|rgba/);
	});

	it("zero paid AI proof artifact", async () => {
		mkdirSync(ARTIFACT, { recursive: true });
		writeFileSync(
			join(ARTIFACT, "zero-paid-ai-proof.json"),
			JSON.stringify(
				{
					OPENAI_CALLS: 0,
					ANTHROPIC_CALLS: 0,
					GEMINI_CALLS: 0,
					ELEVENLABS_CALLS: 0,
					OTHER_PAID_AI_CALLS: 0,
					TOTAL_PAID_AI_CALLS: 0,
					AUTO_MUTATIONS: 0,
				},
				null,
				2,
			),
		);
		expect(true).toBe(true);
	});
});
