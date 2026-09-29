/**
 * Animated image overlays: an image annotation whose picture is a numbered
 * PNG sequence (with alpha) instead of one still.
 *
 * Stored WITHOUT a schema change: the annotation's `content` holds a poster
 * frame (so older builds, the inspector and anything that only knows stills
 * show a sensible picture), and `imageContent` holds a tagged reference to
 * the sequence. Both are plain strings, so the reference survives every
 * persistence / migration layer untouched. The scene builder decodes it and
 * hands the compositor `imageSequence`, which picks the frame for the
 * current time.
 */

export const IMAGE_SEQUENCE_TAG = "openscreen-seq:";

export interface ImageSequenceRef {
	/** Absolute folder holding frame-00000.png, frame-00001.png, … */
	dir: string;
	fps: number;
	frameCount: number;
	/** Seconds into the sequence at which this fragment starts (a split overlay continues, not restarts). */
	offsetSec?: number;
}

/** File name of frame `index` inside the sequence folder. */
export function sequenceFrameName(index: number): string {
	return `frame-${String(index).padStart(5, "0")}.png`;
}

export function encodeImageSequenceRef(ref: ImageSequenceRef): string {
	return `${IMAGE_SEQUENCE_TAG}${JSON.stringify(ref)}`;
}

export function decodeImageSequenceRef(value: string | undefined | null): ImageSequenceRef | null {
	if (!value || !value.startsWith(IMAGE_SEQUENCE_TAG)) return null;
	try {
		const parsed = JSON.parse(value.slice(IMAGE_SEQUENCE_TAG.length)) as Partial<ImageSequenceRef>;
		if (
			typeof parsed.dir !== "string" ||
			!parsed.dir ||
			!(typeof parsed.fps === "number" && parsed.fps > 0 && parsed.fps <= 120) ||
			!(typeof parsed.frameCount === "number" && Number.isInteger(parsed.frameCount) && parsed.frameCount > 0)
		) {
			return null;
		}
		const offsetSec = typeof parsed.offsetSec === "number" && parsed.offsetSec > 0 ? parsed.offsetSec : 0;
		return { dir: parsed.dir, fps: parsed.fps, frameCount: parsed.frameCount, offsetSec };
	} catch {
		return null;
	}
}

/**
 * The frame to show `elapsedSec` after this fragment starts: plays once at
 * `fps`, then holds the last frame. Mirrors `SceneImageSequence::frame_index`
 * in the Rust compositor — keep the two in step.
 */
export function sequenceFrameIndex(ref: ImageSequenceRef, elapsedSec: number): number {
	const t = Math.max(0, elapsedSec + (ref.offsetSec ?? 0));
	return Math.min(ref.frameCount - 1, Math.floor(t * ref.fps + 1e-6));
}
