/**
 * Bake a layer into a transparent PNG sequence the compositor draws on top.
 *
 * The layer is drawn by a small HTML page (the motion renderer, virtual clock)
 * frame by frame: the picture — or, for a video layer, that frame of the video
 * — positioned, scaled, rotated and faded per the layer's keyframes, with its
 * rounded corners, border and shadow. Only the part of the frame the layer
 * ever covers is captured. Results are cached by the layer's render key.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import {
	LAYER_FPS,
	findLayer,
	layerBoundsPx,
	layerBoxPx,
	layerCanvasSize,
	layerRenderKey,
	layerSequenceFrameCount,
	layerSpanMs,
	layerStateAt,
	updateLayer,
} from "../../../src/lib/ai-edition/document/layers";
import { sequenceFrameName } from "../../../src/lib/ai-edition/document/imageSequence";
import type { AxcutDocument, AxcutLayer, AxcutLayerRender } from "../../../src/lib/ai-edition/schema";
import { probeImageSize } from "../imageClip";
import { runProcess } from "../mediaStudio";
import { writeComposition } from "../motionStudio/composition";
import type { FrameSource } from "../motionStudio/render";
import { parseFfmpegProbe } from "../showcase/render";

export type BakeLayerOptions = {
	ffmpegPath: string | null;
	createFrameSource: () => Promise<FrameSource | null>;
	/** Folder that holds every baked layer (one sub-folder per render key). */
	outRoot: string;
	signal?: AbortSignal;
	onProgress?: (done: number, total: number) => void;
};

function abortError(): Error {
	const err = new Error("aborted");
	err.name = "AbortError";
	return err;
}

function sourceStamp(path: string): string {
	try {
		const st = statSync(path);
		return `${st.size}:${Math.round(st.mtimeMs)}`;
	} catch {
		return "missing";
	}
}

async function probeSource(
	layer: AxcutLayer,
	ffmpegPath: string | null,
	signal?: AbortSignal,
): Promise<{ width: number; height: number; durationSec: number } | null> {
	if (!ffmpegPath) return null;
	if (layer.source.kind === "image") {
		const size = await probeImageSize(ffmpegPath, layer.source.path, signal);
		return size ? { ...size, durationSec: 0 } : null;
	}
	const probe = await runProcess(ffmpegPath, ["-hide_banner", "-i", layer.source.path], { timeoutMs: 20_000, signal }).catch(
		() => null,
	);
	const info = probe ? parseFfmpegProbe(probe.stderr) : null;
	return info ? { width: info.width, height: info.height, durationSec: info.durationSec } : null;
}

/** The page that draws one layer. `states` are per-frame boxes in capture pixels. */
export function layerPageHtml(input: {
	width: number;
	height: number;
	imageFile: string | null;
	videoFrames: string[] | null;
	states: Array<[number, number, number, number, number, number]>;
	radiusPx: number[];
	borderPx: number;
	borderColor: string;
	shadow: number;
	fps: number;
}): string {
	const first = input.videoFrames?.[0] ?? input.imageFile ?? "";
	const shadow =
		input.shadow > 0
			? `box-shadow:0 ${Math.round(12 * input.shadow)}px ${Math.round(40 * input.shadow)}px rgba(0,0,0,${(0.55 * input.shadow).toFixed(3)});`
			: "";
	const border = input.borderPx > 0 ? `border:${input.borderPx.toFixed(2)}px solid ${input.borderColor};` : "";
	return `<!doctype html><html><head><style>
#L{position:absolute;left:0;top:0;box-sizing:border-box;overflow:hidden;transform-origin:50% 50%;${border}${shadow}will-change:transform,opacity}
#I{width:100%;height:100%;display:block;object-fit:cover}
</style></head><body><div id="L"><img id="I" src="${first.replace(/"/g, "&quot;")}"></div>
<script>
const S=${JSON.stringify(input.states)};
const R=${JSON.stringify(input.radiusPx)};
const F=${JSON.stringify(input.videoFrames)};
const FPS=${input.fps};
const L=document.getElementById("L"), I=document.getElementById("I");
let ready=I.decode().catch(()=>{});
window.render=async(t)=>{
  await ready;
  const i=Math.min(S.length-1,Math.max(0,Math.round(t*FPS)));
  const s=S[i];
  L.style.width=s[2]+"px"; L.style.height=s[3]+"px";
  L.style.transform="translate("+(s[0]-s[2]/2)+"px,"+(s[1]-s[3]/2)+"px) rotate("+s[4]+"deg)";
  L.style.opacity=String(s[5]);
  L.style.borderRadius=R[i]+"px";
  if(F){const f=F[Math.min(F.length-1,Math.max(0,Math.round(t*FPS)))];
    if(I.getAttribute("src")!==f){I.src=f; await I.decode().catch(()=>{});}}
};
</script></body></html>`;
}

/**
 * Bake one layer (all its fragments) and store the result on it. Returns the
 * updated document and the render; a cached bake is reused.
 */
export async function bakeLayer(
	document: AxcutDocument,
	layerId: string,
	options: BakeLayerOptions,
): Promise<{ document: AxcutDocument; render: AxcutLayerRender; reused: boolean }> {
	const { signal } = options;
	const fragments = findLayer(document, layerId);
	const head = fragments[0];
	if (!head) throw new Error(`No layer ${layerId}.`);
	if (!existsSync(head.source.path)) throw new Error(`Layer source not found: ${head.source.path}`);

	let layer = head;
	if (!layer.source.width || !layer.source.height) {
		const probed = await probeSource(layer, options.ffmpegPath, signal);
		if (probed) {
			layer = { ...layer, source: { ...layer.source, width: probed.width, height: probed.height } };
			document = updateLayer(document, layerId, (f) => ({ ...f, source: { ...f.source, width: probed.width, height: probed.height } }));
		}
	}

	const canvas = layerCanvasSize(document);
	const span = layerSpanMs(fragments);
	const durationSec = Math.max(0.1, (span.endMs - span.startMs) / 1000);
	const key = layerRenderKey(layer, canvas, durationSec, sourceStamp(layer.source.path));
	const dir = join(options.outRoot, key);
	const metaPath = join(dir, "layer.json");

	if (existsSync(metaPath)) {
		try {
			const cached = JSON.parse(readFileSync(metaPath, "utf8")) as AxcutLayerRender;
			if (cached.key === key && existsSync(join(dir, sequenceFrameName(cached.frameCount - 1)))) {
				return { document: updateLayer(document, layerId, (f) => ({ ...f, render: cached })), render: cached, reused: true };
			}
		} catch {
			// re-bake below
		}
	}

	const fps = LAYER_FPS;
	const frameCount = layerSequenceFrameCount(layer, durationSec, fps);
	const states = Array.from({ length: frameCount }, (_, i) => layerStateAt(layer, i / fps));
	const src = { width: layer.source.width, height: layer.source.height };
	const borderPx = layer.borderWidth * canvas.width;
	const pad = Math.ceil(borderPx + (layer.shadow > 0 ? 48 * layer.shadow + 16 : 2));
	const bounds = layerBoundsPx(states, src, canvas, pad);
	if (!bounds) throw new Error("The layer is entirely off-frame or invisible, so there is nothing to draw.");

	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });

	// Sources the page loads must sit next to it.
	let imageFile: string | null = null;
	let videoFrames: string[] | null = null;
	if (layer.source.kind === "image") {
		imageFile = `src${extname(layer.source.path).toLowerCase() || ".png"}`;
		copyFileSync(layer.source.path, join(dir, imageFile));
	} else {
		if (!options.ffmpegPath) throw new Error("ffmpeg is needed to use a video as a layer.");
		const maxW = Math.max(...states.map((s) => layerBoxPx(s, src, canvas).w));
		const scaleW = Math.min(1920, Math.max(64, Math.round(maxW / 2) * 2));
		const res = await runProcess(
			options.ffmpegPath,
			[
				"-y",
				"-nostdin",
				"-hide_banner",
				"-ss",
				String(layer.source.startSec ?? 0),
				"-i",
				layer.source.path,
				"-t",
				String(frameCount / fps),
				"-vf",
				`fps=${fps},scale=${scaleW}:-2`,
				"-q:v",
				"3",
				join(dir, "v-%05d.jpg"),
			],
			{ timeoutMs: 300_000, signal },
		);
		videoFrames = existsSync(dir)
			? readdirSync(dir)
					.filter((n) => /^v-\d{5}\.jpg$/.test(n))
					.sort()
			: [];
		if (res.code !== 0 || videoFrames.length === 0) {
			throw new Error(`Could not read the layer video: ${(res.stderr || "").slice(-300)}`);
		}
	}

	const html = layerPageHtml({
		width: bounds.w,
		height: bounds.h,
		imageFile,
		videoFrames,
		states: states.map((s) => {
			const box = layerBoxPx(s, src, canvas);
			return [
				s.x * canvas.width - bounds.x,
				s.y * canvas.height - bounds.y,
				box.w,
				box.h,
				s.rotation,
				Math.min(1, Math.max(0, s.opacity)),
			] as [number, number, number, number, number, number];
		}),
		radiusPx: states.map((s) => {
			const box = layerBoxPx(s, src, canvas);
			return layer.cornerRadius * Math.min(box.w, box.h);
		}),
		borderPx,
		borderColor: layer.borderColor,
		shadow: layer.shadow,
		fps,
	});
	const htmlPath = join(dir, "layer.html");
	writeFileSync(htmlPath, html, "utf8");
	const composition = writeComposition({ htmlPath }, { width: bounds.w, height: bounds.h, background: "transparent" });

	const source = await options.createFrameSource();
	if (!source) throw new Error("The layer renderer is not available.");
	try {
		await source.open(composition.path, { width: bounds.w, height: bounds.h }, { transparent: true });
		for (let i = 0; i < frameCount; i++) {
			if (signal?.aborted) throw abortError();
			const png = await source.frame((i * 1000) / fps);
			writeFileSync(join(dir, sequenceFrameName(i)), png);
			options.onProgress?.(i + 1, frameCount);
		}
	} finally {
		await source.close().catch(() => undefined);
		composition.dispose();
	}
	// The frames are what's kept; the extracted video stills were scratch.
	for (const f of videoFrames ?? []) rmSync(join(dir, f), { force: true });

	const render: AxcutLayerRender = {
		dir,
		fps,
		frameCount,
		posterPath: join(dir, sequenceFrameName(0)),
		key,
		x: bounds.x / canvas.width,
		y: bounds.y / canvas.height,
		w: bounds.w / canvas.width,
		h: bounds.h / canvas.height,
	};
	writeFileSync(metaPath, JSON.stringify(render), "utf8");
	return { document: updateLayer(document, layerId, (f) => ({ ...f, render })), render, reused: false };
}
