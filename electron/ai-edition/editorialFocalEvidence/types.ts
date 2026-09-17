/**
 * Local Editorial Focal Evidence V1 — contracts.
 * Evidence and targets only. No model prose in core payloads.
 */

export const LOCAL_EDITORIAL_FOCAL_EVIDENCE_V1_ID =
	"CURRENT_OPENSCREEN_LOCAL_EDITORIAL_FOCAL_EVIDENCE_V1" as const;

export type EditorialFocalEvidenceKind =
	| "CURSOR_DWELL"
	| "CURSOR_CLICK"
	| "CURSOR_CLUSTER"
	| "CURSOR_APPROACH"
	| "VISUAL_CHANGE_REGION"
	| "VISIBLE_TEXT_REGION"
	| "STABLE_UI_REGION"
	| "INTERACTION_REGION"
	| "EXISTING_ZOOM_CONTEXT"
	| "PROTECTED_REGION"
	| "FRAME_GEOMETRY";

export type FocalEpistemicType = "OBSERVED" | "DERIVED" | "HEURISTIC";

export type FocalConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface NormalizedRegionV1 {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface NormalizedPointV1 {
	cx: number;
	cy: number;
}

export interface SourceRangeSec {
	startSec: number;
	endSec: number;
}

export interface EditorialFocalEvidenceV1 {
	id: string;
	kind: EditorialFocalEvidenceKind;
	sourceRange: SourceRangeSec;
	normalizedRegion?: NormalizedRegionV1;
	focalPoint?: NormalizedPointV1;
	confidence: FocalConfidence;
	provenance: {
		module: string;
		version?: string;
		observedOrDerived: FocalEpistemicType;
	};
	epistemic: FocalEpistemicType;
	payloadRef?: string;
	/** Structured metrics — never free-form model prose. */
	metrics?: Record<string, number | string | boolean>;
}

export type GroundedFocalTargetStatus =
	| "GROUNDED"
	| "WEAK"
	| "AMBIGUOUS"
	| "CONFLICTING"
	| "NO_TARGET";

export type FocalStability = "STABLE" | "TRANSIENT" | "UNKNOWN";

export interface GroundedEditorialFocalTargetV1 {
	targetId: string;
	sourceRange: SourceRangeSec;
	normalizedRegion: NormalizedRegionV1;
	focalPoint: NormalizedPointV1;
	confidence: FocalConfidence;
	evidenceIds: string[];
	evidenceFamilies: EditorialFocalEvidenceKind[];
	reasonCode: string;
	stability: FocalStability;
	sourceFingerprint: string;
	status: GroundedFocalTargetStatus;
	programmeRanges?: SourceRangeSec[];
	survivesCurrentPlayback?: boolean;
}

export type ZoomEditorialDecision = "ZOOM_ELIGIBLE" | "NO_ZOOM_RECOMMENDED";

export type ZoomSkipReasonCode =
	| "TARGET_TOO_LARGE"
	| "TARGET_TOO_SHORT"
	| "ALREADY_VISIBLE"
	| "EXISTING_ZOOM_SUFFICIENT"
	| "PRESERVATION_CONFLICT"
	| "AMBIGUOUS_TARGET"
	| "INSUFFICIENT_EVIDENCE"
	| "NO_ACTIONABLE_GEOMETRY"
	| "NO_GROUNDED_FOCAL_TARGET"
	| "STATUS_NOT_GROUNDED";

export interface ZoomDecisionV1 {
	decision: ZoomEditorialDecision;
	reasonCode: ZoomSkipReasonCode | "GROUNDED_EMPHASIS";
	targetId: string | null;
	geometry: ZoomGeometryProposalV1 | null;
	notes: string[];
}

export interface ZoomGeometryProposalV1 {
	focalPoint: NormalizedPointV1;
	depth: 1 | 2 | 3;
	scale: number;
	sourceStartSec: number;
	sourceEndSec: number;
	visibleWindow: NormalizedRegionV1;
}

export type CropEditorialDecision = "CROP_ELIGIBLE" | "NO_CROP_RECOMMENDED";

export type CropSkipReasonCode =
	| "NO_ASPECT_FRAMING_REASON"
	| "INSUFFICIENT_EVIDENCE"
	| "PRESERVATION_CONFLICT"
	| "AMBIGUOUS_TARGET"
	| "STATUS_NOT_GROUNDED";

export interface CropDecisionV1 {
	decision: CropEditorialDecision;
	reasonCode: CropSkipReasonCode | "FRAMING_REQUIRED";
	targetId: string | null;
	notes: string[];
}

export type RemapDisposition =
	| "STILL_VALID"
	| "STALE_BUT_REMAPPABLE"
	| "REINVESTIGATION_REQUIRED"
	| "STALE_AND_INVALID";

export interface CursorSampleV1 {
	atSec: number;
	cx: number;
	cy: number;
	interactionType?: "move" | "click" | "mouseup";
	visible?: boolean;
}

export interface VisualChangeIntervalV1 {
	startSec: number;
	endSec: number;
	kind: "significant" | "moderate" | "scene" | "stable" | "activity";
	/** When true, change spans essentially the full frame — not localizable. */
	fullFrame?: boolean;
}

export interface VisibleTextRegionV1 {
	id: string;
	sourceRange: SourceRangeSec;
	region: NormalizedRegionV1;
	payloadRef?: string;
}

export interface ProtectedRegionV1 {
	id: string;
	kind: string;
	sourceRange?: SourceRangeSec;
	region: NormalizedRegionV1;
}

export interface ExistingZoomContextV1 {
	id: string;
	startSec: number;
	endSec: number;
	focus: NormalizedPointV1;
	depth?: number;
}

export interface FrameGeometryV1 {
	widthPx: number;
	heightPx: number;
	aspect: number;
}

export interface TargetedInvestigationQuestionV1 {
	stableBefore: boolean | null;
	whatChanged: "none" | "local" | "full_frame" | "unknown";
	cursorActivity: boolean;
	interactionHappened: boolean;
	regionPersisted: boolean;
	conflictingFocal: boolean;
	survivesLongEnough: boolean;
}

export interface TargetedTemporalInvestigationResultV1 {
	window: SourceRangeSec;
	evidenceIds: string[];
	answers: TargetedInvestigationQuestionV1;
	additionalDecodePasses: 0;
	notes: string[];
}

export interface EditorialFocalAnalysisBundleV1 {
	providerId: typeof LOCAL_EDITORIAL_FOCAL_EVIDENCE_V1_ID;
	version: 1;
	sourceFingerprint: string;
	evidence: EditorialFocalEvidenceV1[];
	targets: GroundedEditorialFocalTargetV1[];
	investigations: TargetedTemporalInvestigationResultV1[];
	zoomDecision: ZoomDecisionV1;
	cropDecision: CropDecisionV1;
	coverage: {
		cursor: "AVAILABLE" | "PARTIAL" | "NOT_AVAILABLE";
		visual: "AVAILABLE" | "AVAILABLE_COARSE" | "NOT_AVAILABLE";
		ocr: "AVAILABLE" | "NOT_AVAILABLE";
		focal: "AVAILABLE" | "PARTIAL" | "NOT_AVAILABLE";
	};
	metrics: {
		buildMs: number;
		additionalDecodePasses: 0;
		paidAiCalls: 0;
	};
}
