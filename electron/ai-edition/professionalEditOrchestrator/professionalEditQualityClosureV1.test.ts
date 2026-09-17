/**
 * Professional Edit Quality Closure V1 — deterministic regressions (0 paid AI).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { patchCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { runCaptionLayoutForDocument, verifyCaptionLayoutRender } from "../captionLayout";
import { createInjectedCompositorSampler } from "../compositorVerify";
import type { DeadAirCandidateV1 } from "../deadAir";
import { VISUAL_SAFETY_VERSION } from "../deadAir/visualActivityTypes";
import type { LoudnessAnalysisV1 } from "../loudness";
import {
	buildNormalizeCandidate,
	LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID,
	LOUDNESS_MEASUREMENT_VERSION,
} from "../loudness";
import { assessDurationObjective } from "./duration";
import { discoverGroundedFocalTargets, remapGroundedFocalAfterMutation } from "./focal";
import {
	buildProfessionalEditPlan,
	parseProfessionalEditIntent,
	runProfessionalEditOrchestrator,
	stripFalseProjectEditsDisabledClaim,
	stripUnsupportedTransitionClaims,
} from "./index";
import { buildPackedEditorialTranscript } from "./packedTranscript";
import { buildProfessionalEditStory } from "./story";
import { disposeFinalSequenceWarning } from "./warningDisposition";

const ARTIFACT = join(
	process.cwd(),
	"tmp/perception-benchmark/professional-edit-quality-closure-v1",
);

function write(name: string, data: unknown) {
	mkdirSync(ARTIFACT, { recursive: true });
	writeFileSync(join(ARTIFACT, name), JSON.stringify(data, null, 2), "utf8");
}

function fixtureDoc(durationSec = 13.9): AxcutDocument {
	const base = createEmptyDocument({
		title: "QC",
		projectId: "proj_qc",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "rec.mp4",
				originalPath: "/tmp/qc.mp4",
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
		},
		transcripts: [
			{
				assetId: "asset_1",
				language: "en",
				segments: [
					{
						id: "seg1",
						kind: "speech",
						startSec: 2,
						endSec: 6,
						text: "Here is the important explanation about the feature",
						wordIds: ["w0", "w1", "w2", "w3", "w4", "w5", "w6", "w7"],
					},
				],
				words: [
					{ id: "w0", segmentId: "seg1", startSec: 2, endSec: 2.4, text: "Here", source: "asr" },
					{ id: "w1", segmentId: "seg1", startSec: 2.4, endSec: 2.8, text: "is", source: "asr" },
					{ id: "w2", segmentId: "seg1", startSec: 2.8, endSec: 3.2, text: "the", source: "asr" },
					{
						id: "w3",
						segmentId: "seg1",
						startSec: 3.2,
						endSec: 3.8,
						text: "important",
						source: "asr",
					},
					{
						id: "w4",
						segmentId: "seg1",
						startSec: 3.8,
						endSec: 4.5,
						text: "explanation",
						source: "asr",
					},
					{ id: "w5", segmentId: "seg1", startSec: 4.5, endSec: 5, text: "about", source: "asr" },
					{ id: "w6", segmentId: "seg1", startSec: 5, endSec: 5.4, text: "the", source: "asr" },
					{
						id: "w7",
						segmentId: "seg1",
						startSec: 5.4,
						endSec: 6,
						text: "feature",
						source: "asr",
					},
				],
			},
		],
	});
}

function _safeDeadAir(id: string, start: number, end: number, removed: number): DeadAirCandidateV1 {
	return {
		id,
		assetId: "asset_1",
		silenceRange: { timebase: "SOURCE_MEDIA_TIME", startSec: start, endSec: end },
		proposedTrimRange: {
			timebase: "SOURCE_MEDIA_TIME",
			startSec: start + 0.2,
			endSec: end - 0.35,
		},
		silenceDurationSec: end - start,
		resultingRemovedDurationSec: removed,
		classification: "POSSIBLE_DEAD_AIR",
		confidence: "high",
		evidenceRefs: [],
		speechBoundaryState: {
			before: { kind: "speech_segment", id: "seg1" },
			after: { kind: "speech_segment", id: "seg1" },
			blocking: false,
		},
		paddingBeforeSec: 0.2,
		paddingAfterSec: 0.35,
		targetPauseKeptSec: 0.55,
		preserveConstraints: [],
		safeToPropose: true,
		blockingReasons: [],
		visualActivity: [],
		visualActivityState: "NO_MATERIAL_VISUAL_ACTIVITY",
		visualEvidenceRefs: [],
		visualBlockingReasons: [],
		visualSafetyVersion: VISUAL_SAFETY_VERSION,
		warnings: [],
	};
}

function analysis(partial: Partial<LoudnessAnalysisV1>): LoudnessAnalysisV1 {
	return {
		version: 1,
		measurementVersion: LOUDNESS_MEASUREMENT_VERSION,
		providerId: LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID,
		assetId: "asset_1",
		mediaPath: "/tmp/qc.mp4",
		analysisDomain: "PRIMARY_SOURCE_AUDIO",
		audioState: "present",
		integratedLufs: -24,
		truePeakDbTp: -10,
		loudnessRangeLra: 8,
		thresholdLufs: -36,
		durationSec: 10,
		ffmpegVersion: "test",
		parameters: { targetIntegratedLufs: -16, maxTruePeakDbTp: -1, lra: 11 },
		latencyMs: 1,
		cacheHit: false,
		...partial,
	};
}

describe("QUALITY_CLOSURE caption timing", () => {
	it("abutting continuous captions pass per-cue timing (not neighbor-active fail)", async () => {
		const doc = patchCaptionSettings(fixtureDoc(), { enabled: true }, 16 / 9);
		const { layout } = runCaptionLayoutForDocument({
			document: doc,
			assetId: "asset_1",
			aspectValue: 16 / 9,
			useCache: false,
		});
		expect(layout.status).toBe("ok");
		const v = await verifyCaptionLayoutRender({
			document: doc,
			layout,
			aspectValue: 16 / 9,
			requireNativeAuthoritative: false,
		});
		expect(v.blockingReasons.filter((b) => b.startsWith("timing_"))).toEqual([]);
	});
});

describe("QUALITY_CLOSURE focal + remap", () => {
	it("discovers grounded focal from stable cursor; never invents center", () => {
		const doc = fixtureDoc();
		const focals = discoverGroundedFocalTargets({
			document: doc,
			assetId: "asset_1",
			ranges: [{ startSec: 2, endSec: 5, reason: "speech" }],
			cursorSamples: [
				{ atSec: 2.2, cx: 0.41, cy: 0.52 },
				{ atSec: 3.0, cx: 0.42, cy: 0.51 },
				{ atSec: 3.8, cx: 0.41, cy: 0.52 },
				{ atSec: 4.5, cx: 0.42, cy: 0.52 },
			],
		});
		expect(focals.length).toBe(1);
		expect(focals[0]!.focal.cx).toBeCloseTo(0.41, 1);
	});

	it("trim before focal → STALE_BUT_REMAPPABLE; trim removing focal → invalid", () => {
		const doc = fixtureDoc();
		const focal = discoverGroundedFocalTargets({
			document: doc,
			assetId: "asset_1",
			ranges: [{ startSec: 8, endSec: 11 }],
			cursorSamples: [
				{ atSec: 8.2, cx: 0.3, cy: 0.4 },
				{ atSec: 9, cx: 0.31, cy: 0.4 },
				{ atSec: 10, cx: 0.3, cy: 0.41 },
			],
		})[0]!;
		expect(focal).toBeTruthy();

		const trimmed = documentSchema.parse({
			...doc,
			timeline: {
				...doc.timeline,
				trimRanges: [
					{
						id: "t1",
						assetId: "asset_1",
						clipId: "clip_1",
						startSec: 0.5,
						endSec: 1.5,
						reason: "pause",
						origin: "agent",
					},
				],
			},
		});
		const remapped = remapGroundedFocalAfterMutation({
			document: trimmed,
			assetId: "asset_1",
			focal,
		});
		expect(["STALE_BUT_REMAPPABLE", "STILL_VALID"]).toContain(remapped.disposition);
		expect(remapped.candidate).not.toBeNull();

		const removed = documentSchema.parse({
			...doc,
			timeline: {
				...doc.timeline,
				trimRanges: [
					{
						id: "t2",
						assetId: "asset_1",
						clipId: "clip_1",
						startSec: 8,
						endSec: 11,
						reason: "cut_focal",
						origin: "agent",
					},
				],
			},
		});
		const gone = remapGroundedFocalAfterMutation({
			document: removed,
			assetId: "asset_1",
			focal,
		});
		expect(gone.disposition).toBe("STALE_AND_INVALID");
		expect(gone.candidate).toBeNull();
	});
});

describe("QUALITY_CLOSURE loudness + warnings + restraint", () => {
	it("already acceptable → no mutation; peak-risk blocked; useful quiet → safe", () => {
		const ok = buildNormalizeCandidate({
			analysis: analysis({ integratedLufs: -16.2, truePeakDbTp: -3 }),
			document: fixtureDoc(),
		});
		expect(ok.classification).toBe("ALREADY_ACCEPTABLE");
		expect(ok.safeToPropose).toBe(false);

		const peak = buildNormalizeCandidate({
			analysis: analysis({ integratedLufs: -15, truePeakDbTp: 0.5 }),
			document: fixtureDoc(),
		});
		expect(peak.classification).toBe("TRUE_PEAK_RISK");
		expect(peak.safeToPropose).toBe(false);

		const quiet = buildNormalizeCandidate({
			analysis: analysis({ integratedLufs: -24, truePeakDbTp: -12 }),
			document: fixtureDoc(),
		});
		expect(quiet.classification).toBe("TOO_QUIET");
		expect(quiet.safeToPropose).toBe(true);
	});

	it("warning dispositions classify honestly", () => {
		expect(disposeFinalSequenceWarning("no_pcm_provider").disposition).toBe(
			"INSUFFICIENT_EVIDENCE",
		);
		expect(disposeFinalSequenceWarning("intentional_visual_discontinuity").disposition).toBe(
			"ACCEPTABLE_INTENTIONAL",
		);
		expect(disposeFinalSequenceWarning("caption_continuity_gap").disposition).toBe(
			"ACTIONABLE_EXISTING_CAPABILITY",
		);
	});

	it("already-good → no unnecessary edits; no fake settings/transitions; editor copy", async () => {
		const r = await runProfessionalEditOrchestrator({
			document: fixtureDoc(6),
			assetId: "asset_1",
			userMessage: "Make this professional. You decide.",
			injectedDeadAir: [],
			executionMode: "plan_only",
			skipFinalSequenceQc: true,
			settingsEditsAllowed: true,
		});
		expect(r.metrics.stepsCommitted).toBe(0);
		expect(r.metrics.paidAiCalls).toBe(0);
		expect(r.metrics.autoUnverifiedMutations).toBe(0);
		expect(r.capabilityUtilization.invariant).toBe("MORE_EDITS_NE_MORE_PROFESSIONAL");
		expect(r.userFacingText).toMatch(
			/kept it unchanged|reviewed the recording|reviewed the current cut/i,
		);
		expect(r.userFacingText).not.toMatch(/cursor focal|peak limited|programme fingerprint/i);
		expect(
			stripFalseProjectEditsDisabledClaim("Please re-enable project edits in the settings.", true),
		).not.toMatch(/re-enable/i);
		expect(stripUnsupportedTransitionClaims("I'll add transitions.")).not.toMatch(/I'll add/i);
		write("unit-already-good.json", {
			util: r.capabilityUtilization,
			assessment: r.assessment,
		});
	});

	it("grounded zoom fixture → concrete geometry → verified apply candidate", async () => {
		// Click + local dwell (not mere parking) — Local Editorial Focal Evidence V1
		const samples = [
			{ atSec: 3.0, cx: 0.55, cy: 0.45, interactionType: "click" as const },
			{ atSec: 3.15, cx: 0.55, cy: 0.45, interactionType: "move" as const },
			{ atSec: 3.4, cx: 0.56, cy: 0.45, interactionType: "move" as const },
			{ atSec: 3.8, cx: 0.55, cy: 0.46, interactionType: "move" as const },
			{ atSec: 4.2, cx: 0.55, cy: 0.45, interactionType: "move" as const },
			{ atSec: 4.6, cx: 0.55, cy: 0.45, interactionType: "move" as const },
		];
		const r = await runProfessionalEditOrchestrator({
			document: fixtureDoc(),
			assetId: "asset_1",
			userMessage: "Make professional with a zoom where useful. You decide.",
			injectedDeadAir: [],
			cursorSamples: samples,
			executionMode: "verified_apply",
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
			skipFinalSequenceQc: true,
		});
		const zoomRow = r.capabilityUtilization.rows.find((x) => x.family === "zoom")!;
		expect(zoomRow.evidenceFound).toBe(true);
		expect(r.focalAnalysis?.zoomDecision.decision).toBe("ZOOM_ELIGIBLE");
		expect(zoomRow.parametersGrounded).toBe(true);
		write("unit-grounded-zoom.json", {
			plan: r.plan.steps.filter((s) => s.family === "zoom"),
			util: zoomRow,
			focal: r.focalAnalysis?.zoomDecision,
			committed: r.assessment.operationsApplied,
		});
		expect(
			r.plan.steps.some((s) => s.family === "zoom") || zoomRow.committed || zoomRow.attempted,
		).toBe(true);
	});
});
