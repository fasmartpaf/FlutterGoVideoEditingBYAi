/**
 * DeterministicEditorialReasoningProviderV1 — contract baseline / regression oracle.
 * Zero model calls. Goal-aware selection over existing recommendations.
 */

import type { EditorialRecommendationV1 } from "../editorialOrchestration/types";
import type {
	EditorialDecisionV1,
	EditorialReasoningProviderV1,
	EditorialReasoningRequestV1,
	EditorialReasoningResponseV1,
} from "./types";

let seq = 0;
function did(prefix: string): string {
	seq += 1;
	return `dec_${prefix}_${seq}`;
}

export function resetDeterministicReasoningSeqForTests(): void {
	seq = 0;
}

function pickEvidence(req: EditorialReasoningRequestV1, rec: EditorialRecommendationV1): string[] {
	const known = new Set(req.knownEvidenceIds);
	const refs: string[] = [];
	const consider = (id: string | undefined) => {
		if (id && known.has(id) && !refs.includes(id)) refs.push(id);
	};
	consider(rec.id);
	for (const fid of rec.findingIds) consider(fid);
	for (const e of rec.evidenceRefs) consider(e.id);
	if (refs.length === 0) {
		for (const id of req.knownEvidenceIds) {
			refs.push(id);
			if (refs.length >= 2) break;
		}
	}
	return refs.slice(0, 4);
}

/**
 * Goal policies:
 * MAKE_PROFESSIONAL — include safe trim+loudness; captions OPTIONAL; exclude unsupported
 * MAKE_TIGHTER — prioritize TRIM; exclude loudness/captions unless accessibility
 * IMPROVE_ACCESSIBILITY — prioritize CAPTIONS INCLUDE; others optional/exclude
 * IMPROVE_CLARITY — loudness + trim; captions optional
 * CUSTOM_TEXT — conservative: keep OPTIONAL/RECOMMEND as OPTIONAL/INCLUDE lightly
 */
export function createDeterministicEditorialReasoningProvider(): EditorialReasoningProviderV1 {
	return {
		id: "deterministic-editorial-reasoning-v1",
		kind: "DETERMINISTIC",
		capabilities: {
			structuredText: true,
			optionalImages: false,
			streamingOptional: false,
			schemaConstrainedOptional: true,
		},
		async reason(request): Promise<EditorialReasoningResponseV1> {
			const t0 = Date.now();
			const decisions: EditorialDecisionV1[] = [];
			const preserve: EditorialReasoningResponseV1["preserve"] = [];
			const questions: EditorialReasoningResponseV1["questions"] = [];

			for (const p of request.packet.protectedRanges) {
				preserve.push({
					id: p.id,
					reason: p.summary,
					evidenceRefs: [p.id],
				});
			}

			// Follow-up: explain selected recommendation
			if (request.followUp?.selectedRecommendationId || request.followUp?.question) {
				const rid = request.followUp.selectedRecommendationId;
				const rec = request.currentRecommendations.find((r) => r.id === rid);
				const refs = rec ? pickEvidence(request, rec) : request.knownEvidenceIds.slice(0, 2);
				decisions.push({
					id: did("follow"),
					recommendationId: rid,
					operationFamily: rec?.operationFamily ?? "NONE",
					decision: rec ? "INCLUDE" : "ASK_USER",
					rationale: rec
						? `This suggestion remains grounded in local evidence: ${rec.rationale}`
						: "No selected recommendation found in the current set.",
					evidenceRefs: refs.length ? refs : request.knownEvidenceIds.slice(0, 1),
					constraintRefs: [],
					confidence: "HIGH",
					requestedMissingInformation: [],
					executionReadiness: rec?.executionReadiness ?? "N/A",
				});
				const out: EditorialReasoningResponseV1 = {
					requestId: request.requestId,
					decisions,
					questions: [],
					preserve,
					summary: rec
						? `Explanation: ${rec.reviewCopy}`
						: "Unable to explain — selection missing.",
					confidence: "HIGH",
					evidenceRefs: refs,
					providerMetadata: {
						providerId: "deterministic-editorial-reasoning-v1",
						kind: "DETERMINISTIC",
						latencyMs: Date.now() - t0,
						inputChars: JSON.stringify(request).length,
						outputChars: 0,
					},
				};
				out.providerMetadata.outputChars = JSON.stringify(out).length;
				return out;
			}

			const goal = request.goal;
			let included = 0;

			for (const rec of request.currentRecommendations) {
				if (included >= request.maxDecisions) break;
				if (!request.allowedDecisionFamilies.includes(rec.operationFamily)) {
					decisions.push({
						id: did("excl"),
						recommendationId: rec.id,
						operationFamily: rec.operationFamily,
						decision: "EXCLUDE",
						rationale: "Operation family not allowed for this goal",
						evidenceRefs: pickEvidence(request, rec),
						constraintRefs: [],
						confidence: "HIGH",
						requestedMissingInformation: [],
						executionReadiness: rec.executionReadiness,
					});
					continue;
				}

				const refs = pickEvidence(request, rec);
				let decision: EditorialDecisionV1["decision"] = "EXCLUDE";
				let rationale = "Not selected for this goal";

				if (rec.operationFamily === "TRIM") {
					if (
						goal === "MAKE_PROFESSIONAL" ||
						goal === "MAKE_TIGHTER" ||
						goal === "IMPROVE_CLARITY"
					) {
						decision = "INCLUDE";
						rationale =
							goal === "MAKE_TIGHTER"
								? "Safe pause shorten improves pacing for a tighter cut"
								: "Safe awkward pause — meaningful polish without removing speech";
					} else if (goal === "IMPROVE_ACCESSIBILITY") {
						decision = "OPTIONAL";
						rationale = "Pacing optional when accessibility is the primary goal";
					} else {
						decision = "OPTIONAL";
						rationale = "Safe trim may help; leaving optional for custom goal";
					}
				} else if (rec.operationFamily === "LOUDNESS") {
					if (goal === "MAKE_TIGHTER") {
						decision = "EXCLUDE";
						rationale = "Loudness does not shorten the video";
					} else if (goal === "MAKE_PROFESSIONAL" || goal === "IMPROVE_CLARITY") {
						decision = "INCLUDE";
						rationale = "Safe loudness normalize improves professional playback consistency";
					} else if (goal === "IMPROVE_ACCESSIBILITY") {
						decision = "OPTIONAL";
						rationale = "Loudness optional for accessibility-focused request";
					} else {
						decision = "OPTIONAL";
						rationale = "Loudness optional for custom goal";
					}
				} else if (rec.operationFamily === "CAPTIONS") {
					if (goal === "IMPROVE_ACCESSIBILITY") {
						decision = "INCLUDE";
						rationale = "Captions directly serve accessibility";
					} else if (goal === "MAKE_TIGHTER") {
						decision = "EXCLUDE";
						rationale = "Captions do not shorten duration";
					} else if (goal === "MAKE_PROFESSIONAL") {
						decision = "OPTIONAL";
						rationale = "Captions can polish accessibility without being mandatory";
					} else {
						decision = "OPTIONAL";
						rationale = "Captions remain optional";
					}
				} else if (
					rec.operationFamily === "ZOOM" ||
					rec.operationFamily === "CROP" ||
					rec.operationFamily === "SPEED"
				) {
					if (rec.executionReadiness === "READY_TO_APPLY" && rec.missingParameters.length === 0) {
						decision =
							goal === "MAKE_PROFESSIONAL" || goal === "IMPROVE_CLARITY" ? "OPTIONAL" : "EXCLUDE";
						rationale = "Only when fully actionable; otherwise excluded";
					} else {
						decision = "ASK_USER";
						rationale = "Missing geometry/rate — cannot invent parameters";
					}
				} else {
					decision = "EXCLUDE";
					rationale = "Family not prioritized";
				}

				if (decision === "INCLUDE" || decision === "OPTIONAL") included += 1;

				decisions.push({
					id: did("goal"),
					recommendationId: rec.id,
					operationFamily: rec.operationFamily,
					decision,
					rationale,
					evidenceRefs: refs,
					constraintRefs: preserve.map((p) => p.id).slice(0, 2),
					confidence: rec.confidence,
					requestedMissingInformation: rec.missingParameters ?? [],
					executionReadiness: rec.executionReadiness,
				});
			}

			// Unresolved questions → ASK_USER (not edit cards)
			for (const q of request.unresolvedQuestions.slice(0, 3)) {
				const refs =
					q.relatedFindingIds?.length &&
					q.relatedFindingIds.some((id) => request.knownEvidenceIds.includes(id))
						? q.relatedFindingIds.filter((id) => request.knownEvidenceIds.includes(id))
						: request.packet.unresolvedQuestions
								.map((x) => x.id)
								.filter((id) => request.knownEvidenceIds.includes(id))
								.slice(0, 2);
				const evidenceRefs =
					refs.length > 0
						? refs
						: request.knownEvidenceIds
								.filter(
									(id) =>
										id.toLowerCase().includes("visual") ||
										id.toLowerCase().includes("question") ||
										id.toLowerCase().includes("activity"),
								)
								.slice(0, 2);
				questions.push({
					id: q.id,
					text: q.text,
					evidenceRefs:
						evidenceRefs.length > 0 ? evidenceRefs : request.knownEvidenceIds.slice(0, 1),
				});
				if (goal === "MAKE_PROFESSIONAL" || goal === "CUSTOM_TEXT") {
					decisions.push({
						id: did("ask"),
						decision: "ASK_USER",
						rationale: "Unresolved editorial ambiguity — do not invent an edit",
						evidenceRefs:
							evidenceRefs.length > 0 ? evidenceRefs : request.knownEvidenceIds.slice(0, 1),
						constraintRefs: [],
						confidence: "MEDIUM",
						requestedMissingInformation: ["user_judgment"],
						executionReadiness: "N/A",
					});
				}
			}

			if (
				decisions.length === 0 ||
				decisions.every((d) => d.decision === "EXCLUDE" || d.decision === "ASK_USER")
			) {
				const hasInclude = decisions.some(
					(d) => d.decision === "INCLUDE" || d.decision === "OPTIONAL",
				);
				if (!hasInclude) {
					decisions.push({
						id: did("noop"),
						decision: "NO_ACTION",
						operationFamily: "NONE",
						rationale:
							goal === "MAKE_TIGHTER"
								? "No safe pacing edits available for a shorter cut"
								: "No meaningful automatic improvements for this goal",
						evidenceRefs: request.knownEvidenceIds.slice(0, 2),
						constraintRefs: [],
						confidence: "HIGH",
						requestedMissingInformation: [],
						executionReadiness: "N/A",
					});
				}
			}

			// Cap decisions
			const capped = decisions.slice(0, Math.max(request.maxDecisions + 3, request.maxDecisions));

			const includedDec = capped.filter(
				(d) => d.decision === "INCLUDE" || d.decision === "OPTIONAL",
			);
			const summary =
				includedDec.length === 0
					? "No automatic edit recommendations for this goal."
					: `Selected ${includedDec.length} reviewable improvement${includedDec.length === 1 ? "" : "s"} for ${goal}.`;

			const out: EditorialReasoningResponseV1 = {
				requestId: request.requestId,
				decisions: capped,
				questions,
				preserve,
				summary,
				confidence: "HIGH",
				evidenceRefs: [...new Set(capped.flatMap((d) => d.evidenceRefs))],
				providerMetadata: {
					providerId: "deterministic-editorial-reasoning-v1",
					kind: "DETERMINISTIC",
					latencyMs: Date.now() - t0,
					inputChars: JSON.stringify(request).length,
					outputChars: 0,
				},
			};
			out.providerMetadata.outputChars = JSON.stringify(out).length;
			return out;
		},
	};
}
