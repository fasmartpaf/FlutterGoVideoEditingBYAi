import { describe, expect, it } from "vitest";
import type { VisualEvidenceFrame } from "../visualEvidence/types";
import { selectFramesWithCoverage } from "./coverage";
import { allocateCoverageDeepeningBudgets, buildEvidenceEventRegions } from "./eventRegions";
import { primaryFrameReason, selectFramesForRetrieval } from "./framePolicy";

function frame(t: number, reason: VisualEvidenceFrame["reason"] = "periodic"): VisualEvidenceFrame {
	return {
		assetId: "a",
		sourceTimeSec: t,
		virtualTimeSec: t,
		reason,
		imagePath: `/tmp/${t}.jpg`,
		mimeType: "image/jpeg",
		width: 1280,
		height: 720,
		byteLength: 100,
	};
}

describe("Evidence Retrieval Deepening V1", () => {
	it("allocates deepening budget so coverage cannot take 100% of 6 slots", () => {
		const b = allocateCoverageDeepeningBudgets({
			maxFrames: 6,
			durationSec: 21,
			bucketCount: 5,
			eventRegionCount: 2,
			queryClass: "editorial",
		});
		expect(b.deepeningBudget).toBeGreaterThanOrEqual(1);
		expect(b.coverageBudget).toBeLessThan(6);
		expect(b.coverageBudget + b.deepeningBudget).toBe(6);
	});

	it("clusters 12–15s change candidates into one event region", () => {
		const clustered = [12.331, 13.131, 13.538, 14.288, 14.788].map((t) =>
			frame(t, "change_refinement"),
		);
		const regions = buildEvidenceEventRegions({
			frames: clustered,
			durationSec: 21.44,
			queryClass: "editorial",
		});
		expect(regions.length).toBe(1);
		expect(regions[0]!.memberTimes.length).toBeGreaterThanOrEqual(3);
	});

	it("whole-media with strong events is not periodic-only", () => {
		const anchors = [0.4, 4.2, 8.5, 10.9, 16.8, 21.1].map((t) => frame(t, "periodic"));
		const events = [12.4, 13.2, 14.0].map((t) => frame(t, "change_refinement"));
		const { frames, diagnostics, coverage, eventRegions } = selectFramesWithCoverage({
			frames: [...anchors, ...events],
			queryClass: "editorial",
			scope: "whole_media",
			maxFrames: 6,
			preferChangeBoundaries: true,
			preferLateWindow: false,
			lateWindowStartFrac: 0.4,
			durationSec: 21.44,
			primaryReason: primaryFrameReason,
		});
		expect(coverage.coverageSufficient).toBe(true);
		expect(coverage.clustered).toBe(false);
		expect(eventRegions.length).toBeGreaterThanOrEqual(1);
		expect(frames.some((f) => f.reason === "change_refinement")).toBe(true);
		expect(diagnostics.relevanceCandidatesSelected).toBeGreaterThanOrEqual(1);
		expect(diagnostics.deepeningUtilization).toBeGreaterThan(0);
		const inCluster = frames.filter((f) => f.sourceTimeSec >= 12 && f.sourceTimeSec <= 15);
		expect(inCluster.length).toBeLessThanOrEqual(2);
	});

	it("event region cannot monopolize the attach budget", () => {
		const cluster = Array.from({ length: 8 }, (_, i) =>
			frame(12.2 + i * 0.35, "change_refinement"),
		);
		const anchors = [0.5, 5, 10, 16, 21].map((t) => frame(t, "periodic"));
		const { frames, coverage } = selectFramesForRetrieval({
			frames: [...cluster, ...anchors],
			queryClass: "editorial",
			queryScope: "whole_media",
			userMessage: "Where would zoom help in this recording?",
			durationSec: 21.5,
		});
		expect(coverage.coverageSufficient).toBe(true);
		expect(
			frames.filter((f) => f.sourceTimeSec >= 12 && f.sourceTimeSec <= 15).length,
		).toBeLessThanOrEqual(2);
		expect(frames.some((f) => f.sourceTimeSec < 6)).toBe(true);
		expect(frames.some((f) => f.sourceTimeSec > 16)).toBe(true);
	});

	it("can replace a coverage anchor with a nearby event frame", () => {
		const pool = [
			frame(0, "periodic"),
			frame(5, "periodic"),
			frame(10, "periodic"),
			frame(12.5, "change_refinement"),
			frame(16, "periodic"),
			frame(20, "periodic"),
		];
		const { frames, meta, diagnostics } = selectFramesWithCoverage({
			frames: pool,
			queryClass: "editorial",
			scope: "whole_media",
			maxFrames: 6,
			preferChangeBoundaries: true,
			preferLateWindow: false,
			lateWindowStartFrac: 0.4,
			durationSec: 21,
			changes: [
				{
					fromSourceTimeSec: 10,
					toSourceTimeSec: 16,
					score: 0.2,
					classification: "significant",
				},
			],
			primaryReason: primaryFrameReason,
		});
		expect(frames.some((f) => Math.abs(f.sourceTimeSec - 12.5) < 0.2)).toBe(true);
		expect(coverageSufficientish(frames, 21)).toBe(true);
		expect(diagnostics.relevanceCandidatesSelected).toBeGreaterThanOrEqual(1);
		expect(meta.some((m) => /deepen|transition|event/i.test(m.note + m.reason))).toBe(true);
	});
});

function coverageSufficientish(frames: VisualEvidenceFrame[], duration: number): boolean {
	const times = frames.map((f) => f.sourceTimeSec).sort((a, b) => a - b);
	return times[0]! < duration * 0.25 && times[times.length - 1]! > duration * 0.7;
}
