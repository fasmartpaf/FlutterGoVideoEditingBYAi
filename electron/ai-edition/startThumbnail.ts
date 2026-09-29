/**
 * Bake a still (PNG/JPEG path or data URI) into a short H.264 MP4 that matches
 * the project canvas, then insert it as the FIRST timeline clip so the
 * recording plays after a real opening segment — not as an annotation overlay.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AxcutDocument } from "../../src/lib/ai-edition/schema";
import { createId } from "../../src/lib/ai-edition/document/ids";
import { insertClip, removeClip } from "../../src/lib/ai-edition/document/timeline";
import { pickH264Encoder, runProcess } from "./mediaStudio";

export type BakeStillVideoInput = {
	ffmpegPath: string;
	/** Absolute path to PNG/JPEG/WebP, or a data:image/…;base64,… URI. */
	image: string;
	width: number;
	height: number;
	durationSec: number;
	/**
	 * Where the MP4 is written. Pass the project's generated-graphics folder for
	 * anything that ends up on the timeline — the OS temp dir is purged on reboot.
	 */
	outDir?: string;
	/** Output file name without extension (default: unique start-thumbnail-…). */
	fileStem?: string;
	signal?: AbortSignal;
};

export type BakeStillVideoResult = {
	mp4Path: string;
	durationSec: number;
	width: number;
	height: number;
};

const DATA_URI = /^data:image\/(png|jpeg|jpg|webp);base64,/i;

function even(n: number): number {
	const v = Math.max(2, Math.round(n));
	return v % 2 === 0 ? v : v + 1;
}

function materializeImage(image: string, dir: string): string {
	const trimmed = image.trim();
	const match = DATA_URI.exec(trimmed);
	if (match) {
		const ext = match[1]!.toLowerCase() === "png" ? "png" : "jpg";
		const out = join(dir, `still.${ext}`);
		writeFileSync(out, Buffer.from(trimmed.slice(match[0].length), "base64"));
		return out;
	}
	if (!existsSync(trimmed)) {
		throw new Error(`start thumbnail image not found: ${trimmed}`);
	}
	return trimmed;
}

/** Unique, sortable stem so a new bake never overwrites a file an older chat message shows. */
export function uniqueStem(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Encode a still as a silent MP4 that fills (width × height) for durationSec.
 * Aspect-fit with letterbox/pillarbox so nothing is cropped. Async: never
 * blocks the main process, and stops when `signal` aborts.
 */
export async function bakeStillToMp4(input: BakeStillVideoInput): Promise<BakeStillVideoResult> {
	const width = even(input.width);
	const height = even(input.height);
	const durationSec = Math.min(30, Math.max(0.5, input.durationSec));
	const dir = input.outDir ?? mkdtempSync(join(tmpdir(), "os-start-thumb-"));
	mkdirSync(dir, { recursive: true });
	// The decoded still is scratch — keep it out of the user's folder.
	const scratch = mkdtempSync(join(tmpdir(), "os-still-"));
	try {
		const src = materializeImage(input.image, scratch);
		const stem = (input.fileStem ?? uniqueStem("start-thumbnail")).replace(/[^a-zA-Z0-9_-]+/g, "-");
		const mp4Path = join(dir, `${stem}.mp4`);
		const encoder = await pickH264Encoder(input.ffmpegPath, input.signal);
		const vf =
			`scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
			`pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x000000,` +
			`setsar=1,fps=30`;
		const result = await runProcess(
			input.ffmpegPath,
			[
				"-y",
				"-loop",
				"1",
				"-i",
				src,
				"-t",
				String(durationSec),
				"-vf",
				vf,
				"-c:v",
				encoder,
				"-pix_fmt",
				"yuv420p",
				"-an",
				mp4Path,
			],
			{ timeoutMs: 120_000, signal: input.signal },
		);
		if (result.code !== 0 || !existsSync(mp4Path)) {
			rmSync(mp4Path, { force: true });
			const err = (result.stderr || result.stdout || "ffmpeg failed").slice(-600);
			throw new Error(`Could not bake start thumbnail video (${encoder}): ${err}`);
		}
		return { mp4Path, durationSec, width, height };
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

export function canvasSizeFromDocument(document: AxcutDocument): { width: number; height: number } {
	const primaryId = document.project.primaryAssetId;
	const primary =
		(primaryId ? document.assets.find((a) => a.id === primaryId) : null) ??
		document.assets.find((a) => a.kind === "video");
	const w = primary?.video?.width;
	const h = primary?.video?.height;
	if (typeof w === "number" && w > 0 && typeof h === "number" && h > 0) {
		return { width: w, height: h };
	}
	return { width: 1920, height: 1080 };
}

export type InsertStartThumbnailArgs = {
	mp4Path: string;
	durationSec: number;
	label?: string;
	/** Drop near-full-bleed image overlays that cover the first seconds (default true). */
	removeStartOverlays?: boolean;
	/**
	 * When true, delete an existing opening start-thumbnail clip before inserting.
	 * Default false — a second opener is refused so polish turns do not stack covers.
	 */
	replace?: boolean;
};

/** True when this clip is an agent-baked (or labelled) full-frame opening cover. */
export function isStartThumbnailClip(document: AxcutDocument, clipIndex: number): boolean {
	const clip = document.timeline.clips[clipIndex];
	if (!clip) return false;
	const asset = document.assets.find((a) => a.id === clip.assetId);
	const reason = (clip.reason ?? "").toLowerCase();
	const label = (asset?.label ?? "").toLowerCase();
	const path = (asset?.originalPath ?? "").replace(/\\/g, "/").toLowerCase();
	if (reason.includes("start thumbnail") || label.includes("start thumbnail")) return true;
	if (path.includes("start-thumbnail") || path.includes("os-start-thumb")) return true;
	return false;
}

/** First opening start-thumbnail on the timeline (usually index 0), if any. */
export function findStartThumbnailClip(
	document: AxcutDocument,
): { clipId: string; assetId: string; index: number; label: string } | null {
	for (let i = 0; i < Math.min(3, document.timeline.clips.length); i++) {
		if (!isStartThumbnailClip(document, i)) continue;
		const clip = document.timeline.clips[i]!;
		const asset = document.assets.find((a) => a.id === clip.assetId);
		return {
			clipId: clip.id,
			assetId: clip.assetId,
			index: i,
			label: asset?.label ?? clip.reason,
		};
	}
	return null;
}

/**
 * Add the baked MP4 as a video asset and insert it as timeline clip index 0.
 * Optionally strips full-bleed image annotations that start near 0s (the old overlay mistake).
 */
export function insertStartThumbnailClip(
	document: AxcutDocument,
	args: InsertStartThumbnailArgs,
): { document: AxcutDocument; assetId: string; clipId: string; removedAnnotationIds: string[] } {
	let working = document;
	if (args.replace) {
		const existing = findStartThumbnailClip(working);
		if (existing) {
			working = removeClip(working, existing.clipId);
		}
	}

	const abs = args.mp4Path.trim();
	if (!existsSync(abs)) {
		throw new Error(`start thumbnail mp4 not found: ${abs}`);
	}
	const assetId = createId("asset");
	const label = args.label?.trim() || "Start thumbnail";
	const asset = {
		id: assetId,
		kind: "video" as const,
		label,
		originalPath: abs,
		durationSec: args.durationSec,
		cameraTrack: null,
	};
	let next: AxcutDocument = {
		...working,
		assets: [...working.assets, asset],
		project: {
			...working.project,
			updatedAt: new Date().toISOString(),
		},
	};
	const beforeIds = new Set(next.timeline.clips.map((c) => c.id));
	next = insertClip(next, assetId, 0, "agent", "Start thumbnail (full frame)");
	const clipId = next.timeline.clips.find((c) => !beforeIds.has(c.id))?.id;
	if (!clipId) {
		throw new Error("Failed to insert start thumbnail clip");
	}

	const removedAnnotationIds: string[] = [];
	const removeOverlays = args.removeStartOverlays !== false;
	if (removeOverlays) {
		const keep = next.annotations.filter((a) => {
			const startMs = a.startMs ?? 0;
			const endMs = a.endMs ?? 0;
			const w = a.size?.width ?? 0;
			const h = a.size?.height ?? 0;
			const isStartCover =
				a.type === "image" &&
				startMs <= 500 &&
				endMs - startMs >= 800 &&
				w >= 70 &&
				h >= 70;
			if (isStartCover) {
				removedAnnotationIds.push(a.id);
				return false;
			}
			return true;
		});
		if (removedAnnotationIds.length > 0) {
			next = { ...next, annotations: keep };
		}
	}

	return { document: next, assetId, clipId, removedAnnotationIds };
}
