import { describe, expect, it } from "vitest";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import { stripInternalEvidenceJsonBlocks } from "../speechEvidence/format";
import type { SpeechEvidence } from "../speechEvidence/types";
import type { VisualChange, VisualEvidenceFrame } from "../visualEvidence/types";
import {
	buildSourceStoryScaffold,
	collectStoryBoundaryCandidates,
	formatSourceStoryScaffoldText,
	hedgeContradictionOverallSummary,
	normalizeSourceStoryContentType,
	normalizeSourceStoryPurpose,
	parseAndValidateSourceStory,
	prepareSourceStoryForTurn,
	SOURCE_STORY_PURPOSES,
	validateSourceStory,
	wantsSourceStory,
} from "./index";
import type { SourceStory } from "./types";

void null as unknown as SourceStory | null;
function speechEv(segments: SpeechEvidence["segments"]): SpeechEvidence {
	return {
		assetId: "asset_1",
		sourceDurationSec: 16.896,
		segments,
		status: "available",
		audioStreamPresent: true,
		timings: {
			audioProbeMs: 0,
			audioExtractMs: 0,
			sttMs: 0,
			transcriptParseMs: 0,
			transcriptCacheMs: 0,
			segmentCount: segments.length,
			cacheHit: true,
		},
	};
}

function frame(t: number): VisualEvidenceFrame {
	return {
		assetId: "asset_1",
		sourceTimeSec: t,
		virtualTimeSec: t,
		reason: "periodic",
		imagePath: `/tmp/f-${t}.jpg`,
		mimeType: "image/jpeg",
		width: 64,
		height: 36,
		byteLength: 10,
	};
}

const NARRATED_SPEECH = speechEv([
	{
		startSourceTimeSec: 0,
		endSourceTimeSec: 4.5,
		text: "Today I am going to show you the open screen editor and walk through a short demo.",
	},
	{
		startSourceTimeSec: 4.5,
		endSourceTimeSec: 8.5,
		text: "First we look at the timeline and how clips are arranged on the ruler.",
	},
	{
		startSourceTimeSec: 10.9,
		endSourceTimeSec: 17,
		text: "Now let's move into the code and open the technical audit document.",
	},
]);

const CHANGES: VisualChange[] = [
	{
		fromSourceTimeSec: 8,
		toSourceTimeSec: 10,
		score: 0.12,
		classification: "significant",
	},
];

describe("sourceStory Bug 6", () => {
	it("1 — story timestamps use canonical source time", () => {
		const scaffold = buildSourceStoryScaffold({
			sourceDurationSec: 16.896,
			speechEvidence: NARRATED_SPEECH,
			frames: [0, 2, 4, 6, 8, 10, 12, 14, 16].map(frame),
			changes: CHANGES,
		});
		expect(scaffold.sourceDurationSec).toBe(16.896);
		for (const w of scaffold.windows) {
			expect(w.startSourceTimeSec).toBeGreaterThanOrEqual(0);
			expect(w.endSourceTimeSec).toBeLessThanOrEqual(16.896 + 0.001);
		}
	});

	it("2 — beats remain in bounds", () => {
		const scaffold = buildSourceStoryScaffold({
			sourceDurationSec: 16.896,
			speechEvidence: NARRATED_SPEECH,
			frames: [0, 8, 16].map(frame),
		});
		const raw = {
			sourceDurationSec: 16.896,
			overallSummary: "Narrated walkthrough of the editor then code.",
			contentType: "tutorial",
			storyBeats: [
				{
					id: "b1",
					startSourceTimeSec: 0,
					endSourceTimeSec: 8.5,
					purpose: "setup",
					summary: "Speaker introduces the editor and timeline.",
					evidence: { speechSegmentIds: ["s1", "s2"], visualTimes: [0, 8] },
					confidence: "high",
				},
				{
					id: "b2",
					startSourceTimeSec: 8.5,
					endSourceTimeSec: 10.9,
					purpose: "pause",
					summary: "Speech pauses around a visual transition.",
					evidence: { visualTimes: [8] },
					confidence: "medium",
				},
				{
					id: "b3",
					startSourceTimeSec: 10.9,
					endSourceTimeSec: 16.896,
					purpose: "demonstration",
					summary: "Speaker moves into the code / technical audit.",
					evidence: { speechSegmentIds: ["s3"], visualTimes: [16] },
					confidence: "high",
				},
			],
		};
		const v = validateSourceStory(raw, scaffold);
		expect(v.ok).toBe(true);
		expect(v.story?.storyBeats.every((b) => b.endSourceTimeSec <= 16.896 + 0.35)).toBe(true);
	});

	it("3 — beat chronology valid / overlaps rejected", () => {
		const scaffold = buildSourceStoryScaffold({
			sourceDurationSec: 10,
			speechEvidence: speechEv([
				{ startSourceTimeSec: 0, endSourceTimeSec: 3, text: "Hello" },
				{ startSourceTimeSec: 5, endSourceTimeSec: 8, text: "World" },
			]),
			frames: [0, 5].map(frame),
		});
		const bad = validateSourceStory(
			{
				sourceDurationSec: 10,
				overallSummary: "x",
				contentType: "demo",
				storyBeats: [
					{
						id: "b1",
						startSourceTimeSec: 0,
						endSourceTimeSec: 6,
						purpose: "intro",
						summary: "A",
						evidence: { speechSegmentIds: ["s1"] },
						confidence: "medium",
					},
					{
						id: "b2",
						startSourceTimeSec: 5,
						endSourceTimeSec: 9,
						purpose: "demonstration",
						summary: "B",
						evidence: { speechSegmentIds: ["s2"] },
						confidence: "medium",
					},
				],
			},
			scaffold,
		);
		expect(bad.ok).toBe(false);
		expect(bad.errors.some((e) => /overlap/i.test(e))).toBe(true);
	});

	it("4 — no arbitrary transcript-segment-per-beat copy", () => {
		const scaffold = buildSourceStoryScaffold({
			sourceDurationSec: 16.896,
			speechEvidence: NARRATED_SPEECH,
			frames: [0, 8, 16].map(frame),
		});
		const copy = validateSourceStory(
			{
				sourceDurationSec: 16.896,
				overallSummary: "transcript copy",
				contentType: "tutorial",
				storyBeats: scaffold.speechSegments.map((s, i) => ({
					id: `b${i + 1}`,
					startSourceTimeSec: s.startSourceTimeSec,
					endSourceTimeSec: s.endSourceTimeSec,
					purpose: "explanation",
					summary: s.text,
					evidence: { speechSegmentIds: [s.id] },
					confidence: "high",
				})),
			},
			scaffold,
		);
		expect(copy.ok).toBe(false);
		expect(copy.errors.some((e) => /transcript-segment-per-beat/i.test(e))).toBe(true);
	});

	it("5 — no arbitrary visual-frame-per-beat behavior", () => {
		const times = [0, 2, 4, 6, 8, 10];
		const scaffold = buildSourceStoryScaffold({
			sourceDurationSec: 12,
			frames: times.map(frame),
			changes: [],
		});
		const copy = validateSourceStory(
			{
				sourceDurationSec: 12,
				overallSummary: "frames",
				contentType: "screen_recording",
				storyBeats: times.map((t, i) => ({
					id: `b${i + 1}`,
					startSourceTimeSec: t,
					endSourceTimeSec: t + 1.5,
					purpose: "unknown",
					summary: `frame at ${t}`,
					evidence: { visualTimes: [t] },
					confidence: "low",
				})),
			},
			scaffold,
		);
		expect(copy.ok).toBe(false);
		expect(copy.errors.some((e) => /one-beat-per-visual-frame/i.test(e))).toBe(true);
	});

	it("6 — narrated source scaffold uses speech + visual evidence", () => {
		const scaffold = buildSourceStoryScaffold({
			sourceDurationSec: 16.896,
			speechEvidence: NARRATED_SPEECH,
			frames: [0, 4, 8, 12, 16].map(frame),
			changes: CHANGES,
		});
		expect(scaffold.speechSegments.length).toBe(3);
		expect(scaffold.visualTimes.length).toBe(5);
		expect(scaffold.windows.some((w) => w.speechGap)).toBe(true);
		expect(scaffold.windows.some((w) => w.speech.length > 0)).toBe(true);
	});

	it("7 — silent source still produces story scaffold", () => {
		const scaffold = buildSourceStoryScaffold({
			sourceDurationSec: 11.8,
			speechEvidence: {
				...speechEv([]),
				status: "no_speech_detected",
				sourceDurationSec: 11.8,
			},
			frames: [0, 2, 4, 6, 8, 10].map(frame),
			changes: [
				{
					fromSourceTimeSec: 4,
					toSourceTimeSec: 6,
					score: 0.15,
					classification: "significant",
				},
			],
			cursorEventTimes: [5.2],
		});
		expect(scaffold.speechSegments.length).toBe(0);
		expect(scaffold.windows.length).toBeGreaterThan(0);
		const story = validateSourceStory(
			{
				sourceDurationSec: 11.8,
				overallSummary: "Silent screen recording showing an app transition mid-clip.",
				contentType: "screen_recording",
				storyBeats: [
					{
						id: "b1",
						startSourceTimeSec: 0,
						endSourceTimeSec: 5,
						purpose: "setup",
						summary: "Stable early screen state across samples.",
						evidence: { visualTimes: [0, 2, 4] },
						confidence: "medium",
					},
					{
						id: "b2",
						startSourceTimeSec: 5,
						endSourceTimeSec: 11.8,
						purpose: "demonstration",
						summary: "Application/content state changes; cursor interaction nearby.",
						evidence: { visualTimes: [6, 8, 10], cursorEventTimes: [5.2] },
						confidence: "medium",
					},
				],
			},
			scaffold,
		);
		expect(story.ok).toBe(true);
		expect(story.story?.storyBeats.every((b) => !b.spokenMeaning)).toBe(true);
	});

	it("8 — speech claim does not become verified visual fact", () => {
		const scaffold = buildSourceStoryScaffold({
			sourceDurationSec: 10,
			speechEvidence: speechEv([
				{
					startSourceTimeSec: 0,
					endSourceTimeSec: 4,
					text: "Now I'm opening the settings.",
				},
			]),
			frames: [0, 2].map(frame),
		});
		const v = validateSourceStory(
			{
				sourceDurationSec: 10,
				overallSummary: "Speaker mentions settings.",
				contentType: "demo",
				storyBeats: [
					{
						id: "b1",
						startSourceTimeSec: 0,
						endSourceTimeSec: 4,
						purpose: "navigation",
						summary: "User opens Settings.",
						spokenMeaning: "Opening settings",
						visualMeaning: "opens settings panel",
						evidence: { speechSegmentIds: ["s1"] },
						confidence: "high",
					},
				],
			},
			scaffold,
		);
		expect(v.ok).toBe(false);
	});

	it("9 — visual claim does not become spoken fact without speech ids", () => {
		const scaffold = buildSourceStoryScaffold({
			sourceDurationSec: 10,
			frames: [0, 5].map(frame),
		});
		const ok = validateSourceStory(
			{
				sourceDurationSec: 10,
				overallSummary: "Silent UI change.",
				contentType: "screen_recording",
				storyBeats: [
					{
						id: "b1",
						startSourceTimeSec: 0,
						endSourceTimeSec: 10,
						purpose: "demonstration",
						summary: "Visible app content changes across samples.",
						evidence: { visualTimes: [0, 5] },
						confidence: "medium",
					},
				],
			},
			scaffold,
		);
		expect(ok.ok).toBe(true);
		expect(ok.story?.storyBeats[0]?.evidence.speechSegmentIds).toBeUndefined();
	});

	it("10 — pause is not automatically classified as dead time", () => {
		expect((SOURCE_STORY_PURPOSES as readonly string[]).includes("dead_time")).toBe(false);
		const scaffold = buildSourceStoryScaffold({
			sourceDurationSec: 16.896,
			speechEvidence: NARRATED_SPEECH,
			frames: [8, 10].map(frame),
			changes: CHANGES,
		});
		const v = validateSourceStory(
			{
				sourceDurationSec: 16.896,
				overallSummary: "Walkthrough with a mid pause.",
				contentType: "tutorial",
				storyBeats: [
					{
						id: "b1",
						startSourceTimeSec: 8.5,
						endSourceTimeSec: 10.9,
						purpose: "pause",
						summary: "Speech pauses while the visual state changes.",
						evidence: { visualTimes: [8, 10] },
						confidence: "medium",
					},
				],
			},
			scaffold,
		);
		expect(v.ok).toBe(true);
		expect(v.story?.storyBeats[0]?.purpose).toBe("pause");
	});

	it("11 — correction/repetition requires speech evidence", () => {
		const scaffold = buildSourceStoryScaffold({
			sourceDurationSec: 10,
			frames: [0, 5].map(frame),
		});
		const v = validateSourceStory(
			{
				sourceDurationSec: 10,
				overallSummary: "x",
				contentType: "demo",
				storyBeats: [
					{
						id: "b1",
						startSourceTimeSec: 0,
						endSourceTimeSec: 10,
						purpose: "correction",
						summary: "User corrects a mistake.",
						evidence: { visualTimes: [0] },
						confidence: "high",
					},
				],
			},
			scaffold,
		);
		expect(v.ok).toBe(true);
		expect(v.story?.storyBeats[0]?.purpose).toBe("unknown");
		expect(v.story?.storyBeats[0]?.confidence).toBe("low");
	});

	it("12 — referenced speech segments must exist", () => {
		const scaffold = buildSourceStoryScaffold({
			sourceDurationSec: 16.896,
			speechEvidence: NARRATED_SPEECH,
			frames: [0].map(frame),
		});
		const v = validateSourceStory(
			{
				sourceDurationSec: 16.896,
				overallSummary: "x",
				contentType: "tutorial",
				storyBeats: [
					{
						id: "b1",
						startSourceTimeSec: 0,
						endSourceTimeSec: 4,
						purpose: "intro",
						summary: "Intro",
						evidence: { speechSegmentIds: ["s99"] },
						confidence: "medium",
					},
				],
			},
			scaffold,
		);
		expect(v.ok).toBe(false);
	});

	it("13 — referenced visual timestamps must exist", () => {
		const scaffold = buildSourceStoryScaffold({
			sourceDurationSec: 10,
			frames: [0, 2].map(frame),
		});
		const v = validateSourceStory(
			{
				sourceDurationSec: 10,
				overallSummary: "x",
				contentType: "screen_recording",
				storyBeats: [
					{
						id: "b1",
						startSourceTimeSec: 0,
						endSourceTimeSec: 5,
						purpose: "setup",
						summary: "Setup",
						evidence: { visualTimes: [7.5] },
						confidence: "medium",
					},
				],
			},
			scaffold,
		);
		expect(v.ok).toBe(false);
	});

	it("14 — unsupported high-confidence story claim rejected/downgraded", () => {
		const scaffold = buildSourceStoryScaffold({
			sourceDurationSec: 10,
			frames: [0].map(frame),
		});
		const v = validateSourceStory(
			{
				sourceDurationSec: 10,
				overallSummary: "x",
				contentType: "unknown",
				storyBeats: [
					{
						id: "b1",
						startSourceTimeSec: 0,
						endSourceTimeSec: 5,
						purpose: "explanation",
						summary: "The user is frustrated with the previous step.",
						evidence: {},
						confidence: "high",
					},
				],
			},
			scaffold,
		);
		expect(v.ok).toBe(true);
		expect(v.story?.storyBeats[0]?.confidence).toBe("low");
	});

	it("15 — malformed Source Story does not crash", () => {
		const scaffold = buildSourceStoryScaffold({
			sourceDurationSec: 10,
			frames: [0].map(frame),
		});
		expect(() => parseAndValidateSourceStory("hello only", scaffold)).not.toThrow();
		expect(parseAndValidateSourceStory("hello only", scaffold).ok).toBe(false);
		expect(() => validateSourceStory(null, scaffold)).not.toThrow();
	});

	it("16 — Source Story remains internal in normal user reply", () => {
		const raw = [
			"```json",
			JSON.stringify({
				sourceDurationSec: 10,
				overallSummary: "secret",
				contentType: "tutorial",
				storyBeats: [],
			}),
			"```",
			"",
			"This is a narrated software walkthrough of the editor.",
		].join("\n");
		const stripped = stripInternalEvidenceJsonBlocks(raw);
		expect(stripped).not.toMatch(/storyBeats/);
		expect(stripped).toMatch(/narrated software walkthrough/);
	});

	it("17 — no second LLM call (prepare is deterministic)", () => {
		const needs = classifyMediaContextNeeds(
			"Tell me what is happening in this recording, including what I'm explaining.",
		);
		const prep = prepareSourceStoryForTurn({
			contextNeeds: needs,
			sourceDurationSec: 16.896,
			speechEvidence: NARRATED_SPEECH,
			frames: [0, 8].map(frame),
		});
		expect(prep?.requested).toBe(true);
		expect(prep?.scaffold.timings.storyScaffoldPreparationMs).toBeLessThan(100);
	});

	it("18 — deterministic edit requests do not trigger Source Story", () => {
		const needs = classifyMediaContextNeeds("Delete 3–5 seconds.");
		expect(wantsSourceStory(needs)).toBe(false);
		expect(
			prepareSourceStoryForTurn({
				contextNeeds: needs,
				sourceDurationSec: 16.896,
				speechEvidence: NARRATED_SPEECH,
				frames: [0].map(frame),
			}),
		).toBeNull();
	});

	it("19 — mediaUnderstanding/editingContext may build Source Story", () => {
		expect(
			wantsSourceStory(
				classifyMediaContextNeeds(
					"Tell me what is happening in this recording, including what I'm explaining.",
				),
			),
		).toBe(true);
		expect(
			wantsSourceStory(
				classifyMediaContextNeeds("Make this recording feel like a polished software tutorial."),
			),
		).toBe(true);
	});

	it("boundaries are not one-per-speech-segment only", () => {
		const speech = [
			{ id: "s1", startSourceTimeSec: 0, endSourceTimeSec: 4.5, text: "a" },
			{ id: "s2", startSourceTimeSec: 4.5, endSourceTimeSec: 8.5, text: "b" },
			{ id: "s3", startSourceTimeSec: 10.9, endSourceTimeSec: 17, text: "c" },
		];
		const bounds = collectStoryBoundaryCandidates({
			sourceDurationSec: 16.896,
			speech,
			visualChanges: CHANGES,
			cursorEventTimes: [],
			hasSpeech: true,
		});
		// Includes pause edges, not merely 3 segment starts.
		expect(bounds.some((t) => Math.abs(t - 8.5) < 0.01)).toBe(true);
		expect(bounds.some((t) => Math.abs(t - 10.9) < 0.01)).toBe(true);
	});

	it("normalizes free-prose contentType/purpose from live models", () => {
		expect(normalizeSourceStoryContentType("Software Tutorial")).toBe("tutorial");
		expect(normalizeSourceStoryContentType("screen recording")).toBe("screen_recording");
		expect(normalizeSourceStoryPurpose("Introduction")).toBe("intro");
		expect(normalizeSourceStoryPurpose("dead air pause")).toBe("pause");
	});

	it("clears invented spokenMeaning when scaffold has no speech", () => {
		const scaffold = buildSourceStoryScaffold({
			sourceDurationSec: 5,
			speechEvidence: {
				...speechEv([]),
				sourceDurationSec: 5,
				status: "no_audio",
				audioStreamPresent: false,
			},
			frames: [0, 2].map(frame),
		});
		expect(scaffold.speechStatus).toBe("no_audio");
		const text = formatSourceStoryScaffoldText(scaffold);
		expect(text).toMatch(/NO AUDIO STREAM/i);
		expect(text).not.toMatch(/transcription was requested but is unavailable/i);
		const v = validateSourceStory(
			{
				sourceDurationSec: 5,
				overallSummary: "Static editor view.",
				contentType: "screen_recording",
				storyBeats: [
					{
						id: "b1",
						startSourceTimeSec: 0,
						endSourceTimeSec: 5,
						purpose: "setup",
						summary: "Editor on screen.",
						spokenMeaning: "The narrator explains the UI.",
						visualMeaning: "Code editor visible",
						evidence: { visualTimes: [0, 2] },
						confidence: "high",
					},
				],
			},
			scaffold,
		);
		expect(v.ok).toBe(true);
		expect(v.story?.storyBeats[0]?.spokenMeaning).toBeUndefined();
		expect(v.story?.storyBeats[0]?.confidence).toBe("medium");
	});

	it("inserts pause beats for uncovered scaffold speech gaps", () => {
		const scaffold = buildSourceStoryScaffold({
			sourceDurationSec: 16.896,
			speechEvidence: NARRATED_SPEECH,
			frames: [0, 2, 4, 6, 8, 10, 12, 14, 16].map(frame),
			changes: CHANGES,
		});
		expect(scaffold.windows.some((w) => w.speechGap)).toBe(true);
		const v = validateSourceStory(
			{
				sourceDurationSec: 16.896,
				overallSummary: "Walkthrough skipping the mid pause.",
				contentType: "demo",
				storyBeats: [
					{
						id: "b1",
						startSourceTimeSec: 0,
						endSourceTimeSec: 8.5,
						purpose: "explanation",
						summary: "Intro and timeline.",
						evidence: { speechSegmentIds: ["s1", "s2"], visualTimes: [0, 4] },
						confidence: "high",
					},
					{
						id: "b2",
						startSourceTimeSec: 10.9,
						endSourceTimeSec: 16.9,
						purpose: "navigation",
						summary: "Code section.",
						evidence: { speechSegmentIds: ["s3"], visualTimes: [12, 14] },
						confidence: "high",
					},
				],
			},
			scaffold,
		);
		expect(v.ok).toBe(true);
		const pauseBeats = (v.story?.storyBeats ?? []).filter((b) => b.purpose === "pause");
		expect(pauseBeats.length).toBeGreaterThan(0);
		const coversGap = pauseBeats.some(
			(b) => b.startSourceTimeSec <= 8.6 && b.endSourceTimeSec >= 8.7,
		);
		expect(coversGap).toBe(true);
		expect(pauseBeats.every((b) => !/dead\s*time|should be deleted/i.test(b.summary))).toBe(true);
	});

	it("hedges overallSummary that asserts spoken settings open", () => {
		const hedged = hedgeContradictionOverallSummary(
			"The recording demonstrates code navigation as the user opens settings and discusses code.",
			[
				{
					id: "b1",
					startSourceTimeSec: 0,
					endSourceTimeSec: 4,
					purpose: "navigation",
					summary: "User announces they are opening the settings.",
					spokenMeaning: "Opening settings.",
					visualMeaning: "Code editor is visible with no significant changes.",
					evidence: { speechSegmentIds: ["s1"], visualTimes: [0, 2] },
					confidence: "high",
				},
			],
		);
		expect(hedged).not.toMatch(/as the user opens settings/i);
		expect(hedged).toMatch(/mentions opening settings|speaker mentions/i);
	});
});
