/**
 * Optional live model check for Bug 3 (requires OPENAI_API_KEY).
 * Not required for CI — skips when key missing.
 */
import { existsSync } from "node:fs";
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

const PROMPT =
	"Check a video and let's me know what about it? and make ma transacripton read a each frame ok? and guide me how about it's?";
const VIDEO =
	"/Users/osama/Library/Application Support/openscreen/recordings/recording-1788930909064.mp4";
const DURATION = 11.799979;
const FFMPEG = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");
const canRun = Boolean(process.env.OPENAI_API_KEY) && existsSync(VIDEO) && existsSync(FFMPEG);

describe.runIf(canRun)("bug3 live model temporal response", () => {
	it("uses transition markers for temporally specific visual analysis", async () => {
		const CREATED = "2026-01-01T00:00:00.000Z";
		const base = createEmptyDocument({ title: "Bug3", projectId: "proj_b3", createdAt: CREATED });
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
		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-b3-ai-"));
		const prepared = await prepareVisualEvidenceForTurn({
			document,
			userMessage: PROMPT,
			provider: "openai",
			extractDeps: { cacheDir, ffmpegPath: FFMPEG },
			changeDeps: { ffmpegPath: FFMPEG },
		});
		const parts = Array.isArray(prepared.userMessage.content) ? prepared.userMessage.content : [];
		const textBlob = parts
			.filter((p) => (p as { type: string }).type === "text")
			.map((p) => (p as { text: string }).text)
			.join("\n");
		expect(textBlob).toMatch(/Transition /);
		expect(prepared.prepared?.changes?.some((c) => c.classification === "significant")).toBe(true);

		const snapshot = documentSnapshotForModel(document, undefined, {
			visualFramesSupplied: prepared.visualFramesSupplied,
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
				`${systemPrompt}\n\nDIAGNOSTIC MODE: Do not call tools. Do not attempt Whisper. Use frames and transition markers. Prefer temporally specific visible-state changes. No invented button names.`,
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
		process.stderr.write(`MODEL_RESPONSE_START\n${text}\nMODEL_RESPONSE_END\n`);
		expect(/lack of visual frame evidence/i.test(text)).toBe(false);
	}, 120_000);
});
