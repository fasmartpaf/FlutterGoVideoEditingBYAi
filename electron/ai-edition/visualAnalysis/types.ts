/**
 * Local Visual Analysis Suite V1 — canonical SOURCE_MEDIA_TIME observations.
 * No LLM. No editorial judgment. Observations only.
 */

export const LOCAL_VISUAL_ANALYSIS_V1_PROVIDER_ID =
	"CURRENT_OPENSCREEN_LOCAL_VISUAL_ANALYSIS_V1" as const;

export const VISUAL_ANALYSIS_DETECTOR_VERSION = "v1" as const;

export type VisualChangeLevel = "MINIMAL" | "MODERATE" | "SIGNIFICANT";

export interface VisualChangeEvent {
	timeSec: number;
	fromSec: number;
	toSec: number;
	magnitude: number;
	level: VisualChangeLevel;
	detector: "bug3_pixel_mad" | "prepared_reuse";
	evidenceRefs: Array<{ kind: string; id: string; note: string }>;
}

export interface SceneEvent {
	timeSec: number;
	score: number | null;
	detector: "ffmpeg_scene_select";
	sourceRange: { startSec: number; endSec: number };
	evidenceRefs: Array<{ kind: string; id: string; note: string }>;
}

export interface BlackInterval {
	startSec: number;
	endSec: number;
	durationSec: number;
	detector: "ffmpeg_blackdetect";
	/** Observation only — not removable. */
	observationOnly: true;
}

export interface FreezeInterval {
	startSec: number;
	endSec: number;
	durationSec: number;
	detector: "ffmpeg_freezedetect";
	observationOnly: true;
}

/**
 * Visual state changes little. Does NOT mean "nothing important is happening"
 * (speech may continue on a stable screen).
 */
export interface StableInterval {
	startSec: number;
	endSec: number;
	durationSec: number;
	meaning: "visual_state_changes_little";
}

/**
 * Material visible activity occurred. No semantic UI meaning inferred.
 */
export interface ActivityInterval {
	startSec: number;
	endSec: number;
	durationSec: number;
	reasons: Array<
		"significant_change" | "scene_transition" | "cursor_interaction" | "moderate_density"
	>;
}

export interface VisualAnalysisParameters {
	sceneThreshold: number;
	changeSampleIntervalSec: number;
	blackDetect: { d: number; pixTh: number };
	freezeDetect: { n: number; d: number };
	stableMinDurationSec: number;
	activityMergeGapSec: number;
	/** Reuse Bug-3 thresholds from visualEvidence/types. */
	changeMinimalMax: number;
	changeModerateMax: number;
}

export interface VisualAnalysisV1 {
	version: 1;
	providerId: typeof LOCAL_VISUAL_ANALYSIS_V1_PROVIDER_ID;
	assetId: string;
	mediaPath: string;
	durationSec: number | null;
	sourceFingerprint: {
		path: string;
		size: number;
		mtimeMs: number;
	} | null;
	timebase: "SOURCE_MEDIA_TIME";
	changeEvents: VisualChangeEvent[];
	sceneEvents: SceneEvent[];
	blackIntervals: BlackInterval[];
	freezeIntervals: FreezeInterval[];
	stableIntervals: StableInterval[];
	activityIntervals: ActivityInterval[];
	analysisCoverage: {
		startSec: number;
		endSec: number;
		fullSource: boolean;
	};
	detectorVersions: {
		suite: typeof VISUAL_ANALYSIS_DETECTOR_VERSION;
		bug3Thresholds: string;
		ffmpegVersion: string | null;
	};
	parameters: VisualAnalysisParameters;
	provenance: {
		reusedPreparedChanges: boolean;
		cursorSidecarUsed: boolean;
		mediaDecodePasses: number;
		notes: string[];
	};
	latencyMs: number;
	cacheHit: boolean;
	error?: string;
}

/** Compact projection for later editorial use — design only, not wired to AI. */
export interface VisualEditorialSignals {
	meaningfulChangeRanges: Array<{ startSec: number; endSec: number; level: VisualChangeLevel }>;
	stableRanges: Array<{ startSec: number; endSec: number }>;
	sceneBoundaryCandidates: Array<{ timeSec: number }>;
	blackRanges: Array<{ startSec: number; endSec: number }>;
	freezeRanges: Array<{ startSec: number; endSec: number }>;
}
