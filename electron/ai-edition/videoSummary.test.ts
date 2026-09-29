// The recording's one-time analysis: what it finds, that it is saved and reused.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { insertClip } from "../../src/lib/ai-edition/document/timeline";
import { type AxcutDocument, createEmptyDocument } from "../../src/lib/ai-edition/schema";
import { executeAgentTool } from "./agent-tools";
import { prepareAgentToolMedia } from "./agentToolMedia";
import { TEST_FFMPEG } from "./testing/ffmpegForTests";
import { ensureVideoSummary, pickKeyFrameTimes, readSavedVideoSummary, videoSummaryForAgent } from "./videoSummary";

const scratch: string[] = [];
afterEach(() => {
	for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** 7 s: still blue (0–2) · moving pattern (2–5) · still red (5–7); tone · silence (2–4) · tone. */
function fixture(): AxcutDocument {
	const root = mkdtempSync(join(tmpdir(), "os-video-summary-"));
	scratch.push(root);
	mkdirSync(join(root, "recordings"));
	const video = join(root, "recordings", "rec.mp4");
	const r = spawnSync(TEST_FFMPEG!, [
		"-v", "error", "-y",
		"-f", "lavfi", "-i", "color=c=blue:s=320x180:d=2:r=15",
		"-f", "lavfi", "-i", "testsrc2=s=320x180:d=3:r=15",
		"-f", "lavfi", "-i", "color=c=red:s=320x180:d=2:r=15",
		"-f", "lavfi", "-i", "sine=f=440:d=2",
		"-f", "lavfi", "-i", "aevalsrc=0:d=2",
		"-f", "lavfi", "-i", "sine=f=440:d=3",
		"-filter_complex", "[0][1][2]concat=n=3:v=1:a=0[v];[3][4][5]concat=n=3:v=0:a=1[a]",
		"-map", "[v]", "-map", "[a]", "-pix_fmt", "yuv420p", "-c:a", "aac", video,
	]);
	if (r.status !== 0) throw new Error(String(r.stderr));
	let doc = createEmptyDocument({ title: "t", projectId: "proj_vs", createdAt: "2026-01-01T00:00:00.000Z" });
	doc = {
		...doc,
		assets: [
			{ id: "asset_rec", kind: "video", label: "rec.mp4", originalPath: video, durationSec: 7, cameraTrack: null } as AxcutDocument["assets"][number],
		],
		project: { ...doc.project, primaryAssetId: "asset_rec" },
	};
	return insertClip(doc, "asset_rec", 0, "user", "Recording");
}

describe("pickKeyFrameTimes", () => {
	it("spreads frames over the video, just after screen changes when there are some", () => {
		expect(pickKeyFrameTimes(30, [])).toEqual([2.5, 7.5, 12.5, 17.5, 22.5, 27.5]);
		expect(pickKeyFrameTimes(30, [11])[2]).toBeCloseTo(11.6, 5);
		expect(pickKeyFrameTimes(4, [])).toHaveLength(1);
	});
});

describe.skipIf(!TEST_FFMPEG)("video summary", () => {
	it("finds the still stretches, the screen changes and the silence, and saves them", async () => {
		const doc = fixture();
		expect(readSavedVideoSummary(doc)).toBeNull();
		const s = (await ensureVideoSummary(doc, { ffmpegPath: TEST_FFMPEG }))!;
		expect(s.source.durationSec).toBeCloseTo(7, 0);
		// The two still screens.
		expect(s.stillStretches.some(([a, b]) => a < 0.3 && b > 1.7 && b < 2.4)).toBe(true);
		expect(s.stillStretches.some(([a, b]) => a > 4.6 && a < 5.4 && b > 6.5)).toBe(true);
		// Blue → pattern and pattern → red.
		expect(s.screenChanges.some((t) => Math.abs(t - 2) < 0.3)).toBe(true);
		expect(s.screenChanges.some((t) => Math.abs(t - 5) < 0.3)).toBe(true);
		// The silent middle.
		expect(s.hasAudio).toBe(true);
		expect(s.silences.some(([a, b]) => Math.abs(a - 2) < 0.3 && Math.abs(b - 4) < 0.3)).toBe(true);
		expect(s.keyFrames.length).toBeGreaterThan(0);
		expect(s.keyFrames.every((f) => existsSync(f.path))).toBe(true);
		// Saved: a second call reads it back instead of analysing again.
		const again = await ensureVideoSummary(doc, { ffmpegPath: "/nonexistent/ffmpeg" });
		expect(again?.builtAt).toBe(s.builtAt);
		const forAgent = videoSummaryForAgent(s, doc);
		expect((forAgent.hints as string[]).join(" ")).toMatch(/sits still/);
		expect((forAgent.hints as string[]).join(" ")).toMatch(/No transcript yet/);
	}, 60_000);

	it("is an agent tool: prepared in the media step, returned by the executor", async () => {
		const doc = fixture();
		const prep = await prepareAgentToolMedia(doc, "getVideoSummary", {}, { ffmpegPath: TEST_FFMPEG!, mayMutate: false });
		const r = executeAgentTool(doc, "getVideoSummary", "{}", { prepared: prep.prepared });
		expect(r.ok).toBe(true);
		const payload = JSON.parse(r.resultJson);
		expect(payload.durationSec).toBeCloseTo(7, 0);
		expect(payload.keyFrames.length).toBeGreaterThan(0);
		expect(r.document).toBeUndefined();
	}, 60_000);
});
