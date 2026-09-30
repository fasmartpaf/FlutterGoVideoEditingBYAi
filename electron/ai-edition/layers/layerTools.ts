/**
 * The agent's layer tools — addLayer / setLayer / removeLayer — as pure
 * document edits. Media prep runs the same edit first (so it can bake the
 * layer) and the executor runs it again and attaches the baked frames.
 */

import { z } from "zod";
import {
	LAYER_ENTRANCES,
	anchorLayerSpan,
	findLayer,
	layerSpanMs,
	removeLayer,
} from "../../../src/lib/ai-edition/document/layers";
import type { AxcutDocument, AxcutLayer } from "../../../src/lib/ai-edition/schema";

export const LAYER_POSITIONS = [
	"center",
	"top-left",
	"top",
	"top-right",
	"left",
	"right",
	"bottom-left",
	"bottom",
	"bottom-right",
	"full",
] as const;
export type LayerPosition = (typeof LAYER_POSITIONS)[number];

const keyframeArg = z.object({
	atSec: z.number().nonnegative(),
	x: z.number().min(-1).max(2).optional(),
	y: z.number().min(-1).max(2).optional(),
	scale: z.number().min(0.01).max(4).optional(),
	rotation: z.number().min(-3600).max(3600).optional(),
	opacity: z.number().min(0).max(1).optional(),
	ease: z.enum(["linear", "ease-in", "ease-out", "ease-in-out"]).optional(),
});

const chromaKeyArg = z
	.union([
		z.boolean(),
		z.enum(["green", "blue", "white", "black"]),
		z.object({
			color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
			similarity: z.number().min(0.01).max(1).optional(),
			blend: z.number().min(0).max(1).optional(),
		}),
	])
	.optional();

const lookArgs = {
	label: z.string().max(80).optional(),
	/** Remove a green (or other flat) screen behind the picture/video: true | "green" | "blue" | {color, similarity, blend}; false removes the key. */
	chromaKey: chromaKeyArg,
	position: z.enum(LAYER_POSITIONS).optional(),
	x: z.number().min(-1).max(2).optional(),
	y: z.number().min(-1).max(2).optional(),
	scale: z.number().min(0.01).max(4).optional(),
	rotation: z.number().min(-3600).max(3600).optional(),
	opacity: z.number().min(0).max(1).optional(),
	animateIn: z.enum(LAYER_ENTRANCES).optional(),
	animateOut: z.enum(LAYER_ENTRANCES).optional(),
	animateSec: z.number().min(0.05).max(10).optional(),
	cornerRadius: z.number().min(0).max(0.5).optional(),
	shadow: z.number().min(0).max(1).optional(),
	borderWidth: z.number().min(0).max(0.05).optional(),
	borderColor: z.string().max(40).optional(),
	zIndex: z.number().int().min(-1000).max(1000).optional(),
};

export const addLayerArgs = z.object({
	/** Absolute path to a picture (png/jpg/webp) or video on this machine. */
	path: z.string().min(1),
	startSec: z.number().nonnegative(),
	endSec: z.number().nonnegative().optional(),
	/** Video only: where in the file the layer starts. */
	sourceStartSec: z.number().nonnegative().optional(),
	keyframes: z.array(keyframeArg).max(60).optional(),
	...lookArgs,
});

export const setLayerArgs = z.object({
	layerId: z.string().min(1),
	path: z.string().min(1).optional(),
	startSec: z.number().nonnegative().optional(),
	endSec: z.number().nonnegative().optional(),
	sourceStartSec: z.number().nonnegative().optional(),
	/** Replaces all of the layer's own keyframes. */
	keyframes: z.array(keyframeArg).max(60).optional(),
	/** Adds to them. */
	addKeyframes: z.array(keyframeArg).max(60).optional(),
	clearKeyframes: z.boolean().optional(),
	...lookArgs,
});

export const removeLayerArgs = z.object({ layerId: z.string().min(1) });

const PICTURE = /\.(png|jpe?g|webp|bmp|gif)$/i;
const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;

export function layerSourceKind(path: string): "image" | "video" | null {
	if (PICTURE.test(path)) return "image";
	if (VIDEO.test(path)) return "video";
	return null;
}

/** Centre and scale for a named position: a margin in from the frame's edges. */
export function placeLayerBox(
	position: LayerPosition,
	scale: number | undefined,
	canvas: { width: number; height: number },
	source: { width?: number; height?: number } | undefined,
): { x: number; y: number; scale: number } {
	const aspect = source?.width && source?.height ? source.height / source.width : 9 / 16;
	if (position === "full") {
		// cover the frame
		return { x: 0.5, y: 0.5, scale: Math.max(1, canvas.height / (aspect * canvas.width)) };
	}
	const s = scale ?? (position === "center" ? 0.5 : 0.28);
	const m = 0.035 * Math.min(canvas.width, canvas.height);
	const w = s * canvas.width;
	const h = w * aspect;
	const left = (m + w / 2) / canvas.width;
	const top = (m + h / 2) / canvas.height;
	const x = position.includes("left") ? left : position.includes("right") ? 1 - left : 0.5;
	const y = position.startsWith("top") ? top : position.startsWith("bottom") ? 1 - top : 0.5;
	return { x, y, scale: s };
}

const KEY_COLORS = { green: "#00ff00", blue: "#0000ff", white: "#ffffff", black: "#000000" } as const;

export function resolveChromaKey(v: z.infer<typeof chromaKeyArg>): { color: string; similarity: number; blend: number } | null {
	if (v === undefined || v === false) return null;
	if (v === true) return { color: KEY_COLORS.green, similarity: 0.3, blend: 0.1 };
	if (typeof v === "string") return { color: KEY_COLORS[v], similarity: 0.3, blend: 0.1 };
	return { color: (v.color ?? KEY_COLORS.green).toLowerCase(), similarity: v.similarity ?? 0.3, blend: v.blend ?? 0.1 };
}

export type LayerToolContext = {
	/** Id for a new layer (prep and executor must agree). */
	newLayerId: string;
	canvas: { width: number; height: number };
	/** The source's size and (video) length, when probed. */
	source?: { width?: number; height?: number; durationSec?: number };
};

export type LayerToolResult =
	| { ok: true; document: AxcutDocument; layerId: string; changed: string[]; summary: string }
	| { ok: false; error: string };

function editedEndSec(document: AxcutDocument): number {
	return document.timeline.clips.reduce((m, c) => Math.max(m, c.timelineEndSec), 0);
}

function applyLook(
	layer: AxcutLayer,
	a: z.infer<typeof setLayerArgs> | z.infer<typeof addLayerArgs>,
	ctx: LayerToolContext,
	changed: string[],
	keepScale: boolean,
): AxcutLayer {
	const next: AxcutLayer = { ...layer };
	const source = { width: ctx.source?.width ?? layer.source.width, height: ctx.source?.height ?? layer.source.height };
	if (a.position) {
		Object.assign(next, placeLayerBox(a.position, a.scale ?? (keepScale ? layer.scale : undefined), ctx.canvas, source));
		changed.push(`position ${a.position}`);
	}
	// Explicit numbers win (x/y after a named position nudge it; scale was already used to place it).
	for (const key of ["x", "y", "scale", "rotation", "opacity", "cornerRadius", "shadow", "borderWidth", "animateSec", "zIndex"] as const) {
		const v = a[key];
		if (typeof v !== "number" || (key === "scale" && a.position)) continue;
		(next as Record<string, unknown>)[key] = v;
		changed.push(key);
	}
	for (const key of ["label", "borderColor", "animateIn", "animateOut"] as const) {
		const v = a[key];
		if (typeof v !== "string") continue;
		(next as Record<string, unknown>)[key] = v;
		changed.push(key);
	}
	if (a.chromaKey !== undefined) {
		const chromaKey = resolveChromaKey(a.chromaKey);
		next.source = { ...next.source, ...(chromaKey ? { chromaKey } : {}) };
		if (!chromaKey) delete (next.source as { chromaKey?: unknown }).chromaKey;
		changed.push(chromaKey ? `green screen ${chromaKey.color}` : "green screen off");
	}
	return next;
}

function withEase(k: z.infer<typeof keyframeArg>) {
	return { ...k, ease: k.ease ?? ("ease-in-out" as const) };
}

export function applyLayerTool(document: AxcutDocument, name: string, args: unknown, ctx: LayerToolContext): LayerToolResult {
	if (name === "removeLayer") {
		const p = removeLayerArgs.safeParse(args);
		if (!p.success) return { ok: false, error: p.error.message };
		const frags = findLayer(document, p.data.layerId);
		if (frags.length === 0) return { ok: false, error: `No layer ${p.data.layerId}. ${layerRoster(document)}` };
		return {
			ok: true,
			document: removeLayer(document, p.data.layerId),
			layerId: frags[0]!.layerId,
			changed: ["removed"],
			summary: `removed layer ${frags[0]!.label || frags[0]!.layerId}`,
		};
	}

	if (name === "addLayer") {
		const p = addLayerArgs.safeParse(args);
		if (!p.success) return { ok: false, error: p.error.message };
		const a = p.data;
		const kind = layerSourceKind(a.path);
		if (!kind) return { ok: false, error: "A layer shows a picture (png/jpg/webp) or a video (mp4/mov/webm)." };
		const srcStart = a.sourceStartSec ?? 0;
		const fallbackLen =
			kind === "video" && ctx.source?.durationSec ? Math.max(0.5, ctx.source.durationSec - srcStart) : 5;
		const endSec = a.endSec ?? a.startSec + fallbackLen;
		if (endSec <= a.startSec) return { ok: false, error: "endSec must be after startSec." };
		const changed: string[] = [];
		const base: AxcutLayer = {
			id: ctx.newLayerId,
			layerId: ctx.newLayerId,
			startMs: 0,
			endMs: 0,
			label: a.label ?? (a.path.split(/[\\/]/).pop() || "layer"),
			source: { kind, path: a.path, width: ctx.source?.width, height: ctx.source?.height, startSec: srcStart },
			x: 0.5,
			y: 0.5,
			scale: 0.4,
			rotation: 0,
			opacity: 1,
			keyframes: (a.keyframes ?? []).map(withEase),
			animateIn: "none",
			animateOut: "none",
			animateSec: 0.5,
			cornerRadius: 0,
			shadow: 0,
			borderWidth: 0,
			borderColor: "#ffffff",
			zIndex: (document.layers ?? []).reduce((m, l) => Math.max(m, l.zIndex + 1), 0),
			render: null,
			origin: "agent",
		};
		const looked = applyLook(
			base,
			{ ...a, position: a.position ?? (a.x === undefined && a.y === undefined ? "center" : undefined) },
			ctx,
			changed,
			false,
		);
		const frags = anchorLayerSpan(document, looked, Math.round(a.startSec * 1000), Math.round(endSec * 1000));
		if (!frags) {
			return {
				ok: false,
				error: `The span ${a.startSec.toFixed(1)}–${endSec.toFixed(1)} s covers no clip, so no layer was placed. The timeline runs 0–${editedEndSec(document).toFixed(1)} s.`,
			};
		}
		return {
			ok: true,
			document: { ...document, layers: [...(document.layers ?? []), ...frags] },
			layerId: ctx.newLayerId,
			changed: ["added", ...changed],
			summary: `added ${kind} layer ${looked.label}`,
		};
	}

	if (name === "setLayer") {
		const p = setLayerArgs.safeParse(args);
		if (!p.success) return { ok: false, error: p.error.message };
		const a = p.data;
		const frags = findLayer(document, a.layerId);
		const head = frags[0];
		if (!head) return { ok: false, error: `No layer ${a.layerId}. ${layerRoster(document)}` };
		const changed: string[] = [];
		let next = applyLook(head, a, ctx, changed, true);
		if (a.path) {
			const kind = layerSourceKind(a.path);
			if (!kind) return { ok: false, error: "A layer shows a picture (png/jpg/webp) or a video (mp4/mov/webm)." };
			next = {
				...next,
				source: {
					kind,
					path: a.path,
					width: ctx.source?.width,
					height: ctx.source?.height,
					startSec: a.sourceStartSec ?? 0,
					...(next.source.chromaKey ? { chromaKey: next.source.chromaKey } : {}),
				},
			};
			changed.push("source");
		} else if (typeof a.sourceStartSec === "number") {
			next = { ...next, source: { ...next.source, startSec: a.sourceStartSec } };
			changed.push("sourceStartSec");
		}
		if (a.clearKeyframes) {
			next = { ...next, keyframes: [] };
			changed.push("keyframes cleared");
		}
		if (a.keyframes) {
			next = { ...next, keyframes: a.keyframes.map(withEase) };
			changed.push(`keyframes (${a.keyframes.length})`);
		}
		if (a.addKeyframes) {
			next = { ...next, keyframes: [...next.keyframes, ...a.addKeyframes.map(withEase)] };
			changed.push(`+${a.addKeyframes.length} keyframes`);
		}
		if (changed.length === 0 && a.startSec === undefined && a.endSec === undefined) {
			return { ok: false, error: "Nothing to change — pass the fields to set." };
		}
		const span = layerSpanMs(frags);
		const startMs = a.startSec !== undefined ? Math.round(a.startSec * 1000) : span.startMs;
		const endMs = a.endSec !== undefined ? Math.round(a.endSec * 1000) : span.endMs;
		if (endMs <= startMs) return { ok: false, error: "endSec must be after startSec." };
		const without = removeLayer(document, head.layerId);
		const placed = anchorLayerSpan(without, { ...next, render: null }, startMs, endMs);
		if (!placed) return { ok: false, error: "That span covers no clip, so the layer was left as it was." };
		if (a.startSec !== undefined || a.endSec !== undefined) changed.push("timing");
		return {
			ok: true,
			document: { ...without, layers: [...(without.layers ?? []), ...placed] },
			layerId: head.layerId,
			changed,
			summary: `changed layer ${next.label || head.layerId}: ${changed.join(", ")}`,
		};
	}
	return { ok: false, error: `Unknown layer tool ${name}.` };
}

export function layerRoster(document: AxcutDocument): string {
	const groups = new Map<string, AxcutLayer[]>();
	for (const l of document.layers ?? []) groups.set(l.layerId, [...(groups.get(l.layerId) ?? []), l]);
	if (groups.size === 0) return "The project has no layers.";
	return `Layers: ${[...groups.values()]
		.map((f) => {
			const s = layerSpanMs(f);
			return `${f[0]!.layerId} "${f[0]!.label}" ${(s.startMs / 1000).toFixed(1)}–${(s.endMs / 1000).toFixed(1)}s`;
		})
		.join("; ")}.`;
}
