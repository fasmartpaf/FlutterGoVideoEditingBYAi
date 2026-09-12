import { describe, expect, it } from "vitest";
import { scoreEvent, scoreHallucinations, summarizeRecall } from "./score";
import type { BenchmarkObservation, PerceptionGroundTruth } from "./types";

describe("perceptionBenchmark/score", () => {
	it("marks DETECTED_CORRECTLY when hints overlap temporally", () => {
		const event = {
			id: "e1",
			startSec: 2,
			endSec: 3,
			modality: "visual" as const,
			expectedMeaning: "dropdown",
			importance: "critical" as const,
			matchHints: ["dropdown"],
		};
		const obs: BenchmarkObservation[] = [
			{
				startSec: 2.1,
				endSec: 2.8,
				modality: "visual",
				description: "A dropdown menu appears briefly",
				source: "semantic",
			},
		];
		const s = scoreEvent(event, obs);
		expect(s.verdict).toBe("DETECTED_CORRECTLY");
		expect(s.absTimingErrorSec).toBeLessThan(1);
	});

	it("marks MISSED when no observation", () => {
		const event = {
			id: "e1",
			startSec: 2.45,
			endSec: 2.82,
			modality: "visual" as const,
			expectedMeaning: "dropdown",
			importance: "critical" as const,
			matchHints: ["dropdown"],
		};
		expect(scoreEvent(event, []).verdict).toBe("MISSED");
	});

	it("detects forbidden hallucination patterns", () => {
		const hits = scoreHallucinations(
			[
				{
					id: "m1",
					kind: "EMOTION_HALLUCINATION",
					description: "no anger",
					forbiddenPatterns: ["\\bangry\\b"],
				},
			],
			["The user looks angry at the UI"],
		);
		expect(hits).toHaveLength(1);
		expect(hits[0]!.kind).toBe("EMOTION_HALLUCINATION");
	});

	it("computes important-event recall with partial credit", () => {
		const gt: PerceptionGroundTruth = {
			caseId: "t",
			title: "t",
			mediaPath: null,
			status: "READY",
			events: [
				{
					id: "a",
					startSec: 0,
					endSec: 1,
					modality: "speech",
					expectedMeaning: "x",
					importance: "critical",
				},
				{
					id: "b",
					startSec: 0,
					endSec: 1,
					modality: "speech",
					expectedMeaning: "y",
					importance: "important",
				},
				{
					id: "c",
					startSec: 0,
					endSec: 1,
					modality: "speech",
					expectedMeaning: "z",
					importance: "supporting",
				},
			],
			mustNotClaim: [],
		};
		const scores = [
			{
				eventId: "a",
				verdict: "DETECTED_CORRECTLY" as const,
				gtStartSec: 0,
				gtEndSec: 1,
				notes: "",
			},
			{
				eventId: "b",
				verdict: "PARTIALLY_DETECTED" as const,
				gtStartSec: 0,
				gtEndSec: 1,
				notes: "",
			},
			{
				eventId: "c",
				verdict: "MISSED" as const,
				gtStartSec: 0,
				gtEndSec: 1,
				notes: "",
			},
		];
		const r = summarizeRecall(scores, gt);
		expect(r.criticalImportantTotal).toBe(2);
		expect(r.recall).toBeCloseTo(0.75);
	});
});
