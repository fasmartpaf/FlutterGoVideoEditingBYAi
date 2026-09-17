/**
 * Ensure timestamped speech evidence is available for an AI turn when relevant.
 * Uses document.transcripts[] as SSOT, disk cache for warm STT, Whisper only on miss.
 *
 * Preparation ≠ injection: callers decide whether to surface speechStatus /
 * transcript guidance via MediaContextNeeds.injectSpeech.
 */

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withTranscript } from "../../../src/lib/ai-edition/document/transcript";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { NoAudioTrackError } from "../../stt/extractAudio";
import { candidateBinaryPaths } from "../../stt/gpuDetector";
import type { SttManager } from "../../stt/index";
import type { MediaContextNeeds } from "../mediaContextNeeds";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import { ensureCanonicalSourceDuration, type ProbedSourceDurations } from "../sourceTiming";
import { buildSpeechCacheIdentity, readSpeechCache, writeSpeechCache } from "./cache";
import { classifySpeechFailureReason, humanSafeSpeechFailureReason } from "./failureReason";
import { axcutTranscriptFromSttResponse, speechEvidenceFromAxcutTranscript } from "./map";
import { probeAudioStream } from "./probe";
import { applySpeechStatusResolution } from "./resolveStatus";
import type { PreparedSpeechEvidence, SpeechEvidence, SpeechEvidenceTimings } from "./types";

function defaultSpeechCacheDir(): string {
	if (process.env.OPENSCREEN_SPEECH_CACHE_DIR?.trim()) {
		return process.env.OPENSCREEN_SPEECH_CACHE_DIR.trim();
	}
	try {
		// Main-process only; unit tests fall through.
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const electron = require("electron") as { app?: { getPath: (name: string) => string } };
		if (electron.app?.getPath) {
			return path.join(electron.app.getPath("userData"), "speech-evidence-cache");
		}
	} catch {
		/* not running inside Electron */
	}
	return path.join(os.homedir(), ".openscreen-speech-evidence-cache");
}

const emptyTimings = (partial?: Partial<SpeechEvidenceTimings>): SpeechEvidenceTimings => ({
	audioProbeMs: 0,
	audioExtractMs: 0,
	sttMs: 0,
	transcriptParseMs: 0,
	transcriptCacheMs: 0,
	segmentCount: 0,
	cacheHit: false,
	...partial,
});

function assetHasUsableTranscript(document: AxcutDocument, assetId: string): boolean {
	const row =
		document.transcripts.find((t) => t.assetId === assetId) ??
		(document.transcript?.assetId === assetId ? document.transcript : null);
	if (!row) return false;
	return (
		(Array.isArray(row.segments) &&
			row.segments.some((s) => s.kind === "speech" && s.text.trim())) ||
		(Array.isArray(row.words) && row.words.length > 0)
	);
}

function pickTargetAssetIds(document: AxcutDocument): string[] {
	const fromClips = document.timeline.clips.map((c) => c.assetId);
	const primary = document.project.primaryAssetId;
	const ordered = [
		...fromClips,
		...(primary ? [primary] : []),
		...document.assets.map((a) => a.id),
	];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const id of ordered) {
		if (seen.has(id)) continue;
		seen.add(id);
		const asset = document.assets.find((a) => a.id === id);
		if (!asset) continue;
		// Known no-audio must still be selected so prepare can emit status:"no_audio"
		// without re-running STT (see loop body). Do not skip these assets.
		out.push(id);
	}
	return out.slice(0, 3);
}

function validateSpeechAgainstCanonical(
	evidence: SpeechEvidence,
	canonicalDurationSec: number,
): SpeechEvidence {
	return applySpeechStatusResolution({
		...evidence,
		sourceDurationSec: canonicalDurationSec,
	});
}

export interface PrepareSpeechEvidenceDeps {
	cacheDir?: string;
	modelId?: string;
	getSttManager?: () => SttManager;
	resolveSttBinary?: () => string | null;
	probeAudioStream?: typeof probeAudioStream;
	now?: () => number;
	ffprobePath?: string | null;
	ffmpegPath?: string | null;
	/** Tests: inject duration probe. */
	probeSourceDurations?: (mediaPath: string) => Promise<ProbedSourceDurations>;
}

export interface PrepareSpeechEvidenceInput {
	document: AxcutDocument;
	userMessage: string;
	/**
	 * @deprecated Prefer contextNeeds.speech. Kept for unit tests that force a path.
	 * Must NOT be set from visualFramesSupplied.
	 */
	force?: boolean;
	/** When provided, overrides message classification for this prepare call. */
	contextNeeds?: MediaContextNeeds;
	deps?: PrepareSpeechEvidenceDeps;
}

export async function prepareSpeechEvidenceForTurn(
	input: PrepareSpeechEvidenceInput,
): Promise<{ document: AxcutDocument; prepared: PreparedSpeechEvidence | null }> {
	const needs = input.contextNeeds ?? classifyMediaContextNeeds(input.userMessage);
	const wants = input.force === true || needs.speech;
	if (!wants) {
		return { document: input.document, prepared: null };
	}

	const deps = input.deps ?? {};
	const now = deps.now ?? Date.now;
	const modelId = deps.modelId ?? "ggml-small-q8_0.bin";
	const cacheDir = deps.cacheDir ?? defaultSpeechCacheDir();
	const resolveBin =
		deps.resolveSttBinary ??
		(() => {
			for (const candidate of candidateBinaryPaths()) {
				if (candidate && existsSync(candidate)) return candidate;
			}
			return null;
		});

	let document = input.document;
	let documentMutated = false;
	const evidence: SpeechEvidence[] = [];
	const aggregate = emptyTimings();

	for (const assetId of pickTargetAssetIds(document)) {
		const asset = document.assets.find((a) => a.id === assetId);
		if (!asset) continue;

		// Persisted open-path verdict: emit first-class no_audio without probe/STT.
		if (asset.transcriptionFailure?.kind === "no-audio") {
			evidence.push({
				assetId,
				sourceDurationSec: asset.durationSec ?? undefined,
				segments: [],
				status: "no_audio",
				engine: "persisted-transcription-failure",
				audioStreamPresent: false,
				timings: emptyTimings({ cacheHit: true }),
				reason: "no decodable audio stream",
			});
			continue;
		}

		const ensured = await ensureCanonicalSourceDuration({
			document,
			assetId,
			ffprobePath: deps.ffprobePath,
			ffmpegPath: deps.ffmpegPath,
			probe: deps.probeSourceDurations
				? await deps.probeSourceDurations(asset.originalPath)
				: undefined,
		});
		document = ensured.document;
		if (ensured.canonical?.repaired) documentMutated = true;
		const liveAsset = document.assets.find((a) => a.id === assetId) ?? asset;
		const sourceDurationSec = ensured.canonical?.durationSec ?? liveAsset.durationSec ?? undefined;

		const t0 = now();
		const probeFn = deps.probeAudioStream ?? probeAudioStream;
		const probe = await probeFn(liveAsset.originalPath);
		const audioProbeMs = now() - t0;
		aggregate.audioProbeMs += audioProbeMs;

		// On-document transcript is SSOT when present — even if this file currently
		// has no decodable audio stream (imported/edited transcripts, contradiction fixtures).
		if (assetHasUsableTranscript(document, assetId)) {
			const transcript =
				document.transcripts.find((t) => t.assetId === assetId) ?? document.transcript!;
			let speech = speechEvidenceFromAxcutTranscript({
				assetId,
				transcript,
				sourceDurationSec,
				status: "available",
				engine: "document-transcript",
				audioStreamPresent: probe.present === true ? true : probe.present === false ? false : null,
				timings: emptyTimings({
					audioProbeMs,
					transcriptCacheMs: 0,
					segmentCount: transcript.segments.filter((s) => s.kind === "speech").length,
					cacheHit: true,
				}),
			});
			if (sourceDurationSec != null) {
				speech = validateSpeechAgainstCanonical(speech, sourceDurationSec);
			}
			evidence.push(speech);
			aggregate.cacheHit = true;
			aggregate.segmentCount += speech.segments.length;
			continue;
		}

		if (probe.present === false) {
			evidence.push({
				assetId,
				sourceDurationSec,
				segments: [],
				status: "no_audio",
				audioStreamPresent: false,
				timings: emptyTimings({ audioProbeMs }),
				reason: probe.reason,
			});
			continue;
		}

		const identity = await buildSpeechCacheIdentity({
			sourcePath: liveAsset.originalPath,
			modelId,
		});
		if (identity) {
			const tCache = now();
			const cached = await readSpeechCache(cacheDir, identity);
			aggregate.transcriptCacheMs += now() - tCache;
			if (cached) {
				const transcript = { ...cached.transcript, assetId };
				document = withTranscript(document, transcript);
				documentMutated = true;
				let speech = speechEvidenceFromAxcutTranscript({
					assetId,
					transcript,
					sourceDurationSec,
					status: transcript.segments.some((s) => s.kind === "speech" && s.text.trim())
						? "available"
						: "no_speech_detected",
					engine: cached.engine ?? "speech-cache",
					audioStreamPresent: true,
					timings: emptyTimings({
						audioProbeMs,
						transcriptCacheMs: aggregate.transcriptCacheMs,
						segmentCount: transcript.segments.filter((s) => s.kind === "speech").length,
						cacheHit: true,
					}),
				});
				if (sourceDurationSec != null) {
					speech = validateSpeechAgainstCanonical(speech, sourceDurationSec);
				}
				evidence.push(speech);
				aggregate.cacheHit = true;
				aggregate.segmentCount += speech.segments.length;
				continue;
			}
		}

		const binary = resolveBin();
		if (!binary || !existsSync(binary)) {
			evidence.push({
				assetId,
				sourceDurationSec,
				segments: [],
				status: "unavailable",
				audioStreamPresent: probe.present === true ? true : null,
				timings: emptyTimings({ audioProbeMs }),
				failureReason: "binary_missing",
				reason: "transcription is currently unavailable in this runtime",
			});
			continue;
		}

		const getManager = deps.getSttManager;
		if (!getManager) {
			evidence.push({
				assetId,
				sourceDurationSec,
				segments: [],
				status: "unavailable",
				audioStreamPresent: probe.present === true ? true : null,
				timings: emptyTimings({ audioProbeMs }),
				reason: "transcription is currently unavailable in this runtime",
			});
			continue;
		}

		try {
			const manager = getManager();
			const tStt = now();
			const response = await manager.transcribe({ sourcePath: liveAsset.originalPath });
			const sttMs = now() - tStt;
			aggregate.sttMs += sttMs;

			const tParse = now();
			const transcript = axcutTranscriptFromSttResponse({
				assetId,
				response,
			});
			const transcriptParseMs = now() - tParse;
			aggregate.transcriptParseMs += transcriptParseMs;

			document = withTranscript(document, transcript);
			documentMutated = true;

			if (identity) {
				await writeSpeechCache(cacheDir, {
					identity,
					transcript,
					engine: response.backend,
					savedAt: new Date().toISOString(),
				});
			}

			const hasSpeech = transcript.segments.some((s) => s.kind === "speech" && s.text.trim());
			let speech = speechEvidenceFromAxcutTranscript({
				assetId,
				transcript,
				sourceDurationSec,
				status: hasSpeech ? "available" : "no_speech_detected",
				engine: response.backend,
				audioStreamPresent: true,
				timings: emptyTimings({
					audioProbeMs,
					sttMs,
					transcriptParseMs,
					segmentCount: transcript.segments.filter((s) => s.kind === "speech").length,
					cacheHit: false,
				}),
			});
			speech = applySpeechStatusResolution(
				sourceDurationSec != null ? { ...speech, sourceDurationSec } : speech,
			);
			evidence.push(speech);
			aggregate.segmentCount += speech.segments.length;
		} catch (err) {
			if (err instanceof NoAudioTrackError || /No decodable audio/i.test(String(err))) {
				evidence.push({
					assetId,
					sourceDurationSec,
					segments: [],
					status: "no_audio",
					audioStreamPresent: false,
					timings: emptyTimings({ audioProbeMs }),
					reason: "no decodable audio stream",
				});
				continue;
			}
			const failureReason = classifySpeechFailureReason(err);
			evidence.push({
				assetId,
				sourceDurationSec,
				segments: [],
				status: "failed",
				audioStreamPresent: probe.present === true ? true : null,
				timings: emptyTimings({ audioProbeMs }),
				failureReason,
				reason: humanSafeSpeechFailureReason(failureReason),
			});
		}
	}

	return {
		document,
		prepared: {
			evidence,
			documentMutated,
			timings: aggregate,
		},
	};
}
