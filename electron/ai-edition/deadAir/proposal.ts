/**
 * Map DeadAirCandidate → existing EditProposalItem (addTrim), reviewable copy.
 * Does not execute tools. Does not mint consent. Single-candidate V1.
 */

import type { EditProposalItem, EditProposalV1 } from "../editProposal/types";
import { EDIT_PROPOSAL_V1_PROVIDER_ID } from "../editProposal/types";
import type { DeadAirCandidateV1 } from "./types";
import { LOCAL_DEAD_AIR_V1_PROVIDER_ID } from "./types";

export interface DeadAirReviewCopy {
	headline: string;
	detail: string;
	warnings: string[];
}

export function formatDeadAirReviewCopy(candidate: DeadAirCandidateV1): DeadAirReviewCopy {
	const pause = candidate.silenceDurationSec.toFixed(1);
	const near = candidate.silenceRange.startSec.toFixed(0);
	const remove = candidate.resultingRemovedDurationSec.toFixed(1);
	const keep = candidate.targetPauseKeptSec.toFixed(1);
	const headline = `Shorten a ${pause}-second quiet pause near ${near} seconds.`;
	const detail = [
		`Detected quiet interval ${candidate.silenceRange.startSec.toFixed(2)}s–${candidate.silenceRange.endSec.toFixed(2)}s (${pause}s).`,
		`Proposed removal: ${remove}s (SOURCE_MEDIA_TIME).`,
		`Preserves ~${keep}s natural pause plus speech padding.`,
		`Classification: ${candidate.classification}.`,
	].join(" ");
	return {
		headline,
		detail,
		warnings: [...candidate.warnings, ...candidate.blockingReasons.map((r) => `Blocked: ${r}`)],
	};
}

/**
 * Convert one safe candidate into an EditProposalItem compatible with applyPreview.
 */
export function deadAirCandidateToProposalItem(
	candidate: DeadAirCandidateV1,
): EditProposalItem | null {
	if (!candidate.safeToPropose || !candidate.proposedTrimRange) return null;
	const copy = formatDeadAirReviewCopy(candidate);
	const start = candidate.proposedTrimRange.startSec;
	const end = candidate.proposedTrimRange.endSec;

	const mustSurvive = [];
	if (candidate.speechBoundaryState.before.kind !== "none") {
		mustSurvive.push({
			id: `survive_before_${candidate.id}`,
			text: candidate.speechBoundaryState.before.text ?? "speech before pause",
			sourceBeatIds: [],
			reason: "adjacent speech before dead-air trim",
		});
	}
	if (candidate.speechBoundaryState.after.kind !== "none") {
		mustSurvive.push({
			id: `survive_after_${candidate.id}`,
			text: candidate.speechBoundaryState.after.text ?? "speech after pause",
			sourceBeatIds: [],
			reason: "adjacent speech after dead-air trim",
		});
	}

	return {
		id: `prop_${candidate.id}`,
		planItemId: `local_dead_air_${candidate.id}`,
		gapIds: [],
		sourceBeatIds: [],
		targetBeatIds: [],
		status: "proposal_ready",
		priority: "medium",
		intent: copy.headline,
		evidenceJustification: copy.detail,
		evidenceRefs: candidate.evidenceRefs.map((e) => ({
			kind: "speech_segment" as const,
			id: e.id,
			note: e.note,
		})),
		landing: {
			timebase: "SOURCE_MEDIA_TIME",
			startSourceTimeSec: start,
			endSourceTimeSec: end,
			boundaryBasis: "dead_air_v1 keep-some-pause + speech padding (SOURCE_MEDIA_TIME)",
			boundaryConfidence:
				candidate.confidence === "high"
					? "high"
					: candidate.confidence === "medium"
						? "medium"
						: "low",
			finalizedForApply: false,
		},
		mustSurvive,
		damageRisks: [
			{
				kind: "speech_meaning",
				level: "low",
				description: "Trim targets detected silence with speech padding; verify audio continuity.",
				mitigation: "Existing audio + compositor verify after consented apply.",
			},
			{
				kind: "visual_continuity",
				level: candidate.visualActivity.length > 0 ? "high" : "low",
				description:
					candidate.visualActivity.length > 0
						? "Cursor activity was observed in silence window."
						: "No blocking cursor interactions in silence window.",
			},
		],
		continuityRisk: "low",
		preservationViolationRisk: "low",
		preferredStrategy: "trim",
		proposedCall: {
			status: "proposal_only",
			notExecuted: true,
			toolFamily: "trim",
			toolName: "addTrim",
			provisionalArgs: {
				assetId: candidate.assetId,
				startSec: start,
				endSec: end,
				startSourceTimeSec: start,
				endSourceTimeSec: end,
				reason: `dead_air_v1:${candidate.classification}`,
				proposalOnly: true,
				providerId: LOCAL_DEAD_AIR_V1_PROVIDER_ID,
			},
			argsConfidence:
				candidate.confidence === "high"
					? "high"
					: candidate.confidence === "medium"
						? "medium"
						: "low",
		},
		constraints: candidate.preserveConstraints,
		confidence:
			candidate.confidence === "high" ? 0.85 : candidate.confidence === "medium" ? 0.65 : 0.4,
	};
}

/** Wrap a single proposal item into EditProposalV1 for applyPreview. */
export function wrapDeadAirProposal(args: {
	assetId: string;
	item: EditProposalItem;
}): EditProposalV1 {
	return {
		version: 1,
		providerId: EDIT_PROPOSAL_V1_PROVIDER_ID,
		assetId: args.assetId,
		summary: args.item.intent,
		proposals: [args.item],
		deferredPlanItemIds: [],
		hardConstraints: ["single_dead_air_candidate_v1", "consented_apply_required"],
		quality: {
			proposalCount: 1,
			proposalReadyCount: 1,
			noSafeProposalCount: 0,
			provisionalCount: 0,
			needsMoreEvidenceCount: 0,
			unsupportedCount: 0,
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

/**
 * Pick the single best safe candidate for V1 apply (longest removable excess).
 * When `nearSec` is set, prefer the safe candidate whose silence midpoint is closest.
 */
export function selectSingleDeadAirCandidate(
	candidates: DeadAirCandidateV1[],
	nearSec?: number | null,
): DeadAirCandidateV1 | null {
	const safe = candidates.filter((c) => c.safeToPropose && c.proposedTrimRange);
	if (safe.length === 0) return null;
	if (typeof nearSec === "number" && Number.isFinite(nearSec)) {
		return safe.reduce((a, b) => {
			const midA = (a.silenceRange.startSec + a.silenceRange.endSec) / 2;
			const midB = (b.silenceRange.startSec + b.silenceRange.endSec) / 2;
			return Math.abs(midB - nearSec) < Math.abs(midA - nearSec) ? b : a;
		});
	}
	return safe.reduce((a, b) =>
		b.resultingRemovedDurationSec > a.resultingRemovedDurationSec ? b : a,
	);
}
