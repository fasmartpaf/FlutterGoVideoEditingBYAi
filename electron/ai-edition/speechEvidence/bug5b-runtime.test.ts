/**
 * Bug 5B — canonical duration + context-aware speech prep on the narrated recording.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { candidateBinaryPaths } from "../../stt/gpuDetector";
import { _resetSttManagerForTests, SttManager, shutdownStt } from "../../stt/index";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import {
	ensureCanonicalSourceDuration,
	probeSourceDurations,
	resolveFfprobe,
} from "../sourceTiming";
import { stripInternalEvidenceJsonBlocks } from "../speechEvidence/format";
import { prepareSpeechEvidenceForTurn } from "../speechEvidence/prepare";
import { promptWantsVisualEvidence } from "../visualEvidence/intent";

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
const OUT = path.join(process.cwd(), "tmp/bug5b-validation");
const canRun =
	existsSync(VIDEO) && existsSync(FFMPEG) && Boolean(BIN && existsSync(BIN)) && existsSync(MODEL);

function buildDoc(durationSec: number) {
	const CREATED = "2026-01-01T00:00:00.000Z";
	const base = createEmptyDocument({ title: "Bug5B", projectId: "proj_b5b", createdAt: CREATED });
	return documentSchema.parse({
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
}

function sttDeps(cacheDir: string) {
	return {
		cacheDir,
		getSttManager: () => {
			const mgr = new SttManager();
			void mgr.init({
				modelsBaseDir: path.join(os.homedir(), "Library/Application Support/openscreen/stt-models"),
			});
			return mgr;
		},
		resolveSttBinary: () => BIN ?? null,
		ffmpegPath: FFMPEG,
		ffprobePath: resolveFfprobe(),
	};
}

describe.runIf(canRun)("bug5b canonical duration + context needs runtime", () => {
	afterAll(async () => {
		await shutdownStt().catch(() => undefined);
		_resetSttManagerForTests();
	});

	it("diagnoses duration, repairs stale 22s metadata, and proves request matrix", async () => {
		mkdirSync(OUT, { recursive: true });
		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-bug5b-cache-"));
		const probe = await probeSourceDurations(VIDEO, {
			ffmpegPath: FFMPEG,
			ffprobePath: resolveFfprobe(),
		});
		expect(probe.containerDurationSec).toBeGreaterThan(16);
		expect(probe.containerDurationSec).toBeLessThan(18);

		const staleDoc = buildDoc(22);
		const ensured = await ensureCanonicalSourceDuration({
			document: staleDoc,
			assetId: "asset_1",
			probe,
		});
		expect(ensured.canonical?.repaired).toBe(true);
		expect(ensured.canonical?.durationSec).toBeCloseTo(probe.containerDurationSec!, 2);
		expect(ensured.document.assets[0]?.durationSec).toBeCloseTo(probe.containerDurationSec!, 2);
		expect(ensured.canonical?.previousAssetDurationSec).toBe(22);

		const prompts = {
			A: "What is visible on screen around 6 seconds?",
			B: "What did I say around 6 seconds?",
			C: "Tell me what is happening in this recording, including what I'm explaining.",
			D: "Make this recording feel like a polished software tutorial.",
			E: "Delete 3–5 seconds.",
		} as const;

		const matrix: Record<
			string,
			{
				contextCategory: string;
				visualWanted: boolean;
				speechWanted: boolean;
				injectSpeech: boolean;
				cursorWanted: boolean;
				speechPrepared: boolean;
				speechCacheHit: boolean | null;
				sttInvoked: boolean;
				preparationLatencyMs: number;
				modelCallCount: number;
			}
		> = {};

		let sttCalls = 0;
		const countingDeps = {
			...sttDeps(cacheDir),
			getSttManager: () => {
				const mgr = sttDeps(cacheDir).getSttManager();
				const original = mgr.transcribe.bind(mgr);
				mgr.transcribe = async (args) => {
					sttCalls += 1;
					return original(args);
				};
				return mgr;
			},
		};

		// A — visual only: must NOT invoke STT
		{
			const needs = classifyMediaContextNeeds(prompts.A);
			const t0 = Date.now();
			const before = sttCalls;
			const prepared = await prepareSpeechEvidenceForTurn({
				document: ensured.document,
				userMessage: prompts.A,
				contextNeeds: needs,
				deps: countingDeps,
			});
			matrix.A = {
				contextCategory: needs.category,
				visualWanted: needs.visual || promptWantsVisualEvidence(prompts.A),
				speechWanted: needs.speech,
				injectSpeech: needs.injectSpeech,
				cursorWanted: needs.cursor,
				speechPrepared: prepared.prepared != null,
				speechCacheHit: null,
				sttInvoked: sttCalls > before,
				preparationLatencyMs: Date.now() - t0,
				modelCallCount: 0,
			};
			expect(needs.speech).toBe(false);
			expect(prepared.prepared).toBeNull();
			expect(sttCalls).toBe(before);
		}

		// B — speech only
		{
			const needs = classifyMediaContextNeeds(prompts.B);
			const t0 = Date.now();
			const before = sttCalls;
			const prepared = await prepareSpeechEvidenceForTurn({
				document: ensured.document,
				userMessage: prompts.B,
				contextNeeds: needs,
				deps: countingDeps,
			});
			const ev = prepared.prepared?.evidence[0];
			matrix.B = {
				contextCategory: needs.category,
				visualWanted: needs.visual,
				speechWanted: needs.speech,
				injectSpeech: needs.injectSpeech,
				cursorWanted: needs.cursor,
				speechPrepared: prepared.prepared != null,
				speechCacheHit: ev?.timings.cacheHit ?? null,
				sttInvoked: sttCalls > before,
				preparationLatencyMs: Date.now() - t0,
				modelCallCount: 0,
			};
			expect(needs.visual).toBe(false);
			expect(needs.speech).toBe(true);
			expect(ev?.status).toBe("available");
			expect(ev?.sourceDurationSec).toBeCloseTo(probe.containerDurationSec!, 1);
			const last = ev?.segments[ev.segments.length - 1];
			expect(last?.endSourceTimeSec).toBeLessThanOrEqual((ev?.sourceDurationSec ?? 0) + 0.35);
		}

		// C — understanding (may hit cache from B)
		{
			const needs = classifyMediaContextNeeds(prompts.C);
			const t0 = Date.now();
			const before = sttCalls;
			const prepared = await prepareSpeechEvidenceForTurn({
				document: ensured.document,
				userMessage: prompts.C,
				contextNeeds: needs,
				deps: countingDeps,
			});
			matrix.C = {
				contextCategory: needs.category,
				visualWanted: needs.visual,
				speechWanted: needs.speech,
				injectSpeech: needs.injectSpeech,
				cursorWanted: needs.cursor,
				speechPrepared: prepared.prepared != null,
				speechCacheHit: prepared.prepared?.evidence[0]?.timings.cacheHit ?? null,
				sttInvoked: sttCalls > before,
				preparationLatencyMs: Date.now() - t0,
				modelCallCount: 0,
			};
			expect(needs.visual && needs.speech).toBe(true);
			expect(prepared.prepared).not.toBeNull();
		}

		// D — editing context
		{
			const needs = classifyMediaContextNeeds(prompts.D);
			const t0 = Date.now();
			const before = sttCalls;
			const prepared = await prepareSpeechEvidenceForTurn({
				document: ensured.document,
				userMessage: prompts.D,
				contextNeeds: needs,
				deps: countingDeps,
			});
			matrix.D = {
				contextCategory: needs.category,
				visualWanted: needs.visual,
				speechWanted: needs.speech,
				injectSpeech: needs.injectSpeech,
				cursorWanted: needs.cursor,
				speechPrepared: prepared.prepared != null,
				speechCacheHit: prepared.prepared?.evidence[0]?.timings.cacheHit ?? null,
				sttInvoked: sttCalls > before,
				preparationLatencyMs: Date.now() - t0,
				modelCallCount: 0,
			};
			expect(needs.category).toBe("editingContext");
			expect(needs.cursor).toBe(true);
			expect(prepared.prepared).not.toBeNull();
		}

		// E — deterministic
		{
			const needs = classifyMediaContextNeeds(prompts.E);
			const t0 = Date.now();
			const before = sttCalls;
			const prepared = await prepareSpeechEvidenceForTurn({
				document: ensured.document,
				userMessage: prompts.E,
				contextNeeds: needs,
				deps: countingDeps,
			});
			matrix.E = {
				contextCategory: needs.category,
				visualWanted: needs.visual,
				speechWanted: needs.speech,
				injectSpeech: needs.injectSpeech,
				cursorWanted: needs.cursor,
				speechPrepared: prepared.prepared != null,
				speechCacheHit: null,
				sttInvoked: sttCalls > before,
				preparationLatencyMs: Date.now() - t0,
				modelCallCount: 0,
			};
			expect(prepared.prepared).toBeNull();
			expect(sttCalls).toBe(before);
		}

		const leak = stripInternalEvidenceJsonBlocks(
			'```json\n{"injectSpeech":true,"visual":true,"speech":true}\n```\nNatural answer.',
		);
		expect(leak).not.toMatch(/injectSpeech/);
		expect(leak).toMatch(/Natural answer/);

		const report = {
			durationDiagnosis: {
				containerDurationSec: probe.containerDurationSec,
				videoStreamDurationSec: probe.videoStreamDurationSec,
				audioStreamDurationSec: probe.audioStreamDurationSec,
				streamDiscrepancySec: probe.streamDiscrepancySec,
				bug5HardcodedWas: 22,
				bug5HardcodedKind: "DERIVED/STALE_METADATA",
				canonicalAfterRepair: ensured.canonical?.durationSec,
				canonicalKind: "SOURCE_MEDIA_TIME",
				assetBefore: 22,
				assetAfter: ensured.document.assets[0]?.durationSec,
				clipSourceEndAfter: ensured.document.timeline.clips[0]?.sourceEndSec,
				lastSpeechEndFromBug5Report: 17.0,
				classification: {
					container: "SOURCE_MEDIA_TIME",
					videoStream: "STREAM_TIME",
					audioStream: "STREAM_TIME",
					hardcoded22: "DERIVED/STALE_METADATA",
					timelineClipFullSource: "SOURCE_MEDIA_TIME (when matching asset)",
				},
			},
			requestMatrix: matrix,
			sttCallCountTotal: sttCalls,
			modelCallCount: 0,
			proofs: {
				A_didNotInvokeColdStt: matrix.A?.sttInvoked === false,
				B_preparedSpeech: matrix.B?.speechPrepared === true,
				C_wantsBoth: matrix.C?.visualWanted && matrix.C?.speechWanted,
				D_editingContext: matrix.D?.contextCategory === "editingContext",
				E_noStt: matrix.E?.sttInvoked === false,
			},
		};
		writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
		process.stderr.write("BUG5B_RUNTIME " + JSON.stringify(report, null, 2) + "\n");

		expect(matrix.A?.sttInvoked).toBe(false);
		expect(matrix.A?.speechPrepared).toBe(false);
		expect(matrix.B?.speechPrepared).toBe(true);
		expect(matrix.E?.speechPrepared).toBe(false);
	}, 300_000);
});
