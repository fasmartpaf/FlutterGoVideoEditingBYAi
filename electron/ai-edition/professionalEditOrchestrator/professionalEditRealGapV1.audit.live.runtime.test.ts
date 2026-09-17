/**
 * Real-gap audit for recording-1789454384941 — diagnostic only first.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import { type AxcutDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { NativeCompositorFrameSampler } from "../compositorVerify";
import { analyzeDeadAir } from "../deadAir";
import { runLoudnessNormalizeAnalysis } from "../loudness";
import {
	isProfessionalEditRequest,
	parseProfessionalEditIntent,
	runProfessionalEditOrchestrator,
} from "../professionalEditOrchestrator";

const OUT = path.join(process.cwd(), "tmp/perception-benchmark/professional-edit-real-gap-v1");
const MEDIA = path.join(
	os.homedir(),
	"Library/Application Support/openscreen/recordings/recording-1789454384941.mp4",
);
const PROJECT = path.join(
	os.homedir(),
	"Library/Application Support/openscreen/projects/proj_32d89edd-ab5b-4dba-a876-eb699a4cad49.openscreen",
);

function write(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	const p = path.join(OUT, name);
	if (typeof data === "string") writeFileSync(p, data, "utf8");
	else writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

const PROFESSIONAL_PROMPT =
	"the caption is working perfectly. can you please improve this and make the video professional? keep the important content and use whatever safe edits actually improve it.";

const PAUSE_PROMPT = "can u remove a pauses?";
const SCREENSHOT_PROMPT =
	"the caption is a working a perfectly can u please improve and make a video professional?";

describe("professional-edit real-gap audit 1789454384941", () => {
	it("traces silence, loudness, intent, and orchestrator turn", async () => {
		if (!existsSync(MEDIA) || !existsSync(PROJECT)) {
			write("real-turn-trace.json", { skipped: true });
			return;
		}

		const doc = documentSchema.parse(JSON.parse(readFileSync(PROJECT, "utf8"))) as AxcutDocument;
		const asset = doc.assets.find((a) => a.id === doc.project.primaryAssetId) ?? doc.assets[0]!;
		const assetId = asset.id;
		const mediaPath = asset.originalPath ?? MEDIA;
		const captionsEnabled = getCaptionSettings(doc, 16 / 9).enabled;

		const intentShot = parseProfessionalEditIntent(SCREENSHOT_PROMPT);
		const intentProf = parseProfessionalEditIntent(PROFESSIONAL_PROMPT);
		const intentPause = parseProfessionalEditIntent(PAUSE_PROMPT);

		const dead = await analyzeDeadAir({
			assetId,
			mediaPath,
			document: doc,
		});

		const silenceTrace = {
			intervalCount: dead.metrics.silenceIntervalCount,
			detector: {
				audioState: dead.detector.audioState,
				intervals: dead.detector.intervals,
			},
			candidates: dead.candidates.map((c) => ({
				id: c.id,
				classification: c.classification,
				silenceRange: c.silenceRange,
				silenceDurationSec: c.silenceDurationSec,
				proposedTrimRange: c.proposedTrimRange,
				resultingRemovedDurationSec: c.resultingRemovedDurationSec,
				safeToPropose: c.safeToPropose,
				blockingReasons: c.blockingReasons,
				visualBlockingReasons: c.visualBlockingReasons,
				visualActivityState: c.visualActivityState,
				speechBoundaryState: c.speechBoundaryState,
			})),
			safeCount: dead.candidates.filter((c) => c.safeToPropose).length,
		};
		write("silence-pipeline-trace.json", silenceTrace);

		const loud = await runLoudnessNormalizeAnalysis({
			assetId,
			mediaPath,
			document: doc,
		});
		const loudnessTrace = {
			analysis: {
				audioState: loud.analysis.audioState,
				integratedLufs: loud.analysis.integratedLufs,
				truePeakDbTp: loud.analysis.truePeakDbTp,
			},
			classification: loud.candidate.classification,
			safeToPropose: loud.candidate.safeToPropose,
			estimatedGainDb: loud.candidate.estimatedGainDb,
			resultingAudioGainDb: loud.candidate.resultingAudioGainDb,
			blockingReasons: loud.candidate.blockingReasons,
			warnings: loud.candidate.warnings,
			currentAudioGainDb: loud.candidate.currentAudioGainDb,
		};
		write("loudness-pipeline-trace.json", loudnessTrace);

		const native = new NativeCompositorFrameSampler({ appRoot: process.cwd() });
		const hasNative = native.hasAddon() && native.probeBackend() !== "none";

		// Simulate screenshot turn: professional, ask_once (no you decide)
		const turnAsk = await runProfessionalEditOrchestrator({
			document: doc,
			assetId,
			mediaPath,
			userMessage: SCREENSHOT_PROMPT,
			sourceDurationSec: asset.durationSec,
			settingsEditsAllowed: true,
			executionMode: undefined,
			compositorFrameSampler: hasNative ? native : undefined,
			appRoot: process.cwd(),
			skipFinalSequenceQc: true,
		});

		// Explicit you-decide professional path
		const turnDecide = await runProfessionalEditOrchestrator({
			document: doc,
			assetId,
			mediaPath,
			userMessage: PROFESSIONAL_PROMPT + " You decide.",
			sourceDurationSec: asset.durationSec,
			settingsEditsAllowed: true,
			executionMode: "verified_apply",
			compositorFrameSampler: hasNative ? native : undefined,
			allowInjectedCompositorAsAuthoritative: !hasNative,
			appRoot: process.cwd(),
			skipFinalSequenceQc: false,
		});

		const pauseRouted = isProfessionalEditRequest(PAUSE_PROMPT);

		write("context-hydration.json", {
			captionsEnabled,
			assetId,
			durationSec: asset.durationSec,
			trimCount: doc.timeline.trimRanges?.length ?? 0,
			transcriptWords: doc.transcripts?.[0]?.words?.length ?? 0,
			deadAirHydrated: dead.candidates.length,
			loudnessHydrated: loud.analysis.audioState,
		});

		write("capability-utilization.json", {
			askOnceTurn: turnAsk.capabilityUtilization,
			youDecideTurn: turnDecide.capabilityUtilization,
		});

		write("professional-plan.json", {
			askOnce: {
				intent: turnAsk.intent,
				needsUserAuthorization: turnAsk.needsUserAuthorization,
				authorization: turnAsk.authorization,
				plan: turnAsk.plan,
			},
			youDecide: {
				intent: turnDecide.intent,
				authorization: turnDecide.authorization,
				plan: turnDecide.plan,
			},
		});

		write("execution-receipts.json", {
			askOnce: {
				completed: turnAsk.session.completed,
				failed: turnAsk.session.failed,
				skipped: turnAsk.session.skipped,
				loudness: turnAsk.loudness,
				metrics: turnAsk.metrics,
			},
			youDecide: {
				completed: turnDecide.session.completed,
				failed: turnDecide.session.failed,
				skipped: turnDecide.session.skipped,
				loudness: turnDecide.loudness,
				metrics: turnDecide.metrics,
			},
		});

		write("final-sequence.json", {
			askOnceQc: turnAsk.finalSequenceQc?.overall ?? "NOT_RUN",
			youDecideQc: turnDecide.finalSequenceQc
				? {
						overall: turnDecide.finalSequenceQc.overall,
						joins: turnDecide.finalSequenceQc.joins.map((j) => ({
							id: j.join.joinId,
							overall: j.overall,
							warnings: j.warnings,
						})),
					}
				: null,
			warningDispositions: turnDecide.warningDispositions,
		});

		write("user-facing-response.txt", turnDecide.userFacingText);
		write("ask-once-user-facing-response.txt", turnAsk.userFacingText);

		write("before-after-summary.json", {
			originalDuration: asset.durationSec,
			askOnceFinal: turnAsk.session.finalProgrammeDurationSec,
			youDecideFinal: turnDecide.session.finalProgrammeDurationSec,
			askOnceCommitted: turnAsk.metrics.stepsCommitted,
			youDecideCommitted: turnDecide.metrics.stepsCommitted,
		});

		write("real-turn-trace.json", {
			recording: MEDIA,
			project: PROJECT,
			captionsEnabled,
			intentRouting: {
				screenshotPrompt: {
					isProfessional: isProfessionalEditRequest(SCREENSHOT_PROMPT),
					intent: intentShot,
				},
				professionalPrompt: {
					isProfessional: isProfessionalEditRequest(PROFESSIONAL_PROMPT),
					intent: intentProf,
				},
				pausePrompt: {
					isProfessional: pauseRouted,
					intent: intentPause,
					bug: !pauseRouted ? "remove_pauses_not_routed_to_professional_orchestrator" : null,
				},
			},
			rootCauseHypotheses: {
				askOnceWithoutProceed:
					turnAsk.intent.autonomy === "ask_once" && !turnAsk.authorization?.valid,
				emptyPlanAskOnce: turnAsk.plan.steps.length === 0,
				safeDeadAir: silenceTrace.safeCount,
				loudnessCopyBug:
					!turnAsk.loudness?.committed &&
					/peak limited|normalize was/i.test(turnAsk.userFacingText),
				pauseNotRouted: !pauseRouted,
			},
			askOnceText: turnAsk.userFacingText,
			youDecideText: turnDecide.userFacingText,
		});

		expect(captionsEnabled).toBe(true);
		expect(isProfessionalEditRequest(SCREENSHOT_PROMPT)).toBe(true);
	}, 300_000);
});
