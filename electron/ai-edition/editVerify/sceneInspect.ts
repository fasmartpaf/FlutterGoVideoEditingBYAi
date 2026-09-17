/**
 * Inspect SceneDescription for expected zoom/crop/speed effect presence.
 * Prefer scene state over brittle pixel-diff.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { buildSceneDescription } from "../../../src/native/sceneDescription";

export interface SceneEffectInspection {
	sceneBuildMs: number;
	zoomActiveAt: boolean;
	zoomScale: number | null;
	zoomFocus: { x: number; y: number } | null;
	cropOnClip: { x: number; y: number; width: number; height: number } | null;
	speedActiveAt: boolean;
	speedMultiplier: number | null;
	notes: string[];
}

export function inspectSceneEffects(args: {
	document: AxcutDocument;
	/** SOURCE time (seconds) used by scene zoom/speed regions. */
	sourceTimeSec: number;
	clipIndex?: number;
}): SceneEffectInspection {
	const t0 = Date.now();
	const notes: string[] = [];
	const scene = buildSceneDescription(args.document);
	const t = args.sourceTimeSec;

	let zoomActiveAt = false;
	let zoomScale: number | null = null;
	let zoomFocus: { x: number; y: number } | null = null;
	for (const z of scene.zoomRegions ?? []) {
		if (t >= z.startSec - 1e-6 && t <= z.endSec + 1e-6) {
			if (args.clipIndex != null && z.clipIndex != null && z.clipIndex !== args.clipIndex) {
				continue;
			}
			zoomActiveAt = true;
			zoomScale = z.scale;
			zoomFocus = { x: z.focusX, y: z.focusY };
			break;
		}
	}

	const cropEntry = args.clipIndex != null ? (scene.cropByClip?.[args.clipIndex] ?? null) : null;
	const cropOnClip =
		cropEntry && typeof cropEntry === "object"
			? {
					x: cropEntry.x,
					y: cropEntry.y,
					width: cropEntry.width,
					height: cropEntry.height,
				}
			: null;

	let speedActiveAt = false;
	let speedMultiplier: number | null = null;
	for (const s of scene.speedRegions ?? []) {
		if (t >= s.startSec - 1e-6 && t <= s.endSec + 1e-6) {
			speedActiveAt = true;
			speedMultiplier = s.speed;
			break;
		}
	}

	if (!zoomActiveAt) notes.push("no_zoom_at_time");
	return {
		sceneBuildMs: Date.now() - t0,
		zoomActiveAt,
		zoomScale,
		zoomFocus,
		cropOnClip,
		speedActiveAt,
		speedMultiplier,
		notes,
	};
}
