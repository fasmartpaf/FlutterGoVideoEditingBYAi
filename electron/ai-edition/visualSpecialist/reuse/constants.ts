/**
 * Defaults aligned with watch-video v1.1.3 CLI flags, scoped for specialist use.
 * @see reuse/NOTICE.md
 */

/** Difference-hash edge size (upstream `dhash(..., size=8)` → 8×9 gray). */
export const DHASH_SIZE = 8;

/** Upstream `--dedupe-distance` default. */
export const DEFAULT_DEDUP_HAMMING = 6;

/** Upstream `--scene-threshold` default (ffmpeg scene score). */
export const DEFAULT_SCENE_THRESHOLD = 0.08;

/**
 * Upstream full-video periodic default is 4s. Specialist ranges are short —
 * use a denser period inside the inspected window.
 */
export const DEFAULT_SPECIALIST_PERIODIC_SEC = 1.0;

/** Upstream OCR prep: upscale when width &lt; 1000. */
export const OCR_PREP_MIN_WIDTH = 1000;

/** Preprocess recipe identity (cache key). */
export const OCR_PREPROCESS_VERSION = "reuse-v1-mean-threshold";

/** Provider id for A/B diagnostics — does not overwrite locked baselines. */
export const REUSE_VISUAL_PROVIDER_ID = "CURRENT_OPENSCREEN_REUSE_VISUAL_V1";
