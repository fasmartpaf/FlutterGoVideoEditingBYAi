/**
 * Evidence Retrieval Deepening V1 — prepare-only (no provider generation).
 *
 * Run:
 *   npx vitest --run electron/ai-edition/perceptionBenchmark/evidenceRetrievalDeepening/evidence-retrieval-deepening.runtime.test.ts
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../../src/lib/ai-edition/schema";
import { readCursorSidecar } from "../../../media/cursorSidecar";
import { candidateBinaryPaths } from "../../../stt/gpuDetector";
import { SttManager } from "../../../stt/index";
import { classifyMediaContextNeeds } from "../../mediaContextNeeds";
import { prepareSpeechEvidenceForTurn } from "../../speechEvidence/prepare";
import { classifyVideoMemoryQuery } from "../../videoMemory";
import { formatCoverageBriefing, speechAlignmentTimes } from "../../videoMemory/coverage";
import { EVIDENCE_RETRIEVAL_DEEPENING_V1_ID } from "../../videoMemory/eventRegions";
import { frameBudgetForQuery, selectFramesForRetrieval } from "../../videoMemory/framePolicy";
import { classifyQueryScope } from "../../videoMemory/queryScope";
import { prepareVisualEvidenceForTurn } from "../../visualEvidence/prepare";
import { REAL_CORPUS_CASES } from "../realCorpusBaseline/cases";

const IDENTITY = EVIDENCE_RETRIEVAL_DEEPENING_V1_ID;
const REC_DIR = path.join(os.homedir(), "Library/Application Support/openscreen/recordings");
const FFMPEG = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");
const OUT = path.join(process.cwd(), "tmp/perception-benchmark/evidence-retrieval-deepening-v1");
const CACHE = path.join(OUT, "frame-cache");

const C020 =
	"Where would a zoom actually help in this recording, and where would it not help? Only recommend zooms when the visible evidence supports a specific focal target.";
const Q5 =
	"Compare what I say with what is visibly happening. Tell me what matches, what differs, and what cannot be verified.";

function buildDoc(mediaPath: string, projectId: string, durationSec = 30) {
	const base = createEmptyDocument({ title: "deepening", projectId });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				label: "d",
				kind: "video",
				originalPath: mediaPath,
				durationSec,
				width: 1920,
				height: 1080,
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
		},
	});
}

function cursorFor(mediaPath: string) {
	return {
		async read({ assetId, originalPath }: { assetId: string; originalPath: string | null }) {
			if (!originalPath) return { status: "unavailable" as const, assetId, note: "no path" };
			try {
				const sidecar = await readCursorSidecar(originalPath, {});
				if (!sidecar.found) return { status: "no-sidecar" as const, assetId };
				return { status: "ok" as const, assetId, samples: sidecar.data.samples };
			} catch (e) {
				return {
					status: "unavailable" as const,
					assetId,
					note: e instanceof Error ? e.message : String(e),
				};
			}
		},
	};
}

function listLocalMp4(): string[] {
	if (!existsSync(REC_DIR)) return [];
	return readdirSync(REC_DIR)
		.filter((f) => f.endsWith(".mp4") && !f.includes("webcam"))
		.map((f) => path.join(REC_DIR, f));
}

type Row = Record<string, unknown>;
const rows: Row[] = [];

function push(row: Row) {
	rows.push(row);
	mkdirSync(OUT, { recursive: true });
	const safe = String(row.id ?? "row")
		.replace(/[^\w.-]+/g, "_")
		.slice(0, 90);
	writeFileSync(path.join(OUT, `${safe}.json`), JSON.stringify(row, null, 2));
}

const canRun = existsSync(FFMPEG);

describe.runIf(canRun)("Evidence Retrieval Deepening V1 (prepare-only)", () => {
	it("proves coverage+deepening mix without provider generation", async () => {
		mkdirSync(CACHE, { recursive: true });
		mkdirSync(OUT, { recursive: true });

		const mp4s = listLocalMp4();
		const byName = (name: string) => mp4s.find((p) => path.basename(p) === name) ?? null;
		const c020 = byName("recording-1788978271417.mp4");
		const narrated = byName("recording-bug5-narrated.mp4");
		const longest = byName("recording-1789325019656.mp4");
		const silent = byName("recording-1788958840550.mp4");
		const case2 = REAL_CORPUS_CASES.find((c) => c.caseId === "case-002");
		const case4 = REAL_CORPUS_CASES.find((c) => c.caseId === "case-003");
		const settings = REAL_CORPUS_CASES.find((c) => c.caseId === "case-004");

		const scenarios: Array<{ id: string; family: string; media: string | null; prompt: string }> = [
			{ id: "C020_ZOOM", family: "whole_editorial", media: c020, prompt: C020 },
			{
				id: "C020_NEG",
				family: "neg_editorial",
				media: c020,
				prompt: "What would you NOT edit in this recording, and why?",
			},
			{
				id: "NARR_SPEECH",
				family: "speech_only",
				media: narrated,
				prompt: "What did I say near the end?",
			},
			{ id: "NARR_CROSS", family: "cross_modal", media: narrated, prompt: Q5 },
			{
				id: "NARR_VISUAL",
				family: "whole_visual",
				media: narrated,
				prompt: "What is visibly happening in this recording over time?",
			},
			{
				id: "CASE2_TEMP_UI",
				family: "bounded_ui",
				media: case2?.mediaPath ?? null,
				prompt: "What temporary UI appears near the end? Did I restart the recording?",
			},
			{
				id: "CASE4_SPEECH",
				family: "speech_only",
				media: existsSync(case4?.mediaPath ?? "") ? case4!.mediaPath : narrated,
				prompt: "What did I say, and did I correct myself? What is my final intended meaning?",
			},
			{
				id: "LONG_VISUAL",
				family: "whole_visual",
				media: longest,
				prompt: "What is visibly happening in this recording over time?",
			},
			{
				id: "LONG_EDITORIAL",
				family: "whole_editorial",
				media: longest,
				prompt: "What could genuinely be improved to make this recording feel more professional?",
			},
			{
				id: "LOCAL_TS",
				family: "local_visual",
				media: c020 ?? narrated,
				prompt: "What happens at 12 seconds?",
			},
			{
				id: "POPUP_END",
				family: "bounded_ui",
				media: case2?.mediaPath ?? c020,
				prompt: "What's this popup near the end?",
			},
			{
				id: "SETTINGS_VERIFY",
				family: "action_verify",
				media: settings?.mediaPath ?? narrated,
				prompt: "Did I open Settings?",
			},
			{
				id: "SILENT_VISUAL",
				family: "whole_visual",
				media: silent,
				prompt: "What visibly happens from beginning to end?",
			},
		];

		const extras = mp4s
			.filter(
				(p) =>
					![c020, narrated, longest, silent, case2?.mediaPath, settings?.mediaPath].includes(p),
			)
			.slice(0, 5);
		for (const [i, p] of extras.entries()) {
			scenarios.push({
				id: `EXTRA_${i + 1}_${path.basename(p).replace(/[^\w.-]+/g, "_")}`,
				family: i % 2 === 0 ? "whole_visual" : "whole_editorial",
				media: p,
				prompt:
					i % 2 === 0
						? "What is visibly happening in this recording over time?"
						: "Make this feel more professional, but preserve anything already clear.",
			});
		}

		const usable = scenarios.filter((s) => s.media && existsSync(s.media));
		expect(usable.length).toBeGreaterThanOrEqual(10);

		const beforeC020 = {
			selectedTimes: [0, 2, 6, 10, 16, 20],
			note: "Coverage V1 Case 020 attach — periodics only, no Stage B deepen",
		};
		writeFileSync(
			path.join(OUT, "before-c020-coverage-v1.json"),
			JSON.stringify(beforeC020, null, 2),
		);

		for (const s of usable) {
			const t0 = Date.now();
			const needs = classifyMediaContextNeeds(s.prompt);
			const queryClass = classifyVideoMemoryQuery(s.prompt, needs);
			const queryScope = classifyQueryScope(s.prompt, queryClass);
			const budget = frameBudgetForQuery(queryClass, queryScope);
			const document = buildDoc(s.media!, s.id);

			let speechPrepared = false;
			let speechRanges: Array<{ startSec: number; endSec: number; preview: string }> = [];
			if (queryClass === "speech" || queryClass === "cross_modal") {
				try {
					const whisper =
						process.env.OPENSCREEN_WHISPER_SERVER_EXE?.trim() ||
						candidateBinaryPaths().find((p) => p && existsSync(p)) ||
						path.join(process.cwd(), "electron/native/bin/darwin-arm64/whisper-stt-server");
					const speech = await prepareSpeechEvidenceForTurn({
						document,
						userMessage: s.prompt,
						contextNeeds: needs,
						deps: {
							cacheDir: path.join(OUT, "speech-cache"),
							ffmpegPath: FFMPEG,
							getSttManager: existsSync(whisper)
								? () => {
										const mgr = new SttManager();
										void mgr.init({
											modelsBaseDir: path.join(
												os.homedir(),
												"Library/Application Support/openscreen/stt-models",
											),
										});
										return mgr;
									}
								: undefined,
							resolveSttBinary: () => (existsSync(whisper) ? whisper : null),
						},
					});
					const ev = speech.prepared?.evidence?.[0];
					speechPrepared = Boolean(ev?.segments?.length);
					speechRanges = (ev?.segments ?? []).map((seg) => ({
						startSec: seg.startSourceTimeSec,
						endSec: seg.endSourceTimeSec,
						preview: (seg.text ?? "").slice(0, 80),
					}));
				} catch (err) {
					push({
						id: `${s.id}_speech_err`,
						error: err instanceof Error ? err.message : String(err),
					});
				}
			}

			const visual = await prepareVisualEvidenceForTurn({
				document,
				userMessage: s.prompt,
				provider: "openai",
				cursor: cursorFor(s.media!),
				extractDeps: { ffmpegPath: FFMPEG, cacheDir: CACHE },
				changeDeps: { ffmpegPath: FFMPEG },
				contextNeeds: needs,
				maxFrames: budget.maxExtract,
				skipVisualAttachment: budget.maxFrames === 0,
				coverageFirst: budget.coverageFirst,
				queryScope,
			});

			const durationSec = visual.prepared?.sourceDurationSec ?? 30;
			const aligned = speechAlignmentTimes({ windows: speechRanges, durationSec });
			const selected = selectFramesForRetrieval({
				frames: visual.prepared?.frames ?? [],
				queryClass,
				queryScope,
				userMessage: s.prompt,
				durationSec,
				priorityTimesSec: queryClass === "cross_modal" ? aligned : undefined,
				changes: visual.prepared?.changes,
				memory: {
					speechWindows: speechRanges,
					sourceDurationSec: durationSec,
				} as never,
			});

			const changeSummary = (visual.prepared?.changes ?? []).map((c) => ({
				from: c.fromSourceTimeSec,
				to: c.toSourceTimeSec,
				score: c.score,
				classification: c.classification,
			}));

			const row: Row = {
				identity: IDENTITY,
				id: s.id,
				family: s.family,
				media: path.basename(s.media!),
				prompt: s.prompt,
				queryClass,
				queryScope,
				durationSec,
				candidateCount: visual.prepared?.frames?.length ?? 0,
				candidateTimes: (visual.prepared?.frames ?? []).map((f) => f.sourceTimeSec),
				candidateReasons: (visual.prepared?.frames ?? []).map((f) => f.reason),
				changeSummary,
				eventRegionCount: selected.eventRegions.length,
				eventRegions: selected.eventRegions,
				coverageCandidateCount: selected.budget.coverageBudget,
				deepeningCandidateCount: selected.budget.deepeningBudget,
				budget: selected.budget,
				selectedCount: selected.frames.length,
				selectedTimes: selected.frames.map((f) => f.sourceTimeSec),
				selectedReasons: selected.meta,
				selectedEventRegions: selected.eventRegions
					.filter((r) =>
						selected.frames.some(
							(f) => f.sourceTimeSec >= r.startSec - 0.5 && f.sourceTimeSec <= r.endSec + 0.5,
						),
					)
					.map((r) => r.id),
				coverageBuckets: selected.coverage.coveredBuckets,
				coverageFraction: selected.coverage.coverageFraction,
				largestUnobservedGap: selected.coverage.largestUnobservedGapSec,
				coverageSufficient: selected.coverage.coverageSufficient,
				clustered: selected.coverage.clustered,
				diagnostics: selected.diagnostics,
				relevanceCandidatesAvailable: selected.diagnostics.relevanceCandidatesAvailable,
				relevanceCandidatesSelected: selected.diagnostics.relevanceCandidatesSelected,
				duplicateRegionFrames: selected.diagnostics.duplicateRegionFrames,
				framesToProvider: selected.frames.length,
				trace: selected.trace,
				coverageBriefing: formatCoverageBriefing(selected.coverage),
				speechPrepared,
				speechRanges: speechRanges.slice(0, 12),
				speechAlignmentTimes: aligned,
				retrievalPreparationMs: Date.now() - t0,
				extractBudget: budget.maxExtract,
				attachBudget: budget.maxFrames,
				coverageFirst: budget.coverageFirst,
			};
			push(row);
		}

		const c020Row = rows.find((r) => r.id === "C020_ZOOM") as Row;
		expect(c020Row).toBeTruthy();
		expect(c020Row.queryClass).toBe("editorial");
		expect(c020Row.queryScope).toBe("whole_media");
		expect(c020Row.coverageSufficient).toBe(true);
		expect(c020Row.clustered).toBe(false);
		const times = c020Row.selectedTimes as number[];
		expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(8);

		const candidates = c020Row.candidateReasons as string[];
		const hasEventCandidate =
			candidates.some((r) => r === "change_refinement" || r.startsWith("cursor")) ||
			(c020Row.eventRegionCount as number) > 0;
		const hasEventSelected =
			(c020Row.selectedReasons as Array<{ reason: string; note: string }>).some((m) =>
				/deepen|transition|event|change/i.test(`${m.reason} ${m.note}`),
			) ||
			(c020Row.candidateReasons as string[]).some(
				(r, i) =>
					r === "change_refinement" &&
					(c020Row.selectedTimes as number[]).includes((c020Row.candidateTimes as number[])[i]!),
			);

		writeFileSync(
			path.join(OUT, "C020_AUDIT.json"),
			JSON.stringify(
				{
					before: beforeC020,
					afterSelected: times,
					afterCandidates: c020Row.candidateTimes,
					afterReasons: c020Row.candidateReasons,
					changes: c020Row.changeSummary,
					eventRegions: c020Row.eventRegions,
					trace: c020Row.trace,
					hasEventCandidate,
					hasEventSelected,
					diagnostics: c020Row.diagnostics,
					budget: c020Row.budget,
					verdictNote: hasEventCandidate
						? hasEventSelected
							? "detector found event region and attach included deepen"
							: "detector found event region but attach did not select it — investigate"
						: "detector did not emit change_refinement/cursor event for this pack — Stage B N/A for that region",
				},
				null,
				2,
			),
		);

		if (hasEventCandidate) {
			expect(hasEventSelected).toBe(true);
			expect(
				(c020Row.diagnostics as { deepeningUtilization: number }).deepeningUtilization,
			).toBeGreaterThan(0);
		}

		const clusterDomination = times.filter((t) => t >= 12 && t <= 15).length;
		expect(clusterDomination).toBeLessThanOrEqual(2);

		const q5 = rows.find((r) => r.id === "NARR_CROSS") as Row;
		expect(q5.queryClass).toBe("cross_modal");
		expect((q5.selectedCount as number) > 0).toBe(true);
		expect(q5.speechPrepared).toBe(true);

		const speech = rows.find((r) => r.id === "NARR_SPEECH") as Row;
		expect(speech.selectedCount).toBe(0);

		const local = rows.find((r) => r.id === "LOCAL_TS") as Row;
		expect(local.queryClass).toBe("visual");
		expect(local.queryScope).toBe("local");
		expect((local.selectedTimes as number[]).every((t) => Math.abs(t - 12) < 5)).toBe(true);

		writeFileSync(path.join(OUT, "matrix.json"), JSON.stringify(rows, null, 2));
		writeFileSync(
			path.join(OUT, "summary.json"),
			JSON.stringify(
				{
					identity: IDENTITY,
					rowCount: rows.length,
					c020: {
						selectedTimes: times,
						coverageSufficient: c020Row.coverageSufficient,
						hasEventCandidate,
						hasEventSelected,
						budget: c020Row.budget,
						diagnostics: c020Row.diagnostics,
					},
					q5: {
						selectedCount: q5.selectedCount,
						speechPrepared: q5.speechPrepared,
					},
				},
				null,
				2,
			),
		);
	}, 300_000);
});

afterAll(() => {
	if (!existsSync(OUT)) return;
	writeFileSync(path.join(OUT, "all-rows.json"), JSON.stringify(rows, null, 2));
});
