import { describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import {
	assertSourceTimestampsWithinDuration,
	isAssetDurationStale,
	repairDocumentSourceDuration,
	SOURCE_TIMESTAMP_TOLERANCE_SEC,
	STREAM_DURATION_TOLERANCE_SEC,
	selectCanonicalDurationSec,
} from "./index";

describe("sourceTiming canonical duration", () => {
	it("1 — selects container duration as SOURCE_MEDIA_TIME", () => {
		expect(
			selectCanonicalDurationSec({
				containerDurationSec: 16.896,
				videoStreamDurationSec: 16.891667,
				audioStreamDurationSec: 16.896,
				streamDiscrepancySec: null,
			}),
		).toBe(16.896);
	});

	it("2 — detects stale/mismatched asset metadata", () => {
		expect(isAssetDurationStale(22, 16.896)).toBe(true);
		expect(isAssetDurationStale(16.9, 16.896)).toBe(false);
	});

	it("3 — speech timestamps validated against canonical source duration", () => {
		const ok = assertSourceTimestampsWithinDuration([{ start: 10.9, end: 17.0 }], 16.896);
		expect(ok).toEqual([]);
		const bad = assertSourceTimestampsWithinDuration([{ start: 0, end: 22 }], 16.896);
		expect(bad.length).toBeGreaterThan(0);
	});

	it("4 — visual timestamps use same tolerance basis", () => {
		const errs = assertSourceTimestampsWithinDuration(
			[{ start: 0, end: 16.896 + SOURCE_TIMESTAMP_TOLERANCE_SEC }],
			16.896,
		);
		expect(errs).toEqual([]);
	});

	it("5 — small stream duration tolerance is documented and applied", () => {
		expect(STREAM_DURATION_TOLERANCE_SEC).toBeGreaterThan(0.1);
		expect(Math.abs(16.891667 - 16.896)).toBeLessThanOrEqual(STREAM_DURATION_TOLERANCE_SEC);
	});

	it("repairs stale asset duration without rewriting unrelated clips", () => {
		const CREATED = "2026-01-01T00:00:00.000Z";
		const base = createEmptyDocument({ title: "T", projectId: "p", createdAt: CREATED });
		const doc = documentSchema.parse({
			...base,
			project: { ...base.project, primaryAssetId: "asset_1" },
			assets: [
				{
					id: "asset_1",
					label: "rec",
					kind: "video",
					originalPath: "/tmp/x.mp4",
					durationSec: 22,
					width: 1920,
					height: 1080,
				},
			],
			timeline: {
				...base.timeline,
				clips: [
					{
						id: "full",
						assetId: "asset_1",
						sourceStartSec: 0,
						sourceEndSec: 22,
						timelineStartSec: 0,
						timelineEndSec: 22,
						wordRefs: [],
						origin: "user",
						reason: "",
					},
					{
						id: "trimmed",
						assetId: "asset_1",
						sourceStartSec: 2,
						sourceEndSec: 5,
						timelineStartSec: 22,
						timelineEndSec: 25,
						wordRefs: [],
						origin: "user",
						reason: "",
					},
				],
				trimRanges: [],
			},
		});
		const repaired = repairDocumentSourceDuration(doc, "asset_1", 16.896);
		expect(repaired.assets[0]?.durationSec).toBe(16.896);
		expect(repaired.timeline.clips.find((c) => c.id === "full")?.sourceEndSec).toBe(16.896);
		expect(repaired.timeline.clips.find((c) => c.id === "trimmed")?.sourceEndSec).toBe(5);
	});
});
