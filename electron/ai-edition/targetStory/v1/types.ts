/**
 * Target Story V1 — desired viewer experience from Source Story V2 + user intent.
 * Does NOT execute edits. Does NOT select tools. Does NOT invent source facts.
 */

import type { SourceStoryV2 } from "../../sourceStory/v2/types";
import type { EditingIntent, TargetStoryObjectiveKind } from "../types";

export const TARGET_STORY_V1_PROVIDER_ID = "CURRENT_OPENSCREEN_TARGET_STORY_V1";

export type TargetDisposition = "preserve" | "de_emphasize" | "remove_candidate";

export type TargetUncertaintyKind =
	| "contradiction"
	| "unresolved_action"
	| "requested_but_not_source_supported"
	| "sparse_evidence"
	| "other";

export interface TargetStoryInput {
	sourceStoryV2: SourceStoryV2;
	userIntent: string;
	requestedTone?: string;
	requestedPlatform?: string;
	requestedLength?: string;
	requestedAudience?: string;
	explicitConstraints?: string[];
	/** Deterministic intent hints (optional; inferred if absent). */
	editingIntent?: EditingIntent;
}

export interface TargetStoryV1Beat {
	id: string;
	sourceBeatIds: string[];
	purpose:
		| "hook"
		| "intro"
		| "setup"
		| "explanation"
		| "demonstration"
		| "transition"
		| "result"
		| "outro"
		| "other";
	/** What the viewer should understand after this phase. */
	viewerShouldUnderstand: string;
	emphasize: string[];
	deEmphasize: string[];
	pacingIntent: "compress" | "preserve" | "expand_attention";
	clarityIntent: string;
	disposition: TargetDisposition;
	confidence: "high" | "medium" | "low";
	provenance: {
		sourceBeatIds: string[];
		sourceFactIds?: string[];
		sourceContextIds?: string[];
		correctionIds?: string[];
		contradictionIds?: string[];
	};
}

export interface TargetStoryV1Item {
	id: string;
	disposition: TargetDisposition;
	text: string;
	sourceBeatIds: string[];
	reason: string;
}

export interface TargetStoryV1UnsupportedRequest {
	id: string;
	requestText: string;
	status: "requested_but_not_source_supported";
	note: string;
}

export interface TargetStoryV1 {
	version: 1;
	providerId: typeof TARGET_STORY_V1_PROVIDER_ID;
	assetId: string;
	viewerGoal: string;
	communicationGoal: string;
	desiredArc: string;
	objectiveKind: TargetStoryObjectiveKind;
	editingIntent: EditingIntent;
	pacingIntent: "slower" | "balanced" | "faster";
	emphasisIntent: string;
	clarityIntent: string;
	continuityIntent: string;
	uncertaintyPolicy: string;
	targetBeats: TargetStoryV1Beat[];
	preserve: TargetStoryV1Item[];
	deEmphasize: TargetStoryV1Item[];
	removeCandidates: TargetStoryV1Item[];
	unsupportedRequests: TargetStoryV1UnsupportedRequest[];
	unresolved: Array<{
		id: string;
		kind: TargetUncertaintyKind;
		text: string;
		sourceBeatIds?: string[];
	}>;
	provenance: {
		sourceBeatIds: string[];
		sourceCorrectionIds: string[];
		sourceContradictionIds: string[];
	};
	metrics: {
		sourceBeatsConsumed: number;
		targetBeatsCreated: number;
		preserveCount: number;
		deEmphasizeCount: number;
		removeCandidateCount: number;
		unsupportedRequestCount: number;
		buildMs: number;
		promptChars?: number;
		additionalModelCalls: 0;
		providerId: typeof TARGET_STORY_V1_PROVIDER_ID;
	};
}

export interface TargetStoryQualityRubric {
	factualGrounding: boolean;
	faithfulToUserIntent: boolean;
	communicationClarity: boolean;
	pacingCoherence: boolean;
	sourcePreservation: boolean;
	contradictionHandling: boolean;
	uncertaintyHandling: boolean;
	noInventedSourceEvents: boolean;
	noToolLeakage: boolean;
	notes: string[];
}
