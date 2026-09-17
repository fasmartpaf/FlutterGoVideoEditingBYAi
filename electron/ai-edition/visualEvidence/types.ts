/** Timestamped visual evidence for one cloud-agent turn (Phase 1 + change detection). */

export const MAX_VISUAL_FRAMES = 20;
/** Periodic step for recordings ≤ this duration (seconds). */
export const SHORT_DURATION_SEC = 30;
export const PERIODIC_INTERVAL_SEC = 2;
/** Merge candidates closer than this (seconds), preferring higher-priority reasons. */
export const DEDUPE_WINDOW_SEC = 0.2;
export const INTERACTION_PRE_SEC = 0.3;
export const INTERACTION_POST_SEC = 0.5;
/** Longest JPEG dimension after scale (preserve aspect). */
export const VISUAL_FRAME_MAX_DIM = 1280;
export const VISUAL_JPEG_QUALITY = 3; // ffmpeg -q:v 2–5; 3 ≈ high quality

/**
 * Gray thumbnail used for deterministic pixel-change scoring (not shown to the model).
 * Tuned for speed: 64×36 ≈ 2.3 KB raw; block grid 8×6.
 */
export const CHANGE_COMPARE_WIDTH = 64;
export const CHANGE_COMPARE_HEIGHT = 36;
export const CHANGE_BLOCK_W = 8;
export const CHANGE_BLOCK_H = 6;

/**
 * Classification thresholds on block-max mean absolute difference / 255.
 * Empirically set from screen-recording probes (mostly-static IDE + Meet overlay).
 * Not universal — local UI motion scores higher than global MAD on static desktops.
 *
 * Probe (recording-1788930909064.mp4, 0/2/4/6/8/10s):
 *   0→2 blockMax≈0.103, 2→4≈0.084, 4→6≈0.031, 6→8≈0.024, 8→10≈0.103
 */
export const CHANGE_MINIMAL_MAX = 0.04;
export const CHANGE_MODERATE_MAX = 0.09;
/** Only refine significant pairs whose source gap is at least this (seconds). */
export const REFINE_MIN_GAP_SEC = 1.5;
/** Max recursive midpoint insertion depth per transition lineage. */
export const MAX_REFINEMENT_LEVELS = 2;
/** Hard cap on midpoints added in one prepare turn. */
export const MAX_REFINEMENT_FRAMES = 6;

export type VisualEvidenceReason =
	| "periodic"
	| "cursor_interaction"
	| "cursor_interaction_pre"
	| "cursor_interaction_post"
	| "clip_boundary"
	| "change_refinement";

export type VisualChangeClassification = "minimal" | "moderate" | "significant";

export interface VisualChange {
	fromSourceTimeSec: number;
	toSourceTimeSec: number;
	fromVirtualTimeSec?: number | null;
	toVirtualTimeSec?: number | null;
	score: number;
	classification: VisualChangeClassification;
	/** When true, this pair is part of a cursor interaction pre/at/post sequence. */
	interactionSequence?: boolean;
}

export interface VisualEvidenceCandidate {
	assetId: string;
	sourceTimeSec: number;
	/** Edited-timeline seconds when a clip covers this source time; null if trimmed/out. */
	virtualTimeSec: number | null;
	reason: VisualEvidenceReason;
	/** Higher = keep preferentially when budgeting / deduping. */
	priority: number;
}

export interface VisualEvidenceFrame {
	assetId: string;
	sourceTimeSec: number;
	virtualTimeSec: number | null;
	reason: VisualEvidenceReason;
	/** Absolute path to cached JPEG (never stored in .openscreen). */
	imagePath: string;
	mimeType: "image/jpeg";
	width: number;
	height: number;
	/** Bytes on disk (for timings). */
	byteLength: number;
}

export interface VisualEvidenceTimings {
	candidateSelectionMs: number;
	cacheHits: number;
	cacheMisses: number;
	extractMs: number;
	frameCount: number;
	totalBytes: number;
	attachMs: number;
	changeDetectionMs?: number;
	refinementExtractMs?: number;
	initialFrameCount?: number;
	refinementFrameCount?: number;
	/** Time to build semantic grounding prompt scaffold (same turn; not a 2nd model call). */
	semanticGroundingPreparationMs?: number;
	/** Approximate character count of semantic scaffold text added to the user message. */
	semanticGroundingPromptChars?: number;
}

export interface PreparedVisualEvidence {
	frames: VisualEvidenceFrame[];
	timings: VisualEvidenceTimings;
	/** True only when frames were successfully prepared for attachment this turn. */
	attached: boolean;
	/** Adjacent chronological change scores for the frames that were attached. */
	changes?: VisualChange[];
	/** Canonical probed duration used while sampling. */
	sourceDurationSec?: number;
}

export const REASON_PRIORITY: Record<VisualEvidenceReason, number> = {
	cursor_interaction: 100,
	cursor_interaction_pre: 90,
	cursor_interaction_post: 90,
	clip_boundary: 50,
	change_refinement: 40,
	periodic: 10,
};
