/**
 * Resolve final SpeechEvidence status from segments + provisional status.
 * Validated usable segments must not remain as contradictory `failed`.
 */

import type { SpeechFailureReason } from "./failureReason";
import type { SpeechEvidence, SpeechEvidenceStatus, SpeechSegment } from "./types";

const EPS = 1e-3;

export function isUsableSpeechSegment(
	seg: SpeechSegment,
	canonicalDurationSec?: number | null,
): boolean {
	const text = typeof seg.text === "string" ? seg.text.trim() : "";
	if (!text) return false;
	const start = seg.startSourceTimeSec;
	const end = seg.endSourceTimeSec;
	if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
	if (end < start - EPS) return false;
	if (start < -0.25) return false;
	if (canonicalDurationSec != null && Number.isFinite(canonicalDurationSec)) {
		// Established Whisper overshoot tolerance (~250ms) — keep aligned with sourceTiming.
		if (start > canonicalDurationSec + 0.25) return false;
		if (end > canonicalDurationSec + 0.35 && end - canonicalDurationSec > 0.5) return false;
	}
	return true;
}

export function filterUsableSpeechSegments(
	segments: SpeechSegment[],
	canonicalDurationSec?: number | null,
): SpeechSegment[] {
	return segments.filter((s) => isUsableSpeechSegment(s, canonicalDurationSec));
}

/**
 * After STT / cache / document load: pick coherent status.
 * Does NOT invent segments.
 */
export function resolveSpeechEvidenceStatus(input: {
	provisionalStatus: SpeechEvidenceStatus;
	segments: SpeechSegment[];
	canonicalDurationSec?: number | null;
	audioStreamPresent: boolean | null;
}): {
	status: SpeechEvidenceStatus;
	segments: SpeechSegment[];
	failureReason?: SpeechFailureReason;
	reason?: string;
} {
	const { provisionalStatus, audioStreamPresent } = input;
	if (provisionalStatus === "no_audio") {
		return { status: "no_audio", segments: [] };
	}
	if (provisionalStatus === "unavailable") {
		return { status: "unavailable", segments: input.segments };
	}

	const usable = filterUsableSpeechSegments(input.segments, input.canonicalDurationSec);
	if (usable.length > 0) {
		return { status: "available", segments: usable };
	}

	// Had candidate segments that were all invalid — not "no speech".
	if (input.segments.length > 0 && provisionalStatus !== "no_speech_detected") {
		return {
			status: "failed",
			segments: [],
			failureReason: "timestamp_invalid",
			reason: "transcription produced unusable timing data",
		};
	}

	if (provisionalStatus === "failed") {
		return {
			status: "failed",
			segments: [],
		};
	}
	if (provisionalStatus === "available" || provisionalStatus === "no_speech_detected") {
		if (audioStreamPresent === false) {
			return { status: "no_audio", segments: [] };
		}
		return { status: "no_speech_detected", segments: [] };
	}

	return { status: provisionalStatus, segments: usable };
}

export function applySpeechStatusResolution(evidence: SpeechEvidence): SpeechEvidence {
	const resolved = resolveSpeechEvidenceStatus({
		provisionalStatus: evidence.status,
		segments: evidence.segments,
		canonicalDurationSec: evidence.sourceDurationSec,
		audioStreamPresent: evidence.audioStreamPresent,
	});
	return {
		...evidence,
		status: resolved.status,
		segments: resolved.segments,
		...(resolved.failureReason ? { failureReason: resolved.failureReason } : {}),
		...(resolved.reason
			? { reason: resolved.reason }
			: evidence.reason
				? { reason: evidence.reason }
				: {}),
	};
}
