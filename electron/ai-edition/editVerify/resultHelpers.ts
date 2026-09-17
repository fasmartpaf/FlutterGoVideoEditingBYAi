/**
 * Shared empty slices + level aggregation for EditVerificationResult.
 */

import type {
	AudioVerifySlice,
	EditOperationType,
	EditVerificationLevel,
	EditVerificationResult,
	EditVerificationStatus,
	PreservationVerifySlice,
	StructuralVerifySlice,
	TemporalVerifySlice,
	VisualVerifySlice,
} from "./types";
import { EDIT_VERIFY_VERSION, LOCAL_EDIT_VERIFY_EXPANSION_V1_PROVIDER_ID } from "./types";

export function emptyStructural(ok = false): StructuralVerifySlice {
	return { ok, mutationPresent: false, notes: [] };
}
export function emptyTemporal(ok = false): TemporalVerifySlice {
	return {
		ok,
		programmeMappingOk: false,
		expectedProgrammeDurationSec: null,
		measuredProgrammeDurationSec: null,
		notes: [],
	};
}
export function emptyVisual(ok = false): VisualVerifySlice {
	return {
		ok,
		authoritative: false,
		effectPresent: false,
		geometryOk: false,
		framesValid: false,
		notes: [],
	};
}
export function emptyAudio(ok = true): AudioVerifySlice {
	return { ok, ran: false, notes: ["audio_not_required"] };
}
export function emptyPreservation(ok = true): PreservationVerifySlice {
	return { ok, notes: [], failedIds: [] };
}

export function emptyLatency() {
	return {
		preflightMs: 0,
		applyMs: 0,
		sceneBuildMs: 0,
		frameReadMs: 0,
		geometryVerifyMs: 0,
		audioVerifyMs: 0,
		totalVerifyMs: 0,
		totalMs: 0,
	};
}

export function collectLevels(args: {
	structural: StructuralVerifySlice;
	temporal: TemporalVerifySlice;
	visual: VisualVerifySlice;
	audio: AudioVerifySlice;
	preservation: PreservationVerifySlice;
}): EditVerificationLevel[] {
	const levels: EditVerificationLevel[] = [];
	if (args.structural.ok) levels.push("STRUCTURAL_VALID");
	if (args.temporal.ok) levels.push("PROGRAMME_MAPPING_VALID");
	if (args.visual.framesValid) levels.push("RENDER_VALID");
	if (args.visual.effectPresent) levels.push("EFFECT_PRESENT");
	if (args.preservation.ok) levels.push("PRESERVATION_VALID");
	if (args.audio.ok && args.audio.ran) levels.push("AUDIO_VALID");
	const verified =
		args.structural.ok &&
		args.temporal.ok &&
		args.visual.ok &&
		args.preservation.ok &&
		args.audio.ok;
	if (verified) levels.push("VERIFIED");
	return levels;
}

export function finalizeStatus(
	levels: EditVerificationLevel[],
	blocking: string[],
): EditVerificationStatus {
	if (blocking.some((b) => b.includes("unavailable"))) return "unavailable";
	if (blocking.length > 0) return "failed";
	if (levels.includes("VERIFIED")) return "verified";
	return "failed";
}

export function baseResult(
	partial: Partial<EditVerificationResult> &
		Pick<EditVerificationResult, "operationType" | "operationId" | "status">,
): EditVerificationResult {
	return {
		version: EDIT_VERIFY_VERSION,
		providerId: LOCAL_EDIT_VERIFY_EXPANSION_V1_PROVIDER_ID,
		levelsAchieved: [],
		structural: emptyStructural(),
		temporal: emptyTemporal(),
		visual: emptyVisual(),
		audio: emptyAudio(),
		preservation: emptyPreservation(),
		evidence: [],
		warnings: [],
		blockingReasons: [],
		latencyMs: emptyLatency(),
		claims: [],
		...partial,
	};
}

export function operationTypeLabel(t: EditOperationType): string {
	return t;
}
