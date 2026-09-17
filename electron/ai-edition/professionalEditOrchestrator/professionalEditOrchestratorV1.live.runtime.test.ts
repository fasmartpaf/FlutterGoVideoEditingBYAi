/**
 * Professional Edit Orchestrator V1 — real recording end-to-end (local, 0 paid AI).
 * Uses recording-1789424212470 when present; skips otherwise (not hardcoded as required).
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
	"tmp/perception-benchmark/professional-edit-orchestrator-v1",
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

/** Fresh baseline: drop prior agent dead-air trims so the orchestrator can re-plan. */
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

describe("PROFESSIONAL_EDIT_ORCHESTRATOR_V1 real recording", () => {
	it("runs grounded multi-step plan on recording-1789424212470 when available", async () => {
		if (!existsSync(PROJECT) || !existsSync(MEDIA)) {
			writeJson("real-recording-e2e-skipped.json", {
				reason: "project_or_media_missing",
				PROJECT,
				MEDIA,
			});
			return;
		}

		const raw = JSON.parse(readFileSync(PROJECT, "utf8")) as unknown;
		const loaded = documentSchema.parse(raw) as AxcutDocument;
		const doc = baselineWithoutAgentDeadAirTrims(loaded);
		const asset =
			doc.assets.find((a) => a.id === doc.project.primaryAssetId) ??
			doc.assets.find((a) => a.kind !== "audio");
		expect(asset).toBeTruthy();
		const assetId = asset!.id;
		const originalDuration = asset!.durationSec ?? 0;

		let sampler:
			| NativeCompositorFrameSampler
			| ReturnType<typeof createInjectedCompositorSampler>
			| null = null;
		let allowInjected = false;
		const native = new NativeCompositorFrameSampler({ appRoot: process.cwd() });
		if (native.hasAddon() && native.probeBackend() !== "none") {
			sampler = native;
		} else {
			sampler = createInjectedCompositorSampler({ mode: "valid" });
			allowInjected = true;
		}

		const result = await runProfessionalEditOrchestrator({
			document: doc,
			assetId,
			mediaPath: asset!.originalPath ?? MEDIA,
			userMessage: USER,
			sourceDurationSec: originalDuration,
			settingsEditsAllowed: true,
			executionMode: "verified_apply",
			compositorFrameSampler: sampler ?? undefined,
			allowInjectedCompositorAsAuthoritative: allowInjected,
			appRoot: process.cwd(),
			skipFinalSequenceQc: false,
		});

		writeJson("real-recording-e2e.json", {
			originalDuration,
			targetDuration: result.intent.targetDurationMaxSec,
			baselineTrimCount: doc.timeline.trimRanges?.length ?? 0,
			packedSegments: result.packed.segments.length,
			story: result.story,
			protectedSpeech: result.story.mustSurviveSpeech,
			durationAssessment: result.duration,
			plan: result.plan,
			requestedUnsupported: result.plan.requestedButUnsupported,
			session: result.session,
			assessment: result.assessment,
			userFacingText: result.userFacingText,
			finalSequenceQc: result.finalSequenceQc
				? {
						overall: result.finalSequenceQc.overall,
						joinCount: result.finalSequenceQc.joins?.length ?? 0,
					}
				: null,
			metrics: result.metrics,
			finalDuration: result.session.finalProgrammeDurationSec,
			harness: { allowInjectedCompositorAsAuthoritative: allowInjected },
		});

		expect(result.metrics.paidAiCalls).toBe(0);
		expect(result.metrics.autoUnverifiedMutations).toBe(0);
		expect(result.authorization?.valid).toBe(true);
		expect(result.needsUserAuthorization).toBe(false);
		expect(result.userFacingText).not.toMatch(/re-enable project edits/i);
		expect(result.userFacingText).not.toMatch(/I'll add transitions/i);
		expect(result.plan.steps.length).toBeGreaterThan(0);
		// Prefer not forcing unsafe 5–7s
		if (result.duration.kind === "NOT_ACHIEVABLE_WITHOUT_IMPORTANT_CONTENT_LOSS") {
			expect(
				(result.session.finalProgrammeDurationSec ?? originalDuration) > 7 ||
					result.metrics.stepsCommitted === 0,
			).toBe(true);
		}
		if (result.finalSequenceQc?.overall === "FAIL") {
			expect(result.assessment.finalSequenceQc).toBe("FAIL");
			expect(result.userFacingText.toLowerCase()).toMatch(/review|failed/);
		}
	}, 180_000);
});
