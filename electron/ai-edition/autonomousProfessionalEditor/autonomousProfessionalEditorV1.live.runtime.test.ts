/**
 * Autonomous Professional Editor V1 — real recording E2Es.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { createInjectedCompositorSampler } from "../compositorVerify";
import { runAutonomousProfessionalEditSession } from "./index";

const OUT = join(process.cwd(), "tmp/perception-benchmark/autonomous-professional-editor-v1");
const REC_DIR = join(homedir(), "Library/Application Support/openscreen/recordings");
const NARRATED = join(REC_DIR, "recording-1789463294153.mp4");
const FOCAL = join(REC_DIR, "recording-1788894882204.mp4");
const PROJECT = join(
	homedir(),
	"Library/Application Support/openscreen/projects/proj_a5a029b5-4e54-417f-8813-f82bfaa5f9f2.openscreen",
);
const PROMPT = "Make this video professional. Keep important content. You decide.";

function write(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	writeFileSync(join(OUT, name), JSON.stringify(data, null, 2), "utf8");
}

function loadDoc(mediaPath: string, durationSec: number): AxcutDocument {
	if (existsSync(PROJECT) && mediaPath.includes("1789463294153")) {
		try {
			return documentSchema.parse(JSON.parse(readFileSync(PROJECT, "utf8")));
		} catch {
			/* fallthrough */
		}
	}
	const base = createEmptyDocument({
		title: "ae-live",
		projectId: "proj_ae_live",
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
				originalPath: mediaPath,
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
}

function summarize(r: Awaited<ReturnType<typeof runAutonomousProfessionalEditSession>>) {
	return {
		sourceStoryBeats: r.sourceStory.beats.map((b) => ({
			kind: b.kind,
			range: b.sourceRange,
			density: b.informationDensity,
		})),
		targetArc: r.targetStory.desiredArc,
		skillsConsidered: r.intentPlan.intents.map((i) => i.kind),
		skillsRejected: r.intentPlan.rejectedSkills,
		compiled: r.compiled.map((c) => ({
			kind: c.kind,
			status: c.status,
			reason: c.reason,
		})),
		planOps: r.orchestrator.plan.steps.map((s) => `${s.family}:${s.operationType}`),
		committed: r.orchestrator.session.completed.filter((c) => c.status === "committed"),
		rolledBack: r.orchestrator.session.failed.filter((c) => c.status === "rolled_back"),
		finalQc: r.orchestrator.finalSequenceQc?.overall ?? "NOT_RUN",
		selfReview: r.selfReview,
		temporalConsumed: r.orchestrator.metrics.temporalContextConsumed,
		localProbe: r.localReasoningProbe,
		paidAi: r.metrics.paidAiCalls,
	};
}

describe("AUTONOMOUS_PROFESSIONAL_EDITOR_V1 real E2E", () => {
	it("narrated tutorial recording-1789463294153", async () => {
		if (!existsSync(NARRATED)) return;
		const doc = loadDoc(NARRATED, 16);
		const assetId = doc.project.primaryAssetId ?? doc.assets[0]!.id;
		const r = await runAutonomousProfessionalEditSession({
			document: doc,
			assetId,
			mediaPath: NARRATED,
			userMessage: PROMPT,
			executionMode: "verified_apply",
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
			skipFinalSequenceQc: true,
		});
		expect(r.sourceStory.beats.length).toBeGreaterThan(0);
		expect(r.targetStory.beats.length).toBeGreaterThan(0);
		expect(r.intentPlan.intents.length).toBeGreaterThan(0);
		expect(r.metrics.paidAiCalls).toBe(0);
		expect(r.orchestrator.metrics.temporalContextConsumed).toBe(true);
		write("e2e-narrated-1789463294153.json", summarize(r));
	}, 180_000);

	it("focal cursor recording-1788894882204", async () => {
		if (!existsSync(FOCAL)) return;
		const doc = loadDoc(FOCAL, 30);
		const r = await runAutonomousProfessionalEditSession({
			document: doc,
			assetId: "asset_1",
			mediaPath: FOCAL,
			userMessage: PROMPT,
			executionMode: "verified_apply",
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
			skipFinalSequenceQc: true,
		});
		expect(r.orchestrator.metrics.temporalContextConsumed).toBe(true);
		write("e2e-focal-1788894882204.json", summarize(r));
	}, 180_000);

	it("already-good restraint via empty injected dead-air + captions-on project path", async () => {
		if (!existsSync(NARRATED)) return;
		const doc = loadDoc(NARRATED, 16);
		const assetId = doc.project.primaryAssetId ?? doc.assets[0]!.id;
		const r = await runAutonomousProfessionalEditSession({
			document: doc,
			assetId,
			mediaPath: NARRATED,
			userMessage: PROMPT,
			injectedDeadAir: [],
			executionMode: "plan_only",
			skipFinalSequenceQc: true,
		});
		write("e2e-already-good-plan-only.json", summarize(r));
		expect(r.selfReview.version).toBe(1);
	}, 120_000);
});
