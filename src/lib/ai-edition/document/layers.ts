/**
 * Layers — pictures and videos stacked above the main video (Phase 1).
 *
 * Pure helpers shared by the agent tools, the baker (electron) and the scene
 * builder: grouping fragments into layers, keyframe interpolation, the frame a
 * layer is baked for, the cache key, and the annotation-shaped entries the
 * compositor draws.
 *
 * Model: a layer's plain fields (x, y, scale, rotation, opacity) are its state
 * at its start. Each keyframe sets some of those values at `atSec` (seconds
 * from the layer's start); a value travels from the previous point that set it
 * (or the start value) with the keyframe's easing, and holds after the last.
 */

import { getEditorSettings } from "../store/editorSettings";
import type { AxcutDocument, AxcutLayer, AxcutLayerKeyframe } from "../schema";
import { anchorRegionsWithDerivedMs } from "../timeline/timelineMap";
import { createId } from "./ids";
import { encodeImageSequenceRef } from "./imageSequence";
import { pickOutputDims } from "./outputFormat";

export const LAYER_FPS = 30;
/** Longest a layer may animate (or play video) for; after that its last frame holds. */
export const MAX_LAYER_SEQUENCE_SEC = 60;
/** Layers paint above every annotation and caption. */
export const LAYER_Z_BASE = 100_000;
const MAX_LAYER_CANVAS_LONG_SIDE = 1920;

export type LayerState = { x: number; y: number; scale: number; rotation: number; opacity: number };
/** Frame and source sizes, when known — they let a slide start exactly off-frame. */
export type LayerGeometry = { canvas?: { width: number; height: number }; source?: { width?: number; height?: number } };

export const LAYER_ENTRANCES = ["none", "fade", "slide-left", "slide-right", "slide-up", "slide-down", "pop", "zoom", "spin"] as const;
export type LayerEntrance = (typeof LAYER_ENTRANCES)[number];
type LayerLike = Pick<AxcutLayer, "x" | "y" | "scale" | "rotation" | "opacity" | "keyframes"> &
	Partial<Pick<AxcutLayer, "animateIn" | "animateOut" | "animateSec">>;
export type LayerEase = AxcutLayerKeyframe["ease"];
const PROPS = ["x", "y", "scale", "rotation", "opacity"] as const;

export function easeValue(ease: LayerEase, p: number): number {
	const t = Math.min(1, Math.max(0, p));
	switch (ease) {
		case "linear":
			return t;
		case "ease-in":
			return t * t * t;
		case "ease-out":
			return 1 - (1 - t) ** 3;
		default:
			return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
	}
}

export function layerBaseState(layer: Pick<AxcutLayer, "x" | "y" | "scale" | "rotation" | "opacity">): LayerState {
	return { x: layer.x, y: layer.y, scale: layer.scale, rotation: layer.rotation, opacity: layer.opacity };
}

export function sortedKeyframes(layer: Pick<AxcutLayer, "keyframes">): AxcutLayerKeyframe[] {
	return [...(layer.keyframes ?? [])].sort((a, b) => a.atSec - b.atSec);
}

/** Box height as a fraction of the frame height, for off-frame slides. */
function boxHeightFraction(scale: number, geom?: LayerGeometry): number {
	const c = geom?.canvas;
	const s = geom?.source;
	const aspect = s?.width && s?.height ? s.height / s.width : 9 / 16;
	return c ? (scale * c.width * aspect) / c.height : scale * aspect * (16 / 9);
}

/** Where an entrance starts from (or an exit ends at), relative to the resting pose. */
function entranceFrom(kind: string, rest: LayerState, geom?: LayerGeometry): Partial<LayerState> | null {
	const hf = boxHeightFraction(rest.scale, geom);
	switch (kind) {
		case "fade":
			return { opacity: 0 };
		case "slide-left":
			return { x: -rest.scale / 2 - 0.02 };
		case "slide-right":
			return { x: 1 + rest.scale / 2 + 0.02 };
		case "slide-up":
			return { y: 1 + hf / 2 + 0.02 };
		case "slide-down":
			return { y: -hf / 2 - 0.02 };
		case "pop":
			return { scale: rest.scale * 0.6, opacity: 0 };
		case "zoom":
			return { scale: rest.scale * 0.05, opacity: 0 };
		case "spin":
			return { scale: rest.scale * 0.3, rotation: rest.rotation - 180, opacity: 0 };
		default:
			return null;
	}
}

/**
 * The keyframes that actually drive the layer: its entrance (from off-pose to
 * rest over `animateSec`), its own keyframes, and its exit (rest to off-pose,
 * ending with the layer). The plain fields are the resting pose.
 */
export function effectiveKeyframes(layer: LayerLike, durationSec = Number.POSITIVE_INFINITY, geom?: LayerGeometry): AxcutLayerKeyframe[] {
	const rest = layerBaseState(layer);
	const own = sortedKeyframes(layer);
	const dur = Number.isFinite(durationSec) ? durationSec : Number.POSITIVE_INFINITY;
	const sec = Math.max(0.05, Math.min(layer.animateSec ?? 0.5, Number.isFinite(dur) ? dur / 2 : 60));
	const out: AxcutLayerKeyframe[] = [];
	const inFrom = entranceFrom(layer.animateIn ?? "none", rest, geom);
	if (inFrom) {
		out.push({ atSec: 0, ...inFrom, ease: "linear" });
		const back = Object.fromEntries(Object.keys(inFrom).map((k) => [k, rest[k as keyof LayerState]]));
		if (layer.animateIn === "pop") {
			// overshoot a little, then settle
			out.push({ atSec: sec * 0.7, scale: rest.scale * 1.08, opacity: rest.opacity, ease: "ease-out" });
			out.push({ atSec: sec, scale: rest.scale, ease: "ease-in-out" });
		} else {
			out.push({ atSec: sec, ...back, ease: "ease-out" });
		}
	}
	out.push(...own);
	const outTo = Number.isFinite(dur) ? entranceFrom(layer.animateOut ?? "none", rest, geom) : null;
	if (outTo) {
		const hold = Object.fromEntries(Object.keys(outTo).map((k) => [k, rest[k as keyof LayerState]]));
		out.push({ atSec: Math.max(0, dur - sec), ...hold, ease: "linear" });
		out.push({ atSec: dur, ...outTo, ease: "ease-in" });
	}
	return out.sort((a, b) => a.atSec - b.atSec);
}

/** The layer's transform `tSec` seconds after it starts (a layer `durationSec` long). */
export function layerStateAt(layer: LayerLike, tSec: number, durationSec?: number, geom?: LayerGeometry): LayerState {
	const base = layerBaseState(layer);
	const kfs = effectiveKeyframes(layer, durationSec, geom);
	if (kfs.length === 0) return base;
	const out = { ...base };
	for (const prop of PROPS) {
		let fromT = 0;
		let fromV = base[prop];
		for (const kf of kfs) {
			const v = kf[prop];
			if (typeof v !== "number") continue;
			if (tSec >= kf.atSec) {
				fromT = kf.atSec;
				fromV = v;
				continue;
			}
			const span = kf.atSec - fromT;
			const p = span > 0 ? (tSec - fromT) / span : 1;
			fromV = fromV + (v - fromV) * easeValue(kf.ease ?? "ease-in-out", p);
			break;
		}
		out[prop] = fromV;
	}
	return out;
}

/** When the last keyframe lands (0 = a still layer). */
export function layerAnimatedUntilSec(layer: LayerLike, durationSec?: number): number {
	return effectiveKeyframes(layer, durationSec).reduce((m, k) => Math.max(m, k.atSec), 0);
}

/** A layer's fragments grouped by `layerId`, each group in timeline order. */
export function layerGroups(document: AxcutDocument): Map<string, AxcutLayer[]> {
	const groups = new Map<string, AxcutLayer[]>();
	for (const frag of document.layers ?? []) {
		const key = frag.layerId || frag.id;
		const list = groups.get(key) ?? [];
		list.push(frag);
		groups.set(key, list);
	}
	for (const list of groups.values()) list.sort((a, b) => a.startMs - b.startMs);
	return groups;
}

export function findLayer(document: AxcutDocument, idOrLayerId: string): AxcutLayer[] {
	const groups = layerGroups(document);
	const direct = groups.get(idOrLayerId);
	if (direct) return direct;
	for (const list of groups.values()) if (list.some((f) => f.id === idOrLayerId)) return list;
	return [];
}

export function layerSpanMs(fragments: Array<{ startMs: number; endMs: number }>): { startMs: number; endMs: number } {
	return {
		startMs: Math.min(...fragments.map((f) => f.startMs)),
		endMs: Math.max(...fragments.map((f) => f.endMs)),
	};
}

/** Frames to bake: a video plays for its length, an animation until its last keyframe, a still is one frame. */
export function layerSequenceFrameCount(
	layer: LayerLike & Pick<AxcutLayer, "source">,
	durationSec: number,
	fps = LAYER_FPS,
): number {
	const cap = Math.round(MAX_LAYER_SEQUENCE_SEC * fps);
	if (layer.source.kind === "video") return Math.max(1, Math.min(cap, Math.ceil(Math.max(0, durationSec) * fps)));
	const until = Math.min(layerAnimatedUntilSec(layer, durationSec), Math.max(0, durationSec));
	if (until <= 0) return 1;
	return Math.max(1, Math.min(cap, Math.ceil(until * fps) + 1));
}

/** The output frame, capped to 1920 on the long side (layers are baked at this size). */
export function layerCanvasSize(document: AxcutDocument): { width: number; height: number } {
	const dims = pickOutputDims(document, getEditorSettings(document).aspectRatio);
	const w = dims.width > 0 ? dims.width : 1920;
	const h = dims.height > 0 ? dims.height : 1080;
	const k = Math.min(1, MAX_LAYER_CANVAS_LONG_SIDE / Math.max(w, h));
	const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
	return { width: even(w * k), height: even(h * k) };
}

/** Pixel size of the layer box for a state, from the source's shape. */
export function layerBoxPx(
	state: LayerState,
	source: { width?: number; height?: number },
	canvas: { width: number; height: number },
): { w: number; h: number } {
	const w = state.scale * canvas.width;
	const aspect = source.width && source.height ? source.height / source.width : 9 / 16;
	return { w, h: w * aspect };
}

/**
 * The part of the frame the layer ever touches while it animates (rotated boxes
 * included), in pixels, clamped to the frame — only this area is baked, so a
 * small picture-in-picture doesn't cost full-frame PNGs.
 */
export function layerBoundsPx(
	states: LayerState[],
	source: { width?: number; height?: number },
	canvas: { width: number; height: number },
	pad = 0,
): { x: number; y: number; w: number; h: number } | null {
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (const s of states) {
		if (s.opacity <= 0) continue;
		const { w, h } = layerBoxPx(s, source, canvas);
		const r = (s.rotation * Math.PI) / 180;
		const hw = (Math.abs(w * Math.cos(r)) + Math.abs(h * Math.sin(r))) / 2 + pad;
		const hh = (Math.abs(w * Math.sin(r)) + Math.abs(h * Math.cos(r))) / 2 + pad;
		const cx = s.x * canvas.width;
		const cy = s.y * canvas.height;
		x0 = Math.min(x0, cx - hw);
		y0 = Math.min(y0, cy - hh);
		x1 = Math.max(x1, cx + hw);
		y1 = Math.max(y1, cy + hh);
	}
	if (!Number.isFinite(x0)) return null;
	const floorEven = (n: number) => Math.floor(n / 2) * 2;
	const ceilEven = (n: number) => Math.ceil(n / 2) * 2;
	const bx = Math.max(0, floorEven(x0));
	const by = Math.max(0, floorEven(y0));
	const bx1 = Math.min(canvas.width, ceilEven(x1));
	const by1 = Math.min(canvas.height, ceilEven(y1));
	if (bx1 - bx < 2 || by1 - by < 2) return null;
	return { x: bx, y: by, w: bx1 - bx, h: by1 - by };
}

/** 32-bit FNV-1a, hex — a stable cache key without node:crypto (this module also runs in the renderer). */
function fnv1a(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, "0");
}

/** Everything the baked frames depend on. Change any of it and the layer needs a re-bake. */
export function layerRenderKey(
	layer: AxcutLayer,
	canvas: { width: number; height: number },
	durationSec: number,
	sourceStamp = "",
): string {
	const payload = JSON.stringify({
		v: 1,
		c: [canvas.width, canvas.height],
		d: Math.round(durationSec * 1000),
		s: [layer.source.kind, layer.source.path, layer.source.startSec ?? 0, sourceStamp],
		t: [layer.x, layer.y, layer.scale, layer.rotation, layer.opacity],
		k: sortedKeyframes(layer).map((k) => [k.atSec, k.x, k.y, k.scale, k.rotation, k.opacity, k.ease]),
		l: [layer.cornerRadius, layer.shadow, layer.borderWidth, layer.borderColor],
		a: [layer.animateIn ?? "none", layer.animateOut ?? "none", layer.animateSec ?? 0.5],
	});
	return `${fnv1a(payload)}${fnv1a(`${payload}#`)}`;
}

/**
 * Baked layers as image-sequence annotations in output-frame space, for the
 * scene builder. A fragment later in the same layer continues the sequence
 * (offsetSec) instead of restarting it.
 */
export function layersAsAnnotations(document: AxcutDocument): NonNullable<AxcutDocument["annotations"]> {
	const out: Array<Record<string, unknown>> = [];
	for (const fragments of layerGroups(document).values()) {
		const head = fragments[0];
		const render = head?.render;
		if (!head || !render) continue;
		const startMs = layerSpanMs(fragments).startMs;
		for (const frag of fragments) {
			out.push({
				id: `layer-${frag.id}`,
				startMs: frag.startMs,
				endMs: frag.endMs,
				...(frag.clipId !== undefined ? { clipId: frag.clipId } : {}),
				...(frag.sourceStartSec !== undefined ? { sourceStartSec: frag.sourceStartSec } : {}),
				...(frag.sourceEndSec !== undefined ? { sourceEndSec: frag.sourceEndSec } : {}),
				type: "image",
				content: render.posterPath,
				imageContent: encodeImageSequenceRef({
					dir: render.dir,
					fps: render.fps,
					frameCount: render.frameCount,
					offsetSec: Math.max(0, (frag.startMs - startMs) / 1000),
				}),
				position: { x: render.x * 100, y: render.y * 100 },
				size: { width: render.w * 100, height: render.h * 100 },
				style: {},
				zIndex: LAYER_Z_BASE + (head.zIndex ?? 0),
				space: "frame",
			});
		}
	}
	return out as unknown as NonNullable<AxcutDocument["annotations"]>;
}

/** Drop a layer (every fragment of it). */
export function removeLayer(document: AxcutDocument, idOrLayerId: string): AxcutDocument {
	const ids = new Set(findLayer(document, idOrLayerId).map((f) => f.id));
	if (ids.size === 0) return document;
	return { ...document, layers: (document.layers ?? []).filter((f) => !ids.has(f.id)) };
}

/** Apply a change to every fragment of a layer. */
export function updateLayer(
	document: AxcutDocument,
	idOrLayerId: string,
	patch: (fragment: AxcutLayer) => AxcutLayer,
): AxcutDocument {
	const ids = new Set(findLayer(document, idOrLayerId).map((f) => f.id));
	if (ids.size === 0) return document;
	return { ...document, layers: (document.layers ?? []).map((f) => (ids.has(f.id) ? patch(f) : f)) };
}

/**
 * Lay a layer over a raw-timeline span: one fragment per clip it covers, all
 * sharing its `layerId`. Null when the span covers no clip (it could never play).
 */
export function anchorLayerSpan(document: AxcutDocument, layer: AxcutLayer, startMs: number, endMs: number): AxcutLayer[] | null {
	const { clipId: _c, sourceStartSec: _s, sourceEndSec: _e, ...rest } = layer;
	const region = { ...rest, id: layer.layerId, startMs, endMs };
	const frags = anchorRegionsWithDerivedMs([region], document.timeline.clips, () => createId("layer")) as AxcutLayer[];
	if (frags.length === 0 || frags.some((f) => typeof f.clipId !== "string")) return null;
	return frags.map((f) => ({ ...f, layerId: layer.layerId }));
}

/** Move/resize a layer in time. Unchanged document when the new span covers no clip. */
export function retimeLayer(document: AxcutDocument, idOrLayerId: string, startMs: number, endMs: number): AxcutDocument {
	const frags = findLayer(document, idOrLayerId);
	const head = frags[0];
	if (!head || endMs <= startMs) return document;
	const without = removeLayer(document, head.layerId);
	const placed = anchorLayerSpan(without, head, Math.max(0, Math.round(startMs)), Math.round(endMs));
	if (!placed) return document;
	return { ...without, layers: [...(without.layers ?? []), ...placed] };
}
