/**
 * Prepare Target Story instructions for editingContext turns.
 * Same model turn as Source Story — no second LLM call.
 */

import type { MediaContextNeeds } from "../mediaContextNeeds";
import { inferEditingIntentHints } from "./intent";
import { buildTargetStoryPromptSection } from "./prompt";
import type { PreparedTargetStory } from "./types";

export function wantsTargetStory(contextNeeds: MediaContextNeeds): boolean {
	return contextNeeds.category === "editingContext";
}

export function prepareTargetStoryForTurn(input: {
	contextNeeds: MediaContextNeeds;
	userMessage: string;
	/** Target Story only when Source Story was also prepared this turn. */
	sourceStoryRequested: boolean;
}): PreparedTargetStory | null {
	if (!wantsTargetStory(input.contextNeeds)) return null;
	if (!input.sourceStoryRequested) return null;

	const intentHints = inferEditingIntentHints(input.userMessage);
	const promptSection = buildTargetStoryPromptSection({
		userMessage: input.userMessage,
		intentHints,
	});
	return {
		promptSection,
		requested: true,
		instructionChars: promptSection.length,
	};
}

/** Append TARGET_STORY prompt text onto a plain or multimodal user message. */
export function appendTargetStoryToUserMessage(
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
