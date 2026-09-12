/**
 * CURRENT_OPENSCREEN_VISUAL_SPECIALIST_V1 Case 2 experiment.
 * Does not overwrite CURRENT_OPENSCREEN or INVESTIGATOR_V1 locked baselines.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildLedgerFromPreparedEvidence, createVideoEvidenceStore } from "../temporalEventLedger";
import { planInvestigation, runMasterVideoInvestigatorV1 } from "../videoInvestigator";
import {
	mergeSpecialistIntoInvestigation,
	runVisualSpecialistV1,
	specialistObservedText,
} from "../visualSpecialist";
import { appendVisualSpecialistToLedger } from "../visualSpecialist/ledgerBridge";
import {
	CASE2_FAIR_USER_PROMPT,
	CASE2_LOCKED_DURATION_SEC,
	CASE2_LOCKED_MEDIA,
} from "./experimental/case02LockedGroundTruth";

const FFMPEG = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");
const OUT = path.join(process.cwd(), "tmp/perception-benchmark/visual-specialist-v1");
const canRun = existsSync(CASE2_LOCKED_MEDIA) && existsSync(FFMPEG);

describe.runIf(canRun)("CURRENT_OPENSCREEN_VISUAL_SPECIALIST_V1 Case 2", () => {
	it("investigator → source-res specialist → Restart OCR with provenance", async () => {
		mkdirSync(OUT, { recursive: true });
		const cacheDir = path.join(os.tmpdir(), `os-vs-full-${Date.now()}`);
		mkdirSync(cacheDir, { recursive: true });

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

		const { actions } = planInvestigation({
			userMessage: CASE2_FAIR_USER_PROMPT,
			store: createVideoEvidenceStore(ledger),
			sourceDurationSec: CASE2_LOCKED_DURATION_SEC,
			needs: {
				category: "mediaUnderstanding",
				visual: true,
				speech: false,
				cursor: false,
				injectSpeech: false,
			},
		});
		expect(actions.some((a) => a.tool === "inspect_region")).toBe(true);

		const inv = await runMasterVideoInvestigatorV1({
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

		const specialist = await runVisualSpecialistV1({
			videoPath: CASE2_LOCKED_MEDIA,
			investigation: inv!,
			cacheDir,
			ffmpegPath: FFMPEG,
		});

		const mergedInv = mergeSpecialistIntoInvestigation(inv!, specialist);
		const mergedLedger = appendVisualSpecialistToLedger(ledger, specialist, "case02");

		const restart = specialistObservedText(specialist, "Restart recording");
		const summary = {
			provider: "CURRENT_OPENSCREEN_VISUAL_SPECIALIST_V1",
			initialCoarseEvidence: { frames: [16, 18], change: "minimal" },
			investigationTrigger: inv!.stopReason,
			rangesInspected: inv!.coverage.rangesInspected,
			roiCount: inv!.coverage.roiCount,
			specialist: {
				metrics: specialist.metrics,
				crops: specialist.crops.map((c) => ({
					preset: c.presetOrReason,
					time: c.sourceTimeSec,
					size: `${c.width}x${c.height}`,
					source: `${c.sourceWidth}x${c.sourceHeight}`,
					fromSourceMedia: c.fromSourceMedia,
					bytes: c.byteLength,
					ms: c.ms,
				})),
				ocrTexts: specialist.ocrResults.map((o) =>
					o.lines.map((l) => `${l.text} (${l.confidence})`).join(" | "),
				),
				restartRecognized: restart,
				observations: specialist.observations.map((o) => ({
					kind: o.kind,
					epistemic: o.epistemic,
					text: o.text.slice(0, 240),
				})),
			},
			ledgerHasVisibleText: mergedLedger.events.some((e) => e.type === "observed_visible_text"),
			briefingHasSpecialist: /VISUAL_SPECIALIST_V1/.test(mergedInv.internalBriefing),
			gtIsolation: {
				noGtInSpecialistJson: !/"Restart recording"/.test(JSON.stringify(CASE2_FAIR_USER_PROMPT)),
				productionOcrOnly: restart,
			},
			ceilingNote:
				"1280 ROI OCR previously returned empty; source-res OCR reads Restart — resolution ceiling dominant",
		};
		writeFileSync(path.join(OUT, "case02-full-trace.json"), JSON.stringify(summary, null, 2));
		expect(restart).toBe(true);
		expect(specialist.metrics.extraModelCalls).toBe(0);
		expect(JSON.stringify(specialist)).not.toMatch(/user restarted the recording/i);
	}, 90_000);
});
