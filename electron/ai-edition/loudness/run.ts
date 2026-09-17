/**
 * End-to-end: analyze → candidate.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { analyzeLoudness } from "./analyze";
import { buildNormalizeCandidate, resetLoudnessCandidateSeqForTests } from "./candidate";
import { DEFAULT_LOUDNESS_TARGET_POLICY } from "./policy";
import type { AudioNormalizeCandidateV1, LoudnessAnalysisV1, LoudnessTargetPolicy } from "./types";
import { LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID } from "./types";

export interface RunLoudnessNormalizeAnalysisArgs {
	assetId: string;
	mediaPath: string;
	document?: AxcutDocument | null;
	policy?: LoudnessTargetPolicy;
	bypassCache?: boolean;
	cacheDir?: string;
	signal?: AbortSignal;
	resetIds?: boolean;
}

export interface LoudnessNormalizeAnalysisBundle {
	version: 1;
	providerId: typeof LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID;
	analysis: LoudnessAnalysisV1;
	candidate: AudioNormalizeCandidateV1;
}

export async function runLoudnessNormalizeAnalysis(
	args: RunLoudnessNormalizeAnalysisArgs,
): Promise<LoudnessNormalizeAnalysisBundle> {
	if (args.resetIds) resetLoudnessCandidateSeqForTests();
	const policy = args.policy ?? DEFAULT_LOUDNESS_TARGET_POLICY;
	const analysis = await analyzeLoudness({
		assetId: args.assetId,
		mediaPath: args.mediaPath,
		policy,
		bypassCache: args.bypassCache,
		cacheDir: args.cacheDir,
		signal: args.signal,
	});
	const candidate = buildNormalizeCandidate({
		analysis,
		document: args.document,
		policy,
	});
	return {
		version: 1,
		providerId: LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID,
		analysis,
		candidate,
	};
}
