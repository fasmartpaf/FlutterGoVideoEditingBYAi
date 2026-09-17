/**
 * Local Caption Layout V1 — deterministic unit tests.
 * TOTAL_PAID_AI_CALLS = 0.
 */

import { describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import {
	breakLinesDeterministic,
	buildCaptionLayoutCacheKey,
	buildCaptionLayoutProposal,
	type CaptionWordSpan,
	choosePlacement,
	compressedDurationSec,
	DEFAULT_CAPTION_GROUPING_POLICY,
	detectCollisions,
	documentHasManualOrLegacyCaptions,
	fingerprintDocLite,
	fingerprintWords,
	groupWordsIntoCaptionDrafts,
	LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID,
	layoutCaptions,
	mapSourceSpanThroughDocument,
	readCaptionLayoutCache,
	runCaptionLayoutForDocument,
	runConsentedCaptionLayoutEnable,
	virtualSpanToProgrammeSpan,
	writeCaptionLayoutCache,
} from "./index";

function words(pairs: Array<[string, number, number]>): CaptionWordSpan[] {
	return pairs.map(([text, s, e], i) => ({
		id: `w${i}`,
		text,
		sourceStartSec: s,
		sourceEndSec: e,
		source: "asr" as const,
	}));
}

function fixtureDoc(opts?: {
	trim?: { start: number; end: number };
	speed?: { start: number; end: number; speed: number };
	withManualAnnotation?: boolean;
}): AxcutDocument {
	const base = createEmptyDocument({
		title: "cap",
		projectId: "proj_cap",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	const durationSec = 20;
	const w = words([
		["npm", 1, 1.3],
		["run", 1.3, 1.5],
		["build", 1.5, 1.9],
		["API", 2.1, 2.4],
		["slash", 2.4, 2.7],
		["v1", 2.7, 3.0],
		["localhost", 3.2, 3.6],
		["3000", 3.6, 4.0],
		["hello", 5, 5.4],
		["there", 5.4, 5.8],
		["friend", 5.8, 6.2],
	]);
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "Recording",
				originalPath: "/tmp/cap.mp4",
				durationSec,
			},
		],
		transcripts: [
			{
				assetId: "asset_1",
				language: "en",
				segments: [
					{
						id: "seg1",
						kind: "speech",
						startSec: 1,
						endSec: 6.2,
						text: w.map((x) => x.text).join(" "),
						wordIds: w.map((x) => x.id),
					},
				],
				words: w.map((x) => ({
					id: x.id,
					segmentId: "seg1",
					startSec: x.sourceStartSec,
					endSec: x.sourceEndSec,
					text: x.text,
					source: "asr",
				})),
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId: "asset_1",
					sourceStartSec: 0,
					sourceEndSec: durationSec,
					timelineStartSec: 0,
					timelineEndSec: durationSec,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
			trimRanges: opts?.trim
				? [
						{
							id: "trim_1",
							assetId: "asset_1",
							clipId: "clip_1",
							startSec: opts.trim.start,
							endSec: opts.trim.end,
							origin: "user",
							reason: "test",
						},
					]
				: [],
		},
		annotations: opts?.withManualAnnotation
			? [
					{
						id: "ann_manual",
						type: "text",
						content: "User title",
						startMs: 0,
						endMs: 2000,
						position: { x: 10, y: 10 },
						size: { width: 40, height: 10 },
						style: {
							color: "#fff",
							backgroundColor: "transparent",
							fontSize: 32,
							fontFamily: "Inter",
							fontWeight: "bold",
							fontStyle: "normal",
							textDecoration: "none",
							textAlign: "center",
							textAnimation: "none",
						},
						zIndex: 1,
					},
				]
			: [],
		legacyEditor: opts?.speed
			? {
					speedRegions: [
						{
							id: "spd1",
							startSec: opts.speed.start,
							endSec: opts.speed.end,
							speed: opts.speed.speed,
						},
					],
				}
			: {},
	});
}

describe("LOCAL_CAPTION_LAYOUT_V1", () => {
	it("provider identity", () => {
		expect(LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID).toBe("CURRENT_OPENSCREEN_LOCAL_CAPTION_LAYOUT_V1");
		expect(DEFAULT_CAPTION_GROUPING_POLICY.pauseBreakSec).toBeGreaterThan(0);
	});

	it("groups on pause + punctuation + reading speed; keeps technical tokens", () => {
		const w = words([
			["npm", 0, 0.3],
			["run", 0.3, 0.5],
			["build", 0.5, 0.8],
			["done.", 0.8, 1.0],
			["Next", 1.5, 1.7],
			["step", 1.7, 2.0],
		]);
		const drafts = groupWordsIntoCaptionDrafts(w);
		expect(drafts.length).toBeGreaterThanOrEqual(2);
		expect(drafts.some((d) => d.text.includes("npm"))).toBe(true);
		expect(drafts.every((d) => !d.text.includes("paraphrase"))).toBe(true);
	});

	it("line breaking: 1–2 lines, long token overflow flag path", () => {
		const one = breakLinesDeterministic("hello world", {
			fontSizePxAt1080: 48,
			maxWidthFrac: 0.68,
			maxLines: 2,
			policy: DEFAULT_CAPTION_GROUPING_POLICY,
		});
		expect(one.lines.length).toBeGreaterThanOrEqual(1);
		expect(one.lines.length).toBeLessThanOrEqual(2);

		const long = breakLinesDeterministic(
			"https://localhost:3000/very/long/path/that/should/stress/wrapping/algorithm",
			{
				fontSizePxAt1080: 48,
				maxWidthFrac: 0.4,
				maxLines: 2,
				policy: DEFAULT_CAPTION_GROUPING_POLICY,
			},
		);
		expect(long.lines.join(" ").includes("localhost")).toBe(true);
	});

	it("collision + NO_SAFE_LAYOUT when all placements blocked", () => {
		const protectedRegions = [
			{
				id: "full",
				kind: "ui" as const,
				rect: { x: 0, y: 0, width: 1, height: 1 },
				blocking: true,
			},
		];
		const result = layoutCaptions({
			assetId: "a",
			aspectValue: 16 / 9,
			words: words([
				["hello", 0, 0.5],
				["world", 0.5, 1.0],
			]),
			protectedRegions,
		});
		expect(result.status).toBe("NO_SAFE_LAYOUT");
		expect(result.cues.every((c) => c.omitted)).toBe(true);
	});

	it("webcam collision prefers alternate placement; continuity holds", () => {
		const webcam = {
			id: "webcam",
			kind: "webcam" as const,
			rect: { x: 0.65, y: 0.65, width: 0.3, height: 0.3 },
			blocking: true,
		};
		const first = choosePlacement({
			cueId: "c1",
			safeArea: layoutCaptions({
				assetId: "a",
				aspectValue: 16 / 9,
				words: words([
					["one", 0, 0.4],
					["two", 0.4, 0.8],
				]),
			}).safeArea,
			boxHeightFrac: 0.12,
			protectedRegions: [webcam],
			previousPlacement: null,
			preferContinuity: true,
		});
		expect(first.placement).not.toBe("BOTTOM_RIGHT");
		const second = choosePlacement({
			cueId: "c2",
			safeArea: first.box
				? layoutCaptions({
						assetId: "a",
						aspectValue: 16 / 9,
						words: words([
							["three", 1, 1.4],
							["four", 1.4, 1.8],
						]),
					}).safeArea
				: (first as never),
			boxHeightFrac: 0.12,
			protectedRegions: [webcam],
			previousPlacement: first.placement,
			preferContinuity: true,
		});
		expect(second.placement).toBe(first.placement);
	});

	it("aspect ratios 16:9 / 9:16 / 1:1 produce safe areas", () => {
		for (const aspect of [16 / 9, 9 / 16, 1]) {
			const r = layoutCaptions({
				assetId: "a",
				aspectValue: aspect,
				words: words([
					["alpha", 0, 0.5],
					["beta", 0.5, 1],
				]),
			});
			expect(r.safeArea.column.width).toBeGreaterThan(0.5);
			expect(r.status).toBe("ok");
		}
	});

	it("speed 0.5 / 1.5 / 2x compresses programme duration", () => {
		expect(compressedDurationSec(0, 2, [{ startSec: 0, endSec: 2, speed: 2 }])).toBeCloseTo(1, 5);
		expect(compressedDurationSec(0, 2, [{ startSec: 0, endSec: 2, speed: 0.5 }])).toBeCloseTo(4, 5);
		expect(compressedDurationSec(0, 2, [{ startSec: 0, endSec: 2, speed: 1.5 }])).toBeCloseTo(
			2 / 1.5,
			5,
		);
		const span = virtualSpanToProgrammeSpan(10, 12, [{ startSec: 10, endSec: 12, speed: 2 }]);
		expect(span.endSec - span.startSec).toBeCloseTo(1, 5);
	});

	it("trim removes cues for cut speech; surviving words map", () => {
		const doc = fixtureDoc({ trim: { start: 4.5, end: 7 } });
		const { layout } = runCaptionLayoutForDocument({
			document: doc,
			assetId: "asset_1",
			aspectValue: 16 / 9,
			useCache: false,
		});
		const texts = layout.cues.filter((c) => !c.omitted).map((c) => c.text);
		expect(texts.some((t) => t.includes("friend"))).toBe(false);
		expect(texts.some((t) => t.includes("npm"))).toBe(true);

		const mapped = mapSourceSpanThroughDocument(doc, "asset_1", 1, 2);
		expect(mapped.length).toBeGreaterThan(0);
	});

	it("proposal is proposal_only; no consent → no mutation; manual captions flagged", async () => {
		const doc = fixtureDoc({ withManualAnnotation: true });
		expect(documentHasManualOrLegacyCaptions(doc)).toBe(true);
		const { proposal } = runCaptionLayoutForDocument({
			document: doc,
			assetId: "asset_1",
			aspectValue: 16 / 9,
			useCache: false,
		});
		expect(proposal.status).toBe("proposal_only");
		expect(proposal.notExecuted).toBe(true);
		expect(proposal.review.headline.length).toBeGreaterThan(5);

		const blocked = await runConsentedCaptionLayoutEnable({
			document: doc,
			proposal,
			consent: null,
			aspectValue: 16 / 9,
		});
		expect(blocked.mutated).toBe(false);
		expect(blocked.terminalStatus).toBe("blocked");

		const consented = await runConsentedCaptionLayoutEnable({
			document: doc,
			proposal,
			consent: {
				proposalIntent: proposal.intent,
				documentFingerprint: fingerprintDocLite(doc),
				aspectValue: 16 / 9,
				consentedAtIso: new Date().toISOString(),
			},
			aspectValue: 16 / 9,
		});
		if (proposal.safeToPropose) {
			expect(["verified", "rolled_back"]).toContain(consented.terminalStatus);
		}
	});

	it("cache hit returns same layout; paid AI zero", () => {
		const w = words([
			["cache", 0, 0.4],
			["test", 0.4, 0.8],
		]);
		const key = buildCaptionLayoutCacheKey({
			transcriptFingerprint: fingerprintWords(w),
			programmeFingerprint: "p1",
			aspectValue: 16 / 9,
			policyVersion: "v1",
			protectedRegionFingerprint: "none",
		});
		const layout = layoutCaptions({ assetId: "a", aspectValue: 16 / 9, words: w });
		writeCaptionLayoutCache(key, layout);
		const hit = readCaptionLayoutCache(key);
		expect(hit?.cacheHit).toBe(true);
		expect(hit?.metrics.additionalModelCalls).toBe(0);
		expect(buildCaptionLayoutProposal(layout).providerId).toContain("CAPTION_LAYOUT");
	});

	it("detectCollisions reports annotation overlap", () => {
		const cs = detectCollisions({
			cueId: "c",
			box: { x: 0.1, y: 0.7, width: 0.6, height: 0.15 },
			safeAreaColumn: { x: 0.16, y: 0.1, width: 0.68, height: 0.8 },
			protectedRegions: [
				{
					id: "ann1",
					kind: "annotation",
					rect: { x: 0.2, y: 0.72, width: 0.3, height: 0.1 },
					blocking: false,
				},
			],
		});
		expect(cs.some((c) => c.reason.includes("annotation"))).toBe(true);
	});
});
