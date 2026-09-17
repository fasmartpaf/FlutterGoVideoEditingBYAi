/**
 * Deterministic caption layout proposal / review copy. No LLM. Does not mutate.
 */

import type { CaptionLayoutResult } from "./types";
import { LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID } from "./types";

export interface CaptionLayoutReviewCopy {
	headline: string;
	detail: string;
	warnings: string[];
}

export function formatCaptionLayoutReviewCopy(
	result: CaptionLayoutResult,
): CaptionLayoutReviewCopy {
	const dur =
		result.cues.length === 0
			? 0
			: Math.max(...result.cues.map((c) => c.sourceEndSec)) -
				Math.min(...result.cues.map((c) => c.sourceStartSec));
	const placement = result.cues.find((c) => !c.omitted)?.placement ?? "BOTTOM_CENTER";
	const headline =
		result.status === "NO_SPEECH" || result.status === "NO_TRANSCRIPT"
			? "No narration transcript is available for captions."
			: result.status === "NO_SAFE_LAYOUT"
				? "Captions cannot be placed safely without covering protected content."
				: `Add captions for ${dur.toFixed(0)} seconds of narration.`;
	const detail = [
		`${result.metrics.cueCount} cues`,
		`placement ${placement.replace(/_/g, " ").toLowerCase()}`,
		`aspect ${result.aspectValue.toFixed(2)}`,
		result.metrics.readingSpeedViolations
			? `${result.metrics.readingSpeedViolations} reading-speed warnings`
			: "reading speed within policy",
		result.metrics.collisionCount
			? `${result.metrics.collisionCount} collision notes`
			: "no collisions",
	].join(" · ");
	return {
		headline,
		detail,
		warnings: result.warnings.slice(0, 12),
	};
}

export interface CaptionLayoutProposal {
	status: "proposal_only";
	notExecuted: true;
	providerId: typeof LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID;
	intent: string;
	evidenceJustification: string;
	applyDomain: "CAPTION_SETTINGS_ENABLED";
	verificationDomain: "CAPTION_LAYOUT_V1";
	provisionalArgs: {
		enabled: true;
		aspectValue: number;
		cueCount: number;
		layoutStatus: CaptionLayoutResult["status"];
	};
	layout: CaptionLayoutResult;
	review: CaptionLayoutReviewCopy;
	safeToPropose: boolean;
	blockingReasons: string[];
}

export function buildCaptionLayoutProposal(result: CaptionLayoutResult): CaptionLayoutProposal {
	const review = formatCaptionLayoutReviewCopy(result);
	const blocking: string[] = [];
	if (result.status === "NO_SPEECH" || result.status === "NO_TRANSCRIPT") {
		blocking.push("no_transcript_speech");
	}
	if (result.status === "NO_SAFE_LAYOUT") blocking.push("no_safe_layout");
	if (result.metrics.cueCount < 1) blocking.push("zero_cues");
	return {
		status: "proposal_only",
		notExecuted: true,
		providerId: LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID,
		intent: review.headline,
		evidenceJustification: review.detail,
		applyDomain: "CAPTION_SETTINGS_ENABLED",
		verificationDomain: "CAPTION_LAYOUT_V1",
		provisionalArgs: {
			enabled: true,
			aspectValue: result.aspectValue,
			cueCount: result.metrics.cueCount,
			layoutStatus: result.status,
		},
		layout: result,
		review,
		safeToPropose: blocking.length === 0,
		blockingReasons: blocking,
	};
}
