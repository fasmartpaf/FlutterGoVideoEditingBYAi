/**
 * Video Memory Retrieval Production Path V1 — unit tests.
 * Identity: CURRENT_OPENSCREEN_VIDEO_MEMORY_RETRIEVAL_PRODUCTION_V1
 */

import { describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import { buildTemporalEventLedger } from "../temporalEventLedger";
import type { VisualEvidenceFrame } from "../visualEvidence/types";
import { frameBudgetForQuery, selectFramesForRetrieval } from "./framePolicy";
import { buildVideoMemoryV1, classifyVideoMemoryQuery, retrieveFromVideoMemory } from "./index";
import { packProviderContextFromMemory } from "./packProviderContext";
import {
	resolveContextPackingMode,
	VIDEO_MEMORY_RETRIEVAL_PRODUCTION_V1_ID,
} from "./productionPath";
import {
	_resetVideoMemorySessionStoreForTests,
	createVideoMemorySessionStore,
	mergeProgrammeStoryForPut,
} from "./sessionStore";
import { evaluateEvidenceSufficiency } from "./sufficiency";

function doc(path = "/tmp/a.mp4", projectId = "p1") {
	const base = createEmptyDocument({ title: "t", projectId });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				label: "a",
				kind: "video",
				originalPath: path,
				durationSec: 20,
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

function ledger() {
	return buildTemporalEventLedger({
		assetId: "asset_1",
		sourceDurationSec: 20,
		speech: {
			status: "available",
			segments: [
				{ id: "s1", startSourceTimeSec: 1, endSourceTimeSec: 3, text: "hello" },
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
					text: "near the end Settings",
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
				{ sourceTimeSec: 18, frameSummary: "Restart recording control visible in HUD" },
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

function fakeFrames(n: number): VisualEvidenceFrame[] {
	return Array.from({ length: n }, (_, i) => ({
		sourceTimeSec: i * 1.5,
		virtualTimeSec: i * 1.5,
		reason: i % 3 === 0 ? ("change_refinement" as const) : ("periodic" as const),
		imagePath: `/tmp/f${i}.jpg`,
		width: 1280,
		height: 720,
		byteLength: 1000,
		mimeType: "image/jpeg" as const,
	}));
}

describe("Video Memory Retrieval Production Path V1", () => {
	it("resolves packing mode from override and env", () => {
		expect(resolveContextPackingMode("VIDEO_MEMORY_RETRIEVAL")).toBe("VIDEO_MEMORY_RETRIEVAL");
		expect(resolveContextPackingMode(null, {})).toBe("CURRENT_FULL_CONTEXT");
		expect(
			resolveContextPackingMode(undefined, {
				OPENSCREEN_CONTEXT_PACKING: "VIDEO_MEMORY_RETRIEVAL",
			}),
		).toBe("VIDEO_MEMORY_RETRIEVAL");
		expect(VIDEO_MEMORY_RETRIEVAL_PRODUCTION_V1_ID).toContain("RETRIEVAL_PRODUCTION");
	});

	it("speech query → zero frame budget", () => {
		expect(frameBudgetForQuery("speech").maxFrames).toBe(0);
		expect(classifyVideoMemoryQuery("What did I say near the end?")).toBe("speech");
		expect(classifyVideoMemoryQuery("Where would zoom actually help, if anywhere?")).toBe(
			"editorial",
		);
		expect(
			classifyVideoMemoryQuery(
				"Compare what I say with what is visibly happening. Tell me what matches, what differs, and what cannot be verified.",
				classifyMediaContextNeeds(
					"Compare what I say with what is visibly happening. Tell me what matches, what differs, and what cannot be verified.",
				),
			),
		).toBe("cross_modal");
	});

	it("action_verify / editorial budgets are bounded", () => {
		expect(frameBudgetForQuery("action_verify").maxFrames).toBeLessThanOrEqual(4);
		expect(frameBudgetForQuery("editorial").maxFrames).toBeLessThanOrEqual(6);
	});

	it("selectFramesForRetrieval dedupes and attaches reasons", () => {
		const memory = buildVideoMemoryV1({
			document: doc(),
			assetId: "asset_1",
			ledger: ledger(),
		});
		const { frames, meta } = selectFramesForRetrieval({
			frames: fakeFrames(20),
			queryClass: "editorial",
			memory,
		});
		expect(frames.length).toBeLessThanOrEqual(6);
		expect(meta.every((m) => m.reason && m.note)).toBe(true);
		for (let i = 1; i < frames.length; i++) {
			expect(Math.abs(frames[i]!.sourceTimeSec - frames[i - 1]!.sourceTimeSec)).toBeGreaterThan(
				0.3,
			);
		}
	});

	it("speech sufficiency → no investigator; action_verify → deepen", () => {
		const memory = buildVideoMemoryV1({
			document: doc(),
			assetId: "asset_1",
			ledger: ledger(),
		});
		const speechRet = retrieveFromVideoMemory(memory, "What did I say near the end?");
		const s = evaluateEvidenceSufficiency({
			queryClass: "speech",
			retrieval: speechRet,
			memory,
			hasSpeechEvidence: true,
			attachedFrameCount: 0,
		});
		expect(s.runInvestigator).toBe(false);

		const actRet = retrieveFromVideoMemory(memory, "Did I open Settings?");
		const a = evaluateEvidenceSufficiency({
			queryClass: "action_verify",
			retrieval: actRet,
			memory,
			hasSpeechEvidence: true,
			attachedFrameCount: 2,
		});
		expect(a.runInvestigator).toBe(true);
	});

	it("packed provider context preserves epistemic guards language", () => {
		const memory = buildVideoMemoryV1({
			document: doc(),
			assetId: "asset_1",
			ledger: ledger(),
		});
		const retrieval = retrieveFromVideoMemory(
			memory,
			"Make this more professional without inventing actions.",
		);
		const packed = packProviderContextFromMemory({
			userMessage: "Make this more professional.",
			memory,
			retrieval,
		});
		expect(packed.text).toMatch(/passive chrome/i);
		expect(packed.text).toMatch(/Restart UI ≠ restarted|Restart UI/);
		expect(packed.text).not.toMatch(/opened Upwork/i);
		expect(packed.chars).toBeLessThan(12_000);
	});

	it("session store reuses source memory; isolates documents", () => {
		_resetVideoMemorySessionStoreForTests();
		const store = createVideoMemorySessionStore();
		const d1 = doc("/tmp/a.mp4", "doc-a");
		const d2 = doc("/tmp/a.mp4", "doc-b");
		const memory = buildVideoMemoryV1({
			document: d1,
			assetId: "asset_1",
			ledger: ledger(),
		});
		store.put({
			documentId: "doc-a",
			assetId: "asset_1",
			sourceFingerprint: memory.sourceFingerprint,
			ledger: ledger(),
			claims: null,
			sourceStoryV2: null,
			programmeFingerprintWhenStoryBuilt: memory.programmeFingerprint,
			memory,
			turnCount: 1,
			lastQueryClass: "editorial",
			storedAtIso: new Date().toISOString(),
		});
		expect(store.get("doc-a", "asset_1", d1)?.turnCount).toBe(1);
		expect(store.get("doc-b", "asset_1", d2)).toBeNull();
	});

	it("asset replacement invalidates session entry", () => {
		const store = createVideoMemorySessionStore();
		const d1 = doc("/tmp/a.mp4", "doc-a");
		const memory = buildVideoMemoryV1({
			document: d1,
			assetId: "asset_1",
			ledger: ledger(),
		});
		store.put({
			documentId: "doc-a",
			assetId: "asset_1",
			sourceFingerprint: memory.sourceFingerprint,
			ledger: ledger(),
			claims: null,
			sourceStoryV2: null,
			programmeFingerprintWhenStoryBuilt: memory.programmeFingerprint,
			memory,
			turnCount: 1,
			lastQueryClass: "speech",
			storedAtIso: new Date().toISOString(),
		});
		const replaced = doc("/tmp/b.mp4", "doc-a");
		expect(store.get("doc-a", "asset_1", replaced)).toBeNull();
	});

	it("timeline trim keeps source reusable via validate path in session get", () => {
		const store = createVideoMemorySessionStore();
		const d1 = doc();
		const memory = buildVideoMemoryV1({
			document: d1,
			assetId: "asset_1",
			ledger: ledger(),
		});
		store.put({
			documentId: d1.project.id,
			assetId: "asset_1",
			sourceFingerprint: memory.sourceFingerprint,
			ledger: ledger(),
			claims: null,
			sourceStoryV2: null,
			programmeFingerprintWhenStoryBuilt: memory.programmeFingerprint,
			memory,
			turnCount: 1,
			lastQueryClass: "editorial",
			storedAtIso: new Date().toISOString(),
		});
		const trimmed = documentSchema.parse({
			...d1,
			timeline: {
				...d1.timeline,
				clips: [
					{ ...d1.timeline.clips[0]!, sourceStartSec: 2, sourceEndSec: 18, timelineEndSec: 16 },
				],
			},
		});
		const hit = store.get(d1.project.id, "asset_1", trimmed);
		expect(hit).not.toBeNull();
		expect(hit?.sourceStoryV2).toBeNull(); // programme invalidated
	});

	it("duration probe keeps programme story in session", () => {
		const store = createVideoMemorySessionStore();
		const d1 = doc();
		const memory = buildVideoMemoryV1({
			document: d1,
			assetId: "asset_1",
			ledger: ledger(),
		});
		store.put({
			documentId: d1.project.id,
			assetId: "asset_1",
			sourceFingerprint: memory.sourceFingerprint,
			ledger: ledger(),
			claims: null,
			sourceStoryV2: { providerId: "CURRENT_OPENSCREEN_SOURCE_STORY_V2" } as never,
			programmeFingerprintWhenStoryBuilt: memory.programmeFingerprint,
			memory,
			turnCount: 1,
			lastQueryClass: "visual",
			storedAtIso: new Date().toISOString(),
		});
		const probed = documentSchema.parse({
			...d1,
			assets: d1.assets.map((a) => ({ ...a, durationSec: 17.04 })),
			timeline: {
				...d1.timeline,
				clips: [
					{
						...d1.timeline.clips[0]!,
						sourceEndSec: 17.04,
						timelineEndSec: 17.04,
					},
				],
			},
		});
		const hit = store.get(d1.project.id, "asset_1", probed);
		expect(hit?.sourceStoryV2).not.toBeNull();
	});

	it("speech follow-up without computed story does not clobber cached Source Story", () => {
		const d1 = doc();
		const memory = buildVideoMemoryV1({
			document: d1,
			assetId: "asset_1",
			ledger: ledger(),
		});
		const cachedStory = { providerId: "CURRENT_OPENSCREEN_SOURCE_STORY_V2" } as never;
		const merged = mergeProgrammeStoryForPut({
			computedStory: null,
			cached: {
				documentId: d1.project.id,
				assetId: "asset_1",
				sourceFingerprint: memory.sourceFingerprint,
				ledger: ledger(),
				claims: null,
				sourceStoryV2: cachedStory,
				programmeFingerprintWhenStoryBuilt: memory.programmeFingerprint,
				memory,
				turnCount: 1,
				lastQueryClass: "visual",
				storedAtIso: new Date().toISOString(),
			},
			programmeFingerprintNow: memory.programmeFingerprint,
		});
		expect(merged.sourceStoryV2).toBe(cachedStory);
		const afterTrim = mergeProgrammeStoryForPut({
			computedStory: null,
			cached: {
				documentId: d1.project.id,
				assetId: "asset_1",
				sourceFingerprint: memory.sourceFingerprint,
				ledger: ledger(),
				claims: null,
				sourceStoryV2: cachedStory,
				programmeFingerprintWhenStoryBuilt: memory.programmeFingerprint,
				memory,
				turnCount: 1,
				lastQueryClass: "visual",
				storedAtIso: new Date().toISOString(),
			},
			programmeFingerprintNow: "different-programme",
		});
		expect(afterTrim.sourceStoryV2).toBeNull();
	});

	it("Restart / Upwork / Settings prompts do not become speech-only starvation", () => {
		const restart = classifyMediaContextNeeds(
			"What temporary UI appears near the end? Did I restart the recording?",
		);
		expect(restart.visual).toBe(true);
		const upwork = classifyMediaContextNeeds(
			"If you see browser tabs or app names like Upwork, did I actually open or work in that app?",
		);
		expect(upwork.visual).toBe(true);
		const settings = classifyVideoMemoryQuery(
			"I mentioned Settings. Was Settings actually opened on screen, or do you only see related text/labels?",
		);
		expect(settings).toBe("action_verify");
		expect(frameBudgetForQuery(settings, "bounded_range").maxFrames).toBeGreaterThan(0);
		expect(frameBudgetForQuery(settings, "bounded_range").maxFrames).toBeLessThanOrEqual(4);
	});

	it("does not mutate AxcutDocument when packing", () => {
		const d = doc();
		const before = JSON.stringify(d);
		const memory = buildVideoMemoryV1({ document: d, assetId: "asset_1", ledger: ledger() });
		const retrieval = retrieveFromVideoMemory(memory, "What did I say?");
		packProviderContextFromMemory({
			userMessage: "What did I say?",
			memory,
			retrieval,
		});
		expect(JSON.stringify(d)).toBe(before);
	});
});
