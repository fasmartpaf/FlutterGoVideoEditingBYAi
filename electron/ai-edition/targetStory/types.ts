/**
 * Turn-local Target Story — desired viewer experience for an editing request.
 * Internal AI context only. Not edit planning. Not tool operations.
 */

import type { SourceStory } from "../sourceStory/types";

export const TARGET_STORY_OBJECTIVES = [
	"polish",
	"shorten",
	"clarify",
	"focus",
	"restructure",
	"repurpose",
	"custom",
] as const;
export type TargetStoryObjectiveKind = (typeof TARGET_STORY_OBJECTIVES)[number];

export const TARGET_STORY_PACINGS = ["slower", "balanced", "faster"] as const;
export type TargetStoryPacing = (typeof TARGET_STORY_PACINGS)[number];

export const TARGET_STORY_DENSITIES = ["minimal", "balanced", "rich"] as const;
export type TargetStoryDensity = (typeof TARGET_STORY_DENSITIES)[number];

export const TARGET_BEAT_PURPOSES = [
	"hook",
	"intro",
	"setup",
	"explanation",
	"demonstration",
	"transition",
	"result",
	"outro",
	"other",
] as const;
export type TargetBeatPurpose = (typeof TARGET_BEAT_PURPOSES)[number];

export const TARGET_BEAT_IMPORTANCES = ["essential", "supporting", "optional"] as const;
export type TargetBeatImportance = (typeof TARGET_BEAT_IMPORTANCES)[number];

export const TARGET_BEAT_PACINGS = ["compress", "preserve", "expand_attention"] as const;
export type TargetBeatPacing = (typeof TARGET_BEAT_PACINGS)[number];

export const TARGET_CHANGE_NEEDED = ["false", "true"] as const;

export interface EditingIntent {
	objective: TargetStoryObjectiveKind;
	constraints: string[];
	desiredQualities: string[];
	preserveMeaning: boolean;
}

export interface TargetStoryStyle {
	pacing?: TargetStoryPacing;
	density?: TargetStoryDensity;
	tone?: string;
}

export interface TargetStoryConstraint {
	id: string;
	description: string;
}

export interface TargetStoryChange {
	id: string;
	description: string;
	/** Editorial intention only — never a tool command. */
	rationale?: string;
}

export interface TargetStoryUncertainty {
	note: string;
	relatedSourceBeatIds?: string[];
}

export interface TargetStoryBeat {
	id: string;
	sourceBeatIds: string[];
	purpose: TargetBeatPurpose;
	desiredOutcome: string;
	importance: TargetBeatImportance;
	pacing: TargetBeatPacing;
	/** First-class NO-CHANGE: already satisfies the target. */
	changeNeeded: boolean;
	rationale: string;
	/** Required when this beat reorders relative to source chronology. */
	reorderJustification?: string;
}

export interface TargetStory {
	objective: string;
	audienceExperience: string;
	style: TargetStoryStyle;
	editingIntent: EditingIntent;
	targetBeats: TargetStoryBeat[];
	preserve: TargetStoryConstraint[];
	change: TargetStoryChange[];
	uncertainties?: TargetStoryUncertainty[];
}

export interface PreparedTargetStory {
	promptSection: string;
	requested: boolean;
	/** Instruction blob size for perf reporting. */
	instructionChars: number;
	/** V1 deterministic target story when Source Story V2 was available. */
	targetV1?: import("./v1").TargetStoryV1;
	providerId?: string;
}

/** Context required to validate a Target Story against Source Story. */
export interface TargetStoryValidationContext {
	sourceStory: SourceStory;
	userMessage: string;
}
