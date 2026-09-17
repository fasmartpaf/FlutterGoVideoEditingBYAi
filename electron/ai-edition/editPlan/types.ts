/**
 * Edit Plan V1 — gap → editorial intentions / tool families.
 * Does NOT execute edits. Does NOT mutate AxcutDocument. Does NOT call tools.
 */

import type { EditGapV1 } from "../editGap/types";
import type { SourceStoryV2 } from "../sourceStory/v2/types";
import type { TargetStoryV1 } from "../targetStory/v1/types";

export const EDIT_PLAN_V1_PROVIDER_ID = "CURRENT_OPENSCREEN_EDIT_PLAN_V1";

export type EditStrategyFamily =
	| "trim"
	| "crop"
	| "zoom"
	| "speed"
	| "caption"
	| "annotation"
	| "graphic"
	| "audio"
	| "background"
	| "aspect_ratio"
	| "preserve"
	| "no_safe_edit"
	| "avoid_implication"
	| "needs_more_evidence";

export type EditPlanFeasibility =
	| "supported"
	| "partially_supported"
	| "unsupported"
	| "needs_more_evidence";

export type EditPlanPriority = "critical" | "high" | "medium" | "low";
export type EditPlanRisk = "low" | "medium" | "high";

/**
 * Capability registry from actual OpenScreen agent tools (agent-tools.ts).
 * Unsupported historical families remain false unless repo proves otherwise.
 */
export interface EditCapabilityRegistry {
	trim: boolean;
	zoom: boolean;
	crop: boolean;
	annotation: boolean;
	graphic: boolean;
	captions: boolean;
	speed: boolean;
	audioOverlay: boolean;
	background: boolean;
	aspectRatio: boolean;
	/** Clip-to-clip dissolve/wipe — not supported. */
	transitions: boolean;
	denoise: boolean;
	stabilize: boolean;
	upscale: boolean;
	tts: boolean;
}

export interface EditPlanInput {
	sourceStoryV2: SourceStoryV2;
	targetStoryV1: TargetStoryV1;
	editGapV1: EditGapV1;
	availableCapabilities?: EditCapabilityRegistry;
}

export interface CandidateStrategy {
	family: EditStrategyFamily;
	rationale: string;
	feasibility: EditPlanFeasibility;
	risk: EditPlanRisk;
	/** Why this ranks above/below peers (deterministic). */
	rankScore: number;
	evidenceRequirements?: string[];
	/** Capability name when feasibility is unsupported. */
	unsupportedCapability?: string;
}

export interface EditPlanItem {
	id: string;
	gapIds: string[];
	sourceBeatIds: string[];
	targetBeatIds: string[];
	editorialIntent: string;
	candidateStrategies: CandidateStrategy[];
	preferredStrategy?: EditStrategyFamily;
	priority: EditPlanPriority;
	feasibility: EditPlanFeasibility;
	constraints: string[];
	preservationRefs: string[];
	provenanceRefs: string[];
	confidence: number;
	dependsOn?: string[];
	conflictsWith?: string[];
	conflictNotes?: string[];
	/** Evidence context only — not a finalized edit landing. */
	evidenceRange?: { startSourceTimeSec: number; endSourceTimeSec: number };
}

export interface EditPlanConflict {
	id: string;
	itemIds: string[];
	kind: "preserve_vs_remove" | "emphasis_vs_crop" | "speech_vs_speed" | "other";
	note: string;
	resolution: string;
}

export interface EditPlanV1 {
	version: 1;
	providerId: typeof EDIT_PLAN_V1_PROVIDER_ID;
	assetId: string;
	summary: string;
	items: EditPlanItem[];
	conflicts: EditPlanConflict[];
	capabilities: EditCapabilityRegistry;
	hardConstraints: string[];
	metrics: {
		gapsConsumed: number;
		planItemsGenerated: number;
		candidateStrategiesGenerated: number;
		unsupportedStrategies: number;
		conflicts: number;
		needsMoreEvidenceItems: number;
		serializedBytesApprox: number;
		buildMs: number;
		additionalModelCalls: 0;
		providerId: typeof EDIT_PLAN_V1_PROVIDER_ID;
	};
}

export interface EditPlanQualityRubric {
	gapCoverage: boolean;
	sourceGrounding: boolean;
	targetFidelity: boolean;
	preservationSafety: boolean;
	epistemicHonesty: boolean;
	feasibilityAccuracy: boolean;
	unsupportedCapabilityHonesty: boolean;
	noExecutionLeakage: boolean;
	conflictHandling: boolean;
	evidenceAwareness: boolean;
	compactness: boolean;
	notes: string[];
}
