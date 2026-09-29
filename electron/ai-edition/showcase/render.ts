/**
 * Showcase video — the render.
 *
 *   recording ─ffmpeg→ cropped, sharpened, retimed JPEG frames (+ retimed audio)
 *             ─page→  showcase.html (template.ts) driven by the virtual clock
 *             ─render→ silent MP4 at the project's output size
 *             ─ffmpeg→ + audio → checked MP4 in the project's generated-graphics folder
 *
 * Identical requests reuse the earlier MP4 (keyed by the plan, the brand kit,
 * the output size and the recording's size + mtime).
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, join } from "node:path";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { getEditorSettings } from "../../../src/lib/ai-edition/store/editorSettings";
import { runProcess } from "../mediaStudio";
import type { BrandKit } from "../motionStudio/brandKit";
import { writeComposition } from "../motionStudio/composition";
import { type FrameSource, renderComposition } from "../motionStudio/render";
import { paletteSourceVideo } from "../motionStudio/videoPalette";
import { type MotionClipCheck, verifyMotionClip } from "../motionStudio/verify";
import {
	autoPlan,
	buildFootageFilter,
	buildSegments,
	footageDuration,
	resolveCrop,
	resolveTimeline,
	type RecordingSignals,
	type ShowcaseArgs,
	type ShowcaseTimeline,
} from "./plan";
import { renderShowcasePage, showcaseTiming } from "./template";
import { trackBands } from "./track";

export interface ShowcaseClip {
	mp4Path: string;
	durationSec: number;
	width: number;
	height: number;
	fps: number;
	label: string;
	check: MotionClipCheck;
	/** Extra stills at each step card, for the agent to look at. */
	stepFrames: string[];
	pageErrors: string[];
	/** Seconds of recording shown after trim + speed-ups. */
	footageSec: number;
	/** When the recording starts inside the showcase (after the intro). */
	footageStartSec: number;
	/** Parts of the plan that were outside the trim / crop and were left out. */
	dropped: string[];
	hasAudio: boolean;
	/** What was filled in from the recording's clicks and still stretches. */
	autoFilled: string[];
	cached?: boolean;
}

export interface SourceProbe {
	width: number;
	height: number;
	durationSec: number;
	hasAudio: boolean;
}

/** Size, length and audio of a video from `ffmpeg -i` (no ffprobe needed). */
export function parseFfmpegProbe(stderr: string): SourceProbe | null {
	const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
	const vid = /Stream #[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(stderr);
	if (!vid) return null;
	const durationSec = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0;
	let width = Number(vid[1]);
	let height = Number(vid[2]);
	// Phone recordings: a 90°/270° rotation tag means the frames decode transposed.
	if (/rotate\s*:\s*-?(90|270)\b|rotation of -?(90|270)/.test(stderr)) [width, height] = [height, width];
	return { width, height, durationSec, hasAudio: /Stream #[^\n]*Audio:/.test(stderr) };
}

/** The showcase's output frame: 1920 on the long side, following the project's aspect ratio. */
export function showcaseOutputSize(document: AxcutDocument): { width: number; height: number } {
	const ar = String(getEditorSettings(document).aspectRatio ?? "16:9");
	const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ar);
	const ratio = m ? Number(m[1]) / Number(m[2]) : 16 / 9;
	if (!Number.isFinite(ratio) || ratio <= 0) return { width: 1920, height: 1080 };
	const even = (n: number) => Math.round(n / 2) * 2;
	return ratio >= 1 ? { width: 1920, height: even(1920 / ratio) } : { width: even(1920 * ratio), height: 1920 };
}

function outDirFor(generatedDir: string): string {
	return join(generatedDir, "showcase");
}

function readCache(dir: string, key: string): ShowcaseClip | null {
	try {
		const all = JSON.parse(readFileSync(join(dir, ".showcase-cache.json"), "utf8")) as Record<string, ShowcaseClip>;
		const hit = all[key];
		return hit && existsSync(hit.mp4Path) ? hit : null;
	} catch {
		return null;
	}
}

function writeCache(dir: string, key: string, value: ShowcaseClip): void {
	const file = join(dir, ".showcase-cache.json");
	let all: Record<string, ShowcaseClip> = {};
	try {
		all = JSON.parse(readFileSync(file, "utf8")) as Record<string, ShowcaseClip>;
	} catch {
		// first entry
	}
	all[key] = value;
	const keys = Object.keys(all);
	for (const k of keys.slice(0, Math.max(0, keys.length - 20))) delete all[k];
	try {
		writeFileSync(file, JSON.stringify(all));
	} catch {
		// cache is best effort
	}
}

/** "Rendering 420 / 930 frames · ~40s left", throttled to a few updates a second. */
export function renderProgress(
	report: ((detail: string) => void) | undefined,
	label = "Rendering",
	now: () => number = Date.now,
): ((done: number, total: number) => void) | undefined {
	if (!report) return undefined;
	const started = now();
	let last = Number.NEGATIVE_INFINITY;
	return (done, total) => {
		const t = now();
		if (done < total && t - last < 400) return;
		last = t;
		const elapsed = (t - started) / 1000;
		const left = done > 3 ? (elapsed / done) * (total - done) : null;
		const eta = left === null ? "" : left >= 90 ? ` · ~${Math.round(left / 60)} min left` : ` · ~${Math.max(1, Math.round(left))}s left`;
		report(`${label} ${done} / ${total} frames${done < total ? eta : ""}`);
	};
}

const LOGO_EXTS = new Set([".png", ".svg", ".jpg", ".jpeg", ".webp"]);

export async function renderShowcase(
	document: AxcutDocument,
	args: ShowcaseArgs,
	kit: BrandKit,
	options: {
		ffmpegPath: string;
		generatedDir: string;
		signal?: AbortSignal;
		createFrameSource?: () => Promise<FrameSource | null>;
		/** Stem for file names (tests pass a fixed one). */
		stem?: string;
		/** Live progress for the chat. */
		onProgress?: (detail: string) => void;
		/** Recorded clicks and still stretches, for filling the plan's gaps. */
		signals?: RecordingSignals;
	},
): Promise<ShowcaseClip> {
	const { ffmpegPath, signal } = options;
	const source = paletteSourceVideo(document);
	if (!source) throw new Error("This project has no recording to turn into a showcase.");
	if (!options.createFrameSource) throw new Error("The motion renderer is not available in this build.");

	const probeRun = await runProcess(ffmpegPath, ["-hide_banner", "-i", source.path], { timeoutMs: 30_000, signal });
	const probe = parseFfmpegProbe(probeRun.stderr);
	if (!probe) throw new Error("Could not read the recording's video stream.");
	const srcDuration = probe.durationSec || source.durationSec;
	if (!(srcDuration > 0.5)) throw new Error("The recording is too short for a showcase.");

	const trimStart = Math.min(srcDuration - 0.5, Math.max(0, args.trim?.startSec ?? 0));
	const trimEnd = Math.max(trimStart + 0.5, Math.min(srcDuration, args.trim?.endSec ?? srcDuration));
	const auto = autoPlan(args, options.signals ?? {}, { startSec: trimStart, endSec: trimEnd });
	args = auto.args;
	const segments = buildSegments(trimStart, trimEnd, args.speed);
	const footageSec = footageDuration(segments);
	if (footageSec > 180) {
		throw new Error(
			`That is ${Math.round(footageSec)}s of recording after speed-ups — a showcase is at most 180s. Trim it or speed up more.`,
		);
	}
	const crop = resolveCrop(args.crop, probe);
	const timeline: ShowcaseTimeline = resolveTimeline(args, segments, crop, probe);
	const dropped: string[] = [];
	const lost = (what: string, asked: number | undefined, kept: number) => {
		if ((asked ?? 0) > kept) dropped.push(`${(asked ?? 0) - kept} ${what} outside the trim/crop or too short`);
	};
	lost("steps", args.steps?.length, timeline.steps.length);
	lost("highlights", args.highlights?.length, timeline.highlights.length);
	lost("checks", args.checks?.length, timeline.checks.length);
	lost("clicks", args.clicks?.length, timeline.clicks.length);
	lost("covers", args.covers?.length, timeline.covers.length);

	const hasBrand = Boolean(kit.name || (kit.logoPath && existsSync(kit.logoPath)));
	const intro = args.intro ?? hasBrand;
	const outro = args.outro ?? (hasBrand || Boolean(args.tagline));
	const timing = showcaseTiming(footageSec, intro && hasBrand, outro);
	const draft = args.quality === "draft";
	const full = showcaseOutputSize(document);
	// A draft is half size at 30 fps: roughly 8× less to draw, enough to judge the plan.
	const size = draft ? { width: Math.round(full.width / 4) * 2, height: Math.round(full.height / 4) * 2 } : full;
	const fps = draft ? 30 : args.fps;
	const withAudio = args.keepAudio && probe.hasAudio;

	const outDir = outDirFor(options.generatedDir);
	mkdirSync(outDir, { recursive: true });
	let logoStat = "";
	try {
		if (kit.logoPath) logoStat = `${statSync(kit.logoPath).size}:${statSync(kit.logoPath).mtimeMs}`;
	} catch {
		logoStat = "";
	}
	const srcStat = statSync(source.path);
	const cacheKey = createHash("sha256")
		.update(
			JSON.stringify({ v: 1, args, kit, logoStat, size, src: source.path, srcSize: srcStat.size, srcMtime: srcStat.mtimeMs }),
		)
		.digest("hex")
		.slice(0, 24);
	const label = args.label ?? `Showcase${draft ? " draft" : ""}${kit.name ? ` — ${kit.name}` : ""}`;
	const hit = readCache(outDir, cacheKey);
	if (hit) return { ...hit, label, cached: true };

	const stem = options.stem ?? `showcase${draft ? "-draft" : ""}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
	const work = join(outDir, `.${stem}`);
	const framesDir = join(work, "f");
	mkdirSync(framesDir, { recursive: true });
	const mp4Path = join(outDir, `${stem}.mp4`);
	const silentPath = join(work, "silent.mp4");
	const audioPath = join(work, "audio.m4a");
	const digits = 5;
	try {
		// 1. Footage frames (and audio) — cropped, enhanced, retimed.
		options.onProgress?.("Preparing the recording");
		const filter = buildFootageFilter({ segments, crop, fps, enhance: args.enhance, audio: withAudio });
		const extract = await runProcess(
			ffmpegPath,
			[
				"-v",
				"error",
				"-y",
				"-i",
				source.path,
				"-filter_complex",
				filter,
				"-map",
				"[v]",
				"-q:v",
				"2",
				"-start_number",
				"0",
				join(framesDir, `%0${digits}d.jpg`),
				...(withAudio ? ["-map", "[a]", "-c:a", "aac", "-b:a", "192k", audioPath] : []),
			],
			{ timeoutMs: 15 * 60_000, signal },
		);
		const frameCount = readdirSync(framesDir).filter((f) => f.endsWith(".jpg")).length;
		if (extract.code !== 0 || frameCount === 0) {
			throw new Error(`Could not read frames from the recording: ${extract.stderr.trim().split("\n").slice(-2).join(" ")}`);
		}

		// 2. The page.
		let logoFile: string | null = null;
		if (kit.logoPath && existsSync(kit.logoPath) && LOGO_EXTS.has(extname(kit.logoPath).toLowerCase())) {
			logoFile = `logo${extname(kit.logoPath).toLowerCase()}`;
			copyFileSync(kit.logoPath, join(work, logoFile));
		}
		// Covers: their pictures next to the page, and their spot followed as the page scrolls.
		timeline.covers.forEach((c, i) => {
			if (c.mode !== "image") return;
			const src = c.useBrandLogo ? kit.logoPath : c.imagePath;
			if (src && isAbsolute(src) && existsSync(src) && LOGO_EXTS.has(extname(src).toLowerCase())) {
				c.image = `cover-${i}${extname(src).toLowerCase()}`;
				copyFileSync(src, join(work, c.image));
			} else {
				dropped.push(`cover ${i + 1}: picture not found — drawn as a plain fill`);
				c.mode = "fill";
			}
		});
		const followed = timeline.covers.filter((c) => c.follow);
		if (followed.length) {
			options.onProgress?.("Following the covered spots");
			const shifts = await trackBands({
				ffmpegPath,
				framesPattern: join(framesDir, `%0${digits}d.jpg`),
				fps,
				width: crop.width,
				height: crop.height,
				bands: followed.map((c) => ({ x0: c.x, x1: c.x + c.width })),
				signal,
			});
			followed.forEach((c, k) => {
				const all = shifts[k] ?? [];
				const a = Math.min(all.length - 1, Math.max(0, Math.floor(c.in * fps)));
				const b = Math.min(all.length - 1, Math.ceil(c.out * fps));
				// Offsets are relative to the frame where the box was measured (atSec), before and after it.
				const r = Math.min(b, Math.max(a, Math.round(c.at * fps)));
				c.track = all.length ? all.slice(a, b + 1).map((v) => Math.round((v - all[r]!) * 10) / 10) : null;
			});
		}
		const html = renderShowcasePage({
			width: size.width,
			height: size.height,
			fps,
			frameCount,
			frameDigits: digits,
			timeline: { ...timeline, footageSec: Math.min(timeline.footageSec, frameCount / fps) },
			kit,
			name: kit.name ?? "",
			logoFile,
			intro: intro && hasBrand,
			outro,
			tagline: args.tagline ?? "",
			url: args.url ?? "",
			tags: args.tags ?? [],
			theme: args.theme,
		});
		const htmlPath = join(work, "showcase.html");
		writeFileSync(htmlPath, html);

		// 3. Render.
		const frameSource = await options.createFrameSource();
		if (!frameSource) throw new Error("Could not start the motion renderer.");
		const composition = writeComposition({ htmlPath }, { width: size.width, height: size.height, background: "#000000" });
		let rendered: Awaited<ReturnType<typeof renderComposition>>;
		try {
			rendered = await renderComposition({
				source: frameSource,
				compositionPath: composition.path,
				width: size.width,
				height: size.height,
				fps,
				durationSec: timing.totalSec,
				outPath: withAudio ? silentPath : mp4Path,
				ffmpegPath,
				signal,
				maxDurationSec: 300,
				onProgress: renderProgress(options.onProgress),
			});
		} finally {
			composition.dispose();
		}

		// 4. Sound: the retimed recording audio, starting with the footage, faded at the end.
		if (withAudio) {
			options.onProgress?.("Adding the sound");
			const delayMs = Math.round(timing.footageStart * 1000);
			const fadeAt = Math.max(0, timing.totalSec - 0.6);
			const mux = await runProcess(
				ffmpegPath,
				[
					"-v",
					"error",
					"-y",
					"-i",
					silentPath,
					"-i",
					audioPath,
					"-filter_complex",
					`[1:a]adelay=${delayMs}:all=1,apad,atrim=0:${timing.totalSec.toFixed(3)},afade=t=out:st=${fadeAt.toFixed(3)}:d=0.6[a]`,
					"-map",
					"0:v",
					"-map",
					"[a]",
					"-c:v",
					"copy",
					"-c:a",
					"aac",
					"-b:a",
					"192k",
					"-movflags",
					"+faststart",
					mp4Path,
				],
				{ timeoutMs: 5 * 60_000, signal },
			);
			if (mux.code !== 0 || !existsSync(mp4Path)) {
				// Keep the picture even if the sound could not be added.
				copyFileSync(silentPath, mp4Path);
			}
		}

		// 5. Check it, and grab a still at each step card.
		options.onProgress?.("Checking the video");
		const check = await verifyMotionClip({
			ffmpegPath,
			mp4Path,
			expected: { width: rendered.width, height: rendered.height, fps: rendered.fps, durationSec: rendered.durationSec },
			framesDir: join(outDir, ".frames"),
			stem,
			signal,
		});
		const stepFrames: string[] = [];
		for (const [i, st] of timeline.steps.slice(0, 6).entries()) {
			const at = timing.footageStart + Math.min(st.out - 0.2, st.in + 1.2);
			const out = join(outDir, ".frames", `${stem}-step${i + 1}.jpg`);
			const r = await runProcess(
				ffmpegPath,
				["-v", "error", "-y", "-ss", at.toFixed(2), "-i", mp4Path, "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "4", out],
				{ timeoutMs: 30_000, signal },
			).catch(() => null);
			if (r && r.code === 0) stepFrames.push(out);
		}

		const result: ShowcaseClip = {
			mp4Path,
			durationSec: rendered.durationSec,
			width: rendered.width,
			height: rendered.height,
			fps: rendered.fps,
			label,
			check,
			stepFrames,
			pageErrors: rendered.pageErrors,
			footageSec,
			footageStartSec: timing.footageStart,
			dropped,
			hasAudio: withAudio,
			autoFilled: auto.filled,
		};
		if (check.ok) writeCache(outDir, cacheKey, result);
		return result;
	} catch (err) {
		rmSync(mp4Path, { force: true });
		throw err;
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}
