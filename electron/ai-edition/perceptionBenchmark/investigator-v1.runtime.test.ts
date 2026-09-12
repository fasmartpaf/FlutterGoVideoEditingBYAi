/**
 * CURRENT_OPENSCREEN_INVESTIGATOR_V1 diagnostic run.
 * Does NOT overwrite locked CURRENT_OPENSCREEN baseline artifacts.
 *
 * Run (optional, needs API key + Case 2 media):
 *   npx vitest --run electron/ai-edition/perceptionBenchmark/investigator-v1.runtime.test.ts
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildLedgerFromPreparedEvidence, createVideoEvidenceStore } from "../temporalEventLedger";
import { planInvestigation, runMasterVideoInvestigatorV1 } from "../videoInvestigator";
import {
	CASE2_FAIR_USER_PROMPT,
	CASE2_LOCKED_GROUND_TRUTH,
} from "./experimental/case02LockedGroundTruth";
import { loadOpenAiKey, runCurrentStackCase } from "./runCurrentStack";

const OUT = path.join(process.cwd(), "tmp/perception-benchmark/investigator-v1");
const apiKey = loadOpenAiKey();
const mediaPath = CASE2_LOCKED_GROUND_TRUTH.mediaPath;
const canRunLive = Boolean(apiKey) && Boolean(mediaPath) && existsSync(mediaPath ?? "");

describe("CURRENT_OPENSCREEN_INVESTIGATOR_V1 planning (no GT leak)", () => {
	it("plans late-window inspect from ledger uncertainty without Restart GT strings", async () => {
		const ledger = buildLedgerFromPreparedEvidence({
			assetId: "case02",
			sourceDurationSec: CASE2_LOCKED_GROUND_TRUTH.durationSec ?? 20,
			frames: [
				{
					assetId: "case02",
					sourceTimeSec: 16,
					virtualTimeSec: null,
					reason: "periodic",
					imagePath: "",
					mimeType: "image/jpeg",
					width: 1,
					height: 1,
					byteLength: 0,
				},
				{
					assetId: "case02",
					sourceTimeSec: 18,
					virtualTimeSec: null,
					reason: "periodic",
					imagePath: "",
					mimeType: "image/jpeg",
					width: 1,
					height: 1,
					byteLength: 0,
				},
			],
			changes: [
				{
					fromSourceTimeSec: 16,
					toSourceTimeSec: 18,
					score: 0.12,
					classification: "significant",
				},
			],
		});
		const { actions } = planInvestigation({
			userMessage: CASE2_FAIR_USER_PROMPT,
			store: createVideoEvidenceStore(ledger),
			sourceDurationSec: CASE2_LOCKED_GROUND_TRUTH.durationSec ?? 20,
			needs: {
				category: "mediaUnderstanding",
				visual: true,
				speech: false,
				cursor: false,
				injectSpeech: false,
			},
		});
		expect(actions.some((a) => a.tool === "inspect_video_range")).toBe(true);
		expect(actions.some((a) => a.tool === "inspect_region")).toBe(true);
		const set = await runMasterVideoInvestigatorV1({
			userMessage: CASE2_FAIR_USER_PROMPT,
			needs: {
				category: "mediaUnderstanding",
				visual: true,
				speech: false,
				cursor: false,
				injectSpeech: false,
			},
			assetId: "case02",
			sourceDurationSec: CASE2_LOCKED_GROUND_TRUTH.durationSec ?? 20,
			videoPath: null,
			ledger,
			ffmpegPath: null,
		});
		const blob = JSON.stringify(set).toLowerCase();
		expect(blob).not.toMatch(/restart recording/);
		expect(set!.metrics.investigatorModelCalls).toBe(0);
		mkdirSync(OUT, { recursive: true });
		writeFileSync(
			path.join(OUT, "case02-plan-only.json"),
			JSON.stringify(
				{
					provider: "CURRENT_OPENSCREEN_INVESTIGATOR_V1",
					note: "Plan/execution without live media extract",
					actions: actions.map((a) => ({ tool: a.tool, why: a.why })),
					stopReason: set!.stopReason,
					metrics: set!.metrics,
					rangesInspected: set!.coverage.rangesInspected,
				},
				null,
				2,
			),
		);
	});
});

describe.runIf(canRunLive)("CURRENT_OPENSCREEN_INVESTIGATOR_V1 live Case 2", () => {
	it("runs separate provider identity and records investigation diagnostics", async () => {
		mkdirSync(OUT, { recursive: true });
		const result = await runCurrentStackCase(CASE2_LOCKED_GROUND_TRUTH, {
			provider: "CURRENT_OPENSCREEN_INVESTIGATOR_V1",
			providerRunId: `investigator_v1_${Date.now()}`,
			outRoot: path.join(OUT, "runs"),
			apiKey,
		});
		expect(result.provider).toBe("CURRENT_OPENSCREEN_INVESTIGATOR_V1");
		expect(result.mediaReady).toBe(true);
		const inv = (result.providerRaw as { investigation?: unknown | null }).investigation;
		// Produced before the model turn; must survive empty model responses.
		expect(inv).toBeTruthy();
		writeFileSync(
			path.join(OUT, "case02-live-summary.json"),
			JSON.stringify(
				{
					provider: result.provider,
					importantEventRecall: result.importantEventRecall,
					hallucinations: result.hallucinations,
					latency: result.latency,
					emptyModelText: !(result.evidence.finalUserText ?? "").trim(),
					investigation: inv,
					userFacingPreview: (result.evidence.finalUserText ?? "").slice(0, 800),
					restartMentionedInUserText: /restart/i.test(result.evidence.finalUserText ?? ""),
				},
				null,
				2,
			),
		);
	}, 180_000);
});
