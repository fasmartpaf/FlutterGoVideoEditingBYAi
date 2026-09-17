/**
 * FinalEditorialQualityReviewV1 — programme vs TargetEditStory after commits.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { ProfessionalEditOrchestratorResultV1 } from "../professionalEditOrchestrator/types";
import type { TargetEditStoryV1 } from "./types";

export type FinalEditorialQualityLabelV1 =
	| "PROFESSIONALLY_IMPROVED"
	| "TECHNICALLY_VALID_NO_CLEAR_IMPROVEMENT"
	| "NEEDS_REVISION"
	| "FAILED";

export interface FinalEditorialQualityReviewV1 {
	version: 1;
	STORY_COHERENCE: "PASS" | "WEAK" | "FAIL";
	PACING: "PASS" | "WEAK" | "FAIL";
	IMPORTANT_CONTENT_PRESERVED: "PASS" | "FAIL" | "UNKNOWN";
	FOCAL_CLARITY: "PASS" | "WEAK" | "N/A";
	VISUAL_CLUTTER: "PASS" | "WEAK" | "FAIL";
	TITLE_QUALITY: "PASS" | "WEAK" | "FAIL" | "N/A";
	TRANSITION_COHERENCE: "PASS" | "N/A";
	CAPTION_COLLISION: "PASS" | "RISK" | "N/A";
	JOIN_QUALITY: "PASS" | "FAIL" | "NOT_RUN";
	TECHNICAL_INTEGRITY: "PASS" | "FAIL";
	TARGET_STORY_SATISFIED: "PASS" | "PARTIAL" | "FAIL";
	label: FinalEditorialQualityLabelV1;
	revisionHints: string[];
	notes: string[];
}

function titleLooksConversational(text: string): boolean {
	return (
		/\b(this is a|i am working|i'm working|um+|uh+|our cursor|look here this is|i think you|you can see)\b/i.test(
			text,
		) ||
		/\b(screen recording|limited(?:\s+labeled)?\s+speech|labeled speech|transcript|visual evidence|unknown content|recording with|in this pass)\b/i.test(
			text,
		) ||
		/\b(\w+)\s+\1\b/i.test(text)
	);
}

export function buildFinalEditorialQualityReview(args: {
	result: ProfessionalEditOrchestratorResultV1;
	document: AxcutDocument;
	targetStory: TargetEditStoryV1 | null | undefined;
	originalDurationSec: number;
}): FinalEditorialQualityReviewV1 {
	const notes: string[] = [];
	const revisionHints: string[] = [];
	const committed = args.result.session.completed.filter((c) => c.status === "committed");
	const families = new Set(
		committed
			.map((c) => args.result.plan.steps.find((s) => s.stepId === c.stepId)?.family)
			.filter(Boolean) as string[],
	);
	if (args.result.loudness?.committed) families.add("loudness");

	const qc = args.result.finalSequenceQc?.overall;
	const JOIN_QUALITY =
		qc === "PASS" || qc === "PASS_WITH_WARNINGS" ? "PASS" : qc === "FAIL" ? "FAIL" : "NOT_RUN";

	const rolledBack = args.result.session.failed.some((f) => f.status === "rolled_back");
	const TECHNICAL_INTEGRITY =
		rolledBack || (args.result.metrics.autoUnverifiedMutations ?? 0) > 0 || JOIN_QUALITY === "FAIL"
			? "FAIL"
			: "PASS";

	const titles = (args.document.annotations ?? []).filter(
		(a) => a.annotationSource !== "auto-caption",
	);
	let TITLE_QUALITY: FinalEditorialQualityReviewV1["TITLE_QUALITY"] = "N/A";
	if (families.has("title") || titles.length > 0) {
		const text = (titles[0]?.textContent ?? titles[0]?.content ?? "").trim();
		if (!text) TITLE_QUALITY = "FAIL";
		else if (titleLooksConversational(text)) {
			TITLE_QUALITY = "FAIL";
			revisionHints.push("Remove or replace conversational title text");
		} else if (text.split(/\s+/).length > 10) {
			TITLE_QUALITY = "WEAK";
			revisionHints.push("Shorten opening title");
		} else TITLE_QUALITY = "PASS";
	}

	const hasZoom = families.has("zoom");
	const hasCallout = families.has("callout");
	const FOCAL_CLARITY: FinalEditorialQualityReviewV1["FOCAL_CLARITY"] =
		hasZoom || hasCallout ? "PASS" : "N/A";
	const VISUAL_CLUTTER: FinalEditorialQualityReviewV1["VISUAL_CLUTTER"] =
		hasZoom && hasCallout && families.has("title") ? "WEAK" : "PASS";
	if (VISUAL_CLUTTER === "WEAK") {
		revisionHints.push("Reduce title+zoom+callout clutter on same beat");
	}

	const onlyCapLoud =
		committed.length > 0 && [...families].every((f) => f === "captions" || f === "loudness");
	const editorialFamilies = [...families].filter((f) => f !== "captions" && f !== "loudness");

	const PACING: FinalEditorialQualityReviewV1["PACING"] =
		families.has("trim") || families.has("speed")
			? "PASS"
			: editorialFamilies.length > 0
				? "WEAK"
				: "WEAK";

	const STORY_COHERENCE: FinalEditorialQualityReviewV1["STORY_COHERENCE"] =
		args.targetStory && args.targetStory.beats.length > 0 ? "PASS" : "WEAK";

	const IMPORTANT_CONTENT_PRESERVED: FinalEditorialQualityReviewV1["IMPORTANT_CONTENT_PRESERVED"] =
		JOIN_QUALITY === "FAIL" ? "FAIL" : "PASS";

	const TRANSITION_COHERENCE: FinalEditorialQualityReviewV1["TRANSITION_COHERENCE"] =
		families.has("transitions") || families.has("transition") ? "PASS" : "N/A";

	const captionsOn = Boolean(
		(args.document.legacyEditor as Record<string, unknown> | null)?.captions &&
			typeof (args.document.legacyEditor as Record<string, unknown>).captions === "object" &&
			((args.document.legacyEditor as Record<string, unknown>).captions as { enabled?: boolean })
				.enabled,
	);
	const CAPTION_COLLISION: FinalEditorialQualityReviewV1["CAPTION_COLLISION"] =
		captionsOn && titles.length > 0 ? "RISK" : captionsOn ? "PASS" : "N/A";

	let TARGET_STORY_SATISFIED: FinalEditorialQualityReviewV1["TARGET_STORY_SATISFIED"] = "PARTIAL";
	if (onlyCapLoud) {
		TARGET_STORY_SATISFIED = "FAIL";
		notes.push("Captions/loudness-only does not satisfy target editorial story");
	} else if (editorialFamilies.length >= 1 && TITLE_QUALITY !== "FAIL") {
		TARGET_STORY_SATISFIED = "PASS";
	} else if (committed.length === 0) {
		TARGET_STORY_SATISFIED = "PARTIAL";
		notes.push("No mutations — may be already-good restraint");
	}

	let label: FinalEditorialQualityLabelV1 = "TECHNICALLY_VALID_NO_CLEAR_IMPROVEMENT";
	if (TECHNICAL_INTEGRITY === "FAIL" || TITLE_QUALITY === "FAIL") {
		label = TITLE_QUALITY === "FAIL" ? "NEEDS_REVISION" : "FAILED";
	} else if (onlyCapLoud) {
		label = "TECHNICALLY_VALID_NO_CLEAR_IMPROVEMENT";
	} else if (editorialFamilies.length >= 1 && TARGET_STORY_SATISFIED === "PASS") {
		label = "PROFESSIONALLY_IMPROVED";
	} else if (revisionHints.length > 0) {
		label = "NEEDS_REVISION";
	}

	return {
		version: 1,
		STORY_COHERENCE,
		PACING,
		IMPORTANT_CONTENT_PRESERVED,
		FOCAL_CLARITY,
		VISUAL_CLUTTER,
		TITLE_QUALITY,
		TRANSITION_COHERENCE,
		CAPTION_COLLISION,
		JOIN_QUALITY,
		TECHNICAL_INTEGRITY,
		TARGET_STORY_SATISFIED,
		label,
		revisionHints,
		notes,
	};
}
