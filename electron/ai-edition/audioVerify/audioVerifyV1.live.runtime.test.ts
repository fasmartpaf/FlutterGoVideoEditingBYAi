/**
 * Live Audio Continuity path — bounded exportMulti → ffmpeg f32le PCM.
 * Skip (not fail) when addon / ffmpeg / hardware unavailable.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { resolveFfmpeg } from "../../media/audioPeaks";
import { CompositorViewService } from "../../native-bridge/services/compositorViewService";
import {
	AUDIO_VERIFY_V1_PROVIDER_ID,
	createBoundedExportPcmProvider,
	verifyTrimAudioContinuity,
} from "./index";

const ARTIFACT_DIR = join(process.cwd(), "tmp/perception-benchmark/audio-verify-v1");
const MEDIA = join(ARTIFACT_DIR, "live-audio-fixture.mp4");

function resolveBundledFfmpeg(): string | null {
	const candidates = [
		join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg"),
		join(process.cwd(), "crates/thirdparty/ffmpeg-n8.1.2-macos64-lgpl-shared/bin/ffmpeg"),
	];
	for (const c of candidates) {
		if (existsSync(c)) return c;
	}
	try {
		return resolveFfmpeg();
	} catch {
		return null;
	}
}

function ensureFixtureMedia(): boolean {
	mkdirSync(ARTIFACT_DIR, { recursive: true });
	if (existsSync(MEDIA) && statSync(MEDIA).size > 1024) return true;
	const ffmpeg = resolveBundledFfmpeg();
	if (!ffmpeg) return false;

	// Prefer remuxing the compositor live fixture + sine (avoids videotoolbox in CI/sandbox).
	const compositorFixture = join(
		process.cwd(),
		"tmp/perception-benchmark/compositor-verify-v1/live-fixture.mp4",
	);
	let r = spawnSync(
		ffmpeg,
		existsSync(compositorFixture) && statSync(compositorFixture).size > 1024
			? [
					"-y",
					"-i",
					compositorFixture,
					"-f",
					"lavfi",
					"-i",
					"sine=frequency=440:sample_rate=48000:duration=6",
					"-map",
					"0:v:0",
					"-map",
					"1:a:0",
					"-c:v",
					"copy",
					"-c:a",
					"aac",
					"-shortest",
					MEDIA,
				]
			: [
					"-y",
					"-f",
					"lavfi",
					"-i",
					"color=c=0x224466:s=640x360:d=6",
					"-f",
					"lavfi",
					"-i",
					"sine=frequency=440:sample_rate=48000:duration=6",
					"-c:v",
					"h264_videotoolbox",
					"-allow_sw",
					"1",
					"-b:v",
					"800k",
					"-c:a",
					"aac",
					"-shortest",
					MEDIA,
				],
		{ encoding: "utf8" },
	);
	if (!(r.status === 0 && existsSync(MEDIA) && statSync(MEDIA).size > 1024)) {
		writeFileSync(
			join(ARTIFACT_DIR, "live-audio-result.json"),
			JSON.stringify(
				{
					skipped: true,
					reason: "fixture_media_create_failed",
					ffmpeg,
					stderr: (r.stderr ?? "").slice(0, 800),
					providerId: AUDIO_VERIFY_V1_PROVIDER_ID,
				},
				null,
				2,
			),
		);
		return false;
	}
	return true;
}

function docWithMedia(trim?: { start: number; end: number }): AxcutDocument {
	const base = createEmptyDocument({
		title: "LiveAV",
		projectId: "proj_live_av",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "LiveAudio",
				originalPath: MEDIA,
				durationSec: 6,
			},
		],
		transcripts: [
			{
				assetId: "asset_1",
				language: "en",
				segments: [{ id: "s0", kind: "silence", startSec: 2, endSec: 4, text: "", wordIds: [] }],
				words: [],
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId: "asset_1",
					sourceStartSec: 0,
					sourceEndSec: 6,
					timelineStartSec: 0,
					timelineEndSec: 6,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
			trimRanges: trim
				? [
						{
							id: "trim_live",
							assetId: "asset_1",
							clipId: "clip_1",
							startSec: trim.start,
							endSec: trim.end,
							reason: "live",
							origin: "agent",
						},
					]
				: [],
		},
	});
}

describe("Audio Continuity Verification V1 — live runtime", () => {
	it("bounded exportMulti programme PCM around join (when addon available)", async () => {
		if (!ensureFixtureMedia()) {
			console.warn("[audio-verify-live] skip: cannot create fixture media");
			return;
		}
		const service = new CompositorViewService({ appRoot: process.cwd() });
		if (!service.hasAddon() || service.probeBackend() === "none") {
			console.warn("[audio-verify-live] skip: native compositor addon unavailable");
			writeFileSync(
				join(ARTIFACT_DIR, "live-audio-result.json"),
				JSON.stringify(
					{
						skipped: true,
						reason: "compositor_addon_unavailable",
						providerId: AUDIO_VERIFY_V1_PROVIDER_ID,
					},
					null,
					2,
				),
			);
			return;
		}

		const before = docWithMedia();
		const after = docWithMedia({ start: 2, end: 4 });
		const provider = createBoundedExportPcmProvider({
			appRoot: process.cwd(),
			workDir: ARTIFACT_DIR,
			retain: true,
		});
		const t0 = Date.now();
		const ev = await verifyTrimAudioContinuity({
			proposalId: "live_av",
			trimSourceStartSec: 2,
			trimSourceEndSec: 4,
			assetId: "asset_1",
			afterDocument: after,
			beforeDocument: before,
			mustSurviveRanges: [],
			pcmProvider: provider,
			retainArtifacts: true,
			artifactDir: ARTIFACT_DIR,
			appRoot: process.cwd(),
		});
		const wallMs = Date.now() - t0;
		writeFileSync(
			join(ARTIFACT_DIR, "live-audio-result.json"),
			JSON.stringify(
				{
					providerId: AUDIO_VERIFY_V1_PROVIDER_ID,
					status: ev.status,
					capturePath: ev.capturePath,
					sampleRate: ev.programmeAudioWindow.sampleRate,
					channels: ev.programmeAudioWindow.channels,
					sampleCount: ev.programmeAudioWindow.sampleCount,
					pcmSamplesAnalyzed: ev.pcmSamplesAnalyzed,
					waveformMetrics: ev.waveformMetrics,
					speechBoundaryRisk: ev.speechBoundaryRisk,
					latencyMs: ev.latencyMs,
					wallMs,
					platform: `${process.platform}-${process.arch}`,
				},
				null,
				2,
			),
			"utf8",
		);

		expect(ev.capturePath).toBe("bounded_exportMulti_pcm");
		expect(ev.programmeAudioWindow.sampleRate).toBe(48_000);
		expect(ev.pcmSamplesAnalyzed).toBeGreaterThan(1000);
		expect(["verified_audio_basic", "verified_audio_with_warnings"]).toContain(ev.status);
		expect(ev.additionalModelCalls).toBe(0);
	}, 120_000);
});
