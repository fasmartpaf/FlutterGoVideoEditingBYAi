import { describe, expect, it } from "vitest";
import { buildSceneDescription } from "@/native/sceneDescription";
import { createEmptyDocument, documentSchema, type AxcutDocument, type AxcutLayer } from "../schema";
import {
	easeValue,
	findLayer,
	layerAnimatedUntilSec,
	layerBoundsPx,
	layerCanvasSize,
	layerRenderKey,
	layersAsAnnotations,
	layerSequenceFrameCount,
	layerStateAt,
	removeLayer,
	updateLayer,
} from "./layers";
import { insertClip, splitClip } from "./timeline";
import { patchEditorSettings } from "../store/editorSettings";

function layer(over: Partial<AxcutLayer> = {}): AxcutLayer {
	return {
		id: "layer_a",
		layerId: "layer_a",
		startMs: 1000,
		endMs: 5000,
		label: "logo",
		source: { kind: "image", path: "/tmp/logo.png", width: 400, height: 200, startSec: 0 },
		x: 0.5,
		y: 0.5,
		scale: 0.25,
		rotation: 0,
		opacity: 1,
		keyframes: [],
		cornerRadius: 0,
		shadow: 0,
		borderWidth: 0,
		borderColor: "#ffffff",
		zIndex: 0,
		render: null,
		origin: "agent",
		...over,
	};
}

function docWithClip(): AxcutDocument {
	let doc = createEmptyDocument({ title: "t", projectId: "p", createdAt: "2026-01-01T00:00:00.000Z" });
	doc = {
		...doc,
		assets: [
			{
				id: "asset_v",
				kind: "video",
				label: "rec.mp4",
				originalPath: "/tmp/rec.mp4",
				durationSec: 10,
				video: { codec: "h264", width: 1920, height: 1080, fps: 30 },
				cameraTrack: null,
			} as AxcutDocument["assets"][number],
		],
		project: { ...doc.project, primaryAssetId: "asset_v" },
	};
	return insertClip(doc, "asset_v", 0, "user", "rec");
}

describe("layer keyframes", () => {
	it("eases", () => {
		expect(easeValue("linear", 0.25)).toBeCloseTo(0.25);
		expect(easeValue("ease-in-out", 0.5)).toBeCloseTo(0.5);
		expect(easeValue("ease-out", 0.5)).toBeGreaterThan(0.5);
		expect(easeValue("ease-in", 0.5)).toBeLessThan(0.5);
		expect(easeValue("linear", 2)).toBe(1);
	});

	it("holds the start values without keyframes", () => {
		expect(layerStateAt(layer({ x: 0.2 }), 3)).toEqual({ x: 0.2, y: 0.5, scale: 0.25, rotation: 0, opacity: 1 });
	});

	it("travels each value from the last point that set it, then holds", () => {
		const l = layer({
			x: -0.2,
			opacity: 0,
			keyframes: [
				{ atSec: 1, x: 0.5, opacity: 1, ease: "linear" },
				{ atSec: 2, scale: 0.5, ease: "linear" },
				{ atSec: 3, x: 0.8, ease: "linear" },
			],
		});
		expect(layerStateAt(l, 0).x).toBeCloseTo(-0.2);
		expect(layerStateAt(l, 0.5).x).toBeCloseTo(0.15);
		expect(layerStateAt(l, 0.5).opacity).toBeCloseTo(0.5);
		expect(layerStateAt(l, 1).x).toBeCloseTo(0.5);
		// scale's previous point is the start (0.25 at t=0)
		expect(layerStateAt(l, 1).scale).toBeCloseTo(0.375);
		// x's next point is the keyframe at 3 (the one at 2 doesn't set x)
		expect(layerStateAt(l, 2).x).toBeCloseTo(0.65);
		expect(layerStateAt(l, 2.5).x).toBeCloseTo(0.725);
		expect(layerStateAt(l, 9)).toMatchObject({ x: 0.8, scale: 0.5, opacity: 1 });
		expect(layerAnimatedUntilSec(l)).toBe(3);
	});

	it("bakes one frame for a still, the animation for a moving one, the whole clip for a video", () => {
		expect(layerSequenceFrameCount(layer(), 4)).toBe(1);
		expect(layerSequenceFrameCount(layer({ keyframes: [{ atSec: 1, x: 0.1, ease: "linear" }] }), 4)).toBe(31);
		expect(layerSequenceFrameCount(layer({ keyframes: [{ atSec: 9, x: 0.1, ease: "linear" }] }), 4)).toBe(121);
		expect(layerSequenceFrameCount(layer({ source: { kind: "video", path: "/v.mp4", startSec: 0 } }), 2)).toBe(60);
		expect(layerSequenceFrameCount(layer({ source: { kind: "video", path: "/v.mp4", startSec: 0 } }), 500)).toBe(1800);
	});
});

describe("layer geometry", () => {
	it("bakes only the area the layer covers, rotation included", () => {
		const canvas = { width: 1000, height: 500 };
		const b = layerBoundsPx([layerStateAt(layer(), 0)], { width: 400, height: 200 }, canvas);
		// 250 x 125 box centred at 500,250
		expect(b).toEqual({ x: 374, y: 186, w: 252, h: 128 });
		const r = layerBoundsPx([{ x: 0.5, y: 0.5, scale: 0.25, rotation: 90, opacity: 1 }], { width: 400, height: 200 }, canvas);
		expect(r!.w).toBeLessThan(r!.h);
		expect(layerBoundsPx([{ x: 0.5, y: 0.5, scale: 0.25, rotation: 0, opacity: 0 }], {}, canvas)).toBeNull();
		expect(layerBoundsPx([{ x: 5, y: 5, scale: 0.1, rotation: 0, opacity: 1 }], {}, canvas)).toBeNull();
	});

	it("follows the output frame, capped at 1920", () => {
		const doc = docWithClip();
		expect(layerCanvasSize(doc)).toEqual({ width: 1920, height: 1080 });
		expect(layerCanvasSize(patchEditorSettings(doc, { aspectRatio: "9:16" }))).toEqual({ width: 1080, height: 1920 });
	});

	it("changes the render key when anything drawn changes", () => {
		const c = { width: 1920, height: 1080 };
		const k = layerRenderKey(layer(), c, 4);
		expect(layerRenderKey(layer(), c, 4)).toBe(k);
		expect(layerRenderKey(layer({ x: 0.3 }), c, 4)).not.toBe(k);
		expect(layerRenderKey(layer({ keyframes: [{ atSec: 1, opacity: 0, ease: "linear" }] }), c, 4)).not.toBe(k);
		expect(layerRenderKey(layer(), { width: 1080, height: 1920 }, 4)).not.toBe(k);
		expect(layerRenderKey(layer({ label: "renamed" }), c, 4)).toBe(k);
	});
});

describe("layers in the document", () => {
	const render = {
		dir: "/tmp/seq",
		fps: 30,
		frameCount: 10,
		posterPath: "/tmp/seq/frame-00000.png",
		key: "k",
		x: 0.1,
		y: 0.2,
		w: 0.3,
		h: 0.4,
	};

	it("loads older documents without layers and validates new ones", () => {
		const doc = docWithClip();
		expect(doc.layers).toEqual([]);
		const withLayer = { ...doc, layers: [layer({ clipId: doc.timeline.clips[0]!.id, sourceStartSec: 1, sourceEndSec: 5 })] };
		expect(() => documentSchema.parse(withLayer)).not.toThrow();
	});

	it("keeps a layer across a clip split, as two fragments of one layer", () => {
		let doc = docWithClip();
		const clip = doc.timeline.clips[0]!;
		doc = { ...doc, layers: [layer({ clipId: clip.id, sourceStartSec: 1, sourceEndSec: 5 })] };
		doc = splitClip(doc, clip.id, 3);
		expect(doc.layers).toHaveLength(2);
		expect(new Set(doc.layers.map((l) => l.layerId))).toEqual(new Set(["layer_a"]));
		expect(findLayer(doc, "layer_a")).toHaveLength(2);
	});

	it("becomes frame-space image sequences for the compositor, continuing across fragments", () => {
		let doc = docWithClip();
		const clip = doc.timeline.clips[0]!;
		doc = { ...doc, layers: [layer({ clipId: clip.id, sourceStartSec: 1, sourceEndSec: 5, render, zIndex: 3 })] };
		doc = splitClip(doc, clip.id, 3);
		const anns = layersAsAnnotations(doc) as unknown as Array<Record<string, unknown>>;
		expect(anns).toHaveLength(2);
		expect(anns[0]).toMatchObject({ type: "image", space: "frame", zIndex: 100003, position: { x: 10, y: 20 } });
		expect(String(anns[1]!.imageContent)).toContain('"offsetSec":2');

		const scene = buildSceneDescription(doc);
		const drawn = scene.annotations.filter((a) => a.imageSequence);
		expect(drawn.length).toBeGreaterThanOrEqual(1);
		expect(drawn[0]).toMatchObject({ space: "frame", imagePath: render.posterPath, x: 0.1, y: 0.2 });
		expect(drawn[0]!.w).toBeCloseTo(0.3);
	});

	it("skips a layer that has not been baked", () => {
		const doc = { ...docWithClip(), layers: [layer()] };
		expect(layersAsAnnotations(doc)).toEqual([]);
	});

	it("updates and removes every fragment of a layer", () => {
		let doc = docWithClip();
		const clip = doc.timeline.clips[0]!;
		doc = splitClip({ ...doc, layers: [layer({ clipId: clip.id, sourceStartSec: 1, sourceEndSec: 5 })] }, clip.id, 3);
		doc = updateLayer(doc, "layer_a", (f) => ({ ...f, opacity: 0.5 }));
		expect(doc.layers.every((l) => l.opacity === 0.5)).toBe(true);
		expect(removeLayer(doc, doc.layers[1]!.id).layers).toEqual([]);
	});
});
