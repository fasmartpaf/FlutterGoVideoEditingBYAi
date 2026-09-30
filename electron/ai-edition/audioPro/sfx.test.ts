import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { separateAudioLanes } from "../../../src/lib/ai-edition/document/audioTracks";
import { insertClip } from "../../../src/lib/ai-edition/document/timeline";
import { createEmptyDocument, documentSchema, type AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { executeAgentTool } from "../agent-tools";
import { SFX_NAMES, ensureSfx } from "./sfx";

const FFMPEG = ["/usr/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].find((p) => existsSync(p)) ?? null;
const dir = mkdtempSync(join(tmpdir(), "sfx-"));
const WHOOSH = { path: join(dir, "sfx-whoosh-v1.wav"), durationSec: 0.7, label: "Whoosh" };

function doc(): AxcutDocument {
	let d = createEmptyDocument({ title: "t", projectId: "p", createdAt: "2026-01-01T00:00:00.000Z" });
	d = {
		...d,
		assets: [{ id: "asset_v", kind: "video", label: "rec.mp4", originalPath: join(dir, "rec.mp4"), durationSec: 10, cameraTrack: null }] as AxcutDocument["assets"],
		project: { ...d.project, primaryAssetId: "asset_v" },
	};
	return insertClip(d, "asset_v", 0, "user", "rec");
}

describe("sound effects", () => {
	it("places overlapping effects without pushing them apart, reusing one asset", () => {
		const r = executeAgentTool(doc(), "addSoundEffect", JSON.stringify({ effect: "whoosh", atSecs: [1, 1.2, 30] }), {
			prepared: { sfx: WHOOSH },
		});
		expect(r.ok).toBe(true);
		const d = r.document!;
		expect(() => documentSchema.parse(d)).not.toThrow();
		expect(d.assets.filter((a) => a.originalPath === WHOOSH.path)).toHaveLength(1);
		const sfx = d.audioTracks.filter((t) => t.kind === "sfx");
		expect(sfx.map((t) => t.startMs).sort()).toEqual([1000, 1200]);
		expect(JSON.parse(r.resultJson!)).toMatchObject({ placedAt: [1, 1.2], missed: [30] });
		// the lane repair leaves effects where they are
		expect(separateAudioLanes(d.audioTracks).map((t) => t.startMs).sort()).toEqual([1000, 1200]);

		const again = executeAgentTool(d, "addSoundEffect", JSON.stringify({ effect: "whoosh", atSec: 3 }), { prepared: { sfx: WHOOSH } });
		expect(again.document!.assets.filter((a) => a.originalPath === WHOOSH.path)).toHaveLength(1);
	});

	it("puts one on every layer entrance, and needs a time", () => {
		const d0 = doc();
		const clip = d0.timeline.clips[0]!;
		const base = { label: "", source: { kind: "image" as const, path: "/l.png", startSec: 0 }, x: 0.5, y: 0.5, scale: 0.3, rotation: 0, opacity: 1, keyframes: [], animateIn: "none", animateOut: "none", animateSec: 0.5, cornerRadius: 0, shadow: 0, borderWidth: 0, borderColor: "#fff", zIndex: 0, render: null, origin: "agent" as const, clipId: clip.id };
		const d = {
			...d0,
			layers: [
				{ ...base, id: "a", layerId: "a", startMs: 2000, endMs: 4000, sourceStartSec: 2, sourceEndSec: 4 },
				{ ...base, id: "b", layerId: "b", startMs: 5000, endMs: 7000, sourceStartSec: 5, sourceEndSec: 7 },
			],
		};
		const r = executeAgentTool(d, "addSoundEffect", JSON.stringify({ effect: "whoosh", onLayers: true }), { prepared: { sfx: WHOOSH } });
		expect(JSON.parse(r.resultJson!).placedAt).toEqual([2, 5]);
		expect(executeAgentTool(d, "addSoundEffect", JSON.stringify({ effect: "pop" }), { prepared: { sfx: WHOOSH } }).ok).toBe(false);
	});
});

describe.skipIf(!FFMPEG)("sound effects — rendered", () => {
	it("renders every effect once and reuses it", async () => {
		for (const name of SFX_NAMES) {
			const out = await ensureSfx(FFMPEG!, name, join(dir, "lib"));
			expect(existsSync(out.path)).toBe(true);
		}
		const first = await ensureSfx(FFMPEG!, "pop", join(dir, "lib"));
		expect((await ensureSfx(FFMPEG!, "pop", join(dir, "lib"))).path).toBe(first.path);
	}, 30_000);
});
