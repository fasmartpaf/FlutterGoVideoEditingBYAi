/**
 * Bug 4 real-video semantic grounding (same turn as vision).
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
	parseAndValidateVisualSemanticGrounding,
	semanticGroundingEvidenceFromPrepared,
} from "./semantic";

const PROMPT =
	"Check a video and let's me know what about it? and make ma transacripton read a each frame ok? and guide me how about it's?";
const VIDEO =
	"/Users/osama/Library/Application Support/openscreen/recordings/recording-1788930909064.mp4";
const DURATION = 11.799979;
const FFMPEG = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");
const OUT = path.join(process.cwd(), "tmp/bug4-validation");
const canRun = Boolean(process.env.OPENAI_API_KEY) && existsSync(VIDEO) && existsSync(FFMPEG);

describe.runIf(canRun)("bug4: real-video semantic grounding (1 model call)", () => {
	it("returns validated turn-local observations without semanticUi", async () => {
		mkdirSync(OUT, { recursive: true });
		const CREATED = "2026-01-01T00:00:00.000Z";
		const base = createEmptyDocument({ title: "Bug4", projectId: "proj_b4", createdAt: CREATED });
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

		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-b4-"));
		const prepStarted = Date.now();
		const prepared = await prepareVisualEvidenceForTurn({
			document,
			userMessage: PROMPT,
			provider: "openai",
			extractDeps: { cacheDir, ffmpegPath: FFMPEG },
			changeDeps: { ffmpegPath: FFMPEG },
		});
		const prepMs = Date.now() - prepStarted;

		expect(prepared.visualFramesSupplied).toBe(true);
		const snapshot = documentSnapshotForModel(document, undefined, {
			visualFramesSupplied: true,
		});
		expect(snapshot.mediaCapabilities?.semanticUi).toBe(false);
		expect(snapshot.mediaCapabilities?.visualSemanticEvidence).toBe(true);

		const systemPrompt = buildSystemPrompt({ editsAllowed: true, openProject: snapshot });
		const modelStarted = Date.now();
		const chat = new ChatOpenAI({
			apiKey: process.env.OPENAI_API_KEY,
			model: "gpt-4o",
			temperature: 0,
		});
		// Exactly one model invocation for grounding + answer.
		const res = await chat.invoke([
			new SystemMessage(
				`${systemPrompt}\n\nDIAGNOSTIC: Do not call tools. Do not use Whisper. Emit VISUAL_SEMANTIC_GROUNDING JSON then a short user-facing summary. Model call count must stay 1.`,
			),
			new HumanMessage({ content: prepared.userMessage.content as never }),
		]);
		const modelMs = Date.now() - modelStarted;
		const text =
			typeof res.content === "string"
				? res.content
				: Array.isArray(res.content)
					? res.content
							.map((c) => (typeof c === "string" ? c : ((c as { text?: string }).text ?? "")))
							.join("")
					: String(res.content ?? "");

		const validated = parseAndValidateVisualSemanticGrounding(
			text,
			semanticGroundingEvidenceFromPrepared({
				frames: prepared.prepared!.frames,
				changes: prepared.prepared?.changes,
				durationSec: DURATION,
			}),
		);

		const usage = (res as { usage_metadata?: { input_tokens?: number; output_tokens?: number } })
			.usage_metadata;

		const report = {
			modelCallCount: 1,
			prepMs,
			modelMs,
			semanticGroundingPreparationMs:
				prepared.prepared?.timings.semanticGroundingPreparationMs ?? null,
			semanticGroundingPromptChars: prepared.prepared?.timings.semanticGroundingPromptChars ?? null,
			usage,
			validationOk: validated.ok,
			validationErrors: validated.errors,
			observations: validated.grounding?.observations ?? [],
			transitions: validated.grounding?.transitions ?? [],
			staticRanges: validated.grounding?.staticRanges ?? [],
			semanticUi: false,
			visualSemanticEvidence: true,
			assistantExcerpt: text.slice(0, 2500),
		};
		writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
		process.stderr.write(`BUG4_REPORT ${JSON.stringify(report, null, 2)}\n`);

		expect(validated.ok).toBe(true);
		expect(validated.grounding?.observations.length).toBeGreaterThan(0);
		expect(/Publish|clicked the Save/i.test(JSON.stringify(validated.grounding))).toBe(false);
	}, 180_000);
});
