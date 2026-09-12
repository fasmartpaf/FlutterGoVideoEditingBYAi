/**
 * Canonical SOURCE_MEDIA_TIME for immutable evidence (visual / speech / cursor).
 * Virtual timeline time is intentionally separate and must not be mixed in.
 */

export type TimeValueKind =
	| "SOURCE_MEDIA_TIME"
	| "VIRTUAL_TIMELINE_TIME"
	| "STREAM_TIME"
	| "DERIVED/STALE_METADATA";

/**
 * Allowed |video − audio| / |stream − container| skew from mux/encoder padding.
 * Larger gaps are material discrepancies and must be reported, not hidden.
 */
export const STREAM_DURATION_TOLERANCE_SEC = 0.35;

/**
 * Allowed speech/visual timestamp overshoot past canonical source duration
 * (Whisper rounding, last-frame sampling).
 */
export const SOURCE_TIMESTAMP_TOLERANCE_SEC = 0.35;

/** Asset.durationSec treated as stale when it disagrees with a live probe by more than this. */
export const STALE_DURATION_TOLERANCE_SEC = 0.5;

export interface ProbedSourceDurations {
	/** Container/format duration — preferred SOURCE_MEDIA_TIME. */
	containerDurationSec: number | null;
	/** Video stream duration — STREAM_TIME. */
	videoStreamDurationSec: number | null;
	/** Audio stream duration — STREAM_TIME. */
	audioStreamDurationSec: number | null;
	/** Non-null when streams disagree beyond STREAM_DURATION_TOLERANCE_SEC. */
	streamDiscrepancySec: number | null;
	streamDiscrepancyNote?: string;
}

export interface CanonicalSourceDuration {
	/** Single source-media timebase for evidence timestamps. */
	durationSec: number;
	kind: "SOURCE_MEDIA_TIME";
	probe: ProbedSourceDurations;
	assetMetadataSec: number | null;
	assetMetadataKind: "SOURCE_MEDIA_TIME" | "DERIVED/STALE_METADATA";
	/** True when asset.durationSec was corrected from a live probe. */
	repaired: boolean;
	previousAssetDurationSec?: number;
}
