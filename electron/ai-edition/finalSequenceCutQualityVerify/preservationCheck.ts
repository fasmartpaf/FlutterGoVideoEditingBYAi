/**
 * Preservation around joins — UNKNOWN when evidence not supplied (never invent PASS).
 */

import type { JoinModalityResult, ProgrammeJoinV1, TimeRangeSec } from "./types";

export interface PreservationEvidence {
	mustSurvive: Array<{ id: string; sourceRange: TimeRangeSec; reason?: string }>;
}

function overlaps(a: TimeRangeSec, b: TimeRangeSec): boolean {
	return a.startSec < b.endSec && b.startSec < a.endSec;
}

export function verifyJoinPreservation(args: {
	join: ProgrammeJoinV1;
	evidence?: PreservationEvidence | null;
}): JoinModalityResult {
	const t0 = Date.now();
	if (!args.evidence) {
		return {
			outcome: "UNKNOWN",
			blockingReasons: [],
			warnings: ["preservation_evidence_unavailable"],
			evidenceRefs: [],
			notes: ["UNKNOWN_not_PASS"],
			latencyMs: Date.now() - t0,
		};
	}

	const blocking: string[] = [];
	const warnings: string[] = [];
	const evidenceRefs: string[] = [];

	if (args.join.cause === "TRIM_CREATED") {
		const removed: TimeRangeSec = {
			startSec: args.join.leftSourceRange.endSec,
			endSec: args.join.rightSourceRange.startSec,
		};
		for (const m of args.evidence.mustSurvive) {
			evidenceRefs.push(`preserve:${m.id}`);
			if (overlaps(m.sourceRange, removed)) {
				const fullyInside =
					m.sourceRange.startSec >= removed.startSec && m.sourceRange.endSec <= removed.endSec;
				if (fullyInside) {
					blocking.push(`must_survive_removed:${m.id}`);
				} else {
					warnings.push(`must_survive_touches_removed:${m.id}`);
				}
			}
		}
	}

	return {
		outcome: blocking.length > 0 ? "FAIL" : warnings.length > 0 ? "WARNING" : "PASS",
		blockingReasons: blocking,
		warnings,
		evidenceRefs,
		notes: [],
		latencyMs: Date.now() - t0,
		metrics: { mustSurviveCount: args.evidence.mustSurvive.length },
	};
}
