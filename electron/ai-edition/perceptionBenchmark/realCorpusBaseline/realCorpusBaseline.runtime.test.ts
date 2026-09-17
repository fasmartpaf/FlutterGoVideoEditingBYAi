/**
 * Live Real Corpus Baseline V1 — frozen measurement.
 *
 * Run full corpus:
 *   npx vitest --run electron/ai-edition/perceptionBenchmark/realCorpusBaseline/realCorpusBaseline.runtime.test.ts
 *
 * Subset:
 *   REAL_CORPUS_ONLY=case-001,case-029 npx vitest --run .../realCorpusBaseline.runtime.test.ts
 *
 * Resume (default): skips cases with existing score.json unless REAL_CORPUS_FORCE=1
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { _resetSttManagerForTests, shutdownStt } from "../../../stt/index";
import { loadOpenAiKey } from "../runCurrentStack";
import { corpusStats, REAL_CORPUS_BASELINE_V1_ID, REAL_CORPUS_CASES } from "./cases";
import { runRealCorpusCase } from "./runCase";

const ARTIFACT_ROOT = path.join(process.cwd(), "tmp/perception-benchmark/real-corpus-baseline-v1");
const apiKey = loadOpenAiKey();
const canRun = Boolean(apiKey);

function selectedCases() {
	const only = (process.env.REAL_CORPUS_ONLY ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const from = process.env.REAL_CORPUS_FROM?.trim() || null;
	const force = process.env.REAL_CORPUS_FORCE === "1";
	let started = !from;
	return REAL_CORPUS_CASES.filter((c) => {
		if (from && !started) {
			if (c.caseId === from) started = true;
			else return false;
		}
		if (only.length && !only.includes(c.caseId)) return false;
		if (!force && existsSync(path.join(ARTIFACT_ROOT, "cases", c.caseId, "score.json"))) {
			return false;
		}
		return true;
	});
}

describe("real corpus baseline v1 readiness", () => {
	it("defines ~30 diverse cases with ≤30% historical anchors", () => {
		const stats = corpusStats();
		expect(stats.total).toBeGreaterThanOrEqual(25);
		expect(stats.total).toBeLessThanOrEqual(35);
		expect(stats.historicalAnchors / stats.total).toBeLessThanOrEqual(0.34);
		expect(stats.nonAnchorPct).toBeGreaterThanOrEqual(66);
		mkdirSync(ARTIFACT_ROOT, { recursive: true });
		writeFileSync(
			path.join(ARTIFACT_ROOT, "corpus.json"),
			JSON.stringify(
				{
					identity: REAL_CORPUS_BASELINE_V1_ID,
					stats,
					cases: REAL_CORPUS_CASES,
				},
				null,
				2,
			),
		);
	});
});

describe.runIf(canRun)("real corpus baseline v1 live frozen run", () => {
	afterAll(async () => {
		await shutdownStt().catch(() => undefined);
		_resetSttManagerForTests();
	});

	const cases = selectedCases();

	it(`runs ${cases.length} pending cases (skip completed unless FORCE)`, async () => {
		expect(apiKey.length).toBeGreaterThan(10);
		mkdirSync(path.join(ARTIFACT_ROOT, "cases"), { recursive: true });

		const results: Array<{ caseId: string; overall?: string; error?: string | null }> = [];
		const { aggregateArtifacts } = await import("./summarize");
		for (const c of cases) {
			// eslint-disable-next-line no-console
			console.log(`[real-corpus] RUN ${c.caseId} ${c.family}`);
			const r = await runRealCorpusCase(c, {
				apiKey,
				skipApply: process.env.REAL_CORPUS_SKIP_APPLY === "1",
			});
			results.push({ caseId: c.caseId, overall: r.overall, error: r.error ?? null });
			aggregateArtifacts();
			// eslint-disable-next-line no-console
			console.log(
				`[real-corpus] DONE ${c.caseId} overall=${r.overall} ms=${r.latency?.totalTurnMs}`,
			);
		}

		writeFileSync(
			path.join(ARTIFACT_ROOT, "run-log.json"),
			JSON.stringify({ finishedAtIso: new Date().toISOString(), results }, null, 2),
		);

		aggregateArtifacts();

		expect(results.every((r) => r.caseId)).toBe(true);
	}, 3_600_000);
});
