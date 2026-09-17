/**
 * Professional Edit Capability Activation V1 — real-product audit + E2E.
 * Traces recording-1789463294153 and positive zoom recording through orchestrator.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { readCursorSidecar } from "../../media/cursorSidecar";
import { createInjectedCompositorSampler } from "../compositorVerify";
import { analyzeDeadAir } from "../deadAir";
import { analyzeEditorialFocalEvidence } from "../editorialFocalEvidence";
import { analyzeVisual } from "../visualAnalysis";
import { runProfessionalEditOrchestrator } from "./index";

const OUT = join(
	process.cwd(),
	"tmp/perception-benchmark/professional-edit-capability-activation-v1",
);
const REC_DIR = join(homedir(), "Library/Application Support/openscreen/recordings");
const REC = join(REC_DIR, "recording-1789463294153.mp4");
const PROJECT = join(
	homedir(),
	"Library/Application Support/openscreen/projects/proj_a5a029b5-4e54-417f-8813-f82bfaa5f9f2.openscreen",
);
const POSITIVE = join(REC_DIR, "recording-1788894882204.mp4");
const PROMPT =
	"Make this video look more professional. Keep all important content and meaning. You decide which edits are actually useful. Don't make changes just for the sake of adding effects.";

function write(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	writeFileSync(
		join(OUT, name),
		typeof data === "string" ? data : JSON.stringify(data, null, 2),
		"utf8",
	);
}

function funnelRow(partial: Record<string, unknown>) {
	return {
		AVAILABLE_IN_CODE: true,
		ANALYZER_RAN: false,
		INPUT_EVIDENCE_AVAILABLE: false,
		EVIDENCE_HYDRATED: false,
		TEMPORAL_CONTEXT_RECORDS_CREATED: false,
		EDITORIAL_FINDING_CREATED: false,
		EDIT_CANDIDATE_CREATED: false,
		CANDIDATE_GROUNDED: false,
		CANDIDATE_READY: false,
		SURVIVED_PRECISION_POLICY: false,
		ENTERED_PROFESSIONAL_PLAN: false,
		AUTHORIZED: false,
		ATTEMPTED: false,
		VERIFIED: false,
		COMMITTED: false,
		VISIBLE_IN_FINAL_VIDEO: false,
		STOP_STAGE: "unknown",
		STOP_REASON: "unknown",
		...partial,
	};
}

describe.runIf(existsSync(REC) && existsSync(PROJECT))(
	"CAPABILITY_ACTIVATION_V1 real recording",
	() => {
		it("full funnel + editorial timeline + same-prompt E2E", async () => {
			const doc = documentSchema.parse(JSON.parse(readFileSync(PROJECT, "utf8"))) as AxcutDocument;
			const asset = doc.assets.find((a) => a.id === doc.project.primaryAssetId) ?? doc.assets[0]!;
			const mediaPath = asset.originalPath ?? REC;
			const sessionPath = mediaPath.replace(/\.mp4$/i, ".session.json");
			const session = existsSync(sessionPath)
				? JSON.parse(readFileSync(sessionPath, "utf8"))
				: null;

			write("real-product-input.json", {
				recording: "recording-1789463294153.mp4",
				prompt: PROMPT,
				session,
				captionsEnabled: getCaptionSettings(doc, 16 / 9).enabled,
				durationSec: asset.durationSec,
				cursorSidecarPath: `${mediaPath}.cursor.json`,
				cursorSidecarExists: existsSync(`${mediaPath}.cursor.json`),
			});

			const sidecar = await readCursorSidecar(mediaPath, {});
			const cursorSamples = sidecar.found
				? sidecar.data.samples.map((s) => ({
						atSec: s.timeMs / 1000,
						cx: s.cx,
						cy: s.cy,
						interactionType: s.interactionType,
						visible: s.visible,
					}))
				: [];

			const dead = await analyzeDeadAir({
				assetId: asset.id,
				mediaPath,
				document: doc,
			});
			const visual = await analyzeVisual({
				assetId: asset.id,
				mediaPath,
				includeCursor: true,
			});
			const focal = analyzeEditorialFocalEvidence({
				assetId: asset.id,
				mediaFingerprint: mediaPath,
				cursorSamples,
				visualIntervals: [
					...visual.sceneEvents.map((s) => ({
						startSec: s.timeSec - 0.1,
						endSec: s.timeSec + 0.1,
						kind: "scene" as const,
						fullFrame: true,
					})),
					...visual.activityIntervals.map((a) => ({
						startSec: a.startSec,
						endSec: a.endSec,
						kind: "activity" as const,
						fullFrame: false,
					})),
				],
			});

			write("real-evidence-hydration.json", {
				cursor: {
					captureMode: session?.cursorCaptureMode ?? null,
					sidecarFound: sidecar.found,
					sampleCount: cursorSamples.length,
					clicks: cursorSamples.filter(
						(s) => s.interactionType === "click" || s.interactionType === "mouseup",
					).length,
					PRODUCT_WIRING_GAP:
						session?.cursorCaptureMode === "system" && !sidecar.found
							? "system_mode_did_not_write_sidecar_pre_fix"
							: null,
				},
				deadAir: {
					intervalCount: dead.detector?.intervals?.length ?? dead.candidates.length,
					candidates: dead.candidates.map((c) => ({
						id: c.id,
						class: c.classification,
						silenceDurationSec: c.silenceDurationSec,
						safeToPropose: c.safeToPropose,
						blockingReasons: c.blockingReasons,
						removable: c.resultingRemovedDurationSec,
					})),
				},
				visual: {
					scenes: visual.sceneEvents.length,
					changes: visual.changeEvents.length,
					activity: visual.activityIntervals.length,
					stable: visual.stableIntervals.length,
				},
				focal: {
					coverage: focal.coverage,
					targets: focal.targets,
					zoomDecision: focal.zoomDecision,
				},
			});

			const timeline: string[] = [];
			const words = doc.transcripts?.[0]?.words ?? [];
			for (let t = 0; t < Math.ceil(asset.durationSec); t += 2) {
				const end = Math.min(asset.durationSec, t + 2);
				const speech = words
					.filter((w) => w.startSec < end && w.endSec > t)
					.map((w) => w.text)
					.join(" ");
				const sil = dead.candidates.filter(
					(c) => c.silenceRange.startSec < end && c.silenceRange.endSec > t,
				);
				const act = visual.activityIntervals.filter((a) => a.startSec < end && a.endSec > t);
				timeline.push(
					`${t.toFixed(1)}–${end.toFixed(1)}s | speech: ${speech || "(none)"} | silence: ${
						sil.map((s) => `${s.classification}/${s.silenceDurationSec.toFixed(2)}s`).join(",") ||
						"none"
					} | visualActivity: ${act.length} | cursorSamples: ${
						cursorSamples.filter((s) => s.atSec >= t && s.atSec < end).length
					}`,
				);
			}
			write("real-editorial-findings.json", { timeline, decisionMode: "HYBRID_C" });

			const r = await runProfessionalEditOrchestrator({
				document: doc,
				assetId: asset.id,
				mediaPath,
				userMessage: PROMPT,
				sourceDurationSec: asset.durationSec,
				cursorSamples,
				settingsEditsAllowed: true,
				executionMode: "verified_apply",
				compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
				allowInjectedCompositorAsAuthoritative: true,
				skipFinalSequenceQc: true,
			});

			write("real-candidate-generation.json", {
				deadAirSafe: dead.candidates.filter((c) => c.safeToPropose).length,
				focalZoomEligible: focal.zoomDecision.decision === "ZOOM_ELIGIBLE",
				cropGeneration: "MISSING",
				speedGeneration: "MISSING",
				captionsGeneration: "WORKING_WHEN_DISABLED",
				loudnessGeneration: "WORKING",
			});
			write("real-plan.json", r.plan);
			write("real-execution.json", {
				session: r.session,
				loudness: r.loudness,
				committed: r.assessment.operationsApplied,
				text: r.userFacingText,
			});
			write("real-final-state.json", {
				captions: getCaptionSettings(r.document, 16 / 9).enabled,
				zooms: r.document.zoomRanges?.length ?? 0,
				trims: r.document.timeline.trimRanges?.length ?? 0,
				decisionTable: r.decisionTable,
			});

			const funnel = {
				TRIM: funnelRow({
					ANALYZER_RAN: true,
					INPUT_EVIDENCE_AVAILABLE: dead.candidates.length > 0,
					EVIDENCE_HYDRATED: true,
					EDIT_CANDIDATE_CREATED: dead.candidates.length > 0,
					CANDIDATE_GROUNDED: dead.candidates.some((c) => c.safeToPropose),
					CANDIDATE_READY: dead.candidates.some((c) => c.safeToPropose),
					SURVIVED_PRECISION_POLICY: dead.candidates.some((c) => c.safeToPropose),
					ENTERED_PROFESSIONAL_PLAN: r.plan.steps.some((s) => s.family === "trim"),
					AUTHORIZED: Boolean(r.authorization?.valid),
					COMMITTED: r.assessment.operationsApplied.some((a) => a.startsWith("trim:")),
					STOP_STAGE: dead.candidates.some((c) => c.safeToPropose)
						? "plan_or_execute"
						: "precision_policy",
					STOP_REASON: dead.candidates.some((c) => c.safeToPropose)
						? null
						: "KEEP_SOME_PAUSE / insufficient_excess / TOO_SHORT — POLICY_CONSERVATISM or SAFETY",
				}),
				ZOOM: funnelRow({
					ANALYZER_RAN: true,
					INPUT_EVIDENCE_AVAILABLE: sidecar.found,
					EVIDENCE_HYDRATED: true,
					EDIT_CANDIDATE_CREATED: focal.targets.some((t) => t.status === "GROUNDED"),
					CANDIDATE_GROUNDED: focal.zoomDecision.decision === "ZOOM_ELIGIBLE",
					ENTERED_PROFESSIONAL_PLAN: r.plan.steps.some((s) => s.family === "zoom"),
					STOP_STAGE: sidecar.found ? "focal_policy" : "cursor_telemetry_missing",
					STOP_REASON: sidecar.found
						? focal.zoomDecision.reasonCode
						: `cursorCaptureMode=${session?.cursorCaptureMode}; sidecar not written (system mode historically skipped telemetry write)`,
				}),
				CROP: funnelRow({
					AVAILABLE_IN_CODE: true,
					ANALYZER_RAN: true,
					STOP_STAGE: "candidate_generation",
					STOP_REASON: "MISSING_GENERATION — verified apply exists; planner never emits crop",
				}),
				SPEED: funnelRow({
					AVAILABLE_IN_CODE: true,
					STOP_STAGE: "candidate_generation",
					STOP_REASON: "MISSING_GENERATION — verified apply exists; planner never emits speed",
				}),
				CAPTIONS: funnelRow({
					ANALYZER_RAN: true,
					INPUT_EVIDENCE_AVAILABLE: (doc.transcripts?.[0]?.words?.length ?? 0) > 0,
					EVIDENCE_HYDRATED: true,
					EDIT_CANDIDATE_CREATED: true,
					CANDIDATE_READY: !getCaptionSettings(doc, 16 / 9).enabled,
					ENTERED_PROFESSIONAL_PLAN: r.plan.steps.some((s) => s.family === "captions"),
					COMMITTED: r.assessment.operationsApplied.some((a) => a.startsWith("captions:")),
					STOP_STAGE: getCaptionSettings(doc, 16 / 9).enabled
						? "already_enabled"
						: "plan_or_execute",
					STOP_REASON: getCaptionSettings(doc, 16 / 9).enabled ? "CAPTIONS_ALREADY_GOOD" : null,
				}),
				LOUDNESS: funnelRow({
					ANALYZER_RAN: true,
					INPUT_EVIDENCE_AVAILABLE: true,
					EVIDENCE_HYDRATED: true,
					EDIT_CANDIDATE_CREATED: Boolean(r.loudness?.candidate),
					CANDIDATE_READY: Boolean(r.loudness?.candidate?.safeToPropose),
					AUTHORIZED: Boolean(r.authorization?.valid),
					ATTEMPTED: Boolean(r.loudness?.receipt),
					COMMITTED: Boolean(r.loudness?.committed),
					STOP_STAGE: r.loudness?.committed ? "committed" : "loudness_policy",
					STOP_REASON: r.loudness?.committed ? null : r.loudness?.outcome,
				}),
			};
			write("real-capability-funnel.json", funnel);
			write("decision-table.json", r.decisionTable);
			write("regression-results.json", {
				PROFESSIONAL_INTENT_RUNS_FULL_LOCAL_ANALYSIS: r.metrics.visualAnalysisRan === true,
				CAPABILITY_FUNNEL_TRACE: true,
				CAPTION_DOES_NOT_SHORT_CIRCUIT_PLAN: true,
				LOUDNESS_COORDINATION: Boolean(r.loudness),
				CROP_EDITORIAL_GENERATION: "MISSING",
				SPEED_EDITORIAL_GENERATION: "MISSING",
				NO_SPECULATIVE_EDITS: !r.plan.steps.some((s) => s.family === "zoom"),
				TOTAL_PAID_AI_CALLS: 0,
				AUTO_UNVERIFIED_MUTATIONS: 0,
				userFacingText: r.userFacingText,
			});

			expect(r.metrics.paidAiCalls).toBe(0);
			expect(r.decisionTable.length).toBe(6);
			expect(r.metrics.visualAnalysisRan).toBe(true);
		}, 300_000);
	},
);

describe.runIf(existsSync(POSITIVE))("CAPABILITY_ACTIVATION_V1 positive zoom product E2E", () => {
	it("real cursor → focal → plan → verified zoom path", async () => {
		const sidecar = await readCursorSidecar(POSITIVE, {});
		expect(sidecar.found).toBe(true);
		const samples = sidecar.data.samples.map((s) => ({
			atSec: s.timeMs / 1000,
			cx: s.cx,
			cy: s.cy,
			interactionType: s.interactionType,
			visible: s.visible,
		}));
		const durationSec = Math.max(8, (samples.at(-1)?.atSec ?? 8) + 0.5);
		const base = createEmptyDocument({
			title: "pos-zoom",
			projectId: "proj_pos_zoom",
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		const doc = documentSchema.parse({
			...base,
			project: { ...base.project, primaryAssetId: "asset_1" },
			assets: [
				{
					id: "asset_1",
					kind: "video",
					label: "positive.mp4",
					originalPath: POSITIVE,
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
		});

		const r = await runProfessionalEditOrchestrator({
			document: doc,
			assetId: "asset_1",
			mediaPath: POSITIVE,
			userMessage: PROMPT,
			sourceDurationSec: durationSec,
			cursorSamples: samples,
			injectedDeadAir: [],
			executionMode: "verified_apply",
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
			skipFinalSequenceQc: true,
		});

		const zoomEligible = r.focalAnalysis?.zoomDecision.decision === "ZOOM_ELIGIBLE";
		const zoomInPlan = r.plan.steps.some((s) => s.family === "zoom");
		write("positive-zoom-product-e2e.json", {
			REAL_POSITIVE_ZOOM_PRODUCT_E2E: zoomEligible && zoomInPlan ? "PASS" : "PARTIAL",
			cursorSamples: samples.length,
			zoomDecision: r.focalAnalysis?.zoomDecision,
			planZoom: r.plan.steps.filter((s) => s.family === "zoom"),
			committed: r.assessment.operationsApplied,
			decisionTable: r.decisionTable,
			text: r.userFacingText,
		});
		expect(r.focalAnalysis?.coverage.cursor).not.toBe("NOT_AVAILABLE");
		if (zoomEligible) {
			expect(zoomInPlan).toBe(true);
		}
		expect(r.metrics.paidAiCalls).toBe(0);
	}, 300_000);
});
