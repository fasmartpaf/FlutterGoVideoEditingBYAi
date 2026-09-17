/**
 * Deterministic review copy + proposal shape for loudness normalize.
 * No LLM. Does not execute.
 */

import type { AudioNormalizeCandidateV1 } from "./types";
import { LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID } from "./types";

export interface LoudnessReviewCopy {
	headline: string;
	detail: string;
	warnings: string[];
}

export function formatLoudnessReviewCopy(c: AudioNormalizeCandidateV1): LoudnessReviewCopy {
	const cur = c.analysis.integratedLufs?.toFixed(0) ?? "?";
	const target = c.targetPolicy.targetIntegratedLufs.toFixed(0);
	const direction =
		c.estimatedGainDb > 0 ? "increases" : c.estimatedGainDb < 0 ? "decreases" : "leaves";
	const headline = `Normalize the recording audio from about ${cur} LUFS toward ${target} LUFS.`;
	const detail = [
		`Measured integrated loudness ≈ ${c.analysis.integratedLufs?.toFixed(1) ?? "n/a"} LUFS`,
		`(true peak ≈ ${c.analysis.truePeakDbTp?.toFixed(1) ?? "n/a"} dBTP).`,
		`Proposed programme gain ${direction} by ${Math.abs(c.estimatedGainDb).toFixed(1)} dB`,
		`(audioGainDb ${c.currentAudioGainDb.toFixed(1)} → ${c.resultingAudioGainDb.toFixed(1)}).`,
		`Expected ≈ ${c.expectedIntegratedLufs?.toFixed(1) ?? "n/a"} LUFS`,
		`/ peak ≈ ${c.expectedTruePeakDbTp?.toFixed(1) ?? "n/a"} dBTP.`,
		"Source media is not rewritten; timeline document remains SSOT.",
	].join(" ");
	return {
		headline,
		detail,
		warnings: [...c.warnings, ...c.blockingReasons.map((r) => `Blocked: ${r}`)],
	};
}

export interface LoudnessNormalizeProposal {
	status: "proposal_only";
	notExecuted: true;
	providerId: typeof LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID;
	candidateId: string;
	intent: string;
	evidenceJustification: string;
	applyDomain: "PROGRAMME_AUDIO_GAIN_DB";
	verificationDomain: "PRIMARY_SOURCE_AUDIO_WITH_VOLUME";
	provisionalArgs: {
		audioGainDb: number;
		previousAudioGainDb: number;
		estimatedGainDeltaDb: number;
	};
	safeToPropose: boolean;
}

export function candidateToLoudnessProposal(
	c: AudioNormalizeCandidateV1,
): LoudnessNormalizeProposal | null {
	if (!c.safeToPropose) return null;
	const copy = formatLoudnessReviewCopy(c);
	return {
		status: "proposal_only",
		notExecuted: true,
		providerId: LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID,
		candidateId: c.id,
		intent: copy.headline,
		evidenceJustification: copy.detail,
		applyDomain: "PROGRAMME_AUDIO_GAIN_DB",
		verificationDomain: "PRIMARY_SOURCE_AUDIO_WITH_VOLUME",
		provisionalArgs: {
			audioGainDb: c.resultingAudioGainDb,
			previousAudioGainDb: c.currentAudioGainDb,
			estimatedGainDeltaDb: c.estimatedGainDb,
		},
		safeToPropose: true,
	};
}
