/**
 * Build typed Source Story V2 evidence input from existing layers.
 * References IDs — does not copy full evidence payloads.
 */

import type { ClaimPromotionSet, PromotedClaim } from "../../claimPromotion/types";
import type { SpeechEvidence } from "../../speechEvidence/types";
import type { TemporalEventLedger } from "../../temporalEventLedger/types";
import type { InvestigationEvidenceSet } from "../../videoInvestigator/types";
import type { VisualChange, VisualEvidenceFrame } from "../../visualEvidence/types";
import type { SourceStoryClaimRef, SourceStoryEpistemic, SourceStoryEvidenceInput } from "./types";

function mapEpistemic(status: string): SourceStoryEpistemic | string {
	const s = status.toLowerCase();
	if (
		s === "observed" ||
		s === "spoken" ||
		s === "supported" ||
		s === "verified" ||
		s === "contradicted" ||
		s === "unknown"
	) {
		return s;
	}
	if (s === "inferred") return "unknown";
	return status;
}

function claimRef(c: PromotedClaim): SourceStoryClaimRef {
	return {
		id: c.id,
		kind: c.kind,
		text: c.text,
		subject: c.subject,
		status: mapEpistemic(c.status),
		verificationLevel: c.verificationLevel,
		isActionClaim: c.isActionClaim,
		startSourceTimeSec: c.startSourceTimeSec,
		endSourceTimeSec: c.endSourceTimeSec,
		evidenceIds: c.provenance.map((p) => p.evidenceId),
	};
}

function partitionClaims(set: ClaimPromotionSet | null | undefined): {
	promoted: SourceStoryClaimRef[];
	unresolved: SourceStoryClaimRef[];
	contradictions: SourceStoryClaimRef[];
} {
	const promoted: SourceStoryClaimRef[] = [];
	const unresolved: SourceStoryClaimRef[] = [];
	const contradictions: SourceStoryClaimRef[] = [];
	if (!set) return { promoted, unresolved, contradictions };

	for (const c of set.claims) {
		const ref = claimRef(c);
		if (c.status === "contradicted") {
			contradictions.push(ref);
			continue;
		}
		if (c.isActionClaim && c.status !== "verified") {
			unresolved.push(ref);
			continue;
		}
		if (
			c.status === "supported" ||
			c.status === "verified" ||
			c.status === "observed" ||
			c.status === "spoken"
		) {
			promoted.push(ref);
			continue;
		}
		unresolved.push(ref);
	}
	return { promoted, unresolved, contradictions };
}

export function buildSourceStoryEvidenceInput(input: {
	assetId: string;
	sourceDurationSec: number;
	speechEvidence?: SpeechEvidence | null;
	frames?: VisualEvidenceFrame[];
	changes?: VisualChange[];
	cursorEventTimes?: number[];
	ledger?: TemporalEventLedger | null;
	claimPromotion?: ClaimPromotionSet | null;
	investigation?: InvestigationEvidenceSet | null;
}): SourceStoryEvidenceInput {
	const t0 = performance.now();
	const { promoted, unresolved, contradictions } = partitionClaims(input.claimPromotion);

	const speechStatus =
		input.speechEvidence?.status ?? (input.speechEvidence ? "available" : "not_requested");

	const speechSegments = (input.speechEvidence?.segments ?? [])
		.filter((s) => s.text.trim())
		.map((s, i) => ({
			id: `s${i + 1}`,
			startSourceTimeSec: s.startSourceTimeSec,
			endSourceTimeSec: s.endSourceTimeSec,
			text: s.text.trim(),
		}));

	const ledgerEvents =
		input.ledger?.events.map((e) => ({
			id: e.id,
			type: e.type,
			summary: e.summary.slice(0, 200),
			startSourceTimeSec: e.startSourceTimeSec,
			endSourceTimeSec: e.endSourceTimeSec,
		})) ?? [];

	const visualTimes = (input.frames ?? []).map((f) => f.sourceTimeSec);
	const visualChanges = (input.changes ?? [])
		.filter((c) => c.classification !== "minimal")
		.map((c) => ({
			fromSourceTimeSec: c.fromSourceTimeSec,
			toSourceTimeSec: c.toSourceTimeSec,
			classification: c.classification,
		}));

	const investigation = input.investigation
		? {
				observationIds: input.investigation.observations.map((o) => o.id),
				claimIds: input.investigation.claims.map((c) => c.id),
				focusStart: input.investigation.focusRange.startSourceTimeSec,
				focusEnd: input.investigation.focusRange.endSourceTimeSec,
				stopReason: input.investigation.stopReason,
			}
		: null;

	return {
		version: 2,
		assetId: input.assetId,
		sourceDurationSec: input.sourceDurationSec,
		speechStatus,
		promotedClaims: promoted.slice(0, 64),
		unresolvedClaims: unresolved.slice(0, 64),
		contradictions: contradictions.slice(0, 32),
		ledgerEvents: ledgerEvents.slice(0, 128),
		speechSegments,
		visualTimes,
		visualChanges,
		cursorEventTimes: input.cursorEventTimes ?? [],
		investigation,
		metrics: {
			promotedCount: promoted.length,
			unresolvedCount: unresolved.length,
			contradictionCount: contradictions.length,
			ledgerEventCount: ledgerEvents.length,
			investigationObservationCount: investigation?.observationIds.length ?? 0,
			buildMs: performance.now() - t0,
			additionalModelCalls: 0,
		},
	};
}
