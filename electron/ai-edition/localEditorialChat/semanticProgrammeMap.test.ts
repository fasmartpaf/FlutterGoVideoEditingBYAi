/**
 * Source ↔ programme mapping for semantic WHERE — nontrivial timeline.
 */

import { describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import {
	mapProgrammeInstantToSourceSafe,
	mapSourceInstantToProgrammeSafe,
	mapVisualIntervalToProgramme,
	speedOverlapsProgramme,
} from "./semanticProgrammeMap";

function multiClipTrimmedDoc(): AxcutDocument {
	const base = createEmptyDocument({ projectId: "map-nontrivial", title: "map" });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "a1", allowAgentEdits: true },
		assets: [
			{
				id: "a1",
				kind: "video",
				label: "a",
				originalPath: "/tmp/a.mp4",
				durationSec: 60,
				createdAt: new Date().toISOString(),
			},
			{
				id: "a2",
				kind: "video",
				label: "b",
				originalPath: "/tmp/b.mp4",
				durationSec: 40,
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
					sourceEndSec: 30,
					timelineStartSec: 0,
					timelineEndSec: 30,
					origin: "system",
					reason: "primary",
				},
				{
					id: "c2",
					assetId: "a2",
					sourceStartSec: 5,
					sourceEndSec: 25,
					timelineStartSec: 30,
					timelineEndSec: 50,
					origin: "system",
					reason: "broll",
				},
			],
			// Trim 10–15s out of first clip source → programme compresses by 5s
			trimRanges: [
				{
					id: "t1",
					assetId: "a1",
					clipId: "c1",
					startSec: 10,
					endSec: 15,
					origin: "user",
					reason: "cut",
				},
			],
		},
	});
}

describe("semanticProgrammeMap nontrivial timeline", () => {
	it("maps source past a mid-clip trim onto earlier programme time", () => {
		const doc = multiClipTrimmedDoc();
		// Source 16s on a1 is after trimmed 10–15 → programme ≈ 16-5 = 11
		const inst = mapSourceInstantToProgrammeSafe({
			document: doc,
			assetId: "a1",
			sourceTimeSec: 16,
		});
		expect(inst.status).toBe("ok");
		expect(inst.programmeTimeSec).toBeGreaterThan(10.5);
		expect(inst.programmeTimeSec).toBeLessThan(12.5);

		const back = mapProgrammeInstantToSourceSafe({
			document: doc,
			programmeTimeSec: inst.programmeTimeSec!,
		});
		expect(back.status).toBe("ok");
		expect(back.sourceTimeSec!).toBeCloseTo(16, 1);
	});

	it("maps second-clip source onto programme after first-clip compression", () => {
		const doc = multiClipTrimmedDoc();
		// a2 source 10 → programme starts at 25 (30-5 trim) + (10-5) = 30
		const inst = mapSourceInstantToProgrammeSafe({
			document: doc,
			assetId: "a2",
			sourceTimeSec: 10,
		});
		expect(inst.status).toBe("ok");
		expect(inst.programmeTimeSec).toBeGreaterThan(28);
		expect(inst.programmeTimeSec).toBeLessThan(32);
	});

	it("maps visual interval through trim and blocks under speed", () => {
		const doc = multiClipTrimmedDoc();
		const mapped = mapVisualIntervalToProgramme({
			document: doc,
			assetId: "a1",
			sourceInterval: { startSec: 16, endSec: 17, level: "SIGNIFICANT" },
		});
		expect(mapped.status).toBe("ok");
		expect(mapped.programme.startSec).toBeLessThan(mapped.source.startSec);

		const withSpeed = documentSchema.parse({
			...doc,
			timeline: {
				...doc.timeline,
				speedRanges: [
					{
						startSec: mapped.programme.startSec - 0.1,
						endSec: mapped.programme.endSec + 0.5,
						reason: "test-speed",
					},
				],
			},
		});
		expect(
			speedOverlapsProgramme(withSpeed, mapped.programme.startSec, mapped.programme.endSec),
		).toBe(true);
		const blocked = mapVisualIntervalToProgramme({
			document: withSpeed,
			assetId: "a1",
			sourceInterval: { startSec: 16, endSec: 17, level: "SIGNIFICANT" },
		});
		expect(blocked.status).toBe("speed_blocked");
	});
});
