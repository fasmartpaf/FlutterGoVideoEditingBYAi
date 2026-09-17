/**
 * Deterministic parse of FFmpeg silencedetect stderr lines.
 *
 * Expected forms:
 *   silence_start: 1.234
 *   silence_end: 3.456 | silence_duration: 2.222
 */

import type { SilenceInterval } from "./types";

const START_RE = /silence_start:\s*([0-9]+(?:\.[0-9]+)?)/i;
const END_RE =
	/silence_end:\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\|\s*silence_duration:\s*([0-9]+(?:\.[0-9]+)?))?/i;

export function parseSilencedetectStderr(stderr: string): SilenceInterval[] {
	const lines = stderr.split(/\r?\n/);
	const out: SilenceInterval[] = [];
	let openStart: number | null = null;

	for (const line of lines) {
		const start = line.match(START_RE);
		if (start) {
			openStart = Number(start[1]);
			continue;
		}
		const end = line.match(END_RE);
		if (end && openStart != null) {
			const endSec = Number(end[1]);
			const durationFromLog = end[2] != null ? Number(end[2]) : endSec - openStart;
			const durationSec =
				Number.isFinite(durationFromLog) && durationFromLog > 0
					? durationFromLog
					: Math.max(0, endSec - openStart);
			if (endSec > openStart) {
				out.push({
					startSec: openStart,
					endSec,
					durationSec,
					source: "ffmpeg_silencedetect",
				});
			}
			openStart = null;
		}
	}

	// Unclosed silence through EOF is ignored — duration unknown without media end.
	return out;
}

export function parseFfmpegVersionBanner(stderrOrStdout: string): string | null {
	const m = stderrOrStdout.match(/ffmpeg version\s+([^\s]+)/i);
	return m?.[1] ?? null;
}
