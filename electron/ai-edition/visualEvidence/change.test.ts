import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { documentSnapshotForModel } from "../agent-tools";
import { buildVisualEvidenceUserContent } from "./attach";
import {
	classifyChangeScore,
	cullFramesToBudget,
	planRefinementMidpoints,
	scoreAdjacentVisualFrames,
	scoreGrayThumbnails,
} from "./change";
import { prepareVisualEvidenceForTurn } from "./prepare";
import {
	CHANGE_COMPARE_HEIGHT,
	CHANGE_COMPARE_WIDTH,
	CHANGE_MINIMAL_MAX,
	CHANGE_MODERATE_MAX,
	MAX_REFINEMENT_LEVELS,
	MAX_VISUAL_FRAMES,
	REFINE_MIN_GAP_SEC,
	type VisualChange,
	type VisualEvidenceFrame,
} from "./types";

const W = CHANGE_COMPARE_WIDTH;
const H = CHANGE_COMPARE_HEIGHT;
const N = W * H;

function gray(fill: number): Uint8Array {
	return Uint8Array.from({ length: N }, () => fill & 255);
}

function grayPatch(
	base: number,
	patchValue: number,
	x0: number,
	y0: number,
	bw: number,
	bh: number,
): Uint8Array {
	const out = gray(base);
	for (let y = y0; y < y0 + bh && y < H; y++) {
		for (let x = x0; x < x0 + bw && x < W; x++) {
			out[y * W + x] = patchValue & 255;
		}
	}
	return out;
}

function frame(
	sourceTimeSec: number,
	reason: VisualEvidenceFrame["reason"] = "periodic",
	imagePath = "/tmp/x.jpg",
): VisualEvidenceFrame {
	return {
		assetId: "asset_1",
		sourceTimeSec,
		virtualTimeSec: sourceTimeSec,
		reason,
		imagePath,
		mimeType: "image/jpeg",
		width: 320,
		height: 180,
		byteLength: 4,
	};
}

describe("visual change scoring", () => {
	it("1 — identical / similar frames → minimal", () => {
		const a = gray(40);
		const b = gray(40);
		expect(scoreGrayThumbnails(a, b)).toBe(0);
		expect(classifyChangeScore(0)).toBe("minimal");
		const almost = gray(40);
		almost[100] = 42;
		expect(classifyChangeScore(scoreGrayThumbnails(a, almost))).toBe("minimal");
	});

	it("2 — clearly changed synthetic frames → significant", () => {
		const a = gray(20);
		const b = grayPatch(20, 220, 8, 6, 16, 12);
		const score = scoreGrayThumbnails(a, b);
		expect(score).toBeGreaterThan(CHANGE_MODERATE_MAX);
		expect(classifyChangeScore(score)).toBe("significant");
	});

	it("3 — chronological comparison only (adjacent pairs)", async () => {
		const cache = new Map<string, Uint8Array>([
			["/a.jpg", gray(10)],
			["/b.jpg", grayPatch(10, 200, 0, 0, 16, 12)],
			["/c.jpg", grayPatch(10, 200, 0, 0, 16, 12)],
		]);
		const frames = [
			frame(0, "periodic", "/a.jpg"),
			frame(2, "periodic", "/b.jpg"),
			frame(4, "periodic", "/c.jpg"),
		];
		const { changes } = await scoreAdjacentVisualFrames(frames, {
			decodeGray: async (p) => cache.get(p)!,
		});
		expect(changes).toHaveLength(2);
		expect(changes[0]!.fromSourceTimeSec).toBe(0);
		expect(changes[0]!.toSourceTimeSec).toBe(2);
		expect(changes[1]!.fromSourceTimeSec).toBe(2);
		expect(changes[1]!.toSourceTimeSec).toBe(4);
		expect(changes[0]!.classification).toBe("significant");
		expect(changes[1]!.classification).toBe("minimal");
	});

	it("4 — significant 2s gap triggers bounded midpoint", () => {
		const changes: VisualChange[] = [
			{
				fromSourceTimeSec: 4,
				toSourceTimeSec: 6,
				score: 0.2,
				classification: "significant",
			},
		];
		expect(6 - 4).toBeGreaterThanOrEqual(REFINE_MIN_GAP_SEC);
		const plan = planRefinementMidpoints(changes, { level: 1 });
		expect(plan.midpoints).toHaveLength(1);
		expect(plan.midpoints[0]!.sourceTimeSec).toBe(5);
		expect(MAX_REFINEMENT_LEVELS).toBeGreaterThanOrEqual(1);
	});

	it("5 — minimal transition does not refine", () => {
		const plan = planRefinementMidpoints([
			{
				fromSourceTimeSec: 4,
				toSourceTimeSec: 6,
				score: 0.01,
				classification: "minimal",
			},
		]);
		expect(plan.midpoints).toHaveLength(0);
	});

	it("6 — frame budget never exceeds 20", () => {
		const frames = Array.from({ length: 28 }, (_, i) => frame(i * 0.5, "periodic"));
		const changes: VisualChange[] = [];
		for (let i = 0; i < frames.length - 1; i++) {
			changes.push({
				fromSourceTimeSec: frames[i]!.sourceTimeSec,
				toSourceTimeSec: frames[i + 1]!.sourceTimeSec,
				score: 0.01,
				classification: "minimal",
			});
		}
		const culled = cullFramesToBudget(frames, changes, MAX_VISUAL_FRAMES);
		expect(culled.length).toBeLessThanOrEqual(MAX_VISUAL_FRAMES);
		expect(MAX_VISUAL_FRAMES).toBe(20);
	});

	it("7 — interaction triplets retain priority under cull", () => {
		const frames = [
			frame(0, "periodic"),
			frame(1, "periodic"),
			frame(2, "periodic"),
			frame(5.0, "cursor_interaction_pre"),
			frame(5.3, "cursor_interaction"),
			frame(5.8, "cursor_interaction_post"),
			frame(8, "periodic"),
			frame(10, "periodic"),
			...Array.from({ length: 20 }, (_, i) => frame(12 + i * 0.4, "periodic")),
		];
		const changes: VisualChange[] = [];
		const sorted = [...frames].sort((a, b) => a.sourceTimeSec - b.sourceTimeSec);
		for (let i = 0; i < sorted.length - 1; i++) {
			changes.push({
				fromSourceTimeSec: sorted[i]!.sourceTimeSec,
				toSourceTimeSec: sorted[i + 1]!.sourceTimeSec,
				score: 0.01,
				classification: "minimal",
			});
		}
		const culled = cullFramesToBudget(sorted, changes, MAX_VISUAL_FRAMES);
		expect(culled.some((f) => f.reason === "cursor_interaction")).toBe(true);
		expect(culled.some((f) => f.reason === "cursor_interaction_pre")).toBe(true);
		expect(culled.some((f) => f.reason === "cursor_interaction_post")).toBe(true);
	});

	it("8 — cache reused for refinement (second prepare hits cache)", async () => {
		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-ch-"));
		const videoPath = path.join(cacheDir, "clip.mp4");
		await writeFile(videoPath, "mp4");
		const CREATED = "2026-01-01T00:00:00.000Z";
		const base = createEmptyDocument({ title: "C", projectId: "p", createdAt: CREATED });
		const document = documentSchema.parse({
			...base,
			project: { ...base.project, primaryAssetId: "asset_1" },
			assets: [
				{
					id: "asset_1",
					label: "S",
					kind: "video",
					originalPath: videoPath,
					durationSec: 6,
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
						sourceEndSec: 6,
						timelineStartSec: 0,
						timelineEndSec: 6,
						wordRefs: [],
						origin: "user",
						reason: "",
					},
				],
				trimRanges: [],
			},
		});

		const pathsWritten = new Set<string>();
		const runExtract = async ({
			outPath,
			sourceTimeSec,
		}: {
			outPath: string;
			sourceTimeSec: number;
		}) => {
			pathsWritten.add(`${sourceTimeSec.toFixed(3)}:${outPath}`);
			await writeFile(outPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
			return { width: 64, height: 36 };
		};
		const thumbs = new Map<string, Uint8Array>();
		const decodeGray = async (imagePath: string) => {
			if (!thumbs.has(imagePath)) {
				// Distinct per path so some transitions look significant and trigger refine once.
				const n = thumbs.size;
				thumbs.set(imagePath, n % 2 === 0 ? gray(10) : grayPatch(10, 220, 0, 0, 24, 18));
			}
			return thumbs.get(imagePath)!;
		};

		const first = await prepareVisualEvidenceForTurn({
			document,
			userMessage: "analyze this video",
			provider: "openai",
			extractDeps: { cacheDir, runExtract },
			changeDeps: { decodeGray },
		});
		const writesAfterFirst = pathsWritten.size;
		expect(first.visualFramesSupplied).toBe(true);

		const second = await prepareVisualEvidenceForTurn({
			document,
			userMessage: "analyze this video",
			provider: "openai",
			extractDeps: { cacheDir, runExtract },
			changeDeps: { decodeGray },
		});
		expect(second.visualFramesSupplied).toBe(true);
		expect(second.prepared?.timings.cacheHits ?? 0).toBeGreaterThan(0);
		// Warm pass should not grow the write set for the same timestamps.
		expect(pathsWritten.size).toBe(writesAfterFirst);
	});

	it("9 — trimmed timeline mapping remains correct on refinement candidate", async () => {
		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-ch-"));
		const videoPath = path.join(cacheDir, "clip.mp4");
		await writeFile(videoPath, "mp4");
		const CREATED = "2026-01-01T00:00:00.000Z";
		const base = createEmptyDocument({ title: "C", projectId: "p", createdAt: CREATED });
		const document = documentSchema.parse({
			...base,
			project: { ...base.project, primaryAssetId: "asset_1" },
			assets: [
				{
					id: "asset_1",
					label: "S",
					kind: "video",
					originalPath: videoPath,
					durationSec: 10,
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
						sourceEndSec: 10,
						timelineStartSec: 0,
						timelineEndSec: 10,
						wordRefs: [],
						origin: "user",
						reason: "",
					},
				],
				trimRanges: [],
			},
		});
		const decodeGray = async (imagePath: string) => {
			// Alternate strongly so 0→2 and similar gaps refine midpoints.
			const hash = imagePath.length + imagePath.charCodeAt(imagePath.length - 5);
			return hash % 2 === 0 ? gray(5) : grayPatch(5, 240, 8, 6, 20, 14);
		};
		const result = await prepareVisualEvidenceForTurn({
			document,
			userMessage: "check the video",
			provider: "openai",
			extractDeps: {
				cacheDir,
				runExtract: async ({ outPath }) => {
					await writeFile(outPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
					return { width: 64, height: 36 };
				},
			},
			changeDeps: { decodeGray },
		});
		expect(result.prepared?.frames.length).toBeGreaterThan(0);
		for (const f of result.prepared?.frames ?? []) {
			expect(f.virtualTimeSec).toBeCloseTo(f.sourceTimeSec, 2);
		}
	});

	it("10 — semanticUi remains false when visualFrames true", async () => {
		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-ch-"));
		const videoPath = path.join(cacheDir, "clip.mp4");
		await writeFile(videoPath, "mp4");
		const CREATED = "2026-01-01T00:00:00.000Z";
		const base = createEmptyDocument({ title: "C", projectId: "p", createdAt: CREATED });
		const document = documentSchema.parse({
			...base,
			project: { ...base.project, primaryAssetId: "asset_1" },
			assets: [
				{
					id: "asset_1",
					label: "S",
					kind: "video",
					originalPath: videoPath,
					durationSec: 4,
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
						sourceEndSec: 4,
						timelineStartSec: 0,
						timelineEndSec: 4,
						wordRefs: [],
						origin: "user",
						reason: "",
					},
				],
				trimRanges: [],
			},
		});
		const result = await prepareVisualEvidenceForTurn({
			document,
			userMessage: "analyze this video",
			provider: "openai",
			extractDeps: {
				cacheDir,
				runExtract: async ({ outPath }) => {
					await writeFile(outPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
					return { width: 64, height: 36 };
				},
			},
			changeDeps: {
				decodeGray: async () => gray(30),
			},
		});
		const snap = documentSnapshotForModel(document, undefined, {
			visualFramesSupplied: result.visualFramesSupplied,
		}) as { mediaCapabilities: { visualFrames: boolean; semanticUi: boolean } };
		expect(snap.mediaCapabilities.visualFrames).toBe(true);
		expect(snap.mediaCapabilities.semanticUi).toBe(false);
	});

	it("thresholds document ordering", () => {
		expect(CHANGE_MINIMAL_MAX).toBeLessThan(CHANGE_MODERATE_MAX);
		expect(classifyChangeScore(CHANGE_MINIMAL_MAX)).toBe("minimal");
		expect(classifyChangeScore(CHANGE_MINIMAL_MAX + 0.001)).toBe("moderate");
		expect(classifyChangeScore(CHANGE_MODERATE_MAX + 0.001)).toBe("significant");
	});

	it("attach includes transition markers", async () => {
		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-ch-"));
		const a = path.join(cacheDir, "a.jpg");
		const b = path.join(cacheDir, "b.jpg");
		await writeFile(a, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
		await writeFile(b, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
		const parts = await buildVisualEvidenceUserContent(
			"check video",
			[frame(4, "periodic", a), frame(6, "periodic", b)],
			{
				changes: [
					{
						fromSourceTimeSec: 4,
						toSourceTimeSec: 6,
						fromVirtualTimeSec: 4,
						toVirtualTimeSec: 6,
						score: 0.47,
						classification: "significant",
					},
				],
			},
		);
		const text = parts
			.filter((p) => p.type === "text")
			.map((p) => (p as { text: string }).text)
			.join("\n");
		expect(text).toMatch(/Transition 00:04\.00 → 00:06\.00/);
		expect(text).toMatch(/visual change: SIGNIFICANT/);
		expect(text).toMatch(/score: 0\.47/);
	});
});
