/**
 * Runtime validation for the exact production inspect prompt (real ffmpeg + video).
 * Skips when the local recording / ffmpeg binary is absent (CI-safe).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { documentSnapshotForModel } from "../agent-tools";
import { buildSystemPrompt } from "../deep-agent/service";
import { matchedVisualIntentFamily, promptWantsVisualEvidence } from "./intent";
import { prepareVisualEvidenceForTurn } from "./prepare";
import { providerSupportsAttachedVisualFrames } from "./providers";

const PROMPT =
	"Check a video and let's me know what about it? and make ma transacripton read a each frame ok? and guide me how about it's?";

function platformFfmpeg(): string | null {
	const plat =
		process.platform === "darwin"
			? process.arch === "arm64"
				? "darwin-arm64"
				: "darwin-x64"
			: process.platform === "win32"
				? "win32-x64"
				: "linux-x64";
	const name = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
	const p = path.join(process.cwd(), "electron/native/bin", plat, name);
	return existsSync(p) ? p : null;
}

function resolveVideo(): { videoPath: string; durationSec: number } | null {
	const recordingsDir = path.join(
		os.homedir(),
		"Library/Application Support/openscreen/recordings",
	);
	const projectsDir = path.join(os.homedir(), "Library/Application Support/openscreen/projects");
	try {
		const files = readdirSync(projectsDir).filter((f) => f.endsWith(".openscreen"));
		files.sort(
			(a, b) =>
				statSync(path.join(projectsDir, b)).mtimeMs - statSync(path.join(projectsDir, a)).mtimeMs,
		);
		for (const f of files.slice(0, 12)) {
			const raw = JSON.parse(readFileSync(path.join(projectsDir, f), "utf8")) as {
				assets?: Array<{ kind?: string; originalPath?: string; durationSec?: number }>;
			};
			const asset = (raw.assets || []).find((a) => a.kind !== "audio" && a.originalPath);
			if (asset?.originalPath && existsSync(asset.originalPath) && Number(asset.durationSec) > 0) {
				return { videoPath: asset.originalPath, durationSec: Number(asset.durationSec) };
			}
		}
	} catch {
		/* ignore */
	}
	const fallback = path.join(recordingsDir, "recording-1788897181542.mp4");
	if (existsSync(fallback)) return { videoPath: fallback, durationSec: 11.8 };
	return null;
}

const ffmpegPathAtLoad = platformFfmpeg();
const videoAtLoad = resolveVideo();
const canRunRuntime = Boolean(ffmpegPathAtLoad && videoAtLoad);

describe.runIf(canRunRuntime)("runtime intent-fix: exact inspect prompt", () => {
	it("supplies frames and does not claim lack of visual evidence", async () => {
		const ffmpegPath = ffmpegPathAtLoad!;
		const video = videoAtLoad!;

		expect(promptWantsVisualEvidence(PROMPT)).toBe(true);
		expect(matchedVisualIntentFamily(PROMPT)).toBe("inspect-media");
		expect(providerSupportsAttachedVisualFrames("openai")).toBe(true);

		const CREATED = "2026-01-01T00:00:00.000Z";
		const base = createEmptyDocument({
			title: "Validate",
			projectId: "proj_v",
			createdAt: CREATED,
		});
		const { videoPath, durationSec } = video;
		const document = documentSchema.parse({
			...base,
			project: { ...base.project, primaryAssetId: "asset_1" },
			assets: [
				{
					id: "asset_1",
					label: "Screen",
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

		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-intent-fix-"));
		const prepared = await prepareVisualEvidenceForTurn({
			document,
			userMessage: PROMPT,
			provider: "openai",
			extractDeps: { cacheDir, ffmpegPath },
		});

		const parts = Array.isArray(prepared.userMessage.content) ? prepared.userMessage.content : [];
		const imageParts = parts.filter((p) => (p as { type: string }).type === "image_url").length;
		const textParts = parts.filter((p) => (p as { type: string }).type === "text").length;
		const snapshot = documentSnapshotForModel(document, undefined, {
			visualFramesSupplied: prepared.visualFramesSupplied,
		});
		const systemPrompt = buildSystemPrompt({ editsAllowed: true, openProject: snapshot });

		const preInvoke = {
			provider: "openai",
			model: "gpt-4o",
			visualIntent: true,
			matchedFamily: matchedVisualIntentFamily(PROMPT),
			durationSec,
			frameCount: prepared.prepared?.frames.length ?? 0,
			imageParts,
			textParts,
			visualFramesCapability: snapshot.mediaCapabilities?.visualFrames === true,
			visualFramesInSystemSnapshot: /"visualFrames"\s*:\s*true/.test(systemPrompt),
			timings: prepared.prepared?.timings ?? null,
		};
		process.stderr.write(`PRE_INVOKE ${JSON.stringify(preInvoke)}\n`);

		expect(prepared.visualFramesSupplied).toBe(true);
		expect(preInvoke.frameCount).toBeGreaterThan(0);
		expect(imageParts).toBeGreaterThan(0);
		expect(preInvoke.visualFramesCapability).toBe(true);
		expect(preInvoke.visualFramesInSystemSnapshot).toBe(true);

		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) {
			process.stderr.write("MODEL_CALL skipped: OPENAI_API_KEY unset (frame path PASS)\n");
			return;
		}

		const chat = new ChatOpenAI({ apiKey, model: "gpt-4o", temperature: 0 });
		const res = await chat.invoke([
			new SystemMessage(
				`${systemPrompt}\n\nDIAGNOSTIC MODE: Do not call tools. Do not attempt transcription. Describe only what is visible in the supplied timestamped frames. Say clearly that frames are a representative sample, not every FPS frame. If the user asked for transcription, note it requires Whisper and is unavailable separately.`,
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
		process.stderr.write("MODEL_RESPONSE_START\n");
		process.stderr.write(`${text}\n`);
		process.stderr.write("MODEL_RESPONSE_END\n");
		expect(/lack of visual frame evidence/i.test(text)).toBe(false);
	}, 90_000);
});
