/**
 * Diagnose screenshot turn on recording-1789463294153 (manual product test).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import { type AxcutDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { createInjectedCompositorSampler } from "../compositorVerify";
import { runProfessionalEditOrchestrator } from "../professionalEditOrchestrator";

const OUT = join(process.cwd(), "tmp/perception-benchmark/local-editorial-focal-evidence-v1");
const PROJECT = join(
	homedir(),
	"Library/Application Support/openscreen/projects/proj_a5a029b5-4e54-417f-8813-f82bfaa5f9f2.openscreen",
);
const PROMPT =
	"Make this video look more professional. Keep all important content and meaning. You decide which edits are actually useful. Don't make changes just for the sake of adding effects.";

describe.runIf(existsSync(PROJECT))("manual product turn diagnose", () => {
	it("replays the exact professional prompt", async () => {
		const before = documentSchema.parse(JSON.parse(readFileSync(PROJECT, "utf8"))) as AxcutDocument;
		const asset =
			before.assets.find((a) => a.id === before.project.primaryAssetId) ?? before.assets[0]!;

		const r = await runProfessionalEditOrchestrator({
			document: before,
			assetId: asset.id,
			mediaPath: asset.originalPath,
			userMessage: PROMPT,
			sourceDurationSec: asset.durationSec,
			settingsEditsAllowed: true,
			executionMode: "verified_apply",
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
			skipFinalSequenceQc: true,
		});

		const out = {
			captionsBefore: getCaptionSettings(before, 16 / 9).enabled,
			captionsAfter: getCaptionSettings(r.document, 16 / 9).enabled,
			plan: r.plan.steps.map((s) => `${s.family}:${s.operationType}`),
			committed: r.assessment.operationsApplied,
			session: {
				completed: r.session.completed,
				failed: r.session.failed,
				skipped: r.session.skipped,
			},
			util: r.capabilityUtilization.rows,
			zoom: r.focalAnalysis?.zoomDecision,
			loudness: {
				outcome: r.loudness?.outcome,
				committed: r.loudness?.committed,
				appliedGainDb: r.loudness?.appliedGainDb,
			},
			text: r.userFacingText,
			auth: r.authorization?.valid,
			needsAsk: r.needsUserAuthorization,
			cursorCoverage: r.focalAnalysis?.coverage.cursor,
		};
		mkdirSync(OUT, { recursive: true });
		writeFileSync(join(OUT, "manual-new-recording-turn.json"), JSON.stringify(out, null, 2));
		console.log(JSON.stringify(out, null, 2));

		// Framing: no sidecar expected → no zoom
		expect(r.plan.steps.every((s) => s.family !== "zoom")).toBe(true);
		expect(r.userFacingText).not.toMatch(/cursor focal|peak limited/i);
	}, 180_000);
});
