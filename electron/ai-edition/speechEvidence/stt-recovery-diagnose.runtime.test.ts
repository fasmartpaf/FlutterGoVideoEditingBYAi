/**
 * Diagnostic-only: reproduce STT failure and capture SpeechEvidence.reason.
 * Does not patch production. Writes under real-corpus-recovery-1-stt/.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { candidateBinaryPaths } from "../../stt/gpuDetector";
import { _resetSttManagerForTests, getSttManager, shutdownStt } from "../../stt/index";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import { probeSourceDurations, resolveFfprobe } from "../sourceTiming";
import { prepareSpeechEvidenceForTurn } from "../speechEvidence/prepare";
import { probeAudioStream } from "../speechEvidence/probe";

const OUT = path.join(process.cwd(), "tmp/perception-benchmark/real-corpus-recovery-1-stt");
const FFMPEG = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");
const REC = path.join(
	os.homedir(),
	"Library/Application Support/openscreen/recordings/recording-bug5-narrated.mp4",
);
const C4 = path.join(
	process.cwd(),
	"tmp/perception-benchmark/case4-correction/case4-spoken-correction.mp4",
);
const NO_AUDIO = path.join(
	os.homedir(),
	"Library/Application Support/openscreen/recordings/recording-1788958840550.mp4",
);
const OPENSCREEN_MODELS = path.join(
	os.homedir(),
	"Library/Application Support/openscreen/stt-models",
);

function buildDoc(videoPath: string, durationSec: number, title: string) {
	const base = createEmptyDocument({
		title,
		projectId: `proj_${title}`,
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				label: title,
				kind: "video",
				originalPath: videoPath,
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
}

describe("STT recovery diagnose (pre-fix)", () => {
	afterAll(async () => {
		await shutdownStt().catch(() => undefined);
		_resetSttManagerForTests();
	});

	it("captures A/B/C probe + prepare reasons with default vs openscreen modelsBaseDir", async () => {
		mkdirSync(OUT, { recursive: true });
		const binaries = candidateBinaryPaths().filter((p) => p && existsSync(p));
		const diag: Record<string, unknown> = {
			identity: "CURRENT_OPENSCREEN_REAL_CORPUS_RECOVERY_STT_V1",
			phase: "diagnose_pre_fix",
			binaries,
			openscreenModelsPresent: existsSync(
				path.join(OPENSCREEN_MODELS, "whisper-ggml/ggml-small-q8_0.bin"),
			),
			openscreenModelsDir: OPENSCREEN_MODELS,
			cases: {} as Record<string, unknown>,
		};

		const cases = [
			{ id: "A_narrated", path: REC, prompt: "What did I say in this recording?" },
			{ id: "B_correction", path: C4, prompt: "What did I say, and did I correct myself?" },
			{ id: "C_no_audio", path: NO_AUDIO, prompt: "What did I say in this recording?" },
		];

		for (const c of cases) {
			const entry: Record<string, unknown> = { mediaPath: c.path, exists: existsSync(c.path) };
			if (!existsSync(c.path)) {
				(diag.cases as Record<string, unknown>)[c.id] = entry;
				continue;
			}
			const probe = await probeAudioStream(c.path);
			entry.probe = probe;
			const durations = await probeSourceDurations(c.path, {
				ffmpegPath: FFMPEG,
				ffprobePath: resolveFfprobe(),
			});
			entry.durationSec = durations.containerDurationSec;

			// Mode 1: product-like — getSttManager() WITHOUT modelsBaseDir override
			_resetSttManagerForTests();
			const cache1 = await mkdtemp(path.join(os.tmpdir(), "stt-diag-default-"));
			const needs = classifyMediaContextNeeds(c.prompt);
			const doc1 = buildDoc(c.path, durations.containerDurationSec ?? 10, c.id);
			const t0 = Date.now();
			let defaultPrep: unknown = null;
			let defaultErr: string | null = null;
			try {
				defaultPrep = await prepareSpeechEvidenceForTurn({
					document: doc1,
					userMessage: c.prompt,
					contextNeeds: needs,
					deps: {
						getSttManager: () => getSttManager(),
						resolveSttBinary: () => binaries[0] ?? null,
						cacheDir: cache1,
					},
				});
			} catch (e) {
				defaultErr = e instanceof Error ? e.message : String(e);
			}
			entry.default_modelsBaseDir = {
				ms: Date.now() - t0,
				error: defaultErr,
				evidence: (defaultPrep as { prepared?: { evidence?: unknown[] } } | null)?.prepared
					?.evidence,
			};

			// Mode 2: openscreen modelsBaseDir (bug5 style)
			_resetSttManagerForTests();
			await shutdownStt().catch(() => undefined);
			_resetSttManagerForTests();
			const cache2 = await mkdtemp(path.join(os.tmpdir(), "stt-diag-openscreen-"));
			const mgr = getSttManager();
			await mgr.init({ modelsBaseDir: OPENSCREEN_MODELS });
			const doc2 = buildDoc(c.path, durations.containerDurationSec ?? 10, `${c.id}_os`);
			const t1 = Date.now();
			let openPrep: unknown = null;
			let openErr: string | null = null;
			try {
				openPrep = await prepareSpeechEvidenceForTurn({
					document: doc2,
					userMessage: c.prompt,
					contextNeeds: needs,
					deps: {
						getSttManager: () => mgr,
						resolveSttBinary: () => binaries[0] ?? null,
						cacheDir: cache2,
					},
				});
			} catch (e) {
				openErr = e instanceof Error ? e.message : String(e);
			}
			entry.openscreen_modelsBaseDir = {
				ms: Date.now() - t1,
				error: openErr,
				evidence: (openPrep as { prepared?: { evidence?: unknown[] } } | null)?.prepared?.evidence,
			};

			(diag.cases as Record<string, unknown>)[c.id] = entry;
			await shutdownStt().catch(() => undefined);
			_resetSttManagerForTests();
		}

		writeFileSync(path.join(OUT, "diagnose-pre-fix.json"), JSON.stringify(diag, null, 2));
		console.log(JSON.stringify(diag, null, 2).slice(0, 8000));
	}, 600_000);
});
