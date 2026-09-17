/**
 * Autonomous Professional Editor / Editorial Director V1 — unit corpus.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import type { DeadAirCandidateV1 } from "../deadAir";
import { VISUAL_SAFETY_VERSION } from "../deadAir/visualActivityTypes";
import { parseProfessionalEditIntent } from "../professionalEditOrchestrator/intent";
import { buildPackedEditorialTranscript } from "../professionalEditOrchestrator/packedTranscript";
import type { ProfessionalEditorialOpportunityV1 } from "../professionalEditorialPlanner";
import {
	buildEditingSkillRegistryV1,
	buildMultimodalSourceStory,
	buildTargetEditStory,
	compileEditorialIntents,
	createDeterministicEditorialDirector,
	productCapabilityGaps,
	resetDirectorSeqForTests,
	reviewFinalProgramme,
} from "./index";

const OUT = join(process.cwd(), "tmp/perception-benchmark/autonomous-professional-editor-v1");

function write(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	writeFileSync(join(OUT, name), JSON.stringify(data, null, 2), "utf8");
}

function fixtureDoc(durationSec = 20): AxcutDocument {
	const base = createEmptyDocument({
		title: "auto-editor",
		projectId: "proj_ae",
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
				originalPath: "/tmp/ae.mp4",
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
						startSec: 0.5,
						endSec: 4,
						text: "Here is the important explanation",
						wordIds: ["w0"],
					},
					{
						id: "seg2",
						kind: "speech",
						startSec: 12,
						endSec: 14,
						text: "And the result",
						wordIds: ["w1"],
					},
				],
				words: [
					{ id: "w0", segmentId: "seg1", startSec: 0.5, endSec: 4, text: "Here", source: "asr" },
					{ id: "w1", segmentId: "seg2", startSec: 12, endSec: 14, text: "result", source: "asr" },
				],
			},
		],
	});
}

beforeEach(() => {
	resetDirectorSeqForTests();
});

describe("AUTONOMOUS_PROFESSIONAL_EDITOR_V1 foundation", () => {
	it("builds multimodal source + target story", () => {
		const doc = fixtureDoc();
		const deadAir: DeadAirCandidateV1[] = [
			{
				id: "da1",
				assetId: "asset_1",
				silenceRange: { timebase: "SOURCE_MEDIA_TIME", startSec: 5, endSec: 9 },
				proposedTrimRange: {
					timebase: "SOURCE_MEDIA_TIME",
					startSec: 5.2,
					endSec: 8.6,
				},
				silenceDurationSec: 4,
				resultingRemovedDurationSec: 3.4,
				classification: "POSSIBLE_DEAD_AIR",
				confidence: "high",
				evidenceRefs: [],
				speechBoundaryState: {
					before: { kind: "speech_segment", id: "seg1", text: "a" },
					after: { kind: "speech_segment", id: "seg2", text: "b" },
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
			},
		];
		const packed = buildPackedEditorialTranscript({
			document: doc,
			assetId: "asset_1",
			sourceDurationSec: 20,
			deadAirCandidates: deadAir,
		});
		const source = buildMultimodalSourceStory({
			assetId: "asset_1",
			sourceDurationSec: 20,
			packed,
			visualIntervals: [{ startSec: 5, endSec: 9, kind: "stable" }],
			deadAir,
		});
		expect(source.beats.length).toBeGreaterThan(0);
		expect(source.beats.some((b) => b.kind === "EXPLANATION" || b.kind === "OPENING_SETUP")).toBe(
			true,
		);

		const intent = parseProfessionalEditIntent("Make this video professional. You decide.");
		const target = buildTargetEditStory({ source, intent });
		expect(target.beats.length).toBe(source.beats.length);
		expect(target.globalSkills).toContain("ADD_CAPTIONS");
		expect(target.unsupportedDesiredSkills.length).toBeGreaterThan(0);
		write("source-target-story.json", { source, target });
	});

	it("director emits intents without inventing geometry; compiler grounds or refuses", async () => {
		const doc = fixtureDoc();
		const packed = buildPackedEditorialTranscript({
			document: doc,
			assetId: "asset_1",
			sourceDurationSec: 20,
			deadAirCandidates: [],
		});
		const source = buildMultimodalSourceStory({
			assetId: "asset_1",
			sourceDurationSec: 20,
			packed,
			visualIntervals: [{ startSec: 5, endSec: 10, kind: "stable" }],
		});
		const intent = parseProfessionalEditIntent("Make this video professional. You decide.");
		const target = buildTargetEditStory({ source, intent });
		const director = createDeterministicEditorialDirector();
		const plan = await director.direct({
			requestId: "t1",
			sourceStory: source,
			targetStory: target,
			skillRegistry: buildEditingSkillRegistryV1(),
			userMessage: intent.rawText,
		});
		expect(plan.providerId).toBe("CURRENT_OPENSCREEN_EDITORIAL_DIRECTOR_V1");
		expect(plan.metrics.paidAiCalls).toBe(0);
		// Transitions are supported but single-clip programmes keep CUT (no forced dissolve).
		expect(
			plan.rejectedSkills.some(
				(r) => r.skill.includes("COLOR") || r.skill.includes("AUDIO_CLEANUP"),
			) || plan.intents.every((i) => i.kind !== "IMPROVE_COLOR"),
		).toBe(true);

		const opportunities: ProfessionalEditorialOpportunityV1[] = [
			{
				id: "peo_speed_1",
				family: "SPEED",
				sourceRange: { startSec: 5, endSec: 10 },
				editorialReason: "low info",
				evidenceRefs: ["visual:stable"],
				confidence: "HIGH",
				preservationStatus: "SAFE",
				generationStatus: "GROUNDED_READY",
				requiredParameters: ["speed"],
				derivedParameters: { startSec: 5, endSec: 10, speed: 1.5 },
				executionReadiness: "READY",
				rankScore: 7,
			},
			{
				id: "peo_crop_1",
				family: "CROP",
				editorialReason: "no geometry",
				evidenceRefs: [],
				confidence: "HIGH",
				preservationStatus: "SAFE",
				generationStatus: "INSUFFICIENT_EVIDENCE",
				requiredParameters: ["crop"],
				derivedParameters: {},
				executionReadiness: "NOT_READY",
				rankScore: 0,
			},
		];
		const compiled = compileEditorialIntents({ intentPlan: plan, opportunities });
		// Transitions are executable but need a multi-clip join — refuse invented dissolves.
		expect(
			compiled.some(
				(c) =>
					c.kind === "ADD_TRANSITION" &&
					(c.status === "UNSUPPORTED" ||
						c.status === "NEEDS_EVIDENCE" ||
						c.status === "KEEP" ||
						c.status === "PRESERVATION_CONFLICT"),
			) || !plan.intents.some((i) => i.kind === "ADD_TRANSITION"),
		).toBe(true);
		expect(
			compiled.some(
				(c) => c.kind === "ACCELERATE_LOW_INFORMATION_SECTION" && c.status === "GROUNDED",
			),
		).toBe(true);
		expect(compiled.some((c) => c.kind === "REFRAME_SCENE" && c.status === "NEEDS_EVIDENCE")).toBe(
			true,
		);
		write("director-compile.json", { plan, compiled });
	});

	it("skill registry reports product gaps without silent removal", () => {
		const reg = buildEditingSkillRegistryV1();
		const gaps = productCapabilityGaps(reg);
		expect(gaps.some((g) => g.skill === "COLOR_GRADE")).toBe(true);
		expect(reg.find((s) => s.skill === "TRIM")?.classification).toBe("FULL_AUTONOMOUS_PATH");
		expect(reg.find((s) => s.skill === "TRANSITIONS")?.classification).toBe("FULL_AUTONOMOUS_PATH");
		write("skill-registry.json", { skills: reg, gaps });
	});

	it("self-review distinguishes technical validity from editorial improvement", () => {
		const base = {
			session: {
				completed: [{ status: "committed", stepId: "step_cap_1" }],
				failed: [],
				finalProgrammeDurationSec: 20,
			},
			plan: { steps: [{ family: "captions" }] },
			loudness: { committed: true },
			finalSequenceQc: { overall: "PASS" },
			metrics: { autoUnverifiedMutations: 0 },
			decisionTable: [
				{ family: "CAPTIONS", decision: "APPLY" },
				{ family: "LOUDNESS", decision: "APPLY" },
			],
			planner: { metrics: { temporalContextConsumed: true } },
		};
		const review = reviewFinalProgramme({
			result: base as never,
			originalDurationSec: 20,
		});
		expect(review.technicallyValid).toBe(true);
		expect(review.editorialImprovement).toBe("TECHNICALLY_VALID_NO_CLEAR_IMPROVEMENT");
	});
});
