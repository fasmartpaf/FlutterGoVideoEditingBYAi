import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveKeyframes, layerStateAt } from "../../../src/lib/ai-edition/document/layers";
import { createEmptyDocument, documentSchema, type AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { insertClip } from "../../../src/lib/ai-edition/document/timeline";
import { executeAgentTool } from "../agent-tools";
import { placeLayerBox } from "./layerTools";

const dir = mkdtempSync(join(tmpdir(), "layer-tools-"));
const LOGO = join(dir, "logo.png");
writeFileSync(LOGO, "p");
const RENDER = { dir, fps: 30, frameCount: 1, posterPath: join(dir, "frame-00000.png"), key: "k", x: 0.7, y: 0.05, w: 0.28, h: 0.2 };

function doc(): AxcutDocument {
	let d = createEmptyDocument({ title: "t", projectId: "p", createdAt: "2026-01-01T00:00:00.000Z" });
	d = {
		...d,
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
		project: { ...d.project, primaryAssetId: "asset_v" },
	};
	return insertClip(d, "asset_v", 0, "user", "rec");
}

function add(d: AxcutDocument, args: Record<string, unknown>, drawn = true) {
	return executeAgentTool(d, "addLayer", JSON.stringify({ path: LOGO, ...args }), {
		prepared: drawn ? { layer: { layerId: "layer_new", render: RENDER, source: { width: 400, height: 200 } } } : {},
	});
}

describe("layer tools", () => {
	it("places named positions a margin in from the edges", () => {
		const c = { width: 1920, height: 1080 };
		const tr = placeLayerBox("top-right", 0.25, c, { width: 400, height: 200 });
		expect(tr.x).toBeCloseTo(1 - (37.8 + 240) / 1920, 3);
		expect(tr.y).toBeCloseTo((37.8 + 120) / 1080, 3);
		expect(placeLayerBox("center", undefined, c, undefined)).toMatchObject({ x: 0.5, y: 0.5, scale: 0.5 });
		expect(placeLayerBox("full", undefined, c, { width: 1000, height: 1000 }).scale).toBeCloseTo(1, 5);
		expect(placeLayerBox("full", undefined, c, { width: 1000, height: 500 }).scale).toBeCloseTo(1.125, 3);
	});

	it("addLayer places a drawn picture layer and reports its pose", () => {
		const r = add(doc(), { startSec: 1, endSec: 4, position: "top-right", animateIn: "slide-right", shadow: 0.5 });
		expect(r.ok).toBe(true);
		const d = r.document!;
		expect(() => documentSchema.parse(d)).not.toThrow();
		expect(d.layers).toHaveLength(1);
		const l = d.layers[0]!;
		expect(l).toMatchObject({ layerId: "layer_new", animateIn: "slide-right", shadow: 0.5, render: RENDER });
		expect(l.x).toBeGreaterThan(0.8);
		const out = JSON.parse(r.resultJson!);
		expect(out).toMatchObject({ layerId: "layer_new", startSec: 1, endSec: 4, drawn: true });
		expect(out.warnings).toBeUndefined();
	});

	it("says so when the layer could not be drawn", () => {
		const r = add(doc(), { startSec: 0 }, false);
		expect(r.ok).toBe(true);
		const out = JSON.parse(r.resultJson!);
		expect(out.drawn).toBe(false);
		expect(out.endSec).toBe(5);
		expect(out.warnings[0]).toMatch(/not drawn yet/);
	});

	it("refuses a span with no clip and a file that isn't a picture or video", () => {
		expect(add(doc(), { startSec: 30, endSec: 40 }).ok).toBe(false);
		const txt = join(dir, "notes.txt");
		writeFileSync(txt, "x");
		const r = executeAgentTool(doc(), "addLayer", JSON.stringify({ path: txt, startSec: 0 }), {});
		expect(r.ok).toBe(false);
	});

	it("setLayer changes only what it's given, retimes, and removeLayer deletes it", () => {
		const d1 = add(doc(), { startSec: 1, endSec: 4, position: "bottom-left", scale: 0.2 }).document!;
		const before = d1.layers[0]!;
		const r = executeAgentTool(
			d1,
			"setLayer",
			JSON.stringify({ layerId: "layer_new", opacity: 0.6, endSec: 6, addKeyframes: [{ atSec: 1, rotation: 10 }] }),
			{ prepared: { layer: { layerId: "layer_new", render: RENDER } } },
		);
		expect(r.ok).toBe(true);
		const after = r.document!.layers[0]!;
		expect(after).toMatchObject({ x: before.x, y: before.y, scale: 0.2, opacity: 0.6 });
		expect(after.keyframes).toEqual([{ atSec: 1, rotation: 10, ease: "ease-in-out" }]);
		expect(JSON.parse(r.resultJson!)).toMatchObject({ startSec: 1, endSec: 6 });

		const gone = executeAgentTool(r.document!, "removeLayer", JSON.stringify({ layerId: "layer_new" }));
		expect(gone.ok).toBe(true);
		expect(gone.document!.layers).toEqual([]);
		expect(executeAgentTool(gone.document!, "setLayer", JSON.stringify({ layerId: "layer_new", opacity: 1 })).ok).toBe(false);
	});
});

describe("entrance and exit moves", () => {
	const rest = { x: 0.5, y: 0.5, scale: 0.3, rotation: 0, opacity: 1, keyframes: [] };

	it("fades in and out around the resting pose", () => {
		const l = { ...rest, animateIn: "fade", animateOut: "fade", animateSec: 0.5 };
		expect(layerStateAt(l, 0, 4).opacity).toBe(0);
		expect(layerStateAt(l, 0.5, 4).opacity).toBeCloseTo(1);
		expect(layerStateAt(l, 2, 4).opacity).toBeCloseTo(1);
		expect(layerStateAt(l, 4, 4).opacity).toBeCloseTo(0);
		expect(effectiveKeyframes(l, 4).map((k) => k.atSec)).toEqual([0, 0.5, 3.5, 4]);
	});

	it("slides in from fully off-frame and pops with an overshoot", () => {
		const slide = { ...rest, animateIn: "slide-left" };
		expect(layerStateAt(slide, 0, 4).x).toBeLessThan(-0.14);
		expect(layerStateAt(slide, 1, 4).x).toBeCloseTo(0.5);
		const pop = { ...rest, animateIn: "pop", animateSec: 1 };
		expect(layerStateAt(pop, 0.7, 4).scale).toBeCloseTo(0.3 * 1.08, 3);
		expect(layerStateAt(pop, 1, 4).scale).toBeCloseTo(0.3, 3);
	});
});
