import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../src/lib/ai-edition/schema";
import { insertClip } from "../../../src/lib/ai-edition/document/timeline";
import { getEditorSettings, patchEditorSettings } from "../../../src/lib/ai-edition/store/editorSettings";
import { brandKitSchema } from "../motionStudio/brandKit";
import { SHOWCASE_REQUEST, isWholeVideoRequest, requestToolScope } from "../stagedEdit";
import {
	atempoChain,
	buildFootageFilter,
	buildSegments,
	footageDuration,
	mapTime,
	resolveCrop,
	resolveTimeline,
	showcaseArgsSchema,
} from "./plan";
import { placeShowcase } from "./placement";
import { parseFfmpegProbe, showcaseOutputSize } from "./render";
import { renderShowcasePage, showcaseTiming } from "./template";

describe("showcase timing", () => {
	it("splits the trim into constant-rate segments and maps source time to footage time", () => {
		const segs = buildSegments(0, 14.8, [{ startSec: 2.5, endSec: 8, rate: 2 }]);
		expect(segs.map((s) => [s.srcStart, s.srcEnd, s.rate])).toEqual([
			[0, 2.5, 1],
			[2.5, 8, 2],
			[8, 14.8, 1],
		]);
		expect(footageDuration(segs)).toBeCloseTo(2.5 + 2.75 + 6.8);
		expect(mapTime(segs, 1)).toBeCloseTo(1);
		expect(mapTime(segs, 5)).toBeCloseTo(3.75);
		expect(mapTime(segs, 10)).toBeCloseTo(7.25);
		expect(mapTime(segs, 99)).toBeCloseTo(12.05);
	});

	it("clips speed ranges to the trim and resolves overlaps", () => {
		const segs = buildSegments(1, 10, [
			{ startSec: 0, endSec: 3, rate: 2 },
			{ startSec: 2, endSec: 5, rate: 4 },
			{ startSec: 9.95, endSec: 12, rate: 3 },
		]);
		expect(segs.map((s) => [s.srcStart, s.srcEnd, s.rate])).toEqual([
			[1, 3, 2],
			[3, 5, 4],
			[5, 10, 1],
		]);
	});

	it("chains atempo for rates above 2", () => {
		expect(atempoChain(1.5)).toBe("atempo=1.5000");
		expect(atempoChain(5)).toBe("atempo=2,atempo=2,atempo=1.2500");
	});

	it("builds one filter graph for video and audio", () => {
		const segs = buildSegments(0, 10, [{ startSec: 2, endSec: 6, rate: 2 }]);
		const f = buildFootageFilter({ segments: segs, crop: { x: 300, y: 0, width: 1480, height: 1080 }, fps: 60, enhance: true, audio: true });
		expect(f).toContain("crop=1480:1080:300:0");
		expect(f).toContain("unsharp");
		expect(f).toContain("concat=n=3:v=1:a=1[vc][a]");
		expect(f).toContain("atempo=2.0000");
		expect(f.endsWith("[v]")).toBe(true);
	});

	it("resolves a crop in even source pixels", () => {
		expect(resolveCrop({ x: 300 / 1920, y: 0, width: 1480 / 1920, height: 1 }, { width: 1920, height: 1080 })).toEqual({
			x: 300,
			y: 0,
			width: 1480,
			height: 1080,
		});
		expect(resolveCrop(undefined, { width: 3025, height: 1759 })).toEqual({ x: 0, y: 0, width: 3024, height: 1758 });
	});
});

describe("showcase timeline", () => {
	const segs = buildSegments(0, 14.8, [{ startSec: 2.5, endSec: 8, rate: 2 }]);
	const crop = { x: 300, y: 0, width: 1480, height: 1080 };
	const src = { width: 1920, height: 1080 };

	it("maps steps, highlights, checks and clicks into footage time and crop pixels", () => {
		const tl = resolveTimeline(
			{
				steps: [
					{ startSec: 0.2, endSec: 2.5, title: "The brief" },
					{ startSec: 10.3, endSec: 14.6, title: "tasks planned", count: 5 },
				],
				highlights: [{ startSec: 8.45, endSec: 10.1, x: 0.184, y: 0.513, width: 0.206, height: 0.052 }],
				checks: [{ atSec: 11.2, x: 0.189, y: 0.6 }],
				clicks: [{ atSec: 2.22, x: 0.358, y: 0.364 }, { atSec: 3, x: 0.01, y: 0.5 }],
			},
			segs,
			crop,
			src,
		);
		expect(tl.steps[0]).toMatchObject({ kicker: "Step 1", accent: "brief" });
		expect(tl.steps[1]!.in).toBeCloseTo(7.55);
		expect(tl.steps[1]!.count).toBe(5);
		expect(tl.highlights[0]!.x).toBeCloseTo(0.184 * 1920 - 300);
		expect(tl.checks[0]!.at).toBeCloseTo(8.45);
		// The second click is left of the crop: dropped.
		expect(tl.clicks).toHaveLength(1);
	});

	it("eases the camera into each focus and back out", () => {
		const tl = resolveTimeline({ focus: [{ startSec: 1.4, endSec: 2.35, x: 0.52, y: 0.57, zoom: 1.2 }] }, segs, crop, src);
		const zooms = tl.camera.map((k) => k[1]);
		expect(zooms[0]).toBe(1);
		expect(Math.max(...zooms)).toBe(1.2);
		expect(tl.camera[tl.camera.length - 1]![1]).toBe(1);
		for (let i = 1; i < tl.camera.length; i++) expect(tl.camera[i]![0]).toBeGreaterThanOrEqual(tl.camera[i - 1]![0]);
	});

	it("keeps step cards from overlapping", () => {
		const tl = resolveTimeline(
			{
				steps: [
					{ startSec: 0, endSec: 5, title: "One" },
					{ startSec: 3, endSec: 9, title: "Two" },
				],
			},
			buildSegments(0, 10),
			{ x: 0, y: 0, width: 1920, height: 1080 },
			src,
		);
		expect(tl.steps[0]!.out).toBeLessThanOrEqual(tl.steps[1]!.in);
	});
});

describe("showcase page", () => {
	const kit = brandKitSchema.parse({ name: "FlutterGo.ai", primary: "#1E9BE8", secondary: "#4FC5FC" });
	const timeline = resolveTimeline(
		{ steps: [{ startSec: 0.5, endSec: 3, title: "A clear <answer>", body: "x & y" }] },
		buildSegments(0, 6),
		{ x: 0, y: 0, width: 1480, height: 1080 },
		{ width: 1480, height: 1080 },
	);
	const page = (over: Partial<Parameters<typeof renderShowcasePage>[0]> = {}) =>
		renderShowcasePage({
			width: 1920,
			height: 1080,
			fps: 60,
			frameCount: 360,
			frameDigits: 5,
			timeline,
			kit,
			name: "FlutterGo.ai",
			logoFile: "logo.png",
			intro: true,
			outro: true,
			tagline: "From brief to build plan.",
			url: "fluttergo.ai",
			tags: ["Dart", "iOS"],
			theme: "dark",
			...over,
		});

	it("draws the brand, escapes text and drives everything from window.render", () => {
		const html = page();
		expect(html).toContain("window.render=async");
		expect(html).toContain('src="f/00000.jpg"');
		expect(html).toContain("FlutterGo<span>.ai</span>");
		expect(html).toContain("A clear <em>&lt;answer&gt;</em>");
		expect(html).toContain("x &amp; y");
		expect(html).toContain('<img class="lg" src="logo.png"');
		expect(html).not.toMatch(/https?:\/\/(?!rsms)/);
	});

	it("draws a monogram when there is no logo, and a light theme", () => {
		const html = page({ logoFile: null, theme: "light" });
		expect(html).toContain('class="lg mono">FG<');
		expect(html).toContain("#f4f7fb");
	});

	it("adds the intro and outro to the length", () => {
		expect(showcaseTiming(10, true, true)).toEqual({ footageStart: 1.45, totalSec: 1.45 + 10 + 2.1 });
		expect(showcaseTiming(10, false, false).totalSec).toBeCloseTo(0.9 + 10 + 0.5);
	});
});

describe("showcase plumbing", () => {
	it("reads size, length and audio from ffmpeg -i", () => {
		const stderr = `Input #0, mov,mp4
  Duration: 00:00:14.80, start: 0.000000, bitrate: 2000 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080, 1800 kb/s, 60 fps
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s`;
		expect(parseFfmpegProbe(stderr)).toEqual({ width: 1920, height: 1080, durationSec: 14.8, hasAudio: true });
		expect(parseFfmpegProbe("nothing")).toBeNull();
	});

	it("follows the project's aspect ratio for the output size", () => {
		let doc = createEmptyDocument({ title: "t", projectId: "p", createdAt: "2026-01-01T00:00:00.000Z" });
		expect(showcaseOutputSize(doc)).toEqual({ width: 1920, height: 1080 });
		doc = patchEditorSettings(doc, { aspectRatio: "9:16" });
		expect(showcaseOutputSize(doc)).toEqual({ width: 1080, height: 1920 });
	});

	it("parses the agent's args with safe defaults", () => {
		const a = showcaseArgsSchema.parse({});
		expect(a).toMatchObject({ place: "replace", fps: 60, theme: "dark", enhance: true, keepAudio: true });
		expect(showcaseArgsSchema.safeParse({ speed: [{ startSec: 1, endSec: 2, rate: 20 }] }).success).toBe(false);
	});

	it("routes 'make it look premium' to the showcase, not the staged edit", () => {
		for (const m of [
			"convert this video into a better look",
			"make my screen recording look amazing with motion graphics into it",
			"make this video look premium",
			"turn it into a branded showcase",
		]) {
			expect(SHOWCASE_REQUEST.test(m)).toBe(true);
			expect(isWholeVideoRequest(m)).toBe(false);
			expect(requestToolScope(m)).toContain("createShowcaseVideo");
		}
		expect(isWholeVideoRequest("make a 60 second product demo video")).toBe(true);
	});
});

describe("placing a showcase", () => {
	it("replace makes it the whole programme with a full-bleed look", async () => {
		const { mkdtempSync, writeFileSync } = await import("node:fs");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const dir = mkdtempSync(join(tmpdir(), "showcase-place-"));
		const mp4 = join(dir, "s.mp4");
		writeFileSync(mp4, "x");
		let doc = createEmptyDocument({ title: "t", projectId: "p", createdAt: "2026-01-01T00:00:00.000Z" });
		doc = {
			...doc,
			assets: [
				{ id: "asset_rec", kind: "video", label: "rec.mp4", originalPath: join(dir, "rec.mp4"), durationSec: 10, cameraTrack: null } as (typeof doc.assets)[number],
			],
			project: { ...doc.project, primaryAssetId: "asset_rec" },
		};
		doc = insertClip(doc, "asset_rec", 0, "user", "Recording");
		const placed = placeShowcase(doc, { mp4Path: mp4, durationSec: 12, label: "Showcase" }, "replace");
		expect(placed.document.timeline.clips).toHaveLength(1);
		expect(placed.document.timeline.clips[0]!.assetId).not.toBe("asset_rec");
		expect(placed.cleared.clips).toBe(1);
		const look = getEditorSettings(placed.document);
		expect([look.padding, look.borderRadius, look.shadowIntensity]).toEqual([0, 0, 0]);
		// The recording stays in the project.
		expect(placed.document.assets.some((a) => a.id === "asset_rec")).toBe(true);
		const added = placeShowcase(doc, { mp4Path: mp4, durationSec: 12, label: "Showcase" }, "end");
		expect(added.document.timeline.clips).toHaveLength(2);
	});
});

describe("render progress", () => {
	it("reports frames and time left, a few times a second", async () => {
		const { renderProgress } = await import("./render");
		let t = 0;
		const seen: string[] = [];
		const tick = renderProgress((d) => seen.push(d), "Rendering", () => t)!;
		t = 100;
		tick(1, 100);
		t = 200;
		tick(2, 100); // throttled
		t = 5000;
		tick(50, 100);
		t = 10000;
		tick(100, 100);
		expect(seen).toEqual(["Rendering 1 / 100 frames", "Rendering 50 / 100 frames · ~5s left", "Rendering 100 / 100 frames"]);
		expect(renderProgress(undefined)).toBeUndefined();
	});
});

describe("auto plan from the recording", () => {
	it("fills clicks, speed-ups and push-ins the plan left out", async () => {
		const { autoPlan } = await import("./plan");
		const args = showcaseArgsSchema.parse({});
		const cursor = [
			{ timeMs: 1000, cx: 0.2, cy: 0.3, interactionType: "move" },
			{ timeMs: 2000, cx: 0.4, cy: 0.5, interactionType: "click" },
			{ timeMs: 2100, cx: 0.4, cy: 0.5, interactionType: "click" }, // double-click: one ripple
			{ timeMs: 3500, cx: 0.6, cy: 0.5, interactionType: "click" }, // same cluster
			{ timeMs: 12000, cx: 0.8, cy: 0.2, interactionType: "click" },
			{ timeMs: 40000, cx: 0.5, cy: 0.5, interactionType: "click" }, // outside the trim
		];
		const r = autoPlan(args, { cursor, stillStretches: [[5, 9], [10, 11]] }, { startSec: 0, endSec: 20 });
		expect(r.args.clicks?.map((c) => c.atSec)).toEqual([2, 3.5, 12]);
		expect(r.args.speed).toEqual([{ startSec: 5.3, endSec: 8.7, rate: 3 }]);
		expect(r.args.focus).toHaveLength(2);
		expect(r.args.focus![0]).toMatchObject({ startSec: 1.1, endSec: 4.9, zoom: 1.3 });
		expect(r.args.focus![0]!.x).toBeCloseTo(0.5);
		expect(r.filled).toHaveLength(3);
	});

	it("keeps what the plan set, never speeds up speech, and can be turned off", async () => {
		const { autoPlan } = await import("./plan");
		const planned = showcaseArgsSchema.parse({ clicks: [{ atSec: 1, x: 0.1, y: 0.1 }] });
		const cursor = [{ timeMs: 5000, cx: 0.5, cy: 0.5, interactionType: "click" }];
		const r = autoPlan(planned, { cursor, stillStretches: [[2, 8]], silences: [[2, 6]] }, { startSec: 0, endSec: 10 });
		expect(r.args.clicks).toEqual([{ atSec: 1, x: 0.1, y: 0.1 }]);
		// Only the quiet part of the still stretch (2–6 s) is sped up.
		expect(r.args.speed).toEqual([{ startSec: 2.3, endSec: 5.7, rate: 3 }]);
		const off = autoPlan({ ...planned, auto: false }, { cursor, stillStretches: [[2, 8]] }, { startSec: 0, endSec: 10 });
		expect(off.filled).toEqual([]);
	});
});

describe("draft showcases", () => {
	it("default to final quality and accept a draft", () => {
		expect(showcaseArgsSchema.parse({}).quality).toBe("final");
		expect(showcaseArgsSchema.parse({ quality: "draft" }).quality).toBe("draft");
	});
});

describe("following a cover as the page scrolls", () => {
	it("finds the vertical shift between two frames", async () => {
		const { bestShift, cumulativeShifts, rowProfile } = await import("./track");
		const w = 40;
		const h = 60;
		const frame = (offset: number) => {
			const g = new Uint8Array(w * h);
			for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = (((y - offset) * 37) % 200 + 200) % 200;
			return g;
		};
		const p0 = rowProfile(frame(0), w, h, 0, w);
		const up = rowProfile(frame(-7), w, h, 0, w);
		expect(bestShift(p0, p0, 20)).toBe(0);
		expect(bestShift(p0, up, 20)).toBe(-7);
		expect(cumulativeShifts([[p0, up, rowProfile(frame(-12), w, h, 0, w)]], 2, 20)).toEqual([[0, -14, -24]]);
	});

	it("maps covers into the footage and draws them in the page", () => {
		const tl = resolveTimeline(
			{ covers: [{ startSec: 1, endSec: 3, x: 0.7, y: 0.8, width: 0.06, height: 0.1, mode: "image", useBrandLogo: true, follow: true }] },
			buildSegments(0, 6),
			{ x: 0, y: 0, width: 1920, height: 1080 },
			{ width: 1920, height: 1080 },
		);
		expect(tl.covers[0]).toMatchObject({ in: 1, out: 3, at: 1, mode: "image", fill: "#ffffff", useBrandLogo: true });
		const html = renderShowcasePage({
			width: 1920,
			height: 1080,
			fps: 30,
			frameCount: 180,
			frameDigits: 5,
			timeline: { ...tl, covers: [{ ...tl.covers[0]!, image: "cover-0.png", track: [0, -3, -6] }] },
			kit: brandKitSchema.parse({}),
			name: "",
			logoFile: null,
			intro: false,
			outro: false,
			tagline: "",
			url: "",
			tags: [],
			theme: "dark",
		});
		expect(html).toContain('"image":"cover-0.png"');
		expect(html).toContain("cvs.forEach");
	});
});
