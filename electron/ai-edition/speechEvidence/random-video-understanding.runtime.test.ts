/**
 * Regression: arbitrary messy recordings with collapsed Metal DTW word times
 * must still expose the FULL spoken text to speech evidence / the agent path.
 * Uses the on-disk project for recording-1789233035387 (no live LLM).
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AxcutTranscript } from "../../../src/lib/ai-edition/schema";
import {
	isDegenerateSpeechSegmentTimeline,
	repairDegenerateSpeechEvidence,
	speechEvidenceFromAxcutTranscript,
} from "./map";

const PROJECT =
	"/Users/osama/Library/Application Support/openscreen/projects/proj_448b8066-f4c4-42ab-9164-304fb37cab12.openscreen";

const canRun = existsSync(PROJECT);

describe.runIf(canRun)("random recording speech collapse repair", () => {
	it("repairs the persisted collapsed transcript into full narration text", () => {
		const proj = JSON.parse(readFileSync(PROJECT, "utf8")) as {
			assets: Array<{ durationSec?: number }>;
			transcript: AxcutTranscript;
		};
		const durationSec = proj.assets[0]?.durationSec ?? 24.35;
		const original = proj.transcript;

		// Force the failure shape that was observed live (all words @ ~23.92),
		// regardless of any later local edits to the project file.
		const collapsed: AxcutTranscript = {
			assetId: original.assetId,
			language: original.language,
			words: original.words.map((w) => ({
				...w,
				startSec: 23.92,
				endSec: 23.94,
			})),
			segments: original.words.map((w, i) => ({
				id: `seg_${i + 1}`,
				kind: "speech" as const,
				startSec: 23.92,
				endSec: 23.94,
				text: w.text,
				wordIds: [w.id],
			})),
		};

		const raw = speechEvidenceFromAxcutTranscript({
			assetId: collapsed.assetId,
			transcript: {
				...collapsed,
				// bypass auto-repair for the degeneracy detector check
			},
			sourceDurationSec: durationSec,
			status: "available",
			audioStreamPresent: true,
			timings: {
				audioProbeMs: 0,
				audioExtractMs: 0,
				sttMs: 0,
				transcriptParseMs: 0,
				transcriptCacheMs: 0,
				segmentCount: collapsed.segments.length,
				cacheHit: true,
			},
		});

		// speechEvidenceFromAxcutTranscript already repairs — assert outcome.
		expect(raw.segments).toHaveLength(1);
		expect(raw.segments[0]?.startSourceTimeSec).toBe(0);
		expect(raw.segments[0]?.endSourceTimeSec).toBe(durationSec);
		const text = raw.segments[0]?.text.toLowerCase() ?? "";
		expect(text).toMatch(/cursor|tool|chat/);
		expect(text.split(/\s+/).length).toBeGreaterThan(20);

		const unrepaired = {
			...raw,
			segments: collapsed.segments.map((s) => ({
				startSourceTimeSec: s.startSec,
				endSourceTimeSec: s.endSec,
				text: s.text,
			})),
		};
		expect(isDegenerateSpeechSegmentTimeline(unrepaired.segments)).toBe(true);
		const repaired = repairDegenerateSpeechEvidence(unrepaired);
		expect(repaired.segments).toHaveLength(1);
		expect(repaired.segments[0]?.text.toLowerCase()).toMatch(/cursor|tool/);
	});
});
