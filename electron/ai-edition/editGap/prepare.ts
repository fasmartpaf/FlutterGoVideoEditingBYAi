/**
 * Prepare Edit Gap V1 after Source Story V2 + Target Story V1.
 * Deterministic only — 0 additional model calls. No prompt injection required.
 */

import type { MediaContextNeeds } from "../mediaContextNeeds";
import type { SourceStoryV2 } from "../sourceStory/v2/types";
import type { TargetStoryV1 } from "../targetStory/v1/types";
import { buildEditGapV1 } from "./buildGap";
import type { EditGapV1 } from "./types";
import { EDIT_GAP_V1_PROVIDER_ID } from "./types";
import { validateAndSanitizeEditGapV1 } from "./validate";

export function wantsEditGap(contextNeeds: MediaContextNeeds): boolean {
	return contextNeeds.category === "editingContext";
}

export function prepareEditGapForTurn(input: {
	contextNeeds: MediaContextNeeds;
	userMessage: string;
	sourceStoryV2?: SourceStoryV2 | null;
	targetStoryV1?: TargetStoryV1 | null;
}): { editGapV1: EditGapV1; providerId: typeof EDIT_GAP_V1_PROVIDER_ID } | null {
	if (!wantsEditGap(input.contextNeeds)) return null;
	if (!input.sourceStoryV2 || !input.targetStoryV1) return null;

	const built = buildEditGapV1({
		sourceStoryV2: input.sourceStoryV2,
		targetStoryV1: input.targetStoryV1,
		userIntent: input.userMessage,
	});
	const { gap } = validateAndSanitizeEditGapV1(built);
	return { editGapV1: gap, providerId: EDIT_GAP_V1_PROVIDER_ID };
}
