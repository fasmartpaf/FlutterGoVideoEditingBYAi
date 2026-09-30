/**
 * Processed copies of a recording: colour grade, stabilisation and voice
 * clean-up, together.
 *
 * The compositor plays a clip straight from its file, so any picture or
 * sound treatment is baked into a COPY of the file (video re-encoded only
 * when the picture changes, audio only when the sound does) and the asset
 * points at the copy. The asset remembers the untouched original
 * (`derived.sourcePath`) and the treatments applied (`derived.ops`), so every
 * bake starts from the original with the whole set — changing the grade
 * keeps the voice clean-up — and undoing everything restores the original.
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { AxcutAsset, AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { pickH264Encoder, runProcess } from "../mediaStudio";
import { ffmpegFilters, parseFfmpegProbe } from "../showcase/render";
import { type VoiceLevel, voiceFilterChain } from "../audioPro/cleanVoice";

export const LOOKS = ["none", "cinematic", "warm", "cool", "vivid", "matte", "bw", "teal-orange"] as const;
export type Look = (typeof LOOKS)[number];

/** Every value −1…1 (vignette/sharpen 0…1); 0 = untouched. */
export type GradeParams = {
	look?: Look;
	exposure?: number;
	contrast?: number;
	saturation?: number;
	warmth?: number;
	tint?: number;
	vignette?: number;
	sharpen?: number;
	/** Absolute path to a .cube LUT. */
	lutPath?: string;
};

export type ProcessOps = {
	grade?: GradeParams;
	stabilize?: boolean;
	voice?: VoiceLevel;
};

const clamp = (v: unknown, lo: number, hi: number) =>
	typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0;

/** A look's own settings; explicit values on top of it win. */
export function lookParams(look: Look): GradeParams {
	switch (look) {
		case "cinematic":
			return { contrast: 0.25, saturation: -0.1, warmth: 0.12, vignette: 0.35, exposure: -0.05 };
		case "warm":
			return { warmth: 0.45, saturation: 0.1 };
		case "cool":
			return { warmth: -0.45 };
		case "vivid":
			return { saturation: 0.45, contrast: 0.15, sharpen: 0.3 };
		case "matte":
			return { contrast: -0.25, saturation: -0.15 };
		case "bw":
			return { saturation: -1, contrast: 0.12 };
		case "teal-orange":
			return { saturation: 0.1, contrast: 0.15 };
		default:
			return {};
	}
}

export function resolveGrade(g: GradeParams): Required<Omit<GradeParams, "lutPath" | "look">> & { look: Look; lutPath?: string } {
	const look: Look = LOOKS.includes(g.look as Look) ? (g.look as Look) : "none";
	const base = lookParams(look);
	const pick = (k: keyof GradeParams, lo: number, hi: number) =>
		typeof g[k] === "number" ? clamp(g[k], lo, hi) : clamp(base[k], lo, hi);
	return {
		look,
		exposure: pick("exposure", -1, 1),
		contrast: pick("contrast", -1, 1),
		saturation: pick("saturation", -1, 1),
		warmth: pick("warmth", -1, 1),
		tint: pick("tint", -1, 1),
		vignette: pick("vignette", 0, 1),
		sharpen: pick("sharpen", 0, 1),
		...(g.lutPath ? { lutPath: g.lutPath } : {}),
	};
}

/** True when the grade changes nothing. */
export function isNeutralGrade(g: GradeParams): boolean {
	const r = resolveGrade(g);
	return (
		!r.lutPath &&
		r.look !== "teal-orange" &&
		r.look !== "matte" &&
		[r.exposure, r.contrast, r.saturation, r.warmth, r.tint, r.vignette, r.sharpen].every((v) => Math.abs(v) < 0.005)
	);
}

function escapeFilterPath(p: string): string {
	return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/** The ffmpeg video filter chain for a grade; filters this ffmpeg lacks are left out. */
export function gradeFilterChain(g: GradeParams, available?: ReadonlySet<string>): string {
	const r = resolveGrade(g);
	const has = (f: string) => !available || available.has(f);
	const parts: string[] = [];
	const f = (n: number) => Number(n.toFixed(4));
	if (r.lutPath && has("lut3d")) parts.push(`lut3d=file='${escapeFilterPath(r.lutPath)}'`);
	if (Math.abs(r.exposure) >= 0.005 && has("colorlevels")) {
		const gain = 2 ** (r.exposure * 0.8);
		parts.push(
			gain >= 1
				? `colorlevels=rimax=${f(1 / gain)}:gimax=${f(1 / gain)}:bimax=${f(1 / gain)}`
				: `colorlevels=romax=${f(gain)}:gomax=${f(gain)}:bomax=${f(gain)}`,
		);
	}
	if ((Math.abs(r.contrast) >= 0.005 || r.look === "matte") && has("curves")) {
		const c = r.contrast * 0.12;
		const lo = r.look === "matte" ? 0.07 : 0;
		const hi = r.look === "matte" ? 0.96 : 1;
		parts.push(`curves=all='0/${f(lo)} 0.25/${f(0.25 - c)} 0.75/${f(0.75 + c)} 1/${f(hi)}'`);
	}
	if (Math.abs(r.warmth) >= 0.005 && has("colortemperature")) {
		parts.push(`colortemperature=temperature=${Math.round(6500 - r.warmth * 2500)}`);
	}
	if ((Math.abs(r.tint) >= 0.005 || r.look === "teal-orange") && has("colorbalance")) {
		const cb: string[] = [];
		if (Math.abs(r.tint) >= 0.005) cb.push(`gm=${f(-r.tint * 0.3)}`);
		if (r.look === "teal-orange") cb.push("rs=-0.12", "bs=0.15", "rh=0.15", "bh=-0.12");
		parts.push(`colorbalance=${cb.join(":")}`);
	}
	if (Math.abs(r.saturation) >= 0.005 && has("hue")) parts.push(`hue=s=${f(1 + r.saturation)}`);
	if (r.sharpen >= 0.005 && has("unsharp")) parts.push(`unsharp=5:5:${f(r.sharpen * 1.5)}`);
	if (r.vignette >= 0.005 && has("vignette")) parts.push(`vignette=angle=${f(0.2 + r.vignette * 0.7)}`);
	return parts.join(",");
}

export function videoFilterChain(ops: ProcessOps, available?: ReadonlySet<string>): string {
	const has = (f: string) => !available || available.has(f);
	const parts: string[] = [];
	if (ops.stabilize && has("deshake")) parts.push("deshake=rx=32:ry=32:edge=mirror:blocksize=8:contrast=125");
	if (ops.grade) {
		const g = gradeFilterChain(ops.grade, available);
		if (g) parts.push(g);
	}
	return parts.join(",");
}

/** Ops with the empty parts dropped; null when nothing is left. */
export function normalizeOps(ops: ProcessOps): ProcessOps | null {
	const out: ProcessOps = {};
	if (ops.grade && !isNeutralGrade(ops.grade)) out.grade = ops.grade;
	if (ops.stabilize) out.stabilize = true;
	if (ops.voice) out.voice = ops.voice;
	return Object.keys(out).length ? out : null;
}

export type ProcessTarget = { asset: AxcutAsset; sourcePath: string; ops: ProcessOps };

/** Recordings on the timeline (not pictures, not audio), with their original file and current treatments. */
export function processTargets(document: AxcutDocument, assetId?: string): ProcessTarget[] {
	const onTimeline = new Set(document.timeline.clips.map((c) => c.assetId));
	return document.assets
		.filter((a) => a.kind !== "audio" && !a.still && onTimeline.has(a.id) && (!assetId || a.id === assetId))
		.map((a) => ({ asset: a, sourcePath: currentSource(a), ops: currentOps(a) }));
}

export function currentSource(a: AxcutAsset): string {
	return a.derived?.sourcePath && (a.derived.kind === "processed" || a.derived.kind === "voice-clean") ? a.derived.sourcePath : a.originalPath;
}

export function currentOps(a: AxcutAsset): ProcessOps {
	if (a.derived?.kind === "processed" && a.derived.ops) {
		try {
			return JSON.parse(a.derived.ops) as ProcessOps;
		} catch {
			return {};
		}
	}
	// A clean-up made before grades existed.
	if (a.derived?.kind === "voice-clean" && a.derived.level) return { voice: a.derived.level as VoiceLevel };
	return {};
}

export function describeOps(ops: ProcessOps): string {
	const bits: string[] = [];
	if (ops.grade) {
		const r = resolveGrade(ops.grade);
		const set = (["exposure", "contrast", "saturation", "warmth", "tint", "vignette", "sharpen"] as const)
			.filter((k) => Math.abs(r[k]) >= 0.005)
			.map((k) => `${k} ${r[k] > 0 ? "+" : ""}${Math.round(r[k] * 100)}`);
		bits.push(`grade${r.look !== "none" ? ` "${r.look}"` : ""}${r.lutPath ? ` + LUT ${basename(r.lutPath)}` : ""}${set.length ? ` (${set.join(", ")})` : ""}`);
	}
	if (ops.stabilize) bits.push("stabilised");
	if (ops.voice) bits.push(`voice clean-up ${ops.voice}`);
	return bits.join(", ") || "original";
}

export async function bakeProcessed(input: {
	ffmpegPath: string;
	sourcePath: string;
	ops: ProcessOps;
	outDir: string;
	signal?: AbortSignal;
	onProgress?: (detail: string) => void;
}): Promise<{ path: string; videoChain: string; audioChain: string }> {
	if (!existsSync(input.sourcePath)) throw new Error("the recording file is missing");
	const probe = await runProcess(input.ffmpegPath, ["-hide_banner", "-i", input.sourcePath], { timeoutMs: 20_000, signal: input.signal }).catch(
		() => null,
	);
	const info = probe ? parseFfmpegProbe(probe.stderr) : null;
	const hasAudio = info ? info.hasAudio : true;
	const filters = await ffmpegFilters(input.ffmpegPath, input.signal);
	const videoChain = videoFilterChain(input.ops, filters);
	const audioChain = input.ops.voice && hasAudio ? voiceFilterChain(input.ops.voice, filters) : "";
	if (!videoChain && !audioChain) {
		throw new Error(input.ops.voice && !hasAudio ? "this recording has no sound" : "this ffmpeg has none of the needed filters");
	}
	if (input.ops.grade?.lutPath && !existsSync(input.ops.grade.lutPath)) throw new Error(`LUT not found: ${input.ops.grade.lutPath}`);
	mkdirSync(input.outDir, { recursive: true });
	const ext = extname(input.sourcePath).toLowerCase() === ".mov" ? ".mov" : ".mp4";
	const stem = basename(input.sourcePath, extname(input.sourcePath)).replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 50) || "recording";
	const out = join(input.outDir, `${stem}.processed-${Date.now().toString(36)}${ext}`);
	const encoder = videoChain ? await pickH264Encoder(input.ffmpegPath, input.signal) : "copy";
	const args = ["-y", "-nostdin", "-hide_banner", "-i", input.sourcePath, "-map", "0:v:0", "-map", "0:a?"];
	if (videoChain) {
		args.push("-vf", videoChain, "-c:v", encoder, ...(encoder === "libx264" ? ["-preset", "medium", "-crf", "18"] : ["-b:v", "14M"]), "-pix_fmt", "yuv420p");
	} else args.push("-c:v", "copy");
	if (audioChain) args.push("-af", audioChain, "-c:a", "aac", "-b:a", "192k");
	else args.push("-c:a", "copy");
	args.push("-movflags", "+faststart", out);
	input.onProgress?.(videoChain ? "Rendering the treated picture (this re-encodes the recording)" : "Processing the sound");
	const res = await runProcess(input.ffmpegPath, args, { timeoutMs: 3_600_000, signal: input.signal });
	if (res.code !== 0 || !existsSync(out)) throw new Error(`Could not process the recording: ${(res.stderr || "").slice(-400)}`);
	const sidecar = `${input.sourcePath}.cursor.json`;
	if (existsSync(sidecar)) copyFileSync(sidecar, `${out}.cursor.json`);
	return { path: out, videoChain, audioChain };
}

/** Point the asset at a processed copy (remembering the original and the ops), or back to the original. */
export function setProcessed(document: AxcutDocument, assetId: string, next: { path: string; ops: ProcessOps } | null): AxcutDocument {
	return {
		...document,
		assets: document.assets.map((a) => {
			if (a.id !== assetId) return a;
			const original = currentSource(a);
			if (!next) {
				const { derived: _d, ...rest } = a;
				return { ...rest, originalPath: original } as AxcutAsset;
			}
			return {
				...a,
				originalPath: next.path,
				derived: { fromAssetId: a.id, kind: "processed", sourcePath: original, ops: JSON.stringify(next.ops) },
			};
		}),
	};
}
