import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyDocument, type AxcutDocument } from "../../src/lib/ai-edition/schema";
import { insertClip } from "../../src/lib/ai-edition/document/timeline";
import { executeAgentTool } from "./agent-tools";
import { prepareAgentToolMedia } from "./agentToolMedia";
import { bakeStillToMp4, canvasSizeFromDocument, insertStartThumbnailClip } from "./startThumbnail";
import { TEST_FFMPEG } from "./testing/ffmpegForTests";

const ffmpeg = TEST_FFMPEG;
const scratch: string[] = [];

afterEach(() => {
	for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fake recording path inside a throwaway …/recordings folder, so generated
 *  media lands in that temp tree (and is cleaned up) — never in a real folder. */
function recordingPath(): string {
	const root = mkdtempSync(join(tmpdir(), "os-thumb-test-"));
	scratch.push(root);
	mkdirSync(join(root, "recordings"), { recursive: true });
	return join(root, "recordings", "recording.mp4");
}

/** Same path the agent takes: async media step, then the synchronous executor. */
async function runMediaTool(doc: AxcutDocument, name: string, args: Record<string, unknown>) {
	const prep = await prepareAgentToolMedia(doc, name, args, { ffmpegPath: ffmpeg, mayMutate: true });
	return executeAgentTool(doc, name, JSON.stringify(prep.args), { prepared: prep.prepared });
}

function tinyPngDataUri(): string {
	// 1×1 PNG
	const b64 =
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
	return `data:image/png;base64,${b64}`;
}

function fixtureDoc(id: string): AxcutDocument {
	return createEmptyDocument({
		title: "Test",
		projectId: id,
		createdAt: "2026-01-01T00:00:00.000Z",
	});
}

describe("startThumbnail", () => {
	it("reads canvas size from the primary video asset", () => {
		let doc = fixtureDoc("proj_thumb");
		doc = {
			...doc,
			assets: [
				{
					id: "asset_v",
					kind: "video",
					label: "take.mp4",
					originalPath: "/tmp/take.mp4",
					durationSec: 10,
					video: { codec: "unknown", width: 1280, height: 720, fps: 30 },
					cameraTrack: null,
				},
			],
			project: { ...doc.project, primaryAssetId: "asset_v" },
		};
		expect(canvasSizeFromDocument(doc)).toEqual({ width: 1280, height: 720 });
	});

	it.skipIf(!ffmpeg)("bakes a still to mp4 and inserts it before the recording clip", async () => {

		let doc = fixtureDoc("proj_thumb2");
		doc = {
			...doc,
			assets: [
				{
					id: "asset_rec",
					kind: "video",
					label: "recording.mp4",
					originalPath: "/tmp/recording.mp4",
					durationSec: 10,
					video: { codec: "unknown", width: 640, height: 360, fps: 30 },
					cameraTrack: null,
				},
			],
			project: { ...doc.project, primaryAssetId: "asset_rec" },
			annotations: [
				{
					id: "ann_cover",
					type: "image",
					content: tinyPngDataUri(),
					textContent: "cover",
					imageContent: tinyPngDataUri(),
					position: { x: 4, y: 6 },
					size: { width: 92, height: 88 },
					style: {
						color: "#fff",
						backgroundColor: "transparent",
						fontSize: 22,
						fontFamily: "Inter",
						fontWeight: "bold",
						fontStyle: "normal",
						textDecoration: "none",
						textAlign: "center",
						textAnimation: "none",
					},
					zIndex: 1,
					startMs: 0,
					endMs: 2500,
				},
			],
		};
		doc = insertClip(doc, "asset_rec", 0, "user", "Recording");

		const dir = mkdtempSync(join(tmpdir(), "os-thumb-test-"));
		scratch.push(dir);
		const pngPath = join(dir, "plate.png");
		writeFileSync(
			pngPath,
			Buffer.from(tinyPngDataUri().replace(/^data:image\/png;base64,/, ""), "base64"),
		);
		const baked = await bakeStillToMp4({
			ffmpegPath: ffmpeg!,
			image: pngPath,
			width: 640,
			height: 360,
			durationSec: 2,
			outDir: dir,
		});
		expect(existsSync(baked.mp4Path)).toBe(true);

		const placed = insertStartThumbnailClip(doc, {
			mp4Path: baked.mp4Path,
			durationSec: baked.durationSec,
			label: "Start thumbnail",
		});
		expect(placed.document.timeline.clips).toHaveLength(2);
		expect(placed.document.timeline.clips[0]?.assetId).toBe(placed.assetId);
		expect(placed.document.timeline.clips[0]?.timelineStartSec).toBe(0);
		expect(placed.document.timeline.clips[1]?.assetId).toBe("asset_rec");
		expect(placed.document.timeline.clips[1]?.timelineStartSec).toBeCloseTo(2, 1);
		expect(placed.removedAnnotationIds).toContain("ann_cover");
		expect(placed.document.annotations.find((a) => a.id === "ann_cover")).toBeUndefined();
	}, 60_000);

	it.skipIf(!ffmpeg)("insertStartThumbnail agent tool places a start clip from text", async () => {

		let doc = fixtureDoc("proj_thumb3");
		doc = {
			...doc,
			assets: [
				{
					id: "asset_rec",
					kind: "video",
					label: "recording.mp4",
					originalPath: recordingPath(),
					durationSec: 8,
					video: { codec: "unknown", width: 640, height: 360, fps: 30 },
					cameraTrack: null,
				},
			],
			project: { ...doc.project, primaryAssetId: "asset_rec" },
		};
		doc = insertClip(doc, "asset_rec", 0, "user", "Recording");

		const result = await runMediaTool(doc, "insertStartThumbnail", {
			text: "Opening",
			subtext: "Demo",
			durationSec: 1.5,
		});
		expect(result.ok).toBe(true);
		// Saved beside the project's recordings, not in the OS temp dir.
		const clip0 = result.document!.timeline.clips[0]!;
		const asset = result.document!.assets.find((a) => a.id === clip0.assetId)!;
		expect(asset.originalPath).toMatch(/generated-graphics/);
		expect(existsSync(asset.originalPath!)).toBe(true);
		expect(result.document?.timeline.clips).toHaveLength(2);
		expect(result.document?.timeline.clips[0]?.timelineStartSec).toBe(0);
		expect(result.document?.timeline.clips[1]?.assetId).toBe("asset_rec");
		expect(result.summary).toMatch(/start thumbnail/i);
	}, 60_000);

	it.skipIf(!ffmpeg)("refuses a second start thumbnail unless replace:true", async () => {

		let doc = fixtureDoc("proj_thumb_dup");
		doc = {
			...doc,
			assets: [
				{
					id: "asset_rec",
					kind: "video",
					label: "recording.mp4",
					originalPath: recordingPath(),
					durationSec: 8,
					video: { codec: "unknown", width: 640, height: 360, fps: 30 },
					cameraTrack: null,
				},
			],
			project: { ...doc.project, primaryAssetId: "asset_rec" },
		};
		doc = insertClip(doc, "asset_rec", 0, "user", "Recording");
		const first = await runMediaTool(doc, "insertStartThumbnail", { text: "Cover A", durationSec: 1.2 });
		expect(first.ok).toBe(true);
		const withThumb = first.document!;
		expect(withThumb.timeline.clips).toHaveLength(2);

		const blocked = await runMediaTool(withThumb, "insertStartThumbnail", {
			text: "Cover B",
			durationSec: 1.2,
		});
		expect(blocked.ok).toBe(false);
		expect(JSON.parse(blocked.resultJson).error).toMatch(/already exists/i);
		expect(withThumb.timeline.clips).toHaveLength(2);

		const replaced = await runMediaTool(withThumb, "insertStartThumbnail", {
			text: "Cover B",
			durationSec: 1.2,
			replace: true,
		});
		expect(replaced.ok).toBe(true);
		expect(replaced.document?.timeline.clips).toHaveLength(2);
		expect(replaced.summary).toMatch(/replaced/i);
	}, 60_000);

	it("refuses to render synchronously when called without the async media step", () => {
		let doc = fixtureDoc("proj_thumb_sync");
		doc = insertClip(
			{
				...doc,
				assets: [
					{
						id: "asset_rec",
						kind: "video",
						label: "recording.mp4",
						originalPath: "/tmp/recording.mp4",
						durationSec: 8,
						video: { codec: "unknown", width: 640, height: 360, fps: 30 },
						cameraTrack: null,
					},
				],
				project: { ...doc.project, primaryAssetId: "asset_rec" },
			},
			"asset_rec",
			0,
			"user",
			"Recording",
		);
		const result = executeAgentTool(doc, "insertStartThumbnail", JSON.stringify({ text: "Opening" }));
		expect(result.ok).toBe(false);
		expect(result.document).toBeUndefined();
	});

	it.skipIf(!ffmpeg)("Stop aborts a render in progress", async () => {
		const controller = new AbortController();
		controller.abort();
		const doc = fixtureDoc("proj_thumb_abort");
		await expect(
			prepareAgentToolMedia(doc, "insertStartThumbnail", { text: "Opening" }, {
				ffmpegPath: ffmpeg,
				mayMutate: true,
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
	});
});
