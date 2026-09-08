import { describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../schema";
import { attachMediaContext, buildMediaContext, readStoredMediaContext } from "./mediaContext";

function docWithSpeech() {
	const base = createEmptyDocument({ title: "Demo", projectId: "proj_1" });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "Studio take",
				originalPath: "/tmp/rec.mp4",
				durationSec: 20,
			},
		],
		transcripts: [
			{
				assetId: "asset_1",
				language: "en",
				segments: [
					{ id: "s1", kind: "speech", startSec: 0, endSec: 4, text: "Welcome", wordIds: [] },
					{ id: "s2", kind: "silence", startSec: 4, endSec: 8, text: "", wordIds: [] },
				],
				words: [],
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId: "asset_1",
					sourceStartSec: 0,
					sourceEndSec: 20,
					timelineStartSec: 0,
					timelineEndSec: 20,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
		},
	});
}

describe("mediaContext", () => {
	it("remembers kept film and spoken parts for each recording", () => {
		const context = buildMediaContext(docWithSpeech(), new Date("2026-09-08T00:00:00.000Z"));
		expect(context.assets).toHaveLength(1);
		expect(context.assets[0].label).toBe("Studio take");
		expect(context.assets[0].parts.some((part) => part.kind === "kept" && part.endSec === 20)).toBe(
			true,
		);
		expect(context.assets[0].parts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "speech", text: "Welcome", startSec: 0, endSec: 4 }),
				expect.objectContaining({ kind: "silence", startSec: 4, endSec: 8 }),
			]),
		);
	});

	it("keeps visual notes when the file has not changed", () => {
		const withNotes = attachMediaContext(docWithSpeech());
		const legacy = withNotes.legacyEditor as Record<string, unknown>;
		legacy.mediaContext = {
			...buildMediaContext(withNotes),
			notes: [{ assetId: "asset_1", startSec: 2, endSec: 3, text: "Phone preview" }],
		};
		const again = buildMediaContext({
			...withNotes,
			legacyEditor: legacy,
		});
		expect(again.notes).toEqual([
			{ assetId: "asset_1", startSec: 2, endSec: 3, text: "Phone preview" },
		]);
	});

	it("drops notes when the recording fingerprint changes", () => {
		const base = attachMediaContext(docWithSpeech());
		const legacy = {
			mediaContext: {
				...buildMediaContext(base),
				notes: [{ assetId: "asset_1", startSec: 0, endSec: 1, text: "old" }],
			},
		};
		const replaced = documentSchema.parse({
			...base,
			assets: base.assets.map((asset) => ({ ...asset, durationSec: 99 })),
			legacyEditor: legacy,
		});
		expect(buildMediaContext(replaced).notes).toEqual([]);
	});

	it("attaches the outline onto the document once", () => {
		const first = attachMediaContext(docWithSpeech());
		expect(readStoredMediaContext(first)?.assets[0]?.assetId).toBe("asset_1");
		expect(attachMediaContext(first)).toBe(first);
	});
});
