/**
 * Perception benchmark — CURRENT_OPENSCREEN baseline.
 * Requires OPENAI_API_KEY (+ local whisper for speech cases). Never prints secrets.
 *
 * Run:
 *   npx vitest --run electron/ai-edition/perceptionBenchmark/baseline.runtime.test.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { _resetSttManagerForTests, shutdownStt } from "../../stt/index";
import { ALL_CASES, resolveCorpusMedia } from "./corpus";
import { loadOpenAiKey, runCurrentStackCase } from "./runCurrentStack";
import type { PerceptionBenchmarkResult } from "./types";

const OUT = path.join(process.cwd(), "tmp/perception-benchmark");
const apiKey = loadOpenAiKey();
const runnable = ALL_CASES.filter((c) => {
	if (c.status === "RECORDING_REQUIRED") return false;
	return resolveCorpusMedia(c).mediaReady;
});

const canRun = Boolean(apiKey) && runnable.length > 0;

describe("perceptionBenchmark corpus readiness", () => {
	it("lists ten cases and marks recording-required explicitly", () => {
		expect(ALL_CASES).toHaveLength(10);
		const required = ALL_CASES.filter((c) => c.status === "RECORDING_REQUIRED");
		expect(required.map((c) => c.caseId)).toEqual([
			"case02_fast_ui_event",
			"case04_spoken_correction",
			"case07_brief_notification",
			"case09_pause_nonspeech_sound",
		]);
		for (const c of required) {
			expect(c.recordingScript).toBeTruthy();
			expect(c.events).toHaveLength(0);
		}
	});

	it("does not fabricate GT for missing media", () => {
		for (const c of ALL_CASES) {
			if (c.status === "RECORDING_REQUIRED") {
				expect(c.mediaPath).toBeNull();
			}
		}
	});
});

describe.runIf(canRun)("perceptionBenchmark CURRENT_OPENSCREEN baseline", () => {
	afterAll(async () => {
		await shutdownStt().catch(() => undefined);
		_resetSttManagerForTests();
	});

	it("runs usable corpus cases and writes provider-neutral results", async () => {
		mkdirSync(OUT, { recursive: true });
		const runId = `baseline_${new Date().toISOString().replace(/[:.]/g, "-")}`;
		const results: PerceptionBenchmarkResult[] = [];

		for (const gt of runnable) {
			const result = await runCurrentStackCase(gt, {
				providerRunId: `${runId}__${gt.caseId}`,
				outRoot: path.join(OUT, "runs"),
				apiKey,
			});
			results.push(result);
			expect(result.provider).toBe("CURRENT_OPENSCREEN");
			expect(result.mediaReady).toBe(true);
			expect(result.eventScores.length).toBe(gt.events.length);
			expect(result.latency.totalTurnMs).toBeGreaterThan(0);
			// Never leak key into artifacts
			const dumped = JSON.stringify(result);
			expect(dumped).not.toContain(apiKey);
		}

		const matrix = ALL_CASES.map((c) => {
			const media = resolveCorpusMedia(c);
			const run = results.find((r) => r.caseId === c.caseId);
			return {
				caseId: c.caseId,
				title: c.title,
				status: c.status,
				mediaReady: media.mediaReady,
				groundTruthReady: c.events.length > 0 && c.status !== "RECORDING_REQUIRED",
				baselineRun: Boolean(run),
				missingRequirement:
					c.status === "RECORDING_REQUIRED"
						? "RECORDING_REQUIRED — see recordingScript"
						: !media.mediaReady
							? media.missing.join("; ")
							: run
								? ""
								: "baseline not run",
				importantEventRecall: run?.importantEventRecall ?? null,
				hallucinationCount: run?.hallucinations.length ?? null,
				latencyMs: run?.latency.totalTurnMs ?? null,
			};
		});

		const summary = {
			provider: "CURRENT_OPENSCREEN",
			runId,
			ranAt: new Date().toISOString(),
			casesRun: results.map((r) => r.caseId),
			matrix,
			perCase: results.map((r) => ({
				caseId: r.caseId,
				recall: r.importantEventRecall,
				eventScores: r.eventScores,
				hallucinations: r.hallucinations,
				speechEval: r.speechEval,
				visualEval: r.visualEval,
				multimodalEval: r.multimodalEval,
				latency: r.latency,
				evidenceSummary: {
					frames: r.evidence.attachedFrameCount,
					frameTimestamps: r.evidence.selectedFrameTimestamps,
					speechSegments: r.evidence.speechSegments.length,
					speechStatus: r.evidence.speechStatus,
					cursorEvents: r.evidence.cursorEventCount,
				},
			})),
		};

		writeFileSync(path.join(OUT, "baseline-summary.json"), JSON.stringify(summary, null, 2));
		writeFileSync(path.join(OUT, "readiness-matrix.json"), JSON.stringify(matrix, null, 2));

		process.stderr.write(
			"PERCEPTION_BENCHMARK_BASELINE " +
				JSON.stringify(
					{
						runId,
						cases: results.length,
						recalls: results.map((r) => ({
							id: r.caseId,
							recall: r.importantEventRecall.recall,
							missed: r.importantEventRecall.missed,
							hallucinations: r.hallucinations.length,
							totalMs: r.latency.totalTurnMs,
						})),
					},
					null,
					2,
				) +
				"\n",
		);
	}, 1_800_000);
});
