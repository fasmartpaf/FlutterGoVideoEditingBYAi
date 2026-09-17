/**
 * Bounded ffmpeg scene-change probe — adapts watch-video `extract_frames` scene term
 * without whole-video explosion.
 * @see reuse/NOTICE.md
 */

import { spawn } from "node:child_process";
import { DEFAULT_SCENE_THRESHOLD } from "./constants";

/**
 * Return pts times (relative to media) where ffmpeg scene score exceeds threshold
 * inside [startSec, endSec]. Empty on failure (caller falls back to periodic+change).
 */
export async function probeSceneTimesInRange(input: {
	videoPath: string;
	ffmpegPath: string;
	startSourceTimeSec: number;
	endSourceTimeSec: number;
	sceneThreshold?: number;
}): Promise<number[]> {
	const start = Math.max(0, input.startSourceTimeSec);
	const end = Math.max(start, input.endSourceTimeSec);
	const thr = input.sceneThreshold ?? DEFAULT_SCENE_THRESHOLD;
	const duration = Math.max(0.05, end - start);
	const vf = `select='gt(scene\\,${thr})',showinfo`;
	const args = [
		"-hide_banner",
		"-loglevel",
		"info",
		"-ss",
		start.toFixed(3),
		"-t",
		duration.toFixed(3),
		"-i",
		input.videoPath,
		"-vf",
		vf,
		"-f",
		"null",
		"-",
	];

	const stderr = await new Promise<string>((resolve, reject) => {
		const child = spawn(input.ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
		let err = "";
		child.stderr?.on("data", (d) => {
			err += String(d);
		});
		child.on("error", reject);
		child.on("close", () => resolve(err));
	});

	const times: number[] = [];
	for (const m of stderr.matchAll(/pts_time:([0-9.]+)/g)) {
		const local = Number(m[1]);
		if (!Number.isFinite(local)) continue;
		// With -ss before -i, pts_time is often relative to the seek window.
		const abs = Math.round((start + local) * 1000) / 1000;
		if (abs >= start - 0.05 && abs <= end + 0.05) times.push(abs);
	}
	return [...new Set(times)].sort((a, b) => a - b);
}
