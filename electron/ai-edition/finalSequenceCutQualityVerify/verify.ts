/**
 * Per-join aggregator + sequence runner.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { AudioPcmProvider } from "../audioVerify";
import { verifyJoinAudio } from "./audio";
import { readJoinVerifyCache, writeJoinVerifyCache } from "./cache";
import { verifyJoinCaption } from "./caption";
import { enumerateProgrammeJoins } from "./enumerate";
import { type PreservationEvidence, verifyJoinPreservation } from "./preservationCheck";
import { verifyJoinSpeech } from "./speech";
import { verifyJoinSpeed } from "./speed";
import {
	FINAL_SEQUENCE_CUT_QUALITY_VERIFY_V1_ID,
	FINAL_SEQUENCE_VERIFY_POLICY_VERSION,
	type FinalSequenceCutQualityResultV1,
	type FinalSequenceJoinVerificationV1,
	type JoinModalityResult,
	type JoinOverallStatus,
	type JoinSeverity,
	type ProgrammeJoinV1,
	type SequenceOverallStatus,
} from "./types";
import { type JoinFrameSample, verifyJoinVisual } from "./visual";

function emptyModality(
	outcome: JoinModalityResult["outcome"] = "NOT_APPLICABLE",
): JoinModalityResult {
	return {
		outcome,
		blockingReasons: [],
		warnings: [],
		evidenceRefs: [],
		notes: [],
		latencyMs: 0,
	};
}

function rollupJoin(parts: JoinModalityResult[]): {
	overall: JoinOverallStatus;
	severity: JoinSeverity;
	blockingReasons: string[];
	warnings: string[];
	evidenceRefs: string[];
} {
	const blocking = parts.flatMap((p) => p.blockingReasons);
	const warnings = parts.flatMap((p) => p.warnings);
	const evidenceRefs = parts.flatMap((p) => p.evidenceRefs);
	const anyFail = parts.some((p) => p.outcome === "FAIL") || blocking.length > 0;
	const anyWarn = parts.some((p) => p.outcome === "WARNING") || warnings.length > 0;
	const allInsufficient =
		parts.every(
			(p) =>
				p.outcome === "INSUFFICIENT_EVIDENCE" ||
				p.outcome === "NOT_APPLICABLE" ||
				p.outcome === "UNKNOWN",
		) && parts.some((p) => p.outcome === "INSUFFICIENT_EVIDENCE" || p.outcome === "UNKNOWN");

	if (anyFail) {
		return {
			overall: "FAILED",
			severity: "blocking",
			blockingReasons: blocking,
			warnings,
			evidenceRefs,
		};
	}
	if (allInsufficient) {
		return {
			overall: "INSUFFICIENT_EVIDENCE",
			severity: "info",
			blockingReasons: [],
			warnings,
			evidenceRefs,
		};
	}
	if (anyWarn) {
		return {
			overall: "CLEAN_WITH_WARNINGS",
			severity: "warning",
			blockingReasons: [],
			warnings,
			evidenceRefs,
		};
	}
	return {
		overall: "CLEAN",
		severity: "none",
		blockingReasons: [],
		warnings: [],
		evidenceRefs,
	};
}

export async function verifyProgrammeJoin(args: {
	document: AxcutDocument;
	join: ProgrammeJoinV1;
	pcmProvider?: AudioPcmProvider | null;
	injectedAudio?: { samples: Float32Array; sampleRate: number; joinOffsetSec: number } | null;
	frames?: JoinFrameSample[] | null;
	preservation?: PreservationEvidence | null;
	aspectValue?: number;
	skipCaption?: boolean;
	confirmedSilenceRanges?: Array<{ startSourceSec: number; endSourceSec: number }>;
}): Promise<FinalSequenceJoinVerificationV1> {
	const speech = verifyJoinSpeech({
		document: args.document,
		join: args.join,
		confirmedSilenceRanges: args.confirmedSilenceRanges,
	});
	const audio = await verifyJoinAudio({
		document: args.document,
		join: args.join,
		pcmProvider: args.pcmProvider,
		injectedSamples: args.injectedAudio,
	});
	const visual = verifyJoinVisual({ join: args.join, frames: args.frames });
	const caption = args.skipCaption
		? emptyModality("NOT_APPLICABLE")
		: verifyJoinCaption({
				document: args.document,
				join: args.join,
				aspectValue: args.aspectValue,
			});
	const timing =
		args.join.cause === "SPEED_BOUNDARY"
			? verifyJoinSpeed({ document: args.document, join: args.join })
			: emptyModality(
					args.join.programmeTimeSec >= 0 &&
						args.join.leftSourceRange.endSec >= args.join.leftSourceRange.startSec
						? "PASS"
						: "FAIL",
				);
	const preservation = verifyJoinPreservation({
		join: args.join,
		evidence: args.preservation,
	});

	const rolled = rollupJoin([speech, audio, visual, caption, timing, preservation]);
	return {
		join: args.join,
		speech,
		audio,
		visual,
		caption,
		timing,
		preservation,
		severity: rolled.severity,
		blockingReasons: rolled.blockingReasons,
		warnings: rolled.warnings,
		evidenceRefs: rolled.evidenceRefs,
		overall: rolled.overall,
	};
}

export interface VerifyFinalSequenceArgs {
	document: AxcutDocument;
	assetId?: string;
	pcmProvider?: AudioPcmProvider | null;
	/** Per-join injected audio (tests). */
	audioByJoinId?: Record<
		string,
		{ samples: Float32Array; sampleRate: number; joinOffsetSec: number }
	>;
	framesByJoinId?: Record<string, JoinFrameSample[]>;
	preservation?: PreservationEvidence | null;
	aspectValue?: number;
	includeNatural?: boolean;
	/** Only verify edit-created joins (default true). */
	editCreatedOnly?: boolean;
	useCache?: boolean;
	cacheDir?: string;
	skipCaption?: boolean;
	/** Dead-air / silencedetect ranges — join speech must not treat confirmed quiet as active STT. */
	confirmedSilenceRanges?: Array<{ startSourceSec: number; endSourceSec: number }>;
}

export async function verifyFinalSequenceCutQuality(
	args: VerifyFinalSequenceArgs,
): Promise<FinalSequenceCutQualityResultV1> {
	const tTotal0 = Date.now();
	const enumerated = enumerateProgrammeJoins({
		document: args.document,
		assetId: args.assetId,
		includeNatural: args.includeNatural,
	});

	const targets =
		args.editCreatedOnly === false
			? enumerated.joins
			: enumerated.joins.filter((j) => j.editCreated);

	const cacheKeyParts = {
		mediaFingerprint: enumerated.mediaFingerprint,
		programmeFingerprint: enumerated.programmeFingerprint,
		policyVersion: FINAL_SEQUENCE_VERIFY_POLICY_VERSION,
		joinIds: targets.map((j) => j.joinId),
	};

	if (args.useCache !== false) {
		const hit = readJoinVerifyCache(cacheKeyParts, args.cacheDir);
		if (hit) {
			return {
				...hit,
				performance: { ...hit.performance, cacheHit: true },
			};
		}
	}

	const verified: FinalSequenceJoinVerificationV1[] = [];
	let speechMs = 0;
	let audioMs = 0;
	let visualMs = 0;
	let captionMs = 0;

	for (const join of targets) {
		const v = await verifyProgrammeJoin({
			document: args.document,
			join,
			pcmProvider: args.pcmProvider,
			injectedAudio: args.audioByJoinId?.[join.joinId] ?? null,
			frames: args.framesByJoinId?.[join.joinId] ?? null,
			preservation: args.preservation,
			aspectValue: args.aspectValue,
			skipCaption: args.skipCaption,
			confirmedSilenceRanges: args.confirmedSilenceRanges,
		});
		speechMs += v.speech.latencyMs;
		audioMs += v.audio.latencyMs;
		visualMs += v.visual.latencyMs;
		captionMs += v.caption.latencyMs;
		verified.push(v);
	}

	const cleanCount = verified.filter((v) => v.overall === "CLEAN").length;
	const warningCount = verified.filter((v) => v.overall === "CLEAN_WITH_WARNINGS").length;
	const failedCount = verified.filter((v) => v.overall === "FAILED").length;
	const insufficientCount = verified.filter((v) => v.overall === "INSUFFICIENT_EVIDENCE").length;

	let overall: SequenceOverallStatus = "PASS";
	if (failedCount > 0) overall = "FAIL";
	else if (warningCount > 0) overall = "PASS_WITH_WARNINGS";
	else if (verified.length > 0 && insufficientCount === verified.length) {
		overall = "INSUFFICIENT_EVIDENCE";
	}

	const totalMs = Date.now() - tTotal0;
	const result: FinalSequenceCutQualityResultV1 = {
		version: 1,
		providerId: FINAL_SEQUENCE_CUT_QUALITY_VERIFY_V1_ID,
		policyVersion: FINAL_SEQUENCE_VERIFY_POLICY_VERSION,
		programmeFingerprint: enumerated.programmeFingerprint,
		mediaFingerprint: enumerated.mediaFingerprint,
		assetId: enumerated.assetId,
		joinCount: verified.length,
		editCreatedJoinCount: verified.filter((v) => v.join.editCreated).length,
		cleanCount,
		warningCount,
		failedCount,
		insufficientCount,
		joins: verified,
		coverage: {
			speechChecked: verified.filter((v) => v.speech.outcome !== "NOT_APPLICABLE").length,
			audioChecked: verified.filter((v) => v.audio.outcome !== "NOT_APPLICABLE").length,
			visualChecked: verified.filter((v) => v.visual.outcome !== "NOT_APPLICABLE").length,
			captionChecked: verified.filter((v) => v.caption.outcome !== "NOT_APPLICABLE").length,
			preservationKnown: verified.filter((v) => v.preservation.outcome === "PASS").length,
		},
		performance: {
			enumerateMs: enumerated.enumerateMs,
			speechMs,
			audioMs,
			visualMs,
			captionMs,
			totalMs,
			cacheHit: false,
			avgPerJoinMs: verified.length ? totalMs / verified.length : 0,
		},
		provenance: {
			additionalModelCalls: 0,
			paidAiCalls: 0,
			autoMutations: 0,
			builtAtIso: new Date().toISOString(),
		},
		overall,
	};

	if (args.useCache !== false) {
		writeJoinVerifyCache(cacheKeyParts, result, args.cacheDir);
	}

	return result;
}
