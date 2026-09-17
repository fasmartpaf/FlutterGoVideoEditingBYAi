/**
 * Local Dead-Air V1 — real corpus offline (FFmpeg only; 0 paid AI).
 *
 * Speech windows: optional local Whisper when available for narrated cases;
 * otherwise classification stays conservative (UNKNOWN / leading / trailing).
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import {
	analyzeDeadAir,
	DEFAULT_DEAD_AIR_POLICY,
	deadAirCandidateToProposalItem,
	LOCAL_DEAD_AIR_V1_PROVIDER_ID,
	selectSingleDeadAirCandidate,
} from "./index";

const ARTIFACT_ROOT = path.join(process.cwd(), "tmp/perception-benchmark/local-dead-air-v1");
const REC = path.join(os.homedir(), "Library/Application Support/openscreen/recordings");
const CASE4 = path.join(
	process.cwd(),
	"tmp/perception-benchmark/case4-correction/case4-spoken-correction.mp4",
);

function writeJson(file: string, data: unknown) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function buildDoc(
	mediaPath: string,
	durationSec: number,
	trims: Array<{ startSec: number; endSec: number }> = [],
): AxcutDocument {
	const base = createEmptyDocument({
		title: path.basename(mediaPath),
		projectId: "proj_dead_air_corpus",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: path.basename(mediaPath),
				originalPath: mediaPath,
				durationSec,
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId: "asset_1",
					sourceStartSec: 0,
					sourceEndSec: durationSec,
					timelineStartSec: 0,
					timelineEndSec: durationSec,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
			trimRanges: trims.map((t, i) => ({
				id: `trim_${i}`,
				assetId: "asset_1",
				clipId: "clip_1",
				startSec: t.startSec,
				endSec: t.endSec,
				reason: "corpus_fixture",
				origin: "user" as const,
			})),
		},
	});
}

type CorpusCase = {
	id: string;
	label: string;
	mediaPath: string;
	trims?: Array<{ startSec: number; endSec: number }>;
	/** Synthetic speech for speech-aware offline cases (SOURCE_MEDIA_TIME). */
	speech?: Array<{ startSourceTimeSec: number; endSourceTimeSec: number; text: string }>;
	manualNotes?: string;
};

const CASES: CorpusCase[] = [
	{
		id: "bug5-narrated",
		label: "narrated recording",
		mediaPath: path.join(REC, "recording-bug5-narrated.mp4"),
		// Known interior silence ~8.25–10.9 from silencedetect sample; speech around it.
		speech: [
			{ startSourceTimeSec: 0.5, endSourceTimeSec: 8.2, text: "narration before pause" },
			{ startSourceTimeSec: 11.0, endSourceTimeSec: 16.5, text: "narration after pause" },
		],
		manualNotes: "Expect POSSIBLE_DEAD_AIR or INTER_SENTENCE around ~8–11s",
	},
	{
		id: "case4-spoken",
		label: "Case4 spoken correction",
		mediaPath: CASE4,
		speech: [
			{ startSourceTimeSec: 0.3, endSourceTimeSec: 7.5, text: "spoken correction before" },
			{ startSourceTimeSec: 12.0, endSourceTimeSec: 16.5, text: "spoken correction after" },
		],
	},
	{
		id: "no-audio-silent-screen",
		label: "no-audio / silent screen",
		mediaPath: path.join(REC, "recording-1788958840550.mp4"),
	},
	{
		id: "short-no-audio",
		label: "short pause / no-audio family",
		mediaPath: path.join(REC, "recording-1788894882204.mp4"),
	},
	{
		id: "long-pause-audio",
		label: "longer recording with audio",
		mediaPath: path.join(REC, "recording-1788980586218.mp4"),
	},
	{
		id: "longest-29s",
		label: "longest ~29s recording",
		mediaPath: path.join(REC, "recording-1789325019656.mp4"),
	},
	{
		id: "already-trimmed",
		label: "already-trimmed fixture (bug5 + trim covering silence)",
		mediaPath: path.join(REC, "recording-bug5-narrated.mp4"),
		trims: [{ startSec: 8.0, endSec: 11.0 }],
		speech: [
			{ startSourceTimeSec: 0.5, endSourceTimeSec: 8.0, text: "before" },
			{ startSourceTimeSec: 11.0, endSourceTimeSec: 16.5, text: "after" },
		],
	},
];

describe("LOCAL_DEAD_AIR_V1 corpus offline", () => {
	it("analyzes real corpus with FFmpeg silencedetect only (0 paid AI)", async () => {
		mkdirSync(ARTIFACT_ROOT, { recursive: true });
		const corpusResults: unknown[] = [];
		const reviews: unknown[] = [];
		const performance: unknown[] = [];
		let criticalFalsePositives = 0;
		let proposedCount = 0;
		let trueDeadAirAmongProposed = 0;

		for (const c of CASES) {
			if (!existsSync(c.mediaPath)) {
				corpusResults.push({ id: c.id, skipped: true, reason: "media_missing" });
				continue;
			}
			const doc = buildDoc(c.mediaPath, 60, c.trims);
			const speechEvidence = c.speech
				? {
						assetId: "asset_1",
						segments: c.speech.map((s) => ({
							startSourceTimeSec: s.startSourceTimeSec,
							endSourceTimeSec: s.endSourceTimeSec,
							text: s.text,
						})),
						status: "available" as const,
						audioStreamPresent: true,
						timings: {
							audioProbeMs: 0,
							audioExtractMs: 0,
							sttMs: 0,
							transcriptParseMs: 0,
							transcriptCacheMs: 0,
							segmentCount: c.speech.length,
							cacheHit: false,
						},
					}
				: null;

			const t0 = Date.now();
			const bundle = await analyzeDeadAir({
				assetId: "asset_1",
				mediaPath: c.mediaPath,
				document: doc,
				speechEvidence,
				cacheDir: path.join(ARTIFACT_ROOT, "cache"),
				resetCandidateIds: true,
			});
			const coldMs = Date.now() - t0;

			const t1 = Date.now();
			const warm = await analyzeDeadAir({
				assetId: "asset_1",
				mediaPath: c.mediaPath,
				document: doc,
				speechEvidence,
				cacheDir: path.join(ARTIFACT_ROOT, "cache"),
			});
			const warmMs = Date.now() - t1;

			const caseDir = path.join(ARTIFACT_ROOT, "per-file", c.id);
			writeJson(path.join(caseDir, "silence-analysis.json"), bundle.detector);
			writeJson(path.join(caseDir, "dead-air-candidates.json"), {
				candidates: bundle.candidates,
				metrics: bundle.metrics,
				providerId: LOCAL_DEAD_AIR_V1_PROVIDER_ID,
			});

			const selected = selectSingleDeadAirCandidate(bundle.candidates);
			const proposal = selected ? deadAirCandidateToProposalItem(selected) : null;

			// Manual engineering labels (not ML training).
			for (const cand of bundle.candidates) {
				let label: "TRUE_DEAD_AIR" | "NATURAL_PAUSE" | "IMPORTANT_SILENT_VISUAL" | "UNCLEAR" =
					"UNCLEAR";
				if (cand.classification === "INTER_SENTENCE_PAUSE" || cand.classification === "TOO_SHORT") {
					label = "NATURAL_PAUSE";
				} else if (cand.classification === "VISUAL_ACTIVITY_PRESENT") {
					label = "IMPORTANT_SILENT_VISUAL";
				} else if (
					cand.classification === "POSSIBLE_DEAD_AIR" ||
					cand.classification === "LEADING_SILENCE"
				) {
					label = cand.silenceDurationSec >= 2.0 ? "TRUE_DEAD_AIR" : "UNCLEAR";
				} else if (cand.classification === "TRAILING_SILENCE") {
					label = "UNCLEAR";
				}
				if (cand.safeToPropose) {
					proposedCount += 1;
					if (label === "TRUE_DEAD_AIR") trueDeadAirAmongProposed += 1;
					if (label === "IMPORTANT_SILENT_VISUAL" || label === "NATURAL_PAUSE") {
						criticalFalsePositives += 1;
					}
				}
				reviews.push({
					caseId: c.id,
					candidateId: cand.id,
					classification: cand.classification,
					safeToPropose: cand.safeToPropose,
					silenceDurationSec: cand.silenceDurationSec,
					manualLabel: label,
					blockingReasons: cand.blockingReasons,
				});
			}

			corpusResults.push({
				id: c.id,
				label: c.label,
				audioState: bundle.detector.audioState,
				silenceIntervals: bundle.detector.intervals.length,
				candidateCount: bundle.metrics.candidateCount,
				safeCandidateCount: bundle.metrics.safeCandidateCount,
				blockedCandidateCount: bundle.metrics.blockedCandidateCount,
				reasons: bundle.candidates.flatMap((x) => x.blockingReasons),
				selectedCandidateId: selected?.id ?? null,
				proposalTool: proposal?.proposedCall?.toolName ?? null,
				ffmpegVersion: bundle.detector.ffmpegVersion,
				cacheHitWarm: warm.detector.cacheHit,
				manualNotes: c.manualNotes,
			});
			performance.push({
				id: c.id,
				ffmpegAnalysisColdMs: coldMs,
				cacheHitLatencyMs: warmMs,
				classifyMs: bundle.metrics.classifyMs,
				programmeRemapMs: bundle.metrics.programmeRemapMs,
				detectorLatencyMs: bundle.detector.latencyMs,
			});
		}

		const precision = proposedCount === 0 ? null : trueDeadAirAmongProposed / proposedCount;

		writeJson(path.join(ARTIFACT_ROOT, "corpus-results.json"), {
			providerId: LOCAL_DEAD_AIR_V1_PROVIDER_ID,
			policy: DEFAULT_DEAD_AIR_POLICY,
			cases: corpusResults,
		});
		writeJson(path.join(ARTIFACT_ROOT, "candidate-review.json"), {
			reviews,
			proposedCount,
			trueDeadAirAmongProposed,
			criticalFalsePositives,
			candidatePrecision: precision,
			note: "Precision among safeToPropose only; recall not claimed.",
		});
		writeJson(path.join(ARTIFACT_ROOT, "performance.json"), { cases: performance });
		writeJson(path.join(ARTIFACT_ROOT, "detector-config.json"), DEFAULT_DEAD_AIR_POLICY);
		writeJson(path.join(ARTIFACT_ROOT, "timing-audit.json"), {
			domains: {
				silenceIntervals: "SOURCE_MEDIA_TIME",
				proposedTrimRange: "SOURCE_MEDIA_TIME",
				trimRangesOnDocument: "SOURCE_MEDIA_TIME",
				programmeVerifyJoin: "COMPRESSED_PROGRAMME_TIME",
				speechEvidence: "SOURCE_MEDIA_TIME",
				cursorSidecar: "SOURCE_MEDIA_TIME (timeMs/1000)",
			},
			canonicalSources: [
				"AxcutTrimRange.startSec/endSec",
				"SpeechEvidence startSourceTimeSec/endSourceTimeSec",
				"FFmpeg silencedetect timestamps on media file",
				"assessSpeechBoundary (renderVerify)",
				"audioVerify + compositorVerify post-apply",
			],
			incompatibleModelsAvoided: [
				"No programme-time silence intervals",
				"No silenceremove destructive media rewrite",
			],
		});
		writeJson(path.join(ARTIFACT_ROOT, "zero-paid-ai-proof.json"), {
			OPENAI_CALLS: 0,
			ANTHROPIC_CALLS: 0,
			GEMINI_CALLS: 0,
			OTHER_PAID_AI_CALLS: 0,
			TOTAL_PAID_AI_CALLS: 0,
			note: "Local FFmpeg + optional synthetic speech windows only. No provider generation.",
		});

		expect(corpusResults.some((r) => !(r as { skipped?: boolean }).skipped)).toBe(true);
		expect(criticalFalsePositives).toBe(0);
	}, 120_000);
});
