/**
 * Audio Continuity Verification V1 orchestrator for trim joins.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { locateProgrammeInstant } from "../compositorVerify/programmeMap";
import { analyzeTrimProgrammeMapping } from "../renderVerify/mapping";
import { assessSpeechBoundary } from "../renderVerify/speechBoundary";
import type { SpeechBoundaryRisk } from "../renderVerify/types";
import { analyzeJoinPcm, classifyWaveformPolicy } from "./analyze";
import { createBoundedExportPcmProvider, detectNoAudio, primaryAssetPath } from "./extract";
import {
	AUDIO_VERIFY_PAD_AFTER_SEC,
	AUDIO_VERIFY_PAD_BEFORE_SEC,
	AUDIO_VERIFY_SAMPLE_RATE,
	AUDIO_VERIFY_V1_PROVIDER_ID,
	type AudioContinuityEvidence,
	type AudioContinuityStatus,
	type AudioPcmProvider,
} from "./types";

export interface AudioVerifyInput {
	proposalId: string;
	trimSourceStartSec: number;
	trimSourceEndSec: number;
	assetId: string;
	afterDocument: AxcutDocument;
	beforeDocument: AxcutDocument;
	mustSurviveRanges: Array<{ startSourceSec: number; endSourceSec: number }>;
	/** Injected PCM for unit tests. */
	pcmProvider?: AudioPcmProvider;
	/** Force no_audio without probing (tests). */
	forceNoAudio?: boolean;
	/** Force unavailable extraction (tests). */
	forceUnavailable?: boolean;
	failClosedIfUnavailable?: boolean;
	retainArtifacts?: boolean;
	artifactDir?: string;
	appRoot?: string;
}

export async function verifyTrimAudioContinuity(
	input: AudioVerifyInput,
): Promise<AudioContinuityEvidence> {
	const t0 = Date.now();
	const warnings: string[] = [];
	const blockingReasons: string[] = [];
	const evidenceRefs: string[] = [];
	let audioRenderSetupMs = 0;
	let boundedExportMs = 0;
	let decodeToPcmMs = 0;
	let analysisMs = 0;
	let bytesRendered = 0;
	let pcmSamplesAnalyzed = 0;

	const mapping = analyzeTrimProgrammeMapping({
		after: input.afterDocument,
		assetId: input.assetId,
		trimStartSec: input.trimSourceStartSec,
		trimEndSec: input.trimSourceEndSec,
	});
	const join = mapping.joinCompressedSec ?? 0;
	const windowStart = Math.max(0, join - AUDIO_VERIFY_PAD_BEFORE_SEC);
	const windowEnd = join + AUDIO_VERIFY_PAD_AFTER_SEC;

	const beforeLoc = locateProgrammeInstant(input.afterDocument, Math.max(0, join - 0.05));
	const afterLoc = locateProgrammeInstant(input.afterDocument, join + 0.05);

	const speech = assessSpeechBoundary({
		document: input.beforeDocument,
		assetId: input.assetId,
		trimStartSec: input.trimSourceStartSec,
		trimEndSec: input.trimSourceEndSec,
		mustSurviveRanges: input.mustSurviveRanges,
		confirmedSilenceRanges: [
			{
				startSourceSec: input.trimSourceStartSec,
				endSourceSec: input.trimSourceEndSec,
			},
		],
	});
	evidenceRefs.push(...speech.notes);
	if (speech.blocking) {
		blockingReasons.push(`speech_boundary:${speech.risk}`);
	}
	if (speech.risk === "near_speech_boundary") {
		warnings.push("near_speech_boundary");
	}

	const assetPath = primaryAssetPath(input.afterDocument, input.assetId);
	const tSetup = Date.now();
	const noAudio = input.forceNoAudio === true || (await detectNoAudio(assetPath));
	audioRenderSetupMs = Date.now() - tSetup;

	if (noAudio) {
		return {
			version: 1,
			providerId: AUDIO_VERIFY_V1_PROVIDER_ID,
			proposalId: input.proposalId,
			programmeJoinSec: join,
			sourceBefore: beforeLoc
				? {
						assetId: beforeLoc.assetId,
						sourceTimeSec: beforeLoc.sourceTimeSec,
						sourceStartSec: beforeLoc.sourceStartSec,
						sourceEndSec: beforeLoc.sourceEndSec,
					}
				: undefined,
			sourceAfter: afterLoc
				? {
						assetId: afterLoc.assetId,
						sourceTimeSec: afterLoc.sourceTimeSec,
						sourceStartSec: afterLoc.sourceStartSec,
						sourceEndSec: afterLoc.sourceEndSec,
					}
				: undefined,
			programmeAudioWindow: {
				startSec: windowStart,
				endSec: windowEnd,
				sampleRate: AUDIO_VERIFY_SAMPLE_RATE,
				channels: 1,
				sampleCount: 0,
			},
			speechBoundaryRisk: speech.risk,
			waveformMetrics: null,
			capturePath: "unavailable",
			status: "not_applicable_no_audio",
			warnings,
			blockingReasons: [],
			evidenceRefs: [...evidenceRefs, "no_audio"],
			additionalModelCalls: 0,
			latencyMs: {
				audioRenderSetupMs,
				boundedExportMs: 0,
				decodeToPcmMs: 0,
				analysisMs: 0,
				totalAudioVerificationMs: Date.now() - t0,
			},
			bytesRendered: 0,
			pcmSamplesAnalyzed: 0,
		};
	}

	if (input.forceUnavailable) {
		return failUnavailable(
			input,
			join,
			windowStart,
			windowEnd,
			speech.risk,
			warnings,
			evidenceRefs,
			t0,
			audioRenderSetupMs,
			beforeLoc,
			afterLoc,
		);
	}

	const provider =
		input.pcmProvider ??
		createBoundedExportPcmProvider({
			appRoot: input.appRoot,
			workDir: input.artifactDir,
			retain: input.retainArtifacts,
		});

	const tExp = Date.now();
	const pcm = await Promise.resolve(
		provider({
			document: input.afterDocument,
			programmeStartSec: windowStart,
			programmeEndSec: windowEnd,
			assetId: input.assetId,
		}),
	);
	boundedExportMs = Date.now() - tExp;

	if (!pcm || pcm.samples.length === 0) {
		return failUnavailable(
			input,
			join,
			windowStart,
			windowEnd,
			speech.risk,
			warnings,
			evidenceRefs,
			t0,
			audioRenderSetupMs,
			beforeLoc,
			afterLoc,
			boundedExportMs,
		);
	}

	const tDec = Date.now();
	decodeToPcmMs = Date.now() - tDec;
	bytesRendered = pcm.samples.byteLength;
	pcmSamplesAnalyzed = pcm.samples.length;

	const joinOffsetSec = join - pcm.programmeStartSec;
	const tAn = Date.now();
	const metrics = analyzeJoinPcm({
		samples: pcm.samples,
		sampleRate: pcm.sampleRate,
		joinOffsetSec,
	});
	const wave = classifyWaveformPolicy(metrics);
	analysisMs = Date.now() - tAn;
	blockingReasons.push(...wave.blocking);
	warnings.push(...wave.warnings);

	let status: AudioContinuityStatus;
	if (blockingReasons.length > 0) {
		status = "audio_verification_failed";
	} else if (warnings.length > 0) {
		status = "verified_audio_with_warnings";
	} else {
		status = "verified_audio_basic";
	}

	return {
		version: 1,
		providerId: AUDIO_VERIFY_V1_PROVIDER_ID,
		proposalId: input.proposalId,
		programmeJoinSec: join,
		sourceBefore: beforeLoc
			? {
					assetId: beforeLoc.assetId,
					sourceTimeSec: beforeLoc.sourceTimeSec,
					sourceStartSec: beforeLoc.sourceStartSec,
					sourceEndSec: beforeLoc.sourceEndSec,
				}
			: undefined,
		sourceAfter: afterLoc
			? {
					assetId: afterLoc.assetId,
					sourceTimeSec: afterLoc.sourceTimeSec,
					sourceStartSec: afterLoc.sourceStartSec,
					sourceEndSec: afterLoc.sourceEndSec,
				}
			: undefined,
		programmeAudioWindow: {
			startSec: windowStart,
			endSec: windowEnd,
			sampleRate: pcm.sampleRate,
			channels: 1,
			sampleCount: pcm.samples.length,
		},
		speechBoundaryRisk: speech.risk,
		waveformMetrics: metrics,
		capturePath:
			pcm.capturePath ?? (input.pcmProvider ? "injected_pcm" : "bounded_exportMulti_pcm"),
		status,
		warnings: [...new Set(warnings)],
		blockingReasons: [...new Set(blockingReasons)],
		evidenceRefs,
		additionalModelCalls: 0,
		latencyMs: {
			audioRenderSetupMs,
			boundedExportMs,
			decodeToPcmMs,
			analysisMs,
			totalAudioVerificationMs: Date.now() - t0,
		},
		bytesRendered,
		pcmSamplesAnalyzed,
	};
}

function failUnavailable(
	input: AudioVerifyInput,
	join: number,
	windowStart: number,
	windowEnd: number,
	speechRisk: SpeechBoundaryRisk,
	warnings: string[],
	evidenceRefs: string[],
	t0: number,
	audioRenderSetupMs: number,
	beforeLoc: ReturnType<typeof locateProgrammeInstant>,
	afterLoc: ReturnType<typeof locateProgrammeInstant>,
	boundedExportMs = 0,
): AudioContinuityEvidence {
	return {
		version: 1,
		providerId: AUDIO_VERIFY_V1_PROVIDER_ID,
		proposalId: input.proposalId,
		programmeJoinSec: join,
		sourceBefore: beforeLoc
			? {
					assetId: beforeLoc.assetId,
					sourceTimeSec: beforeLoc.sourceTimeSec,
					sourceStartSec: beforeLoc.sourceStartSec,
					sourceEndSec: beforeLoc.sourceEndSec,
				}
			: undefined,
		sourceAfter: afterLoc
			? {
					assetId: afterLoc.assetId,
					sourceTimeSec: afterLoc.sourceTimeSec,
					sourceStartSec: afterLoc.sourceStartSec,
					sourceEndSec: afterLoc.sourceEndSec,
				}
			: undefined,
		programmeAudioWindow: {
			startSec: windowStart,
			endSec: windowEnd,
			sampleRate: AUDIO_VERIFY_SAMPLE_RATE,
			channels: 1,
			sampleCount: 0,
		},
		speechBoundaryRisk: speechRisk,
		waveformMetrics: null,
		capturePath: "unavailable",
		status: "audio_unavailable",
		warnings,
		blockingReasons: ["audio_unavailable"],
		evidenceRefs: [...evidenceRefs, "extraction_failed"],
		additionalModelCalls: 0,
		latencyMs: {
			audioRenderSetupMs,
			boundedExportMs,
			decodeToPcmMs: 0,
			analysisMs: 0,
			totalAudioVerificationMs: Date.now() - t0,
		},
		bytesRendered: 0,
		pcmSamplesAnalyzed: 0,
	};
}

export function audioVerifyPassed(ev: AudioContinuityEvidence): boolean {
	return (
		ev.status === "verified_audio_basic" ||
		ev.status === "verified_audio_with_warnings" ||
		ev.status === "not_applicable_no_audio"
	);
}
