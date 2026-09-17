/**
 * Edit Gap V1 — editorial delta between Source Story V2 and Target Story V1.
 * Does NOT select tools. Does NOT execute edits. Does NOT mutate AxcutDocument.
 */

import type { SourceStoryV2 } from "../sourceStory/v2/types";
import type { TargetStoryV1 } from "../targetStory/v1/types";

export const EDIT_GAP_V1_PROVIDER_ID = "CURRENT_OPENSCREEN_EDIT_GAP_V1";

export const EDIT_GAP_CATEGORIES = [
	"pacing_excess",
	"pacing_too_fast",
	"repetition",
	"hesitation_or_correction_friction",
	"unclear_focus",
	"distracting_temporary_ui",
	"passive_context_noise",
	"visual_story_mismatch",
	"speech_visual_mismatch",
	"unsupported_story_implication",
	"weak_transition",
	"clarity_gap",
	"continuity_gap",
	"missing_target_support",
	"preservation_requirement",
] as const;
export type EditGapCategory = (typeof EDIT_GAP_CATEGORIES)[number];

export type EditGapImportance = "critical" | "high" | "medium" | "low";
export type EditGapConfidence = "high" | "medium" | "low";

export interface EditGapInput {
	sourceStoryV2: SourceStoryV2;
	targetStoryV1: TargetStoryV1;
	/** Prefer Target Story's normalized intent; optional echo for metrics. */
	userIntent?: string;
}

export interface EditGapProvenance {
	sourceBeatIds: string[];
	targetBeatIds: string[];
	sourceFactIds?: string[];
	sourceContextIds?: string[];
	correctionIds?: string[];
	contradictionIds?: string[];
	/** Inclusive SOURCE_MEDIA_TIME window identifying where the gap exists — not an edit command. */
	sourceRange?: { startSourceTimeSec: number; endSourceTimeSec: number };
}

export interface EditGapItem {
	id: string;
	category: EditGapCategory;
	problemStatement: string;
	desiredChange: string;
	importance: EditGapImportance;
	confidence: EditGapConfidence;
	/** Epistemic note inherited from source (observed/spoken/unknown/contradicted/…). */
	sourceEpistemic: string;
	provenance: EditGapProvenance;
	constraints: string[];
	unresolvedReason?: string;
}

export interface EditGapPreserved {
	id: string;
	text: string;
	sourceBeatIds: string[];
	targetBeatIds: string[];
	reason: string;
}

export interface EditGapUnresolved {
	id: string;
	kind: "missing_target_support" | "epistemic_honesty" | "other";
	text: string;
	sourceBeatIds?: string[];
	targetBeatIds?: string[];
}

export interface EditGapV1 {
	version: 1;
	providerId: typeof EDIT_GAP_V1_PROVIDER_ID;
	assetId: string;
	summary: string;
	gaps: EditGapItem[];
	preserved: EditGapPreserved[];
	unresolved: EditGapUnresolved[];
	hardConstraints: string[];
	metrics: {
		sourceBeatsConsumed: number;
		targetBeatsConsumed: number;
		gapsCreated: number;
		preservationConstraints: number;
		missingSupportGaps: number;
		serializedBytesApprox: number;
		buildMs: number;
		additionalModelCalls: 0;
		providerId: typeof EDIT_GAP_V1_PROVIDER_ID;
	};
}

export interface EditGapQualityRubric {
	sourceGrounding: boolean;
	targetFidelity: boolean;
	epistemicHonesty: boolean;
	gapUsefulness: boolean;
	noToolLeakage: boolean;
	noEditPlanLeakage: boolean;
	preservationAwareness: boolean;
	contradictionAwareness: boolean;
	unsupportedTargetAwareness: boolean;
	compactness: boolean;
	notes: string[];
}
