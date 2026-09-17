/**
 * Unit tests for STT recovery: status resolution, failure reasons, models dir.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { clearSttRuntimeHealthCache, probeSttRuntimeHealth } from "../../stt/health";
import { MODEL_FILE_NAME } from "../../stt/modelManager";
import { resolveSttModelsBaseDir } from "../../stt/modelsDir";
import { classifySpeechFailureReason, humanSafeSpeechFailureReason } from "./failureReason";
import { prepareSpeechEvidenceForTurn } from "./prepare";
import { applySpeechStatusResolution, resolveSpeechEvidenceStatus } from "./resolveStatus";
import type { SpeechEvidence } from "./types";

describe("speech failure reason codes", () => {
	it("classifies userdata / getPath failures", () => {
		expect(
			classifySpeechFailureReason(
				new Error("Cannot read properties of undefined (reading 'getPath')"),
			),
		).toBe("userdata_unavailable");
	});

	it("classifies model missing and crashes", () => {
		expect(classifySpeechFailureReason(new Error("Whisper GGML model not found at /x"))).toBe(
			"model_missing",
		);
		expect(classifySpeechFailureReason(new Error("helper crashed"))).toBe("runtime_crashed");
	});

	it("user-facing reason never exposes getPath internals", () => {
		const code = classifySpeechFailureReason(
			new Error("Cannot read properties of undefined (reading 'getPath')"),
		);
		expect(humanSafeSpeechFailureReason(code)).not.toMatch(/getPath|undefined/i);
	});
});

describe("speech status resolution", () => {
	it("usable segments take precedence over provisional failed", () => {
		const r = resolveSpeechEvidenceStatus({
			provisionalStatus: "failed",
			audioStreamPresent: true,
			canonicalDurationSec: 20,
			segments: [{ startSourceTimeSec: 1, endSourceTimeSec: 2, text: "hello" }],
		});
		expect(r.status).toBe("available");
		expect(r.segments).toHaveLength(1);
	});

	it("empty text segments do not force available", () => {
		const r = resolveSpeechEvidenceStatus({
			provisionalStatus: "available",
			audioStreamPresent: true,
			canonicalDurationSec: 20,
			segments: [{ startSourceTimeSec: 1, endSourceTimeSec: 2, text: "  " }],
		});
		expect(r.status).toBe("failed");
		expect(r.failureReason).toBe("timestamp_invalid");
	});

	it("corrupt timestamps do not force available", () => {
		const r = resolveSpeechEvidenceStatus({
			provisionalStatus: "available",
			audioStreamPresent: true,
			canonicalDurationSec: 10,
			segments: [{ startSourceTimeSec: 50, endSourceTimeSec: 60, text: "late" }],
		});
		expect(r.status).toBe("failed");
		expect(r.segments).toEqual([]);
	});

	it("applySpeechStatusResolution keeps available when segments valid after prior failed", () => {
		const ev: SpeechEvidence = {
			assetId: "a",
			sourceDurationSec: 30,
			segments: [{ startSourceTimeSec: 0, endSourceTimeSec: 1.5, text: "ok" }],
			status: "failed",
			audioStreamPresent: true,
			timings: {
				audioProbeMs: 0,
				audioExtractMs: 0,
				sttMs: 0,
				transcriptParseMs: 0,
				transcriptCacheMs: 0,
				segmentCount: 1,
				cacheHit: false,
			},
			reason: "stale",
		};
		const out = applySpeechStatusResolution(ev);
		expect(out.status).toBe("available");
		expect(out.segments).toHaveLength(1);
	});
});

describe("STT models dir resolution", () => {
	const prev = process.env.OPENSCREEN_STT_MODELS_DIR;
	afterEach(() => {
		if (prev === undefined) delete process.env.OPENSCREEN_STT_MODELS_DIR;
		else process.env.OPENSCREEN_STT_MODELS_DIR = prev;
		clearSttRuntimeHealthCache();
	});

	it("honors OPENSCREEN_STT_MODELS_DIR", () => {
		process.env.OPENSCREEN_STT_MODELS_DIR = "/tmp/custom-stt-models";
		expect(resolveSttModelsBaseDir({ preferExisting: false })).toBe("/tmp/custom-stt-models");
	});

	it("discovers openscreen cache when model file exists", async () => {
		delete process.env.OPENSCREEN_STT_MODELS_DIR;
		const openscreen = path.join(os.homedir(), "Library/Application Support/openscreen/stt-models");
		const model = path.join(openscreen, "whisper-ggml", MODEL_FILE_NAME);
		const { existsSync } = await import("node:fs");
		if (!existsSync(model)) return; // environment without model
		const resolved = resolveSttModelsBaseDir();
		expect(resolved).toBe(openscreen);
	});

	it("health probe reports runtime + model without starting server", async () => {
		const h = await probeSttRuntimeHealth({ force: true });
		expect(h.modelsBaseDir.length).toBeGreaterThan(0);
		expect(typeof h.runtimePresent).toBe("boolean");
		expect(typeof h.modelPresent).toBe("boolean");
	});
});

describe("prepare failure reason on STT throw", () => {
	it("maps crash to failed + runtime_crashed without leaking stack internals as reason", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "os-sp-reason-"));
		const videoPath = path.join(dir, "clip.mp4");
		writeFileSync(videoPath, "x");
		const fakeBin = path.join(dir, "whisper-stt-server");
		writeFileSync(fakeBin, "#!/bin/sh\n");
		const base = createEmptyDocument({
			title: "t",
			projectId: "p",
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		const document = documentSchema.parse({
			...base,
			project: { ...base.project, primaryAssetId: "asset_1" },
			assets: [
				{
					id: "asset_1",
					label: "t",
					kind: "video",
					originalPath: videoPath,
					durationSec: 5,
					width: 100,
					height: 100,
				},
			],
			timeline: {
				...base.timeline,
				clips: [
					{
						id: "c1",
						assetId: "asset_1",
						sourceStartSec: 0,
						sourceEndSec: 5,
						timelineStartSec: 0,
						timelineEndSec: 5,
						wordRefs: [],
						origin: "user",
						reason: "",
					},
				],
			},
		});
		const prepared = await prepareSpeechEvidenceForTurn({
			document,
			userMessage: "what did I say",
			force: true,
			deps: {
				cacheDir: path.join(dir, "cache"),
				resolveSttBinary: () => fakeBin,
				probeAudioStream: async () => ({ present: true, codec: "aac" }),
				getSttManager: () =>
					({
						transcribe: async () => {
							throw new Error("helper crashed");
						},
					}) as never,
			},
		});
		const ev = prepared.prepared?.evidence[0];
		expect(ev?.status).toBe("failed");
		expect(ev?.failureReason).toBe("runtime_crashed");
		expect(ev?.reason).not.toMatch(/crashed/i);
		await rm(dir, { recursive: true, force: true });
	});
});
