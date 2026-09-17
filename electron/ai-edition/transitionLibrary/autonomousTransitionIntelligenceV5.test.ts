/**
 * Autonomous Transition Intelligence V5 — unit coverage.
 */

import { describe, expect, it } from "vitest";
import { resolvePlaybackSegments } from "../../../src/lib/ai-edition/document/timeline";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { applyLocalEditorialControl } from "../localEditorialChat";
import { generateTransitionOpportunities } from "../professionalEditorialPlanner/opportunities";
import { opportunitiesToPlanSteps } from "../professionalEditorialPlanner/planBridge";
import { decideAutonomousTransitions } from "./autonomousIntelligence";
import { listAutonomousEligible } from "./registry";

function docWithClips(
	clips: Array<{
		id: string;
		assetId: string;
		start: number;
		end: number;
		origin?: string;
		reason?: string;
	}>,
): AxcutDocument {
	const base = createEmptyDocument({ projectId: "proj_auto_t_v5", title: "v5" });
	const assets = [...new Set(clips.map((c) => c.assetId))].map((id) => ({
		id,
		kind: "video" as const,
		label: id,
		originalPath: `/tmp/${id}.mp4`,
		durationSec: 60,
		createdAt: new Date().toISOString(),
	}));
	return documentSchema.parse({
		...base,
		project: { ...base.project, allowAgentEdits: true, primaryAssetId: assets[0]!.id },
		assets,
		timeline: {
			...base.timeline,
			clips: clips.map((c) => ({
				id: c.id,
				assetId: c.assetId,
				sourceStartSec: 0,
				sourceEndSec: c.end - c.start,
				timelineStartSec: c.start,
				timelineEndSec: c.end,
				origin: c.origin ?? "system",
				reason: c.reason ?? "join",
			})),
		},
	});
}

describe("AUTONOMOUS_TRANSITION_INTELLIGENCE_V5", () => {
	it("KEEP is first-class on continuity / same-asset tutorial joins", () => {
		const document = docWithClips([
			{ id: "c1", assetId: "a", start: 0, end: 10 },
			{ id: "c2", assetId: "a", start: 10, end: 20 },
		]);
		const sourceStory = {
			providerId: "test",
			version: 1 as const,
			assetId: "a",
			sourceDurationSec: 20,
			beats: [
				{
					id: "b0",
					kind: "EXPLANATION" as const,
					startSec: 0,
					endSec: 10,
					speechSummary: "same explanation continues",
					visualSummary: "",
					preservationStatus: "SHOULD_SURVIVE" as const,
					confidence: "HIGH" as const,
					evidenceRefs: [],
				},
				{
					id: "b1",
					kind: "EXPLANATION" as const,
					startSec: 10,
					endSec: 20,
					speechSummary: "still explaining",
					visualSummary: "",
					preservationStatus: "SHOULD_SURVIVE" as const,
					confidence: "HIGH" as const,
					evidenceRefs: [],
				},
			],
			globalNotes: [],
			uncertaintyNotes: [],
		};
		const decisions = decideAutonomousTransitions({
			document,
			sourceStory: sourceStory as never,
			maxApply: 2,
		});
		expect(decisions).toHaveLength(1);
		expect(decisions[0]!.decision).toBe("KEEP");
		expect(decisions[0]!.relationship).toBe("CONTINUITY");
		expect(decisions[0]!.transitionId).toBe("openscreen.cut");
	});

	it("APPLY subtle dissolve on SECTION_CHANGE with story evidence", () => {
		const document = docWithClips([
			{ id: "c1", assetId: "a", start: 0, end: 10 },
			{ id: "c2", assetId: "a", start: 10, end: 20 },
		]);
		const sourceStory = {
			providerId: "test",
			version: 1 as const,
			assetId: "a",
			sourceDurationSec: 20,
			beats: [
				{
					id: "b0",
					kind: "EXPLANATION" as const,
					startSec: 0,
					endSec: 10,
					speechSummary: "intro concept",
					visualSummary: "",
					preservationStatus: "SHOULD_SURVIVE" as const,
					confidence: "HIGH" as const,
					evidenceRefs: [],
				},
				{
					id: "b1",
					kind: "ACTION_DEMONSTRATION" as const,
					startSec: 10,
					endSec: 20,
					speechSummary: "now click this button",
					visualSummary: "",
					preservationStatus: "SHOULD_SURVIVE" as const,
					confidence: "HIGH" as const,
					evidenceRefs: [],
				},
			],
			globalNotes: [],
			uncertaintyNotes: [],
		};
		const targetStory = {
			providerId: "test",
			version: 1 as const,
			beats: [
				{
					id: "teb_b0",
					sourceBeatIds: ["b0"],
					purpose: "EXPLANATION",
					viewerShouldUnderstand: "",
					pacingIntent: "NORMAL",
					attentionIntent: "KEEP_FRAME",
					visualTreatment: {
						transition: "CUT",
						framing: "none",
						speedMultiplier: 1,
						title: "NO_TITLE",
					},
					skillHints: [],
					preserve: true,
					confidence: "HIGH",
				},
				{
					id: "teb_b1",
					sourceBeatIds: ["b1"],
					purpose: "ACTION_DEMONSTRATION",
					viewerShouldUnderstand: "",
					pacingIntent: "NORMAL",
					attentionIntent: "KEEP_FRAME",
					visualTreatment: {
						transition: "DISSOLVE",
						framing: "none",
						speedMultiplier: 1,
						title: "NO_TITLE",
					},
					skillHints: ["ADD_TRANSITION"],
					preserve: true,
					confidence: "HIGH",
				},
			],
			globalSkillHints: ["ADD_TRANSITION"],
			unsupportedDesiredSkills: [],
		};
		const decisions = decideAutonomousTransitions({
			document,
			sourceStory: sourceStory as never,
			targetStory: targetStory as never,
			maxApply: 2,
		});
		expect(decisions[0]!.decision).toBe("APPLY");
		expect(decisions[0]!.relationship).toBe("SECTION_CHANGE");
		expect(decisions[0]!.family).toBe("DISSOLVE_FADE");
		expect(decisions[0]!.transitionId).toBe("openscreen.dissolve");
		expect(listAutonomousEligible("metal").some((e) => e.id === decisions[0]!.transitionId)).toBe(
			true,
		);
	});

	it("HARD_CHANGE across assets prefers CUT", () => {
		const document = docWithClips([
			{ id: "c1", assetId: "a", start: 0, end: 10 },
			{ id: "c2", assetId: "b", start: 10, end: 20 },
		]);
		const sourceStory = {
			providerId: "test",
			version: 1 as const,
			assetId: "a",
			sourceDurationSec: 20,
			beats: [
				{
					id: "b0",
					kind: "EXPLANATION" as const,
					startSec: 0,
					endSec: 10,
					speechSummary: "in app A",
					visualSummary: "",
					preservationStatus: "SHOULD_SURVIVE" as const,
					confidence: "HIGH" as const,
					evidenceRefs: [],
				},
				{
					id: "b1",
					kind: "ACTION_DEMONSTRATION" as const,
					startSec: 10,
					endSec: 20,
					speechSummary: "now in app B",
					visualSummary: "",
					preservationStatus: "SHOULD_SURVIVE" as const,
					confidence: "HIGH" as const,
					evidenceRefs: [],
				},
			],
			globalNotes: [],
			uncertaintyNotes: [],
		};
		const decisions = decideAutonomousTransitions({
			document,
			sourceStory: sourceStory as never,
			maxApply: 2,
		});
		expect(decisions[0]!.decision).toBe("KEEP");
		expect(decisions[0]!.relationship).toBe("HARD_CHANGE");
	});

	it("busy join (zoom nearby) forces KEEP even on section change", () => {
		let document = docWithClips([
			{ id: "c1", assetId: "a", start: 0, end: 10 },
			{ id: "c2", assetId: "a", start: 10, end: 20 },
		]);
		document = {
			...document,
			zoomRanges: [
				{
					id: "z1",
					startMs: 9500,
					endMs: 11000,
					depth: 2,
					focus: { cx: 0.5, cy: 0.5 },
				},
			],
		};
		const sourceStory = {
			providerId: "test",
			version: 1 as const,
			assetId: "a",
			sourceDurationSec: 20,
			beats: [
				{
					id: "b0",
					kind: "EXPLANATION" as const,
					startSec: 0,
					endSec: 10,
					speechSummary: "a",
					visualSummary: "",
					preservationStatus: "SHOULD_SURVIVE" as const,
					confidence: "HIGH" as const,
					evidenceRefs: [],
				},
				{
					id: "b1",
					kind: "ACTION_DEMONSTRATION" as const,
					startSec: 10,
					endSec: 20,
					speechSummary: "b",
					visualSummary: "",
					preservationStatus: "SHOULD_SURVIVE" as const,
					confidence: "HIGH" as const,
					evidenceRefs: [],
				},
			],
			globalNotes: [],
			uncertaintyNotes: [],
		};
		const decisions = decideAutonomousTransitions({
			document,
			sourceStory: sourceStory as never,
			maxApply: 2,
		});
		expect(decisions[0]!.decision).toBe("KEEP");
		expect(decisions[0]!.nearbyBusyVisual).toBe(true);
	});

	it("planBridge emits transitionId for APPLY and skips KEEP/cut", () => {
		const document = docWithClips([
			{ id: "c1", assetId: "a", start: 0, end: 10 },
			{ id: "c2", assetId: "a", start: 10, end: 20 },
		]);
		const ops = generateTransitionOpportunities({
			clipCount: 2,
			secondClipId: "c2",
			wantDissolve: true,
			document,
			sourceStory: {
				providerId: "test",
				version: 1,
				assetId: "a",
				sourceDurationSec: 20,
				beats: [
					{
						id: "b0",
						kind: "OPENING_SETUP",
						startSec: 0,
						endSec: 10,
						speechSummary: "hi",
						visualSummary: "",
						preservationStatus: "SHOULD_SURVIVE",
						confidence: "HIGH",
						evidenceRefs: [],
					},
					{
						id: "b1",
						kind: "ACTION_DEMONSTRATION",
						startSec: 10,
						endSec: 20,
						speechSummary: "demo",
						visualSummary: "",
						preservationStatus: "SHOULD_SURVIVE",
						confidence: "HIGH",
						evidenceRefs: [],
					},
				],
				globalNotes: [],
				uncertaintyNotes: [],
			} as never,
			targetStory: {
				providerId: "test",
				version: 1,
				beats: [
					{
						id: "t0",
						sourceBeatIds: ["b0"],
						purpose: "OPENING_SETUP",
						viewerShouldUnderstand: "",
						pacingIntent: "NORMAL",
						attentionIntent: "KEEP_FRAME",
						visualTreatment: {
							transition: "CUT",
							framing: "none",
							speedMultiplier: 1,
							title: "NO_TITLE",
						},
						skillHints: [],
						preserve: true,
						confidence: "HIGH",
					},
					{
						id: "t1",
						sourceBeatIds: ["b1"],
						purpose: "ACTION_DEMONSTRATION",
						viewerShouldUnderstand: "",
						pacingIntent: "NORMAL",
						attentionIntent: "KEEP_FRAME",
						visualTreatment: {
							transition: "DISSOLVE",
							framing: "none",
							speedMultiplier: 1,
							title: "NO_TITLE",
						},
						skillHints: ["ADD_TRANSITION"],
						preserve: true,
						confidence: "HIGH",
					},
				],
				globalSkillHints: [],
				unsupportedDesiredSkills: [],
			} as never,
		});
		const ready = ops.filter((o) => o.executionReadiness === "READY");
		expect(ready.length).toBeGreaterThanOrEqual(1);
		expect(ready[0]!.derivedParameters.transitionId).toBeTruthy();
		const steps = opportunitiesToPlanSteps(ready);
		expect(steps.some((s) => s.operationType === "setClipIncomingTransition")).toBe(true);
		expect(
			steps.find((s) => s.operationType === "setClipIncomingTransition")!.operationArgs
				.transitionId,
		).not.toBe("openscreen.cut");
	});

	it("trim-created segments do not inherit dissolve (anti-spam)", () => {
		const clips = docWithClips([{ id: "c1", assetId: "a", start: 0, end: 20 }]).timeline.clips.map(
			(c) => ({
				...c,
				incomingTransition: {
					kind: "dissolve" as const,
					transitionId: "openscreen.dissolve",
					durationSec: 0.35,
				},
			}),
		);
		const segs = resolvePlaybackSegments(clips, [
			{ id: "t1", startSec: 8, endSec: 10, clipId: "c1" },
		]);
		expect(segs.length).toBeGreaterThanOrEqual(2);
		expect(segs[0]!.incomingTransition?.transitionId).toBe("openscreen.dissolve");
		expect(segs[1]!.incomingTransition?.transitionId).toBe("openscreen.cut");
	});

	it("direct Chat still overrides autonomous (wipe left)", () => {
		const document = docWithClips([
			{ id: "c1", assetId: "a", start: 0, end: 10 },
			{ id: "c2", assetId: "a", start: 10, end: 20 },
		]);
		const r = applyLocalEditorialControl({
			projectId: document.project.id,
			document,
			userMessage: "use wipe left here",
		});
		expect(r.cloudCalls).toBe(0);
		expect(r.mutated).toBe(true);
		expect(r.document.timeline.clips[1]!.incomingTransition?.transitionId).toBe("gl.wipeLeft");
	});

	it("never proposes quarantined ids", () => {
		const eligible = listAutonomousEligible("metal");
		expect(eligible.every((e) => e.id !== "gl.circleOpen")).toBe(true);
		expect(eligible.every((e) => e.autonomousEligible)).toBe(true);
	});
});
