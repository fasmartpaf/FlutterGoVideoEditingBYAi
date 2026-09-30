import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../src/lib/ai-edition/schema";
import { documentSchema } from "../../src/lib/ai-edition/schema";
import { executeAgentTool } from "./agent-tools";
import { parseFfmpegProbe } from "./showcase/render";
import { DocumentService } from "./document-service";
import {
	bakeImageClip,
	clampImageClipSec,
	imageClipCanvas,
	imageClipFilter,
	isImageClipPath,
	primaryVideoSize,
	resolveImageClipFit,
} from "./imageClip";

const FFMPEG = ["/usr/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].find((p) => existsSync(p));

function emptyDoc() {
	return createEmptyDocument({ title: "t", projectId: "p", createdAt: "2026-01-01T00:00:00.000Z" });
}

describe("image clips — planning", () => {
	it("knows which files are pictures", () => {
		expect(isImageClipPath("/a/b/Photo.PNG")).toBe(true);
		expect(isImageClipPath("/a/b/x.jpeg")).toBe(true);
		expect(isImageClipPath("/a/b/x.webp")).toBe(true);
		expect(isImageClipPath("/a/b/x.mp4")).toBe(false);
		expect(isImageClipPath("/a/b/x")).toBe(false);
	});

	it("clamps how long a picture shows", () => {
		expect(clampImageClipSec(undefined)).toBe(4);
		expect(clampImageClipSec(0.1)).toBe(0.5);
		expect(clampImageClipSec(500)).toBe(60);
		expect(clampImageClipSec(7.5)).toBe(7.5);
	});

	it("matches the timeline's video, else follows the picture's shape", () => {
		expect(imageClipCanvas({ width: 2560, height: 1440 }, { width: 500, height: 900 })).toEqual({ width: 2560, height: 1440 });
		expect(imageClipCanvas({ width: 1001, height: 563 }, null)).toEqual({ width: 1002, height: 564 });
		expect(imageClipCanvas(null, { width: 690, height: 1536 })).toEqual({ width: 1080, height: 1920 });
		expect(imageClipCanvas(null, { width: 1672, height: 941 })).toEqual({ width: 1920, height: 1080 });
		expect(imageClipCanvas(null, { width: 1000, height: 1000 })).toEqual({ width: 1080, height: 1080 });
		expect(imageClipCanvas(null, null)).toEqual({ width: 1920, height: 1080 });
	});

	it("auto fit fills a same-shape picture and blurs behind a different-shape one", () => {
		const land = { width: 1920, height: 1080 };
		expect(resolveImageClipFit("auto", { width: 1600, height: 900 }, land, true)).toBe("cover");
		expect(resolveImageClipFit("auto", { width: 900, height: 1600 }, land, true)).toBe("blur");
		expect(resolveImageClipFit("auto", { width: 900, height: 1600 }, land, false)).toBe("contain");
		expect(resolveImageClipFit("blur", { width: 900, height: 1600 }, land, false)).toBe("contain");
		expect(resolveImageClipFit("contain", { width: 1600, height: 900 }, land, true)).toBe("contain");
	});

	it("builds a still graph without a move and a 2x zoompan graph with one", () => {
		const still = imageClipFilter({ width: 1080, height: 1920, durationSec: 4, motion: "none", fit: "cover" });
		expect(still).not.toContain("zoompan");
		expect(still).toContain("scale=1080:1920");
		expect(still.endsWith("[v]")).toBe(true);

		const zoom = imageClipFilter({ width: 1080, height: 1920, durationSec: 4, motion: "zoom-in", fit: "cover" });
		expect(zoom).toContain("scale=2160:3840");
		expect(zoom).toContain("zoompan=z='1+0.12*");
		expect(zoom).toContain("on/119");
		expect(zoom).toContain("s=1080x1920");

		const pan = imageClipFilter({ width: 1920, height: 1080, durationSec: 2, motion: "pan-right", fit: "blur" });
		expect(pan).toContain("gblur");
		expect(pan).toContain("x='(iw-iw/zoom)*((1-cos");
		expect(pan).toContain("overlay=(W-w)/2:(H-h)/2");
	});

	it("reads the primary video's size", () => {
		const doc = {
			...emptyDoc(),
			assets: [
				{ id: "a1", kind: "audio", label: "m.mp3", originalPath: "/m.mp3", cameraTrack: null },
				{ id: "v1", kind: "video", label: "r.mp4", originalPath: "/r.mp4", video: { codec: "h264", width: 1280, height: 720, fps: 30 }, cameraTrack: null },
			],
		} as never;
		expect(primaryVideoSize(doc)).toEqual({ width: 1280, height: 720 });
		expect(primaryVideoSize(emptyDoc())).toBeNull();
	});
});

describe.skipIf(!FFMPEG)("image clips — real bake", () => {
	it("turns a portrait picture into a smooth 9:16 clip of the asked length", async () => {
		const dir = mkdtempSync(join(tmpdir(), "imgclip-"));
		const png = join(dir, "panel.png");
		execFileSync(FFMPEG!, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=400x800", "-frames:v", "1", png]);
		const baked = await bakeImageClip({
			ffmpegPath: FFMPEG!,
			imagePath: png,
			durationSec: 1.5,
			motion: "zoom-in",
			fit: "auto",
			primary: null,
			outDir: join(dir, "out"),
		});
		expect(existsSync(baked.mp4Path)).toBe(true);
		expect(baked).toMatchObject({ width: 1080, height: 1920, durationSec: 1.5, motion: "zoom-in", sourcePath: png });
		const probe = spawnSync(FFMPEG!, ["-hide_banner", "-i", baked.mp4Path], { encoding: "utf8" });
		const info = parseFfmpegProbe(probe.stderr);
		expect(info).toMatchObject({ width: 1080, height: 1920, hasAudio: false });
		expect(info!.durationSec).toBeGreaterThan(1.4);
		expect(info!.durationSec).toBeLessThan(1.6);
	}, 60_000);

	it("refuses a file that is not a picture", async () => {
		await expect(
			bakeImageClip({ ffmpegPath: FFMPEG!, imagePath: "/tmp/x.mp4", primary: null, outDir: tmpdir() }),
		).rejects.toThrow(/PNG, JPG or WEBP/);
	});
});

describe("image clips — importMedia", () => {
	it("places a baked picture as a clip that remembers the picture", () => {
		const dir = mkdtempSync(join(tmpdir(), "imgclip-tool-"));
		const png = join(dir, "scene1.png");
		const mp4 = join(dir, "scene1-zoom-in-x.mp4");
		writeFileSync(png, "p");
		writeFileSync(mp4, "v");
		const r = executeAgentTool(emptyDoc(), "importMedia", JSON.stringify({ path: png, durationSec: 5, motion: "zoom-in" }), {
			prepared: {
				imageClip: {
					mp4Path: mp4,
					durationSec: 5,
					width: 1080,
					height: 1920,
					motion: "zoom-in",
					fit: "cover",
					sourcePath: png,
				},
			},
		});
		expect(r.ok).toBe(true);
		const doc = r.document!;
		expect(() => documentSchema.parse(doc)).not.toThrow();
		const asset = doc.assets[0]!;
		expect(asset.originalPath).toBe(mp4);
		expect(asset.label).toBe("scene1.png");
		expect(asset.video).toMatchObject({ width: 1080, height: 1920 });
		expect(asset.still).toEqual({ sourcePath: png, motion: "zoom-in", fit: "cover" });
		expect(doc.project.primaryAssetId).toBe(asset.id);
		expect(doc.timeline.clips).toHaveLength(1);
		expect(doc.timeline.clips[0]!.timelineEndSec - doc.timeline.clips[0]!.timelineStartSec).toBeCloseTo(5, 3);
		expect(JSON.parse(r.resultJson!).note).toMatch(/Picture turned into a 5s clip/);
	});

	it("says so when the picture could not be baked", () => {
		const dir = mkdtempSync(join(tmpdir(), "imgclip-tool-"));
		const png = join(dir, "scene1.png");
		writeFileSync(png, "p");
		const r = executeAgentTool(emptyDoc(), "importMedia", JSON.stringify({ path: png }), {
			prepared: { imageClipError: "boom" },
		});
		expect(r.ok).toBe(false);
		expect(r.error ?? r.summary ?? "").toMatch(/Could not turn the picture into a clip: boom/);
	});
});

describe("image clips — media picker import", () => {
	it("adds a picture as a baked video asset and refuses without a baker", async () => {
		const root = await fs.mkdtemp(join(tmpdir(), "imgclip-docs-"));
		const media = await fs.mkdtemp(join(tmpdir(), "imgclip-media-"));
		const png = join(media, "photo.jpg");
		await fs.writeFile(png, "p");
		const mp4 = join(media, "photo-baked.mp4");
		await fs.writeFile(mp4, "v");
		const granted: string[] = [];
		const service = new DocumentService(
			root,
			media,
			(d) => granted.push(...d.assets.map((a) => a.originalPath)),
			async ({ imagePath, primary }) => {
				expect(primary).toBeNull();
				return { mp4Path: mp4, durationSec: 4, width: 1920, height: 1080, motion: "none", fit: "cover", sourcePath: imagePath };
			},
		);
		const created = await service.createProject("Pics");
		const doc = await service.addAsset(created.project.id, { path: png });
		const asset = doc.assets[0]!;
		expect(asset.kind).toBe("video");
		expect(asset.originalPath).toBe(mp4);
		expect(asset.still?.sourcePath).toBe(png);
		expect(doc.project.primaryAssetId).toBe(asset.id);
		expect(granted).toContain(mp4);

		const plain = new DocumentService(root, media);
		await expect(plain.addAsset(created.project.id, { path: png })).rejects.toThrow(/Pictures can't be imported/);
	});
});
