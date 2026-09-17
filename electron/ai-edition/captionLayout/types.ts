/**
 * Local Caption Layout + Safe Areas V1 — types.
 * Transcript text is SSOT; layout state is separate and never silently rewrites words.
 */

export const LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID =
	"CURRENT_OPENSCREEN_LOCAL_CAPTION_LAYOUT_V1" as const;

export const CAPTION_LAYOUT_VERSION = "v1" as const;
export const CAPTION_GROUPING_POLICY_VERSION = "v1" as const;

export type CaptionPlacementId = "BOTTOM_CENTER" | "TOP_CENTER" | "BOTTOM_LEFT" | "BOTTOM_RIGHT";

export type CaptionCollisionSeverity = "low" | "medium" | "high" | "blocking";

export interface CaptionWordSpan {
	id: string;
	text: string;
	sourceStartSec: number;
	sourceEndSec: number;
	/** user | asr | synth — preserved from transcript when known. */
	source?: "asr" | "user" | "synth";
}

export interface CaptionLineV1 {
	index: number;
	text: string;
	/** Estimated width as fraction of frame width (0..1). */
	estimatedWidthFrac: number;
}

export interface NormalizedRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface CaptionCueV1 {
	id: string;
	sourceStartSec: number;
	sourceEndSec: number;
	programmeStartSec: number;
	programmeEndSec: number;
	words: CaptionWordSpan[];
	text: string;
	lines: CaptionLineV1[];
	placement: CaptionPlacementId;
	boundingBox: NormalizedRect;
	styleRef: {
		fontSizePxAt1080: number;
		fontFamily: string;
		fontWeight: "normal" | "bold";
		anchorV: "top" | "bottom";
		anchorH: "left" | "center" | "right";
	};
	provenanceRefs: Array<{ kind: string; id: string; note?: string }>;
	readingSpeed: {
		charactersPerSecond: number;
		wordsPerSecond: number;
		withinPolicy: boolean;
		flags: string[];
	};
	omitted: boolean;
	omitReason?: string;
}

export interface CaptionCollision {
	cueId: string;
	objectId: string;
	overlapRatio: number;
	severity: CaptionCollisionSeverity;
	reason: string;
}

export interface CaptionSafeArea {
	aspectValue: number;
	/** Normalized 0..1 frame fraction. */
	margin: { top: number; bottom: number; left: number; right: number };
	column: NormalizedRect;
	titleSafe: NormalizedRect;
}

export interface CaptionLayoutResult {
	version: 1;
	layoutVersion: typeof CAPTION_LAYOUT_VERSION;
	providerId: typeof LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID;
	assetId: string;
	aspectValue: number;
	cues: CaptionCueV1[];
	safeArea: CaptionSafeArea;
	collisions: CaptionCollision[];
	overflow: Array<{ cueId: string; reason: string }>;
	warnings: string[];
	placementChanges: Array<{
		fromCueId: string;
		toCueId: string;
		from: CaptionPlacementId;
		to: CaptionPlacementId;
		reason: string;
	}>;
	status: "ok" | "NO_SAFE_LAYOUT" | "NO_SPEECH" | "NO_TRANSCRIPT";
	metrics: {
		cueCount: number;
		avgCueDurationSec: number;
		maxLines: number;
		readingSpeedViolations: number;
		overflowCount: number;
		collisionCount: number;
		placementChangeCount: number;
		groupingMs: number;
		lineLayoutMs: number;
		collisionMs: number;
		programmeMapMs: number;
		totalMs: number;
		additionalModelCalls: 0;
	};
	cacheHit: boolean;
}

export interface CaptionGroupingPolicy {
	version: typeof CAPTION_GROUPING_POLICY_VERSION;
	/** Pause ≥ this starts a new cue. */
	pauseBreakSec: number;
	minWordsPerCue: number;
	maxWordsPerCue: number;
	maxCueDurationSec: number;
	minCueDurationSec: number;
	/** Prefer split when chars/sec exceeds this. */
	maxCharactersPerSecond: number;
	maxWordsPerSecond: number;
	minCharactersPerSecond: number;
	preferredMaxLines: number;
	hardMaxLines: number;
	/** Approx average glyph width as fraction of em (Inter-ish). */
	avgGlyphWidthEm: number;
	preferredFontSizePxAt1080: number;
	minFontSizePxAt1080: number;
	maxFontSizePxAt1080: number;
	maxSafeWidthFrac: number;
	orphanWordAvoidance: boolean;
	punctuationBreakChars: string;
}

export interface CaptionProtectedRegion {
	id: string;
	kind: "webcam" | "annotation" | "ocr" | "focal" | "cursor" | "ui" | "custom";
	rect: NormalizedRect;
	/** When true, overlap is blocking (NO_SAFE_LAYOUT if unavoidable). */
	blocking: boolean;
}

export interface CaptionLayoutInput {
	assetId: string;
	aspectValue: number;
	words: CaptionWordSpan[];
	/** Programme mapping helper: source → programme spans (may be empty → identity). */
	mapSourceSpanToProgramme?: (
		startSec: number,
		endSec: number,
	) => Array<{ startSec: number; endSec: number }>;
	protectedRegions?: CaptionProtectedRegion[];
	policy?: Partial<CaptionGroupingPolicy>;
	/** Retain placement unless collision requires change. */
	preferPlacementContinuity?: boolean;
	/** Existing manual caption / annotation ids that must not be overwritten. */
	manualCaptionIds?: string[];
}
