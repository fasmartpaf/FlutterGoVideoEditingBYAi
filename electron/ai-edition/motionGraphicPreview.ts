/**
 * Bake title plates into a short motion-graphic MP4 for the chat board
 * (create → preview in chat → place on video when asked).
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPlatePng } from "../../src/lib/ai-edition/document/graphicPlate";
import { pickH264Encoder, runProcess } from "./mediaStudio";
import { bakeStillToMp4, uniqueStem } from "./startThumbnail";

export type BakeMotionGraphicInput = {
	ffmpegPath: string;
	titles: string[];
	/** Output directory (created if missing). */
	outDir: string;
	width?: number;
	height?: number;
	/** Seconds per title card (default 1.8). */
	holdSec?: number;
	/** File name prefix; a unique suffix is always added so earlier previews survive. */
	fileStem?: string;
	signal?: AbortSignal;
};

export type BakeMotionGraphicResult = {
	mp4Path: string;
	durationSec: number;
	width: number;
	height: number;
	slideCount: number;
};

function even(n: number): number {
	const v = Math.max(2, Math.round(n));
	return v % 2 === 0 ? v : v + 1;
}

/**
 * Build a silent H.264 motion graphic: each title fades in/out with a slight
 * zoom, then clips are concatenated into one MP4 for chat preview. Async and
 * abortable; intermediate files live in a temp work dir that is always removed.
 */
export async function bakeMotionGraphicMp4(
	input: BakeMotionGraphicInput,
): Promise<BakeMotionGraphicResult> {
	const titles = input.titles.map((t) => t.trim()).filter(Boolean).slice(0, 12);
	if (titles.length === 0) {
		throw new Error("bakeMotionGraphicMp4 needs at least one title");
	}
	const width = even(input.width ?? 1280);
	const height = even(input.height ?? 720);
	const holdSec = Math.min(4, Math.max(1, input.holdSec ?? 1.8));
	const signal = input.signal;
	mkdirSync(input.outDir, { recursive: true });
	const work = mkdtempSync(join(tmpdir(), "os-motion-work-"));
	try {
		const encoder = await pickH264Encoder(input.ffmpegPath, signal);
		const segmentPaths: string[] = [];
		for (let i = 0; i < titles.length; i++) {
			const plate = renderPlatePng({
				kind: i === 0 ? "title" : "badge",
				text: titles[i]!,
				color: "#ffffff",
				backgroundColor: i === 0 ? "rgba(0,0,0,0.72)" : "rgba(17,24,39,0.94)",
			});
			const still = await bakeStillToMp4({
				ffmpegPath: input.ffmpegPath,
				image: plate,
				width,
				height,
				durationSec: holdSec,
				outDir: work,
				fileStem: `slide-${i}`,
				signal,
			});
			// Re-encode with a gentle zoom so it reads as motion, not a still dump.
			const zoomed = join(work, `zoom-${i}.mp4`);
			const frames = Math.max(30, Math.round(holdSec * 30));
			const vf =
				`scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
				`pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x0b1220,` +
				`zoompan=z='min(1.0+0.08*on/${frames},1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=30,` +
				`fade=t=in:st=0:d=0.35,fade=t=out:st=${Math.max(0.4, holdSec - 0.4)}:d=0.35,` +
				`setsar=1,format=yuv420p`;
			const zoom = await runProcess(
				input.ffmpegPath,
				["-y", "-i", still.mp4Path, "-vf", vf, "-c:v", encoder, "-an", "-t", String(holdSec), zoomed],
				{ timeoutMs: 120_000, signal },
			);
			segmentPaths.push(zoom.code === 0 && existsSync(zoomed) ? zoomed : still.mp4Path);
		}

		const listFile = join(work, "concat.txt");
		writeFileSync(
			listFile,
			segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
			"utf8",
		);
		const prefix = (input.fileStem ?? "motion-graphic").replace(/[^a-zA-Z0-9_-]+/g, "-") || "motion-graphic";
		const mp4Path = join(input.outDir, `${uniqueStem(prefix)}.mp4`);
		const concat = await runProcess(
			input.ffmpegPath,
			["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", mp4Path],
			{ timeoutMs: 120_000, signal },
		);
		if (concat.code !== 0 || !existsSync(mp4Path)) {
			// Re-encode concat if stream copy fails across encoders.
			const retry = await runProcess(
				input.ffmpegPath,
				[
					"-y",
					"-f",
					"concat",
					"-safe",
					"0",
					"-i",
					listFile,
					"-c:v",
					encoder,
					"-pix_fmt",
					"yuv420p",
					"-an",
					mp4Path,
				],
				{ timeoutMs: 180_000, signal },
			);
			if (retry.code !== 0 || !existsSync(mp4Path)) {
				rmSync(mp4Path, { force: true });
				const err = (retry.stderr || concat.stderr || "ffmpeg concat failed").slice(-600);
				throw new Error(`Could not bake motion graphic: ${err}`);
			}
		}

		return {
			mp4Path,
			durationSec: holdSec * titles.length,
			width,
			height,
			slideCount: titles.length,
		};
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

/** Fallback out dir when project media path is missing. */
export function motionGraphicFallbackDir(projectId: string): string {
	return join(tmpdir(), "openscreen-generated-graphics", projectId);
}
