/**
 * Video Memory V1 foundation tests — indexing, retrieval, invalidation.
 * Identity: CURRENT_OPENSCREEN_VIDEO_MEMORY_V1
 * Does not mutate documents or switch production cognition.
 */

import { describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { buildTemporalEventLedger } from "../temporalEventLedger";
import { createVideoMemoryCache, isCrossDocumentLeak } from "./cache";
import {
	buildVideoMemoryV1,
	classifyVideoMemoryQuery,
	fingerprintProgramme,
	fingerprintSourceAsset,
	retrieveFromVideoMemory,
	VIDEO_MEMORY_V1_PROVIDER_ID,
	validateVideoMemory,
} from "./index";

function docWithAsset(mediaPath = "/tmp/a.mp4", projectId = "proj_vm") {
	const base = createEmptyDocument({ title: "VM", projectId });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				label: "vm",
				kind: "video",
				originalPath: mediaPath,
				durationSec: 20,
				width: 1920,
				height: 1080,
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

function richLedger() {
	return buildTemporalEventLedger({
		assetId: "asset_1",
		sourceDurationSec: 20,
		speech: {
			status: "available",
			segments: [
				{
					id: "s1",
					startSourceTimeSec: 1,
					endSourceTimeSec: 3,
					text: "Hello near the start",
				},
				{
					id: "s2",
					startSourceTimeSec: 10,
					endSourceTimeSec: 12,
					text: "I meant Effects not Timeline",
				},
				{
					id: "s3",
					startSourceTimeSec: 16,
					endSourceTimeSec: 18,
					text: "Near the end I said Settings",
				},
			],
		},
		semantic: {
			observations: [
				{
					sourceTimeSec: 5,
					frameSummary: "Cursor frontmost; Upwork tab behind",
					frontmostSurface: { name: "Cursor", kind: "app" },
					backgroundSurfaces: [{ name: "Upwork", role: "tab" }],
				},
				{
					sourceTimeSec: 18,
					frameSummary: "Restart recording control visible in HUD",
				},
			],
		},
		frames: [
			{ sourceTimeSec: 0, reason: "periodic" },
			{ sourceTimeSec: 8, reason: "periodic" },
			{ sourceTimeSec: 16, reason: "periodic" },
		],
		changes: [
			{
				fromSourceTimeSec: 0,
				toSourceTimeSec: 8,
				classification: "significant",
				score: 0.4,
			},
		],
	});
}

describe("videoMemory V1", () => {
	it("builds an evidence index that references ledger, not a second essay", () => {
		const document = docWithAsset();
		const ledger = richLedger();
		const memory = buildVideoMemoryV1({
			document,
			assetId: "asset_1",
			ledger,
			analysisCoverage: { speech: true, visual: true, cursor: false, investigator: true },
		});
		expect(memory.providerId).toBe(VIDEO_MEMORY_V1_PROVIDER_ID);
		expect(memory.speechWindows.length).toBeGreaterThan(0);
		expect(memory.passiveChromeHints.some((h) => /upwork/i.test(h))).toBe(true);
	});

	it("1 — same asset → reusable source evidence fingerprint", () => {
		const a = docWithAsset("/tmp/a.mp4");
		expect(fingerprintSourceAsset(a, "asset_1")).toBe(fingerprintSourceAsset(a, "asset_1"));
	});

	it("2 — changed asset → invalidation", () => {
		const a = docWithAsset("/tmp/a.mp4");
		const b = docWithAsset("/tmp/b.mp4");
		expect(fingerprintSourceAsset(a, "asset_1")).not.toBe(fingerprintSourceAsset(b, "asset_1"));
		const memory = buildVideoMemoryV1({ document: a, assetId: "asset_1", ledger: richLedger() });
		const v = validateVideoMemory(memory, b);
		expect(v.sourceReusable).toBe(false);
	});

	it("3 — timeline trim → source retained, programme invalidated", () => {
		const a = docWithAsset();
		const memory = buildVideoMemoryV1({ document: a, assetId: "asset_1", ledger: richLedger() });
		const trimmed = documentSchema.parse({
			...a,
			timeline: {
				...a.timeline,
				clips: [
					{
						...a.timeline.clips[0],
						sourceStartSec: 2,
						sourceEndSec: 18,
						timelineEndSec: 16,
					},
				],
			},
		});
		expect(fingerprintSourceAsset(trimmed, "asset_1")).toBe(memory.sourceFingerprint);
		expect(fingerprintProgramme(trimmed)).not.toBe(fingerprintProgramme(a));
		const validity = validateVideoMemory(memory, trimmed);
		expect(validity.sourceReusable).toBe(true);
		expect(validity.programmeCurrent).toBe(false);
	});

	it("3b — duration-only metadata without clip rewrite is not a duration probe", () => {
		const a = docWithAsset();
		const probedMetaOnly = documentSchema.parse({
			...a,
			assets: a.assets.map((asset) => ({ ...asset, durationSec: asset.durationSec + 3.14 })),
		});
		// Clip still 0–20 against duration 23.14 → no longer a full-source placement.
		expect(fingerprintProgramme(probedMetaOnly)).not.toBe(fingerprintProgramme(a));
	});

	it("3c — duration probe rewriting full-source clip ends does not invalidate programme", () => {
		const a = docWithAsset();
		const repaired = documentSchema.parse({
			...a,
			assets: a.assets.map((asset) => ({ ...asset, durationSec: 16.896 })),
			timeline: {
				...a.timeline,
				clips: [
					{
						...a.timeline.clips[0]!,
						sourceEndSec: 16.896,
						timelineEndSec: 16.896,
					},
				],
			},
		});
		expect(fingerprintSourceAsset(repaired, "asset_1")).toBe(fingerprintSourceAsset(a, "asset_1"));
		expect(fingerprintProgramme(repaired)).toBe(fingerprintProgramme(a));
		const memory = buildVideoMemoryV1({ document: a, assetId: "asset_1", ledger: richLedger() });
		expect(validateVideoMemory(memory, repaired).programmeCurrent).toBe(true);
	});

	it("4 — speech-only query avoids visual frames by default", () => {
		const memory = buildVideoMemoryV1({
			document: docWithAsset(),
			assetId: "asset_1",
			ledger: richLedger(),
		});
		const r = retrieveFromVideoMemory(memory, "What did I say near the end?");
		expect(r.queryClass).toBe("speech");
		expect(r.attachVisualFrames).toBe(false);
		expect(r.preferLateSpeech).toBe(true);
	});

	it("5 — visual query retrieves relevant ranges", () => {
		const memory = buildVideoMemoryV1({
			document: docWithAsset(),
			assetId: "asset_1",
			ledger: richLedger(),
		});
		const r = retrieveFromVideoMemory(memory, "What is visibly happening in this recording?");
		expect(r.queryClass).toBe("visual");
		expect(r.attachVisualFrames).toBe(true);
	});

	it("6 — action verification retrieves contradictions / deepening", () => {
		const memory = buildVideoMemoryV1({
			document: docWithAsset(),
			assetId: "asset_1",
			ledger: richLedger(),
		});
		const r = retrieveFromVideoMemory(memory, "Did I open Settings?");
		expect(r.queryClass).toBe("action_verify");
		expect(r.needsInvestigatorDeepening).toBe(true);
		expect(r.includeContradictions).toBe(true);
	});

	it("7/8/9 — temporary UI, correction, contradiction retrieval surfaces", () => {
		const memory = buildVideoMemoryV1({
			document: docWithAsset(),
			assetId: "asset_1",
			ledger: richLedger(),
		});
		expect(memory.temporaryUiHints.length + memory.correctionHints.length).toBeGreaterThan(0);
		const editorial = retrieveFromVideoMemory(
			memory,
			"Make this more professional. Only suggest changes supported by the recording.",
		);
		expect(editorial.includeTemporaryUi).toBe(true);
		expect(editorial.includeCorrections).toBe(true);
	});

	it("10 — Upwork remains passive context in retrieval", () => {
		const memory = buildVideoMemoryV1({
			document: docWithAsset(),
			assetId: "asset_1",
			ledger: richLedger(),
		});
		const r = retrieveFromVideoMemory(memory, "Make this video feel more professional.");
		expect(r.briefingText).toMatch(/passiveChrome/);
		expect(r.briefingText).not.toMatch(/opened Upwork/i);
	});

	it("11/12 — Restart and Settings stay query-aware (no auto-open claim in index)", () => {
		const memory = buildVideoMemoryV1({
			document: docWithAsset(),
			assetId: "asset_1",
			ledger: richLedger(),
		});
		expect(JSON.stringify(memory)).not.toMatch(/user restarted/i);
		expect(JSON.stringify(memory)).not.toMatch(/opened Settings/i);
		expect(classifyVideoMemoryQuery("Did I open Settings?")).toBe("action_verify");
		expect(classifyVideoMemoryQuery("Where would zoom actually help, if anywhere?")).toBe(
			"editorial",
		);
		expect(
			classifyVideoMemoryQuery(
				"Where would a zoom actually help in this recording, and where would it not help? Only recommend zooms when the visible evidence supports a specific focal target.",
			),
		).toBe("editorial");
	});

	it("13 — follow-up reuses same memory fingerprint", () => {
		const document = docWithAsset();
		const memory = buildVideoMemoryV1({
			document,
			assetId: "asset_1",
			ledger: richLedger(),
		});
		const t1 = retrieveFromVideoMemory(
			memory,
			"Understand this recording and tell me what you would improve.",
		);
		const t2 = retrieveFromVideoMemory(memory, "What else is distracting?");
		expect(t1.queryClass).toBe("editorial");
		expect(t2.queryClass).toBe("editorial");
		expect(validateVideoMemory(memory, document).programmeCurrent).toBe(true);
	});

	it("14 — no cross-document cache leak", () => {
		const cache = createVideoMemoryCache();
		const d1 = docWithAsset("/tmp/a.mp4", "doc-1");
		const d2 = docWithAsset("/tmp/a.mp4", "doc-2");
		const m1 = buildVideoMemoryV1({ document: d1, assetId: "asset_1", ledger: richLedger() });
		cache.put("doc-1", m1);
		expect(cache.get("doc-2", fingerprintSourceAsset(d2, "asset_1"))).toBeNull();
		expect(isCrossDocumentLeak(cache, "doc-1", "doc-2")).toBe(false);
	});

	it("15 — bounded retrieval", () => {
		const ledger = richLedger();
		for (let i = 0; i < 40; i++) {
			ledger.events.push({
				...ledger.events[0],
				id: `extra_${i}`,
				startSourceTimeSec: i * 0.2,
				endSourceTimeSec: i * 0.2 + 0.1,
				summary: `utterance ${i}`,
			});
		}
		const memory = buildVideoMemoryV1({
			document: docWithAsset(),
			assetId: "asset_1",
			ledger,
		});
		const r = retrieveFromVideoMemory(memory, "What did I say?");
		const speechLines = r.briefingText
			.split("\n")
			.filter((l) => /^\s+\d/.test(l) || l.includes("–"));
		expect(speechLines.length).toBeLessThanOrEqual(14);
	});

	it("16 — Investigator deepening suggested after memory miss class", () => {
		const memory = buildVideoMemoryV1({
			document: docWithAsset(),
			assetId: "asset_1",
			ledger: richLedger(),
		});
		const r = retrieveFromVideoMemory(memory, "Did I actually open the panel I mentioned?");
		expect(r.needsInvestigatorDeepening).toBe(true);
	});

	it("20 — no document mutation from memory subsystem", () => {
		const document = docWithAsset();
		const before = JSON.stringify(document);
		const memory = buildVideoMemoryV1({
			document,
			assetId: "asset_1",
			ledger: richLedger(),
		});
		retrieveFromVideoMemory(memory, "What else would you improve?");
		validateVideoMemory(memory, document);
		expect(JSON.stringify(document)).toBe(before);
	});
});
