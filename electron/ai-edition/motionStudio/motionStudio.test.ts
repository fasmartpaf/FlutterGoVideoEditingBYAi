// Motion studio: templates, brand kit, placement (speech-snapped), and the
// full HTML → MP4 → check → place path when a headless Chromium is available.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { insertClip } from "../../../src/lib/ai-edition/document/timeline";
import { type AxcutDocument, createEmptyDocument } from "../../../src/lib/ai-edition/schema";
import { executeAgentTool } from "../agent-tools";
import { prepareAgentToolMedia } from "../agentToolMedia";
import { TEST_FFMPEG } from "../testing/ffmpegForTests";
import { DEFAULT_BRAND_KIT, readBrandKit, writeBrandKit } from "./brandKit";
import { MOTION_DRIVER_JS, wrapComposition } from "./driver";
import { placeMotionClip, snapToSpeechPause } from "./placement";
import { createPlaywrightFrameSource } from "./playwrightFrameSource";
import {
	MOTION_TEMPLATE_IDS,
	OVERLAY_DEFAULT_SEC,
	OVERLAY_TEMPLATE_IDS,
	renderOverlayTemplate,
	renderTemplate,
	TEMPLATE_DEFAULT_SEC,
} from "./templates";
import {
	decodeImageSequenceRef,
	encodeImageSequenceRef,
	sequenceFrameIndex,
	sequenceFrameName,
} from "../../../src/lib/ai-edition/document/imageSequence";
import { splitClip } from "../../../src/lib/ai-edition/document/timeline";

const scratch: string[] = [];
afterEach(() => {
	for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A 10 s recording with a transcript: words at 0–1.0, 1.2–2.0, [pause 2.0–3.4], 3.4–4.0 … */
function fixture(): { doc: AxcutDocument; root: string } {
	const root = mkdtempSync(join(tmpdir(), "os-motion-studio-"));
	scratch.push(root);
	mkdirSync(join(root, "recordings"), { recursive: true });
	let doc = createEmptyDocument({ title: "t", projectId: "proj_ms", createdAt: "2026-01-01T00:00:00.000Z" });
	doc = {
		...doc,
		assets: [
			{
				id: "asset_rec",
				kind: "video",
				label: "rec.mp4",
				originalPath: join(root, "recordings", "rec.mp4"),
				durationSec: 10,
				video: { codec: "unknown", width: 640, height: 360, fps: 30 },
				cameraTrack: null,
			} as AxcutDocument["assets"][number],
		],
		project: { ...doc.project, primaryAssetId: "asset_rec" },
		transcripts: [
			{
				assetId: "asset_rec",
				language: "en",
				segments: [],
				words: [
					{ id: "w1", segmentId: "s", startSec: 0, endSec: 1.0, text: "Hello" },
					{ id: "w2", segmentId: "s", startSec: 1.2, endSec: 2.0, text: "there" },
					{ id: "w3", segmentId: "s", startSec: 3.4, endSec: 4.0, text: "next" },
					{ id: "w4", segmentId: "s", startSec: 4.1, endSec: 5.0, text: "part" },
				],
			},
		],
	};
	return { doc: insertClip(doc, "asset_rec", 0, "user", "Recording"), root };
}

function fakeMp4(root: string): string {
	const p = join(root, "clip.mp4");
	writeFileSync(p, "not really a video");
	return p;
}

describe("templates", () => {
	it("every template renders escaped HTML with the brand colours", () => {
		const kit = { ...DEFAULT_BRAND_KIT, primary: "#123456" };
		const params: Record<string, unknown> = {
			titleCard: { title: "<b>Hi</b> & welcome" },
			sectionCard: { title: "Setup", number: 2 },
			outroCta: { title: "Try it", cta: "Start" },
			kineticText: { lines: ["One", "Two"] },
			statHighlight: { value: 42, label: "users" },
			bulletList: { title: "Why", bullets: ["Fast"] },
			logoReveal: {},
		};
		for (const id of MOTION_TEMPLATE_IDS) {
			const html = renderTemplate(id, params[id], kit, { width: 1920, height: 1080, durationSec: TEMPLATE_DEFAULT_SEC[id] });
			expect(html).toContain("#123456");
			expect(html).not.toContain("<b>Hi</b>");
		}
		expect(() => renderTemplate("titleCard", {}, kit, { width: 1920, height: 1080, durationSec: 3 })).toThrow();
	});

	it("wraps a composition so the virtual clock runs first and the network is blocked", () => {
		const out = wrapComposition("<div>hi</div>", { width: 640, height: 360 });
		expect(out.indexOf(MOTION_DRIVER_JS)).toBeGreaterThan(-1);
		expect(out.indexOf(MOTION_DRIVER_JS)).toBeLessThan(out.indexOf("<div>hi</div>"));
		expect(out).toContain("connect-src 'none'");
		expect(out).toContain("width:640px");
	});
});

describe("brand kit", () => {
	it("defaults, partial updates, and validation", () => {
		const { doc } = fixture();
		expect(readBrandKit(doc)).toEqual(DEFAULT_BRAND_KIT);
		const { document, kit } = writeBrandKit(doc, { primary: "#ff0000", style: "bold" });
		expect(kit.primary).toBe("#ff0000");
		expect(readBrandKit(document).style).toBe("bold");
		expect(readBrandKit(document).secondary).toBe(DEFAULT_BRAND_KIT.secondary);
		expect(() => writeBrandKit(doc, { primary: "red" })).toThrow();
	});
});

describe("placement", () => {
	it("snaps a requested time into the nearest pause in the speech", () => {
		const { doc } = fixture();
		const bounds = { min: 0, max: 10 };
		expect(snapToSpeechPause(doc, "asset_rec", 1.5, bounds)).toBeCloseTo(1.1, 5); // gap 1.0–1.2
		expect(snapToSpeechPause(doc, "asset_rec", 2.5, bounds)).toBe(2.5); // already silent
		// In "next" (3.4–4.0): the 0.1 s breath at 4.0–4.1 is not a pause; the real
		// pause 2.0–3.4 wins, at its point nearest the request (kept off the word edge).
		expect(snapToSpeechPause(doc, "asset_rec", 3.7, bounds)).toBeCloseTo(3.25, 5);
	});

	it("inserts at the start, at the end, and mid-timeline on a pause", () => {
		const { doc, root } = fixture();
		const mp4 = fakeMp4(root);
		const start = placeMotionClip(doc, { mp4Path: mp4, durationSec: 2, label: "Intro" }, "start");
		expect(start.document.timeline.clips[0]?.id).toBe(start.clipId);
		const end = placeMotionClip(doc, { mp4Path: mp4, durationSec: 2, label: "Outro" }, "end");
		expect(end.document.timeline.clips.at(-1)?.id).toBe(end.clipId);
		const mid = placeMotionClip(doc, { mp4Path: mp4, durationSec: 2, label: "Card" }, { atSec: 1.5 });
		const clips = mid.document.timeline.clips;
		expect(clips).toHaveLength(3);
		expect(clips[1]?.id).toBe(mid.clipId);
		expect(clips[0]?.sourceEndSec).toBeCloseTo(1.1, 5); // cut sits in the pause, not in "there"
		expect(clips[2]?.sourceStartSec).toBeCloseTo(1.1, 5);
		expect(mid.snappedToSec).toBeCloseTo(1.1, 5);
		const none = placeMotionClip(doc, { mp4Path: mp4, durationSec: 2, label: "x" }, "none");
		expect(none.clipId).toBeNull();
		expect(none.document.timeline.clips).toHaveLength(1);
	});

	it("placeMotionClip tool refuses relative paths", () => {
		const { doc } = fixture();
		const r = executeAgentTool(doc, "placeMotionClip", JSON.stringify({ videoPath: "clip.mp4", place: "end", durationSec: 2 }));
		expect(r.ok).toBe(false);
	});
});

describe("animated overlays", () => {
	it("encodes, decodes and steps through an image sequence (plays once, then holds)", () => {
		const ref = { dir: "/o", fps: 10, frameCount: 20 };
		const decoded = decodeImageSequenceRef(encodeImageSequenceRef(ref));
		expect(decoded).toEqual({ ...ref, offsetSec: 0 });
		expect(decodeImageSequenceRef("/plain.png")).toBeNull();
		expect(decodeImageSequenceRef("openscreen-seq:{bad")).toBeNull();
		expect(decodeImageSequenceRef(encodeImageSequenceRef({ dir: "", fps: 10, frameCount: 2 }))).toBeNull();
		expect(sequenceFrameIndex(ref, 0)).toBe(0);
		expect(sequenceFrameIndex(ref, 1.05)).toBe(10);
		expect(sequenceFrameIndex(ref, 99)).toBe(19);
		expect(sequenceFrameIndex({ ...ref, offsetSec: 1 }, 0)).toBe(10);
		expect(sequenceFrameName(7)).toBe("frame-00007.png");
	});

	it("overlay templates draw on a transparent page in the brand colour", () => {
		const kit = { ...DEFAULT_BRAND_KIT, primary: "#123456" };
		const params: Record<string, unknown> = {
			lowerThird: { name: "Ada <Lovelace>", title: "Founder" },
			callout: { text: "Click here", pointer: "left" },
			cornerBadge: { text: "NEW" },
			keywordPop: { text: "Fast" },
		};
		for (const id of OVERLAY_TEMPLATE_IDS) {
			const html = renderOverlayTemplate(id, params[id], kit, { width: 600, height: 160, durationSec: OVERLAY_DEFAULT_SEC[id] });
			expect(html).toContain("#123456");
			expect(html).toContain("background:transparent");
			expect(html).not.toContain("<Lovelace>");
		}
	});

	function fakeOverlay(root: string) {
		const dir = join(root, "overlays", "seq");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, sequenceFrameName(0)), "png");
		return {
			dir,
			fps: 30,
			frameCount: 60,
			durationSec: 2,
			posterDataUri: "data:image/png;base64,AAAA",
			posterPath: join(dir, sequenceFrameName(0)),
			pageErrors: [],
		};
	}

	it("stores the overlay as an image annotation whose picture is the sequence", () => {
		const { doc, root } = fixture();
		const args = { template: "cornerBadge", params: { text: "NEW" }, x: 80, y: 5, width: 14, height: 8, startSec: 1 };
		const r = executeAgentTool(doc, "addMotionOverlay", JSON.stringify(args), { prepared: { motionOverlay: fakeOverlay(root) } });
		expect(r.ok).toBe(true);
		const ann = r.document!.annotations.at(-1)!;
		expect(ann.type).toBe("image");
		expect(ann.content).toBe("data:image/png;base64,AAAA");
		expect(ann.startMs).toBe(1000);
		expect(ann.endMs).toBe(3000);
		expect(decodeImageSequenceRef(ann.imageContent)).toMatchObject({ fps: 30, frameCount: 60, offsetSec: 0 });
		expect(JSON.parse(r.resultJson).previewFrames).toHaveLength(1);
	});

	it("an overlay that straddles a cut continues on the second clip instead of restarting", () => {
		const { doc, root } = fixture();
		const cut = splitClip(doc, doc.timeline.clips[0]!.id, 2, "user");
		const args = { template: "keywordPop", params: { text: "Go" }, x: 30, y: 40, width: 40, height: 18, startSec: 1 };
		const r = executeAgentTool(cut, "addMotionOverlay", JSON.stringify(args), { prepared: { motionOverlay: fakeOverlay(root) } });
		expect(r.ok).toBe(true);
		const added = r.document!.annotations.slice(cut.annotations.length).sort((a, b) => a.startMs - b.startMs);
		expect(added).toHaveLength(2);
		expect(decodeImageSequenceRef(added[0]!.imageContent)?.offsetSec).toBe(0);
		expect(decodeImageSequenceRef(added[1]!.imageContent)?.offsetSec).toBeCloseTo(1, 3);
	});

	it("without a rendered overlay the executor explains instead of storing a blank", () => {
		const { doc } = fixture();
		const args = { template: "cornerBadge", params: { text: "NEW" }, x: 80, y: 5, width: 14, height: 8, startSec: 1 };
		const r = executeAgentTool(doc, "addMotionOverlay", JSON.stringify(args), { prepared: { renderError: "boom" } });
		expect(r.ok).toBe(false);
		expect(r.resultJson + (r.summary ?? "")).toMatch(/boom/);
	});
});

const pw = await createPlaywrightFrameSource().catch(() => null);
await pw?.close();

describe.skipIf(!pw || !TEST_FFMPEG)("createMotionClip end to end (headless Chromium)", () => {
	it("renders a template, checks it, and places it in a speech pause", async () => {
		const { doc } = fixture();
		const args = {
			template: "titleCard",
			params: { title: "Welcome to FlutterGo", subtitle: "AI video editing" },
			durationSec: 1.5,
			place: { atSec: 1.5 },
		};
		const prep = await prepareAgentToolMedia(doc, "createMotionClip", args, {
			ffmpegPath: TEST_FFMPEG,
			mayMutate: true,
			createFrameSource: createPlaywrightFrameSource,
		});
		expect(prep.prepared.renderError).toBeUndefined();
		const clip = prep.prepared.motionClip!;
		expect(clip.check.problems).toEqual([]);
		expect(clip.width).toBe(640);
		expect(clip.check.framePaths).toHaveLength(3);
		expect(clip.mp4Path).toMatch(/generated-graphics/);
		const result = executeAgentTool(doc, "createMotionClip", JSON.stringify(args), { prepared: prep.prepared });
		expect(result.ok).toBe(true);
		const payload = JSON.parse(result.resultJson);
		expect(payload.placed.snappedToSec).toBeCloseTo(1.1, 5);
		expect(result.document!.timeline.clips).toHaveLength(3);
		expect(existsSync(payload.videoPath)).toBe(true);
	}, 120_000);

	it("flags a composition that draws nothing", async () => {
		const { doc } = fixture();
		const args = { html: "<div></div>", durationSec: 1 };
		const prep = await prepareAgentToolMedia(doc, "createMotionClip", args, {
			ffmpegPath: TEST_FFMPEG,
			mayMutate: true,
			createFrameSource: createPlaywrightFrameSource,
		});
		expect(prep.prepared.motionClip?.check.ok).toBe(false);
		expect(prep.prepared.motionClip?.check.problems.join(" ")).toMatch(/flat colour|identical/);
	}, 120_000);
});


describe.skipIf(!pw)("addMotionOverlay end to end (headless Chromium)", () => {
	it("renders a transparent PNG sequence at the box size", async () => {
		const { doc } = fixture();
		const args = { template: "lowerThird", params: { name: "Ada", title: "Founder" }, x: 4, y: 76, width: 46, height: 16, startSec: 0.5, durationSec: 1, fps: 12 };
		const prep = await prepareAgentToolMedia(doc, "addMotionOverlay", args, {
			ffmpegPath: TEST_FFMPEG,
			mayMutate: true,
			createFrameSource: createPlaywrightFrameSource,
		});
		expect(prep.prepared.renderError).toBeUndefined();
		const ov = prep.prepared.motionOverlay!;
		scratch.push(ov.dir);
		expect(ov.frameCount).toBe(12);
		const png = readFileSync(join(ov.dir, sequenceFrameName(0)));
		// IHDR: width/height at 16/20, colour type 6 = RGBA.
		expect(png.readUInt32BE(16)).toBe(Math.round((640 * 46) / 100));
		expect(png.readUInt32BE(20)).toBe(Math.round((360 * 16) / 100));
		expect(png[25]).toBe(6);
		const r = executeAgentTool(doc, "addMotionOverlay", JSON.stringify(args), { prepared: prep.prepared });
		expect(r.ok).toBe(true);
	}, 120_000);
});
