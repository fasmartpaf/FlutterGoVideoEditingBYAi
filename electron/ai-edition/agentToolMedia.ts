/**
 * The async "media studio" step that runs BEFORE `executeAgentTool`.
 *
 * `executeAgentTool` is synchronous on purpose — it is the one gate every
 * document mutation passes through. Rendering video, probing media and
 * shrinking big images are slow, so they happen here, off the main thread's
 * critical path (async child processes), abortable by the chat Stop button.
 * The executor then only consumes finished files via `options.prepared`.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { sequenceFrameName } from "../../src/lib/ai-edition/document/imageSequence";
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
import { type BrandKit, DEFAULT_BRAND_KIT, storedBrandKit } from "./motionStudio/brandKit";
import { deriveBrandKitFromVideo } from "./motionStudio/videoPalette";
import { writeComposition } from "./motionStudio/composition";
import { type FrameSource, renderComposition, renderSequence } from "./motionStudio/render";
import {
	MOTION_TEMPLATE_IDS,
	type MotionTemplateId,
	OVERLAY_DEFAULT_SEC,
	OVERLAY_TEMPLATE_IDS,
	type OverlayTemplateId,
	renderOverlayTemplate,
	renderTemplate,
	TEMPLATE_DEFAULT_SEC,
} from "./motionStudio/templates";
import { type MotionClipCheck, verifyMotionClip } from "./motionStudio/verify";
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
	/** Brand colours read from the recording (used when the project has no brand kit yet). */
	videoBrandKit?: BrandKit;
	/** addMotionOverlay: the rendered transparent PNG sequence. */
	motionOverlay?: {
		dir: string;
		fps: number;
		frameCount: number;
		durationSec: number;
		/** A frame with the overlay fully in, as a data URI (poster for stills-only readers). */
		posterDataUri: string;
		/** Absolute path of that poster frame, for the agent to look at. */
		posterPath: string;
		pageErrors: string[];
	};
	/** createMotionClip: the rendered clip and its automatic check. */
	motionClip?: {
		mp4Path: string;
		durationSec: number;
		width: number;
		height: number;
		fps: number;
		label: string;
		check: MotionClipCheck;
		pageErrors: string[];
	};
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
		/** Opens a page renderer for HTML motion graphics (Electron off-screen in the app). */
		createFrameSource?: () => Promise<FrameSource | null>;
	},
): Promise<PreparedToolCall> {
	const { ffmpegPath, signal } = options;
	const prepared: PreparedToolMedia = {};
	const discardOnFailure: string[] = [];
	const nextArgs = await shrinkImageArgs(document, name, args, ffmpegPath, signal);
	const a = (nextArgs ?? {}) as Record<string, unknown>;

	// Graphics follow the video's own colours until someone sets a brand kit.
	const wantsVideoKit =
		name === "setBrandKit" ? a.fromVideo === true : BRAND_KIT_TOOLS.has(name) && !storedBrandKit(document);
	if (wantsVideoKit && ffmpegPath) {
		try {
			const kit = await deriveBrandKitFromVideo(document, ffmpegPath, signal);
			if (kit) prepared.videoBrandKit = kit;
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") throw err;
		}
	}
	const kit = storedBrandKit(document) ?? prepared.videoBrandKit ?? DEFAULT_BRAND_KIT;

	if (name === "importMedia" || name === "placeMotionClip") {
		const path = str(a.path) ?? str(a.videoPath);
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

	if (name === "addMotionOverlay" && options.mayMutate) {
		try {
			const overlay = await renderMotionOverlay(document, a, kit, { signal, createFrameSource: options.createFrameSource });
			if (overlay) {
				prepared.motionOverlay = overlay;
				discardOnFailure.push(overlay.dir);
			}
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") throw err;
			prepared.renderError = err instanceof Error ? err.message : String(err);
		}
	}

	if (name === "createMotionClip" && ffmpegPath) {
		try {
			const clip = await renderMotionClip(document, a, kit, {
				ffmpegPath,
				signal,
				createFrameSource: options.createFrameSource,
			});
			if (clip) {
				prepared.motionClip = clip;
				discardOnFailure.push(clip.mp4Path);
			}
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") throw err;
			prepared.renderError = err instanceof Error ? err.message : String(err);
		}
	}

	return { args: nextArgs, prepared, discardOnFailure };
}

/** addMotionOverlay: template or agent HTML → transparent PNG sequence sized to the overlay box. */
async function renderMotionOverlay(
	document: AxcutDocument,
	a: Record<string, unknown>,
	kit: BrandKit,
	options: { signal?: AbortSignal; createFrameSource?: () => Promise<FrameSource | null> },
): Promise<PreparedToolMedia["motionOverlay"] | null> {
	const template = str(a.template);
	const html = typeof a.html === "string" && a.html.trim() ? a.html : undefined;
	const htmlPath = str(a.htmlPath);
	if (!template && !html && !htmlPath) return null;
	if (template && !(OVERLAY_TEMPLATE_IDS as readonly string[]).includes(template)) {
		throw new Error(`Unknown overlay template "${template}". Use one of: ${OVERLAY_TEMPLATE_IDS.join(", ")}`);
	}
	const wPct = num(a.width);
	const hPct = num(a.height);
	if (!wPct || !hPct) return null; // executor reports the missing box
	if (!options.createFrameSource) throw new Error("The motion renderer is not available in this build.");
	const canvas = canvasSizeFromDocument(document);
	// The box is a % of the recording (annotations anchor to the screen rect).
	const width = Math.max(16, Math.round(((canvas.width || 1920) * Math.min(100, wPct)) / 100));
	const height = Math.max(16, Math.round(((canvas.height || 1080) * Math.min(100, hPct)) / 100));
	const durationSec = Math.min(
		30,
		Math.max(0.6, num(a.durationSec) ?? (template ? OVERLAY_DEFAULT_SEC[template as OverlayTemplateId] : 3)),
	);
	const fps = Math.min(30, Math.max(12, Math.round(num(a.fps) ?? 30)));
	const source = template
		? { html: renderOverlayTemplate(template as OverlayTemplateId, a.params ?? {}, kit, { width, height, durationSec }) }
		: htmlPath
			? { htmlPath }
			: { html: html! };
	const frameSource = await options.createFrameSource();
	if (!frameSource) throw new Error("Could not start the motion renderer.");
	const composition = writeComposition(source, { width, height, background: "transparent" });
	const dir = join(resolveGeneratedGraphicsDir(document), "overlays", uniqueStem(`overlay-${template ?? "custom"}`));
	try {
		const seq = await renderSequence({
			source: frameSource,
			compositionPath: composition.path,
			width,
			height,
			fps,
			durationSec,
			outDir: dir,
			signal: options.signal,
		});
		// Poster: 70 % in — past the entrance, before the exit.
		const posterIndex = Math.min(seq.frameCount - 1, Math.floor(seq.frameCount * 0.7));
		const posterPath = join(dir, sequenceFrameName(posterIndex));
		const posterDataUri = `data:image/png;base64,${readFileSync(posterPath).toString("base64")}`;
		return {
			dir,
			fps: seq.fps,
			frameCount: seq.frameCount,
			durationSec: seq.durationSec,
			posterDataUri,
			posterPath,
			pageErrors: seq.pageErrors,
		};
	} catch (err) {
		rmSync(dir, { recursive: true, force: true });
		throw err;
	} finally {
		composition.dispose();
	}
}

/** createMotionClip: template or agent HTML → MP4 in the project folder, then checked. */
async function renderMotionClip(
	document: AxcutDocument,
	a: Record<string, unknown>,
	kit: BrandKit,
	options: {
		ffmpegPath: string;
		signal?: AbortSignal;
		createFrameSource?: () => Promise<FrameSource | null>;
	},
): Promise<PreparedToolMedia["motionClip"] | null> {
	const template = str(a.template);
	const html = typeof a.html === "string" && a.html.trim() ? a.html : undefined;
	const htmlPath = str(a.htmlPath);
	if (!template && !html && !htmlPath) return null; // executor explains the missing input
	if (template && !(MOTION_TEMPLATE_IDS as readonly string[]).includes(template)) {
		throw new Error(`Unknown template "${template}". Use one of: ${MOTION_TEMPLATE_IDS.join(", ")}`);
	}
	if (!options.createFrameSource) throw new Error("The motion renderer is not available in this build.");
	const canvas = canvasSizeFromDocument(document);
	const width = Math.round(canvas.width || 1920);
	const height = Math.round(canvas.height || 1080);
	const fps = Math.min(60, Math.max(24, Math.round(num(a.fps) ?? 30)));
	const durationSec = Math.min(
		30,
		Math.max(0.8, num(a.durationSec) ?? (template ? TEMPLATE_DEFAULT_SEC[template as MotionTemplateId] : 3)),
	);
	const source = template
		? { html: renderTemplate(template as MotionTemplateId, a.params ?? {}, kit, { width, height, durationSec }) }
		: htmlPath
			? { htmlPath }
			: { html: html! };
	const frameSource = await options.createFrameSource();
	if (!frameSource) throw new Error("Could not start the motion renderer.");
	const composition = writeComposition(source, { width, height, background: kit.background });
	const outDir = resolveGeneratedGraphicsDir(document);
	const stem = uniqueStem(`motion-${template ?? "custom"}`);
	const mp4Path = join(outDir, `${stem}.mp4`);
	try {
		mkdirSync(outDir, { recursive: true });
		const rendered = await renderComposition({
			source: frameSource,
			compositionPath: composition.path,
			width,
			height,
			fps,
			durationSec,
			outPath: mp4Path,
			ffmpegPath: options.ffmpegPath,
			signal: options.signal,
		});
		const check = await verifyMotionClip({
			ffmpegPath: options.ffmpegPath,
			mp4Path,
			expected: { width: rendered.width, height: rendered.height, fps: rendered.fps, durationSec: rendered.durationSec },
			framesDir: join(outDir, ".frames"),
			stem,
			signal: options.signal,
		});
		return {
			mp4Path,
			durationSec: rendered.durationSec,
			width: rendered.width,
			height: rendered.height,
			fps: rendered.fps,
			label: str(a.label) ?? (template ? `${template} graphic` : "Motion graphic"),
			check,
			pageErrors: rendered.pageErrors,
		};
	} finally {
		composition.dispose();
	}
}

/** Tools whose output uses the brand kit (so they read the video's colours when none is set). */
const BRAND_KIT_TOOLS: ReadonlySet<string> = new Set(["listMotionTemplates", "createMotionClip", "addMotionOverlay"]);

/** Remove files (or overlay frame folders) a refused/failed tool call left behind. */
export function discardPreparedFiles(paths: string[]): void {
	for (const p of paths) {
		try {
			rmSync(p, { force: true, recursive: true });
		} catch {
			// best effort
		}
	}
}
