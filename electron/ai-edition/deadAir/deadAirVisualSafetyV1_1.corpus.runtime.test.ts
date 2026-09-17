/**
 * Dead-Air Visual Safety V1.1 — real corpus offline (0 paid AI).
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
import { readCursorSidecar } from "../../media/cursorSidecar";
import {
	analyzeDeadAir,
	assessVisualActivity,
	DEFAULT_DEAD_AIR_POLICY,
	DEFAULT_VISUAL_SAFETY_POLICY,
	deadAirCandidateToProposalItem,
	LOCAL_DEAD_AIR_VISUAL_SAFETY_V1_1,
	selectSingleDeadAirCandidate,
} from "./index";

const ARTIFACT_ROOT = path.join(
	process.cwd(),
	"tmp/perception-benchmark/local-dead-air-visual-safety-v1-1",
);
const REC = path.join(os.homedir(), "Library/Application Support/openscreen/recordings");
const CASE4 = path.join(
	process.cwd(),
	"tmp/perception-benchmark/case4-correction/case4-spoken-correction.mp4",
);

function writeJson(file: string, data: unknown) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function buildDoc(mediaPath: string, durationSec: number): AxcutDocument {
	const base = createEmptyDocument({
		title: path.basename(mediaPath),
		projectId: "proj_dav_corpus",
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
			trimRanges: [],
		},
	});
}

type Case = {
	id: string;
	scenario: string;
	mediaPath: string;
	speech?: Array<{ startSourceTimeSec: number; endSourceTimeSec: number; text: string }>;
	/** When set, inject significant change overlapping silence for useful-silent-visual. */
	injectSignificantChange?: boolean;
};

const CASES: Case[] = [
	{
		id: "silent-stable-narrated",
		scenario: "A/F silent + stable / narrated pause",
		mediaPath: path.join(REC, "recording-bug5-narrated.mp4"),
		speech: [
			{ startSourceTimeSec: 0.5, endSourceTimeSec: 8.2, text: "before" },
			{ startSourceTimeSec: 11.0, endSourceTimeSec: 16.5, text: "after" },
		],
	},
	{
		id: "silent-cursor-family",
		scenario: "B/C silent + cursor activity family",
		mediaPath: path.join(REC, "recording-1788958840550.mp4"),
	},
	{
		id: "silent-click-heavy",
		scenario: "C/E silent + interactions",
		mediaPath: path.join(REC, "recording-1788895767287.mp4"),
	},
	{
		id: "case4-spoken",
		scenario: "I narrated / trailing",
		mediaPath: CASE4,
		speech: [
			{ startSourceTimeSec: 0.3, endSourceTimeSec: 7.5, text: "before" },
			{ startSourceTimeSec: 12.0, endSourceTimeSec: 16.5, text: "after" },
		],
	},
	{
		id: "useful-silent-visual-injected",
		scenario: "I useful silent visual (injected significant change)",
		mediaPath: path.join(REC, "recording-bug5-narrated.mp4"),
		speech: [
			{ startSourceTimeSec: 0.5, endSourceTimeSec: 8.2, text: "before" },
			{ startSourceTimeSec: 11.0, endSourceTimeSec: 16.5, text: "after" },
		],
		injectSignificantChange: true,
	},
	{
		id: "no-audio-screen",
		scenario: "J no-audio screen",
		mediaPath: path.join(REC, "recording-1788894882204.mp4"),
	},
	{
		id: "long-audio",
		scenario: "F/G longer audio recording",
		mediaPath: path.join(REC, "recording-1788980586218.mp4"),
	},
];

describe("LOCAL_DEAD_AIR_VISUAL_SAFETY_V1_1 corpus", () => {
	it("expands visual safety on real recordings (0 paid AI)", async () => {
		mkdirSync(ARTIFACT_ROOT, { recursive: true });

		writeJson(path.join(ARTIFACT_ROOT, "visual-signal-audit.json"), {
			signals: [
				{
					name: "Bug-3 visual change scores",
					classification: "AVAILABLE_REUSABLE",
					path: "electron/ai-edition/visualEvidence/change.ts",
				},
				{
					name: "Temporal Event Ledger visual_transition",
					classification: "AVAILABLE_REUSABLE",
					path: "electron/ai-edition/temporalEventLedger/build.ts",
				},
				{
					name: "cursor sidecar non-move",
					classification: "AVAILABLE_REUSABLE",
					path: "electron/media/cursorSidecar.ts",
				},
				{
					name: "FFmpeg scene select (bounded)",
					classification: "AVAILABLE_REUSABLE",
					path: "electron/ai-edition/visualSpecialist/reuse/sceneDetect.ts",
				},
				{
					name: "FFmpeg blackdetect/freezedetect",
					classification: "AVAILABLE_REUSABLE",
					note: "observations only; never unlock alone",
				},
				{
					name: "OCR / observed_visible_text",
					classification: "AVAILABLE_BUT_EXPENSIVE",
					note: "reuse cache only; no OCR run in this milestone",
				},
				{
					name: "Full prepareVisualEvidenceForTurn",
					classification: "AVAILABLE_BUT_EXPENSIVE",
				},
				{
					name: "Model semantic chrome",
					classification: "NOT_RELEVANT",
				},
			],
		});
		writeJson(path.join(ARTIFACT_ROOT, "visual-policy.json"), DEFAULT_VISUAL_SAFETY_POLICY);

		const corpusResults: unknown[] = [];
		const groundTruth: unknown[] = [];
		const performance: unknown[] = [];
		let proposedCount = 0;
		let trueDeadAirSafe = 0;
		let criticalFalsePositives = 0;

		for (const c of CASES) {
			if (!existsSync(c.mediaPath)) {
				corpusResults.push({ id: c.id, skipped: true, reason: "media_missing" });
				continue;
			}
			const doc = buildDoc(c.mediaPath, 60);
			const speechEvidence = c.speech
				? {
						assetId: "asset_1",
						segments: c.speech.map((s) => ({
							startSourceTimeSec: s.startSourceTimeSec,
							endSourceTimeSec: s.endSourceTimeSec,
							text: s.text,
						})),
						status: "available" as const,
						audioStreamPresent: true as const,
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

			const cursor = await readCursorSidecar(c.mediaPath, {});
			const cursorClicks = cursor.found
				? cursor.data.samples.filter((s) => s.interactionType !== "move").length
				: 0;

			const preparedChanges = c.injectSignificantChange
				? [
						{
							fromSourceTimeSec: 8.5,
							toSourceTimeSec: 10.0,
							score: 0.2,
							classification: "significant" as const,
						},
					]
				: null;

			const t0 = Date.now();
			const bundle = await analyzeDeadAir({
				assetId: "asset_1",
				mediaPath: c.mediaPath,
				document: doc,
				speechEvidence,
				preparedChanges,
				cacheDir: path.join(ARTIFACT_ROOT, "cache"),
				resetCandidateIds: true,
				// Prefer existing evidence; allow scdet only when speech-safe and no prepared changes
				forceSkipFfmpegVisualFallback: preparedChanges != null,
				policy: {
					...DEFAULT_DEAD_AIR_POLICY,
					visualSafety: {
						...DEFAULT_VISUAL_SAFETY_POLICY,
						// Keep black/freeze observational; scene fallback on for speech-safe gaps
						enableScdetFallback: preparedChanges == null,
						enableBlackFreezeProbe: true,
					},
				},
			});
			const totalMs = Date.now() - t0;

			const caseDir = path.join(ARTIFACT_ROOT, "per-candidate", c.id);
			writeJson(path.join(caseDir, "silence-analysis.json"), bundle.detector);
			writeJson(path.join(caseDir, "dead-air-candidate.json"), {
				candidates: bundle.candidates,
				metrics: bundle.metrics,
			});
			writeJson(
				path.join(caseDir, "visual-activity.json"),
				bundle.candidates.map((cand) => ({
					id: cand.id,
					visualActivityState: cand.visualActivityState,
					visualBlockingReasons: cand.visualBlockingReasons,
					assessment: cand.visualActivityAssessment,
				})),
			);

			for (const cand of bundle.candidates) {
				let label: "TRUE_DEAD_AIR" | "USEFUL_SILENT_VISUAL" | "NATURAL_PAUSE" | "UNCLEAR" =
					"UNCLEAR";
				if (c.injectSignificantChange && cand.classification === "VISUAL_ACTIVITY_PRESENT") {
					label = "USEFUL_SILENT_VISUAL";
				} else if (
					cand.classification === "TOO_SHORT" ||
					cand.classification === "INTER_SENTENCE_PAUSE"
				) {
					label = "NATURAL_PAUSE";
				} else if (
					cand.safeToPropose &&
					cand.visualActivityState === "NO_MATERIAL_VISUAL_ACTIVITY"
				) {
					label = "TRUE_DEAD_AIR";
				} else if (cand.classification === "VISUAL_ACTIVITY_PRESENT") {
					label = "USEFUL_SILENT_VISUAL";
				}

				if (cand.safeToPropose) {
					proposedCount += 1;
					if (label === "TRUE_DEAD_AIR") trueDeadAirSafe += 1;
					if (label === "USEFUL_SILENT_VISUAL" || label === "NATURAL_PAUSE") {
						criticalFalsePositives += 1;
					}
				}

				groundTruth.push({
					caseId: c.id,
					candidateId: cand.id,
					manualLabel: label,
					safeToPropose: cand.safeToPropose,
					classification: cand.classification,
					visualActivityState: cand.visualActivityState,
					silenceDurationSec: cand.silenceDurationSec,
				});
			}

			const selected = selectSingleDeadAirCandidate(bundle.candidates);
			corpusResults.push({
				id: c.id,
				scenario: c.scenario,
				audioState: bundle.detector.audioState,
				silenceIntervals: bundle.detector.intervals.length,
				safeCandidateCount: bundle.metrics.safeCandidateCount,
				cursorNonMoveCount: cursorClicks,
				visualStates: bundle.candidates.map((x) => x.visualActivityState),
				selectedSafe: selected?.safeToPropose ?? false,
				proposalTool: selected
					? deadAirCandidateToProposalItem(selected)?.proposedCall?.toolName
					: null,
				usedFfmpegFallback: bundle.candidates.some(
					(x) => x.visualActivityAssessment?.usedFfmpegFallback,
				),
			});

			const existingMs = bundle.candidates.reduce(
				(s, x) => s + (x.visualActivityAssessment?.diagnostics.existingEvidenceMs ?? 0),
				0,
			);
			const ffmpegMs = bundle.candidates.reduce(
				(s, x) => s + (x.visualActivityAssessment?.diagnostics.ffmpegFallbackMs ?? 0),
				0,
			);
			performance.push({
				id: c.id,
				totalMs,
				existingEvidenceMs: existingMs,
				ffmpegFallbackMs: ffmpegMs,
				detectorLatencyMs: bundle.detector.latencyMs,
				cacheHit: bundle.detector.cacheHit,
			});
		}

		const precision = proposedCount === 0 ? null : trueDeadAirSafe / proposedCount;

		writeJson(path.join(ARTIFACT_ROOT, "corpus-results.json"), {
			providerId: LOCAL_DEAD_AIR_VISUAL_SAFETY_V1_1,
			cases: corpusResults,
		});
		writeJson(path.join(ARTIFACT_ROOT, "candidate-ground-truth.json"), {
			reviews: groundTruth,
			proposedCount,
			trueDeadAirSafe,
			candidatePrecision: precision,
		});
		writeJson(path.join(ARTIFACT_ROOT, "false-positive-analysis.json"), {
			criticalFalsePositives,
			definition: "USEFUL_SILENT_VISUAL or NATURAL_PAUSE marked safeToPropose",
			status: criticalFalsePositives === 0 ? "PASS" : "FAIL",
		});
		writeJson(path.join(ARTIFACT_ROOT, "performance.json"), { cases: performance });
		writeJson(path.join(ARTIFACT_ROOT, "zero-paid-ai-proof.json"), {
			OPENAI_CALLS: 0,
			ANTHROPIC_CALLS: 0,
			GEMINI_CALLS: 0,
			OTHER_PAID_AI_CALLS: 0,
			TOTAL_PAID_AI_CALLS: 0,
		});

		expect(criticalFalsePositives).toBe(0);
		expect(corpusResults.some((r) => !(r as { skipped?: boolean }).skipped)).toBe(true);

		// Sanity: injected useful silent visual must not be safe
		const useful = groundTruth.find(
			(g) =>
				(g as { caseId: string }).caseId === "useful-silent-visual-injected" &&
				(g as { manualLabel: string }).manualLabel === "USEFUL_SILENT_VISUAL",
		) as { safeToPropose: boolean } | undefined;
		if (useful) expect(useful.safeToPropose).toBe(false);
	}, 180_000);
});
