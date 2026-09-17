/**
 * Invalidation matrix — what stays vs what becomes programme-stale.
 */

import type { RecordValidity, TemporalRecordKind } from "./types";

export type MutationFamily =
	| "TRIM"
	| "SPEED"
	| "ZOOM"
	| "CROP"
	| "CAPTION_ENABLE"
	| "LOUDNESS_GAIN"
	| "ANNOTATION"
	| "UNDO_RESTORE"
	| "ROLLBACK";

export interface InvalidationRule {
	mutation: MutationFamily;
	sourceEvidence: "KEEP";
	programmeProjection: "INVALIDATE" | "KEEP" | "REEVALUATE";
	editorialRecommendations: "INVALIDATE" | "KEEP" | "OBSOLETE_IF_RELATED";
	notes: string;
}

export const INVALIDATION_MATRIX: InvalidationRule[] = [
	{
		mutation: "TRIM",
		sourceEvidence: "KEEP",
		programmeProjection: "INVALIDATE",
		editorialRecommendations: "INVALIDATE",
		notes: "Source speech/visual/dead-air keep; remap programme; stale recs",
	},
	{
		mutation: "SPEED",
		sourceEvidence: "KEEP",
		programmeProjection: "INVALIDATE",
		editorialRecommendations: "INVALIDATE",
		notes: "Same pattern as trim for programme clock",
	},
	{
		mutation: "ZOOM",
		sourceEvidence: "KEEP",
		programmeProjection: "KEEP",
		editorialRecommendations: "OBSOLETE_IF_RELATED",
		notes: "Timing mostly keep; framing/zoom recs may stale",
	},
	{
		mutation: "CROP",
		sourceEvidence: "KEEP",
		programmeProjection: "KEEP",
		editorialRecommendations: "OBSOLETE_IF_RELATED",
		notes: "Focal/protected geometry may need re-eval",
	},
	{
		mutation: "CAPTION_ENABLE",
		sourceEvidence: "KEEP",
		programmeProjection: "KEEP",
		editorialRecommendations: "OBSOLETE_IF_RELATED",
		notes: "Caption recommendation obsolete when already enabled",
	},
	{
		mutation: "LOUDNESS_GAIN",
		sourceEvidence: "KEEP",
		programmeProjection: "KEEP",
		editorialRecommendations: "OBSOLETE_IF_RELATED",
		notes: "Loudness candidate/rec invalidate or refresh",
	},
	{
		mutation: "ANNOTATION",
		sourceEvidence: "KEEP",
		programmeProjection: "KEEP",
		editorialRecommendations: "OBSOLETE_IF_RELATED",
		notes: "User-authored overlay changes preservation context",
	},
	{
		mutation: "UNDO_RESTORE",
		sourceEvidence: "KEEP",
		programmeProjection: "INVALIDATE",
		editorialRecommendations: "INVALIDATE",
		notes: "Restore prior programme fingerprint then remap",
	},
	{
		mutation: "ROLLBACK",
		sourceEvidence: "KEEP",
		programmeProjection: "INVALIDATE",
		editorialRecommendations: "INVALIDATE",
		notes: "Return to pre-op programme fingerprint; no phantom stale",
	},
];

const SOURCE_KINDS = new Set<TemporalRecordKind>([
	"SPEECH_SEGMENT",
	"SPEECH_WORD",
	"SPEECH_GAP",
	"VISUAL_CHANGE",
	"VISUAL_ACTIVITY",
	"VISUAL_STABLE_RANGE",
	"SCENE_CHANGE",
	"BLACK_RANGE",
	"FREEZE_RANGE",
	"CURSOR_INTERACTION",
	"FOCAL_TARGET",
	"EDITORIAL_FOCAL_EVIDENCE",
	"EDITORIAL_FOCAL_TARGET",
	"PROTECTED_RANGE",
	"DEAD_AIR_CANDIDATE",
	"LOUDNESS_ANALYSIS",
	"LOUDNESS_CANDIDATE",
]);

const PROGRAMME_SENSITIVE = new Set<TemporalRecordKind>([
	"CAPTION_CUE",
	"CAPTION_LAYOUT",
	"EXISTING_TRIM",
	"EXISTING_ZOOM",
	"EXISTING_CROP",
	"EXISTING_SPEED",
	"EXISTING_CAPTION_STATE",
	"ANNOTATION",
	"EDITORIAL_FINDING",
	"EDITORIAL_RECOMMENDATION",
	"EDITORIAL_QUESTION",
]);

export function validityAfterProgrammeChange(kind: TemporalRecordKind): RecordValidity {
	if (SOURCE_KINDS.has(kind)) return "SOURCE_CURRENT_PROGRAMME_STALE";
	if (PROGRAMME_SENSITIVE.has(kind)) return "STALE";
	return "STALE";
}

export function isSourceOwnedKind(kind: TemporalRecordKind): boolean {
	return SOURCE_KINDS.has(kind);
}
