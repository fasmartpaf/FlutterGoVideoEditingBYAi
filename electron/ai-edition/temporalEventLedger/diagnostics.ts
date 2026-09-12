/**
 * Ledger diagnostics for benchmarks / developer tooling.
 * Never dump this into normal user-facing AI responses.
 * Does not read ground truth into production evidence.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createVideoEvidenceStore } from "./store";
import type { TemporalEventLedger } from "./types";

export interface LedgerDiagnosticSummary {
	assetId: string;
	sourceDurationSec: number;
	timebase: "SOURCE_MEDIA_TIME";
	speechStatus?: string;
	constructionMs: number;
	additionalModelCalls: 0;
	eventCount: number;
	claimCount: number;
	evidenceRefCount: number;
	serializedBytesApprox: number;
	byType: Record<string, number>;
	byEpistemic: Record<string, number>;
	contradictionCount: number;
	unknownClaimCount: number;
	events: Array<{
		id: string;
		type: string;
		startSourceTimeSec: number;
		endSourceTimeSec: number;
		temporallyUncertain?: boolean;
		summary: string;
		claims: Array<{ epistemic: string; text: string }>;
		evidenceModalities: string[];
	}>;
}

/** Compact inspectable view for tmp/perception-benchmark diagnostics. */
export function summarizeLedgerForDiagnostics(
	ledger: TemporalEventLedger,
): LedgerDiagnosticSummary {
	const store = createVideoEvidenceStore(ledger);
	const byType: Record<string, number> = {};
	const byEpistemic: Record<string, number> = {};
	let unknownClaimCount = 0;
	for (const e of ledger.events) {
		byType[e.type] = (byType[e.type] ?? 0) + 1;
		for (const c of e.claims) {
			byEpistemic[c.epistemic] = (byEpistemic[c.epistemic] ?? 0) + 1;
			if (c.epistemic === "unknown") unknownClaimCount += 1;
		}
	}
	return {
		assetId: ledger.meta.assetId,
		sourceDurationSec: ledger.meta.sourceDurationSec,
		timebase: "SOURCE_MEDIA_TIME",
		speechStatus: ledger.meta.speechStatus,
		constructionMs: ledger.meta.constructionMs,
		additionalModelCalls: 0,
		eventCount: ledger.meta.eventCount,
		claimCount: ledger.meta.claimCount,
		evidenceRefCount: ledger.meta.evidenceRefCount,
		serializedBytesApprox: store.stats().serializedBytesApprox,
		byType,
		byEpistemic,
		contradictionCount: store.eventsByType("contradiction").length,
		unknownClaimCount,
		events: ledger.events.map((e) => ({
			id: e.id,
			type: e.type,
			startSourceTimeSec: e.startSourceTimeSec,
			endSourceTimeSec: e.endSourceTimeSec,
			temporallyUncertain: e.temporallyUncertain,
			summary: e.summary,
			claims: e.claims.map((c) => ({ epistemic: c.epistemic, text: c.text })),
			evidenceModalities: [...new Set(e.evidence.map((r) => r.modality))],
		})),
	};
}

export function writeLedgerDiagnosticArtifact(
	outDir: string,
	caseId: string,
	ledger: TemporalEventLedger,
): string {
	mkdirSync(outDir, { recursive: true });
	const file = path.join(outDir, `${caseId}.temporal-ledger.json`);
	writeFileSync(file, JSON.stringify(summarizeLedgerForDiagnostics(ledger), null, 2), "utf8");
	return file;
}
