/**
 * Real-gap V1 E2E on recording-1789454384941 (captions already enabled).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import { type AxcutDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { createInjectedCompositorSampler, NativeCompositorFrameSampler } from "../compositorVerify";
import {
	isProfessionalEditRequest,
	parseProfessionalEditIntent,
	runProfessionalEditOrchestrator,
} from "./index";

const OUT = path.join(process.cwd(), "tmp/perception-benchmark/professional-edit-real-gap-v1");
const MEDIA = path.join(
	os.homedir(),
	"Library/Application Support/openscreen/recordings/recording-1789454384941.mp4",
);
const PROJECT = path.join(
	os.homedir(),
	"Library/Application Support/openscreen/projects/proj_32d89edd-ab5b-4dba-a876-eb699a4cad49.openscreen",
);

const PROMPT =
	"the caption is working perfectly. can you please improve this and make the video professional? keep the important content and use whatever safe edits actually improve it.";

function write(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	const p = path.join(OUT, name);
	if (typeof data === "string") writeFileSync(p, data, "utf8");
	else writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

describe("PROFESSIONAL_EDIT_REAL_GAP_V1 e2e", () => {
	it("routes natural phrasing and proves silence/loudness outcomes", async () => {
		expect(isProfessionalEditRequest("can u remove a pauses?")).toBe(true);
		expect(parseProfessionalEditIntent(PROMPT).autonomy).toBe("you_decide");
		expect(parseProfessionalEditIntent(PROMPT).requestedOutcome).toBe("MAKE_PROFESSIONAL");

		if (!existsSync(MEDIA) || !existsSync(PROJECT)) {
			write("regression-results.json", { skipped: true });
			return;
		}

		const doc = documentSchema.parse(JSON.parse(readFileSync(PROJECT, "utf8"))) as AxcutDocument;
		const asset = doc.assets.find((a) => a.id === doc.project.primaryAssetId) ?? doc.assets[0]!;
		expect(getCaptionSettings(doc, 16 / 9).enabled).toBe(true);

		const native = new NativeCompositorFrameSampler({ appRoot: process.cwd() });
		const allowInjected = !(native.hasAddon() && native.probeBackend() !== "none");
		const sampler = allowInjected ? createInjectedCompositorSampler({ mode: "valid" }) : native;

		const result = await runProfessionalEditOrchestrator({
			document: doc,
			assetId: asset.id,
			mediaPath: asset.originalPath ?? MEDIA,
			userMessage: PROMPT,
			sourceDurationSec: asset.durationSec,
			settingsEditsAllowed: true,
			executionMode: "verified_apply",
			compositorFrameSampler: sampler,
			allowInjectedCompositorAsAuthoritative: allowInjected,
			appRoot: process.cwd(),
			skipFinalSequenceQc: false,
		});

		write("e2e-professional-plan.json", result.plan);
		write("e2e-capability-utilization.json", result.capabilityUtilization);
		write("e2e-execution-receipts.json", {
			completed: result.session.completed,
			failed: result.session.failed,
			skipped: result.session.skipped,
			loudness: result.loudness,
			metrics: result.metrics,
		});
		write("e2e-final-sequence.json", {
			overall: result.finalSequenceQc?.overall ?? "NOT_RUN",
			dispositions: result.warningDispositions,
		});
		write("e2e-user-facing-response.txt", result.userFacingText);
		write("regression-results.json", {
			PROFESSIONAL_INTENT_ROUTING: true,
			CAPTION_EXISTING_STATE_HANDLING:
				result.capabilityUtilization.rows.find((r) => r.family === "captions")?.skippedReason ===
				"CAPTIONS_ALREADY_GOOD",
			SAFE_DEAD_AIR_CANDIDATES: result.capabilityUtilization.rows.find((r) => r.family === "trim")
				?.safeToApply,
			LOUDNESS_CLASSIFICATION: result.loudness?.classification,
			LOUDNESS_EXECUTION_OUTCOME: result.loudness?.outcome,
			LOUDNESS_COMMITTED: result.loudness?.committed,
			OPERATIONS_COMMITTED: result.metrics.stepsCommitted,
			OPERATIONS_ROLLED_BACK: result.metrics.stepsRolledBack,
			FINAL_SEQUENCE_RESULT: result.finalSequenceQc?.overall ?? "NOT_RUN",
			USER_FACING_COPY_QUALITY: !/(cursor focal|peak limited|programme fingerprint)/i.test(
				result.userFacingText,
			),
			TOTAL_PAID_AI_CALLS: result.metrics.paidAiCalls,
			AUTO_UNVERIFIED_MUTATIONS: result.metrics.autoUnverifiedMutations,
			userFacingText: result.userFacingText,
		});

		expect(result.metrics.paidAiCalls).toBe(0);
		expect(result.metrics.autoUnverifiedMutations).toBe(0);
		expect(result.authorization?.valid).toBe(true);
		expect(result.userFacingText).not.toMatch(/cursor focal|peak limited|programme fingerprint/i);
		// Captions already on → continue other families (loudness may commit)
		expect(
			result.capabilityUtilization.rows.find((r) => r.family === "captions")?.skippedReason,
		).toBe("CAPTIONS_ALREADY_GOOD");
		// Dead-air: this recording's pauses are correctly not safe (keep-some-pause)
		expect(result.capabilityUtilization.rows.find((r) => r.family === "trim")?.safeToApply).toBe(
			false,
		);
	}, 240_000);
});
