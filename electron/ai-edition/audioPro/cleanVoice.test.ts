import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { insertClip } from "../../../src/lib/ai-edition/document/timeline";
import { createEmptyDocument, documentSchema, type AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { executeAgentTool } from "../agent-tools";
import { bakeCleanVoice, setVoiceSource, voiceFilterChain, voiceTargets } from "./cleanVoice";

const FFMPEG = ["/usr/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].find((p) => existsSync(p)) ?? null;
const dir = mkdtempSync(join(tmpdir(), "voice-"));
const REC = join(dir, "rec.mp4");

function doc(path = REC): AxcutDocument {
	let d = createEmptyDocument({ title: "t", projectId: "p", createdAt: "2026-01-01T00:00:00.000Z" });
	d = {
		...d,
		assets: [
			{ id: "asset_v", kind: "video", label: "rec.mp4", originalPath: path, durationSec: 2, cameraTrack: null },
			{ id: "asset_pic", kind: "video", label: "pic.png", originalPath: join(dir, "pic.mp4"), durationSec: 4, cameraTrack: null, still: { sourcePath: "/p.png", motion: "none", fit: "cover" } },
		] as AxcutDocument["assets"],
		project: { ...d.project, primaryAssetId: "asset_v" },
	};
	d = insertClip(d, "asset_v", 0, "user", "rec");
	return insertClip(d, "asset_pic", 1, "user", "pic");
}

describe("voice clean-up", () => {
	it("leaves out filters this ffmpeg lacks", () => {
		expect(voiceFilterChain("light")).toBe(
			"highpass=f=80,afftdn=nr=10:nf=-40,acompressor=threshold=0.125:ratio=2:attack=10:release=200,alimiter=limit=0.95",
		);
		expect(voiceFilterChain("strong", new Set(["highpass", "alimiter"]))).toBe("highpass=f=100,alimiter=limit=0.95");
	});

	it("targets recordings on the timeline, not pictures, and restores the original", () => {
		const d = doc();
		expect(voiceTargets(d).map((t) => t.asset.id)).toEqual(["asset_v"]);
		const cleaned = setVoiceSource(d, "asset_v", { path: "/g/rec.voice-medium.mp4", level: "medium" });
		expect(cleaned.assets[0]).toMatchObject({
			originalPath: "/g/rec.voice-medium.mp4",
			derived: { kind: "voice-clean", level: "medium", sourcePath: REC },
		});
		// a second pass starts from the untouched recording
		expect(voiceTargets(cleaned)[0]!.sourcePath).toBe(REC);
		const again = setVoiceSource(cleaned, "asset_v", { path: "/g/rec.voice-strong.mp4", level: "strong" });
		expect(again.assets[0]!.derived!.sourcePath).toBe(REC);
		const back = setVoiceSource(again, "asset_v", null);
		expect(back.assets[0]!.originalPath).toBe(REC);
		expect(back.assets[0]!.derived).toBeUndefined();
	});

	it("cleanVoice tool swaps in the copy and undo puts the original back", () => {
		const r = executeAgentTool(doc(), "cleanVoice", JSON.stringify({ level: "strong" }), {
			prepared: { voice: [{ assetId: "asset_v", path: "/g/clean.mp4", chain: "highpass=f=100" }] },
		});
		expect(r.ok).toBe(true);
		expect(() => documentSchema.parse(r.document)).not.toThrow();
		expect(r.document!.assets[0]!.originalPath).toBe("/g/clean.mp4");
		expect(JSON.parse(r.resultJson!).recordings[0]).toMatchObject({ level: "strong" });
		const back = executeAgentTool(r.document!, "cleanVoice", JSON.stringify({ undo: true }));
		expect(back.document!.assets[0]!.originalPath).toBe(REC);
		expect(executeAgentTool(back.document!, "cleanVoice", JSON.stringify({ undo: true })).ok).toBe(false);
	});
});

describe.skipIf(!FFMPEG)("voice clean-up — real file", () => {
	it("keeps the picture as it was and carries the cursor data along", async () => {
		execFileSync(FFMPEG!, [
			"-v", "error", "-y",
			"-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30",
			"-f", "lavfi", "-i", "sine=frequency=300:duration=2",
			"-f", "lavfi", "-i", "anoisesrc=d=2:c=pink:a=0.05",
			"-filter_complex", "[1][2]amix=inputs=2[a]",
			"-map", "0:v", "-map", "[a]", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", REC,
		]);
		writeFileSync(`${REC}.cursor.json`, "{}");
		const out = await bakeCleanVoice({ ffmpegPath: FFMPEG!, sourcePath: REC, level: "medium", outDir: join(dir, "g") });
		expect(existsSync(out.path)).toBe(true);
		expect(existsSync(`${out.path}.cursor.json`)).toBe(true);
		const probe = spawnSync(FFMPEG!, ["-hide_banner", "-i", out.path], { encoding: "utf8" }).stderr;
		expect(probe).toMatch(/Video: h264/);
		expect(probe).toMatch(/Audio: aac/);
		expect(probe).toMatch(/320x180/);
		await expect(
			bakeCleanVoice({ ffmpegPath: FFMPEG!, sourcePath: join(dir, "nope.mp4"), level: "light", outDir: dir }),
		).rejects.toThrow();
	}, 30_000);
});
