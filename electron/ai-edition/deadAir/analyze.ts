/**
 * End-to-end local dead-air analysis (detect → classify → candidates).
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { SpeechEvidence } from "../speechEvidence/types";
import type { TemporalEventLedger } from "../temporalEventLedger/types";
import type { VisualChange } from "../visualEvidence/types";
import {
	buildDeadAirCandidate,
	resetDeadAirCandidateSeqForTests,
	resolveSpeechWindows,
} from "./classify";
import { DEFAULT_DEAD_AIR_POLICY, type DeadAirPolicyConfig } from "./config";
import { detectSilenceIntervals } from "./detect";
import { filterCandidatesByProgrammeMapping } from "./programmeMap";
import type { DeadAirAnalysisBundle } from "./types";
import { LOCAL_DEAD_AIR_V1_PROVIDER_ID } from "./types";
import type { CachedOcrObservation } from "./visualSafety";

export interface AnalyzeDeadAirArgs {
	assetId: string;
	mediaPath: string;
	document?: AxcutDocument | null;
	speechEvidence?: SpeechEvidence | null;
	policy?: DeadAirPolicyConfig;
	signal?: AbortSignal;
	bypassCache?: boolean;
	cacheDir?: string;
	resetCandidateIds?: boolean;
	/** Prefer reuse — Bug-3 / prepared visual changes. */
	preparedChanges?: VisualChange[] | null;
	ledger?: TemporalEventLedger | null;
	ocrObservations?: CachedOcrObservation[] | null;
	forceSkipFfmpegVisualFallback?: boolean;
}

export async function analyzeDeadAir(args: AnalyzeDeadAirArgs): Promise<DeadAirAnalysisBundle> {
	if (args.resetCandidateIds) resetDeadAirCandidateSeqForTests();
	const policy = args.policy ?? DEFAULT_DEAD_AIR_POLICY;
	const tClassify0 = Date.now();

	const detector = await detectSilenceIntervals({
		assetId: args.assetId,
		mediaPath: args.mediaPath,
		policy,
		signal: args.signal,
		bypassCache: args.bypassCache,
		cacheDir: args.cacheDir,
	});

	const speechWindows = resolveSpeechWindows({
		document: args.document,
		assetId: args.assetId,
		speechEvidence: args.speechEvidence,
	});

	const existingTrims = args.document?.timeline.trimRanges ?? [];
	const rawCandidates = [];
	for (const interval of detector.intervals) {
		rawCandidates.push(
			await buildDeadAirCandidate({
				assetId: args.assetId,
				mediaPath: args.mediaPath,
				interval,
				durationSec: detector.durationSec,
				speechWindows,
				document: args.document,
				existingTrims,
				policy,
				preparedChanges: args.preparedChanges,
				ledger: args.ledger,
				ocrObservations: args.ocrObservations,
				forceSkipFfmpegVisualFallback: args.forceSkipFfmpegVisualFallback,
			}),
		);
	}

	const tRemap0 = Date.now();
	const candidates = args.document
		? filterCandidatesByProgrammeMapping(args.document, rawCandidates)
		: rawCandidates;
	const programmeRemapMs = Date.now() - tRemap0;
	const classifyMs = Date.now() - tClassify0;

	const safeCandidateCount = candidates.filter((c) => c.safeToPropose).length;

	return {
		version: 1,
		providerId: LOCAL_DEAD_AIR_V1_PROVIDER_ID,
		detector,
		candidates,
		metrics: {
			silenceIntervalCount: detector.intervals.length,
			candidateCount: candidates.length,
			safeCandidateCount,
			blockedCandidateCount: candidates.length - safeCandidateCount,
			classifyMs,
			programmeRemapMs,
		},
	};
}
