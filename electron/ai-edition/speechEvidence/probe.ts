/**
 * Probe whether a media file has a decodable audio stream — without claiming
 * anything about speech content or STT availability.
 */

import { spawn } from "node:child_process";
import { resolveFfmpeg } from "../../media/audioPeaks";

export type AudioStreamProbe =
	| { present: true; codec?: string; sampleRate?: number; channels?: number }
	| { present: false; reason: string }
	| { present: null; reason: string };

/**
 * Uses ffmpeg -i parse of stderr (same binary as STT extraction). Does not
 * decode samples — only container metadata / stream listing.
 */
export async function probeAudioStream(filePath: string): Promise<AudioStreamProbe> {
	const ffmpeg = resolveFfmpeg();
	if (!ffmpeg) {
		return { present: null, reason: "ffmpeg unavailable for audio probe" };
	}
	return new Promise((resolve) => {
		const child = spawn(ffmpeg, ["-hide_banner", "-i", filePath], {
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			resolve({ present: null, reason: "audio probe timed out" });
		}, 15_000);
		child.on("close", () => {
			clearTimeout(timer);
			const audioLine = stderr.split("\n").find((line) => /Stream\s+#\d+:\d+.*Audio:/i.test(line));
			if (!audioLine) {
				resolve({ present: false, reason: "no audio stream in container" });
				return;
			}
			const codec = audioLine.match(/Audio:\s*([^\s,(]+)/i)?.[1];
			const sampleRate = Number(audioLine.match(/(\d+)\s*Hz/i)?.[1] ?? NaN);
			const channels = /\bstereo\b/i.test(audioLine)
				? 2
				: /\bmono\b/i.test(audioLine)
					? 1
					: undefined;
			resolve({
				present: true,
				...(codec ? { codec } : {}),
				...(Number.isFinite(sampleRate) ? { sampleRate } : {}),
				...(channels != null ? { channels } : {}),
			});
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			resolve({ present: null, reason: err.message });
		});
	});
}
