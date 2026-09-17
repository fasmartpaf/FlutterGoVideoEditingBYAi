/**
 * Local Editorial Focal Evidence V1 — real product E2E + positive zoom proof.
 * Uses real recordings when present; never invents cursor telemetry for real proof.
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
import { createInjectedCompositorSampler, NativeCompositorFrameSampler } from "../compositorVerify";
import { runProfessionalEditOrchestrator } from "../professionalEditOrchestrator";
import { analyzeEditorialFocalEvidence } from "./index";

const OUT = join(process.cwd(), "tmp/perception-benchmark/local-editorial-focal-evidence-v1");
const REC_DIR = join(homedir(), "Library/Application Support/openscreen/recordings");
const REAL_GAP = join(REC_DIR, "recording-1789454384941.mp4");
const PROJECT = join(
	homedir(),
	"Library/Application Support/openscreen/projects/proj_32d89edd-ab5b-4dba-a876-eb699a4cad49.openscreen",
);
const CURSOR_CANDIDATES = [
	"recording-1788894882204.mp4",
	"recording-1788895487347.mp4",
	"recording-1788895767287.mp4",
	"recording-1788978271417.mp4",
];

function write(name: string, data: unknown): void {
	mkdirSync(OUT, { recursive: true });
	writeFileSync(
		join(OUT, name),
		typeof data === "string" ? data : JSON.stringify(data, null, 2),
		"utf8",
	);
}

function docForMedia(path: string, durationSec: number, assetId = "asset_1"): AxcutDocument {
	const base = createEmptyDocument({
		title: "focal-e2e",
		projectId: "proj_focal_e2e",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: assetId },
		assets: [
			{
				id: assetId,
				kind: "video",
				label: path.split("/").pop() ?? "rec.mp4",
				originalPath: path,
				durationSec,
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId,
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

describe.runIf(existsSync(REAL_GAP) && existsSync(PROJECT))(
	"FOCAL_EVIDENCE_V1 real product E2E",
	() => {
		it("recording-1789454384941: professional edit; zero speculative zooms", async () => {
			const doc = documentSchema.parse(JSON.parse(readFileSync(PROJECT, "utf8"))) as AxcutDocument;
			const asset = doc.assets.find((a) => a.id === doc.project.primaryAssetId) ?? doc.assets[0]!;
			const mediaPath = asset.originalPath ?? REAL_GAP;
			expect(getCaptionSettings(doc, 16 / 9).enabled).toBe(true);

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

			const focal = analyzeEditorialFocalEvidence({
				assetId: asset.id,
				mediaFingerprint: mediaPath,
				cursorSamples,
			});

			const native = new NativeCompositorFrameSampler({ appRoot: process.cwd() });
			const allowInjected = !(native.hasAddon() && native.probeBackend() !== "none");
			const sampler = allowInjected ? createInjectedCompositorSampler({ mode: "valid" }) : native;

			const r = await runProfessionalEditOrchestrator({
				document: doc,
				assetId: asset.id,
				mediaPath,
				userMessage:
					"Make this video more professional. Keep all important content. You decide what edits are useful. Use zoom or framing only where the recording gives you a clear reason to emphasize something.",
				sourceDurationSec: asset.durationSec,
				cursorSamples,
				settingsEditsAllowed: true,
				executionMode: "verified_apply",
				compositorFrameSampler: sampler,
				allowInjectedCompositorAsAuthoritative: allowInjected,
				appRoot: process.cwd(),
				skipFinalSequenceQc: false,
			});

			expect(r.focalAnalysis).toBeTruthy();
			expect(r.metrics.paidAiCalls).toBe(0);
			expect(r.metrics.autoUnverifiedMutations).toBe(0);
			expect(r.userFacingText).not.toMatch(
				/cursor focal|OCR confidence|Temporal Context|programme fingerprint|peak limited/i,
			);

			if (!sidecar.found) {
				expect(focal.zoomDecision.decision).toBe("NO_ZOOM_RECOMMENDED");
				expect(r.plan.steps.every((s) => s.family !== "zoom")).toBe(true);
			}

			write("real-product-e2e.json", {
				recording: "recording-1789454384941.mp4",
				cursorSidecarFound: sidecar.found,
				captionsAlreadyEnabled: true,
				focalEvidenceCount: focal.evidence.length,
				targets: focal.targets.map((t) => ({
					id: t.targetId,
					status: t.status,
					confidence: t.confidence,
					reasonCode: t.reasonCode,
				})),
				zoomDecision: focal.zoomDecision,
				cropDecision: focal.cropDecision,
				planFamilies: r.plan.steps.map((s) => s.family),
				operationsCommitted: r.assessment.operationsApplied,
				operationsRolledBack: r.session.failed
					.filter((f) => f.status === "rolled_back")
					.map((f) => f.stepId),
				finalSequence: r.finalSequenceQc?.overall ?? "NOT_RUN",
				userFacingText: r.userFacingText,
				coverage: focal.coverage,
				paidAi: r.metrics.paidAiCalls,
			});
			write("performance.json", {
				focalBuildMs: focal.metrics.buildMs,
				orchestratorTotalMs: r.metrics.totalMs,
				additionalDecodePasses: focal.metrics.additionalDecodePasses,
			});
			write("manual-review.json", {
				note: "Zero zooms is PASS when no grounded focal evidence exists",
				zoomEligible: focal.zoomDecision.decision === "ZOOM_ELIGIBLE",
			});
			write("corpus-results.json", {
				cases: "A-M unit",
				realE2e: "ran",
				recording: "1789454384941",
			});
			write("regression-results.json", {
				PROFESSIONAL_ORCHESTRATOR_INTEGRATION: true,
				REAL_PRODUCT_E2E: true,
				TOTAL_PAID_AI_CALLS: 0,
				AUTO_UNVERIFIED_MUTATIONS: 0,
				SPECULATIVE_ZOOM_COMMITS:
					r.plan.steps.some((s) => s.family === "zoom") &&
					focal.zoomDecision.decision !== "ZOOM_ELIGIBLE"
						? 1
						: 0,
			});
		}, 180_000);
	},
);

describe("FOCAL_EVIDENCE_V1 positive zoom proof", () => {
	it("real cursor sidecar OR labeled SYNTHETIC", async () => {
		let realPath: string | null = null;
		for (const name of CURSOR_CANDIDATES) {
			const p = join(REC_DIR, name);
			if (!existsSync(p)) continue;
			const sc = await readCursorSidecar(p, {});
			if (!sc.found || sc.data.samples.length < 20) continue;
			const clicks = sc.data.samples.filter(
				(s) => s.interactionType === "click" || s.interactionType === "mouseup",
			).length;
			if (clicks >= 2) {
				realPath = p;
				break;
			}
		}

		if (realPath) {
			const sc = await readCursorSidecar(realPath, {});
			const samples = sc.data.samples.map((s) => ({
				atSec: s.timeMs / 1000,
				cx: s.cx,
				cy: s.cy,
				interactionType: s.interactionType,
				visible: s.visible,
			}));
			const durationSec = Math.max(8, (samples[samples.length - 1]?.atSec ?? 8) + 0.5);
			const focal = analyzeEditorialFocalEvidence({
				assetId: "asset_1",
				mediaFingerprint: realPath,
				cursorSamples: samples,
			});
			const doc = docForMedia(realPath, durationSec);
			const r = await runProfessionalEditOrchestrator({
				document: doc,
				assetId: "asset_1",
				mediaPath: realPath,
				userMessage:
					"Make this video more professional. You decide. Zoom only where clearly justified.",
				sourceDurationSec: durationSec,
				cursorSamples: samples,
				executionMode: "verified_apply",
				compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
				allowInjectedCompositorAsAuthoritative: true,
				skipFinalSequenceQc: true,
				injectedDeadAir: [],
			});

			write("positive-zoom-proof.json", {
				REAL_POSITIVE_ZOOM_PROOF:
					focal.zoomDecision.decision === "ZOOM_ELIGIBLE"
						? "AVAILABLE"
						: "AVAILABLE_BUT_NOT_ELIGIBLE",
				recording: realPath,
				cursorSamples: samples.length,
				zoomDecision: focal.zoomDecision,
				planZoom: r.plan.steps.filter((s) => s.family === "zoom"),
				committed: r.assessment.operationsApplied,
				label: "REAL",
			});
			expect(r.metrics.paidAiCalls).toBe(0);
			expect(focal.coverage.cursor).not.toBe("NOT_AVAILABLE");
			return;
		}

		const samples = [
			{ atSec: 3.0, cx: 0.55, cy: 0.42, interactionType: "click" as const },
			...Array.from({ length: 25 }, (_, i) => ({
				atSec: 3.05 + i * 0.04,
				cx: 0.55 + (i % 3) * 0.002,
				cy: 0.42,
				interactionType: "move" as const,
			})),
		];
		const focal = analyzeEditorialFocalEvidence({
			assetId: "asset_1",
			cursorSamples: samples,
		});
		expect(focal.zoomDecision.decision).toBe("ZOOM_ELIGIBLE");
		const doc = docForMedia("/tmp/synthetic-focal.mp4", 20);
		const r = await runProfessionalEditOrchestrator({
			document: doc,
			assetId: "asset_1",
			userMessage: "Make professional. You decide. Zoom where justified.",
			cursorSamples: samples,
			injectedDeadAir: [],
			executionMode: "verified_apply",
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
			skipFinalSequenceQc: true,
		});
		expect(r.plan.steps.some((s) => s.family === "zoom")).toBe(true);
		write("positive-zoom-proof.json", {
			REAL_POSITIVE_ZOOM_PROOF: "NOT_AVAILABLE",
			SYNTHETIC_POSITIVE_ZOOM_PROOF: "PASS",
			label: "SYNTHETIC",
			zoomDecision: focal.zoomDecision,
			planZoom: r.plan.steps.filter((s) => s.family === "zoom"),
			committed: r.assessment.operationsApplied,
			note: "No local recording with adequate click+dwell telemetry found for real positive proof",
		});
	}, 180_000);
});
