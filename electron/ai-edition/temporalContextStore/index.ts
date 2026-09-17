/**
 * Temporal Context Store V1 — public API.
 */

export {
	buildTemporalContextRecords,
	countByKind,
	type TemporalContextBuildInput,
} from "./build";
export { recordIdFor, roundTime, stableHash } from "./identity";
export {
	INVALIDATION_MATRIX,
	type InvalidationRule,
	isSourceOwnedKind,
	type MutationFamily,
	validityAfterProgrammeChange,
} from "./invalidate";
export {
	orchestrateFromTemporalContext,
	signalBundleFromTemporalStore,
} from "./orchestrationAdapter";
export {
	programmeFingerprintFromDocument,
	projectSourceRangeToProgramme,
	remapRecordProgrammeRanges,
} from "./projection";
export {
	assertPacketSafeForExport,
	deserializeTemporalReasoningPacket,
	serializeTemporalReasoningPacket,
} from "./serialize";
export { createTemporalContextStore, TemporalContextStore } from "./store";
export type {
	ConfidenceClass,
	EditorialContextSessionV1,
	EpistemicType,
	EvidenceCoverageV1,
	PacketBudget,
	PacketDetailLevel,
	PrivacyClass,
	RecordValidity,
	TemporalContextQuery,
	TemporalContextRecordV1,
	TemporalProvenance,
	TemporalReasoningPacketV1,
	TemporalRecordKind,
	TimeRangeSec,
} from "./types";
export {
	DEFAULT_PACKET_BUDGETS,
	TEMPORAL_CONTEXT_SCHEMA_VERSION,
	TEMPORAL_CONTEXT_STORE_V1_PROVIDER_ID,
	TEMPORAL_REASONING_PACKET_VERSION,
} from "./types";
