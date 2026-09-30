import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { insertClip } from "../../../src/lib/ai-edition/document/timeline";
import { createEmptyDocument, type AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { getEditorSettings } from "../../../src/lib/ai-edition/store/editorSettings";
import { executeAgentTool } from "../agent-tools";
import { loudnessGainDb, measureProgrammeLoudness, programmeLoudnessArgs } from "./loudness";

const FFMPEG = ["/usr/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].find((p) => existsSync(p)) ?? null;
const dir = mkdtempSync(join(tmpdir(), "loud-"));
const REC = join(dir, "rec.mp4");

function doc(): AxcutDocument {
	let d = createEmptyDocument({ title: "t", projectId: "p", createdAt: "2026-01-01T00:00:00.000Z" });
	d = {
		...d,
		assets: [
			{ id: "asset_v", kind: "video", label: "rec.mp4", originalPath: REC, durationSec: 3, video: { codec: "h264", width: 320, height: 180, fps: 30 }, cameraTrack: null },
		] as AxcutDocument["assets"],
		project: { ...d.project, primaryAssetId: "asset_v" },
	};
	return insertClip(d, "asset_v", 0, "user", "rec");
}

describe("platform loudness", () => {
	it("aims at the target but never past −1 dBTP or the ±12 dB setting", () => {
		expect(loudnessGainDb({ integratedLufs: -24, truePeakDb: -12, lra: 5 }, -14)).toEqual({ gainDb: 10, peakLimited: false });
		expect(loudnessGainDb({ integratedLufs: -24, truePeakDb: -4, lra: 5 }, -14)).toEqual({ gainDb: 3, peakLimited: true });
		expect(loudnessGainDb({ integratedLufs: -40, truePeakDb: -30, lra: 5 }, -14).gainDb).toBe(12);
		expect(loudnessGainDb({ integratedLufs: -8, truePeakDb: 0, lra: 5 }, -16).gainDb).toBe(-8);
	});

	it("mixes the recording through the cut, silence for a clip without sound", () => {
		const args = programmeLoudnessArgs(doc(), () => false)!;
		const graph = args[args.indexOf("-filter_complex") + 1]!;
		expect(graph).toContain("anullsrc");
		expect(graph).toContain("loudnorm=print_format=json");
		expect(args.filter((a) => a === "-i")).toHaveLength(0);
		const withSound = programmeLoudnessArgs(doc(), () => true)!;
		expect(withSound.join(" ")).toContain(`-i ${REC}`);
	});

	it("setLoudness sets the programme gain and reports what it expects", () => {
		const r = executeAgentTool(doc(), "setLoudness", JSON.stringify({ platform: "tiktok" }), {
			prepared: { loudness: { integratedLufs: -22, truePeakDb: -10, lra: 4 } },
		});
		expect(r.ok).toBe(true);
		expect(getEditorSettings(r.document!).audioGainDb).toBe(8);
		expect(JSON.parse(r.resultJson!)).toMatchObject({ targetLufs: -14, expectedLufs: -14, programmeGainDb: 8 });
		expect(executeAgentTool(doc(), "setLoudness", "{}", {}).ok).toBe(false);
	});
});

describe.skipIf(!FFMPEG)("platform loudness — real mix", () => {
	it("measures the programme", async () => {
		execFileSync(FFMPEG!, [
			"-v", "error", "-y",
			"-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30",
			"-f", "lavfi", "-i", "sine=frequency=500:duration=3,volume=-12dB",
			"-map", "0:v", "-map", "1:a", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", REC,
		]);
		const m = await measureProgrammeLoudness(doc(), FFMPEG!);
		expect(m).not.toBeNull();
		expect(m!.integratedLufs).toBeLessThan(-28);
		expect(m!.integratedLufs).toBeGreaterThan(-40);
	}, 30_000);
});
