/**
 * Case 1 speech-state regression — real no-audio recording.
 * Persisted transcriptionFailure.kind=no-audio must become speechStatus no_audio,
 * without Whisper, and without "transcription unavailable" wording.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { candidateBinaryPaths } from "../../stt/gpuDetector";
import { _resetSttManagerForTests, SttManager, shutdownStt } from "../../stt/index";
import { invokeOpenScreenAgent, type OpenScreenAgentSink } from "../deep-agent/service";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import { prepareSourceStoryForTurn, wantsSourceStory } from "../sourceStory";
import { resolveFfprobe } from "../sourceTiming";
import {
	isUnavailableTranscriptionWording,
	prepareSpeechEvidenceForTurn,
	stripInternalEvidenceJsonBlocks,
} from "../speechEvidence";
import { prepareVisualEvidenceForTurn } from "../visualEvidence/prepare";

const VIDEO =
	"/Users/osama/Library/Application Support/openscreen/recordings/recording-1788991610901.mp4";
const FFMPEG = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");
const OUT = path.join(process.cwd(), "tmp/perception-benchmark/case1-no-audio-fix");

const PROMPT = `Watch and understand this complete recording, including what I say and what is happening visually.

Explain what the recording is about and how it progresses from beginning to end. Identify the important stages, meaningful visual changes, and what I am explaining at those moments.

Also tell me whether the spoken explanation and what is happening on screen support each other.

Do not give me backend JSON or technical diagnostics. Explain it naturally, as if you were a video editor who watched and understood the recording.

Do not invent button names, actions, speech, or visual details that you cannot clearly determine.`;

function loadOpenAiKey(): string {
	const fromEnv = process.env.OPENAI_API_KEY?.trim();
	if (fromEnv) return fromEnv;
	const p = path.join(process.cwd(), "tmp/bug6-live-validation/.env.openai");
	if (!existsSync(p)) return "";
	const raw = readFileSync(p, "utf8");
	const m = raw.match(/^\s*OPENAI_API_KEY\s*=\s*(.+)\s*$/m);
	return m?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
}

const apiKey = loadOpenAiKey();
const canRun = Boolean(apiKey) && existsSync(VIDEO) && existsSync(FFMPEG);

function buildDoc() {
	const CREATED = "2026-09-09T22:07:09.284Z";
	const base = createEmptyDocument({
		title: "Case1NoAudio",
		projectId: "proj_case1_no_audio",
		createdAt: CREATED,
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				label: "recording-1788991610901.mp4",
				kind: "video",
				originalPath: VIDEO,
				durationSec: 13.168333,
				width: 3024,
				height: 1964,
				transcriptionFailure: {
					kind: "no-audio",
					message:
						"Error invoking remote method 'stt:transcribe': NoAudioTrackError: No decodable audio",
					at: "2026-09-09T22:07:17.713Z",
				},
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId: "asset_1",
					sourceStartSec: 0,
					sourceEndSec: 13.168333,
					timelineStartSec: 0,
					timelineEndSec: 13.168333,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
			trimRanges: [],
		},
	});
}

describe.runIf(canRun)("case1 no-audio speech-state live regression", () => {
	afterAll(async () => {
		await shutdownStt().catch(() => undefined);
		_resetSttManagerForTests();
	});

	it("persisted no-audio → speechStatus no_audio, no Whisper, natural wording", async () => {
		mkdirSync(OUT, { recursive: true });
		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-case1-fix-"));
		let sttInvoked = false;
		const BIN =
			process.env.OPENSCREEN_WHISPER_SERVER_EXE?.trim() ||
			candidateBinaryPaths().find((p) => p && existsSync(p)) ||
			path.join(process.cwd(), "electron/native/bin/darwin-arm64/whisper-stt-server");

		const document = buildDoc();
		const needs = classifyMediaContextNeeds(PROMPT);
		expect(needs.speech).toBe(true);
		expect(needs.injectSpeech).toBe(true);

		const speechPrep = await prepareSpeechEvidenceForTurn({
			document,
			userMessage: PROMPT,
			contextNeeds: needs,
			deps: {
				cacheDir: path.join(cacheDir, "speech"),
				ffmpegPath: FFMPEG,
				ffprobePath: resolveFfprobe(),
				getSttManager: () => {
					sttInvoked = true;
					const mgr = new SttManager();
					void mgr.init({
						modelsBaseDir: path.join(
							os.homedir(),
							"Library/Application Support/openscreen/stt-models",
						),
					});
					return mgr;
				},
				resolveSttBinary: () => BIN,
			},
		});

		const primary = speechPrep.prepared?.evidence[0];
		expect(primary?.status).toBe("no_audio");
		expect(primary?.segments).toHaveLength(0);
		expect(sttInvoked).toBe(false);

		const visualPrep = await prepareVisualEvidenceForTurn({
			document: speechPrep.document,
			userMessage: PROMPT,
			provider: "openai",
			contextNeeds: needs,
			extractDeps: { cacheDir: path.join(cacheDir, "visual"), ffmpegPath: FFMPEG },
			changeDeps: { ffmpegPath: FFMPEG },
		});
		expect(visualPrep.visualFramesSupplied).toBe(true);

		const storyPrep = wantsSourceStory(needs)
			? prepareSourceStoryForTurn({
					contextNeeds: needs,
					sourceDurationSec: 13.168333,
					speechEvidence: primary,
					frames: visualPrep.prepared?.frames,
					changes: visualPrep.prepared?.changes,
				})
			: null;
		expect(storyPrep?.scaffold.speechStatus).toBe("no_audio");

		let raw = "";
		const sink: OpenScreenAgentSink = {
			text: (d) => {
				raw += d;
			},
			thinking: () => undefined,
			toolStart: () => undefined,
			toolEnd: () => undefined,
			error: () => undefined,
		};

		const result = await invokeOpenScreenAgent({
			document: speechPrep.document,
			userMessage: PROMPT,
			history: [],
			editsAllowed: false,
			speechCacheDir: path.join(cacheDir, "speech-agent"),
			model: {
				provider: "openai",
				model: "gpt-4o",
				apiKey,
				baseUrl: "https://api.openai.com/v1",
			},
			sink,
		});

		const userText = stripInternalEvidenceJsonBlocks(result.text || raw);
		expect(isUnavailableTranscriptionWording(userText)).toBe(false);
		expect(userText).not.toMatch(/transcription is currently unavailable/i);
		expect(userText).toMatch(
			/lacks audio|absence of audio|audio track|no (spoken )?narration|without (an )?audio|no audio|without narration/i,
		);
		expect(userText).not.toMatch(/storyBeats|SOURCE_STORY|speechStatus|\bno_audio\b/);
		expect(userText.length).toBeGreaterThan(80);

		const report = {
			recording: VIDEO,
			audioStream: false,
			speechStatus: primary?.status,
			sttInvoked,
			segmentCount: primary?.segments.length ?? 0,
			modelCallCount: 1,
			sourceStorySpeechStatus: storyPrep?.scaffold.speechStatus,
			visualFrames: visualPrep.prepared?.frames.length ?? 0,
			finalUserFacingSpeechWordingSample: userText.slice(0, 600),
			userFacingFull: userText,
		};
		writeFileSync(path.join(OUT, "regression.json"), JSON.stringify(report, null, 2));
		writeFileSync(path.join(OUT, "user-facing.txt"), userText);

		// Benchmark history annotation (preserve original FAIL).
		writeFileSync(
			path.join(OUT, "benchmark-annotation.md"),
			[
				"# Case 1 no-voice speech-state",
				"",
				"ORIGINAL CURRENT_OPENSCREEN RESULT:",
				"speech-state misclassification = FAIL",
				"(recording-1788991610901.mp4; collapsed no-audio → unavailable)",
				"",
				"REGRESSION FIX RESULT:",
				"speech-state classification = PASS",
				`speechStatus=${primary?.status}`,
				`sttInvoked=${sttInvoked}`,
				`unavailableWording=${isUnavailableTranscriptionWording(userText)}`,
				"",
			].join("\n"),
		);

		process.stderr.write(
			"CASE1_NO_AUDIO_FIX " +
				JSON.stringify(
					{
						speechStatus: primary?.status,
						sttInvoked,
						unavailableWording: isUnavailableTranscriptionWording(userText),
						visualFrames: report.visualFrames,
					},
					null,
					2,
				) +
				"\n",
		);
	}, 600_000);
});
