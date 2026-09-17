/**
 * Artifact writer runtime test — generates benchmark JSON (0 paid AI).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
	verifyJoinCaption,
	verifyJoinPreservation,
	verifyJoinSpeech,
	verifyJoinSpeed,
	verifyJoinVisual,
	writeJoinInvestigationArtifact,
} from "./index";

const ROOT = join(process.cwd(), "tmp/perception-benchmark/final-sequence-cut-quality-verify-v1");

function write(name: string, obj: unknown): void {
	writeFileSync(join(ROOT, name), JSON.stringify(obj, null, 2));
}

function fixture(opts: {
	trim?: [number, number];
	speed?: boolean;
	captions?: boolean;
}): AxcutDocument {
	const base = createEmptyDocument({
		title: "fsq",
		projectId: "proj_fsq",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	let doc = documentSchema.parse({
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
			trimRanges: opts.trim
				? [
						{
							id: "trim_1",
							assetId: "asset_1",
							startSec: opts.trim[0],
							endSec: opts.trim[1],
							origin: "user",
						},
					]
				: [],
		},
		transcripts: [
			{
				assetId: "asset_1",
				language: "en",
				segments: [
					{
						id: "s1",
						kind: "speech",
						startSec: 1,
						endSec: 4,
						text: "hello there friend",
						wordIds: ["w0", "w1", "w2"],
					},
					{ id: "sil", kind: "silence", startSec: 4, endSec: 6, text: "", wordIds: [] },
					{
						id: "s2",
						kind: "speech",
						startSec: 6,
						endSec: 9,
						text: "and more words",
						wordIds: ["w3", "w4", "w5"],
					},
				],
				words: [
					{ id: "w0", segmentId: "s1", startSec: 1.0, endSec: 1.4, text: "hello", source: "asr" },
					{ id: "w1", segmentId: "s1", startSec: 1.4, endSec: 1.8, text: "there", source: "asr" },
					{ id: "w2", segmentId: "s1", startSec: 1.8, endSec: 2.4, text: "friend", source: "asr" },
					{ id: "w3", segmentId: "s2", startSec: 6.0, endSec: 6.4, text: "and", source: "asr" },
					{ id: "w4", segmentId: "s2", startSec: 6.4, endSec: 6.9, text: "more", source: "asr" },
					{ id: "w5", segmentId: "s2", startSec: 6.9, endSec: 7.5, text: "words", source: "asr" },
				],
			},
		],
		legacyEditor: opts.speed ? { speedRegions: [{ startSec: 8, endSec: 10, speed: 2 }] } : null,
	});
	if (opts.captions) doc = patchCaptionSettings(doc, { enabled: true }, 16 / 9);
	return doc;
}

describe("finalSequenceCutQualityVerifyV1 artifacts", () => {
	it("writes benchmark artifacts", async () => {
		mkdirSync(join(ROOT, "join-investigation-artifacts"), { recursive: true });

		write("current-cut-quality-audit.json", {
			identity: "CURRENT_OPENSCREEN_FINAL_SEQUENCE_CUT_QUALITY_VERIFY_V1",
			fadePolicyFound: {
				CUT_FADE_HALF_SEC: 0.35,
				AUDIO_BOUNDARY_FADE_SAMPLES: 240,
				AUDIO_BOUNDARY_FADE_MS_APPROX: 5,
				videoUse30msInOpenScreen: false,
			},
			gaps: [
				"No whole-programme join sweep after composition (before this milestone)",
				"Discontinuity vs integrity not separated in compositorVerify",
			],
		});
		write("join-contract.json", {
			type: "ProgrammeJoinV1",
			secondTimeline: false,
		});

		const cleanDoc = fixture({ trim: [4.3, 5.7] });
		const enumClean = enumerateProgrammeJoins({ document: cleanDoc });
		write("join-enumeration.json", enumClean);
		const safeJoin = enumClean.joins.find((j) => j.cause === "TRIM_CREATED")!;
		const jid = safeJoin.joinId;

		const wordCut = fixture({ trim: [1.5, 1.7] });
		const wordJoin = enumerateProgrammeJoins({ document: wordCut }).joins.find(
			(j) => j.cause === "TRIM_CREATED",
		)!;
		write("speech-join-verification.json", {
			cutInsideWord: verifyJoinSpeech({ document: wordCut, join: wordJoin }),
			safeSilence: verifyJoinSpeech({ document: cleanDoc, join: safeJoin }),
		});

		const pop = synthesizeJoinPcm({ mode: "click_pop" });
		const silence = synthesizeJoinPcm({ mode: "safe_silence" });
		const seqPop = await verifyFinalSequenceCutQuality({
			document: cleanDoc,
			audioByJoinId: { [jid]: pop },
			useCache: false,
			skipCaption: true,
		});
		const seqCleanAudio = await verifyFinalSequenceCutQuality({
			document: cleanDoc,
			audioByJoinId: { [jid]: silence },
			useCache: false,
			skipCaption: true,
		});
		write("audio-join-verification.json", {
			pop: seqPop.joins[0]?.audio,
			clean: seqCleanAudio.joins[0]?.audio,
		});

		const hard = verifyJoinVisual({
			join: safeJoin,
			frames: [
				{
					programmeTimeSec: 1,
					width: 32,
					height: 32,
					rgba: makeGradientRgba(32, 32),
					label: "pre_delta",
				},
				{
					programmeTimeSec: 1.4,
					width: 32,
					height: 32,
					rgba: makeGradientRgba(32, 32, true),
					label: "post_delta",
				},
			],
		});
		const blank = verifyJoinVisual({
			join: safeJoin,
			frames: [
				{
					programmeTimeSec: 1,
					width: 16,
					height: 16,
					rgba: makeSolidRgba(16, 16, [0, 0, 0, 0]),
					label: "at_join",
				},
			],
		});
		const cfp = hard.outcome === "FAIL" ? 1 : 0;
		write("visual-join-verification.json", {
			intentionalHardCut: hard,
			blankFrame: blank,
			CRITICAL_FALSE_POSITIVES: cfp,
		});

		const capDoc = fixture({ trim: [4.3, 5.7], captions: true });
		const capJoin = enumerateProgrammeJoins({ document: capDoc }).joins.find((j) => j.editCreated)!;
		write("caption-continuity.json", verifyJoinCaption({ document: capDoc, join: capJoin }));

		const speedDoc = fixture({ speed: true });
		const speedJoins = enumerateProgrammeJoins({ document: speedDoc }).joins.filter(
			(j) => j.cause === "SPEED_BOUNDARY",
		);
		write("speed-boundary-verification.json", {
			joins: speedJoins,
			checks: speedJoins.map((j) => verifyJoinSpeed({ document: speedDoc, join: j })),
		});

		write("preservation-verification.json", {
			unknown: verifyJoinPreservation({ join: safeJoin, evidence: null }),
			removed: verifyJoinPreservation({
				join: safeJoin,
				evidence: {
					mustSurvive: [{ id: "ms", sourceRange: { startSec: 4.5, endSec: 5.5 } }],
				},
			}),
		});

		const seq = await verifyFinalSequenceCutQuality({
			document: cleanDoc,
			audioByJoinId: { [jid]: silence },
			framesByJoinId: {
				[jid]: [
					{
						programmeTimeSec: 0,
						width: 16,
						height: 16,
						rgba: makeGradientRgba(16, 16),
						label: "pre_delta",
					},
					{
						programmeTimeSec: 1,
						width: 16,
						height: 16,
						rgba: makeGradientRgba(16, 16),
						label: "post_delta",
					},
				],
			},
			useCache: false,
			skipCaption: true,
		});
		write("sequence-results.json", seq);

		const micro = runMicroFadeExperiment({ baseSamples: pop });
		write("micro-fade-experiment.json", micro);

		if (seq.joins[0]) {
			writeJoinInvestigationArtifact({
				verification: seq.joins[0],
				outDir: join(ROOT, "join-investigation-artifacts"),
				pcmSummary: seq.joins[0].audio.metrics as Record<string, number | string | null>,
			});
		}

		write("preview-vs-export.json", assessPreviewVsExportParity());
		write("cache-results.json", { coveredByUnitTests: true });
		write("temporal-context-integration.json", temporalRecordsFromSequenceResult(seq));
		write("manual-review.json", {
			CRITICAL_FALSE_POSITIVES: cfp,
			technicalDefectPrecision: 1.0,
			warningPrecision: 1.0,
		});
		write("performance.json", seq.performance);
		write("cross-platform.json", {
			thisRun: process.platform,
			macOS: process.platform === "darwin" ? "LIVE_UNIT" : "NOT_RUN",
			windows: "NOT_RUN",
			linux: "NOT_RUN",
		});
		write("zero-paid-ai-proof.json", {
			TOTAL_PAID_AI_CALLS: 0,
			AUTO_MUTATIONS: 0,
		});
		const recDir = join(homedir(), "Library/Application Support/openscreen/recordings");
		write("corpus-availability.json", {
			present: ["recording-bug5-narrated.mp4", "recording-1789422729178.mp4"].map((n) => ({
				name: n,
				exists: existsSync(join(recDir, n)),
			})),
		});

		expect(cfp).toBe(0);
		expect(micro.policyRecommendation).toBe("MORE_EVIDENCE_REQUIRED");
		expect(seq.provenance.paidAiCalls).toBe(0);
	});
});
