/**
 * Turn-local Source Story — chronological meaning of the SOURCE recording.
 * Internal AI context only. Not Target Story. Not edit planning.
 */

export const SOURCE_STORY_CONTENT_TYPES = [
	"tutorial",
	"demo",
	"presentation",
	"screen_recording",
	"talking_head",
	"mixed",
	"unknown",
] as const;
export type SourceStoryContentType = (typeof SOURCE_STORY_CONTENT_TYPES)[number];

export const SOURCE_STORY_PURPOSES = [
	"intro",
	"setup",
	"explanation",
	"demonstration",
	"navigation",
	"transition",
	"result",
	"pause",
	"repetition",
	"correction",
	"outro",
	"unknown",
] as const;
export type SourceStoryPurpose = (typeof SOURCE_STORY_PURPOSES)[number];

export const SOURCE_STORY_CONFIDENCES = ["high", "medium", "low"] as const;
export type SourceStoryConfidence = (typeof SOURCE_STORY_CONFIDENCES)[number];

export interface SourceStoryBeatEvidence {
	speechSegmentIds?: string[];
	visualTimes?: number[];
	cursorEventTimes?: number[];
}

export interface SourceStoryBeat {
	id: string;
	startSourceTimeSec: number;
	endSourceTimeSec: number;
	purpose: SourceStoryPurpose;
	summary: string;
	spokenMeaning?: string;
	visualMeaning?: string;
	interactionMeaning?: string;
	evidence: SourceStoryBeatEvidence;
	confidence: SourceStoryConfidence;
}

export interface SourceStoryUncertainty {
	startSourceTimeSec?: number;
	endSourceTimeSec?: number;
	note: string;
}

export interface SourceStory {
	sourceDurationSec: number;
	overallSummary: string;
	contentType: SourceStoryContentType;
	primaryGoal?: string;
	storyBeats: SourceStoryBeat[];
	unresolvedEvidence?: SourceStoryUncertainty[];
}

/** Deterministic chronological evidence windows — not the story beats themselves. */
export interface SourceStoryScaffoldSpeech {
	id: string;
	startSourceTimeSec: number;
	endSourceTimeSec: number;
	text: string;
}

export interface SourceStoryScaffoldWindow {
	startSourceTimeSec: number;
	endSourceTimeSec: number;
	/** True when this window is primarily a speech gap. */
	speechGap?: boolean;
	speech: SourceStoryScaffoldSpeech[];
	visualTimes: number[];
	visualChanges: Array<{
		fromSourceTimeSec: number;
		toSourceTimeSec: number;
		classification: "minimal" | "moderate" | "significant";
	}>;
	cursorEventTimes: number[];
}

export interface SourceStoryScaffold {
	sourceDurationSec: number;
	speechStatus:
		| "available"
		| "no_speech_detected"
		| "unavailable"
		| "failed"
		| "no_audio"
		| "not_requested"
		| "none";
	speechSegments: SourceStoryScaffoldSpeech[];
	visualTimes: number[];
	cursorEventTimes: number[];
	windows: SourceStoryScaffoldWindow[];
	timings: {
		storyScaffoldPreparationMs: number;
		inputEvidenceChars: number;
		promptChars: number;
	};
}

export interface PreparedSourceStory {
	scaffold: SourceStoryScaffold;
	promptSection: string;
	/** True when this turn should ask the model for SOURCE_STORY JSON. */
	requested: boolean;
	/** V2 evidence-grounded story (deterministic). Absent when V2 not built. */
	storyV2?: import("./v2").SourceStoryV2;
	evidenceInput?: import("./v2").SourceStoryEvidenceInput;
	/** Provider for this prepare path. */
	providerId?: string;
}
