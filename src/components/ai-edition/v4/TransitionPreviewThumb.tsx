/**
 * Geometry-faithful mini preview for Transition Library cards.
 * Uses the same A/B mode geometry as Metal `ab_from_layer_geometry` —
 * not unrelated CSS. Frames are cached per transitionId (no native decoders).
 */

import { useEffect, useRef } from "react";
import { NATIVE_IMPL_MODE } from "../../../../electron/ai-edition/transitionLibrary";

const CACHE = new Map<string, ImageData[]>();
const W = 96;
const H = 54;

function modeForImpl(implementationRef: string): number {
	return NATIVE_IMPL_MODE[implementationRef] ?? 1;
}

/** Mirror of compositor_macos ab_from_layer_geometry (dst fraction of full frame). */
function fromLayer(
	mode: number,
	progress: number,
): { dx: number; dy: number; dw: number; dh: number; alpha: number } {
	const p = Math.min(1, Math.max(0, progress));
	const dissolve = 1 - p;
	switch (mode) {
		case 0:
			return { dx: 0, dy: 0, dw: 1, dh: 1, alpha: 0 };
		case 1:
		case 8:
		case 9:
			return { dx: 0, dy: 0, dw: 1, dh: 1, alpha: dissolve };
		case 10:
			return {
				dx: 0,
				dy: 0,
				dw: 1,
				dh: 1,
				alpha: p < 0.5 ? 1 : Math.max(0, 1 - (p - 0.5) * 2),
			};
		case 2: // wipe left
			return { dx: p, dy: 0, dw: Math.max(0, 1 - p), dh: 1, alpha: 1 };
		case 3: // wipe right
			return { dx: 0, dy: 0, dw: Math.max(0, 1 - p), dh: 1, alpha: 1 };
		case 4: // wipe up
			return { dx: 0, dy: p, dw: 1, dh: Math.max(0, 1 - p), alpha: 1 };
		case 5: // wipe down
			return { dx: 0, dy: 0, dw: 1, dh: Math.max(0, 1 - p), alpha: 1 };
		case 6: // slide left
			return { dx: -p, dy: 0, dw: 1, dh: 1, alpha: 1 - p };
		case 7: // slide right
			return { dx: p, dy: 0, dw: 1, dh: 1, alpha: 1 - p };
		default:
			return { dx: 0, dy: 0, dw: 1, dh: 1, alpha: dissolve };
	}
}

function paintPattern(
	ctx: CanvasRenderingContext2D,
	kind: "a" | "b",
	t: number,
	x: number,
	y: number,
	w: number,
	h: number,
) {
	const g = ctx.createLinearGradient(x, y, x + w, y + h);
	if (kind === "a") {
		g.addColorStop(0, "#3b82f6");
		g.addColorStop(1, "#1e3a8a");
	} else {
		g.addColorStop(0, "#f59e0b");
		g.addColorStop(1, "#b45309");
	}
	ctx.fillStyle = g;
	ctx.fillRect(x, y, w, h);
	ctx.fillStyle = "rgba(255,255,255,0.55)";
	const stripe = ((t * 40) % 24) - 12;
	for (let i = -2; i < 8; i++) {
		ctx.fillRect(x + i * 18 + stripe, y, 6, h);
	}
	ctx.fillStyle = "rgba(0,0,0,0.35)";
	ctx.font = "bold 11px system-ui";
	ctx.fillText(kind.toUpperCase(), x + 6, y + 16);
}

function buildFrames(mode: number): ImageData[] {
	const canvas = document.createElement("canvas");
	canvas.width = W;
	canvas.height = H;
	const ctx = canvas.getContext("2d")!;
	const frames: ImageData[] = [];
	for (let i = 0; i < 16; i++) {
		const p = i / 15;
		const t = i / 16;
		ctx.clearRect(0, 0, W, H);
		paintPattern(ctx, "b", t, 0, 0, W, H);
		const from = fromLayer(mode, p);
		if (from.alpha > 0.02 && from.dw > 0.02 && from.dh > 0.02) {
			ctx.save();
			ctx.globalAlpha = from.alpha;
			const fx = from.dx * W;
			const fy = from.dy * H;
			const fw = from.dw * W;
			const fh = from.dh * H;
			ctx.beginPath();
			ctx.rect(fx, fy, fw, fh);
			ctx.clip();
			paintPattern(ctx, "a", t, fx - from.dx * W, fy - from.dy * H, W, H);
			ctx.restore();
		}
		frames.push(ctx.getImageData(0, 0, W, H));
	}
	return frames;
}

function framesFor(implementationRef: string, id: string): ImageData[] {
	const cached = CACHE.get(id);
	if (cached) return cached;
	const frames = buildFrames(modeForImpl(implementationRef));
	CACHE.set(id, frames);
	return frames;
}

export function TransitionPreviewThumb(props: {
	transitionId: string;
	implementationRef: string;
	playing?: boolean;
	selected?: boolean;
}) {
	const ref = useRef<HTMLCanvasElement | null>(null);
	useEffect(() => {
		const canvas = ref.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const frames = framesFor(props.implementationRef, props.transitionId);
		let i = 0;
		let raf = 0;
		let last = 0;
		const draw = (now: number) => {
			if (!props.playing) {
				ctx.putImageData(frames[8]!, 0, 0);
				return;
			}
			if (now - last > 70) {
				last = now;
				ctx.putImageData(frames[i % frames.length]!, 0, 0);
				i++;
			}
			raf = requestAnimationFrame(draw);
		};
		raf = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(raf);
	}, [props.transitionId, props.implementationRef, props.playing]);

	return (
		<canvas
			ref={ref}
			width={W}
			height={H}
			data-testid={`transition-preview-${props.transitionId}`}
			aria-hidden
			style={{
				width: "100%",
				height: "auto",
				display: "block",
				borderRadius: 8,
				outline: props.selected ? "2px solid var(--accent)" : "1px solid var(--border)",
				background: "var(--bg)",
			}}
		/>
	);
}

export function clearTransitionPreviewCacheForTests() {
	CACHE.clear();
}
