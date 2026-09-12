/**
 * Bug 5 real-runtime transcription — requires staged whisper-stt-server + model + narrated MP4.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { candidateBinaryPaths } from "../../stt/gpuDetector";
import { _resetSttManagerForTests, SttManager, shutdownStt } from "../../stt/index";
import { executeAgentTool } from "../agent-tools";
import {
	ensureCanonicalSourceDuration,
	probeSourceDurations,
	resolveFfprobe,
} from "../sourceTiming";
import { stripInternalEvidenceJsonBlocks } from "./format";
import { prepareSpeechEvidenceForTurn } from "./prepare";

const VIDEO =
	"/Users/osama/Library/Application Support/openscreen/recordings/recording-bug5-narrated.mp4";
const FFMPEG = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");
const BIN =
	process.env.OPENSCREEN_WHISPER_SERVER_EXE?.trim() ||
	candidateBinaryPaths().find((p) => p && existsSync(p)) ||
	path.join(process.cwd(), "electron/native/bin/darwin-arm64/whisper-stt-server");
const MODEL = path.join(
	os.homedir(),
	"Library/Application Support/openscreen/stt-models/whisper-ggml/ggml-small-q8_0.bin",
);
const OUT = path.join(process.cwd(), "tmp/bug5-validation");
const canRun =
	existsSync(VIDEO) && existsSync(FFMPEG) && Boolean(BIN && existsSync(BIN)) && existsSync(MODEL);

describe.runIf(canRun)("bug5 real transcription runtime", () => {
	afterAll(async () => {
		await shutdownStt().catch(() => undefined);
		_resetSttManagerForTests();
	});

	it("transcribes narrated recording with source timestamps + cache warm hit", async () => {
		mkdirSync(OUT, { recursive: true });
		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-bug5-cache-"));
		const CREATED = "2026-01-01T00:00:00.000Z";
		const base = createEmptyDocument({ title: "Bug5", projectId: "proj_b5", createdAt: CREATED });
		const probe = await probeSourceDurations(VIDEO, {
			ffmpegPath: FFMPEG,
			ffprobePath: resolveFfprobe(),
		});
		const durationSec = probe.containerDurationSec;
		expect(durationSec).toBeTruthy();
		const document = documentSchema.parse({
			...base,
			project: { ...base.project, primaryAssetId: "asset_1" },
			assets: [
				{
					id: "asset_1",
					label: "narrated",
					kind: "video",
					originalPath: VIDEO,
					durationSec,
					width: 1920,
					height: 1080,
				},
			],
			timeline: {
				...base.timeline,
				clips: [
					{
						id: "clip_1",
						assetId: "asset_1",
						sourceStartSec: 0,
						sourceEndSec: durationSec,
						timelineStartSec: 0,
						timelineEndSec: durationSec,
						wordRefs: [],
						origin: "user",
						reason: "",
					},
				],
				trimRanges: [],
			},
		});
		const ensured = await ensureCanonicalSourceDuration({
			document,
			assetId: "asset_1",
			probe,
		});
		expect(ensured.canonical?.assetMetadataKind).toBe("SOURCE_MEDIA_TIME");

		const tCold = Date.now();
		const cold = await prepareSpeechEvidenceForTurn({
			document: ensured.document,
			userMessage: "Make this video professional.",
			force: true,
			deps: {
				cacheDir,
				ffmpegPath: FFMPEG,
				ffprobePath: resolveFfprobe(),
				getSttManager: () => {
					const mgr = new SttManager();
					void mgr.init({
						modelsBaseDir: path.join(
							os.homedir(),
							"Library/Application Support/openscreen/stt-models",
						),
					});
					return mgr;
				},
				resolveSttBinary: () => BIN ?? null,
			},
		});
		const coldMs = Date.now() - tCold;
		const ev = cold.prepared?.evidence[0];
		if (ev?.status !== "available") {
			writeFileSync(path.join(OUT, "fail.json"), JSON.stringify(ev, null, 2));
		}
		expect(ev?.status, JSON.stringify(ev)).toBe("available");
		expect(ev?.audioStreamPresent).toBe(true);
		expect((ev?.segments.length ?? 0) > 0).toBe(true);
		expect(ev?.sourceDurationSec).toBeCloseTo(durationSec!, 1);

		const tWarm = Date.now();
		const warm = await prepareSpeechEvidenceForTurn({
			document: cold.document,
			userMessage: "Make this video professional.",
			force: true,
			deps: {
				cacheDir,
				ffmpegPath: FFMPEG,
				ffprobePath: resolveFfprobe(),
				getSttManager: () => {
					throw new Error("STT must not run on warm path");
				},
				resolveSttBinary: () => BIN ?? null,
			},
		});
		const warmMs = Date.now() - tWarm;
		expect(
			warm.prepared?.evidence[0]?.timings.cacheHit ||
				warm.prepared?.evidence[0]?.engine === "document-transcript",
		).toBe(true);

		const ranged = executeAgentTool(
			cold.document,
			"getTranscriptRange",
			JSON.stringify({ startSourceTimeSec: 0, endSourceTimeSec: 12 }),
		);
		expect(ranged.ok).toBe(true);

		const leak = stripInternalEvidenceJsonBlocks(
			'```json\n{"observations":[{"sourceTimeSec":0,"frameSummary":"x","regions":[]}],"transitions":[]}\n```\nAcross the sampled frames, hello.',
		);
		expect(leak).not.toMatch(/observations/);

		const report = {
			recordingDurationSec: durationSec,
			canonicalSourceDurationSec: ev?.sourceDurationSec,
			audioStreamDetected: ev?.audioStreamPresent,
			sttStatus: ev?.status,
			engine: ev?.engine,
			segmentCount: ev?.segments.length,
			firstSegment: ev?.segments[0],
			lastSegment: ev?.segments[ev.segments.length - 1],
			language: ev?.language,
			coldTranscriptionMs: coldMs,
			warmRetrievalMs: warmMs,
			timings: ev?.timings,
			segments: ev?.segments,
			probe,
			modelCallCount: 0,
		};
		writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
		process.stderr.write("BUG5_RUNTIME " + JSON.stringify(report, null, 2) + "\n");
	}, 300_000);
});
