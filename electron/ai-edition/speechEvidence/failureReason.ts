/**
 * Internal STT failure reason codes — never dump raw codes into user-facing prose.
 */

export const SPEECH_FAILURE_REASONS = [
	"binary_missing",
	"binary_not_executable",
	"binary_arch_mismatch",
	"server_start_failed",
	"server_not_ready",
	"model_missing",
	"model_load_failed",
	"audio_extract_failed",
	"audio_decode_failed",
	"audio_empty",
	"request_failed",
	"request_timeout",
	"malformed_response",
	"parse_failed",
	"timestamp_invalid",
	"runtime_crashed",
	"userdata_unavailable",
	"unknown",
] as const;

export type SpeechFailureReason = (typeof SPEECH_FAILURE_REASONS)[number];

/** Map thrown errors / messages onto a stable internal reason code. */
export function classifySpeechFailureReason(err: unknown): SpeechFailureReason {
	const msg = err instanceof Error ? err.message : String(err ?? "");
	const lower = msg.toLowerCase();

	if (/getpath|cannot read properties of undefined/i.test(msg)) return "userdata_unavailable";
	if (/model not found|ggml-.*\.bin|whisper ggml model/i.test(lower)) return "model_missing";
	if (/model load|failed to load model|whisper_init/i.test(lower)) return "model_load_failed";
	if (
		/not executable|eacces|permission denied/i.test(lower) &&
		/whisper|binary|server/i.test(lower)
	) {
		return "binary_not_executable";
	}
	if (/arch|bad cpu type|exec format/i.test(lower)) return "binary_arch_mismatch";
	if (/binary missing|whisper-stt-server.*not found|no whisper/i.test(lower))
		return "binary_missing";
	if (/server.*start|failed to spawn|spawn .*enoent|listening/i.test(lower))
		return "server_start_failed";
	if (/not ready|readiness|timed out waiting for/i.test(lower)) return "server_not_ready";
	if (/ffmpeg|extract|f32le|native-extraction/i.test(lower)) return "audio_extract_failed";
	if (/decode|invalid data found|error while decoding/i.test(lower)) return "audio_decode_failed";
	if (/empty (audio|pcm|samples)|0 samples/i.test(lower)) return "audio_empty";
	if (/timeout|aborted|headersTimeout|280s|request timed/i.test(lower)) return "request_timeout";
	if (/malformed|unexpected token|json/i.test(lower) && /response|parse|infer/i.test(lower)) {
		return "malformed_response";
	}
	if (/parse/i.test(lower)) return "parse_failed";
	if (/timestamp|outside canonical|source duration/i.test(lower)) return "timestamp_invalid";
	if (/crash|sigsegv|signal|exited with code/i.test(lower)) return "runtime_crashed";
	if (/fetch failed|inference|http/i.test(lower)) return "request_failed";
	return "unknown";
}

/** Human-safe reason string for SpeechEvidence.reason (not developer codes). */
export function humanSafeSpeechFailureReason(code: SpeechFailureReason): string {
	switch (code) {
		case "binary_missing":
		case "binary_not_executable":
		case "binary_arch_mismatch":
		case "model_missing":
		case "model_load_failed":
		case "server_start_failed":
		case "server_not_ready":
		case "userdata_unavailable":
			return "transcription is currently unavailable in this runtime";
		case "audio_extract_failed":
		case "audio_decode_failed":
		case "audio_empty":
			return "could not read audio from this recording";
		case "request_timeout":
		case "request_failed":
		case "runtime_crashed":
			return "transcription failed while processing this recording";
		case "malformed_response":
		case "parse_failed":
		case "timestamp_invalid":
			return "transcription produced unusable timing data";
		default:
			return "transcription is currently unavailable in this runtime";
	}
}
