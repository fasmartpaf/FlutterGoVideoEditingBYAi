/**
 * Case 2 targeted-inspection experiment for Investigator V1 — production evidence only.
 * Uses locked media when present. Does NOT feed GT into investigation.
 * Does NOT require a live OpenAI call.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildLedgerFromPreparedEvidence } from "../temporalEventLedger";
import { runMasterVideoInvestigatorV1 } from "../videoInvestigator";
import {
	CASE2_FAIR_USER_PROMPT,
	CASE2_LOCKED_DURATION_SEC,
	CASE2_LOCKED_MEDIA,
} from "./experimental/case02LockedGroundTruth";

const FFMPEG = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");
const OUT = path.join(process.cwd(), "tmp/perception-benchmark/investigator-v1");
const canRun = existsSync(CASE2_LOCKED_MEDIA) && existsSync(FFMPEG);

describe.runIf(canRun)("Case 2 investigator targeted inspection (no model)", () => {
	it("inspects late window + ROI from ledger uncertainty without inventing Restart", async () => {
		const cacheDir = path.join(os.tmpdir(), `os-inv-case2-${Date.now()}`);
		mkdirSync(cacheDir, { recursive: true });
		mkdirSync(OUT, { recursive: true });

		// Sparse initial evidence similar to CURRENT_OPENSCREEN prepare (16/18 samples).
		const ledger = buildLedgerFromPreparedEvidence({
			assetId: "case02",
			sourceDurationSec: CASE2_LOCKED_DURATION_SEC,
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
					score: 0.03,
					classification: "minimal",
				},
			],
		});

		// Even with minimal change class, late-window question should still
		// plan deeper inspect when focus is near the end.
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
			sourceDurationSec: CASE2_LOCKED_DURATION_SEC,
			videoPath: CASE2_LOCKED_MEDIA,
			ledger,
			extractDeps: { cacheDir, ffmpegPath: FFMPEG },
			ffmpegPath: FFMPEG,
		});

		expect(set).not.toBeNull();
		expect(set!.metrics.investigatorModelCalls).toBe(0);
		expect(JSON.stringify(set).toLowerCase()).not.toMatch(/restart recording/);

		const summary = {
			provider: "CURRENT_OPENSCREEN_INVESTIGATOR_V1",
			initialEvidence: {
				frameTimes: [16, 18],
				changeClassification: "minimal",
				note: "Matches historical miss conditions; GT not injected",
			},
			whyDeeperInspection:
				"Whole-recording / late-focus mediaUnderstanding + visual uncertainty near end",
			focusRange: set!.focusRange,
			rangesInspected: set!.coverage.rangesInspected,
			frameTimesSec: set!.coverage.frameTimesSec,
			roiCount: set!.coverage.roiCount,
			additionalFrames: set!.additionalFrames.map((f) => ({
				sourceTimeSec: f.sourceTimeSec,
				note: f.note,
				bytes: f.byteLength,
			})),
			toolTrace: set!.toolTrace.map((t) => ({
				tool: t.tool,
				ok: t.ok,
				summary: t.summary,
				ms: t.ms,
			})),
			claims: set!.claims,
			metrics: set!.metrics,
			stopReason: set!.stopReason,
			restartRecognizedByInvestigator: false,
			note: "Investigator returns pixel/ROI evidence only; semantic Restart recognition requires the existing agent vision call on attached stills — not invented here.",
		};
		writeFileSync(
			path.join(OUT, "case02-targeted-inspection.json"),
			JSON.stringify(summary, null, 2),
		);

		expect(set!.coverage.rangesInspected.length + set!.coverage.roiCount).toBeGreaterThan(0);
		expect(set!.additionalFrames.length + set!.coverage.frameTimesSec.length).toBeGreaterThan(0);
	}, 60_000);
});
