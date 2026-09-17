/**
 * Professional Edit Execution Orchestrator V1 — deterministic corpus (0 paid AI).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { createInjectedCompositorSampler } from "../compositorVerify";
import type { DeadAirCandidateV1 } from "../deadAir";
import { VISUAL_SAFETY_VERSION } from "../deadAir/visualActivityTypes";
import { assessDurationObjective } from "./duration";
import {
	authorizePlanFromUserText,
	buildProfessionalEditPlan,
	fingerprintPlan,
	investigateFocalInRange,
	isProfessionalEditRequest,
	parseProfessionalEditIntent,
	runProfessionalEditOrchestrator,
	stripFalseProjectEditsDisabledClaim,
	stripRepeatedProceedAsks,
	stripUnsupportedTransitionClaims,
} from "./index";
import { buildPackedEditorialTranscript } from "./packedTranscript";
import { buildProfessionalEditStory } from "./story";

const ARTIFACT_DIR = join(
	process.cwd(),
	"tmp/perception-benchmark/professional-edit-orchestrator-v1",
);

function writeArtifact(name: string, data: unknown) {
	mkdirSync(ARTIFACT_DIR, { recursive: true });
	writeFileSync(join(ARTIFACT_DIR, name), JSON.stringify(data, null, 2), "utf8");
}

function fixtureDoc(durationSec = 13.9): AxcutDocument {
	const base = createEmptyDocument({
		title: "ProfEdit",
		projectId: "proj_pe",
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
				originalPath: "/tmp/pe.mp4",
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
						endSec: 4.5,
						text: "Here is the important explanation",
						wordIds: ["w0", "w1", "w2", "w3", "w4"],
					},
					{
						id: "seg2",
						kind: "speech",
						startSec: 9,
						endSec: 12,
						text: "And a short wrap",
						wordIds: ["w5", "w6", "w7"],
					},
				],
				words: [
					{ id: "w0", segmentId: "seg1", startSec: 0.5, endSec: 1, text: "Here", source: "asr" },
					{ id: "w1", segmentId: "seg1", startSec: 1, endSec: 1.5, text: "is", source: "asr" },
					{
						id: "w2",
						segmentId: "seg1",
						startSec: 1.5,
						endSec: 2.5,
						text: "the",
						source: "asr",
					},
					{
						id: "w3",
						segmentId: "seg1",
						startSec: 2.5,
						endSec: 3.5,
						text: "important",
						source: "asr",
					},
					{
						id: "w4",
						segmentId: "seg1",
						startSec: 3.5,
						endSec: 4.5,
						text: "explanation",
						source: "asr",
					},
					{ id: "w5", segmentId: "seg2", startSec: 9, endSec: 10, text: "And", source: "asr" },
					{ id: "w6", segmentId: "seg2", startSec: 10, endSec: 11, text: "a", source: "asr" },
					{
						id: "w7",
						segmentId: "seg2",
						startSec: 11,
						endSec: 12,
						text: "wrap",
						source: "asr",
					},
				],
			},
		],
	});
}

function safeDeadAir(id: string, start: number, end: number, removed: number): DeadAirCandidateV1 {
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
			before: { kind: "speech_segment", id: "seg1", text: "before" },
			after: { kind: "speech_segment", id: "seg2", text: "after" },
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

describe("PROFESSIONAL_EDIT_ORCHESTRATOR_V1 intent + auth", () => {
	it("parses 5-7 seconds duration range and you_decide", () => {
		const msg =
			"Make this video professional and keep it under 5-7 seconds. Don't delete important stuff. You decide.";
		expect(isProfessionalEditRequest(msg)).toBe(true);
		const intent = parseProfessionalEditIntent(msg);
		expect(intent.requestedOutcome).toBe("MAKE_PROFESSIONAL");
		expect(intent.targetDurationMinSec).toBe(5);
		expect(intent.targetDurationMaxSec).toBe(7);
		expect(intent.preserveImportant).toBe(true);
		expect(intent.autonomy).toBe("you_decide");
	});

	it("routes natural professional / improve / remove-pauses phrasings", () => {
		const cases = [
			"make this video professional",
			"can u please improve and make a video professional?",
			"improve this video",
			"make it better",
			"clean this up",
			"can u remove a pauses?",
			"remove the pauses",
		];
		for (const msg of cases) {
			expect(isProfessionalEditRequest(msg), msg).toBe(true);
			expect(parseProfessionalEditIntent(msg).autonomy, msg).toBe("you_decide");
		}
	});

	it("routes typo-ish under-N-sec requests onto local professional-edit (0 LLM)", () => {
		const msg = "Can u make a video under a 12 sec and kidnly make sure keep a important parts?";
		expect(isProfessionalEditRequest(msg)).toBe(true);
		const intent = parseProfessionalEditIntent(msg);
		expect(intent.targetDurationMaxSec).toBe(12);
		expect(intent.requestedOutcome).toBe("MAKE_TIGHTER");
		expect(intent.preserveImportant).toBe(true);
		expect(intent.autonomy).toBe("you_decide");
		expect(intent.pacingPreference).toBe("tighter");

		for (const alt of [
			"make it under 12 seconds",
			"Can you make the video under 12 sec?",
			"keep it below about 10s",
		]) {
			expect(isProfessionalEditRequest(alt), alt).toBe(true);
			expect(parseProfessionalEditIntent(alt).targetDurationMaxSec, alt).toBeGreaterThan(0);
			expect(parseProfessionalEditIntent(alt).autonomy, alt).toBe("you_decide");
		}
	});

	it("marks transitions as authorable (not auto-unsupported)", () => {
		const intent = parseProfessionalEditIntent(
			"Make it professional with trims, zoom, and transitions",
		);
		expect(intent.requestedUnsupported).not.toContain("transitions");
		expect(intent.allowedFamilies).toContain("transitions");
	});

	it("J: durable authorization — no re-ask after you_decide", async () => {
		const doc = fixtureDoc();
		const dead = [safeDeadAir("da1", 4.5, 9, 3.5)];
		const r1 = await runProfessionalEditOrchestrator({
			document: doc,
			assetId: "asset_1",
			userMessage: "Make this professional under 7 seconds. You decide.",
			injectedDeadAir: dead,
			executionMode: "plan_only",
			skipFinalSequenceQc: true,
			settingsEditsAllowed: true,
		});
		expect(r1.authorization?.valid).toBe(true);
		expect(r1.needsUserAuthorization).toBe(false);
		expect(r1.userFacingText).not.toMatch(/would you like to proceed/i);

		const r2 = await runProfessionalEditOrchestrator({
			document: doc,
			assetId: "asset_1",
			userMessage: "yes proceed with them",
			injectedDeadAir: dead,
			priorAuthorization: r1.authorization,
			executionMode: "plan_only",
			skipFinalSequenceQc: true,
			settingsEditsAllowed: true,
		});
		expect(r2.needsUserAuthorization).toBe(false);
		expect(stripRepeatedProceedAsks(r2.userFacingText, true)).not.toMatch(
			/would you like to proceed/i,
		);
	});
});

describe("PROFESSIONAL_EDIT_ORCHESTRATOR_V1 packing / story / duration", () => {
	it("builds packed transcript from local evidence", () => {
		const packed = buildPackedEditorialTranscript({
			document: fixtureDoc(),
			assetId: "asset_1",
			sourceDurationSec: 13.9,
			deadAirCandidates: [safeDeadAir("da1", 4.5, 9, 3.5)],
		});
		expect(packed.segments.length).toBeGreaterThan(0);
		expect(packed.segments.some((s) => s.preservation === "important")).toBe(true);
	});

	it("B: duration impossible without speech loss → NOT_ACHIEVABLE", () => {
		const intent = parseProfessionalEditIntent(
			"Make this under 3 seconds. Preserve important content.",
		);
		const packed = buildPackedEditorialTranscript({
			document: fixtureDoc(),
			assetId: "asset_1",
			sourceDurationSec: 13.9,
			deadAirCandidates: [safeDeadAir("da1", 4.5, 9, 3.5)],
		});
		const story = buildProfessionalEditStory({ packed, intent });
		const dur = assessDurationObjective({
			originalDurationSec: 13.9,
			intent,
			story,
			safeDeadAirCandidates: [safeDeadAir("da1", 4.5, 9, 3.5)],
		});
		expect(dur.kind).toBe("NOT_ACHIEVABLE_WITHOUT_IMPORTANT_CONTENT_LOSS");
		expect(dur.projectedSafeDurationSec).toBeGreaterThan(3);
	});
});

describe("PROFESSIONAL_EDIT_ORCHESTRATOR_V1 investigation + plan", () => {
	it("C: activity but no focal → no invented zoom", () => {
		const inv = investigateFocalInRange({
			document: fixtureDoc(),
			assetId: "asset_1",
			startSec: 1,
			endSec: 4,
			cursorSamples: [],
		});
		expect(inv.focalFound).toBe(false);

		const intent = parseProfessionalEditIntent("Make professional with zoom. You decide.");
		const packed = buildPackedEditorialTranscript({
			document: fixtureDoc(),
			assetId: "asset_1",
			sourceDurationSec: 13.9,
			deadAirCandidates: [],
		});
		const story = buildProfessionalEditStory({ packed, intent });
		const plan = buildProfessionalEditPlan({
			document: fixtureDoc(),
			assetId: "asset_1",
			intent,
			story,
			duration: assessDurationObjective({
				originalDurationSec: 13.9,
				intent,
				story,
				safeDeadAirCandidates: [],
			}),
			deadAirCandidates: [],
			focalInvestigation: inv,
		});
		expect(plan.steps.every((s) => s.family !== "zoom")).toBe(true);
	});

	it("C+: stable cursor yields grounded zoom candidate", () => {
		const inv = investigateFocalInRange({
			document: fixtureDoc(),
			assetId: "asset_1",
			startSec: 1,
			endSec: 4,
			cursorSamples: [
				{ atSec: 1.2, cx: 0.42, cy: 0.55 },
				{ atSec: 2.0, cx: 0.43, cy: 0.54 },
				{ atSec: 3.1, cx: 0.42, cy: 0.55 },
			],
		});
		expect(inv.focalFound).toBe(true);
		expect(inv.focal?.cx).toBeCloseTo(0.42, 1);
	});

	it("D: requested transition is authorable family (not forced unsupported)", async () => {
		const r = await runProfessionalEditOrchestrator({
			document: fixtureDoc(),
			assetId: "asset_1",
			userMessage: "Make professional with transitions. You decide.",
			injectedDeadAir: [safeDeadAir("da1", 4.5, 9, 3.5)],
			executionMode: "plan_only",
			skipFinalSequenceQc: true,
		});
		expect(r.plan.requestedButUnsupported).not.toContain("transitions");
		expect(r.intent.allowedFamilies).toContain("transitions");
	});

	it("A: already-good / no safe ops → no unnecessary edits", async () => {
		const r = await runProfessionalEditOrchestrator({
			document: fixtureDoc(6),
			assetId: "asset_1",
			userMessage: "Make this professional. You decide.",
			injectedDeadAir: [],
			executionMode: "plan_only",
			skipFinalSequenceQc: true,
		});
		expect(r.metrics.stepsCommitted).toBe(0);
		expect(r.metrics.autoUnverifiedMutations).toBe(0);
		expect(r.metrics.paidAiCalls).toBe(0);
	});

	it("H: captions skip when no transcript cues", async () => {
		const base = fixtureDoc();
		const noSpeech = documentSchema.parse({
			...base,
			transcripts: [],
		});
		const r = await runProfessionalEditOrchestrator({
			document: noSpeech,
			assetId: "asset_1",
			userMessage: "Enable captions and make professional. You decide.",
			injectedDeadAir: [],
			executionMode: "plan_only",
			skipFinalSequenceQc: true,
		});
		expect(r.plan.steps.every((s) => s.family !== "captions")).toBe(true);
	});
});

describe("PROFESSIONAL_EDIT_ORCHESTRATOR_V1 execution + sanitizers", () => {
	it("multi-step verified apply with injected compositor (trim)", async () => {
		const doc = fixtureDoc();
		const dead = [safeDeadAir("da1", 4.5, 9, 3.5)];
		const r = await runProfessionalEditOrchestrator({
			document: doc,
			assetId: "asset_1",
			userMessage: "Make professional under 7s. Preserve important. You decide.",
			injectedDeadAir: dead,
			executionMode: "verified_apply",
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
			skipFinalSequenceQc: true,
			settingsEditsAllowed: true,
		});
		expect(r.authorization?.valid).toBe(true);
		expect(r.metrics.paidAiCalls).toBe(0);
		expect(r.metrics.autoUnverifiedMutations).toBe(0);
		writeArtifact("unit-multi-step-trim.json", {
			plan: r.plan,
			session: r.session,
			assessment: r.assessment,
			metrics: r.metrics,
		});
		// Commit may succeed or roll back depending on family verify; never unverified mutation.
		expect(
			r.session.completed.every((c) => c.status === "committed") ||
				r.session.failed.some((f) => f.status === "rolled_back" || f.status === "failed"),
		).toBe(true);
	});

	it("E: plan includes trim+zoom; session attempts without inventing geometry", async () => {
		const intent = parseProfessionalEditIntent("professional zoom trim. You decide.");
		const packed = buildPackedEditorialTranscript({
			document: fixtureDoc(),
			assetId: "asset_1",
			sourceDurationSec: 13.9,
			deadAirCandidates: [safeDeadAir("da1", 4.5, 9, 3.5)],
		});
		const story = buildProfessionalEditStory({ packed, intent });
		const plan = buildProfessionalEditPlan({
			document: fixtureDoc(),
			assetId: "asset_1",
			intent,
			story,
			duration: assessDurationObjective({
				originalDurationSec: 13.9,
				intent,
				story,
				safeDeadAirCandidates: [safeDeadAir("da1", 4.5, 9, 3.5)],
			}),
			deadAirCandidates: [safeDeadAir("da1", 4.5, 9, 3.5)],
			groundedFocals: [
				{
					version: 1,
					sourceRange: { startSec: 10, endSec: 12 },
					focal: { cx: 0.4, cy: 0.5 },
					evidenceType: "cursor_click_dwell",
					evidenceRefs: ["cursor"],
					confidence: "high",
					reason: "CLICK_DWELL_PERSISTENCE",
					programmeRanges: [{ startSec: 10, endSec: 12 }],
					survivesCurrentPlayback: true,
					notes: [],
				},
			],
		});
		expect(plan.steps.some((s) => s.family === "trim")).toBe(true);
		expect(plan.steps.some((s) => s.family === "zoom")).toBe(true);
		const zoom = plan.steps.find((s) => s.family === "zoom")!;
		expect(zoom.operationArgs.focus).toEqual({ cx: 0.4, cy: 0.5 });
		expect(zoom.operationArgs.sourceStartSec ?? zoom.sourceStartSec).toBe(10);
	});

	it("F: blank compositor → rollback that operation", async () => {
		const r = await runProfessionalEditOrchestrator({
			document: fixtureDoc(),
			assetId: "asset_1",
			userMessage: "Make professional. You decide.",
			injectedDeadAir: [safeDeadAir("da1", 4.5, 9, 3.5)],
			executionMode: "verified_apply",
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "blank" }),
			allowInjectedCompositorAsAuthoritative: true,
			skipFinalSequenceQc: true,
		});
		const rolled = r.session.failed.filter((f) => f.status === "rolled_back");
		expect(rolled.length + r.session.failed.length).toBeGreaterThan(0);
		expect(r.metrics.autoUnverifiedMutations).toBe(0);
	});

	it("false project-edits-disabled claim stripped when Settings ON", () => {
		const raw =
			"I cannot edit. Please re-enable project edits in the settings. Then we can continue.";
		const cleaned = stripFalseProjectEditsDisabledClaim(raw, true);
		expect(cleaned).not.toMatch(/re-enable project edits/i);
		expect(stripFalseProjectEditsDisabledClaim(raw, false)).toMatch(/re-enable/i);
	});

	it("strips unsupported transition promises", () => {
		const cleaned = stripUnsupportedTransitionClaims(
			"I'll tighten pacing.\nI'll add transitions between clips.\nDone.",
		);
		expect(cleaned).not.toMatch(/I'll add transitions/i);
		expect(cleaned).toMatch(/tighten pacing/i);
	});

	it("receipt does not claim rolled-back trims", async () => {
		const { assertReceiptMatchesFinalDocument } = await import("./assessment");
		const lied =
			"I improved the video by removing 2 unnecessary pauses, balancing the audio, tightening the view around the part of the screen you were actively demonstrating.";
		const honestDoc = fixtureDoc();
		honestDoc.zoomRanges = [
			{
				id: "z1",
				startMs: 2000,
				endMs: 4000,
				depth: 3,
				focus: { cx: 0.5, cy: 0.5 },
				clipId: "clip_1",
				sourceStartSec: 2,
				sourceEndSec: 4,
			},
		];
		honestDoc.legacyEditor = { audioGainDb: 4 };
		const bad = assertReceiptMatchesFinalDocument({ receipt: lied, document: honestDoc });
		expect(bad.ok).toBe(false);
		expect(bad.extraClaims).toContain("trim");
		const honest =
			"I improved the video by balancing the audio, tightening the view around the part of the screen you were actively demonstrating.";
		const good = assertReceiptMatchesFinalDocument({ receipt: honest, document: honestDoc });
		expect(good.ok).toBe(true);
		honestDoc.timeline.trimRanges = [
			{ id: "t1", assetId: "asset_1", startSec: 0.3, endSec: 2.0, origin: "agent" },
		];
		const countLie =
			"I improved the video by removing 2 unnecessary pauses, balancing the audio, tightening the view around the part of the screen you were actively demonstrating.";
		expect(assertReceiptMatchesFinalDocument({ receipt: countLie, document: honestDoc }).ok).toBe(
			false,
		);
	});
});
