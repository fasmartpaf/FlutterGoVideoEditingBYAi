/**
 * Audio Continuity Verification V1
 */

export {
	analyzeJoinPcm,
	BLOCKING_BOUNDARY_JUMP,
	classifyWaveformPolicy,
	synthesizeJoinPcm,
	WARNING_BOUNDARY_JUMP,
	WARNING_RMS_RATIO,
} from "./analyze";
export {
	createBoundedExportPcmProvider,
	createInjectedPcmProvider,
	createSyntheticJoinPcmProvider,
	detectNoAudio,
} from "./extract";
export type {
	AudioCapturePath,
	AudioContinuityEvidence,
	AudioContinuityStatus,
	AudioPcmBuffer,
	AudioPcmProvider,
	AudioWaveformMetrics,
} from "./types";
export {
	AUDIO_VERIFY_PAD_AFTER_SEC,
	AUDIO_VERIFY_PAD_BEFORE_SEC,
	AUDIO_VERIFY_SAMPLE_RATE,
	AUDIO_VERIFY_V1_PROVIDER_ID,
} from "./types";
export type { AudioVerifyInput } from "./verify";
export { audioVerifyPassed, verifyTrimAudioContinuity } from "./verify";
