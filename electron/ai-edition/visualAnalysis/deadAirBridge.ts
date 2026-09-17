/**
 * Adapter: VisualAnalysisV1 → Dead-Air visual safety inputs.
 * Prefer canonical analysis over per-silence FFmpeg re-decode.
 */

import type { VisualActivityHit } from "../deadAir/types";
import type { VisualActivityAssessment } from "../deadAir/visualActivityTypes";
import type { VisualSafetyPolicy } from "../deadAir/visualPolicy";
import type { AssessVisualActivityArgs, CachedOcrObservation } from "../deadAir/visualSafety";
import { assessVisualActivity } from "../deadAir/visualSafety";
import type { TemporalEventLedger } from "../temporalEventLedger/types";
import type { VisualChange } from "../visualEvidence/types";
import type { VisualAnalysisV1, VisualChangeEvent } from "./types";

export function changeEventsToPreparedChanges(events: VisualChangeEvent[]): VisualChange[] {
	return events.map((e) => ({
		fromSourceTimeSec: e.fromSec,
		toSourceTimeSec: e.toSec,
		score: e.magnitude,
		classification:
			e.level === "SIGNIFICANT" ? "significant" : e.level === "MODERATE" ? "moderate" : "minimal",
	}));
}

export function analysisCoversSilence(
	analysis: VisualAnalysisV1,
	silenceStartSec: number,
	silenceEndSec: number,
): boolean {
	const c = analysis.analysisCoverage;
	return c.startSec <= silenceStartSec + 1e-3 && c.endSec >= silenceEndSec - 1e-3;
}

/**
 * Assess dead-air visual safety using a precomputed VisualAnalysisV1.
 * Skips FFmpeg fallback when analysis covers the silence window.
 */
export async function assessVisualActivityFromAnalysis(args: {
	analysis: VisualAnalysisV1;
	silenceStartSec: number;
	silenceEndSec: number;
	proposedTrimStartSec?: number | null;
	proposedTrimEndSec?: number | null;
	ledger?: TemporalEventLedger | null;
	ocrObservations?: CachedOcrObservation[] | null;
	policy?: VisualSafetyPolicy;
	injectedHits?: VisualActivityHit[] | null;
	candidateWouldBeSpeechSafe?: boolean;
}): Promise<VisualActivityAssessment> {
	const prepared = changeEventsToPreparedChanges(args.analysis.changeEvents);
	const covers = analysisCoversSilence(args.analysis, args.silenceStartSec, args.silenceEndSec);

	const assessArgs: AssessVisualActivityArgs = {
		mediaPath: args.analysis.mediaPath,
		silenceStartSec: args.silenceStartSec,
		silenceEndSec: args.silenceEndSec,
		proposedTrimStartSec: args.proposedTrimStartSec,
		proposedTrimEndSec: args.proposedTrimEndSec,
		preparedChanges: prepared,
		ledger: args.ledger,
		ocrObservations: args.ocrObservations,
		policy: args.policy,
		injectedHits: args.injectedHits,
		candidateWouldBeSpeechSafe: args.candidateWouldBeSpeechSafe,
		/** Canonical analysis already ran scene/black/freeze for coverage. */
		forceSkipFfmpegFallback: covers,
		visualAnalysis: args.analysis,
	};

	return assessVisualActivity(assessArgs);
}
