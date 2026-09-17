/**
 * Prepare Target Story instructions for editingContext turns.
 * V1: evidence-constrained from Source Story V2 (same model turn — no second LLM).
 */

import type { MediaContextNeeds } from "../mediaContextNeeds";
import type { SourceStoryV2 } from "../sourceStory/v2/types";
import { inferEditingIntentHints } from "./intent";
import { buildTargetStoryPromptSection } from "./prompt";
import type { PreparedTargetStory } from "./types";
import {
	buildTargetStoryV1,
	buildTargetStoryV1PromptSection,
	TARGET_STORY_V1_PROVIDER_ID,
} from "./v1";

export function wantsTargetStory(contextNeeds: MediaContextNeeds): boolean {
	return contextNeeds.category === "editingContext";
}

export function prepareTargetStoryForTurn(input: {
	contextNeeds: MediaContextNeeds;
	userMessage: string;
	/** Target Story only when Source Story was also prepared this turn. */
	sourceStoryRequested: boolean;
	/** Source Story V2 — enables Target Story V1 constrained path. */
	sourceStoryV2?: SourceStoryV2 | null;
	useV1?: boolean;
}): PreparedTargetStory | null {
	if (!wantsTargetStory(input.contextNeeds)) return null;
	if (!input.sourceStoryRequested) return null;

	const intentHints = inferEditingIntentHints(input.userMessage);

	if (input.useV1 !== false && input.sourceStoryV2) {
		const targetV1 = buildTargetStoryV1({
			sourceStoryV2: input.sourceStoryV2,
			userIntent: input.userMessage,
			editingIntent: intentHints,
		});
		const promptSection = buildTargetStoryV1PromptSection({
			targetV1,
			userMessage: input.userMessage,
			intentHints,
		});
		targetV1.metrics.promptChars = promptSection.length;
		return {
			promptSection,
			requested: true,
			instructionChars: promptSection.length,
			targetV1,
			providerId: TARGET_STORY_V1_PROVIDER_ID,
		};
	}

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
