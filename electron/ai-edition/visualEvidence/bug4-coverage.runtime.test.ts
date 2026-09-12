/**
 * Bug 4 coverage regression — every attached timestamp accounted for.
 * Requires OPENAI_API_KEY + local recording/ffmpeg. Skips otherwise.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { documentSnapshotForModel } from "../agent-tools";
import { buildSystemPrompt } from "../deep-agent/service";
import { prepareVisualEvidenceForTurn } from "./prepare";
import {
	auditUserFacingSemanticLanguage,
	buildSemanticCoverageMap,
	parseAndValidateVisualSemanticGrounding,
	semanticGroundingEvidenceFromPrepared,
} from "./semantic";

const PROMPT =
	"Check this video and tell me what is visibly happening over time. Read the sampled frames and describe what you see in each important moment. Call out any meaningful visual changes. Also try to make a transcription if possible, and briefly guide me on how I could edit this recording. Do not invent button names you cannot clearly read.";

const VIDEO =
	"/Users/osama/Library/Application Support/openscreen/recordings/recording-1788958840550.mp4";
const DURATION = 4.875;
const FFMPEG = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");
const OUT = path.join(process.cwd(), "tmp/bug4-coverage-validation");
const canRun = Boolean(process.env.OPENAI_API_KEY) && existsSync(VIDEO) && existsSync(FFMPEG);

describe.runIf(canRun)("bug4 coverage: real-video semantic grounding", () => {
	it("covers every attached timestamp; sampled-frame wording; 1 model call", async () => {
		mkdirSync(OUT, { recursive: true });
		const CREATED = "2026-01-01T00:00:00.000Z";
		const base = createEmptyDocument({ title: "Bug4c", projectId: "proj_b4c", createdAt: CREATED });
		const document = documentSchema.parse({
			...base,
			project: { ...base.project, primaryAssetId: "asset_1" },
			assets: [
				{
					id: "asset_1",
					label: "rec",
					kind: "video",
					originalPath: VIDEO,
					durationSec: DURATION,
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
						sourceEndSec: DURATION,
						timelineStartSec: 0,
						timelineEndSec: DURATION,
						wordRefs: [],
						origin: "user",
						reason: "",
					},
				],
				trimRanges: [],
			},
		});

		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-b4c-"));
		const prepared = await prepareVisualEvidenceForTurn({
			document,
			userMessage: PROMPT,
			provider: "openai",
			extractDeps: { cacheDir, ffmpegPath: FFMPEG },
			changeDeps: { ffmpegPath: FFMPEG },
		});
		expect(prepared.visualFramesSupplied).toBe(true);

		const evidence = semanticGroundingEvidenceFromPrepared({
			frames: prepared.prepared!.frames,
			changes: prepared.prepared?.changes,
			durationSec: DURATION,
		});

		const snapshot = documentSnapshotForModel(document, undefined, {
			visualFramesSupplied: true,
		});
		expect(snapshot.mediaCapabilities?.semanticUi).toBe(false);

		const systemPrompt = buildSystemPrompt({ editsAllowed: true, openProject: snapshot });
		const chat = new ChatOpenAI({
			apiKey: process.env.OPENAI_API_KEY,
			model: "gpt-4o",
			temperature: 0,
		});
		const res = await chat.invoke([
			new SystemMessage(
				`${systemPrompt}\n\nDIAGNOSTIC: Do not call tools. Emit complete VISUAL_SEMANTIC_GROUNDING JSON covering EVERY attached timestamp via observations or staticRanges.coveredFrameTimes. Prefer \"Across the sampled frames…\". If transcription is unavailable, say it is unavailable in this runtime. One model call only.`,
			),
			new HumanMessage({ content: prepared.userMessage.content as never }),
		]);
		const text =
			typeof res.content === "string"
				? res.content
				: Array.isArray(res.content)
					? res.content
							.map((c) => (typeof c === "string" ? c : ((c as { text?: string }).text ?? "")))
							.join("")
					: String(res.content ?? "");

		const validated = parseAndValidateVisualSemanticGrounding(text, evidence);
		const coverage = validated.ok ? buildSemanticCoverageMap(validated.grounding!, evidence) : null;
		const langWarnings = auditUserFacingSemanticLanguage(text, evidence);

		const report = {
			modelCallCount: 1,
			durationSec: DURATION,
			attachedTimestamps: evidence.frames.map((f) => f.sourceTimeSec),
			bug3Transitions: evidence.changes,
			refinementFrames: (prepared.prepared?.frames ?? [])
				.filter((f) => f.reason === "change_refinement")
				.map((f) => f.sourceTimeSec),
			validationOk: validated.ok,
			validationErrors: validated.errors,
			coverage,
			langWarnings,
			grounding: validated.grounding,
			assistantText: text,
			timings: prepared.prepared?.timings,
			semanticUi: false,
		};
		writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
		process.stderr.write(`BUG4_COVERAGE ${JSON.stringify(report, null, 2)}\n`);

		expect(validated.ok).toBe(true);
		expect(coverage?.uncovered ?? ["fail"]).toEqual([]);
		expect(/throughout\s+(the\s+)?video\b/i.test(text)).toBe(false);
		expect(/manually transcribe|external tool/i.test(text)).toBe(false);
		// Prefer sampled-frame phrasing when present; allow static-recording honesty.
		expect(/sampled frames|sampled visual|across the sampled/i.test(text)).toBe(true);
	}, 180_000);
});
