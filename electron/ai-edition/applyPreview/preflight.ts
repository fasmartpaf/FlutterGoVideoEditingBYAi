/**
 * Proposal eligibility + deterministic preflight for Apply Preview V1
 * (+ Verified Apply Expansion: trim | zoom | crop | speed | captions).
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { isMutatingTool } from "../agent-tools";
import { fingerprintWords, survivingWordsFromDocument } from "../captionLayout";
import {
	programmeFingerprintFromDocument,
	styleFingerprintFromDocument,
} from "../captionLayout/operation";
import type { EditProposalItem, EditProposalV1 } from "../editProposal/types";
import {
	operationArgsFingerprint,
	VERIFIED_APPLY_TOOLS,
	validateFamilyOperationArgs,
} from "./familyPreflight";
import { fingerprintDocument } from "./fingerprint";
import {
	type ApplyPreflight,
	type EligibilityBlockReason,
	isProposalEligibleShape,
	MAX_MUTATIONS_PER_PREVIEW,
} from "./types";

let preflightSeq = 0;

export function resetApplyPreviewSeqForTests(): void {
	preflightSeq = 0;
}

function nextPreflightId(): string {
	preflightSeq += 1;
	return `ap_preflight_${preflightSeq}`;
}

/** Production allowlist — single mutation families. */
export const SUPPORTED_APPLY_TOOLS = VERIFIED_APPLY_TOOLS;

export function selectProposalForPreview(
	editProposalV1: EditProposalV1,
	selectedProposalId?: string,
): EditProposalItem | null {
	if (selectedProposalId) {
		return editProposalV1.proposals.find((p) => p.id === selectedProposalId) ?? null;
	}
	const ready = editProposalV1.proposals.filter((p) => p.status === "proposal_ready");
	if (ready.length === 1) return ready[0];
	return null;
}

function resolveAssetAndClip(
	document: AxcutDocument,
	proposal: EditProposalItem,
): { assetId?: string; clipId?: string; reasons: EligibilityBlockReason[] } {
	const reasons: EligibilityBlockReason[] = [];
	const args = proposal.proposedCall?.provisionalArgs ?? {};
	const assetId =
		(typeof args.assetId === "string" && args.assetId) ||
		document.project.primaryAssetId ||
		document.assets[0]?.id;
	if (!assetId || !document.assets.some((a) => a.id === assetId)) {
		reasons.push("missing_asset");
		return { reasons };
	}
	let clipId = typeof args.clipId === "string" ? args.clipId : undefined;
	if (clipId && !document.timeline.clips.some((c) => c.id === clipId)) {
		reasons.push("missing_clip");
		return { assetId, reasons };
	}
	if (!clipId && proposal.landing) {
		const { startSourceTimeSec: start, endSourceTimeSec: end } = proposal.landing;
		const covering = document.timeline.clips.filter(
			(c) =>
				c.assetId === assetId &&
				end > c.sourceStartSec &&
				start < (c.sourceEndSec ?? Number.POSITIVE_INFINITY),
		);
		if (covering.length === 1) clipId = covering[0].id;
		else if (covering.length === 0) reasons.push("missing_clip");
	}
	return { assetId, clipId, reasons };
}

export function buildApplyPreflight(args: {
	document: AxcutDocument;
	proposal: EditProposalItem | null;
	proposalDocumentFingerprint?: string | null;
	mutationBudgetRemaining?: number;
}): ApplyPreflight {
	const t0 = Date.now();
	const fp = fingerprintDocument(args.document);
	const blockingReasons: EligibilityBlockReason[] = [];

	if (!args.proposal) {
		blockingReasons.push("proposal_not_ready");
		return {
			id: nextPreflightId(),
			proposalId: "",
			eligible: false,
			blockingReasons,
			documentFingerprint: fp,
			mustSurviveIds: [],
			damageRiskLevels: [],
			stale: false,
			preflightMs: Date.now() - t0,
		};
	}

	const shape = isProposalEligibleShape(args.proposal);
	blockingReasons.push(...shape.reasons);

	const toolName = args.proposal.proposedCall?.toolName ?? undefined;
	const captionTool = toolName === "enableCaptions";
	if (
		!toolName ||
		!SUPPORTED_APPLY_TOOLS.has(toolName) ||
		(!captionTool && !isMutatingTool(toolName))
	) {
		if (!blockingReasons.includes("missing_tool_name")) {
			blockingReasons.push("capability_unsupported");
		}
	} else {
		blockingReasons.push(...validateFamilyOperationArgs(args.proposal));
	}

	const resolved = resolveAssetAndClip(args.document, args.proposal);
	blockingReasons.push(...resolved.reasons);

	if (captionTool && resolved.assetId) {
		const argsMap = args.proposal.proposedCall?.provisionalArgs ?? {};
		const aspect =
			typeof argsMap.aspectValue === "number" && Number.isFinite(argsMap.aspectValue)
				? argsMap.aspectValue
				: 16 / 9;
		const liveTranscript = fingerprintWords(
			survivingWordsFromDocument(args.document, resolved.assetId),
		);
		const liveProg = programmeFingerprintFromDocument(args.document);
		const liveStyle = styleFingerprintFromDocument(args.document, aspect);
		if (
			typeof argsMap.transcriptFingerprint === "string" &&
			argsMap.transcriptFingerprint !== liveTranscript
		) {
			blockingReasons.push("stale_proposal");
		}
		if (
			typeof argsMap.programmeFingerprint === "string" &&
			argsMap.programmeFingerprint !== liveProg
		) {
			blockingReasons.push("stale_proposal");
		}
		if (typeof argsMap.styleFingerprint === "string" && argsMap.styleFingerprint !== liveStyle) {
			blockingReasons.push("stale_proposal");
		}
		if (argsMap.layoutStatus === "NO_SAFE_LAYOUT" || argsMap.layoutStatus === "NO_SPEECH") {
			blockingReasons.push("invalid_operation_args");
		}
	}

	const stale =
		typeof args.proposalDocumentFingerprint === "string" &&
		args.proposalDocumentFingerprint.length > 0 &&
		args.proposalDocumentFingerprint !== fp.value;
	if (stale) blockingReasons.push("stale_proposal");

	const budget = args.mutationBudgetRemaining ?? MAX_MUTATIONS_PER_PREVIEW;
	if (budget < 1) blockingReasons.push("max_mutations_exceeded");

	const unique = [...new Set(blockingReasons)];
	return {
		id: nextPreflightId(),
		proposalId: args.proposal.id,
		eligible: unique.length === 0,
		blockingReasons: unique,
		documentFingerprint: fp,
		assetId: resolved.assetId,
		clipId: resolved.clipId,
		capability: args.proposal.preferredStrategy,
		toolName,
		landing: args.proposal.landing
			? {
					timebase: "SOURCE_MEDIA_TIME",
					startSourceTimeSec: args.proposal.landing.startSourceTimeSec,
					endSourceTimeSec: args.proposal.landing.endSourceTimeSec,
				}
			: undefined,
		mustSurviveIds: args.proposal.mustSurvive.map((m) => m.id),
		damageRiskLevels: args.proposal.damageRisks.map((d) => d.level),
		stale: unique.includes("stale_proposal"),
		preflightMs: Date.now() - t0,
		operationArgsFingerprint: operationArgsFingerprint(args.proposal),
	};
}
