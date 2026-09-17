/**
 * Clock coordinate proof: UI ruler RAW vs trim-compressed playback vs Zoom RAW.
 * Not recording-specific — synthetic trims exercise the general contract.
 */

import { describe, expect, it } from "vitest";
import {
	projectPlaybackSecToRawTimelineSec,
	projectRawTimelineSecToPlayback,
	resolvePlaybackSegments,
} from "../../../src/lib/ai-edition/document/timeline";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { executeAgentTool } from "../agent-tools";
import {
	playbackPointToRawTimelineSec,
	playbackRangeToZoomRawRange,
	programmeDurationSec,
	rawTimelineDurationSec,
} from "./directTrim";

function docWithTrims() {
	const base = createEmptyDocument({ projectId: "clock-proof", title: "clock" });
	// Same shape as the live failure: asset ≈23.72, two source trims → programme ≈17.33
	const assetDur = 23.719979;
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "a1", allowAgentEdits: true },
		assets: [
			{
				id: "a1",
				kind: "video",
				label: "rec",
				originalPath: "/tmp/clock-proof.mp4",
				durationSec: assetDur,
				createdAt: new Date().toISOString(),
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "c1",
					assetId: "a1",
					sourceStartSec: 0,
					sourceEndSec: assetDur,
					timelineStartSec: 0,
					timelineEndSec: assetDur,
					origin: "user",
					reason: "primary",
				},
			],
			trimRanges: [
				{
					id: "t1",
					clipId: "c1",
					assetId: "a1",
					startSec: 0.29725463206018515,
					endSec: 3.7004611226381656,
					origin: "agent",
					reason: "test trim A",
				},
				{
					id: "t2",
					clipId: "c1",
					assetId: "a1",
					startSec: 11.558354000000001,
					endSec: 14.544082999999999,
					origin: "agent",
					reason: "test trim B",
				},
			],
		},
		zoomRanges: [],
	});
}

describe("timeline clock coordinates (RAW vs compressed vs Zoom)", () => {
	it("explains 23.7 ruler vs 17.331 playback as two clocks, not one bug", () => {
		const doc = docWithTrims();
		const raw = rawTimelineDurationSec(doc);
		const playback = programmeDurationSec(doc);
		const removed = (doc.timeline.trimRanges ?? []).reduce(
			(s, t) => s + (t.endSec - t.startSec),
			0,
		);
		expect(raw).toBeCloseTo(23.719979, 5);
		expect(playback).toBeCloseTo(17.33104350942202, 5);
		expect(raw - removed).toBeCloseTo(playback, 5);
		// V4Timeline total uses max(clip.timelineEndSec) — RAW, trims still occupy space.
		expect(Math.max(...doc.timeline.clips.map((c) => c.timelineEndSec))).toBe(raw);
		// resolvePlaybackSegments concatenates kept content — COMPRESSED.
		const segs = resolvePlaybackSegments(doc.timeline.clips, doc.timeline.trimRanges ?? []);
		expect(Math.max(...segs.map((s) => s.timelineEndSec))).toBeCloseTo(playback, 5);
	});

	it("same numeric second is different media on RAW vs compressed when trims exist", () => {
		const doc = docWithTrims();
		const clips = doc.timeline.clips;
		const trims = doc.timeline.trimRanges ?? [];
		// Compressed 15.5 (speech-aligned on the live project) ≠ RAW 15.5 (Connect neighbourhood).
		const rawAtCompressed15_5 = projectPlaybackSecToRawTimelineSec(clips, trims, 15.5);
		expect(rawAtCompressed15_5).not.toBeNull();
		expect(rawAtCompressed15_5!).toBeCloseTo(21.88893549057798, 4);
		expect(rawAtCompressed15_5!).not.toBeCloseTo(15.5, 0);
		// Round-trip RAW→compressed→RAW for a kept point.
		const rawConnect = 14.6;
		const compressed = projectRawTimelineSecToPlayback(clips, trims, rawConnect);
		const back = projectPlaybackSecToRawTimelineSec(clips, trims, compressed);
		expect(back).toBeCloseTo(rawConnect, 4);
	});

	it("Zoom addZoom interprets startSec as RAW — pending must convert from compressed", () => {
		const doc = docWithTrims();
		const compressedStart = 15.5;
		// Overhangs programme end (17.331) — converter clamps; must not return null or pass 15.5 through.
		const compressedEnd = 18.5;
		const rawRange = playbackRangeToZoomRawRange(doc, compressedStart, compressedEnd);
		expect(rawRange).not.toBeNull();
		expect(rawRange!.startSec).toBeCloseTo(21.88893549057798, 4);
		expect(rawRange!.endSec).toBeCloseTo(23.719979, 4);
		// Passing compressed seconds into addZoom would land on the wrong RAW ruler point.
		const wrong = executeAgentTool(
			doc,
			"addZoom",
			JSON.stringify({
				startSec: compressedStart,
				endSec: compressedStart + 3,
				depth: 3,
				focus: { cx: 0.5, cy: 0.5 },
			}),
			{ editsAllowed: true },
		);
		const right = executeAgentTool(
			doc,
			"addZoom",
			JSON.stringify({
				startSec: rawRange!.startSec,
				endSec: rawRange!.endSec,
				depth: 3,
				focus: { cx: 0.5, cy: 0.5 },
			}),
			{ editsAllowed: true },
		);
		expect(wrong.ok).toBe(true);
		expect(right.ok).toBe(true);
		const zWrong = wrong.document!.zoomRanges[wrong.document!.zoomRanges.length - 1]!;
		const zRight = right.document!.zoomRanges[right.document!.zoomRanges.length - 1]!;
		expect(zWrong.startMs / 1000).toBeCloseTo(15.5, 2);
		expect(zRight.startMs / 1000).toBeCloseTo(rawRange!.startSec, 2);
		expect(Math.abs(zWrong.startMs - zRight.startMs)).toBeGreaterThan(5000);
		expect(playbackPointToRawTimelineSec(doc, compressedStart)).toBeCloseTo(rawRange!.startSec, 4);
	});
});
