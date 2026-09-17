/**
 * Visual Activity Safety V1.1 — typed evidence for dead-air candidates.
 * SOURCE_MEDIA_TIME only. Deterministic / local — 0 LLM.
 */

export const LOCAL_DEAD_AIR_VISUAL_SAFETY_V1_1 =
	"CURRENT_OPENSCREEN_LOCAL_DEAD_AIR_VISUAL_SAFETY_V1_1" as const;

export const VISUAL_SAFETY_VERSION = "v1.1" as const;

export type VisualActivityKind =
	| "CURSOR_INTERACTION"
	| "SIGNIFICANT_VISUAL_CHANGE"
	| "MODERATE_VISUAL_CHANGE"
	| "SCENE_CHANGE"
	| "VISIBLE_TEXT_CHANGE"
	| "BLACK_FRAME"
	| "FREEZE"
	| "LEDGER_VISUAL_EVENT"
	| "MARKED_STORY_EVENT"
	| "UNKNOWN";

export type VisualActivityStrength = "blocking" | "uncertain" | "observational";

export type VisualActivityState =
	| "NO_MATERIAL_VISUAL_ACTIVITY"
	| "MATERIAL_VISUAL_ACTIVITY"
	| "UNCERTAIN_VISUAL_ACTIVITY";

export type VisualEvidenceSource =
	| "cursor_sidecar"
	| "prepared_visual_change"
	| "temporal_event_ledger"
	| "cached_ocr"
	| "ffmpeg_scdet"
	| "ffmpeg_scene_select"
	| "ffmpeg_blackdetect"
	| "ffmpeg_freezedetect"
	| "injected_test";

export interface VisualActivityEvidence {
	id: string;
	range: {
		timebase: "SOURCE_MEDIA_TIME";
		startSec: number;
		endSec: number;
	};
	source: VisualEvidenceSource;
	kind: VisualActivityKind;
	strength: VisualActivityStrength;
	evidenceRefs: Array<{ kind: string; id: string; note: string }>;
	note?: string;
}

export interface VisualActivityAssessment {
	version: typeof VISUAL_SAFETY_VERSION;
	providerId: typeof LOCAL_DEAD_AIR_VISUAL_SAFETY_V1_1;
	state: VisualActivityState;
	events: VisualActivityEvidence[];
	blockingReasons: string[];
	/** True when FFmpeg scdet/scene fallback was invoked. */
	usedFfmpegFallback: boolean;
	/** Black/freeze observations — never alone unlock safeToPropose. */
	blackFreezeObservations: VisualActivityEvidence[];
	latencyMs: number;
	diagnostics: {
		existingEvidenceMs: number;
		ffmpegFallbackMs: number;
		cursorHitCount: number;
		changeHitCount: number;
		ledgerHitCount: number;
		ocrHitCount: number;
		sceneHitCount: number;
	};
}
