/**
 * The async "media studio" step that runs BEFORE `executeAgentTool`.
 *
 * `executeAgentTool` is synchronous on purpose — it is the one gate every
 * document mutation passes through. Rendering video, probing media and
 * shrinking big images are slow, so they happen here, off the main thread's
 * critical path (async child processes), abortable by the chat Stop button.
 * The executor then only consumes finished files via `options.prepared`.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
import type { AxcutDocument, AxcutLayerRender } from "../../src/lib/ai-edition/schema";
import { createId as createLayerId } from "../../src/lib/ai-edition/document/ids";
import { findLayer, layerCanvasSize } from "../../src/lib/ai-edition/document/layers";
import { bakeLayer } from "./layers/bake";
import { VOICE_LEVELS, type VoiceLevel, bakeCleanVoice, voiceTargets } from "./audioPro/cleanVoice";
import { measureProgrammeLoudness } from "./audioPro/loudness";
import {
	DEFAULT_DUCK_DB,
	bakeDuckedAudio,
	planDuck,
	speechBySilence,
	speechInFileTime,
	speechPlaybackIntervals,
	transcriptSpeech,
} from "./audioPro/duck";
import { applyLayerTool, layerSourceKind } from "./layers/layerTools";
import { assertSafeLocalMediaPath, probeMediaDurationSec, shrinkImageFile } from "./mediaStudio";
import { bakeMotionGraphicMp4 } from "./motionGraphicPreview";
import { type BrandKit, DEFAULT_BRAND_KIT, storedBrandKit } from "./motionStudio/brandKit";
import { readGlobalBrandKit } from "./motionStudio/globalBrandKit";
import { type BakedImageClip, bakeImageClip, getMediaHome, isImageClipPath, primaryVideoSize, probeImageSize } from "./imageClip";
import { deriveBrandKitFromVideo, paletteSourceVideo } from "./motionStudio/videoPalette";
import type { CompositedFrameSampler } from "./compositorVerify/types";
import { type SampleFramesResult, sampleFramesForAgent } from "./frameCheck";
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
	effectiveShowcaseArgs,
	type RecordingSignals,
	sanitizeShowcaseArgs,
	showcaseArgsSchema,
	storedShowcasePlan,
} from "./showcase/plan";
import { renderProgress, renderShowcase, type ShowcaseClip } from "./showcase/render";
import {
	bakeStillToMp4,
	canvasSizeFromDocument,
	findStartThumbnailClip,
	uniqueStem,
} from "./startThumbnail";

/** Results of async media work, handed to the synchronous executor. */
export interface PreparedToolMedia {
	/** addLayer / setLayer: the layer drawn ahead of the edit (same id the executor uses). */
	layer?: {
		layerId: string;
		render?: AxcutLayerRender;
		source?: { width?: number; height?: number; durationSec?: number };
	};
	layerError?: string;
	/** duckMusic: one ducked copy per track. */
	duck?: Array<{ trackId: string; path?: string; amountDb: number; speechSpans: number; speechSource: string; error?: string }>;
	duckError?: string;
	/** cleanVoice: one cleaned copy per recording. */
	voice?: Array<{ assetId: string; path?: string; chain?: string; error?: string }>;
	voiceError?: string;
	/** setLoudness: the programme as it mixes now (before its programme gain). */
	loudness?: { integratedLufs: number; truePeakDb: number; lra: number };
	loudnessError?: string;
	/** importMedia of a picture: the picture baked into a clip. */
	imageClip?: BakedImageClip;
	/** Why a picture could not be baked (the executor reports it). */
	imageClipError?: string;
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
	/** placeMotionClip: the clip's frame size (for place "replace", which follows its shape). */
	mediaSize?: { width: number; height: number } | null;
	/** A render was attempted and failed — the executor reports this message. */
	renderError?: string;
	/** Brand colours read from the recording (used when the project has no brand kit yet). */
	videoBrandKit?: BrandKit;
	/** getVideoSummary: the saved analysis of the recording, shaped for the agent (null = none possible). */
	videoSummary?: Record<string, unknown> | null;
	/** sampleFrames: stills of the edited timeline / an export / the recording. */
	sampledFrames?: SampleFramesResult;
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
	/** createShowcaseVideo: the finished showcase MP4 and its check. */
	showcaseClip?: ShowcaseClip;
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
		/** Asked for a plain titleCard; rendered as the productIntro opener instead. */
		upgradedFrom?: "titleCard";
		/** Reused an identical earlier render (no new file). */
		cached?: boolean;
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
	return join(getMediaHome() ?? join(tmpdir(), "openscreen-generated-graphics"), projectId);
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
		/** Offscreen compositor for edited-timeline frames (the app's native addon). */
		createCompositorSampler?: () => Promise<CompositedFrameSampler | null>;
		/** Live progress for long renders ("Rendering 420 / 930 frames · ~40s left"). */
		onProgress?: (detail: string) => void;
		/** A still of a long render as it is made (path). */
		onStill?: (path: string) => void;
		/** The recording's pointer samples (clicks), when the tool reads the cursor. */
		cursorSamples?: RecordingSignals["cursor"];
	},
): Promise<PreparedToolCall> {
	const { ffmpegPath, signal } = options;
	const prepared: PreparedToolMedia = {};
	const discardOnFailure: string[] = [];
	const nextArgs = await shrinkImageArgs(document, name, args, ffmpegPath, signal);
	const a = (nextArgs ?? {}) as Record<string, unknown>;

	// Graphics follow the user's remembered brand, else the video's own colours,
	// until this project gets a brand kit of its own.
	const remembered = BRAND_KIT_TOOLS.has(name) && !storedBrandKit(document) ? readGlobalBrandKit() : null;
	if (remembered) prepared.videoBrandKit = remembered;
	const wantsVideoKit =
		name === "setBrandKit" ? a.fromVideo === true : BRAND_KIT_TOOLS.has(name) && !storedBrandKit(document) && !remembered;
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
				if (existsSync(abs) && name === "importMedia" && isImageClipPath(abs)) {
					if (options.mayMutate) {
						try {
							prepared.imageClip = await bakeImageClip({
								ffmpegPath,
								imagePath: abs,
								durationSec: typeof a.durationSec === "number" ? a.durationSec : undefined,
								motion: str(a.motion) as never,
								fit: str(a.fit) as never,
								primary: primaryVideoSize(document),
								outDir: join(resolveGeneratedGraphicsDir(document), "image-clips"),
								signal,
							});
							discardOnFailure.push(prepared.imageClip.mp4Path);
						} catch (err) {
							if (err instanceof Error && err.name === "AbortError") throw err;
							prepared.imageClipError = err instanceof Error ? err.message : String(err);
						}
					}
				} else if (existsSync(abs)) {
					prepared.mediaDurationSec = await probeMediaDurationSec(ffmpegPath, abs, signal);
					if (name === "placeMotionClip") {
						const { runProcess } = await import("./mediaStudio");
						const { parseFfmpegProbe } = await import("./showcase/render");
						const probe = await runProcess(ffmpegPath, ["-hide_banner", "-i", abs], { timeoutMs: 20_000, signal }).catch(() => null);
						const info = probe ? parseFfmpegProbe(probe.stderr) : null;
						prepared.mediaSize = info ? { width: info.width, height: info.height } : null;
					}
				}
			} catch (err) {
				if (err instanceof Error && err.name === "AbortError") throw err;
			}
		}
	}

	if (name === "setLoudness" && options.mayMutate) {
		if (!ffmpegPath) prepared.loudnessError = "ffmpeg is not available";
		else {
			try {
				options.onProgress?.("Measuring the loudness of the whole video");
				prepared.loudness = (await measureProgrammeLoudness(document, ffmpegPath, signal)) ?? undefined;
				if (!prepared.loudness) prepared.loudnessError = "the video has no measurable sound";
			} catch (err) {
				if (err instanceof Error && err.name === "AbortError") throw err;
				prepared.loudnessError = err instanceof Error ? err.message : String(err);
			}
		}
	}

	if (name === "cleanVoice" && options.mayMutate && a.undo !== true) {
		if (!ffmpegPath) prepared.voiceError = "ffmpeg is not available";
		else {
			const level = (VOICE_LEVELS as readonly string[]).includes(str(a.level) ?? "") ? (str(a.level) as VoiceLevel) : "medium";
			prepared.voice = [];
			for (const t of voiceTargets(document, str(a.assetId))) {
				try {
					if (!existsSync(t.sourcePath)) throw new Error("the recording file is missing");
					options.onProgress?.(`Cleaning the voice in ${t.asset.label}`);
					const baked = await bakeCleanVoice({
						ffmpegPath,
						sourcePath: t.sourcePath,
						level,
						outDir: join(resolveGeneratedGraphicsDir(document), "audio"),
						signal,
					});
					discardOnFailure.push(baked.path);
					prepared.voice.push({ assetId: t.asset.id, path: baked.path, chain: baked.chain });
				} catch (err) {
					if (err instanceof Error && err.name === "AbortError") throw err;
					prepared.voice.push({ assetId: t.asset.id, error: err instanceof Error ? err.message : String(err) });
				}
			}
		}
	}

	if (name === "duckMusic" && options.mayMutate && a.undo !== true) {
		if (!ffmpegPath) prepared.duckError = "ffmpeg is not available";
		else {
			try {
				const amountDb = typeof a.amountDb === "number" ? Math.min(30, Math.max(3, a.amountDb)) : DEFAULT_DUCK_DB;
				const plan = planDuck(document, str(a.trackId));
				// Speech per recording: the transcript, else the level (silence detection).
				const speech = transcriptSpeech(document);
				let speechSource = "transcript";
				for (const clip of document.timeline.clips) {
					if ((speech.get(clip.assetId) ?? []).length > 0) continue;
					const asset = document.assets.find((x) => x.id === clip.assetId);
					if (!asset?.originalPath || !existsSync(asset.originalPath) || asset.still) continue;
					speech.set(clip.assetId, await speechBySilence(ffmpegPath, asset.originalPath, asset.durationSec ?? 3600, signal));
					speechSource = "audio level";
				}
				const onProgramme = speechPlaybackIntervals(document, speech);
				prepared.duck = [];
				for (const item of plan) {
					if (item.skipped) continue;
					try {
						// Map through the placement the track plays with NOW (it may be on an older ducked copy).
						const current = document.assets.find(
							(x) => x.id === (document.audioTracks.find((t) => (t.trackId ?? t.id) === item.trackId)?.assetId ?? ""),
						);
						const playingPath = current?.originalPath ?? item.sourceAsset.originalPath;
						const inFile = speechInFileTime(document, playingPath, onProgramme) ?? [];
						const path = await bakeDuckedAudio({
							ffmpegPath,
							sourcePath: item.sourceAsset.originalPath,
							speechInFile: inFile,
							amountDb,
							outDir: join(resolveGeneratedGraphicsDir(document), "audio"),
							signal,
						});
						discardOnFailure.push(path);
						prepared.duck.push({ trackId: item.trackId, path, amountDb, speechSpans: inFile.length, speechSource });
					} catch (err) {
						if (err instanceof Error && err.name === "AbortError") throw err;
						prepared.duck.push({ trackId: item.trackId, amountDb, speechSpans: 0, speechSource, error: err instanceof Error ? err.message : String(err) });
					}
				}
			} catch (err) {
				if (err instanceof Error && err.name === "AbortError") throw err;
				prepared.duckError = err instanceof Error ? err.message : String(err);
			}
		}
	}

	if ((name === "addLayer" || name === "setLayer") && options.mayMutate) {
		try {
			const layerId = name === "addLayer" ? createLayerId("layer") : (findLayer(document, str(a.layerId) ?? "")[0]?.layerId ?? "");
			const rawPath = str(a.path);
			const path = rawPath ? assertSafeLocalMediaPath(rawPath, "layer path") : null;
			let source: { width?: number; height?: number; durationSec?: number } | undefined;
			if (path && existsSync(path) && ffmpegPath) {
				const kind = layerSourceKind(path);
				if (kind === "image") {
					const size = await probeImageSize(ffmpegPath, path, signal);
					if (size) source = size;
				} else if (kind === "video") {
					const { runProcess } = await import("./mediaStudio");
					const { parseFfmpegProbe } = await import("./showcase/render");
					const probe = await runProcess(ffmpegPath, ["-hide_banner", "-i", path], { timeoutMs: 20_000, signal }).catch(() => null);
					const info = probe ? parseFfmpegProbe(probe.stderr) : null;
					if (info) source = { width: info.width, height: info.height, durationSec: info.durationSec };
				}
			}
			const applied = applyLayerTool(document, name, path ? { ...a, path } : a, {
				newLayerId: layerId || createLayerId("layer"),
				canvas: layerCanvasSize(document),
				source,
			});
			prepared.layer = { layerId: applied.ok ? applied.layerId : layerId, source };
			if (applied.ok && options.createFrameSource) {
				const baked = await bakeLayer(applied.document, applied.layerId, {
					ffmpegPath,
					createFrameSource: options.createFrameSource,
					outRoot: join(resolveGeneratedGraphicsDir(document), "layers"),
					signal,
					onProgress: (done, total) => {
						if (total > 20 && (done === 1 || done % 15 === 0 || done === total)) {
							options.onProgress?.(`Drawing the layer · ${done} / ${total} frames`);
						}
					},
				});
				prepared.layer = { layerId: applied.layerId, render: baked.render, source };
			}
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") throw err;
			prepared.layerError = err instanceof Error ? err.message : String(err);
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

	if (name === "getVideoSummary") {
		try {
			const { ensureVideoSummary, videoSummaryForAgent } = await import("./videoSummary");
			const summary = await ensureVideoSummary(document, { ffmpegPath, signal });
			prepared.videoSummary = summary ? videoSummaryForAgent(summary, document) : null;
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") throw err;
			prepared.renderError = err instanceof Error ? err.message : String(err);
		}
	}

	if (name === "sampleFrames" && ffmpegPath) {
		try {
			const from = a.from === "export" || a.from === "recording" ? a.from : "timeline";
			const times = Array.isArray(a.times) ? a.times.filter((t): t is number => typeof t === "number" && t >= 0) : undefined;
			prepared.sampledFrames = await sampleFramesForAgent(
				document,
				{ from, times, count: num(a.count), exportPath: str(a.exportPath) },
				{
					ffmpegPath,
					outDir: join(resolveGeneratedGraphicsDir(document), ".checks"),
					stem: uniqueStem(`check-${from}`),
					createSampler: options.createCompositorSampler,
					signal,
				},
			);
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") throw err;
			prepared.renderError = err instanceof Error ? err.message : String(err);
		}
	}

	if (name === "createShowcaseVideo" && ffmpegPath) {
		try {
			// A follow-up changes the project's last showcase plan instead of starting over.
			const parsed = showcaseArgsSchema.safeParse(
				sanitizeShowcaseArgs(effectiveShowcaseArgs(storedShowcasePlan(document), a).args),
			);
			if (parsed.success) {
				const { ensureVideoSummary } = await import("./videoSummary");
				const summary = parsed.data.auto
					? await ensureVideoSummary(document, { ffmpegPath, signal }).catch((err) => {
							if (err instanceof Error && err.name === "AbortError") throw err;
							return null;
						})
					: null;
				const clip = await renderShowcase(document, parsed.data, kit, {
					signals: {
						cursor: options.cursorSamples,
						stillStretches: summary?.stillStretches,
						silences: summary?.hasAudio ? summary.silences : undefined,
					},
					ffmpegPath,
					generatedDir: resolveGeneratedGraphicsDir(document),
					signal,
					createFrameSource: options.createFrameSource,
					onProgress: options.onProgress,
					onStill: options.onStill,
				});
				prepared.showcaseClip = clip;
				if (!clip.cached) discardOnFailure.push(clip.mp4Path);
			} else {
				prepared.renderError = `the plan does not fit the showcase: ${parsed.error.issues
					.slice(0, 4)
					.map((i) => `${i.path.join(".")}: ${i.message}`)
					.join("; ")}`;
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
				onProgress: options.onProgress,
			});
			if (clip) {
				prepared.motionClip = clip;
				// A reused clip may already be on the timeline from an earlier turn:
				// never delete it because this call was refused.
				if (!clip.cached) discardOnFailure.push(clip.mp4Path);
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
		onProgress?: (detail: string) => void;
	},
): Promise<PreparedToolMedia["motionClip"] | null> {
	const upgrade = upgradeOpener(document, str(a.template), a.params, kit);
	const template = upgrade?.template ?? str(a.template);
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
		Math.max(
			upgrade ? 4 : 0.8,
			num(a.durationSec) ?? (template ? TEMPLATE_DEFAULT_SEC[template as MotionTemplateId] : 3),
		),
	);
	let params: unknown = upgrade?.params ?? a.params ?? {};
	if (template === "productIntro") params = await withRecordingScreenshot(document, params, options.ffmpegPath, options.signal);
	const source = template
		? { html: renderTemplate(template as MotionTemplateId, params, kit, { width, height, durationSec }) }
		: htmlPath
			? { htmlPath }
			: { html: html! };
	const outDir = resolveGeneratedGraphicsDir(document);
	const label = str(a.label) ?? (template ? `${template} graphic` : "Motion graphic");
	// Same composition, size, rate and length → the clip already exists: reuse it.
	const cacheKey = renderCacheKey(source, { width, height, fps, durationSec, background: kit.background });
	const cached = cacheKey ? readRenderCache<CachedClip>(outDir, cacheKey) : null;
	if (cached && existsSync(cached.mp4Path)) {
		return { ...cached, label, ...(upgrade ? { upgradedFrom: "titleCard" as const } : {}), cached: true };
	}
	const frameSource = await options.createFrameSource();
	if (!frameSource) throw new Error("Could not start the motion renderer.");
	const composition = writeComposition(source, { width, height, background: kit.background });
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
			onProgress: renderProgress(options.onProgress),
		});
		const check = await verifyMotionClip({
			ffmpegPath: options.ffmpegPath,
			mp4Path,
			expected: { width: rendered.width, height: rendered.height, fps: rendered.fps, durationSec: rendered.durationSec },
			framesDir: join(outDir, ".frames"),
			stem,
			signal: options.signal,
		});
		const result: CachedClip = {
			mp4Path,
			durationSec: rendered.durationSec,
			width: rendered.width,
			height: rendered.height,
			fps: rendered.fps,
			check,
			pageErrors: rendered.pageErrors,
		};
		if (cacheKey && check.ok) writeRenderCache(outDir, cacheKey, result);
		return { ...result, label, ...(upgrade ? { upgradedFrom: "titleCard" as const } : {}) };
	} finally {
		composition.dispose();
	}
}

type CachedClip = Omit<NonNullable<PreparedToolMedia["motionClip"]>, "label" | "upgradedFrom" | "cached">;

/**
 * Render cache: a hash of exactly what would be drawn (the composition HTML or
 * the .html file's bytes) and how (size, rate, length, background). Renders
 * are deterministic (virtual clock), so equal keys mean equal videos.
 */
export function renderCacheKey(
	source: { html: string } | { htmlPath: string },
	frame: { width: number; height: number; fps: number; durationSec: number; background?: string },
): string | null {
	let body: string;
	try {
		body = "html" in source ? source.html : `${source.htmlPath}\n${readFileSync(source.htmlPath, "utf8")}`;
	} catch {
		return null;
	}
	return createHash("sha1").update(JSON.stringify(frame)).update(body).digest("hex").slice(0, 20);
}

function readRenderCache<T>(outDir: string, key: string): T | null {
	try {
		return JSON.parse(readFileSync(join(outDir, ".render-cache", `${key}.json`), "utf8")) as T;
	} catch {
		return null;
	}
}

function writeRenderCache(outDir: string, key: string, value: unknown): void {
	try {
		mkdirSync(join(outDir, ".render-cache"), { recursive: true });
		writeFileSync(join(outDir, ".render-cache", `${key}.json`), JSON.stringify(value));
	} catch {
		/* a cache that can't be written is just a slower render next time */
	}
}

/**
 * A plain text title card is the weakest possible opener for a screen
 * recording. When the project has a recording, titleCard renders as the
 * productIntro opener instead (the real app in a browser window, headline,
 * motion) — unless the agent asked for `simple: true` because the user wants
 * a plain card.
 */
export function upgradeOpener(
	document: AxcutDocument,
	template: string | undefined,
	rawParams: unknown,
	kit: BrandKit,
): { template: "productIntro"; params: Record<string, unknown> } | null {
	if (template !== "titleCard") return null;
	const p = (rawParams && typeof rawParams === "object" ? rawParams : {}) as Record<string, unknown>;
	if (p.simple === true || !paletteSourceVideo(document)) return null;
	const title = typeof p.title === "string" ? p.title.trim() : "";
	const subtitle = typeof p.subtitle === "string" ? p.subtitle.trim() : "";
	if (!title) return null;
	// A short title reads as the product name ("FlutterGo"); a long one is the headline.
	const looksLikeName = title.length <= 24 && title.split(/\s+/).length <= 3;
	const name = looksLikeName ? title : (kit.name ?? title.split(/\s+/).slice(0, 2).join(" ")).slice(0, 40);
	const headline = looksLikeName ? subtitle || `Meet ${title}` : title;
	const tagline = looksLikeName ? undefined : subtitle || undefined;
	return {
		template: "productIntro",
		params: { name, headline: headline.slice(0, 90), ...(tagline ? { tagline: tagline.slice(0, 140) } : {}) },
	};
}

/**
 * productIntro shows the product in a browser window: unless the agent passed
 * a screenshot, use a frame of the recording itself (a third of the way in —
 * past any loading screen), so the intro shows the real app.
 */
async function withRecordingScreenshot(
	document: AxcutDocument,
	params: unknown,
	ffmpegPath: string,
	signal?: AbortSignal,
): Promise<unknown> {
	const p = (params && typeof params === "object" ? { ...(params as Record<string, unknown>) } : {}) as Record<string, unknown>;
	if (typeof p.screenshot === "string" && p.screenshot.trim()) {
		if (!p.screenshot.startsWith("data:image/")) p.screenshot = assertSafeLocalMediaPath(p.screenshot, "screenshot");
		return p;
	}
	const src = paletteSourceVideo(document);
	if (!src) return p;
	const at = src.durationSec > 0 ? src.durationSec * 0.33 : 1;
	const { runProcessBuffer } = await import("./mediaStudio");
	const jpg = await runProcessBuffer(
		ffmpegPath,
		["-v", "error", "-ss", at.toFixed(2), "-i", src.path, "-frames:v", "1", "-vf", "scale=1600:-2", "-q:v", "3", "-f", "image2", "-c:v", "mjpeg", "-"],
		{ timeoutMs: 30_000, signal },
	).catch(() => null);
	if (jpg && jpg.length > 1000) p.screenshot = `data:image/jpeg;base64,${jpg.toString("base64")}`;
	return p;
}

/** Tools whose output uses the brand kit (so they read the video's colours when none is set). */
const BRAND_KIT_TOOLS: ReadonlySet<string> = new Set(["listMotionTemplates", "createMotionClip", "addMotionOverlay", "createShowcaseVideo"]);

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
