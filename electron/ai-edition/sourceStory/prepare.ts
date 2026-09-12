/**
 * Prepare Source Story scaffold for mediaUnderstanding / editingContext turns.
 * Same model turn — no second LLM call.
 */

import type { MediaContextNeeds } from "../mediaContextNeeds";
import type { SpeechEvidence } from "../speechEvidence/types";
import type { VisualChange, VisualEvidenceFrame } from "../visualEvidence/types";
import { buildSourceStoryPromptSection } from "./prompt";
import { buildSourceStoryScaffold } from "./scaffold";
import type { PreparedSourceStory } from "./types";

export function wantsSourceStory(contextNeeds: MediaContextNeeds): boolean {
	return (
		contextNeeds.category === "mediaUnderstanding" || contextNeeds.category === "editingContext"
	);
}

export function prepareSourceStoryForTurn(input: {
	contextNeeds: MediaContextNeeds;
	sourceDurationSec: number;
	speechEvidence?: SpeechEvidence | null;
	frames?: VisualEvidenceFrame[];
	changes?: VisualChange[];
	cursorEventTimes?: number[];
}): PreparedSourceStory | null {
	if (!wantsSourceStory(input.contextNeeds)) return null;
	if (!(input.sourceDurationSec > 0)) return null;

	const hasSpeech = (input.speechEvidence?.segments.length ?? 0) > 0;
	const hasVisual = (input.frames?.length ?? 0) > 0;
	const hasCursor = (input.cursorEventTimes?.length ?? 0) > 0;
	if (!hasSpeech && !hasVisual && !hasCursor) return null;

	const scaffold = buildSourceStoryScaffold({
		sourceDurationSec: input.sourceDurationSec,
		speechEvidence: input.speechEvidence,
		frames: input.frames,
		changes: input.changes,
		cursorEventTimes: input.cursorEventTimes,
	});
	const promptSection = buildSourceStoryPromptSection(scaffold);
	scaffold.timings.promptChars = promptSection.length;
	return {
		scaffold,
		promptSection,
		requested: true,
	};
}

/** Append SOURCE_STORY prompt text onto a plain or multimodal user message. */
export function appendSourceStoryToUserMessage(
	userMessage: { role: "user"; content: unknown },
	promptSection: string,
): { role: "user"; content: unknown } {
	const content = userMessage.content;
	if (typeof content === "string") {
		return { role: "user", content: `${content}\n${promptSection}` };
	}
	if (Array.isArray(content)) {
		return {
			role: "user",
			content: [...content, { type: "text", text: promptSection }],
		};
	}
	return {
		role: "user",
		content: [
			{ type: "text", text: String(content ?? "") },
			{ type: "text", text: promptSection },
		],
	};
}
