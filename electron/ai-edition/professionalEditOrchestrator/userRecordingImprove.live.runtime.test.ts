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
import { fingerprintDocument } from "../applyPreview/fingerprint";
import { createInjectedCompositorSampler } from "../compositorVerify";
import { runProfessionalEditOrchestrator } from "./index";
import { isExplicitPauseRemovalRequest, isProfessionalEditRequest } from "./intent";

const OUT = join(process.cwd(), "tmp/perception-benchmark/user-recording-improve-test");
const REC = join(
	homedir(),
	"Library/Application Support/openscreen/recordings/recording-1789497588181.mp4",
);
const PROJ = join(
	homedir(),
	"Library/Application Support/openscreen/projects/proj_8a4076a9-95e6-4341-ab71-5b994eeb6b14.openscreen",
);

function write(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	writeFileSync(join(OUT, name), typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

describe("user recording improve live", () => {
	it("runs improve + pause removal on recording-1789497588181", async () => {
		expect(existsSync(REC)).toBe(true);
		expect(isProfessionalEditRequest("Make this video professional. You decide.")).toBe(true);
		expect(
			isExplicitPauseRemovalRequest(
				"remove all of the voices pauses where is a not voice rmeove it",
			),
		).toBe(true);

		let doc: AxcutDocument;
		if (existsSync(PROJ)) {
			doc = documentSchema.parse(JSON.parse(readFileSync(PROJ, "utf8")));
		} else {
			const base = createEmptyDocument({
				title: "improve-test",
				projectId: "proj_test_improve",
			});
			const assetId = "asset_test";
			doc = {
				...base,
				project: { ...base.project, primaryAssetId: assetId },
				assets: [
					{
						id: assetId,
						kind: "screen",
						originalPath: REC,
						durationSec: 20.01,
						createdAt: new Date().toISOString(),
					},
				],
				timeline: {
					...base.timeline,
					clips: [
						{
							id: "clip1",
							assetId,
							sourceStartSec: 0,
							sourceEndSec: 20.01,
							timelineStartSec: 0,
							timelineEndSec: 20.01,
						},
					],
				},
			};
		}

		const legacy = { ...((doc.legacyEditor as Record<string, unknown>) ?? {}) };
		delete legacy.audioGainDb;
		if (legacy.captions && typeof legacy.captions === "object") {
			legacy.captions = { ...(legacy.captions as object), enabled: false };
		}
		doc = {
			...doc,
			legacyEditor: legacy,
			zoomRanges: [],
			timeline: { ...doc.timeline, trimRanges: [], speedRanges: [] },
		};
		const asset = doc.assets.find((a) => a.id === doc.project.primaryAssetId)!;
		const fp0 = fingerprintDocument(doc).value;

		const improve = await runProfessionalEditOrchestrator({
			document: doc,
			assetId: asset.id,
			mediaPath: asset.originalPath,
			userMessage:
				"Make this video professional. Keep the important content. You decide. Remove silent pauses where there is no voice.",
			settingsEditsAllowed: true,
			executionMode: "verified_apply",
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
			skipFinalSequenceQc: true,
			appRoot: process.cwd(),
		});

		const summary = {
			plan: improve.plan.steps.map((s) => ({
				family: s.family,
				reason: s.reason,
				range: [s.sourceStartSec, s.sourceEndSec],
			})),
			committed: improve.metrics.stepsCommitted,
			text: improve.userFacingText,
			plannerReady: improve.planner?.ready?.map((o) => ({
				family: o.family,
				status: o.generationStatus,
				reason: o.editorialReason,
				range: o.sourceRange,
			})),
			fpBefore: fp0,
			fpAfter: fingerprintDocument(improve.document).value,
			trims: improve.document.timeline.trimRanges?.length ?? 0,
			zooms: improve.document.zoomRanges?.length ?? 0,
			captions: getCaptionSettings(improve.document, 16 / 9).enabled,
			gain: (improve.document.legacyEditor as Record<string, unknown>)?.audioGainDb ?? null,
			assessment: improve.autonomous?.transformationSummary?.assessmentLabel,
			deadAirSafe: improve.decisionTable
				?.filter((d) => d.family === "trim")
				.map((d) => ({
					selected: d.selected,
					rejectedReason: d.rejectedReason,
					evidence: d.evidence,
				})),
		};
		write("improve-result.json", summary);
		console.info(
			"RESULT",
			JSON.stringify(
				{
					committed: summary.committed,
					plan: summary.plan,
					trims: summary.trims,
					zooms: summary.zooms,
					captions: summary.captions,
					gain: summary.gain,
					assessment: summary.assessment,
					plannerReady: summary.plannerReady,
					text: summary.text.slice(0, 400),
				},
				null,
				2,
			),
		);

		expect(summary.committed).toBeGreaterThan(0);
		expect(summary.trims).toBeGreaterThan(0);
	}, 300_000);
});
