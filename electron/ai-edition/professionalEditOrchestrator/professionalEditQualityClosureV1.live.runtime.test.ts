/**
 * Quality Closure V1 — real recording E2E (recording-1789424212470 when present).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type AxcutDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { createInjectedCompositorSampler, NativeCompositorFrameSampler } from "../compositorVerify";
import { runProfessionalEditOrchestrator } from "./index";

const ARTIFACT = path.join(
	process.cwd(),
	"tmp/perception-benchmark/professional-edit-quality-closure-v1",
);
const PROJECT = path.join(
	os.homedir(),
	"Library/Application Support/openscreen/projects/proj_e63f1a50-6a31-4074-b8e1-be6185c56c51.openscreen",
);
const MEDIA = path.join(
	os.homedir(),
	"Library/Application Support/openscreen/recordings/recording-1789424212470.mp4",
);

const USER =
	"Make this video professional and keep it under 5–7 seconds. Don't delete important stuff. Use trims, zoom, captions, speed/audio improvements where they help. You decide.";

function writeJson(name: string, data: unknown) {
	mkdirSync(ARTIFACT, { recursive: true });
	writeFileSync(path.join(ARTIFACT, name), JSON.stringify(data, null, 2), "utf8");
}

function baselineWithoutAgentDeadAirTrims(doc: AxcutDocument): AxcutDocument {
	return documentSchema.parse({
		...doc,
		timeline: {
			...doc.timeline,
			trimRanges: (doc.timeline.trimRanges ?? []).filter(
				(t) => !(t.origin === "agent" && /dead_air/i.test(t.reason ?? "")),
			),
		},
	});
}

describe("PROFESSIONAL_EDIT_QUALITY_CLOSURE_V1 real recording", () => {
	it("utilizes capabilities intelligently on recording-1789424212470", async () => {
		if (!existsSync(PROJECT) || !existsSync(MEDIA)) {
			writeJson("real-recording-e2e-skipped.json", { reason: "missing" });
			return;
		}
		const loaded = documentSchema.parse(JSON.parse(readFileSync(PROJECT, "utf8"))) as AxcutDocument;
		const doc = baselineWithoutAgentDeadAirTrims(loaded);
		const asset = doc.assets.find((a) => a.id === doc.project.primaryAssetId) ?? doc.assets[0]!;

		const native = new NativeCompositorFrameSampler({ appRoot: process.cwd() });
		const allowInjected = !(native.hasAddon() && native.probeBackend() !== "none");
		const sampler = allowInjected ? createInjectedCompositorSampler({ mode: "valid" }) : native;

		// Optional cursor sidecar samples if present on media path
		let cursorSamples: Array<{ atSec: number; cx: number; cy: number }> | null = null;
		const sessionJson = MEDIA.replace(/\.mp4$/, ".session.json");
		if (existsSync(sessionJson)) {
			try {
				const sess = JSON.parse(readFileSync(sessionJson, "utf8")) as {
					cursor?: Array<{ t?: number; cx?: number; cy?: number; timeMs?: number }>;
				};
				const raw = sess.cursor ?? [];
				cursorSamples = raw
					.filter((p) => typeof p.cx === "number" && typeof p.cy === "number")
					.map((p) => ({
						atSec: typeof p.t === "number" ? p.t : (p.timeMs ?? 0) / 1000,
						cx: p.cx!,
						cy: p.cy!,
					}))
					.slice(0, 400);
			} catch {
				cursorSamples = null;
			}
		}

		const result = await runProfessionalEditOrchestrator({
			document: doc,
			assetId: asset.id,
			mediaPath: asset.originalPath ?? MEDIA,
			userMessage: USER,
			sourceDurationSec: asset.durationSec,
			cursorSamples,
			settingsEditsAllowed: true,
			executionMode: "verified_apply",
			compositorFrameSampler: sampler,
			allowInjectedCompositorAsAuthoritative: allowInjected,
			appRoot: process.cwd(),
			skipFinalSequenceQc: false,
		});

		writeJson("real-recording-e2e.json", {
			originalDuration: asset.durationSec,
			targetDuration: result.intent.targetDurationMaxSec,
			durationSafety: result.duration,
			capabilityUtilization: result.capabilityUtilization,
			planFamilies: result.plan.steps.map((s) => s.family),
			operationsCommitted: result.assessment.operationsApplied,
			operationsRolledBack: result.session.failed.filter((f) => f.status === "rolled_back"),
			finalDuration: result.session.finalProgrammeDurationSec,
			captionsFinal: result.capabilityUtilization.rows.find((r) => r.family === "captions"),
			loudnessFinal: result.loudness,
			zoomFinal: result.capabilityUtilization.rows.find((r) => r.family === "zoom"),
			finalSequence: result.finalSequenceQc ? { overall: result.finalSequenceQc.overall } : null,
			warningDispositions: result.warningDispositions,
			professionalKind: result.assessment.professionalKind,
			userFacingText: result.userFacingText,
			metrics: result.metrics,
			harness: { allowInjected },
		});

		expect(result.metrics.paidAiCalls).toBe(0);
		expect(result.metrics.autoUnverifiedMutations).toBe(0);
		expect(
			result.capabilityUtilization.rows.every((r) => r.skippedReason !== "not_considered_yet"),
		).toBe(true);
		expect(result.userFacingText).not.toMatch(/re-enable project edits/i);
		expect(result.userFacingText).not.toMatch(/I'll add transitions/i);
		if (result.duration.kind === "NOT_ACHIEVABLE_WITHOUT_IMPORTANT_CONTENT_LOSS") {
			expect(result.session.finalProgrammeDurationSec ?? 99).toBeGreaterThan(7);
		}
	}, 240_000);
});
