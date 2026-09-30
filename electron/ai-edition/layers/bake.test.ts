import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEmptyDocument, type AxcutDocument, type AxcutLayer } from "../../../src/lib/ai-edition/schema";
import { insertClip } from "../../../src/lib/ai-edition/document/timeline";
import type { FrameSource } from "../motionStudio/render";
import { bakeLayer } from "./bake";

const FFMPEG = ["/usr/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].find((p) => existsSync(p)) ?? null;
// 1×1 transparent PNG
const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
	"base64",
);

function fakeSource(log: { opened: Array<{ path: string; size: { width: number; height: number } }>; frames: number }) {
	return async (): Promise<FrameSource> => ({
		async open(path, size) {
			log.opened.push({ path, size });
		},
		async frame() {
			log.frames += 1;
			return PNG;
		},
		async errors() {
			return [];
		},
		async close() {},
	});
}

function docWithLayer(dir: string, over: Partial<AxcutLayer>): AxcutDocument {
	let doc = createEmptyDocument({ title: "t", projectId: "p", createdAt: "2026-01-01T00:00:00.000Z" });
	doc = {
		...doc,
		assets: [
			{
				id: "asset_v",
				kind: "video",
				label: "rec.mp4",
				originalPath: join(dir, "rec.mp4"),
				durationSec: 10,
				video: { codec: "h264", width: 1920, height: 1080, fps: 30 },
				cameraTrack: null,
			} as AxcutDocument["assets"][number],
		],
		project: { ...doc.project, primaryAssetId: "asset_v" },
	};
	doc = insertClip(doc, "asset_v", 0, "user", "rec");
	const clip = doc.timeline.clips[0]!;
	const layer: AxcutLayer = {
		id: "layer_a",
		layerId: "layer_a",
		startMs: 0,
		endMs: 4000,
		clipId: clip.id,
		sourceStartSec: 0,
		sourceEndSec: 4,
		label: "logo",
		source: { kind: "image", path: join(dir, "logo.png"), startSec: 0 },
		x: -0.2,
		y: 0.2,
		scale: 0.2,
		rotation: -20,
		opacity: 0,
		keyframes: [{ atSec: 1, x: 0.8, rotation: 0, opacity: 1, ease: "ease-out" }],
		animateIn: "none",
		animateOut: "none",
		animateSec: 0.5,
		cornerRadius: 0.2,
		shadow: 0.6,
		borderWidth: 0.004,
		borderColor: "#ffffff",
		zIndex: 0,
		render: null,
		origin: "agent",
		...over,
	};
	return { ...doc, layers: [layer] };
}

describe.skipIf(!FFMPEG)("bakeLayer", () => {
	it("bakes a flying-in picture into a cropped PNG sequence, and reuses it", async () => {
		const dir = mkdtempSync(join(tmpdir(), "layer-bake-"));
		execFileSync(FFMPEG!, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=400x200", "-frames:v", "1", join(dir, "logo.png")]);
		const doc = docWithLayer(dir, {});
		const log = { opened: [] as Array<{ path: string; size: { width: number; height: number } }>, frames: 0 };
		const out = join(dir, "layers");
		const first = await bakeLayer(doc, "layer_a", { ffmpegPath: FFMPEG, createFrameSource: fakeSource(log), outRoot: out });

		expect(first.reused).toBe(false);
		// 1 s animation at 30 fps, then the last frame holds
		expect(first.render.frameCount).toBe(31);
		expect(log.frames).toBe(31);
		const names = readdirSync(first.render.dir).filter((n) => n.startsWith("frame-"));
		expect(names).toHaveLength(31);
		// the picture was probed and remembered
		expect(first.document.layers[0]!.source).toMatchObject({ width: 400, height: 200 });
		// only the band the layer crosses is captured (it flies across near the top)
		expect(first.render.y).toBeLessThan(0.2);
		expect(first.render.h).toBeLessThan(0.45);
		expect(first.render.w).toBeGreaterThan(0.9);
		expect(log.opened[0]!.size.width).toBe(Math.round(first.render.w * 1920));
		const html = readFileSync(join(first.render.dir, "layer.html"), "utf8");
		expect(html).toContain('src="src.png"');
		expect(html).toContain("window.render");

		const again = await bakeLayer(first.document, "layer_a", { ffmpegPath: FFMPEG, createFrameSource: fakeSource(log), outRoot: out });
		expect(again.reused).toBe(true);
		expect(log.frames).toBe(31);

		const moved = { ...first.document, layers: first.document.layers.map((l) => ({ ...l, y: 0.7 })) };
		const rebaked = await bakeLayer(moved, "layer_a", { ffmpegPath: FFMPEG, createFrameSource: fakeSource(log), outRoot: out });
		expect(rebaked.reused).toBe(false);
		expect(rebaked.render.key).not.toBe(first.render.key);
	}, 30_000);

	it("bakes a still layer as one frame and a video layer frame by frame", async () => {
		const dir = mkdtempSync(join(tmpdir(), "layer-bake-"));
		execFileSync(FFMPEG!, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=400x200", "-frames:v", "1", join(dir, "logo.png")]);
		execFileSync(FFMPEG!, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30", "-t", "2", join(dir, "pip.mp4")]);
		const log = { opened: [] as Array<{ path: string; size: { width: number; height: number } }>, frames: 0 };
		const still = await bakeLayer(docWithLayer(dir, { keyframes: [], x: 0.85, y: 0.15, opacity: 1, rotation: 0 }), "layer_a", {
			ffmpegPath: FFMPEG,
			createFrameSource: fakeSource(log),
			outRoot: join(dir, "l"),
		});
		expect(still.render.frameCount).toBe(1);

		const video = await bakeLayer(
			docWithLayer(dir, {
				source: { kind: "video", path: join(dir, "pip.mp4"), startSec: 0 },
				keyframes: [],
				x: 0.8,
				y: 0.8,
				opacity: 1,
				rotation: 0,
				endMs: 1000,
				sourceEndSec: 1,
			}),
			"layer_a",
			{ ffmpegPath: FFMPEG, createFrameSource: fakeSource(log), outRoot: join(dir, "l") },
		);
		expect(video.render.frameCount).toBe(30);
		const html = readFileSync(join(video.render.dir, "layer.html"), "utf8");
		expect(html).toContain("v-00001.jpg");
		// the extracted stills are scratch
		expect(readdirSync(video.render.dir).some((n) => n.endsWith(".jpg"))).toBe(false);
	}, 60_000);

	it("refuses a layer that never shows", async () => {
		const dir = mkdtempSync(join(tmpdir(), "layer-bake-"));
		execFileSync(FFMPEG!, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=40x20", "-frames:v", "1", join(dir, "logo.png")]);
		const doc = docWithLayer(dir, { keyframes: [], opacity: 0 });
		await expect(
			bakeLayer(doc, "layer_a", { ffmpegPath: FFMPEG, createFrameSource: fakeSource({ opened: [], frames: 0 }), outRoot: dir }),
		).rejects.toThrow(/nothing to draw/);
	});

	it("green screen: keys the colour out of a picture and of every video frame", async () => {
		const dir = mkdtempSync(join(tmpdir(), "layer-key-"));
		// a green frame with a red square in the middle
		execFileSync(FFMPEG!, [
			"-v", "error", "-y",
			"-f", "lavfi", "-i", "color=c=0x00ff00:size=200x100:rate=30",
			"-f", "lavfi", "-i", "color=c=red:size=60x60:rate=30",
			"-filter_complex", "[0][1]overlay=70:20", "-frames:v", "1", join(dir, "logo.png"),
		]);
		execFileSync(FFMPEG!, [
			"-v", "error", "-y",
			"-f", "lavfi", "-i", "color=c=0x00ff00:size=200x100:rate=30",
			"-f", "lavfi", "-i", "color=c=red:size=60x60:rate=30",
			"-filter_complex", "[0][1]overlay=70:20", "-t", "1", "-pix_fmt", "yuv420p", join(dir, "pip.mp4"),
		]);
		const key = { color: "#00ff00", similarity: 0.3, blend: 0.05 };
		const log = { opened: [] as Array<{ path: string; size: { width: number; height: number } }>, frames: 0 };
		const pic = await bakeLayer(
			docWithLayer(dir, { keyframes: [], opacity: 1, rotation: 0, x: 0.5, y: 0.5, source: { kind: "image", path: join(dir, "logo.png"), startSec: 0, chromaKey: key } }),
			"layer_a",
			{ ffmpegPath: FFMPEG, createFrameSource: fakeSource(log), outRoot: join(dir, "l") },
		);
		const alpha = (png: string) => {
			// count fully transparent pixels via ffmpeg's alphaextract + signalstats mean
			const r = spawnSync(FFMPEG!, ["-hide_banner", "-i", png, "-vf", "alphaextract,signalstats,metadata=print", "-f", "null", "-"], { encoding: "utf8" });
			return Number(/YAVG=([\d.]+)/.exec(r.stderr)?.[1] ?? 255);
		};
		// mostly transparent (only the red square keeps alpha)
		expect(alpha(join(pic.render.dir, "src.png"))).toBeLessThan(80);

		const vid = await bakeLayer(
			docWithLayer(dir, {
				keyframes: [],
				opacity: 1,
				rotation: 0,
				x: 0.5,
				y: 0.5,
				endMs: 500,
				sourceEndSec: 0.5,
				source: { kind: "video", path: join(dir, "pip.mp4"), startSec: 0, chromaKey: key },
			}),
			"layer_a",
			{ ffmpegPath: FFMPEG, createFrameSource: fakeSource(log), outRoot: join(dir, "l") },
		);
		const html = readFileSync(join(vid.render.dir, "layer.html"), "utf8");
		expect(html).toContain("v-00001.png");
		expect(vid.render.key).not.toBe(pic.render.key);
	}, 60_000);
});
