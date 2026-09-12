/**
 * Live product-path check on the latest arbitrary recording after
 * frontmost-app + readable narration guidance.
 *
 * Uses the same invokeOpenScreenAgent path as the in-app chat (prepares
 * speech/visual/source-story internally).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { _resetSttManagerForTests, shutdownStt } from "../../stt/index";
import { invokeOpenScreenAgent, type OpenScreenAgentSink } from "../deep-agent/service";
import { stripInternalEvidenceJsonBlocks } from "../speechEvidence";
import { auditUserFacingSemanticLanguage } from "../visualEvidence/semantic";

const REC =
	"/Users/osama/Library/Application Support/openscreen/recordings/recording-1789234858783.mp4";
const PROJECT =
	"/Users/osama/Library/Application Support/openscreen/projects/proj_869e8234-2d80-4bad-8282-777e805d51c9.openscreen";
const FFMPEG = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");
const OUT = path.join(process.cwd(), "tmp/perception-benchmark/latest-readable-narration");

const PROMPT = `Watch and listen to this complete recording and explain what is happening from beginning to end.

Pay attention to what I say, including any hesitation, correction, or change in what I intend to do. Also compare my spoken explanation with what is actually visible on screen.

Describe the sequence naturally and chronologically. Clearly distinguish between something I only say I will do and something you can actually verify happened visually.

Do not invent clicks, panels, buttons, or actions that you cannot verify from the recording. Do not show backend JSON or technical diagnostics.`;

function loadApiKey(): string {
	const fromEnv = process.env.OPENAI_API_KEY?.trim() ?? "";
	if (fromEnv) return fromEnv;
	for (const rel of [
		"tmp/bug6-live-validation/.env.openai",
		"tmp/perception-benchmark/.env.openai",
	]) {
		const p = path.join(process.cwd(), rel);
		if (!existsSync(p)) continue;
		for (const line of readFileSync(p, "utf8").split("\n")) {
			if (line.startsWith("OPENAI_API_KEY=")) {
				return line
					.slice("OPENAI_API_KEY=".length)
					.trim()
					.replace(/^["']|["']$/g, "");
			}
		}
	}
	return "";
}

const apiKey = loadApiKey();
const canRun = Boolean(apiKey) && existsSync(REC) && existsSync(PROJECT) && existsSync(FFMPEG);

describe.runIf(canRun)("latest recording readable narration (live)", () => {
	afterAll(async () => {
		await shutdownStt().catch(() => undefined);
		_resetSttManagerForTests();
	});

	it("names frontmost apps in plain language without technical leakage", async () => {
		mkdirSync(OUT, { recursive: true });
		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-latest-narr-"));
		const proj = JSON.parse(readFileSync(PROJECT, "utf8"));
		const asset = proj.assets[0];
		const durationSec = asset.durationSec ?? 20.81;
		const base = createEmptyDocument({
			title: "latest-readable",
			projectId: proj.project.id,
			createdAt: "2026-09-12T00:00:00.000Z",
		});
		const document = documentSchema.parse({
			...base,
			project: { ...base.project, id: proj.project.id, primaryAssetId: asset.id },
			assets: [
				{
					id: asset.id,
					label: asset.label,
					kind: "video",
					originalPath: REC,
					durationSec,
					width: asset.video?.width ?? 1920,
					height: asset.video?.height ?? 1080,
				},
			],
			transcript: proj.transcript,
			transcripts: proj.transcripts ?? [proj.transcript],
			timeline: {
				...base.timeline,
				clips: [
					{
						id: "clip_1",
						assetId: asset.id,
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
			document,
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

		const facing = stripInternalEvidenceJsonBlocks(result.text || raw);
		writeFileSync(path.join(OUT, "user-facing.txt"), facing);
		writeFileSync(path.join(OUT, "raw.txt"), result.text || raw);

		const lower = facing.toLowerCase();
		const warnings = auditUserFacingSemanticLanguage(facing, {
			frames: [],
			changes: [],
			durationSec,
		});
		writeFileSync(path.join(OUT, "audit-warnings.json"), JSON.stringify(warnings, null, 2));
		writeFileSync(
			path.join(OUT, "score.json"),
			JSON.stringify(
				{
					chars: facing.length,
					mentionsCursor: /cursor/i.test(facing),
					mentionsStrathclydeOrUploads: /strathclyde|uploads/i.test(lower),
					mentionsAppStoreOrSeek: /app store|seek|testflight/i.test(lower),
					technicalLeak:
						/SOURCE_STORY|VISUAL_SEMANTIC|mediaCapabilities|speechStatus|across the sampled frames/i.test(
							facing,
						),
					auditWarnings: warnings,
					preview: facing.slice(0, 900),
				},
				null,
				2,
			),
		);

		expect(facing.length).toBeGreaterThan(80);
		expect(facing).not.toMatch(/SOURCE_STORY|VISUAL_SEMANTIC|mediaCapabilities|speechStatus/i);
		expect(facing).not.toMatch(/across the sampled frames/i);
		expect(/cursor/i.test(facing)).toBe(true);
		expect(/strathclyde|uploads|app store|seek|testflight/i.test(lower)).toBe(true);
		expect(warnings.filter((w) => /lab wording|mediaCapabilities|internal story/i.test(w))).toEqual(
			[],
		);
	}, 600_000);
});
