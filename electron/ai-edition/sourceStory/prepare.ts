/**
 * Prepare Source Story scaffold for mediaUnderstanding / editingContext turns.
 * V2: evidence-grounded constrained prompt (same model turn — no second LLM call).
 */

import type { ClaimPromotionSet } from "../claimPromotion/types";
import type { MediaContextNeeds } from "../mediaContextNeeds";
import type { SpeechEvidence } from "../speechEvidence/types";
import type { TemporalEventLedger } from "../temporalEventLedger/types";
import type { InvestigationEvidenceSet } from "../videoInvestigator/types";
import type { VisualChange, VisualEvidenceFrame } from "../visualEvidence/types";
import { buildSourceStoryPromptSection } from "./prompt";
import { buildSourceStoryScaffold } from "./scaffold";
import type { PreparedSourceStory } from "./types";
import {
	buildSourceStoryEvidenceInput,
	buildSourceStoryV2,
	buildSourceStoryV2PromptSection,
	SOURCE_STORY_V2_PROVIDER_ID,
} from "./v2";

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
	/** V2 inputs — optional for backward-compatible callers. */
	assetId?: string;
	ledger?: TemporalEventLedger | null;
	claimPromotion?: ClaimPromotionSet | null;
	investigation?: InvestigationEvidenceSet | null;
	/** Prefer V2 constrained prompt when evidence layers available. Default true when claims/ledger present. */
	useV2?: boolean;
}): PreparedSourceStory | null {
	if (!wantsSourceStory(input.contextNeeds)) return null;
	if (!(input.sourceDurationSec > 0)) return null;

	const hasSpeech = (input.speechEvidence?.segments.length ?? 0) > 0;
	const hasVisual = (input.frames?.length ?? 0) > 0;
	const hasCursor = (input.cursorEventTimes?.length ?? 0) > 0;
	const hasClaims = (input.claimPromotion?.claims.length ?? 0) > 0;
	const hasLedger = (input.ledger?.events.length ?? 0) > 0;
	if (!hasSpeech && !hasVisual && !hasCursor && !hasClaims && !hasLedger) return null;

	const scaffold = buildSourceStoryScaffold({
		sourceDurationSec: input.sourceDurationSec,
		speechEvidence: input.speechEvidence,
		frames: input.frames,
		changes: input.changes,
		cursorEventTimes: input.cursorEventTimes,
	});

	const wantV2 =
		input.useV2 !== false &&
		Boolean(input.assetId) &&
		(hasClaims || hasLedger || Boolean(input.investigation));

	if (wantV2 && input.assetId) {
		const evidenceInput = buildSourceStoryEvidenceInput({
			assetId: input.assetId,
			sourceDurationSec: input.sourceDurationSec,
			speechEvidence: input.speechEvidence,
			frames: input.frames,
			changes: input.changes,
			cursorEventTimes: input.cursorEventTimes,
			ledger: input.ledger,
			claimPromotion: input.claimPromotion,
			investigation: input.investigation,
		});
		const storyV2 = buildSourceStoryV2(evidenceInput);
		const promptSection = buildSourceStoryV2PromptSection({ storyV2, scaffold });
		scaffold.timings.promptChars = promptSection.length;
		return {
			scaffold,
			promptSection,
			requested: true,
			storyV2,
			evidenceInput,
			providerId: SOURCE_STORY_V2_PROVIDER_ID,
		};
	}

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
