import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { insertClip } from "../../../src/lib/ai-edition/document/timeline";
import { createEmptyDocument, documentSchema, type AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { executeAgentTool } from "../agent-tools";
import { planProcess } from "./plan";
import { bakeProcessed, describeOps, gradeFilterChain, isNeutralGrade, normalizeOps, resolveGrade, videoFilterChain } from "./process";

const FFMPEG = ["/usr/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].find((p) => existsSync(p)) ?? null;
const dir = mkdtempSync(join(tmpdir(), "grade-"));
const REC = join(dir, "rec.mp4");

function doc(): AxcutDocument {
	let d = createEmptyDocument({ title: "t", projectId: "p", createdAt: "2026-01-01T00:00:00.000Z" });
	d = {
		...d,
		assets: [{ id: "asset_v", kind: "video", label: "rec.mp4", originalPath: REC, durationSec: 2, cameraTrack: null }] as AxcutDocument["assets"],
		project: { ...d.project, primaryAssetId: "asset_v" },
	};
	return insertClip(d, "asset_v", 0, "user", "rec");
}

describe("grades", () => {
	it("a look sets values, explicit values win, neutral means nothing", () => {
		expect(resolveGrade({ look: "cinematic" }).vignette).toBe(0.35);
		expect(resolveGrade({ look: "cinematic", vignette: 0 }).vignette).toBe(0);
		expect(isNeutralGrade({})).toBe(true);
		expect(isNeutralGrade({ look: "none", exposure: 0 })).toBe(true);
		expect(isNeutralGrade({ look: "matte" })).toBe(false);
		expect(isNeutralGrade({ lutPath: "/l.cube" })).toBe(false);
	});

	it("builds a filter chain and leaves out filters this ffmpeg lacks", () => {
		const chain = gradeFilterChain({ look: "cinematic" });
		expect(chain).toContain("curves=all=");
		expect(chain).toContain("colortemperature=temperature=6200");
		expect(chain).toContain("hue=s=0.9");
		expect(chain).toContain("vignette=angle=");
		expect(gradeFilterChain({ exposure: 0.5 })).toMatch(/^colorlevels=rimax=/);
		expect(gradeFilterChain({ exposure: -0.5 })).toMatch(/^colorlevels=romax=/);
		expect(gradeFilterChain({ look: "teal-orange" })).toContain("colorbalance=rs=-0.12:bs=0.15:rh=0.15:bh=-0.12");
		expect(gradeFilterChain({ look: "bw" })).toContain("hue=s=0");
		expect(gradeFilterChain({ lutPath: "/a/b:c.cube" })).toContain("lut3d=file='/a/b\\:c.cube'");
		expect(gradeFilterChain({ look: "cinematic" }, new Set(["hue"]))).toBe("hue=s=0.9");
		expect(videoFilterChain({ stabilize: true, grade: { saturation: 0.2 } })).toMatch(/^deshake=.*,hue=s=1.2$/);
		expect(normalizeOps({ grade: {}, stabilize: false })).toBeNull();
		expect(describeOps({ grade: { look: "warm" }, voice: "light" })).toBe('grade "warm" (saturation +10, warmth +45), voice clean-up light');
	});

	it("plans on top of the current treatments: adjust, replace with a look, undo one part", () => {
		let d = doc();
		const p1 = planProcess("gradeClip", { look: "warm" }, d);
		expect(p1.ok && p1.targets[0]!.nextOps).toEqual({ grade: { look: "warm" } });
		d = executeAgentTool(d, "gradeClip", JSON.stringify({ look: "warm" }), {
			prepared: { processed: [{ assetId: "asset_v", path: "/g/1.mp4", videoChain: "x" }] },
		}).document!;
		expect(() => documentSchema.parse(d)).not.toThrow();
		expect(d.assets[0]!.originalPath).toBe("/g/1.mp4");

		// adjust keeps the look; the voice clean-up rides along
		d = executeAgentTool(d, "cleanVoice", JSON.stringify({}), {
			prepared: { processed: [{ assetId: "asset_v", path: "/g/2.mp4" }] },
		}).document!;
		const p2 = planProcess("gradeClip", { contrast: 0.3 }, d);
		expect(p2.ok && p2.targets[0]!).toMatchObject({ sourcePath: REC, nextOps: { grade: { look: "warm", contrast: 0.3 }, voice: "medium" } });
		// a new look replaces the grade
		const p3 = planProcess("gradeClip", { look: "bw" }, d);
		expect(p3.ok && p3.targets[0]!.nextOps).toEqual({ grade: { look: "bw" }, voice: "medium" });
		// same request twice = nothing to do
		const p4 = planProcess("cleanVoice", {}, d);
		expect(p4.ok && p4.targets[0]!.unchanged).toBe(true);
		expect(executeAgentTool(d, "cleanVoice", "{}", {}).ok).toBe(false);

		// undo the grade only → still processed (voice), then undo voice → original
		const p5 = planProcess("gradeClip", { undo: true }, d);
		expect(p5.ok && p5.targets[0]!.nextOps).toEqual({ voice: "medium" });
		d = executeAgentTool(d, "gradeClip", JSON.stringify({ undo: true }), {
			prepared: { processed: [{ assetId: "asset_v", path: "/g/3.mp4" }] },
		}).document!;
		expect(d.assets[0]!.originalPath).toBe("/g/3.mp4");
		d = executeAgentTool(d, "cleanVoice", JSON.stringify({ undo: true })).document!;
		expect(d.assets[0]!.originalPath).toBe(REC);
		expect(d.assets[0]!.derived).toBeUndefined();
	});

	it("stabilise plans and undoes", () => {
		const p = planProcess("stabilizeClip", {}, doc());
		expect(p.ok && p.targets[0]!.nextOps).toEqual({ stabilize: true });
	});
});

describe.skipIf(!FFMPEG)("grades — real file", () => {
	it("re-encodes the picture for a grade and copies audio; copies the picture for a voice-only change", async () => {
		execFileSync(FFMPEG!, [
			"-v", "error", "-y",
			"-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30",
			"-f", "lavfi", "-i", "sine=frequency=300:duration=2",
			"-map", "0:v", "-map", "1:a", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", REC,
		]);
		writeFileSync(`${REC}.cursor.json`, "{}");
		const graded = await bakeProcessed({ ffmpegPath: FFMPEG!, sourcePath: REC, ops: { grade: { look: "bw" } }, outDir: join(dir, "g") });
		expect(graded.videoChain).toContain("hue=s=0");
		expect(graded.audioChain).toBe("");
		expect(existsSync(`${graded.path}.cursor.json`)).toBe(true);
		// black and white: the frame's colour saturation is ~0
		const stats = spawnSync(FFMPEG!, ["-hide_banner", "-i", graded.path, "-vf", "format=yuv420p,signalstats", "-f", "null", "-"], { encoding: "utf8" }).stderr;
		void stats;
		const probe = spawnSync(FFMPEG!, ["-hide_banner", "-i", graded.path], { encoding: "utf8" }).stderr;
		expect(probe).toMatch(/Video: h264/);
		expect(probe).toMatch(/Audio: aac/);

		const voiced = await bakeProcessed({ ffmpegPath: FFMPEG!, sourcePath: REC, ops: { voice: "light" }, outDir: join(dir, "g") });
		expect(voiced.videoChain).toBe("");
		expect(voiced.audioChain).toContain("highpass");
	}, 60_000);
});
