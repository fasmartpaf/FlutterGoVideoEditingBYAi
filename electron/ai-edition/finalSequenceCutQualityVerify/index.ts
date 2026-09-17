/**
 * Final Sequence Cut Quality Verify V1 — public API.
 */

export { verifyJoinAudio } from "./audio";
export { readJoinVerifyCache, writeJoinVerifyCache } from "./cache";
export { verifyJoinCaption } from "./caption";
export {
	enumerateProgrammeJoins,
	mediaFingerprintLite,
} from "./enumerate";
export {
	buildJoinInvestigationArtifact,
	writeJoinInvestigationArtifact,
} from "./investigation";
export { applyMicroFade, runMicroFadeExperiment } from "./microFade";
export {
	type PreservationEvidence,
	verifyJoinPreservation,
} from "./preservationCheck";
export { assessPreviewVsExportParity } from "./previewVsExport";
export { verifyJoinSpeech } from "./speech";
export { verifyJoinSpeed } from "./speed";
export {
	joinToTemporalRecord,
	temporalRecordsFromSequenceResult,
} from "./temporalAdapter";
export type {
	CheckOutcome,
	FinalSequenceCutQualityResultV1,
	FinalSequenceJoinVerificationV1,
	JoinCause,
	JoinModalityResult,
	JoinOverallStatus,
	MicroFadeExperimentResult,
	ProgrammeJoinV1,
	SequenceOverallStatus,
} from "./types";
export {
	FINAL_SEQUENCE_CUT_QUALITY_VERIFY_V1_ID,
	FINAL_SEQUENCE_VERIFY_POLICY_VERSION,
} from "./types";
export {
	type VerifyFinalSequenceArgs,
	verifyFinalSequenceCutQuality,
	verifyProgrammeJoin,
} from "./verify";
export {
	type JoinFrameSample,
	suggestedVisualSampleTimes,
	verifyJoinVisual,
} from "./visual";
