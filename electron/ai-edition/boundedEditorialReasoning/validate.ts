/**
 * Strict validation of EditorialReasoningResponseV1.
 */

import type { OperationFamily } from "../editorialOrchestration/types";
import type {
	EditorialReasoningRequestV1,
	EditorialReasoningResponseV1,
	ValidationResult,
} from "./types";

const ALLOWED_ACTIONS = new Set(["INCLUDE", "EXCLUDE", "OPTIONAL", "ASK_USER", "NO_ACTION"]);

export function validateEditorialReasoningResponseV1(
	request: EditorialReasoningRequestV1,
	response: EditorialReasoningResponseV1,
): ValidationResult {
	const errors: string[] = [];
	if (response.requestId !== request.requestId) {
		errors.push("requestId mismatch");
	}
	if (!Array.isArray(response.decisions)) {
		errors.push("decisions must be an array");
		return { ok: false, errors };
	}

	const knownRec = new Set(request.currentRecommendations.map((r) => r.id));
	const knownEvidence = new Set(request.knownEvidenceIds);
	const allowedFamilies = new Set(request.allowedDecisionFamilies);
	const staleHint = new Set(
		request.packet.recommendations
			.filter((r) => r.summary.toLowerCase().includes("stale"))
			.map((r) => r.id),
	);

	const coverage = request.coverage;
	const sanitizedDecisions = [];

	for (const d of response.decisions) {
		if (!ALLOWED_ACTIONS.has(d.decision)) {
			errors.push(`invalid decision action: ${d.decision}`);
			continue;
		}
		if (!d.rationale || !d.rationale.trim()) {
			errors.push(`decision ${d.id}: empty rationale`);
			continue;
		}
		if (!d.evidenceRefs?.length) {
			errors.push(`decision ${d.id}: no evidenceRefs`);
			continue;
		}
		for (const ref of d.evidenceRefs) {
			if (!knownEvidence.has(ref)) {
				errors.push(`decision ${d.id}: unknown evidence id ${ref}`);
			}
		}
		if (d.recommendationId && !knownRec.has(d.recommendationId)) {
			errors.push(`decision ${d.id}: unknown recommendationId ${d.recommendationId}`);
		}
		if (d.recommendationId && staleHint.has(d.recommendationId)) {
			errors.push(`decision ${d.id}: stale recommendation`);
		}
		if (
			d.operationFamily &&
			d.operationFamily !== "NONE" &&
			!allowedFamilies.has(d.operationFamily as OperationFamily)
		) {
			errors.push(`decision ${d.id}: family not allowed ${d.operationFamily}`);
		}

		// Geometry honesty
		if (
			(d.decision === "INCLUDE" || d.decision === "OPTIONAL") &&
			(d.operationFamily === "ZOOM" ||
				d.operationFamily === "CROP" ||
				d.operationFamily === "SPEED")
		) {
			const rec = request.currentRecommendations.find((r) => r.id === d.recommendationId);
			if (
				!rec ||
				rec.executionReadiness === "MISSING_ARGS" ||
				(rec.missingParameters?.length ?? 0) > 0
			) {
				errors.push(
					`decision ${d.id}: cannot INCLUDE/OPTIONAL ${d.operationFamily} without actionable parameters`,
				);
				continue;
			}
		}

		// Coverage overclaim
		const text = `${d.rationale}`.toLowerCase();
		if (coverage.ocrCoverage === "NOT_AVAILABLE") {
			if (
				text.includes("ocr") ||
				text.includes("button text") ||
				text.includes("on-screen label reads")
			) {
				errors.push(`decision ${d.id}: OCR overclaim while OCR NOT_AVAILABLE`);
				continue;
			}
		}
		if (coverage.focalCoverage === "NOT_AVAILABLE" || coverage.focalCoverage === "PARTIAL") {
			if (
				(d.decision === "INCLUDE" || d.decision === "OPTIONAL") &&
				d.operationFamily === "ZOOM" &&
				!request.packet.focalTargets.length
			) {
				errors.push(`decision ${d.id}: zoom without focal targets`);
				continue;
			}
		}

		// Epistemic: don't claim "observed" for heuristic upgrades in rationale tags
		if (text.includes("visually observed that the effects panel")) {
			errors.push(`decision ${d.id}: hallucinated UI observation`);
			continue;
		}

		// Raw mutation payloads forbidden
		if (
			text.includes("addtrim(") ||
			text.includes('"toolname"') ||
			(d as { mutationPayload?: unknown }).mutationPayload
		) {
			errors.push(`decision ${d.id}: raw mutation payload forbidden`);
			continue;
		}

		sanitizedDecisions.push(d);
	}

	const includeCount = sanitizedDecisions.filter(
		(d) => d.decision === "INCLUDE" || d.decision === "OPTIONAL",
	).length;
	if (includeCount > request.maxDecisions) {
		errors.push(`exceeds maxDecisions (${request.maxDecisions})`);
	}

	// Preservation override attempt
	for (const d of sanitizedDecisions) {
		if (d.decision !== "INCLUDE" && d.decision !== "OPTIONAL") continue;
		const rec = request.currentRecommendations.find((r) => r.id === d.recommendationId);
		if (!rec?.sourceRange) continue;
		for (const p of request.packet.protectedRanges) {
			if (!p.sourceRange) continue;
			const overlaps =
				rec.sourceRange.startSec < p.sourceRange.endSec &&
				p.sourceRange.startSec < rec.sourceRange.endSec;
			if (overlaps && rec.operationFamily === "TRIM") {
				errors.push(`decision ${d.id}: cannot INCLUDE trim overlapping protected range ${p.id}`);
			}
		}
	}

	const ok = errors.length === 0;
	return {
		ok,
		errors,
		sanitized: ok
			? { ...response, decisions: sanitizedDecisions }
			: {
					...response,
					decisions: sanitizedDecisions,
				},
	};
}
