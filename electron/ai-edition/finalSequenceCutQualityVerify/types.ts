/**
 * Final Sequence Cut Quality Verify V1 — contracts.
 * Technical join QC only. No aesthetic / LLM judgment.
 */

export const FINAL_SEQUENCE_CUT_QUALITY_VERIFY_V1_ID =
	"CURRENT_OPENSCREEN_FINAL_SEQUENCE_CUT_QUALITY_VERIFY_V1" as const;

export const FINAL_SEQUENCE_VERIFY_POLICY_VERSION = "v1.0" as const;

export type JoinCause =
	| "TRIM_CREATED"
	| "CLIP_TO_CLIP"
	| "SPEED_BOUNDARY"
	| "SOURCE_DISCONTINUITY"
	| "NATURAL_CONTINUITY";

export type CheckOutcome =
	| "PASS"
	| "WARNING"
	| "FAIL"
	| "NOT_APPLICABLE"
	| "INSUFFICIENT_EVIDENCE"
	| "UNKNOWN";

export type JoinSeverity = "none" | "info" | "warning" | "blocking";

export type SequenceOverallStatus =
	| "PASS"
	| "PASS_WITH_WARNINGS"
	| "FAIL"
	| "INSUFFICIENT_EVIDENCE";

export type JoinOverallStatus =
	| "CLEAN"
	| "CLEAN_WITH_WARNINGS"
	| "FAILED"
	| "INSUFFICIENT_EVIDENCE";

export interface TimeRangeSec {
	startSec: number;
	endSec: number;
}

export interface ProgrammeJoinV1 {
	joinId: string;
	programmeTimeSec: number;
	leftSourceRange: TimeRangeSec;
	rightSourceRange: TimeRangeSec;
	leftClipId: string;
	rightClipId: string;
	leftAssetId: string;
	rightAssetId: string;
	cause: JoinCause;
	/** True when editing created / revealed this abutment (not continuous source). */
	editCreated: boolean;
	mutationRefs: string[];
	speechContext?: {
		leftWordIds: string[];
		rightWordIds: string[];
		notes: string[];
	};
	captionContext?: {
		cueIdsCrossing: string[];
		notes: string[];
	};
	visualContext?: {
		notes: string[];
	};
}

export interface JoinModalityResult {
	outcome: CheckOutcome;
	blockingReasons: string[];
	warnings: string[];
	metrics?: Record<string, number | string | boolean | null>;
	evidenceRefs: string[];
	notes: string[];
	latencyMs: number;
}

export interface FinalSequenceJoinVerificationV1 {
	join: ProgrammeJoinV1;
	speech: JoinModalityResult;
	audio: JoinModalityResult;
	visual: JoinModalityResult;
	caption: JoinModalityResult;
	timing: JoinModalityResult;
	preservation: JoinModalityResult;
	severity: JoinSeverity;
	blockingReasons: string[];
	warnings: string[];
	evidenceRefs: string[];
	overall: JoinOverallStatus;
}

export interface FinalSequenceCutQualityResultV1 {
	version: 1;
	providerId: typeof FINAL_SEQUENCE_CUT_QUALITY_VERIFY_V1_ID;
	policyVersion: typeof FINAL_SEQUENCE_VERIFY_POLICY_VERSION;
	programmeFingerprint: string;
	mediaFingerprint: string;
	assetId: string;
	joinCount: number;
	editCreatedJoinCount: number;
	cleanCount: number;
	warningCount: number;
	failedCount: number;
	insufficientCount: number;
	joins: FinalSequenceJoinVerificationV1[];
	coverage: {
		speechChecked: number;
		audioChecked: number;
		visualChecked: number;
		captionChecked: number;
		preservationKnown: number;
	};
	performance: {
		enumerateMs: number;
		speechMs: number;
		audioMs: number;
		visualMs: number;
		captionMs: number;
		totalMs: number;
		cacheHit: boolean;
		avgPerJoinMs: number;
	};
	provenance: {
		additionalModelCalls: 0;
		paidAiCalls: 0;
		autoMutations: 0;
		builtAtIso: string;
	};
	overall: SequenceOverallStatus;
}

export interface MicroFadeExperimentRow {
	label: "current" | "fade_10ms" | "fade_20ms" | "fade_30ms" | "adaptive";
	fadeMs: number;
	boundarySampleJump: number;
	rmsRatio: number;
	blocking: string[];
	warnings: string[];
}

export interface MicroFadeExperimentResult {
	policyRecommendation:
		| "NO_CHANGE"
		| "FIXED_MICRO_FADE"
		| "ADAPTIVE_MICRO_FADE"
		| "MORE_EVIDENCE_REQUIRED";
	nativeAudioBoundaryFadeSamples: 240;
	nativeAudioBoundaryFadeMsApprox: 5;
	rows: MicroFadeExperimentRow[];
	notes: string[];
}
