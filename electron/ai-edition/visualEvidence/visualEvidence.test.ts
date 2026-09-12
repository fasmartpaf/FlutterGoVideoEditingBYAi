import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { documentSnapshotForModel } from "../agent-tools";
import { buildVisualEvidenceUserContent } from "./attach";
import { extractVisualEvidenceFrames, visualFrameCacheKey } from "./extract";
import { matchedVisualIntentFamily, promptWantsVisualEvidence } from "./intent";
import { prepareVisualEvidenceForTurn } from "./prepare";
import { providerSupportsAttachedVisualFrames } from "./providers";
import {
	applyVisualFrameBudget,
	collectVisualEvidenceCandidates,
	interactionInstantsFromSamples,
} from "./sample";
import { INTERACTION_POST_SEC, INTERACTION_PRE_SEC, MAX_VISUAL_FRAMES } from "./types";

const CREATED_AT = "2026-01-01T00:00:00.000Z";

function docWithDuration(
	durationSec: number,
	trims: AxcutDocument["timeline"]["trimRanges"] = [],
): AxcutDocument {
	const base = createEmptyDocument({ title: "V", projectId: "proj_v", createdAt: CREATED_AT });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				label: "Screen",
				kind: "video",
				originalPath: "/tmp/recording.mp4",
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
			trimRanges: trims,
		},
	});
}

describe("promptWantsVisualEvidence", () => {
	it("skips pure timestamp deletes", () => {
		expect(promptWantsVisualEvidence("Delete 10.2 seconds to 13.5 seconds.")).toBe(false);
		expect(promptWantsVisualEvidence("delete 10.2–13.5")).toBe(false);
		expect(promptWantsVisualEvidence("Trim the first two seconds")).toBe(false);
		expect(promptWantsVisualEvidence("Change aspect ratio to 9:16")).toBe(false);
	});

	it("accepts visual / professional / zoom-into-button prompts", () => {
		expect(promptWantsVisualEvidence("Make this look professional")).toBe(true);
		expect(promptWantsVisualEvidence("Zoom into the button when I click Publish")).toBe(true);
		expect(promptWantsVisualEvidence("What do you see on the screen?")).toBe(true);
	});

	it("accepts the real natural/misspelled inspect+frames prompt", () => {
		const prompt =
			"Check a video and let's me know what about it? and make ma transacripton read a each frame ok? and guide me how about it's?";
		expect(promptWantsVisualEvidence(prompt)).toBe(true);
		const family = matchedVisualIntentFamily(prompt);
		expect(family === "inspect-media" || family === "frames" || family === "about-video").toBe(
			true,
		);
	});

	it("accepts common inspect/analyze/frame variants", () => {
		expect(promptWantsVisualEvidence("check the recording please")).toBe(true);
		expect(promptWantsVisualEvidence("analyze this video")).toBe(true);
		expect(promptWantsVisualEvidence("review the footage")).toBe(true);
		expect(promptWantsVisualEvidence("read every frame")).toBe(true);
		expect(promptWantsVisualEvidence("tell me about this video")).toBe(true);
	});
});

describe("providerSupportsAttachedVisualFrames", () => {
	it("F — unsupported providers stay false", () => {
		expect(providerSupportsAttachedVisualFrames("local-cli")).toBe(false);
		expect(providerSupportsAttachedVisualFrames("minimax")).toBe(false);
	});

	it("supported cloud providers", () => {
		expect(providerSupportsAttachedVisualFrames("anthropic")).toBe(true);
		expect(providerSupportsAttachedVisualFrames("openai")).toBe(true);
		expect(providerSupportsAttachedVisualFrames("google")).toBe(true);
		expect(providerSupportsAttachedVisualFrames("openrouter")).toBe(true);
		expect(providerSupportsAttachedVisualFrames("mistral")).toBe(true);
		expect(providerSupportsAttachedVisualFrames("openai-compatible")).toBe(true);
	});
});

describe("collectVisualEvidenceCandidates", () => {
	it("A — 16s recording covers beginning / middle / end", () => {
		const document = docWithDuration(16);
		const candidates = collectVisualEvidenceCandidates({
			document,
			assetId: "asset_1",
			durationSec: 16,
		});
		const times = candidates.map((c) => c.sourceTimeSec);
		expect(Math.min(...times)).toBeLessThanOrEqual(0.001);
		expect(Math.max(...times)).toBeGreaterThanOrEqual(15.5);
		expect(times.some((t) => t >= 7 && t <= 9)).toBe(true);
		expect(candidates.some((c) => c.reason === "clip_boundary")).toBe(true);
		expect(candidates.some((c) => c.reason === "periodic")).toBe(true);
	});

	it("B — cursor click at 10.2s adds pre / at / post", () => {
		const document = docWithDuration(16);
		const candidates = collectVisualEvidenceCandidates({
			document,
			assetId: "asset_1",
			durationSec: 16,
			interactions: [{ sourceTimeSec: 10.2 }],
		});
		const near = (t: number) => candidates.some((c) => Math.abs(c.sourceTimeSec - t) < 0.05);
		expect(near(10.2 - INTERACTION_PRE_SEC)).toBe(true);
		expect(near(10.2)).toBe(true);
		expect(near(10.2 + INTERACTION_POST_SEC)).toBe(true);
	});

	it("C — click near start/end never goes negative or past duration", () => {
		const document = docWithDuration(16);
		const early = collectVisualEvidenceCandidates({
			document,
			assetId: "asset_1",
			durationSec: 16,
			interactions: [{ sourceTimeSec: 0.1 }],
		});
		expect(early.every((c) => c.sourceTimeSec >= 0)).toBe(true);
		const late = collectVisualEvidenceCandidates({
			document,
			assetId: "asset_1",
			durationSec: 16,
			interactions: [{ sourceTimeSec: 15.95 }],
		});
		expect(late.every((c) => c.sourceTimeSec <= 16)).toBe(true);
		expect(late.every((c) => c.sourceTimeSec < 16)).toBe(true);
	});

	it("D — many interactions never exceed MAX_VISUAL_FRAMES", () => {
		const document = docWithDuration(30);
		const interactions = Array.from({ length: 40 }, (_, i) => ({ sourceTimeSec: 0.5 + i * 0.7 }));
		const candidates = applyVisualFrameBudget(
			collectVisualEvidenceCandidates({
				document,
				assetId: "asset_1",
				durationSec: 30,
				interactions,
			}),
		);
		expect(candidates.length).toBeLessThanOrEqual(MAX_VISUAL_FRAMES);
		expect(candidates.some((c) => c.reason.startsWith("cursor_interaction"))).toBe(true);
		const span =
			Math.max(...candidates.map((c) => c.sourceTimeSec)) -
			Math.min(...candidates.map((c) => c.sourceTimeSec));
		expect(span).toBeGreaterThan(10);
	});

	it("H — trimmed source maps virtual time via locateSourcePosition", () => {
		// Clip starts at source 10 with timelineStart 0 → source 12 → virtual 2.
		const base = createEmptyDocument({ title: "T", projectId: "proj_t", createdAt: CREATED_AT });
		const document = documentSchema.parse({
			...base,
			project: { ...base.project, primaryAssetId: "asset_1" },
			assets: [
				{
					id: "asset_1",
					label: "Screen",
					kind: "video",
					originalPath: "/tmp/rec.mp4",
					durationSec: 30,
				},
			],
			timeline: {
				...base.timeline,
				clips: [
					{
						id: "clip_1",
						assetId: "asset_1",
						sourceStartSec: 10,
						sourceEndSec: 30,
						timelineStartSec: 0,
						timelineEndSec: 20,
						wordRefs: [],
						origin: "user",
						reason: "",
					},
				],
				trimRanges: [],
			},
		});
		const candidates = collectVisualEvidenceCandidates({
			document,
			assetId: "asset_1",
			durationSec: 30,
			interactions: [{ sourceTimeSec: 12 }],
		});
		const at = candidates.find((c) => c.reason === "cursor_interaction");
		expect(at?.sourceTimeSec).toBeCloseTo(12, 2);
		expect(at?.virtualTimeSec).toBeCloseTo(2, 2);
	});
});

describe("interactionInstantsFromSamples", () => {
	it("keeps only non-move interactions", () => {
		expect(
			interactionInstantsFromSamples([
				{ timeMs: 1000, interactionType: "move" },
				{ timeMs: 2000, interactionType: "click" },
				{ timeMs: 3000, interactionType: null },
			]),
		).toEqual([{ sourceTimeSec: 2 }]);
	});
});

describe("extractVisualEvidenceFrames cache", () => {
	it("E — second extract reuses cache (mocked extract count)", async () => {
		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-vf-"));
		const videoPath = path.join(cacheDir, "fake.mp4");
		await writeFile(videoPath, "not-a-real-mp4");
		const runExtract = vi.fn(async (args: { outPath: string }) => {
			await writeFile(args.outPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
			return { width: 640, height: 360 };
		});
		const candidates = [
			{
				assetId: "asset_1",
				sourceTimeSec: 1.5,
				virtualTimeSec: 1.5,
				reason: "periodic" as const,
				priority: 10,
			},
		];
		const first = await extractVisualEvidenceFrames(candidates, videoPath, {
			cacheDir,
			runExtract,
		});
		const second = await extractVisualEvidenceFrames(candidates, videoPath, {
			cacheDir,
			runExtract,
		});
		expect(runExtract).toHaveBeenCalledTimes(1);
		expect(first.cacheMisses).toBe(1);
		expect(second.cacheHits).toBe(1);
		expect(second.frames[0]?.imagePath).toBe(first.frames[0]?.imagePath);
		expect(
			visualFrameCacheKey({
				assetId: "asset_1",
				sourcePath: videoPath,
				mtimeMs: 1,
				sourceTimeSec: 1.5,
				maxDim: 1280,
				jpegQuality: 3,
			}),
		).toMatch(/\.jpg$/);
	});
});

describe("prepareVisualEvidenceForTurn capability", () => {
	it("F — unsupported provider never supplies visualFrames", async () => {
		const result = await prepareVisualEvidenceForTurn({
			document: docWithDuration(16),
			userMessage: "What do you see on the screen?",
			provider: "local-cli",
			extractDeps: {
				cacheDir: await mkdtemp(path.join(os.tmpdir(), "os-vf-")),
				runExtract: async ({ outPath }) => {
					await writeFile(outPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
					return { width: 100, height: 100 };
				},
			},
		});
		expect(result.visualFramesSupplied).toBe(false);
		expect(result.userMessage.content).toBe("What do you see on the screen?");
	});

	it("G — supported provider with successful extract sets visualFrames and attaches images", async () => {
		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-vf-"));
		const videoPath = path.join(cacheDir, "clip.mp4");
		await writeFile(videoPath, "mp4");
		const document = documentSchema.parse({
			...docWithDuration(16),
			assets: [
				{
					...docWithDuration(16).assets[0],
					originalPath: videoPath,
				},
			],
		});
		const result = await prepareVisualEvidenceForTurn({
			document,
			userMessage: "What do you see on the screen?",
			provider: "openai",
			extractDeps: {
				cacheDir,
				runExtract: async ({ outPath }) => {
					await writeFile(outPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
					return { width: 320, height: 180 };
				},
			},
		});
		expect(result.visualFramesSupplied).toBe(true);
		expect(result.prepared?.attached).toBe(true);
		expect(Array.isArray(result.userMessage.content)).toBe(true);
		const parts = result.userMessage.content as Array<{
			type: string;
			image_url?: { url: string };
		}>;
		expect(parts.some((p) => p.type === "image_url")).toBe(true);
		expect(
			parts.some((p) => p.type === "image_url" && p.image_url?.url.startsWith("data:image/jpeg")),
		).toBe(true);

		const snapshot = documentSnapshotForModel(document, undefined, {
			visualFramesSupplied: true,
		}) as { mediaCapabilities: { visualFrames: boolean; semanticUi: boolean } };
		expect(snapshot.mediaCapabilities.visualFrames).toBe(true);
		expect(snapshot.mediaCapabilities.semanticUi).toBe(false);
	});

	it("exact production inspect prompt attaches frames on openai when extract works", async () => {
		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-vf-"));
		const videoPath = path.join(cacheDir, "clip.mp4");
		await writeFile(videoPath, "mp4");
		const document = documentSchema.parse({
			...docWithDuration(11.8),
			assets: [
				{
					...docWithDuration(11.8).assets[0],
					originalPath: videoPath,
					durationSec: 11.8,
				},
			],
			timeline: {
				...docWithDuration(11.8).timeline,
				clips: [
					{
						...docWithDuration(11.8).timeline.clips[0],
						sourceEndSec: 11.8,
						timelineEndSec: 11.8,
					},
				],
			},
		});
		const prompt =
			"Check a video and let's me know what about it? and make ma transacripton read a each frame ok? and guide me how about it's?";
		const result = await prepareVisualEvidenceForTurn({
			document,
			userMessage: prompt,
			provider: "openai",
			extractDeps: {
				cacheDir,
				runExtract: async ({ outPath }) => {
					await writeFile(outPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
					return { width: 320, height: 180 };
				},
			},
		});
		expect(promptWantsVisualEvidence(prompt)).toBe(true);
		expect(result.visualFramesSupplied).toBe(true);
		expect(result.prepared?.frames.length).toBeGreaterThan(0);
		const parts = result.userMessage.content as Array<{ type: string }>;
		expect(parts.filter((p) => p.type === "image_url").length).toBeGreaterThan(0);
	});

	it("skips vision for Delete 10.2–13.5 even on openai", async () => {
		const result = await prepareVisualEvidenceForTurn({
			document: docWithDuration(16),
			userMessage: "Delete 10.2 seconds to 13.5 seconds.",
			provider: "openai",
		});
		expect(result.visualFramesSupplied).toBe(false);
		expect(result.prepared).toBeNull();
	});
});

describe("buildVisualEvidenceUserContent", () => {
	it("labels every frame with source/timeline timestamps", async () => {
		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-vf-"));
		const imagePath = path.join(cacheDir, "f.jpg");
		await writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
		const parts = await buildVisualEvidenceUserContent("Improve framing", [
			{
				assetId: "asset_1",
				sourceTimeSec: 3.2,
				virtualTimeSec: 3.2,
				reason: "periodic",
				imagePath,
				mimeType: "image/jpeg",
				width: 1280,
				height: 720,
				byteLength: 4,
			},
		]);
		const text = parts
			.filter((p) => p.type === "text")
			.map((p) => (p as { text: string }).text)
			.join("\n");
		expect(text).toMatch(/source 00:03\.20/);
		expect(text).toMatch(/timeline 00:03\.20/);
		expect(text).toMatch(/NOT every video frame/i);
		expect(text).toContain("Improve framing");
	});
});
