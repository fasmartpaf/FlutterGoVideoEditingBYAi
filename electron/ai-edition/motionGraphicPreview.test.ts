import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AxcutDocument } from "../../src/lib/ai-edition/schema";
import { executeAgentTool } from "./agent-tools";
import { prepareAgentToolMedia } from "./agentToolMedia";
import { TEST_FFMPEG } from "./testing/ffmpegForTests";

const scratch: string[] = [];
afterEach(() => {
	for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixtureDocument(): AxcutDocument {
	const root = mkdtempSync(join(tmpdir(), "os-motion-test-"));
	scratch.push(root);
	mkdirSync(join(root, "recordings"), { recursive: true });
	return {
		schemaVersion: 1,
		project: {
			id: "proj_motion_test",
			title: "Motion",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			primaryAssetId: "asset_1",
		},
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "rec.mp4",
				originalPath: join(root, "recordings", "rec.mp4"),
				durationSec: 10,
				video: { codec: "unknown", width: 1280, height: 720, fps: 30 },
			},
		],
		timeline: {
			clips: [
				{
					id: "clip_1",
					assetId: "asset_1",
					timelineStartSec: 0,
					timelineEndSec: 10,
					sourceStartSec: 0,
					sourceEndSec: 10,
				},
			],
			gaps: [],
			trimRanges: [],
			muteRanges: [],
			speedRanges: [],
			captionRanges: [],
		},
		annotations: [],
		audioTracks: [],
		zoomRanges: [],
		transcript: null,
		transcripts: {},
		legacyEditor: {},
	} as AxcutDocument;
}

describe("createMotionGraphicPreview", () => {
	it.skipIf(!TEST_FFMPEG)("bakes an MP4 for chat without placing on the timeline", async () => {
		const doc = fixtureDocument();
		const before = doc.annotations.length;
		const args = {
			titles: ["Upwork Job Hunt", "Mobile App Roles", "Save This Tip"],
			holdSec: 1.2,
			fileStem: "test-motion",
		};
		const prep = await prepareAgentToolMedia(doc, "createMotionGraphicPreview", args, {
			ffmpegPath: TEST_FFMPEG,
			mayMutate: false,
		});
		const result = executeAgentTool(doc, "createMotionGraphicPreview", JSON.stringify(args), {
			prepared: prep.prepared,
		});
		expect(result.ok).toBe(true);
		expect(result.document).toBeUndefined();
		expect(doc.annotations.length).toBe(before);
		const payload = JSON.parse(result.resultJson) as {
			videoPath?: string;
			exportedPaths?: string[];
			previewOnly?: boolean;
			slideCount?: number;
		};
		expect(payload.previewOnly).toBe(true);
		expect(payload.slideCount).toBe(3);
		expect(payload.videoPath).toBeTruthy();
		expect(existsSync(payload.videoPath!)).toBe(true);
		expect(payload.exportedPaths?.[0]).toBe(payload.videoPath);
		expect(result.summary).toMatch(/motion graphic preview/i);
		// Written beside the recordings, uniquely named, with no work files left behind.
		const outDir = dirname(payload.videoPath!);
		expect(outDir).toMatch(/generated-graphics/);
		expect(payload.videoPath).toMatch(/test-motion-[a-z0-9]+-[a-z0-9]+\.mp4$/);
		expect(readdirSync(outDir).filter((f) => f.startsWith(".motion-work"))).toEqual([]);
	}, 120_000);

	it.skipIf(!TEST_FFMPEG)("a second preview does not overwrite the first", async () => {
		const doc = fixtureDocument();
		const args = { titles: ["One"], holdSec: 1, fileStem: "same" };
		const a = await prepareAgentToolMedia(doc, "createMotionGraphicPreview", args, {
			ffmpegPath: TEST_FFMPEG,
			mayMutate: false,
		});
		const b = await prepareAgentToolMedia(doc, "createMotionGraphicPreview", args, {
			ffmpegPath: TEST_FFMPEG,
			mayMutate: false,
		});
		expect(a.prepared.motionGraphic?.mp4Path).not.toBe(b.prepared.motionGraphic?.mp4Path);
		expect(existsSync(a.prepared.motionGraphic!.mp4Path)).toBe(true);
		expect(existsSync(b.prepared.motionGraphic!.mp4Path)).toBe(true);
	}, 120_000);
});
