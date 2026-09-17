/**
 * Edit Proposal V1 validator / sanitizer.
 */

import {
	assertsForbiddenRestartActionProposal,
	assertsForbiddenSettingsZoomProposal,
	assertsForbiddenUpworkProposal,
	isValidProposedCallShape,
	leaksExecution,
	sanitizeProposalProse,
} from "./guards";
import type { EditProposalItem, EditProposalQualityRubric, EditProposalV1 } from "./types";
import { EDIT_PROPOSAL_V1_PROVIDER_ID } from "./types";

export function validateAndSanitizeEditProposalV1(proposal: EditProposalV1): {
	proposal: EditProposalV1;
	rejected: string[];
	downgraded: string[];
} {
	const rejected: string[] = [];
	const downgraded: string[] = [];
	const kept: EditProposalItem[] = [];

	for (const item of proposal.proposals) {
		const blob = JSON.stringify(item);
		if (leaksExecution(blob)) {
			rejected.push(`${item.id}: execution leakage`);
			continue;
		}
		if (
			assertsForbiddenUpworkProposal(blob) ||
			assertsForbiddenRestartActionProposal(blob) ||
			assertsForbiddenSettingsZoomProposal(blob)
		) {
			rejected.push(`${item.id}: epistemic rejection`);
			continue;
		}
		if (item.proposedCall && !isValidProposedCallShape(item.proposedCall)) {
			rejected.push(`${item.id}: invalid proposed call shape`);
			continue;
		}
		if (item.landing && item.landing.finalizedForApply !== false) {
			downgraded.push(`${item.id}: landing must not be finalized`);
			kept.push({
				...item,
				landing: { ...item.landing, finalizedForApply: false },
				status: item.status === "proposal_ready" ? "provisional" : item.status,
			});
			continue;
		}
		if (item.status === "proposal_ready" && item.preservationViolationRisk === "blocking") {
			downgraded.push(`${item.id}: blocking preservation`);
			kept.push({
				...item,
				status: "no_safe_proposal",
				proposedCall: undefined,
				rejectionReason: "Preservation blocking — proposal withdrawn.",
			});
			continue;
		}

		kept.push({
			...item,
			intent: sanitizeProposalProse(item.intent),
			evidenceJustification: sanitizeProposalProse(item.evidenceJustification),
			constraints: item.constraints.map(sanitizeProposalProse),
			damageRisks: item.damageRisks.map((d) => ({
				...d,
				description: sanitizeProposalProse(d.description),
				mitigation: d.mitigation ? sanitizeProposalProse(d.mitigation) : undefined,
			})),
		});
	}

	const out: EditProposalV1 = {
		...proposal,
		providerId: EDIT_PROPOSAL_V1_PROVIDER_ID,
		summary: sanitizeProposalProse(proposal.summary),
		proposals: kept.slice(0, 16),
		metrics: {
			...proposal.metrics,
			proposalsGenerated: kept.length,
			additionalModelCalls: 0,
			providerId: EDIT_PROPOSAL_V1_PROVIDER_ID,
			serializedBytesApprox: 0,
		},
		quality: {
			...proposal.quality,
			proposalCount: kept.length,
			proposalReadyCount: kept.filter((p) => p.status === "proposal_ready").length,
			noSafeProposalCount: kept.filter((p) => p.status === "no_safe_proposal").length,
			provisionalCount: kept.filter((p) => p.status === "provisional").length,
			needsMoreEvidenceCount: kept.filter((p) => p.status === "needs_more_evidence").length,
			unsupportedCount: kept.filter((p) => p.status === "unsupported").length,
		},
	};
	out.metrics.serializedBytesApprox = JSON.stringify(out).length;
	return { proposal: out, rejected, downgraded };
}

export function evaluateEditProposalRubric(p: EditProposalV1): EditProposalQualityRubric {
	const blob = JSON.stringify(p);
	const notes: string[] = [];
	const evidenceGrounding = p.proposals.every(
		(x) => x.evidenceRefs.length > 0 || x.status === "no_safe_proposal",
	);
	const landingPrecision = p.proposals.every(
		(x) =>
			!x.landing ||
			(x.landing.finalizedForApply === false &&
				x.landing.endSourceTimeSec > x.landing.startSourceTimeSec),
	);
	const preservationSafety = p.proposals.every(
		(x) => x.status !== "proposal_ready" || x.preservationViolationRisk !== "blocking",
	);
	const damageAwareness = p.proposals.every(
		(x) => x.damageRisks.length > 0 || x.status === "no_safe_proposal",
	);
	if (!evidenceGrounding) notes.push("weak evidence refs");

	return {
		evidenceGrounding,
		landingPrecision,
		preservationSafety,
		damageAwareness,
		noExecutionLeakage: !leaksExecution(blob),
		epistemicHonesty:
			!assertsForbiddenUpworkProposal(blob) &&
			!assertsForbiddenRestartActionProposal(blob) &&
			!assertsForbiddenSettingsZoomProposal(blob),
		feasibilityHonesty: p.proposals.every(
			(x) => !(x.status === "proposal_ready" && x.proposedCall?.status !== "proposal_only"),
		),
		compactness: p.proposals.length <= 16,
		notes,
	};
}
