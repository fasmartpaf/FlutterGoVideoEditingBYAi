/**
 * Bug 7 LIVE model validation — requires OPENAI_API_KEY.
 * Source Story + Target Story in one invokeOpenScreenAgent turn.
 * Never prints the API key. Does NOT execute edits.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { candidateBinaryPaths } from "../../stt/gpuDetector";
import { _resetSttManagerForTests, SttManager, shutdownStt } from "../../stt/index";
import { invokeOpenScreenAgent, type OpenScreenAgentSink } from "../deep-agent/service";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import { wantsSourceStory } from "../sourceStory";
import { probeSourceDurations, resolveFfprobe } from "../sourceTiming";
import { prepareSpeechEvidenceForTurn } from "../speechEvidence/prepare";
import { prepareTargetStoryForTurn, wantsTargetStory } from "./index";

const NARRATED =
	"/Users/osama/Library/Application Support/openscreen/recordings/recording-bug5-narrated.mp4";
const SILENT =
	"/Users/osama/Library/Application Support/openscreen/recordings/recording-1788958840550.mp4";
const FFMPEG = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");
const BIN =
	process.env.OPENSCREEN_WHISPER_SERVER_EXE?.trim() ||
	candidateBinaryPaths().find((p) => p && existsSync(p)) ||
	path.join(process.cwd(), "electron/native/bin/darwin-arm64/whisper-stt-server");
const MODEL_PATH = path.join(
	os.homedir(),
	"Library/Application Support/openscreen/stt-models/whisper-ggml/ggml-small-q8_0.bin",
);
const OUT = path.join(process.cwd(), "tmp/bug7-live-validation");

const POLISH =
	"Make this feel like a polished professional software tutorial, but don't over-edit it. Keep the useful explanation and make the progression easy to follow.";
const SHORTEN = "Make this much more concise while keeping the important explanation.";
const PRESERVE = "Keep almost everything, but make the flow easier to follow.";
const CONSTRAINT = "Do not remove anything. Keep every spoken explanation, but improve the flow.";
const UNSUPPORTED = "Turn this into a strong customer testimonial.";
const INFO = "What is this recording about?";
const DETERMINISTIC = "Delete 3 to 5 seconds.";
const SILENT_EDIT = "Make this screen recording easier to follow and more professional.";

const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
const canRun =
	Boolean(apiKey) &&
	existsSync(NARRATED) &&
	existsSync(SILENT) &&
	existsSync(FFMPEG) &&
	Boolean(BIN && existsSync(BIN)) &&
	existsSync(MODEL_PATH);

function buildDoc(videoPath: string, durationSec: number, title: string) {
	const CREATED = "2026-01-01T00:00:00.000Z";
	const base = createEmptyDocument({ title, projectId: `proj_${title}`, createdAt: CREATED });
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

function makeSink() {
	let raw = "";
	const sink: OpenScreenAgentSink = {
		text: (delta) => {
			raw += delta;
		},
		thinking: () => undefined,
		toolStart: () => undefined,
		toolEnd: () => undefined,
		error: () => undefined,
	};
	return {
		sink,
		getRaw: () => raw,
	};
}

function sttDeps(cacheDir: string) {
	return {
		cacheDir,
		ffmpegPath: FFMPEG,
		ffprobePath: resolveFfprobe(),
		getSttManager: () => {
			const mgr = new SttManager();
			void mgr.init({
				modelsBaseDir: path.join(os.homedir(), "Library/Application Support/openscreen/stt-models"),
			});
			return mgr;
		},
		resolveSttBinary: () => BIN ?? null,
	};
}

/** Pre-transcribe so invokeOpenScreenAgent hits on-document transcript SSOT. */
async function narratedDocWithSpeech(
	title: string,
	userMessage: string,
	cacheDir: string,
): Promise<{ document: AxcutDocument; durationSec: number }> {
	const probe = await probeSourceDurations(NARRATED, {
		ffmpegPath: FFMPEG,
		ffprobePath: resolveFfprobe(),
	});
	const durationSec = probe.containerDurationSec ?? 16.896;
	const document = buildDoc(NARRATED, durationSec, title);
	const needs = classifyMediaContextNeeds(userMessage);
	const speechPrep = await prepareSpeechEvidenceForTurn({
		document,
		userMessage,
		contextNeeds: needs,
		deps: sttDeps(path.join(cacheDir, "speech")),
	});
	return { document: speechPrep.document, durationSec };
}

describe.runIf(canRun)("bug7 LIVE Target Story model validation", () => {
	afterAll(async () => {
		await shutdownStt().catch(() => undefined);
		_resetSttManagerForTests();
	});

	it("classifier gates: info / deterministic / polish", () => {
		expect(wantsTargetStory(classifyMediaContextNeeds(INFO))).toBe(false);
		expect(wantsSourceStory(classifyMediaContextNeeds(INFO))).toBe(true);
		expect(wantsTargetStory(classifyMediaContextNeeds(DETERMINISTIC))).toBe(false);
		expect(wantsSourceStory(classifyMediaContextNeeds(DETERMINISTIC))).toBe(false);
		expect(wantsTargetStory(classifyMediaContextNeeds(POLISH))).toBe(true);
		expect(wantsSourceStory(classifyMediaContextNeeds(POLISH))).toBe(true);
	});

	it("narrated polish: Source + Target Story in one turn", async () => {
		mkdirSync(OUT, { recursive: true });
		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-bug7-polish-"));
		const turnStarted = Date.now();
		const { document } = await narratedDocWithSpeech("Bug7Polish", POLISH, cacheDir);
		const holder = makeSink();
		const modelStarted = Date.now();
		const result = await invokeOpenScreenAgent({
			document,
			userMessage: POLISH,
			history: [],
			editsAllowed: false,
			speechCacheDir: path.join(cacheDir, "speech-agent"),
			model: {
				provider: "openai",
				model: "gpt-4o",
				apiKey,
				baseUrl: "https://api.openai.com/v1",
			},
			sink: holder.sink,
		});
		const modelLatencyMs = Date.now() - modelStarted;
		const totalTurnMs = Date.now() - turnStarted;
		const raw = holder.getRaw() || result.text;
		writeFileSync(path.join(OUT, "narrated-polish-raw.txt"), raw.slice(0, 100_000));

		expect(result.sourceStory, "SOURCE_STORY missing").toBeTruthy();
		expect(result.targetStory, "TARGET_STORY missing").toBeTruthy();
		expect(result.mutated).toBe(false);
		expect(result.text).not.toMatch(/targetBeats|TARGET_STORY|storyBeats|SOURCE_STORY/i);
		expect(result.text).not.toMatch(/```json/);
		expect(result.text.length).toBeGreaterThan(60);

		const target = result.targetStory!;
		expect(target.targetBeats.some((b) => b.changeNeeded === false)).toBe(true);
		expect(
			target.targetBeats.every(
				(b) => !/\bzoom\s*\d|trim\s+\d|addZoom|dissolve/i.test(b.desiredOutcome),
			),
		).toBe(true);
		const pauseMapped = target.targetBeats.find((b) =>
			b.sourceBeatIds.some((id) => {
				const src = result.sourceStory!.storyBeats.find((s) => s.id === id);
				return src?.purpose === "pause" || src?.purpose === "transition";
			}),
		);
		if (pauseMapped) {
			expect(pauseMapped.desiredOutcome).not.toMatch(/dead\s*time|should be deleted/i);
		}

		const audit = target.targetBeats.map((b) => {
			const sources = b.sourceBeatIds.map((id) =>
				result.sourceStory!.storyBeats.find((s) => s.id === id),
			);
			return {
				targetId: b.id,
				sourceBeatIds: b.sourceBeatIds,
				currentPurpose: sources.map((s) => s?.purpose).join(","),
				desiredOutcome: b.desiredOutcome,
				changeNeeded: b.changeNeeded,
				pacing: b.pacing,
				rationale: b.rationale,
			};
		});

		const prep = prepareTargetStoryForTurn({
			contextNeeds: classifyMediaContextNeeds(POLISH),
			userMessage: POLISH,
			sourceStoryRequested: true,
		});
		const report = {
			provider: "openai",
			model: "gpt-4o",
			prompt: POLISH,
			sourceStory: result.sourceStory,
			targetStory: target,
			preserveVsChangeAudit: audit,
			userFacingResponse: result.text,
			performance: {
				targetStoryInstructionSize: prep?.instructionChars ?? 0,
				targetStoryStructuredOutputSize: JSON.stringify(target).length,
				modelLatencyMs,
				totalTurnMs,
			},
			modelCallCount: 1,
			agentMutated: result.mutated,
		};
		writeFileSync(path.join(OUT, "narrated-polish.json"), JSON.stringify(report, null, 2));
		writeFileSync(path.join(OUT, "narrated-polish-user.txt"), result.text);
		process.stderr.write(
			"BUG7_LIVE_POLISH " +
				JSON.stringify(
					{
						ok: true,
						sourceBeats: result.sourceStory!.storyBeats.length,
						targetBeats: target.targetBeats.length,
						preserveCount: target.targetBeats.filter((b) => !b.changeNeeded).length,
						modelLatencyMs,
						totalTurnMs,
					},
					null,
					2,
				) +
				"\n",
		);
	}, 600_000);

	it("same-source different intents produce different Target Stories", async () => {
		mkdirSync(OUT, { recursive: true });
		const intents = [
			{ name: "polish", prompt: POLISH },
			{ name: "shorten", prompt: SHORTEN },
			{ name: "preserve", prompt: PRESERVE },
		] as const;
		const stories: Record<string, unknown> = {};
		for (const intent of intents) {
			const cacheDir = await mkdtemp(path.join(os.tmpdir(), `os-bug7-${intent.name}-`));
			const { document } = await narratedDocWithSpeech(
				`Bug7_${intent.name}`,
				intent.prompt,
				cacheDir,
			);
			const holder = makeSink();
			const result = await invokeOpenScreenAgent({
				document,
				userMessage: intent.prompt,
				history: [],
				editsAllowed: false,
				speechCacheDir: path.join(cacheDir, "speech-agent"),
				model: {
					provider: "openai",
					model: "gpt-4o",
					apiKey,
					baseUrl: "https://api.openai.com/v1",
				},
				sink: holder.sink,
			});
			expect(result.targetStory, intent.name).toBeTruthy();
			stories[intent.name] = {
				objective: result.targetStory!.objective,
				editingIntent: result.targetStory!.editingIntent,
				style: result.targetStory!.style,
				changeNeededFlags: result.targetStory!.targetBeats.map((b) => b.changeNeeded),
				pacing: result.targetStory!.targetBeats.map((b) => b.pacing),
				change: result.targetStory!.change,
				preserve: result.targetStory!.preserve,
				sourceBeatCount: result.sourceStory?.storyBeats.length ?? 0,
			};
			writeFileSync(
				path.join(OUT, `intent-${intent.name}.json`),
				JSON.stringify(
					{
						prompt: intent.prompt,
						sourceStory: result.sourceStory,
						targetStory: result.targetStory,
						text: result.text,
					},
					null,
					2,
				),
			);
		}
		expect(JSON.stringify(stories.polish)).not.toEqual(JSON.stringify(stories.shorten));
		expect(JSON.stringify(stories.preserve)).not.toEqual(JSON.stringify(stories.shorten));
		writeFileSync(path.join(OUT, "intent-comparison.json"), JSON.stringify(stories, null, 2));
	}, 900_000);

	it("user constraint: do not remove / keep spoken explanation", async () => {
		mkdirSync(OUT, { recursive: true });
		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-bug7-constraint-"));
		const { document } = await narratedDocWithSpeech("Bug7Constraint", CONSTRAINT, cacheDir);
		const holder = makeSink();
		const result = await invokeOpenScreenAgent({
			document,
			userMessage: CONSTRAINT,
			history: [],
			editsAllowed: false,
			speechCacheDir: path.join(cacheDir, "speech-agent"),
			model: {
				provider: "openai",
				model: "gpt-4o",
				apiKey,
				baseUrl: "https://api.openai.com/v1",
			},
			sink: holder.sink,
		});
		expect(result.targetStory).toBeTruthy();
		const blob = JSON.stringify(result.targetStory);
		expect(blob).not.toMatch(/\bremove\s+(?:the\s+)?(?:intro|explanation|spoken)\b/i);
		expect(
			result.targetStory!.editingIntent.preserveMeaning === true ||
				result.targetStory!.preserve.some((p) =>
					/spoken|explanation|everything/i.test(p.description),
				),
		).toBe(true);
		writeFileSync(
			path.join(OUT, "constraint.json"),
			JSON.stringify({ targetStory: result.targetStory, text: result.text }, null, 2),
		);
	}, 600_000);

	it("unsupported source goal records limitation without inventing testimonial", async () => {
		mkdirSync(OUT, { recursive: true });
		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-bug7-unsup-"));
		const { document } = await narratedDocWithSpeech("Bug7Unsup", UNSUPPORTED, cacheDir);
		const holder = makeSink();
		const result = await invokeOpenScreenAgent({
			document,
			userMessage: UNSUPPORTED,
			history: [],
			editsAllowed: false,
			speechCacheDir: path.join(cacheDir, "speech-agent"),
			model: {
				provider: "openai",
				model: "gpt-4o",
				apiKey,
				baseUrl: "https://api.openai.com/v1",
			},
			sink: holder.sink,
		});
		expect(result.targetStory).toBeTruthy();
		const blob = `${JSON.stringify(result.targetStory)}\n${result.text}`;
		expect(blob).not.toMatch(/customer says|as a happy customer|I love your product/i);
		const notesLimitation =
			(result.targetStory!.uncertainties?.some((u) =>
				/testimonial|lacks|does not contain|unavailable|no .*customer/i.test(u.note),
			) ??
				false) ||
			/testimonial|lacks|does not contain|unavailable|not .*customer/i.test(blob);
		expect(notesLimitation).toBe(true);
		writeFileSync(
			path.join(OUT, "unsupported-goal.json"),
			JSON.stringify({ targetStory: result.targetStory, text: result.text }, null, 2),
		);
	}, 600_000);

	it("silent recording Target Story without invented narration", async () => {
		mkdirSync(OUT, { recursive: true });
		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-bug7-silent-"));
		const holder = makeSink();
		const result = await invokeOpenScreenAgent({
			document: buildDoc(SILENT, 4.875, "Bug7Silent"),
			userMessage: SILENT_EDIT,
			history: [],
			editsAllowed: false,
			speechCacheDir: path.join(cacheDir, "speech"),
			model: {
				provider: "openai",
				model: "gpt-4o",
				apiKey,
				baseUrl: "https://api.openai.com/v1",
			},
			sink: holder.sink,
		});
		expect(result.sourceStory).toBeTruthy();
		expect(result.targetStory).toBeTruthy();
		expect(
			result.sourceStory!.storyBeats.every(
				(b) =>
					!(b.spokenMeaning && b.spokenMeaning.trim()) ||
					/no speech|silent|no narration/i.test(b.spokenMeaning),
			),
		).toBe(true);
		expect(result.text).not.toMatch(/targetBeats|TARGET_STORY/i);
		writeFileSync(
			path.join(OUT, "silent.json"),
			JSON.stringify(
				{
					sourceStory: result.sourceStory,
					targetStory: result.targetStory,
					text: result.text,
				},
				null,
				2,
			),
		);
	}, 600_000);

	it("informational: Source Story yes, Target Story no", async () => {
		mkdirSync(OUT, { recursive: true });
		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-bug7-info-"));
		const { document } = await narratedDocWithSpeech("Bug7Info", INFO, cacheDir);
		const holder = makeSink();
		const result = await invokeOpenScreenAgent({
			document,
			userMessage: INFO,
			history: [],
			editsAllowed: false,
			speechCacheDir: path.join(cacheDir, "speech-agent"),
			model: {
				provider: "openai",
				model: "gpt-4o",
				apiKey,
				baseUrl: "https://api.openai.com/v1",
			},
			sink: holder.sink,
		});
		expect(result.sourceStory).toBeTruthy();
		expect(result.targetStory).toBeUndefined();
		writeFileSync(
			path.join(OUT, "informational.json"),
			JSON.stringify(
				{
					hasSource: Boolean(result.sourceStory),
					hasTarget: Boolean(result.targetStory),
					sourceBeats: result.sourceStory?.storyBeats.length ?? 0,
					text: result.text,
				},
				null,
				2,
			),
		);
	}, 600_000);
});

describe("bug7 LIVE skipped without credentials/media", () => {
	it.skipIf(canRun)("placeholder when OPENAI_API_KEY or fixtures missing", () => {
		expect(canRun).toBe(false);
	});
});
