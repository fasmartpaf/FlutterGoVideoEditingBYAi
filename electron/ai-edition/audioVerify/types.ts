/**
 * Audio Continuity Verification V1
 * Identity: CURRENT_OPENSCREEN_AUDIO_VERIFY_V1
 *
 * Post-edit programme audio around a trim join — deterministic PCM analysis.
 * 0 required LLM calls. Does not invent fades/crossfades.
 */

export const AUDIO_VERIFY_V1_PROVIDER_ID = "CURRENT_OPENSCREEN_AUDIO_VERIFY_V1";

/** Programme pad around join (seconds). */
export const AUDIO_VERIFY_PAD_BEFORE_SEC = 0.75;
export const AUDIO_VERIFY_PAD_AFTER_SEC = 0.75;
/** Micro-window at join for discontinuity (seconds). */
export const AUDIO_VERIFY_MICRO_WINDOW_SEC = 0.05;
/** Broader context for RMS (seconds). */
export const AUDIO_VERIFY_CONTEXT_SEC = 0.25;

export const AUDIO_VERIFY_SAMPLE_RATE = 48_000;
export const AUDIO_VERIFY_CHANNELS = 1; // mono analysis of mixed programme

export type AudioContinuityStatus =
	| "verified_audio_basic"
	| "verified_audio_with_warnings"
	| "audio_verification_failed"
	| "audio_unavailable"
	| "not_applicable_no_audio"
	| "not_run";

export type AudioCapturePath = "bounded_exportMulti_pcm" | "injected_pcm" | "unavailable";

export interface AudioWaveformMetrics {
	rmsBefore: number;
	rmsAfter: number;
	peakBefore: number;
	peakAfter: number;
	/** Absolute sample jump across join (0..~2 for f32). */
	boundarySampleJump: number;
	clippingFraction: number;
	nearSilenceFractionBefore: number;
	nearSilenceFractionAfter: number;
	rmsRatio: number;
}

export interface AudioContinuityEvidence {
	version: 1;
	providerId: typeof AUDIO_VERIFY_V1_PROVIDER_ID;
	proposalId: string;
	programmeJoinSec: number;
	sourceBefore?: {
		assetId: string;
		sourceTimeSec: number;
		sourceStartSec: number;
		sourceEndSec: number;
	};
	sourceAfter?: {
		assetId: string;
		sourceTimeSec: number;
		sourceStartSec: number;
		sourceEndSec: number;
	};
	programmeAudioWindow: {
		startSec: number;
		endSec: number;
		sampleRate: number;
		channels: number;
		sampleCount: number;
	};
	speechBoundaryRisk: import("../renderVerify/types").SpeechBoundaryRisk;
	waveformMetrics: AudioWaveformMetrics | null;
	capturePath: AudioCapturePath;
	status: AudioContinuityStatus;
	warnings: string[];
	blockingReasons: string[];
	evidenceRefs: string[];
	additionalModelCalls: 0;
	latencyMs: {
		audioRenderSetupMs: number;
		boundedExportMs: number;
		decodeToPcmMs: number;
		analysisMs: number;
		totalAudioVerificationMs: number;
	};
	bytesRendered: number;
	pcmSamplesAnalyzed: number;
}

export interface AudioPcmBuffer {
	samples: Float32Array;
	sampleRate: number;
	channels: 1;
	/** Programme-relative start of this buffer. */
	programmeStartSec: number;
	/** Optional path label for receipts (defaults by caller). */
	capturePath?: AudioCapturePath;
}

export type AudioPcmProvider = (input: {
	document: import("../../../src/lib/ai-edition/schema").AxcutDocument;
	programmeStartSec: number;
	programmeEndSec: number;
	assetId: string;
}) => Promise<AudioPcmBuffer | null> | AudioPcmBuffer | null;
