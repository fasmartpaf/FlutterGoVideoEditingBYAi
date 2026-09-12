import { describe, expect, it } from "vitest";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import type { SourceStory } from "../sourceStory/types";
import { stripInternalEvidenceJsonBlocks } from "../speechEvidence/format";
import {
	inferEditingIntentHints,
	parseAndValidateTargetStory,
	prepareTargetStoryForTurn,
	validateTargetStory,
	wantsTargetStory,
} from "./index";

const NARRATED_SOURCE: SourceStory = {
	sourceDurationSec: 16.896,
	overallSummary:
		"Narrated OpenScreen walkthrough: intro, timeline explanation, pause, then code/audit.",
	contentType: "tutorial",
	primaryGoal: "Demonstrate OpenScreen editor",
	storyBeats: [
		{
			id: "b1",
			startSourceTimeSec: 0,
			endSourceTimeSec: 4.5,
			purpose: "intro",
			summary: "Introduction to the OpenScreen editor.",
			spokenMeaning: "Introduces the demo.",
			visualMeaning: "Editor interface visible.",
			evidence: { speechSegmentIds: ["s1"], visualTimes: [0, 2] },
			confidence: "high",
		},
		{
			id: "b2",
			startSourceTimeSec: 4.5,
			endSourceTimeSec: 8.5,
			purpose: "explanation",
			summary: "Timeline and clip arrangement explanation.",
			spokenMeaning: "Explains the timeline.",
			visualMeaning: "Editor layout continues.",
			evidence: { speechSegmentIds: ["s2"], visualTimes: [6, 8] },
			confidence: "high",
		},
		{
			id: "b_gap_1",
			startSourceTimeSec: 8.5,
			endSourceTimeSec: 10.9,
			purpose: "pause",
			summary: "Speech pauses; visual context continues.",
			visualMeaning: "Context continues across the gap.",
			evidence: { visualTimes: [10] },
			confidence: "medium",
		},
		{
			id: "b3",
			startSourceTimeSec: 10.9,
			endSourceTimeSec: 16.9,
			purpose: "navigation",
			summary: "Moves into code and technical audit.",
			spokenMeaning: "Opens technical audit document.",
			visualMeaning: "Document/architecture content.",
			evidence: { speechSegmentIds: ["s3"], visualTimes: [12, 14, 16] },
			confidence: "high",
		},
	],
};

function polishTarget(overrides?: Record<string, unknown>) {
	return {
		objective: "Deliver a polished professional software tutorial without over-editing.",
		audienceExperience:
			"Clear instructional progression with intentional pacing and focused attention.",
		style: { pacing: "balanced", density: "balanced", tone: "professional instructional" },
		editingIntent: {
			objective: "polish",
			constraints: ["do not over-edit", "keep useful explanation"],
			desiredQualities: ["clarity", "intentional pacing", "easy-to-follow progression"],
			preserveMeaning: true,
		},
		targetBeats: [
			{
				id: "t1",
				sourceBeatIds: ["b1"],
				purpose: "intro",
				desiredOutcome: "Establish the OpenScreen demonstration quickly and clearly.",
				importance: "essential",
				pacing: "preserve",
				changeNeeded: false,
				rationale: "Intro already supports the instructional goal.",
			},
			{
				id: "t2",
				sourceBeatIds: ["b2"],
				purpose: "explanation",
				desiredOutcome: "Keep the timeline explanation concise and visually focused.",
				importance: "essential",
				pacing: "preserve",
				changeNeeded: false,
				rationale: "Useful explanation should remain.",
			},
			{
				id: "t3",
				sourceBeatIds: ["b_gap_1"],
				purpose: "transition",
				desiredOutcome: "Make the move into code feel continuous and deliberate.",
				importance: "supporting",
				pacing: "preserve",
				changeNeeded: true,
				rationale: "Transition should feel intentional, not automatically removed.",
			},
			{
				id: "t4",
				sourceBeatIds: ["b3"],
				purpose: "demonstration",
				desiredOutcome: "Keep attention on the relevant code/audit information.",
				importance: "essential",
				pacing: "preserve",
				changeNeeded: false,
				rationale: "Technical section already carries the point.",
			},
		],
		preserve: [
			{ id: "p1", description: "core timeline explanation" },
			{ id: "p2", description: "spoken technical meaning in the code section" },
		],
		change: [
			{
				id: "c1",
				description: "Improve continuity of the mid-recording transition into implementation.",
				rationale: "Viewer should not lose the thread.",
			},
		],
		...overrides,
	};
}

function shortenTarget() {
	return {
		objective: "Deliver a much more concise cut that keeps only essential explanation.",
		audienceExperience: "Faster entry and denser instructional beats with less dwell.",
		style: { pacing: "faster", density: "minimal", tone: "brisk tutorial" },
		editingIntent: {
			objective: "shorten",
			constraints: ["keep the important explanation"],
			desiredQualities: ["brevity", "essential explanation"],
			preserveMeaning: true,
		},
		targetBeats: [
			{
				id: "t1",
				sourceBeatIds: ["b1"],
				purpose: "intro",
				desiredOutcome: "Get to the purpose quickly.",
				importance: "essential",
				pacing: "compress",
				changeNeeded: true,
				rationale: "Opening can be tighter for a concise cut.",
			},
			{
				id: "t2",
				sourceBeatIds: ["b2"],
				purpose: "explanation",
				desiredOutcome: "Retain the important timeline explanation in shorter form.",
				importance: "essential",
				pacing: "compress",
				changeNeeded: true,
				rationale: "Keep meaning while reducing length.",
			},
			{
				id: "t3",
				sourceBeatIds: ["b_gap_1"],
				purpose: "transition",
				desiredOutcome: "Keep the mid transition brief while staying continuous.",
				importance: "optional",
				pacing: "compress",
				changeNeeded: true,
				rationale: "Concise flow may tighten the gap without treating it as automatic removal.",
			},
			{
				id: "t4",
				sourceBeatIds: ["b3"],
				purpose: "demonstration",
				desiredOutcome: "End once the technical point is established.",
				importance: "essential",
				pacing: "compress",
				changeNeeded: true,
				rationale: "Demonstration can land sooner.",
			},
		],
		preserve: [{ id: "p1", description: "important explanation meaning" }],
		change: [
			{
				id: "c1",
				description: "Reduce nonessential dwell across phases while keeping core explanation.",
			},
		],
	};
}

function preserveTarget() {
	return {
		objective: "Keep almost everything while making the flow easier to follow.",
		audienceExperience: "Familiar full walkthrough with clearer phase-to-phase continuity.",
		style: { pacing: "balanced", density: "rich", tone: "patient instructional" },
		editingIntent: {
			objective: "clarify",
			constraints: ["keep almost everything"],
			desiredQualities: ["easy-to-follow progression"],
			preserveMeaning: true,
		},
		targetBeats: [
			{
				id: "t1",
				sourceBeatIds: ["b1"],
				purpose: "intro",
				desiredOutcome: "Keep the introduction as-is.",
				importance: "essential",
				pacing: "preserve",
				changeNeeded: false,
				rationale: "User asked to keep almost everything.",
			},
			{
				id: "t2",
				sourceBeatIds: ["b2"],
				purpose: "explanation",
				desiredOutcome: "Keep the timeline explanation intact.",
				importance: "essential",
				pacing: "preserve",
				changeNeeded: false,
				rationale: "Preserve spoken explanation.",
			},
			{
				id: "t3",
				sourceBeatIds: ["b_gap_1"],
				purpose: "transition",
				desiredOutcome: "Clarify the pause as a deliberate handoff into the next idea.",
				importance: "supporting",
				pacing: "preserve",
				changeNeeded: true,
				rationale: "Only light continuity help — not shortening.",
			},
			{
				id: "t4",
				sourceBeatIds: ["b3"],
				purpose: "demonstration",
				desiredOutcome: "Keep the full code/audit section.",
				importance: "essential",
				pacing: "preserve",
				changeNeeded: false,
				rationale: "Do not shorten under a preserve request.",
			},
		],
		preserve: [
			{ id: "p1", description: "all major spoken phases" },
			{ id: "p2", description: "overall length and coverage" },
		],
		change: [
			{
				id: "c1",
				description: "Make phase boundaries easier to follow without removing content.",
			},
		],
	};
}

describe("targetStory Bug 7", () => {
	it("1 — editingContext generates Target Story prep", () => {
		const needs = classifyMediaContextNeeds(
			"Make this a polished professional software tutorial without over-editing.",
		);
		expect(needs.category).toBe("editingContext");
		expect(wantsTargetStory(needs)).toBe(true);
		const prep = prepareTargetStoryForTurn({
			contextNeeds: needs,
			userMessage: "Make this a polished professional software tutorial without over-editing.",
			sourceStoryRequested: true,
		});
		expect(prep?.requested).toBe(true);
		expect(prep!.instructionChars).toBeGreaterThan(200);
		expect(prep!.promptSection).toMatch(/TARGET STORY/);
	});

	it("2 — mediaUnderstanding informational request does not", () => {
		const needs = classifyMediaContextNeeds("What is this recording about?");
		expect(needs.category).toBe("mediaUnderstanding");
		expect(wantsTargetStory(needs)).toBe(false);
		expect(
			prepareTargetStoryForTurn({
				contextNeeds: needs,
				userMessage: "What is this recording about?",
				sourceStoryRequested: true,
			}),
		).toBeNull();
	});

	it("3 — deterministic edit bypasses Target Story", () => {
		const needs = classifyMediaContextNeeds("Delete 3 to 5 seconds.");
		expect(needs.category).toBe("deterministicEdit");
		expect(wantsTargetStory(needs)).toBe(false);
		expect(
			prepareTargetStoryForTurn({
				contextNeeds: needs,
				userMessage: "Delete 3 to 5 seconds.",
				sourceStoryRequested: false,
			}),
		).toBeNull();
	});

	it("4 — Target Story references valid Source Story beats", () => {
		const v = validateTargetStory(polishTarget(), {
			sourceStory: NARRATED_SOURCE,
			userMessage: "Make this a polished professional software tutorial without over-editing.",
		});
		expect(v.ok).toBe(true);
		expect(v.story?.targetBeats.every((b) => b.sourceBeatIds.length > 0)).toBe(true);
	});

	it("5 — unsupported source beat reference rejected", () => {
		const bad = polishTarget({
			targetBeats: [
				{
					id: "t1",
					sourceBeatIds: ["b_missing"],
					purpose: "intro",
					desiredOutcome: "x",
					importance: "essential",
					pacing: "preserve",
					changeNeeded: false,
					rationale: "y",
				},
			],
		});
		const v = validateTargetStory(bad, {
			sourceStory: NARRATED_SOURCE,
			userMessage: "polish",
		});
		expect(v.ok).toBe(false);
		expect(v.errors.some((e) => /unknown sourceBeatId/i.test(e))).toBe(true);
	});

	it("6/7 — NO-CHANGE/PRESERVE is valid; not every beat must change", () => {
		const v = validateTargetStory(polishTarget(), {
			sourceStory: NARRATED_SOURCE,
			userMessage: "Make this a polished professional software tutorial without over-editing.",
		});
		expect(v.ok).toBe(true);
		expect(v.story!.targetBeats.some((b) => b.changeNeeded === false)).toBe(true);
		expect(v.story!.preserve.length).toBeGreaterThan(0);
	});

	it("8 — explicit user constraints preserved / contradicting shorten rejected", () => {
		const msg = "Do not remove anything. Keep every spoken explanation, but improve the flow.";
		const bad = {
			...preserveTarget(),
			change: [
				{
					id: "c1",
					description: "Remove the intro and delete spoken explanation for pace.",
				},
			],
		};
		const v = validateTargetStory(bad, { sourceStory: NARRATED_SOURCE, userMessage: msg });
		expect(v.ok).toBe(false);
		expect(v.errors.some((e) => /do-not-remove|keep/i.test(e))).toBe(true);
	});

	it("9/10 — shorten request differs from polish; preserve differs from shorten", () => {
		const polish = validateTargetStory(polishTarget(), {
			sourceStory: NARRATED_SOURCE,
			userMessage: "Make this a polished professional software tutorial without over-editing.",
		}).story!;
		const shorten = validateTargetStory(shortenTarget(), {
			sourceStory: NARRATED_SOURCE,
			userMessage: "Make this much more concise while keeping the important explanation.",
		}).story!;
		const keep = validateTargetStory(preserveTarget(), {
			sourceStory: NARRATED_SOURCE,
			userMessage: "Keep almost everything, but make the flow easier to follow.",
		}).story!;

		expect(polish.editingIntent.objective).toBe("polish");
		expect(shorten.editingIntent.objective).toBe("shorten");
		expect(keep.editingIntent.objective).toBe("clarify");
		expect(shorten.style.pacing).toBe("faster");
		expect(keep.style.density).toBe("rich");
		expect(JSON.stringify(polish)).not.toEqual(JSON.stringify(shorten));
		expect(JSON.stringify(keep)).not.toEqual(JSON.stringify(shorten));
	});

	it("11 — target does not invent missing source material (testimonial)", () => {
		const invented = polishTarget({
			objective: "Turn into a customer testimonial",
			targetBeats: [
				{
					id: "t1",
					sourceBeatIds: ["b1"],
					purpose: "outro",
					desiredOutcome: 'End with customer says "I love your product" as a happy customer.',
					importance: "essential",
					pacing: "expand_attention",
					changeNeeded: true,
					rationale: "Need a testimonial ending.",
				},
			],
		});
		const v = validateTargetStory(invented, {
			sourceStory: NARRATED_SOURCE,
			userMessage: "Turn this into a strong customer testimonial.",
		});
		expect(v.ok).toBe(false);
		expect(v.errors.some((e) => /testimonial/i.test(e))).toBe(true);
	});

	it("12 — silent video Target Story without narration invention is valid", () => {
		const silentSource: SourceStory = {
			sourceDurationSec: 4.875,
			overallSummary: "Static code editor screen recording.",
			contentType: "screen_recording",
			storyBeats: [
				{
					id: "b1",
					startSourceTimeSec: 0,
					endSourceTimeSec: 4.875,
					purpose: "setup",
					summary: "Stable editor layout.",
					visualMeaning: "Code editor and terminal.",
					evidence: { visualTimes: [0, 2, 4] },
					confidence: "medium",
				},
			],
		};
		const target = {
			objective: "Make the screen recording easier to follow and more professional.",
			audienceExperience: "Clear visual walkthrough of the project layout.",
			style: { pacing: "balanced", density: "minimal" },
			editingIntent: {
				objective: "clarify",
				constraints: [],
				desiredQualities: ["clarity"],
				preserveMeaning: true,
			},
			targetBeats: [
				{
					id: "t1",
					sourceBeatIds: ["b1"],
					purpose: "demonstration",
					desiredOutcome: "Present the editor layout so a viewer can orient quickly.",
					importance: "essential",
					pacing: "preserve",
					changeNeeded: false,
					rationale: "Visual-only source; no narration to invent.",
				},
			],
			preserve: [{ id: "p1", description: "visible project layout" }],
			change: [],
			uncertainties: [{ note: "No speech available; confidence lower for spoken intent." }],
		};
		const v = validateTargetStory(target, {
			sourceStory: silentSource,
			userMessage: "Make this screen recording easier to follow and more professional.",
		});
		expect(v.ok).toBe(true);
		expect(v.story?.uncertainties?.length).toBeGreaterThan(0);
	});

	it("13/14 — chronological by default; reordering requires justification", () => {
		const reordered = polishTarget({
			targetBeats: [
				{
					id: "t1",
					sourceBeatIds: ["b3"],
					purpose: "hook",
					desiredOutcome: "Start with the code result.",
					importance: "essential",
					pacing: "preserve",
					changeNeeded: true,
					rationale: "Hook first.",
				},
				{
					id: "t2",
					sourceBeatIds: ["b1"],
					purpose: "intro",
					desiredOutcome: "Then introduce the editor.",
					importance: "essential",
					pacing: "preserve",
					changeNeeded: true,
					rationale: "After hook.",
				},
			],
		});
		const bad = validateTargetStory(reordered, {
			sourceStory: NARRATED_SOURCE,
			userMessage: "polish",
		});
		expect(bad.ok).toBe(false);
		expect(bad.errors.some((e) => /reorderJustification/i.test(e))).toBe(true);

		const justified = polishTarget({
			targetBeats: [
				{
					id: "t1",
					sourceBeatIds: ["b3"],
					purpose: "hook",
					desiredOutcome: "Open on the strongest demonstration moment.",
					importance: "essential",
					pacing: "preserve",
					changeNeeded: true,
					rationale: "User asked for a result-first structure.",
					reorderJustification: "User explicitly requested result-first opening.",
				},
				{
					id: "t2",
					sourceBeatIds: ["b1"],
					purpose: "intro",
					desiredOutcome: "Then establish context.",
					importance: "supporting",
					pacing: "preserve",
					changeNeeded: true,
					rationale: "Follows justified reorder.",
					reorderJustification: "Continues the explicit result-first structure.",
				},
			],
		});
		const ok = validateTargetStory(justified, {
			sourceStory: NARRATED_SOURCE,
			userMessage: "Start with the result then introduce the tool.",
		});
		expect(ok.ok, JSON.stringify(ok.errors)).toBe(true);
	});

	it("15 — implementation-level edit operations not allowed", () => {
		const bad = polishTarget({
			targetBeats: [
				{
					id: "t1",
					sourceBeatIds: ["b1"],
					purpose: "intro",
					desiredOutcome: "Apply a 1.35x zoom from 10.2 to 13.8.",
					importance: "essential",
					pacing: "preserve",
					changeNeeded: true,
					rationale: "zoom it",
				},
			],
		});
		const v = validateTargetStory(bad, {
			sourceStory: NARRATED_SOURCE,
			userMessage: "polish",
		});
		expect(v.ok).toBe(false);
		expect(v.errors.some((e) => /implementation-level/i.test(e))).toBe(true);
	});

	it("16 — pause is not automatically targeted for removal", () => {
		const bad = polishTarget({
			targetBeats: [
				{
					id: "t1",
					sourceBeatIds: ["b_gap_1"],
					purpose: "transition",
					desiredOutcome: "Remove this dead time pause.",
					importance: "optional",
					pacing: "compress",
					changeNeeded: true,
					rationale: "Delete the pause automatically.",
				},
			],
		});
		const v = validateTargetStory(bad, {
			sourceStory: NARRATED_SOURCE,
			userMessage: "polish",
		});
		expect(v.ok).toBe(false);
		expect(v.errors.some((e) => /pause\/transition/i.test(e))).toBe(true);
	});

	it("17/18 — transition effect / zoom not auto-required language allowed only as outcomes", () => {
		const ok = validateTargetStory(
			polishTarget({
				change: [
					{
						id: "c1",
						description: "The transition should feel continuous and deliberate.",
					},
					{
						id: "c2",
						description: "Keep attention centered on the relevant code while it is explained.",
					},
				],
			}),
			{
				sourceStory: NARRATED_SOURCE,
				userMessage: "Make this a polished professional software tutorial without over-editing.",
			},
		);
		expect(ok.ok).toBe(true);
	});

	it("19 — natural user response does not expose Target Story JSON after strip", () => {
		const raw = [
			"```json",
			JSON.stringify(polishTarget()),
			"```",
			"",
			"I'd keep the opening concise and preserve the timeline explanation.",
		].join("\n");
		const stripped = stripInternalEvidenceJsonBlocks(raw);
		expect(stripped).not.toMatch(/targetBeats/);
		expect(stripped).toMatch(/I'd keep the opening concise/);
	});

	it("20 — malformed Target Story does not crash", () => {
		const v = parseAndValidateTargetStory("no json here", {
			sourceStory: NARRATED_SOURCE,
			userMessage: "polish",
		});
		expect(v.ok).toBe(false);
		expect(v.story).toBeNull();
	});

	it("21 — intent hints differ for polish vs shorten vs preserve", () => {
		expect(
			inferEditingIntentHints(
				"Make this a polished professional software tutorial without over-editing.",
			).objective,
		).toBe("polish");
		expect(
			inferEditingIntentHints(
				"Make this much more concise while keeping the important explanation.",
			).objective,
		).toBe("shorten");
		expect(
			inferEditingIntentHints("Keep almost everything, but make the flow easier to follow.")
				.objective,
		).toBe("clarify");
	});

	it("unsupported goal records limitation shape (valid with uncertainties)", () => {
		const limited = {
			objective: "Acknowledge the recording cannot become a customer testimonial as-is.",
			audienceExperience:
				"Viewer still sees a software walkthrough; testimonial material is unavailable.",
			style: { pacing: "balanced", density: "balanced" },
			editingIntent: {
				objective: "repurpose",
				constraints: [],
				desiredQualities: ["honesty about source limits"],
				preserveMeaning: true,
			},
			targetBeats: [
				{
					id: "t1",
					sourceBeatIds: ["b1", "b2", "b3"],
					purpose: "other",
					desiredOutcome:
						"Retain the software walkthrough as the available story; do not fabricate customer praise.",
					importance: "essential",
					pacing: "preserve",
					changeNeeded: false,
					rationale: "Source lacks testimonial content.",
				},
			],
			preserve: [{ id: "p1", description: "existing walkthrough meaning" }],
			change: [],
			uncertainties: [
				{
					note: "Source recording lacks a clear customer testimonial or product endorsement.",
					relatedSourceBeatIds: ["b1", "b2", "b3"],
				},
			],
		};
		const v = validateTargetStory(limited, {
			sourceStory: NARRATED_SOURCE,
			userMessage: "Turn this into a strong customer testimonial.",
		});
		expect(v.ok).toBe(true);
		expect(v.story?.uncertainties?.[0]?.note).toMatch(/testimonial/i);
	});
});
