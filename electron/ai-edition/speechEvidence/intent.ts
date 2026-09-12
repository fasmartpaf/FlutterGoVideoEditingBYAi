/**
 * Speech-intent helpers — thin wrappers over mediaContextNeeds.
 * Prefer classifyMediaContextNeeds for new call sites.
 */

import { classifyMediaContextNeeds } from "../mediaContextNeeds";

export function promptWantsSpeechEvidence(userMessage: string): boolean {
	return classifyMediaContextNeeds(userMessage).speech;
}

/** Explicit user ask for a readable transcript in the reply. */
export function promptAsksForTranscription(userMessage: string): boolean {
	return /\b(transcri|make\s+a\s+transcript|what\s+(was|did).{0,40}\bsay)\b/i.test(
		userMessage.trim(),
	);
}
