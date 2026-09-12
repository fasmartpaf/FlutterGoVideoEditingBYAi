import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { resolveFfmpeg } from "../../media/audioPeaks";
import { promptWantsVisualEvidence } from "./intent";
import { prepareVisualEvidenceForTurn } from "./prepare";

const REC =
	process.env.HOME +
	"/Library/Application Support/openscreen/recordings/recording-1788897181542.mp4";

const runSmoke = process.env.OPENSCREEN_SMOKE_VISUAL === "1" && existsSync(REC);

describe.runIf(runSmoke)("smoke: real recording visual evidence", () => {
	it("extracts timestamped JPEGs, attaches them, and cache-hits on second pass", async () => {
		const ffmpeg = resolveFfmpeg();
		expect(ffmpeg).toBeTruthy();

		expect(promptWantsVisualEvidence("Delete 10.2 seconds to 13.5 seconds.")).toBe(false);
		expect(promptWantsVisualEvidence("What do you see on the screen?")).toBe(true);

		const cursor = JSON.parse(readFileSync(REC + ".cursor.json", "utf8"));
		const samples = cursor.samples ?? [];
		expect(samples.length).toBeGreaterThan(0);

		const CREATED = "2026-01-01T00:00:00.000Z";
		const base = createEmptyDocument({
			title: "Smoke",
			projectId: "proj_smoke",
			createdAt: CREATED,
		});
		const durationSec = 16.35;
		const document = documentSchema.parse({
			...base,
			project: { ...base.project, primaryAssetId: "asset_1" },
			assets: [
				{
					id: "asset_1",
					label: "Screen",
					kind: "video",
					originalPath: REC,
					durationSec,
					width: 3024,
					height: 1964,
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

		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-vf-smoke-"));
		const cursorReader = {
			async read() {
				return { status: "ok" as const, assetId: "asset_1", samples };
			},
		};

		const t0 = Date.now();
		const first = await prepareVisualEvidenceForTurn({
			document,
			userMessage: "What do you see on the screen? Zoom around where I click.",
			provider: "openai",
			cursor: cursorReader,
			extractDeps: { cacheDir, ffmpegPath: ffmpeg },
		});
		const firstMs = Date.now() - t0;

		const t1 = Date.now();
		const second = await prepareVisualEvidenceForTurn({
			document,
			userMessage: "What do you see on the screen?",
			provider: "openai",
			cursor: cursorReader,
			extractDeps: { cacheDir, ffmpegPath: ffmpeg },
		});
		const secondMs = Date.now() - t1;

		expect(first.visualFramesSupplied).toBe(true);
		expect(first.prepared?.attached).toBe(true);
		expect(first.prepared!.frames.length).toBeGreaterThan(5);
		expect(first.prepared!.frames.length).toBeLessThanOrEqual(20);
		expect(first.prepared!.timings.cacheMisses).toBeGreaterThan(0);

		expect(second.visualFramesSupplied).toBe(true);
		expect(second.prepared!.timings.cacheHits).toBe(second.prepared!.frames.length);
		expect(second.prepared!.timings.cacheMisses).toBe(0);
		expect(secondMs).toBeLessThan(firstMs);

		const frame0 = first.prepared!.frames[0]!;
		const buf = await readFile(frame0.imagePath);
		expect(buf[0]).toBe(0xff);
		expect(buf[1]).toBe(0xd8);
		expect(Math.max(frame0.width, frame0.height)).toBeLessThanOrEqual(1280);

		const parts = first.userMessage.content as Array<{ type: string; text?: string }>;
		const text = parts
			.filter((p) => p.type === "text")
			.map((p) => p.text ?? "")
			.join("\n");
		expect(text).toMatch(/source 00:00\.00/);
		expect(text).toMatch(/cursor interaction/);
		expect(parts.some((p) => p.type === "image_url")).toBe(true);

		console.log(
			"[smoke-visual]",
			JSON.stringify({
				frameCount: first.prepared!.frames.length,
				firstMs,
				secondMs,
				timings1: first.prepared!.timings,
				timings2: second.prepared!.timings,
				dims0: `${frame0.width}x${frame0.height}`,
				bytes0: frame0.byteLength,
			}),
		);
	}, 120_000);
});
