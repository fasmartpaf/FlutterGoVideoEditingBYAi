import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { insertClip } from "../../../src/lib/ai-edition/document/timeline";
import { createEmptyDocument, documentSchema, type AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { executeAgentTool } from "../agent-tools";
import {
	bakeDuckedAudio,
	duckGainExpr,
	mergeIntervals,
	speechBySilence,
	speechInFileTime,
	speechPlaybackIntervals,
	transcriptSpeech,
} from "./duck";

const FFMPEG = ["/usr/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].find((p) => existsSync(p)) ?? null;
const dir = mkdtempSync(join(tmpdir(), "duck-"));
const MUSIC = join(dir, "bed.mp3");
writeFileSync(MUSIC, "x");

function doc(): AxcutDocument {
	let d = createEmptyDocument({ title: "t", projectId: "p", createdAt: "2026-01-01T00:00:00.000Z" });
	d = {
		...d,
		assets: [
			{ id: "asset_v", kind: "video", label: "rec.mp4", originalPath: join(dir, "rec.mp4"), durationSec: 20, cameraTrack: null },
			{ id: "asset_m", kind: "audio", label: "bed.mp3", originalPath: MUSIC, durationSec: 60, cameraTrack: null },
		] as AxcutDocument["assets"],
		project: { ...d.project, primaryAssetId: "asset_v" },
		transcripts: [
			{
				assetId: "asset_v",
				language: "en",
				segments: [
					{ id: "s1", kind: "speech", startSec: 2, endSec: 4, text: "hi", wordIds: [] },
					{ id: "s2", kind: "silence", startSec: 4, endSec: 10, text: "", wordIds: [] },
					{ id: "s3", kind: "speech", startSec: 10, endSec: 12, text: "yo", wordIds: [] },
				],
				words: [],
			},
		],
	};
	d = insertClip(d, "asset_v", 0, "user", "rec");
	const clip = d.timeline.clips[0]!;
	return {
		...d,
		audioTracks: [
			{
				id: "trk_1",
				trackId: "trk_1",
				startMs: 0,
				endMs: 20000,
				clipId: clip.id,
				sourceStartSec: 0,
				sourceEndSec: 20,
				assetId: "asset_m",
				kind: "music",
				durationSec: 60,
				offsetMs: 5000,
				gainDb: -6,
				loop: false,
				fadeInMs: 0,
				fadeOutMs: 0,
				muted: false,
				label: "bed",
				origin: "user",
			},
		],
	};
}

describe("ducking — where the speech is", () => {
	it("merges close phrases", () => {
		expect(mergeIntervals([{ start: 5, end: 6 }, { start: 1, end: 2 }, { start: 2.3, end: 3 }])).toEqual([
			{ start: 1, end: 3 },
			{ start: 5, end: 6 },
		]);
	});

	it("maps the recording's speech onto the programme and into the music file's own time", () => {
		const d = doc();
		const onProgramme = speechPlaybackIntervals(d, transcriptSpeech(d));
		expect(onProgramme).toEqual([
			{ start: 2, end: 4 },
			{ start: 10, end: 12 },
		]);
		// the bed starts 5 s into its file
		expect(speechInFileTime(d, MUSIC, onProgramme)).toEqual([
			{ start: 7, end: 9 },
			{ start: 15, end: 17 },
		]);
	});

	it("builds a smooth gain envelope", () => {
		expect(duckGainExpr([], 12)).toBe("1");
		const e = duckGainExpr([{ start: 7, end: 9 }, { start: 15, end: 17 }], 12);
		expect(e.startsWith("1-0.749*max(clip((t-6.75)/0.25,0,1)")).toBe(true);
		expect(e).toContain("clip((17.5-t)/0.5,0,1)");
	});
});

describe("duckMusic tool", () => {
	it("swaps the track to the ducked copy, and undo swaps it back", () => {
		const ducked = join(dir, "bed-ducked.m4a");
		writeFileSync(ducked, "d");
		const r = executeAgentTool(doc(), "duckMusic", JSON.stringify({}), {
			prepared: { duck: [{ trackId: "trk_1", path: ducked, amountDb: 12, speechSpans: 2, speechSource: "transcript" }] },
		});
		expect(r.ok).toBe(true);
		const d = r.document!;
		expect(() => documentSchema.parse(d)).not.toThrow();
		const asset = d.assets.find((a) => a.id === d.audioTracks[0]!.assetId)!;
		expect(asset).toMatchObject({ originalPath: ducked, derived: { fromAssetId: "asset_m", kind: "duck", amountDb: 12 } });
		expect(JSON.parse(r.resultJson!).tracks[0]).toMatchObject({ duckedDb: 12, speechSpans: 2 });

		const back = executeAgentTool(d, "duckMusic", JSON.stringify({ undo: true }));
		expect(back.ok).toBe(true);
		expect(back.document!.audioTracks[0]!.assetId).toBe("asset_m");
		expect(back.document!.assets.some((a) => a.derived)).toBe(false);
	});

	it("says why nothing was ducked", () => {
		const looping = { ...doc(), audioTracks: doc().audioTracks.map((t) => ({ ...t, loop: true })) };
		const r = executeAgentTool(looping, "duckMusic", "{}", { prepared: { duck: [] } });
		expect(r.ok).toBe(false);
		const none = executeAgentTool({ ...doc(), audioTracks: [] }, "duckMusic", "{}", {});
		expect(none.ok).toBe(false);
	});
});

describe.skipIf(!FFMPEG)("ducking — real audio", () => {
	it("dips the music only where asked, and finds speech by level", async () => {
		const tone = join(dir, "tone.wav");
		execFileSync(FFMPEG!, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", tone]);
		const out = await bakeDuckedAudio({
			ffmpegPath: FFMPEG!,
			sourcePath: tone,
			speechInFile: [{ start: 3, end: 5 }],
			amountDb: 12,
			outDir: join(dir, "out"),
		});
		const level = (ss: number) => {
			const r = spawnSync(FFMPEG!, ["-hide_banner", "-ss", String(ss), "-t", "0.5", "-i", out, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
			return Number(/mean_volume:\s*(-?[\d.]+)/.exec(r.stderr)![1]);
		};
		expect(level(3.5) - level(1)).toBeLessThan(-10);
		expect(Math.abs(level(1) - -20)).toBeLessThan(3);

		// 2 s tone, 2 s silence, 2 s tone
		const talk = join(dir, "talk.wav");
		execFileSync(FFMPEG!, [
			"-v", "error", "-y",
			"-f", "lavfi", "-i", "sine=frequency=300:duration=2",
			"-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=2",
			"-f", "lavfi", "-i", "sine=frequency=300:duration=2",
			"-filter_complex", "[0][1][2]concat=n=3:v=0:a=1", talk,
		]);
		const speech = await speechBySilence(FFMPEG!, talk, 6);
		expect(speech).toHaveLength(2);
		expect(speech[0]!.end).toBeCloseTo(2, 0);
		expect(speech[1]!.start).toBeCloseTo(4, 0);
	}, 30_000);
});
