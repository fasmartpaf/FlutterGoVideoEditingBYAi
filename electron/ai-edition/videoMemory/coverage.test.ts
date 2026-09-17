import { describe, expect, it } from "vitest";
import type { VisualEvidenceFrame } from "../visualEvidence/types";
import { measureVisualEvidenceCoverage, selectFramesWithCoverage } from "./coverage";
import { frameBudgetForQuery, primaryFrameReason, selectFramesForRetrieval } from "./framePolicy";

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

describe("Evidence Retrieval Coverage V1", () => {
	it("does not treat min–max span as coverageFraction", () => {
		const c = measureVisualEvidenceCoverage({
			selectedTimes: [0.2, 21.2],
			durationSec: 21.44,
			scope: "whole_media",
			queryClass: "editorial",
		});
		expect(c.coverageFraction).toBeLessThan(0.5);
		expect(c.coverageSufficient).toBe(false);
	});

	it("clustered 2.46s pack is insufficient for whole-media editorial", () => {
		const times = [12.331, 13.131, 13.538, 14.288, 14.788];
		const c = measureVisualEvidenceCoverage({
			selectedTimes: times,
			durationSec: 21.438,
			scope: "whole_media",
			queryClass: "editorial",
		});
		expect(c.clustered).toBe(true);
		expect(c.coverageSufficient).toBe(false);
		expect(c.evidenceSufficiency).toBe("insufficient");
	});

	it("relevance cluster cannot starve global coverage", () => {
		const clustered = [12.331, 13.131, 13.538, 14.288, 14.788, 13.8, 14.0, 12.9].map((t) =>
			frame(t, "change_refinement"),
		);
		const anchors = [0.4, 4.2, 8.5, 10.9, 16.8, 21.1].map((t) => frame(t, "periodic"));
		const { frames, coverage } = selectFramesWithCoverage({
			frames: [...clustered, ...anchors],
			queryClass: "editorial",
			scope: "whole_media",
			maxFrames: 6,
			preferChangeBoundaries: true,
			preferLateWindow: false,
			lateWindowStartFrac: 0.4,
			durationSec: 21.44,
			primaryReason: primaryFrameReason,
		});
		expect(frames.length).toBeLessThanOrEqual(6);
		expect(coverage.clustered).toBe(false);
		expect(coverage.coveredBuckets.length).toBeGreaterThanOrEqual(3);
		expect(coverage.coverageSufficient).toBe(true);
		const span = frames[frames.length - 1]!.sourceTimeSec - frames[0]!.sourceTimeSec;
		expect(span).toBeGreaterThan(8);
	});

	it("local query stays inside the local window", () => {
		const pool = [1, 5, 10, 12, 18, 21].map((t) => frame(t));
		const { frames, coverage } = selectFramesForRetrieval({
			frames: pool,
			queryClass: "visual",
			queryScope: "local",
			userMessage: "What happens at 12 seconds?",
			durationSec: 21,
		});
		expect(frames.length).toBeGreaterThan(0);
		expect(frames.length).toBeLessThanOrEqual(3);
		expect(frames.every((f) => Math.abs(f.sourceTimeSec - 12) < 4)).toBe(true);
		expect(coverage.scope).toBe("local");
	});

	it("speech budget remains image-free", () => {
		expect(frameBudgetForQuery("speech", "bounded_range").maxFrames).toBe(0);
		const { frames } = selectFramesForRetrieval({
			frames: [0, 5, 10, 20].map((t) => frame(t)),
			queryClass: "speech",
			queryScope: "bounded_range",
			userMessage: "What did I say near the end?",
			durationSec: 21,
		});
		expect(frames).toHaveLength(0);
	});

	it("cross-modal speech alignment prefers times near speech windows", () => {
		const pool = [1, 5, 9, 14, 20].map((t, i) =>
			frame(t, i === 2 ? "change_refinement" : "periodic"),
		);
		const { meta, frames } = selectFramesForRetrieval({
			frames: pool,
			queryClass: "cross_modal",
			queryScope: "whole_media",
			userMessage:
				"Compare what I say with what is visibly happening. Tell me what matches, what differs, and what cannot be verified.",
			durationSec: 21,
			memory: {
				speechWindows: [
					{ startSec: 1, endSec: 3, preview: "a" },
					{ startSec: 8, endSec: 11, preview: "b" },
					{ startSec: 18, endSec: 20, preview: "c" },
				],
				sourceDurationSec: 21,
			} as never,
		});
		expect(frames.length).toBeGreaterThan(0);
		expect(
			meta.some((m) => m.reason === "cross_modal_compare" || m.reason === "coverage_anchor"),
		).toBe(true);
	});

	it("whole-media editorial is distributed, not a 2s cluster", () => {
		const change = Array.from({ length: 8 }, (_, i) => frame(12.3 + i * 0.3, "change_refinement"));
		const periodic = [0.2, 4, 8.5, 12.4, 17, 21.2].map((t) => frame(t, "periodic"));
		const { coverage } = selectFramesForRetrieval({
			frames: [...change, ...periodic],
			queryClass: "editorial",
			queryScope: "whole_media",
			userMessage:
				"Where would a zoom actually help in this recording, and where would it not help?",
			durationSec: 21.44,
		});
		expect(coverage.clustered).toBe(false);
		expect(coverage.coverageSufficient).toBe(true);
		expect(coverage.selectedTimes.some((t) => t < 6)).toBe(true);
		expect(coverage.selectedTimes.some((t) => t > 16)).toBe(true);
	});
});
