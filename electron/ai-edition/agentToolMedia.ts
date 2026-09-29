/**
 * The async "media studio" step that runs BEFORE `executeAgentTool`.
 *
 * `executeAgentTool` is synchronous on purpose — it is the one gate every
 * document mutation passes through. Rendering video, probing media and
 * shrinking big images are slow, so they happen here, off the main thread's
 * critical path (async child processes), abortable by the chat Stop button.
 * The executor then only consumes finished files via `options.prepared`.
 */

import { existsSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import {
	MAX_GRAPHIC_IMAGE_BYTES,
	assertImageDataUri,
	graphicCaption,
	loadImageFileAsDataUri,
	renderPlatePng,
} from "../../src/lib/ai-edition/document/graphicPlate";
import type { AxcutDocument } from "../../src/lib/ai-edition/schema";
import { assertSafeLocalMediaPath, probeMediaDurationSec, shrinkImageFile } from "./mediaStudio";
import { bakeMotionGraphicMp4 } from "./motionGraphicPreview";
import {
	bakeStillToMp4,
	canvasSizeFromDocument,
	findStartThumbnailClip,
	uniqueStem,
} from "./startThumbnail";

/** Results of async media work, handed to the synchronous executor. */
export interface PreparedToolMedia {
	startThumbnail?: { mp4Path: string; durationSec: number; width: number; height: number };
	motionGraphic?: {
		mp4Path: string;
		durationSec: number;
		width: number;
		height: number;
		slideCount: number;
		exportDir: string;
	};
	/** ffprobe'd duration for importMedia (null = probe failed). */
	mediaDurationSec?: number | null;
	/** A render was attempted and failed — the executor reports this message. */
	renderError?: string;
}

export interface PreparedToolCall {
	/** Tool args, possibly with oversized image paths swapped for shrunk copies. */
	args: unknown;
	prepared: PreparedToolMedia;
	/** Files created for this call; delete them if the executor refuses the call. */
	discardOnFailure: string[];
}

/**
 * Where generated media for a project lives. Next to the project's recordings:
 *  - …/openscreen/recordings/x.mp4 → …/openscreen/generated-graphics/<projectId>
 *  - ~/Movies/demo.mov            → ~/Movies/generated-graphics/<projectId>
 * Only a project with no media at all falls back to the temp dir.
 */
export function resolveGeneratedGraphicsDir(document: AxcutDocument): string {
	const asset = document.assets.find(
		(a) => typeof a.originalPath === "string" && a.originalPath && !/^https?:\/\//i.test(a.originalPath),
	);
	const mediaPath = asset?.originalPath;
	const projectId = String(document.project.id ?? "project").replace(/[^a-zA-Z0-9_-]/g, "_");
	// Only an absolute path is trusted. A relative one (e.g. a Windows "C:/…"
	// path read on macOS) would otherwise create folders under the process cwd.
	if (mediaPath && isAbsolute(mediaPath)) {
		const mediaDir = dirname(mediaPath);
		const root = basename(mediaDir).toLowerCase() === "recordings" ? dirname(mediaDir) : mediaDir;
		return join(root, "generated-graphics", projectId);
	}
	return join(tmpdir(), "openscreen-generated-graphics", projectId);
}

/** Persistent cache for downscaled copies of oversized stills. */
function shrinkCacheDir(document: AxcutDocument): string {
	return join(resolveGeneratedGraphicsDir(document), ".shrunk");
}

const IMAGE_PATH_KEYS = ["imagePath", "characterPath"] as const;
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

async function shrinkIfOversized(
	document: AxcutDocument,
	value: unknown,
	ffmpegPath: string | null,
	signal: AbortSignal | undefined,
): Promise<unknown> {
	if (typeof value !== "string" || !value.trim()) return value;
	const raw = value.trim();
	if (raw.startsWith("data:") || raw.startsWith("/wallpapers/")) return value;
	if (!IMAGE_EXTS.has(extname(raw).toLowerCase())) return value;
	// Relative paths and protocol URLs are refused by the executor with a clear
	// message; only safe absolute files are touched here.
	let abs: string;
	try {
		abs = assertSafeLocalMediaPath(raw);
	} catch {
		return value;
	}
	if (!existsSync(abs) || statSync(abs).size <= MAX_GRAPHIC_IMAGE_BYTES || !ffmpegPath) {
		return value;
	}
	const shrunk = await shrinkImageFile({
		ffmpegPath,
		sourcePath: abs,
		cacheDir: shrinkCacheDir(document),
		maxBytes: MAX_GRAPHIC_IMAGE_BYTES,
		signal,
	});
	return shrunk ?? value;
}

async function shrinkImageArgs(
	document: AxcutDocument,
	name: string,
	args: unknown,
	ffmpegPath: string | null,
	signal: AbortSignal | undefined,
): Promise<unknown> {
	if (!args || typeof args !== "object") return args;
	const next: Record<string, unknown> = { ...(args as Record<string, unknown>) };
	for (const key of IMAGE_PATH_KEYS) {
		if (key in next) next[key] = await shrinkIfOversized(document, next[key], ffmpegPath, signal);
	}
	if (name === "setBackground" && "wallpaper" in next) {
		next.wallpaper = await shrinkIfOversized(document, next.wallpaper, ffmpegPath, signal);
	}
	return next;
}

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Do the slow media work for one tool call. Never throws for bad args — the
 * executor validates those and reports them; only aborts propagate. A render
 * failure is returned as `undefined` prepared data so the executor reports it.
 */
export async function prepareAgentToolMedia(
	document: AxcutDocument,
	name: string,
	args: unknown,
	options: {
		ffmpegPath: string | null;
		signal?: AbortSignal;
		/** False when this turn may not mutate — skip renders nobody can place. */
		mayMutate: boolean;
	},
): Promise<PreparedToolCall> {
	const { ffmpegPath, signal } = options;
	const prepared: PreparedToolMedia = {};
	const discardOnFailure: string[] = [];
	const nextArgs = await shrinkImageArgs(document, name, args, ffmpegPath, signal);
	const a = (nextArgs ?? {}) as Record<string, unknown>;

	if (name === "importMedia") {
		const path = str(a.path);
		if (path && ffmpegPath) {
			try {
				const abs = assertSafeLocalMediaPath(path, "importMedia path");
				if (existsSync(abs)) {
					prepared.mediaDurationSec = await probeMediaDurationSec(ffmpegPath, abs, signal);
				}
			} catch (err) {
				if (err instanceof Error && err.name === "AbortError") throw err;
			}
		}
	}

	if (name === "insertStartThumbnail" && options.mayMutate && ffmpegPath) {
		const existing = findStartThumbnailClip(document);
		if (!existing || a.replace === true) {
			let image: string | null = null;
			try {
				const imagePath = str(a.imagePath);
				if (imagePath) {
					image = loadImageFileAsDataUri(assertSafeLocalMediaPath(imagePath, "imagePath"));
				} else if (str(a.image)) {
					image = assertImageDataUri(str(a.image)!);
				} else {
					const caption = graphicCaption(str(a.text) ?? "", str(a.subtext));
					if (caption) {
						image = renderPlatePng({
							kind: "intro",
							text: caption,
							color: "#ffffff",
							backgroundColor: "rgba(0,0,0,0.92)",
						});
					}
				}
			} catch {
				image = null; // executor reports the bad input
			}
			if (image) {
				const { width, height } = canvasSizeFromDocument(document);
				try {
					const baked = await bakeStillToMp4({
						ffmpegPath,
						image,
						width,
						height,
						durationSec: num(a.durationSec) ?? 2.5,
						outDir: resolveGeneratedGraphicsDir(document),
						fileStem: uniqueStem("start-thumbnail"),
						signal,
					});
					prepared.startThumbnail = baked;
					discardOnFailure.push(baked.mp4Path);
				} catch (err) {
					if (err instanceof Error && err.name === "AbortError") throw err;
					prepared.renderError = err instanceof Error ? err.message : String(err);
				}
			}
		}
	}

	if (name === "createMotionGraphicPreview" && ffmpegPath) {
		const titles = Array.isArray(a.titles)
			? a.titles.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
			: [];
		if (titles.length > 0) {
			const exportDir = resolveGeneratedGraphicsDir(document);
			const canvas = canvasSizeFromDocument(document);
			const width = Math.min(1280, canvas.width || 1280);
			const height = Math.round(width * ((canvas.height || 720) / (canvas.width || 1280)));
			try {
				const baked = await bakeMotionGraphicMp4({
					ffmpegPath,
					titles,
					outDir: exportDir,
					width,
					height,
					holdSec: num(a.holdSec),
					fileStem: str(a.fileStem) ?? "motion-graphic",
					signal,
				});
				prepared.motionGraphic = { ...baked, exportDir };
			} catch (err) {
				if (err instanceof Error && err.name === "AbortError") throw err;
				prepared.renderError = err instanceof Error ? err.message : String(err);
			}
		}
	}

	return { args: nextArgs, prepared, discardOnFailure };
}

/** Remove files a refused/failed tool call left behind. */
export function discardPreparedFiles(paths: string[]): void {
	for (const p of paths) {
		try {
			rmSync(p, { force: true });
		} catch {
			// best effort
		}
	}
}
