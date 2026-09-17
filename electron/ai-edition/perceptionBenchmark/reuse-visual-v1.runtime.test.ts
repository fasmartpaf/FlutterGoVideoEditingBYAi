/**
 * CURRENT_OPENSCREEN_REUSE_VISUAL_V1 Case 2 diagnostic.
 * Does not overwrite CURRENT_OPENSCREEN / INVESTIGATOR_V1 / VISUAL_SPECIALIST_V1 baselines.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadBenchmarkCorpus } from "./corpus";
import { runCurrentStackCase } from "./runCurrentStack";

const CASE2_MEDIA =
	"/Users/osama/Library/Application Support/openscreen/recordings/recording-1789020958404.mp4";
const canRun = Boolean(process.env.OPENAI_API_KEY) && existsSync(CASE2_MEDIA);
const OUT = path.join(process.cwd(), "tmp/perception-benchmark/reuse-visual-v1");

describe.runIf(canRun)("CURRENT_OPENSCREEN_REUSE_VISUAL_V1 Case 2", () => {
	it("runs product stack with reuse specialist without GT leakage", async () => {
		mkdirSync(OUT, { recursive: true });
		const corpus = loadBenchmarkCorpus();
		const c2 = corpus.find((c) => c.caseId === "case02_fast_ui_event");
		expect(c2).toBeTruthy();
		const result = await runCurrentStackCase(c2!, {
			provider: "CURRENT_OPENSCREEN_REUSE_VISUAL_V1",
		});
		expect(result.provider).toBe("CURRENT_OPENSCREEN_REUSE_VISUAL_V1");
		expect(JSON.stringify(result).toLowerCase()).not.toMatch(/ground.?truth|locked gt/);
		writeFileSync(path.join(OUT, "case02-summary.json"), JSON.stringify(result, null, 2));
	}, 180_000);
});
