/**
 * Case 2 visual-routing regression — exact FAST UI prompt + no-audio recording.
 * Asserts frames reach the model; does NOT assert temporary-UI perception quality.
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
import { resolveFfprobe } from "../sourceTiming";
import { prepareSpeechEvidenceForTurn, stripInternalEvidenceJsonBlocks } from "../speechEvidence";
import { promptWantsVisualEvidence } from "../visualEvidence/intent";
import { prepareVisualEvidenceForTurn } from "../visualEvidence/prepare";
import { CASE_2_EXACT_PROMPT } from "./case2Prompt";
import { classifyMediaContextNeeds } from "./index";

const VIDEO =
	"/Users/osama/Library/Application Support/openscreen/recordings/recording-1789018604635.mp4";
const FFMPEG = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");
const OUT = path.join(process.cwd(), "tmp/perception-benchmark/case2-routing-fix");
const INVALID_HISTORY = path.join(
	process.cwd(),
	"tmp/perception-benchmark/newest-visual-run/CASE2_INVALID_RUN.md",
);

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

function countImageParts(content: unknown): number {
	if (!Array.isArray(content)) return 0;
	return content.filter(
		(p) =>
			p && typeof p === "object" && "type" in p && (p as { type: string }).type === "image_url",
	).length;
}

function buildDoc() {
	const CREATED = "2026-09-10T05:37:04.159Z";
	const base = createEmptyDocument({
		title: "Case2RoutingFix",
		projectId: "proj_case2_routing",
		createdAt: CREATED,
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				label: "recording-1789018604635.mp4",
				kind: "video",
				originalPath: VIDEO,
				durationSec: 16.833333,
				width: 3024,
				height: 1964,
				transcriptionFailure: {
					kind: "no-audio",
					message:
						"Error invoking remote method 'stt:transcribe': NoAudioTrackError: No decodable audio",
					at: "2026-09-10T05:37:05.313Z",
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
					sourceEndSec: 16.833333,
					timelineStartSec: 0,
					timelineEndSec: 16.833333,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
			trimRanges: [],
		},
	});
}

describe.runIf(canRun)("case2 visual-routing live regression", () => {
	afterAll(async () => {
		await shutdownStt().catch(() => undefined);
		_resetSttManagerForTests();
	});

	it("exact Case 2 prompt attaches frames; no-audio stays no_audio; no Whisper", async () => {
		mkdirSync(OUT, { recursive: true });
		expect(existsSync(INVALID_HISTORY)).toBe(true);

		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-case2-routing-"));
		let sttInvoked = false;
		const BIN =
			process.env.OPENSCREEN_WHISPER_SERVER_EXE?.trim() ||
			candidateBinaryPaths().find((p) => p && existsSync(p)) ||
			path.join(process.cwd(), "electron/native/bin/darwin-arm64/whisper-stt-server");

		const document = buildDoc();
		const needs = classifyMediaContextNeeds(CASE_2_EXACT_PROMPT);
		expect(["mediaUnderstanding", "visualInspection"]).toContain(needs.category);
		expect(needs.visual).toBe(true);
		expect(promptWantsVisualEvidence(CASE_2_EXACT_PROMPT)).toBe(true);

		const speechPrep = await prepareSpeechEvidenceForTurn({
			document,
			userMessage: CASE_2_EXACT_PROMPT,
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
		expect(sttInvoked).toBe(false);

		const visualPrep = await prepareVisualEvidenceForTurn({
			document: speechPrep.document,
			userMessage: CASE_2_EXACT_PROMPT,
			provider: "openai",
			contextNeeds: needs,
			extractDeps: { cacheDir: path.join(cacheDir, "visual"), ffmpegPath: FFMPEG },
			changeDeps: { ffmpegPath: FFMPEG },
		});
		expect(visualPrep.visualFramesSupplied).toBe(true);
		const preparedFrameCount = visualPrep.prepared?.frames.length ?? 0;
		expect(preparedFrameCount).toBeGreaterThan(0);

		const imageParts = countImageParts(visualPrep.userMessage.content);
		expect(imageParts).toBeGreaterThan(0);

		let raw = "";
		let agentError = "";
		const sink: OpenScreenAgentSink = {
			text: (d) => {
				raw += d;
			},
			thinking: () => undefined,
			toolStart: () => undefined,
			toolEnd: () => undefined,
			error: (m) => {
				agentError = m;
			},
		};

		const result = await invokeOpenScreenAgent({
			document: speechPrep.document,
			userMessage: CASE_2_EXACT_PROMPT,
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
		if (!userText.trim()) {
			writeFileSync(
				path.join(OUT, "agent-empty.json"),
				JSON.stringify(
					{
						reason: "reason" in result ? result.reason : undefined,
						agentError,
						resultKeys: Object.keys(result),
						preparedFrameCount,
						imageParts,
					},
					null,
					2,
				),
			);
		}
		expect(userText, agentError || ("reason" in result ? String(result.reason) : "")).not.toMatch(
			/visual frames (are|were) (currently )?not available/i,
		);
		expect(userText).not.toMatch(/unable to visually inspect/i);
		expect(
			userText.length,
			agentError || ("reason" in result ? String(result.reason) : ""),
		).toBeGreaterThan(80);

		const report = {
			runId: "CASE_2_ROUTING_FIX",
			recording: VIDEO,
			contextNeeds: needs,
			speechStatus: primary?.status,
			whisperInvoked: sttInvoked,
			prepareVisualEvidenceForTurn: "reached",
			preparedFrameCount,
			imageParts,
			mediaCapabilities: { visualFrames: true },
			provider: "openai",
			model: "gpt-4o",
			modelCallCount: 1,
			userFacingSample: userText.slice(0, 800),
			userFacingFull: userText,
			preservedInvalidRun: INVALID_HISTORY,
		};
		writeFileSync(path.join(OUT, "CASE_2_ROUTING_FIX.json"), JSON.stringify(report, null, 2));
		writeFileSync(path.join(OUT, "user-facing.txt"), userText);
		writeFileSync(
			path.join(OUT, "CASE_2_ROUTING_FIX.md"),
			[
				"# CASE_2_ROUTING_FIX",
				"",
				"Post-fix visual-routing run. Does not overwrite CASE_2_RUN_INVALID.",
				"",
				`- category: ${needs.category}`,
				`- visual: ${needs.visual}`,
				`- preparedFrameCount: ${preparedFrameCount}`,
				`- imageParts: ${imageParts}`,
				`- speechStatus: ${primary?.status}`,
				`- Whisper invoked: ${sttInvoked}`,
				`- provider/model: openai / gpt-4o`,
				`- modelCallCount: 1`,
				"",
				"Perception of brief File-menu / toast events is NOT asserted here.",
				"",
			].join("\n"),
		);

		process.stderr.write(
			"CASE_2_ROUTING_FIX " +
				JSON.stringify(
					{
						category: needs.category,
						visual: needs.visual,
						preparedFrameCount,
						imageParts,
						speechStatus: primary?.status,
						whisperInvoked: sttInvoked,
					},
					null,
					2,
				) +
				"\n",
		);
	}, 600_000);
});
