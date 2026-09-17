/**
 * Reconcile reasoner decisions with deterministic recommendation set.
 * Deterministic safety wins.
 */

import type {
	EditorialRecommendationV1,
	UnresolvedEditorialQuestionV1,
} from "../editorialOrchestration/types";
import { INVARIANT_CHAR_COUNT } from "./invariants";
import type {
	EditorialDecisionV1,
	EditorialReasoningRequestV1,
	EditorialReasoningResponseV1,
	ReasonedEditorialRecommendationSetV1,
} from "./types";
import { BOUNDED_EDITORIAL_REASONING_V1_PROVIDER_ID } from "./types";

export function reconcileReasonedRecommendations(args: {
	request: EditorialReasoningRequestV1;
	response: EditorialReasoningResponseV1;
	rejectedDecisionIds: string[];
	validationReasons: string[];
	accepted: boolean;
}): ReasonedEditorialRecommendationSetV1 {
	const { request, response } = args;
	const byId = new Map(request.currentRecommendations.map((r) => [r.id, r]));
	const out: EditorialRecommendationV1[] = [];
	const keptDecisions: EditorialDecisionV1[] = [];

	for (const d of response.decisions) {
		if (args.rejectedDecisionIds.includes(d.id)) continue;
		keptDecisions.push(d);
		if (d.decision === "INCLUDE" || d.decision === "OPTIONAL") {
			const rec = d.recommendationId ? byId.get(d.recommendationId) : undefined;
			if (!rec) continue;
			// Hard blocks
			if (rec.recommendationStatus === "DO_NOT_RECOMMEND") continue;
			if (rec.executionReadiness === "UNSUPPORTED") continue;
			if (
				(rec.operationFamily === "ZOOM" ||
					rec.operationFamily === "CROP" ||
					rec.operationFamily === "SPEED") &&
				(rec.executionReadiness === "MISSING_ARGS" || rec.missingParameters.length > 0)
			) {
				continue;
			}
			// Preservation overlap for TRIM
			if (rec.operationFamily === "TRIM" && rec.sourceRange) {
				const blocked = request.packet.protectedRanges.some((p) => {
					if (!p.sourceRange) return false;
					return (
						rec.sourceRange!.startSec < p.sourceRange.endSec &&
						p.sourceRange.startSec < rec.sourceRange!.endSec
					);
				});
				if (blocked) continue;
			}
			const next: EditorialRecommendationV1 = {
				...rec,
				recommendationStatus: d.decision === "OPTIONAL" ? "OPTIONAL" : "RECOMMEND",
				rationale: `${rec.rationale} | reasoner: ${d.rationale}`,
			};
			out.push(next);
		}
	}

	// Dedup by id, respect maxDecisions
	const seen = new Set<string>();
	const surfaced: EditorialRecommendationV1[] = [];
	for (const r of out) {
		if (seen.has(r.id)) continue;
		seen.add(r.id);
		surfaced.push(r);
		if (surfaced.length >= request.maxDecisions) break;
	}

	const questions: UnresolvedEditorialQuestionV1[] = [
		...request.unresolvedQuestions,
		...response.questions.map((q) => ({
			id: q.id,
			text: q.text,
			relatedFindingIds: q.evidenceRefs,
			reason: "reasoner_ask_user",
		})),
	];

	const hasAction = surfaced.length > 0;
	const hasAsk = keptDecisions.some((d) => d.decision === "ASK_USER");
	const status = hasAction
		? "ACTIONS_AVAILABLE"
		: hasAsk
			? "NEEDS_HUMAN_JUDGMENT"
			: "NO_ACTION_RECOMMENDED";

	return {
		version: 1,
		providerId: BOUNDED_EDITORIAL_REASONING_V1_PROVIDER_ID,
		goal: request.goal,
		requestId: request.requestId,
		recommendations: surfaced,
		decisions: keptDecisions,
		unresolvedQuestions: questions,
		preserve: response.preserve,
		summary: response.summary,
		status,
		validation: {
			accepted: args.accepted,
			rejectedDecisionIds: args.rejectedDecisionIds,
			reasons: args.validationReasons,
		},
		metrics: {
			inputChars: response.providerMetadata.inputChars,
			outputChars: response.providerMetadata.outputChars,
			invariantChars: INVARIANT_CHAR_COUNT,
			packetChars: JSON.stringify(request.packet).length,
			requestChars: JSON.stringify({
				goal: request.goal,
				maxDecisions: request.maxDecisions,
			}).length,
			latencyMs: response.providerMetadata.latencyMs,
			providerKind: response.providerMetadata.kind,
			additionalModelCalls: response.providerMetadata.kind === "DETERMINISTIC" ? 0 : 1,
			paidAiCalls: 0,
			autoMutations: 0,
		},
	};
}
