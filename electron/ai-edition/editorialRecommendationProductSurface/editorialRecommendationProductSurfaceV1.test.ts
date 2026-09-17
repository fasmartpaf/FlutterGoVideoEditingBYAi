/**
 * Editorial Recommendation Product Surface V1 — unit tests.
 * TOTAL_PAID_AI_CALLS = 0. No live paid providers.
 */

import { describe, expect, it } from "vitest";
import {
	getCaptionSettings,
	patchCaptionSettings,
} from "../../../src/lib/ai-edition/captions/settings";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { enforceFinalPlanConsistency } from "../editorialGrounding";
import type { EditPlanV1 } from "../editPlan/types";
import {
	parseProductEditorialIntents,
	runEditorialRecommendationProductSurface,
	shouldRunDeadAir,
} from "./index";

function fixtureDoc(opts?: { enabled?: boolean }): AxcutDocument {
	const base = createEmptyDocument({
		title: "Surface test",
		projectId: "proj_surface",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	const words = [
		["hello", 1, 1.4],
		["there", 1.4, 1.8],
		["friend", 1.8, 2.2],
		["this", 3, 3.2],
		["is", 3.2, 3.4],
		["narration", 3.4, 3.9],
	] as Array<[string, number, number]>;
	let doc = documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "Recording",
				originalPath: "/tmp/surface-test.mp4",
				durationSec: 10,
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
						endSec: 3.9,
						text: words.map((x) => x[0]).join(" "),
						wordIds: words.map((_, i) => `w${i}`),
					},
				],
				words: words.map(([text, s, e], i) => ({
					id: `w${i}`,
					segmentId: "seg1",
					startSec: s,
					endSec: e,
					text,
					source: "asr" as const,
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
					sourceEndSec: 10,
					timelineStartSec: 0,
					timelineEndSec: 10,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
			trimRanges: [],
		},
		legacyEditor: {
			...(base.legacyEditor as object),
			aspectRatio: "16:9",
		},
	});
	if (opts?.enabled) {
		doc = patchCaptionSettings(doc, { enabled: true }, 16 / 9);
	}
	return doc;
}

describe("editorialRecommendationProductSurfaceV1", () => {
	it("parses caption + pause intents", () => {
		const cap = parseProductEditorialIntents("Enable captions from the transcript.");
		expect(cap.wantCaptions).toBe(true);
		expect(shouldRunDeadAir(cap)).toBe(false);

		const pause = parseProductEditorialIntents("Shorten long silent pauses if safe.");
		expect(pause.wantTighter).toBe(true);
		expect(shouldRunDeadAir(pause)).toBe(true);

		const pro = parseProductEditorialIntents(
			"Make this video professional and less than 10 seconds",
		);
		expect(pro.wantProfessional).toBe(true);
		expect(pro.targetDurationSec).toBe(10);
	});

	it("enable-captions path yields consentable review card", async () => {
		const doc = fixtureDoc();
		expect(getCaptionSettings(doc, 16 / 9).enabled).toBe(false);

		const result = await runEditorialRecommendationProductSurface({
			document: doc,
			assetId: "asset_1",
			mediaPath: null,
			userMessage: "Enable captions from the transcript.",
			forceDeadAir: false,
			skipReasoning: false,
			resetSeqForTests: true,
		});

		expect(result.metrics.paidAiCalls).toBe(0);
		expect(result.metrics.autoMutations).toBe(0);
		expect(result.supportedFamilies).toContain("caption");
		expect(result.editProposalV1?.proposals[0]?.proposedCall?.toolName).toBe("enableCaptions");
		expect(result.applyPreviewV1?.preflight.eligible).toBe(true);
		expect(result.editReview?.cards.some((c) => c.canApply)).toBe(true);
		expect(result.userFacingOffer).toMatch(/captions|Apply edit/i);
	});

	it("does not invent caption enable when already enabled", async () => {
		const doc = fixtureDoc({ enabled: true });
		const result = await runEditorialRecommendationProductSurface({
			document: doc,
			assetId: "asset_1",
			userMessage: "Enable captions from the transcript.",
			forceDeadAir: false,
			resetSeqForTests: true,
		});
		expect(result.editReview?.cards.some((c) => c.canApply) ?? false).toBe(false);
		expect(result.supportedFamilies.includes("caption")).toBe(false);
	});

	it("plan gate keeps caption advice when local surface supports caption", () => {
		const plan = {
			items: [{ id: "i1", preferredStrategy: "preserve", editorialIntent: "keep" }],
			summary: "preserve",
		} as unknown as EditPlanV1;
		const stripped = enforceFinalPlanConsistency({
			userFacingText: "Add captions for the narration from your transcript.",
			plan,
			gap: null,
		});
		expect(stripped.strippedConcreteAdvice).toBe(true);

		const kept = enforceFinalPlanConsistency({
			userFacingText: "Add captions for the narration from your transcript.",
			plan,
			gap: null,
			extraSupportedFamilies: ["caption"],
		});
		expect(kept.strippedConcreteAdvice).toBe(false);
	});

	it("pause ask without safe injected candidates stays honest / no apply card", async () => {
		const doc = fixtureDoc();
		const result = await runEditorialRecommendationProductSurface({
			document: doc,
			assetId: "asset_1",
			userMessage: "Shorten long silent pauses if safe.",
			injectedDeadAirCandidates: [],
			forceDeadAir: false,
			resetSeqForTests: true,
		});
		expect(result.editReview?.cards.some((c) => c.canApply) ?? false).toBe(false);
		expect(result.userFacingOffer).toMatch(/safe trim|not changed/i);
	});
});
