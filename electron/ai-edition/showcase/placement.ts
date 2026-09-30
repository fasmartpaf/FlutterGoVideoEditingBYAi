/**
 * Putting a finished showcase on the timeline.
 *
 * "replace" makes the showcase the whole programme: it already contains the
 * recording (cropped, retimed, framed, with its sound), so the old clips, the
 * trims/speed/mute ranges and the zooms and overlays timed against the old
 * clips are cleared, and the frame look is set to full-bleed — otherwise the
 * editor's padding, rounded corners and shadow would frame the already-framed
 * video a second time. The recording and its transcript stay in the project,
 * and chat undo brings the old edit back.
 */

import { DEFAULT_CROP_REGION } from "../../../src/components/video-editor/types";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { patchEditorSettings } from "../../../src/lib/ai-edition/store/editorSettings";
import { placeMotionClip, type PlacedMotionClip } from "../motionStudio/placement";

export type ShowcasePlacement = "replace" | "none" | "start" | "end";

export interface PlacedShowcase extends PlacedMotionClip {
	/** What "replace" cleared, for the receipt. */
	cleared: { clips: number; zooms: number; annotations: number };
}

export function placeShowcase(
	document: AxcutDocument,
	input: { mp4Path: string; durationSec: number; label: string; width?: number; height?: number },
	place: ShowcasePlacement,
): PlacedShowcase {
	if (place !== "replace") {
		return { ...placeMotionClip(document, input, place), cleared: { clips: 0, zooms: 0, annotations: 0 } };
	}
	const cleared = {
		clips: document.timeline.clips.length,
		zooms: (document.zoomRanges ?? []).length,
		annotations: (document.annotations ?? []).length,
	};
	const emptied: AxcutDocument = {
		...document,
		timeline: { ...document.timeline, clips: [], gaps: [], trimRanges: [], muteRanges: [], speedRanges: [], captionRanges: [] },
		zoomRanges: [],
		annotations: [],
	};
	const placed = placeMotionClip(emptied, input, "start");
	const fullBleed = patchEditorSettings(placed.document, {
		padding: 0,
		borderRadius: 0,
		shadowIntensity: 0,
		cropRegion: DEFAULT_CROP_REGION,
		// A vertical showcase makes the whole programme vertical (and back).
		...(input.width && input.height ? { aspectRatio: input.height > input.width ? ("9:16" as const) : ("16:9" as const) } : {}),
	});
	return { ...placed, document: fullBleed, where: "as the whole video (replacing the previous edit)", cleared };
}
