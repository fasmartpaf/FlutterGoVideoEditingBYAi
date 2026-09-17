/**
 * Document mutators for verified apply (one op). Does not call agent tools / LLM.
 */

import { setClipCropRegion } from "../../../src/lib/ai-edition/document/timeline";
import type { AxcutDocument, AxcutZoomRegion } from "../../../src/lib/ai-edition/schema";
import type { ZoomDepth } from "../../../src/lib/ai-edition/timeline/zoom-scale";
import type { NormalizedRect } from "./types";

export interface ZoomMutationSpec {
	id: string;
	startSec: number;
	endSec: number;
	depth: ZoomDepth;
	focus: { cx: number; cy: number };
	customScale?: number;
	clipId?: string;
}

export interface CropMutationSpec {
	clipId: string;
	crop: NormalizedRect;
}

export interface SpeedMutationSpec {
	id: string;
	startSec: number;
	endSec: number;
	speed: number;
}

export function applyZoomMutation(document: AxcutDocument, spec: ZoomMutationSpec): AxcutDocument {
	const zoom: AxcutZoomRegion = {
		id: spec.id,
		startMs: Math.round(spec.startSec * 1000),
		endMs: Math.round(spec.endSec * 1000),
		depth: spec.depth,
		focus: spec.focus,
		focusMode: "manual",
		source: "manual",
		...(spec.customScale != null ? { customScale: spec.customScale } : {}),
		...(spec.clipId ? { clipId: spec.clipId } : {}),
	};
	return {
		...document,
		zoomRanges: [...document.zoomRanges, zoom],
	};
}

export function applyCropMutation(document: AxcutDocument, spec: CropMutationSpec): AxcutDocument {
	return setClipCropRegion(document, spec.clipId, spec.crop);
}

export function applySpeedMutation(
	document: AxcutDocument,
	spec: SpeedMutationSpec,
): AxcutDocument {
	const legacy = (document.legacyEditor as Record<string, unknown>) ?? {};
	const prev =
		(legacy.speedRegions as Array<{ id: string; startMs: number; endMs: number; speed: number }>) ??
		[];
	const region = {
		id: spec.id,
		startMs: Math.round(spec.startSec * 1000),
		endMs: Math.round(spec.endSec * 1000),
		speed: spec.speed,
	};
	return {
		...document,
		legacyEditor: { ...legacy, speedRegions: [...prev, region] },
	};
}
