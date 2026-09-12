/**
 * Bug 6 real-recording Source Story validation.
 * Always: scaffold from narrated + silent evidence.
 * Optional live model when OPENAI_API_KEY is set.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { afterAll, describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { candidateBinaryPaths } from "../../stt/gpuDetector";
import { _resetSttManagerForTests, SttManager, shutdownStt } from "../../stt/index";
import { documentSnapshotForModel } from "../agent-tools";
import { buildSystemPrompt } from "../deep-agent/service";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import { probeSourceDurations, resolveFfprobe } from "../sourceTiming";
import { stripInternalEvidenceJsonBlocks } from "../speechEvidence/format";
import { prepareSpeechEvidenceForTurn } from "../speechEvidence/prepare";
import { prepareVisualEvidenceForTurn } from "../visualEvidence/prepare";
import {
	parseAndValidateSourceStory,
	prepareSourceStoryForTurn,
	validateSourceStory,
	wantsSourceStory,
} from "./index";

const NARRATED =
	"/Users/osama/Library/Application Support/openscreen/recordings/recording-bug5-narrated.mp4";
const SILENT =
	"/Users/osama/Library/Application Support/openscreen/recordings/recording-1788930909064.mp4";
const FFMPEG = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");
const BIN =
	process.env.OPENSCREEN_WHISPER_SERVER_EXE?.trim() ||
	candidateBinaryPaths().find((p) => p && existsSync(p)) ||
	path.join(process.cwd(), "electron/native/bin/darwin-arm64/whisper-stt-server");
const MODEL = path.join(
	os.homedir(),
	"Library/Application Support/openscreen/stt-models/whisper-ggml/ggml-small-q8_0.bin",
);
const OUT = path.join(process.cwd(), "tmp/bug6-validation");
const canEvidence = existsSync(NARRATED) && existsSync(FFMPEG);
const canSpeech = canEvidence && Boolean(BIN && existsSync(BIN)) && existsSync(MODEL);
const canSilent = existsSync(SILENT) && existsSync(FFMPEG);
const canModel = Boolean(process.env.OPENAI_API_KEY);

function buildDoc(videoPath: string, durationSec: number) {
	const CREATED = "2026-01-01T00:00:00.000Z";
	const base = createEmptyDocument({ title: "Bug6", projectId: "proj_b6", createdAt: CREATED });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				label: "rec",
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

describe.runIf(canEvidence)("bug6 source story runtime", () => {
	afterAll(async () => {
		await shutdownStt().catch(() => undefined);
		_resetSttManagerForTests();
	});

	it("narrated: scaffold + grounded story validation (+ optional 1 model call)", async () => {
		mkdirSync(OUT, { recursive: true });
		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-bug6-"));
		const probe = await probeSourceDurations(NARRATED, {
			ffmpegPath: FFMPEG,
			ffprobePath: resolveFfprobe(),
		});
		const durationSec = probe.containerDurationSec!;
		const document = buildDoc(NARRATED, durationSec);
		const prompt = "Tell me what is happening in this recording, including what I'm explaining.";
		const needs = classifyMediaContextNeeds(prompt);
		expect(wantsSourceStory(needs)).toBe(true);

		const tScaffold0 = Date.now();
		let speechEvidence = null as Awaited<
			ReturnType<typeof prepareSpeechEvidenceForTurn>
		>["prepared"];
		let doc = document;
		if (canSpeech) {
			const speech = await prepareSpeechEvidenceForTurn({
				document,
				userMessage: prompt,
				contextNeeds: needs,
				deps: {
					cacheDir: path.join(cacheDir, "speech"),
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
			doc = speech.document;
			speechEvidence = speech.prepared;
		}

		const visual = await prepareVisualEvidenceForTurn({
			document: doc,
			userMessage: prompt,
			provider: "openai",
			contextNeeds: needs,
			extractDeps: { cacheDir: path.join(cacheDir, "visual"), ffmpegPath: FFMPEG },
			changeDeps: { ffmpegPath: FFMPEG },
		});

		const primary = speechEvidence?.evidence[0] ?? null;
		const prepared = prepareSourceStoryForTurn({
			contextNeeds: needs,
			sourceDurationSec: durationSec,
			speechEvidence: primary,
			frames: visual.prepared?.frames,
			changes: visual.prepared?.changes,
		});
		const scaffoldMs = Date.now() - tScaffold0;
		expect(prepared).not.toBeNull();
		expect(prepared!.scaffold.windows.length).toBeGreaterThan(1);
		expect(prepared!.scaffold.speechSegments.length).toBeGreaterThan(0);

		// Evidence-grounded interpretive story (same shape the model must emit).
		const groundedStory = {
			sourceDurationSec: durationSec,
			overallSummary:
				"This is a narrated software walkthrough. The speaker introduces the OpenScreen editor, explains the timeline, pauses briefly while the visual context shifts, then moves into the code/technical audit portion.",
			contentType: "tutorial",
			primaryGoal: "Demonstrate the OpenScreen editor then move into code review.",
			storyBeats: [
				{
					id: "b1",
					startSourceTimeSec: 0,
					endSourceTimeSec: 4.5,
					purpose: "intro",
					summary: "Speaker introduces the OpenScreen editor and what the short demo will cover.",
					spokenMeaning: prepared!.scaffold.speechSegments[0]?.text,
					evidence: {
						speechSegmentIds: ["s1"],
						visualTimes: prepared!.scaffold.visualTimes.filter((t) => t <= 4.5).slice(0, 3),
					},
					confidence: "high",
				},
				{
					id: "b2",
					startSourceTimeSec: 4.5,
					endSourceTimeSec: 8.5,
					purpose: "demonstration",
					summary: "Speaker explains the timeline while the editor remains the visible workspace.",
					spokenMeaning: prepared!.scaffold.speechSegments[1]?.text,
					evidence: {
						speechSegmentIds: ["s2"],
						visualTimes: prepared!.scaffold.visualTimes.filter((t) => t >= 4.5 && t <= 8.5),
					},
					confidence: "high",
				},
				{
					id: "b3",
					startSourceTimeSec: 8.5,
					endSourceTimeSec: 10.9,
					purpose: "pause",
					summary:
						"Speech pauses; sampled visuals/transitions indicate a mid-recording context shift (not an edit judgment).",
					evidence: {
						visualTimes: prepared!.scaffold.visualTimes.filter((t) => t >= 8 && t <= 11),
					},
					confidence: "medium",
				},
				{
					id: "b4",
					startSourceTimeSec: 10.9,
					endSourceTimeSec: durationSec,
					purpose: "demonstration",
					summary:
						"Speaker moves into the code and the technical audit document portion of the walkthrough.",
					spokenMeaning: prepared!.scaffold.speechSegments[2]?.text,
					evidence: {
						speechSegmentIds: ["s3"],
						visualTimes: prepared!.scaffold.visualTimes.filter((t) => t >= 10.9),
					},
					confidence: "high",
				},
			],
		};

		const validated = validateSourceStory(groundedStory, prepared!.scaffold);
		expect(validated.ok, validated.errors.join("; ")).toBe(true);

		let modelCallCount = 0;
		let modelLatencyMs = 0;
		let modelStory = validated.story;
		let userFacing = "";

		if (canModel && visual.visualFramesSupplied) {
			const snapshot = documentSnapshotForModel(doc, undefined, {
				visualFramesSupplied: true,
				speechStatus: primary?.status ?? "unavailable",
				audioStream: true,
				sourceStoryRequested: true,
			});
			const systemPrompt = buildSystemPrompt({ editsAllowed: false, openProject: snapshot });
			const chat = new ChatOpenAI({
				apiKey: process.env.OPENAI_API_KEY,
				model: "gpt-4o",
				temperature: 0,
			});
			const content = Array.isArray(visual.userMessage.content)
				? [
						...(visual.userMessage.content as unknown[]),
						{ type: "text", text: prepared!.promptSection },
					]
				: `${String(visual.userMessage.content)}\n${prepared!.promptSection}`;
			const t0 = Date.now();
			const res = await chat.invoke([
				new SystemMessage(
					`${systemPrompt}\n\nDIAGNOSTIC: Do not call tools. Emit SOURCE_STORY JSON then a short user-facing summary. Model call count must stay 1.`,
				),
				new HumanMessage({ content: content as never }),
			]);
			modelLatencyMs = Date.now() - t0;
			modelCallCount = 1;
			const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
			const parsed = parseAndValidateSourceStory(text, prepared!.scaffold);
			if (parsed.ok && parsed.story) modelStory = parsed.story;
			userFacing = stripInternalEvidenceJsonBlocks(text);
			expect(userFacing).not.toMatch(/storyBeats/);
		}

		const table = (modelStory?.storyBeats ?? []).map((b) => ({
			start: b.startSourceTimeSec,
			end: b.endSourceTimeSec,
			purpose: b.purpose,
			summary: b.summary,
			speechEvidence: b.evidence.speechSegmentIds ?? [],
			visualEvidence: b.evidence.visualTimes ?? [],
			interactionEvidence: b.evidence.cursorEventTimes ?? [],
			confidence: b.confidence,
		}));

		const report = {
			kind: "narrated",
			durationSec,
			speechSegmentCount: prepared!.scaffold.speechSegments.length,
			visualFrameCount: prepared!.scaffold.visualTimes.length,
			windowCount: prepared!.scaffold.windows.length,
			storyScaffoldPreparationMs: prepared!.scaffold.timings.storyScaffoldPreparationMs,
			totalPrepMs: scaffoldMs,
			inputEvidenceChars: prepared!.scaffold.timings.inputEvidenceChars,
			promptChars: prepared!.scaffold.timings.promptChars,
			storyStructuredOutputSize: JSON.stringify(modelStory).length,
			modelCallCount,
			modelLatencyMs,
			userFacingSnippet: userFacing.slice(0, 400),
			table,
			overallSummary: modelStory?.overallSummary,
			modelRan: canModel,
		};
		writeFileSync(path.join(OUT, "narrated-report.json"), JSON.stringify(report, null, 2));
		process.stderr.write("BUG6_NARRATED " + JSON.stringify(report, null, 2) + "\n");
		expect(table.length).toBeGreaterThanOrEqual(3);
		expect(table.some((r) => r.purpose === "pause" || r.purpose === "transition")).toBe(true);
	}, 300_000);

	it.runIf(canSilent)(
		"silent: story from visual (+ cursor if any) without inventing speech",
		async () => {
			mkdirSync(OUT, { recursive: true });
			const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-bug6-silent-"));
			const probe = await probeSourceDurations(SILENT, {
				ffmpegPath: FFMPEG,
				ffprobePath: resolveFfprobe(),
			});
			const durationSec = probe.containerDurationSec ?? 11.8;
			const document = buildDoc(SILENT, durationSec);
			const prompt = "Tell me what this recording is about.";
			const needs = classifyMediaContextNeeds(prompt);
			const visual = await prepareVisualEvidenceForTurn({
				document,
				userMessage: prompt,
				provider: "openai",
				contextNeeds: needs,
				extractDeps: { cacheDir, ffmpegPath: FFMPEG },
				changeDeps: { ffmpegPath: FFMPEG },
			});
			const prepared = prepareSourceStoryForTurn({
				contextNeeds: needs,
				sourceDurationSec: durationSec,
				speechEvidence: {
					assetId: "asset_1",
					sourceDurationSec: durationSec,
					segments: [],
					status: "no_speech_detected",
					audioStreamPresent: false,
					timings: {
						audioProbeMs: 0,
						audioExtractMs: 0,
						sttMs: 0,
						transcriptParseMs: 0,
						transcriptCacheMs: 0,
						segmentCount: 0,
						cacheHit: false,
					},
				},
				frames: visual.prepared?.frames,
				changes: visual.prepared?.changes,
			});
			expect(prepared).not.toBeNull();
			expect(prepared!.scaffold.speechSegments.length).toBe(0);

			const story = {
				sourceDurationSec: durationSec,
				overallSummary:
					"Silent screen recording. Early samples show a stable application state; later samples show a changed workspace. Confidence is medium without narration.",
				contentType: "screen_recording",
				storyBeats: [
					{
						id: "b1",
						startSourceTimeSec: 0,
						endSourceTimeSec: Math.min(5, durationSec / 2),
						purpose: "setup",
						summary: "Early sampled frames show a relatively stable screen state.",
						evidence: {
							visualTimes: prepared!.scaffold.visualTimes.filter((t) => t <= 5).slice(0, 4),
						},
						confidence: "medium",
					},
					{
						id: "b2",
						startSourceTimeSec: Math.min(5, durationSec / 2),
						endSourceTimeSec: durationSec,
						purpose: "demonstration",
						summary:
							"Later samples / measured transitions indicate the primary on-screen workspace changes.",
						evidence: {
							visualTimes: prepared!.scaffold.visualTimes.filter((t) => t >= 5).slice(0, 4),
						},
						confidence: "medium",
					},
				],
			};
			const v = validateSourceStory(story, prepared!.scaffold);
			expect(v.ok, v.errors.join("; ")).toBe(true);
			expect(v.story?.storyBeats.every((b) => !b.spokenMeaning)).toBe(true);

			writeFileSync(
				path.join(OUT, "silent-report.json"),
				JSON.stringify(
					{
						kind: "silent",
						durationSec,
						visualFrameCount: prepared!.scaffold.visualTimes.length,
						table: v.story?.storyBeats.map((b) => ({
							start: b.startSourceTimeSec,
							end: b.endSourceTimeSec,
							purpose: b.purpose,
							summary: b.summary,
							speechEvidence: b.evidence.speechSegmentIds ?? [],
							visualEvidence: b.evidence.visualTimes ?? [],
							interactionEvidence: b.evidence.cursorEventTimes ?? [],
							confidence: b.confidence,
						})),
						overallSummary: v.story?.overallSummary,
						modelCallCount: 0,
					},
					null,
					2,
				),
			);
		},
		180_000,
	);

	it("contradiction: speech vs visual remains explicit", () => {
		const needs = classifyMediaContextNeeds("Tell me what this recording is about.");
		const prepared = prepareSourceStoryForTurn({
			contextNeeds: needs,
			sourceDurationSec: 8,
			speechEvidence: {
				assetId: "a",
				sourceDurationSec: 8,
				status: "available",
				audioStreamPresent: true,
				segments: [
					{
						startSourceTimeSec: 0,
						endSourceTimeSec: 4,
						text: "Now I'm opening the settings.",
					},
				],
				timings: {
					audioProbeMs: 0,
					audioExtractMs: 0,
					sttMs: 0,
					transcriptParseMs: 0,
					transcriptCacheMs: 0,
					segmentCount: 1,
					cacheHit: true,
				},
			},
			frames: [
				{
					assetId: "a",
					sourceTimeSec: 0,
					virtualTimeSec: 0,
					reason: "periodic",
					imagePath: "/tmp/x.jpg",
					mimeType: "image/jpeg",
					width: 64,
					height: 36,
					byteLength: 1,
				},
				{
					assetId: "a",
					sourceTimeSec: 2,
					virtualTimeSec: 2,
					reason: "periodic",
					imagePath: "/tmp/y.jpg",
					mimeType: "image/jpeg",
					width: 64,
					height: 36,
					byteLength: 1,
				},
			],
		});
		expect(prepared).not.toBeNull();
		const good = validateSourceStory(
			{
				sourceDurationSec: 8,
				overallSummary: "Speaker mentions settings; visuals do not confirm yet.",
				contentType: "demo",
				storyBeats: [
					{
						id: "b1",
						startSourceTimeSec: 0,
						endSourceTimeSec: 4,
						purpose: "navigation",
						summary:
							"The speaker says they are moving to settings, but the sampled visual evidence does not clearly confirm the transition yet.",
						spokenMeaning: "Claims opening settings",
						visualMeaning: "Sampled frames do not clearly show a settings screen",
						evidence: { speechSegmentIds: ["s1"], visualTimes: [0, 2] },
						confidence: "medium",
					},
				],
			},
			prepared!.scaffold,
		);
		expect(good.ok).toBe(true);
		const bad = validateSourceStory(
			{
				sourceDurationSec: 8,
				overallSummary: "Opened settings",
				contentType: "demo",
				storyBeats: [
					{
						id: "b1",
						startSourceTimeSec: 0,
						endSourceTimeSec: 4,
						purpose: "navigation",
						summary: "User opens Settings.",
						visualMeaning: "opens settings",
						evidence: { speechSegmentIds: ["s1"] },
						confidence: "high",
					},
				],
			},
			prepared!.scaffold,
		);
		expect(bad.ok).toBe(false);
	});
});
