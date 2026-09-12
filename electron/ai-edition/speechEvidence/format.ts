/**
 * Format speech evidence for user-facing replies — never raw JSON.
 * Canonical speechStatus wording shared by service + visual semantic prompts.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { MediaEvidenceCapabilities } from "../mediaEvidence";
import type { SpeechEvidence, SpeechEvidenceStatus, SpeechSegment } from "./types";

function formatClock(sec: number): string {
	const s = Math.max(0, sec);
	const m = Math.floor(s / 60);
	const rem = s - m * 60;
	const whole = Math.floor(rem);
	const frac = Math.round((rem - whole) * 100);
	return `${String(m).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(frac).padStart(2, "0")}`;
}

export function formatSpeechSegmentsForUser(segments: SpeechSegment[]): string {
	if (segments.length === 0) return "";
	const lines = segments.map(
		(s) =>
			`**${formatClock(s.startSourceTimeSec)}–${formatClock(s.endSourceTimeSec)}** — ${s.text.trim()}`,
	);
	return ["Here's the transcription:", "", ...lines].join("\n");
}

/** Canonical natural wording — keep no_audio / no_speech_detected / unavailable distinct. */
export const SPEECH_STATUS_USER_WORDING = {
	no_audio:
		"This recording doesn't contain an audio track, so there isn't any spoken narration to transcribe.",
	no_speech_detected: "The recording has audio, but I didn't detect spoken narration.",
	unavailable:
		"I couldn't generate the transcription because transcription is currently unavailable in this runtime.",
	failed:
		"I couldn't generate the transcription because transcription is currently unavailable in this runtime.",
} as const;

/** Prompt lines for system + visual-semantic scaffolds (same semantics everywhere). */
export function speechStatusPromptGuidance(): string {
	return [
		`If mediaCapabilities.speechStatus is no_audio: say something like \"${SPEECH_STATUS_USER_WORDING.no_audio}\" — NEVER say transcription is unavailable.`,
		`If speechStatus is no_speech_detected: say something like \"${SPEECH_STATUS_USER_WORDING.no_speech_detected}\"`,
		`If speechStatus is unavailable or failed: \"${SPEECH_STATUS_USER_WORDING.unavailable}\" Continue with visual analysis. Do NOT recommend external/manual transcription tools.`,
	].join(" ");
}

/**
 * Resolve speechStatus for injection into mediaCapabilities.
 * Absence of prepared evidence is NOT always "unavailable" — honor known no-audio on the document.
 */
export function resolveInjectedSpeechStatus(input: {
	injectSpeech: boolean;
	primarySpeech?: SpeechEvidence | null;
	document?: AxcutDocument | null;
}): NonNullable<MediaEvidenceCapabilities["speechStatus"]> {
	if (!input.injectSpeech) return "not_requested";
	if (input.primarySpeech?.status) return input.primarySpeech.status;

	const document = input.document;
	if (document) {
		const primaryId = document.project.primaryAssetId;
		const primary =
			document.assets.find((a) => a.id === primaryId) ??
			document.assets.find((a) => a.kind === "video") ??
			document.assets[0];
		if (primary?.transcriptionFailure?.kind === "no-audio") return "no_audio";
	}
	return "unavailable";
}

export function isUnavailableTranscriptionWording(text: string): boolean {
	return /transcription is currently unavailable in this runtime/i.test(text);
}

export function speechStatusAllowsUnavailableWording(
	status: SpeechEvidenceStatus | MediaEvidenceCapabilities["speechStatus"] | undefined,
): boolean {
	return status === "unavailable" || status === "failed";
}

/** Strip fenced observations / segments / context-needs / source/target-story JSON that must stay internal. */
export function stripInternalEvidenceJsonBlocks(text: string): string {
	return text
		.replace(/```(?:json)?\s*\{[\s\S]*?"observations"\s*:[\s\S]*?\}\s*```/gi, "")
		.replace(/```(?:json)?\s*\{[\s\S]*?"storyBeats"\s*:[\s\S]*?\}\s*```/gi, "")
		.replace(/```(?:json)?\s*\{[\s\S]*?"targetBeats"\s*:[\s\S]*?\}\s*```/gi, "")
		.replace(/```(?:json)?\s*\{[\s\S]*?"segments"\s*:[\s\S]*?\}\s*```/gi, "")
		.replace(/```(?:json)?\s*\{[\s\S]*?"injectSpeech"\s*:[\s\S]*?\}\s*```/gi, "")
		.replace(/```(?:json)?\s*\{[\s\S]*?"MediaContextNeeds"\s*:[\s\S]*?\}\s*```/gi, "")
		.replace(/\bMediaContextNeeds\b\s*[:=]\s*\{[\s\S]*?\}\s*/gi, "")
		.replace(/SOURCE_STORY\s*:?\s*\{[\s\S]*?\}\s*(?=\n\n|\n[A-Z]|$)/gi, "")
		.replace(/TARGET_STORY\s*:?\s*\{[\s\S]*?\}\s*(?=\n\n|\n[A-Z]|$)/gi, "")
		.replace(/VISUAL_SEMANTIC_GROUNDING\s*:?\s*\{[\s\S]*?\}\s*(?=\n\n|\n[A-Z]|$)/gi, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
