/**
 * Bounded editorial reasoning pipeline.
 * Packet → provider → validate → reconcile → reasoned set.
 * Fallback to deterministic on failure. Never paid. Never auto-mutates.
 */

import type {
	EditorialRecommendationSetV1,
	EditorialRecommendationV1,
	UnresolvedEditorialQuestionV1,
} from "../editorialOrchestration/types";
import type { TemporalContextStore } from "../temporalContextStore/store";
import { createDeterministicEditorialReasoningProvider } from "./deterministicProvider";
import { normalizeEditorialGoal } from "./goals";
import { CORE_EDITORIAL_INVARIANTS, INVARIANT_CHAR_COUNT } from "./invariants";
import { reconcileReasonedRecommendations } from "./reconcile";
import type {
	EditorialGoalKind,
	EditorialReasoningProviderV1,
	EditorialReasoningRequestV1,
	EditorialReasoningResponseV1,
	ReasonedEditorialRecommendationSetV1,
} from "./types";
import { EDITORIAL_REASONING_POLICY_VERSION } from "./types";
import { validateEditorialReasoningResponseV1 } from "./validate";

export interface RunBoundedEditorialReasoningArgs {
	store: TemporalContextStore;
	orchestrationSet: EditorialRecommendationSetV1;
	goalText?: string;
	goal?: EditorialGoalKind;
	provider?: EditorialReasoningProviderV1;
	maxDecisions?: number;
	detailLevel?: "SUMMARY" | "STANDARD" | "DETAILED";
	requestedRange?: { startSec: number; endSec: number };
	followUp?: EditorialReasoningRequestV1["followUp"];
	requestId?: string;
}

export interface RunBoundedEditorialReasoningResult {
	request: EditorialReasoningRequestV1;
	rawResponse: EditorialReasoningResponseV1;
	validated: boolean;
	validationErrors: string[];
	finalSet: ReasonedEditorialRecommendationSetV1;
	fallbackUsed: boolean;
}

function buildRequest(args: RunBoundedEditorialReasoningArgs): EditorialReasoningRequestV1 {
	const goal =
		args.goal ?? (args.goalText ? normalizeEditorialGoal(args.goalText).goal : "MAKE_PROFESSIONAL");
	const packet = args.store.buildTemporalReasoningPacketV1({
		detailLevel: args.detailLevel ?? (args.requestedRange ? "DETAILED" : "STANDARD"),
		requestedRange: args.requestedRange,
	});
	const knownEvidenceIds = args.store.allRecords().map((r) => r.id);
	// Also allow packet brief ids
	for (const x of [
		...packet.speech,
		...packet.visual,
		...packet.focalTargets,
		...packet.protectedRanges,
		...packet.findings,
		...packet.recommendations,
		...packet.unresolvedQuestions,
		...packet.currentEdits,
	]) {
		if (!knownEvidenceIds.includes(x.id)) knownEvidenceIds.push(x.id);
	}
	for (const id of packet.audio.recordIds) {
		if (!knownEvidenceIds.includes(id)) knownEvidenceIds.push(id);
	}
	// Orchestration entity ids + detector evidence ids (aliases for binding)
	for (const r of args.orchestrationSet.recommendations) {
		if (!knownEvidenceIds.includes(r.id)) knownEvidenceIds.push(r.id);
		for (const fid of r.findingIds) {
			if (!knownEvidenceIds.includes(fid)) knownEvidenceIds.push(fid);
		}
		for (const e of r.evidenceRefs) {
			if (!knownEvidenceIds.includes(e.id)) knownEvidenceIds.push(e.id);
		}
	}
	for (const f of args.orchestrationSet.findings) {
		if (!knownEvidenceIds.includes(f.id)) knownEvidenceIds.push(f.id);
	}
	for (const q of args.orchestrationSet.unresolvedQuestions) {
		if (!knownEvidenceIds.includes(q.id)) knownEvidenceIds.push(q.id);
		for (const fid of q.relatedFindingIds ?? []) {
			if (!knownEvidenceIds.includes(fid)) knownEvidenceIds.push(fid);
		}
	}
	for (const p of args.orchestrationSet.preservedRanges) {
		if (!knownEvidenceIds.includes(p.id)) knownEvidenceIds.push(p.id);
	}

	return {
		requestId: args.requestId ?? `req_${Date.now()}`,
		goal,
		goalText: args.goalText,
		packet,
		currentRecommendations: args.orchestrationSet.recommendations,
		unresolvedQuestions: args.orchestrationSet.unresolvedQuestions,
		constraints: [
			"preservation_wins",
			"no_invented_geometry",
			"do_nothing_valid",
			"no_mutation_tools",
		],
		allowedDecisionFamilies: ["TRIM", "ZOOM", "CROP", "SPEED", "CAPTIONS", "LOUDNESS", "NONE"],
		maxDecisions: args.maxDecisions ?? 3,
		reasoningPolicyVersion: EDITORIAL_REASONING_POLICY_VERSION,
		knownEvidenceIds,
		coverage: packet.evidenceCoverage,
		followUp: args.followUp,
	};
}

export async function runBoundedEditorialReasoning(
	args: RunBoundedEditorialReasoningArgs,
): Promise<RunBoundedEditorialReasoningResult> {
	const request = buildRequest(args);
	const deterministic = createDeterministicEditorialReasoningProvider();
	const provider = args.provider ?? deterministic;
	let fallbackUsed = false;
	let rawResponse: EditorialReasoningResponseV1;
	let validationErrors: string[] = [];

	try {
		rawResponse = await provider.reason(request);
	} catch (err) {
		fallbackUsed = true;
		rawResponse = await deterministic.reason(request);
		rawResponse.providerMetadata.fallbackUsed = true;
		rawResponse.providerMetadata.fallbackReason =
			err instanceof Error ? err.message : "provider_unavailable";
	}

	let validation = validateEditorialReasoningResponseV1(request, rawResponse);
	if (!validation.ok) {
		validationErrors = validation.errors;
		fallbackUsed = true;
		rawResponse = await deterministic.reason(request);
		rawResponse.providerMetadata.fallbackUsed = true;
		rawResponse.providerMetadata.fallbackReason = `validation_failed: ${validation.errors.join("; ")}`;
		validation = validateEditorialReasoningResponseV1(request, rawResponse);
		validationErrors = validation.ok
			? validationErrors
			: [...validationErrors, ...validation.errors];
	}

	const rejected: string[] = [];
	if (!validation.ok && validation.sanitized) {
		const okIds = new Set(validation.sanitized.decisions.map((d) => d.id));
		for (const d of rawResponse.decisions) {
			if (!okIds.has(d.id)) rejected.push(d.id);
		}
		rawResponse = validation.sanitized;
	}

	const finalSet = reconcileReasonedRecommendations({
		request,
		response: rawResponse,
		rejectedDecisionIds: rejected,
		validationReasons: validationErrors,
		accepted: validation.ok || fallbackUsed,
	});

	finalSet.metrics.invariantChars = INVARIANT_CHAR_COUNT;
	void CORE_EDITORIAL_INVARIANTS;

	return {
		request,
		rawResponse,
		validated: validation.ok,
		validationErrors,
		finalSet,
		fallbackUsed,
	};
}

/** Helper: map reasoned set back toward orchestration-like rec list for review. */
export function reasonedRecommendationsOnly(
	set: ReasonedEditorialRecommendationSetV1,
): EditorialRecommendationV1[] {
	return set.recommendations;
}

export function reasonedQuestionsOnly(
	set: ReasonedEditorialRecommendationSetV1,
): UnresolvedEditorialQuestionV1[] {
	return set.unresolvedQuestions;
}
