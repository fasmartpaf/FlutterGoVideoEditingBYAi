/**
 * Map surfaceable local recommendations → EditProposalItem (single-apply).
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import {
	buildCaptionLayoutOperation,
	type CaptionLayoutResult,
	operationToProvisionalArgs,
} from "../captionLayout";
import {
	type DeadAirCandidateV1,
	deadAirCandidateToProposalItem,
	selectSingleDeadAirCandidate,
	wrapDeadAirProposal,
} from "../deadAir";
import type {
	EditorialRecommendationSetV1,
	EditorialRecommendationV1,
} from "../editorialOrchestration/types";
import type { EditProposalItem, EditProposalV1 } from "../editProposal/types";
import { EDIT_PROPOSAL_V1_PROVIDER_ID } from "../editProposal/types";
import type { ProductEditorialIntents } from "./types";
import { EDITORIAL_RECOMMENDATION_PRODUCT_SURFACE_V1_ID } from "./types";

function wrapSingleProposal(args: {
	assetId: string;
	item: EditProposalItem;
	summary: string;
}): EditProposalV1 {
	return {
		version: 1,
		providerId: EDIT_PROPOSAL_V1_PROVIDER_ID,
		assetId: args.assetId,
		summary: args.summary,
		proposals: [args.item],
		deferredPlanItemIds: [],
		hardConstraints: [
			"editorial_recommendation_product_surface_v1",
			"single_proposal_only",
			"consented_apply_required",
		],
		quality: {
			proposalCount: 1,
			proposalReadyCount: args.item.status === "proposal_ready" ? 1 : 0,
			noSafeProposalCount: args.item.status === "no_safe_proposal" ? 1 : 0,
			provisionalCount: args.item.status === "provisional" ? 1 : 0,
			needsMoreEvidenceCount: args.item.status === "needs_more_evidence" ? 1 : 0,
			unsupportedCount: args.item.status === "unsupported" ? 1 : 0,
			avgBoundaryConfidence: 1,
			highContinuityRiskCount: 0,
			preservationBlockingCount: 0,
		},
		metrics: {
			planItemsConsumed: 1,
			proposalsGenerated: 1,
			serializedBytesApprox: 0,
			buildMs: 0,
			additionalModelCalls: 0,
			providerId: EDIT_PROPOSAL_V1_PROVIDER_ID,
		},
	};
}

function captionLayoutToProposalItem(args: {
	document: AxcutDocument;
	assetId: string;
	layout: CaptionLayoutResult;
	aspectValue: number;
	recommendation: EditorialRecommendationV1;
}): EditProposalItem | null {
	if (args.layout.status !== "ok" || args.layout.metrics.cueCount < 1) return null;
	const id = `prop_local_cap_${args.recommendation.id}`;
	const op = buildCaptionLayoutOperation({
		proposalId: id,
		document: args.document,
		assetId: args.assetId,
		layout: args.layout,
		aspectValue: args.aspectValue,
	});
	const provisionalArgs = operationToProvisionalArgs(op);
	provisionalArgs.assetId = args.assetId;
	provisionalArgs.providerId = EDITORIAL_RECOMMENDATION_PRODUCT_SURFACE_V1_ID;

	const kept = args.layout.cues.filter((c) => !c.omitted);
	const start = kept.length ? Math.min(...kept.map((c) => c.sourceStartSec)) : 0;
	const end = kept.length ? Math.max(...kept.map((c) => c.sourceEndSec)) : 0;

	return {
		id,
		planItemId: `local_caption_${args.recommendation.id}`,
		gapIds: [],
		sourceBeatIds: [],
		targetBeatIds: [],
		status: "proposal_ready",
		priority: "medium",
		intent: args.recommendation.reviewCopy || args.recommendation.rationale,
		evidenceJustification: args.recommendation.rationale,
		evidenceRefs: args.recommendation.evidenceRefs.map((e) => ({
			kind: "speech_segment" as const,
			id: e.id,
			note: e.note ?? e.kind,
		})),
		landing: {
			timebase: "SOURCE_MEDIA_TIME",
			startSourceTimeSec: start,
			endSourceTimeSec: end,
			boundaryBasis: "caption_layout_v1 cue span",
			boundaryConfidence: "high",
			finalizedForApply: false,
		},
		mustSurvive: [
			{
				id: "survive_transcript",
				text: "Existing transcript wording",
				sourceBeatIds: [],
				reason: "Captions derive from transcript SSOT",
			},
		],
		damageRisks: [
			{
				kind: "other",
				level: "low",
				description:
					"Captions may cover UI; layout policy already avoided protected regions when possible.",
			},
		],
		continuityRisk: "low",
		preservationViolationRisk: "low",
		preferredStrategy: "caption",
		proposedCall: {
			status: "proposal_only",
			notExecuted: true,
			toolFamily: "caption",
			toolName: "enableCaptions",
			provisionalArgs,
			argsConfidence: "high",
		},
		constraints: ["preserve_manual_captions", "settings_only_enable"],
		confidence: 0.9,
	};
}

function applyReady(r: EditorialRecommendationV1): boolean {
	return (
		(r.recommendationStatus === "RECOMMEND" || r.recommendationStatus === "OPTIONAL") &&
		r.executionReadiness === "READY_TO_APPLY" &&
		r.verifiedApplyCapability === "READY" &&
		r.missingParameters.length === 0
	);
}

/**
 * Pick a single recommendation for the consent card, biased by user intents.
 */
export function selectProductRecommendation(args: {
	set: EditorialRecommendationSetV1;
	intents: ProductEditorialIntents;
}): EditorialRecommendationV1 | null {
	const ready = args.set.recommendations.filter(applyReady);
	if (ready.length === 0) return null;

	const byFamily = (family: string) => ready.filter((r) => r.operationFamily === family);

	if (args.intents.wantCaptions) {
		const cap = byFamily("CAPTIONS")[0];
		if (cap) return cap;
	}
	if (args.intents.wantTighter || args.intents.targetDurationSec != null) {
		const trim = byFamily("TRIM")[0];
		if (trim) return trim;
		// Explicit pacing ask: do not silently offer captions instead.
		if (!args.intents.wantCaptions && !args.intents.wantProfessional) {
			return null;
		}
	}
	if (args.intents.wantProfessional) {
		const trim = byFamily("TRIM")[0];
		if (trim) return trim;
		const cap = byFamily("CAPTIONS")[0];
		if (cap) return cap;
	}

	// Default (generic ask): TRIM → CAPTIONS → first READY
	return byFamily("TRIM")[0] ?? byFamily("CAPTIONS")[0] ?? ready[0] ?? null;
}

export function recommendationToEditProposal(args: {
	document: AxcutDocument;
	assetId: string;
	aspectValue: number;
	recommendation: EditorialRecommendationV1;
	captionLayout: CaptionLayoutResult | null;
	deadAirCandidates: DeadAirCandidateV1[];
}): EditProposalV1 | null {
	const rec = args.recommendation;
	if (rec.operationFamily === "CAPTIONS" && rec.expectedOperationType === "enableCaptions") {
		if (!args.captionLayout) return null;
		const item = captionLayoutToProposalItem({
			document: args.document,
			assetId: args.assetId,
			layout: args.captionLayout,
			aspectValue: args.aspectValue,
			recommendation: rec,
		});
		if (!item) return null;
		return wrapSingleProposal({
			assetId: args.assetId,
			item,
			summary: item.intent,
		});
	}

	if (rec.operationFamily === "TRIM" && rec.expectedOperationType === "addTrim") {
		const evidenceId = rec.evidenceRefs.find((e) => e.kind === "dead_air_candidate")?.id;
		const matched =
			(evidenceId ? args.deadAirCandidates.find((c) => c.id === evidenceId) : null) ??
			selectSingleDeadAirCandidate(args.deadAirCandidates);
		if (!matched) return null;
		const item = deadAirCandidateToProposalItem(matched);
		if (!item) return null;
		item.planItemId = `local_trim_${rec.id}`;
		item.intent = rec.reviewCopy || item.intent;
		item.evidenceJustification = rec.rationale || item.evidenceJustification;
		return wrapDeadAirProposal({ assetId: args.assetId, item });
	}

	return null;
}

export function buildUserFacingOffer(args: {
	recommendation: EditorialRecommendationV1 | null;
	doNothing: boolean;
	intents: ProductEditorialIntents;
	notes: string[];
}): string | null {
	if (args.recommendation && applyReady(args.recommendation)) {
		const family = args.recommendation.operationFamily;
		const copy = args.recommendation.reviewCopy.trim();
		if (family === "CAPTIONS") {
			return [
				copy || "Captions are available from your transcript.",
				"Review the card below and click Apply edit if you want them enabled.",
				"Nothing has been changed yet.",
			].join(" ");
		}
		if (family === "TRIM") {
			return [
				copy || "A quiet pause looks safe to shorten.",
				"Review the card below and click Apply edit if you want that cut.",
				"Nothing has been changed yet.",
			].join(" ");
		}
		return [
			copy || "I found a safe, recording-specific edit.",
			"Review the card below. Nothing has been changed yet.",
		].join(" ");
	}

	if (args.intents.wantCaptions) {
		if (args.notes.includes("no_transcript_words")) {
			return "I looked for captions, but this project does not have a usable transcript yet. Your project was not changed.";
		}
		return "I checked the local caption path — there isn’t a safe caption enable I can offer right now (already on, no safe layout, or blocked). Your project was not changed.";
	}

	if (args.intents.wantTighter || args.intents.targetDurationSec != null) {
		return "I checked for long silent pauses that are safe to shorten. From the local silence evidence, I don’t have a safe trim to recommend right now. Your project was not changed.";
	}

	if (args.doNothing) {
		return null; // let existing grounding honesty stand when no local offer
	}
	return null;
}
