/**
 * Visual Evidence Specialist V1 — types.
 * Perception of acquired visual evidence. Observations ≠ actions.
 */

export type VisualObservationKind =
	| "visible_text"
	| "ui_state"
	| "visual_diff"
	| "temporary_ui_interval"
	| "readability_note";

export type VisualObservationEpistemic = "observed" | "inferred" | "unknown";

export interface NormalizedBox {
	/** Fraction of crop/frame width [0,1]. */
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface OcrLine {
	text: string;
	confidence: number;
	box?: NormalizedBox;
}

export interface OcrResult {
	engine: "macos_vision" | "unavailable" | "none";
	imagePath: string;
	width: number;
	height: number;
	lines: OcrLine[];
	ms: number;
	error?: string;
}

export interface SourceResCrop {
	id: string;
	sourceTimeSec: number;
	videoPath: string;
	/** Pixel crop in SOURCE frame coordinates. */
	crop: { x: number; y: number; w: number; h: number };
	sourceWidth: number;
	sourceHeight: number;
	imagePath: string;
	width: number;
	height: number;
	byteLength: number;
	/** true when cropped from source media (not upscaled 1280 JPEG). */
	fromSourceMedia: boolean;
	presetOrReason: string;
	ms: number;
}

export interface VisualObservation {
	id: string;
	kind: VisualObservationKind;
	epistemic: VisualObservationEpistemic;
	text: string;
	sourceTimeSec: number;
	endSourceTimeSec?: number;
	temporallyUncertain?: boolean;
	region?: {
		presetOrReason: string;
		crop?: { x: number; y: number; w: number; h: number };
		fromSourceMedia?: boolean;
		imagePath?: string;
		width?: number;
		height?: number;
	};
	ocr?: {
		engine: string;
		lines: OcrLine[];
		joinedText: string;
	};
	diff?: {
		fromSourceTimeSec: number;
		toSourceTimeSec: number;
		score: number;
		classification: string;
	};
	provenance: Array<{
		modality: "visual" | "ocr" | "model_semantic";
		sourceTimeSec?: number;
		note?: string;
		frameImagePath?: string;
	}>;
}

export interface VisualSpecialistBudgets {
	maxInspections: number;
	maxSourceResCrops: number;
	maxOcrCalls: number;
	maxBeforeAfterPairs: number;
	maxImageBytesTotal: number;
	/** Specialist itself uses 0 LLM calls in V1 (Vision OCR is native). */
	maxExtraModelCalls: 0;
}

export const DEFAULT_VISUAL_SPECIALIST_BUDGETS: VisualSpecialistBudgets = {
	maxInspections: 6,
	maxSourceResCrops: 5,
	maxOcrCalls: 4,
	maxBeforeAfterPairs: 2,
	maxImageBytesTotal: 8_000_000,
	maxExtraModelCalls: 0,
};

export interface VisualSpecialistMetrics {
	sourceCropMs: number;
	ocrMs: number;
	diffMs: number;
	totalMs: number;
	sourceCrops: number;
	ocrCalls: number;
	beforeAfterPairs: number;
	imageBytes: number;
	extraModelCalls: 0;
	engine: string;
}

export interface VisualSpecialistResult {
	version: 1;
	observations: VisualObservation[];
	crops: SourceResCrop[];
	ocrResults: OcrResult[];
	metrics: VisualSpecialistMetrics;
	/** Compact lines for investigator briefing (not user-facing). */
	internalNotes: string[];
}
