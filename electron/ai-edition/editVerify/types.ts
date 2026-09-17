/**
 * Local Edit Verification Expansion V1 — generic contract.
 * Identity: CURRENT_OPENSCREEN_LOCAL_EDIT_VERIFY_EXPANSION_V1
 * No LLM. Observations + geometry + native compositor only.
 */

export const LOCAL_EDIT_VERIFY_EXPANSION_V1_PROVIDER_ID =
	"CURRENT_OPENSCREEN_LOCAL_EDIT_VERIFY_EXPANSION_V1" as const;

export const EDIT_VERIFY_VERSION = "v1" as const;

export type EditOperationType = "zoom" | "crop" | "speed";

/**
 * Deterministic verification levels (ascending).
 * "document contains zoom" ≠ "rendered zoom is correct".
 */
export type EditVerificationLevel =
	| "STRUCTURAL_VALID"
	| "PROGRAMME_MAPPING_VALID"
	| "RENDER_VALID"
	| "EFFECT_PRESENT"
	| "PRESERVATION_VALID"
	| "AUDIO_VALID"
	| "VERIFIED";

export type EditVerificationStatus = "verified" | "failed" | "unavailable" | "not_run";

export interface NormalizedRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface MustSurviveRequirement {
	id: string;
	kind: "source_range" | "normalized_region" | "programme_instant";
	/** SOURCE_MEDIA_TIME range when kind=source_range */
	startSourceSec?: number;
	endSourceSec?: number;
	/** Normalized source rect [0,1] when kind=normalized_region */
	region?: NormalizedRect;
	/** Programme time probe when kind=programme_instant */
	programmeTimeSec?: number;
	note?: string;
}

export interface EditVerificationRequest {
	operationId: string;
	operationType: EditOperationType;
	beforeDocumentFingerprint: string;
	afterDocumentFingerprint: string;
	affectedSourceRange: { startSec: number; endSec: number } | null;
	affectedProgrammeRange: { startSec: number; endSec: number } | null;
	expectedEffect: Record<string, unknown>;
	mustSurvive: MustSurviveRequirement[];
	verificationRequirements: EditVerificationLevel[];
}

export interface EditVerifyEvidence {
	kind: string;
	id: string;
	note: string;
	programmeTimeSec?: number;
	metrics?: Record<string, number | string | boolean | null>;
}

export interface StructuralVerifySlice {
	ok: boolean;
	mutationPresent: boolean;
	notes: string[];
}

export interface TemporalVerifySlice {
	ok: boolean;
	programmeMappingOk: boolean;
	expectedProgrammeDurationSec: number | null;
	measuredProgrammeDurationSec: number | null;
	notes: string[];
}

export interface VisualVerifySlice {
	ok: boolean;
	authoritative: boolean;
	effectPresent: boolean;
	geometryOk: boolean;
	framesValid: boolean;
	notes: string[];
}

export interface AudioVerifySlice {
	ok: boolean;
	ran: boolean;
	notes: string[];
}

export interface PreservationVerifySlice {
	ok: boolean;
	notes: string[];
	failedIds: string[];
}

export interface EditVerificationResult {
	version: typeof EDIT_VERIFY_VERSION;
	providerId: typeof LOCAL_EDIT_VERIFY_EXPANSION_V1_PROVIDER_ID;
	status: EditVerificationStatus;
	operationType: EditOperationType;
	operationId: string;
	levelsAchieved: EditVerificationLevel[];
	structural: StructuralVerifySlice;
	temporal: TemporalVerifySlice;
	visual: VisualVerifySlice;
	audio: AudioVerifySlice;
	preservation: PreservationVerifySlice;
	evidence: EditVerifyEvidence[];
	warnings: string[];
	blockingReasons: string[];
	latencyMs: {
		preflightMs: number;
		applyMs: number;
		sceneBuildMs: number;
		frameReadMs: number;
		geometryVerifyMs: number;
		audioVerifyMs: number;
		totalVerifyMs: number;
		totalMs: number;
	};
	claims: string[];
}

/** Claims we may emit — never subjective quality. */
export const ALLOWED_VERIFY_CLAIMS = [
	"zoom_rendered_as_specified",
	"crop_geometry_valid",
	"speed_timing_valid",
	"structural_valid",
	"programme_mapping_valid",
	"render_valid",
	"preservation_valid",
	"audio_valid",
] as const;
