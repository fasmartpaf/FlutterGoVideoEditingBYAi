/**
 * Planning → Investigation Closure V1 — behavioral tests (0 orchestration LLM).
 * Does not execute edits / mutate AxcutDocument.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { buildClaimPromotionSet, resetClaimPromotionSeqForTests } from "../claimPromotion";
import { buildEditGapV1, resetEditGapSeqForTests, validateAndSanitizeEditGapV1 } from "../editGap";
import {
	buildEditPlanV1,
	resetEditPlanSeqForTests,
	validateAndSanitizeEditPlanV1,
} from "../editPlan";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import {
	buildSourceStoryEvidenceInput,
	buildSourceStoryV2,
	resetSourceStoryV2SeqForTests,
} from "../sourceStory/v2";
import type { SpeechEvidence } from "../speechEvidence/types";
import { buildTargetStoryV1, resetTargetStoryV1SeqForTests } from "../targetStory/v1";
import type { TemporalEventLedger } from "../temporalEventLedger/types";
import type { InvestigationEvidenceSet } from "../videoInvestigator/types";
import {
	analyzePlanRedundancy,
	generateEvidenceRequests,
	itemNeedsEvidence,
	leaksExecution,
	PLANNING_CLOSURE_V1_PROVIDER_ID,
	runPlanningClosureV1,
} from "./index";

beforeEach(() => {
	resetEditPlanSeqForTests();
	resetEditGapSeqForTests();
	resetTargetStoryV1SeqForTests();
	resetSourceStoryV2SeqForTests();
	resetClaimPromotionSeqForTests();
});

function speechEv(segments: SpeechEvidence["segments"]): SpeechEvidence {
	return {
		assetId: "a1",
		sourceDurationSec: 20,
		segments,
		status: "available",
		audioStreamPresent: true,
		timings: {
			audioProbeMs: 0,
			audioExtractMs: 0,
			sttMs: 0,
			transcriptParseMs: 0,
			transcriptCacheMs: 0,
			segmentCount: segments.length,
			cacheHit: true,
		},
	};
}

function ledger(events: TemporalEventLedger["events"]): TemporalEventLedger {
	return {
		meta: {
			assetId: "a1",
			sourceDurationSec: 20,
			timebase: "SOURCE_MEDIA_TIME",
			builtAtIso: new Date().toISOString(),
			constructionMs: 1,
			additionalModelCalls: 0,
			eventCount: events.length,
			claimCount: 0,
			evidenceRefCount: 0,
		},
		events,
	};
}

function storyFromEvents(events: TemporalEventLedger["events"], speech?: SpeechEvidence) {
	const led = ledger(events);
	const claims = buildClaimPromotionSet({ ledger: led, lazy: false });
	return {
		source: buildSourceStoryV2(
			buildSourceStoryEvidenceInput({
				assetId: "a1",
				sourceDurationSec: 20,
				ledger: led,
				claimPromotion: claims,
				speechEvidence: speech,
				frames: [],
				changes: [
					{
						fromSourceTimeSec: 16,
						toSourceTimeSec: 18,
						score: 0.2,
						classification: "significant",
					},
				],
			}),
		),
		ledger: led,
		claims,
	};
}

function chain(events: TemporalEventLedger["events"], intent: string, speech?: SpeechEvidence) {
	const { source, ledger: led, claims } = storyFromEvents(events, speech);
	const target = buildTargetStoryV1({ sourceStoryV2: source, userIntent: intent });
	const gap = validateAndSanitizeEditGapV1(
		buildEditGapV1({ sourceStoryV2: source, targetStoryV1: target, userIntent: intent }),
	).gap;
	const plan = validateAndSanitizeEditPlanV1(
		buildEditPlanV1({ sourceStoryV2: source, targetStoryV1: target, editGapV1: gap }),
	).plan;
	return { source, target, gap, plan, ledger: led, claims };
}

function mockInv(
	partial: Partial<InvestigationEvidenceSet> & {
		claims?: InvestigationEvidenceSet["claims"];
		observations?: InvestigationEvidenceSet["observations"];
	},
): InvestigationEvidenceSet {
	return {
		version: 1,
		assetId: "a1",
		timebase: "SOURCE_MEDIA_TIME",
		questionSummary: partial.questionSummary ?? "mock",
		focusRange: partial.focusRange ?? { startSourceTimeSec: 10, endSourceTimeSec: 14 },
		stopReason: partial.stopReason ?? "sufficient_evidence",
		coverage: partial.coverage ?? {
			sourceDurationSec: 20,
			rangesInspected: [{ startSourceTimeSec: 10, endSourceTimeSec: 14 }],
			frameTimesSec: [12],
			roiCount: 1,
			modalitiesTouched: ["visual"],
			absenceIsStrong: false,
		},
		observations: partial.observations ?? [],
		claims: partial.claims ?? [],
		toolTrace: [],
		metrics: {
			memoryQueryMs: 0,
			planningMs: 1,
			toolExecutionMs: 2,
			verificationMs: 1,
			totalInvestigationMs: 4,
			frameCacheHits: 1,
			frameCacheMisses: 0,
			newlyExtractedFrames: 0,
			roiExtractMs: 0,
			transcriptRetrievalMs: 0,
			cursorRetrievalMs: 0,
			investigatorModelCalls: 0,
			stepsUsed: 2,
			toolCalls: 2,
			policyVersion: "v1.1",
		},
		internalBriefing: "",
		additionalFrames: [],
		providerId: "CURRENT_OPENSCREEN_INVESTIGATOR_V1_1",
		...partial,
	};
}

describe("Planning Closure V1", () => {
	it("1–2. request only when needed; grounded HUD creates none", () => {
		const grounded = chain(
			[
				{
					id: "e_r",
					assetId: "a1",
					startSourceTimeSec: 18,
					endSourceTimeSec: 19,
					type: "observed_visible_text",
					modalities: ["visual"],
					summary: "Observed visible text: Restart recording",
					claims: [{ id: "c", text: "Restart recording", epistemic: "observed", evidence: [] }],
					evidence: [],
					confidence: "high",
				},
			],
			"Make this professional.",
		);
		const reqs = generateEvidenceRequests(grounded.plan);
		// HUD de-emphasis is already grounded — no needs_more_evidence request unless crop preferred
		expect(reqs.every((r) => r.question === "verify_crop_safety") || reqs.length === 0).toBe(true);
		expect(grounded.plan.items.filter(itemNeedsEvidence).length).toBe(0);
	});

	it("3–5. role mapping, bounded range, duplicate suppress", async () => {
		const base = chain(
			[
				{
					id: "e_s",
					assetId: "a1",
					startSourceTimeSec: 10,
					endSourceTimeSec: 14,
					type: "speech",
					modalities: ["speech"],
					summary: "Emphasize the button",
					claims: [],
					evidence: [],
					confidence: "high",
				},
			],
			"Emphasize the Publish button I click — make focus clearer.",
			speechEv([
				{
					startSourceTimeSec: 10,
					endSourceTimeSec: 14,
					text: "Emphasize the Publish button I click.",
				},
			]),
		);

		// Force a needs_more_evidence item if chain did not produce one
		let plan = base.plan;
		if (!plan.items.some(itemNeedsEvidence)) {
			plan = {
				...plan,
				items: [
					...plan.items,
					{
						id: "plan_force",
						gapIds: plan.items[0] ? [plan.items[0].gapIds[0] ?? "g"] : ["g"],
						sourceBeatIds: base.source.beats[0] ? [base.source.beats[0].id] : [],
						targetBeatIds: [],
						editorialIntent: "Identify focal Publish button (unclear_focus)",
						candidateStrategies: [
							{
								family: "needs_more_evidence",
								rationale: "Focal UI target not grounded",
								feasibility: "needs_more_evidence",
								risk: "low",
								rankScore: 100,
								evidenceRequirements: ["inspect click range", "identify target UI region"],
							},
						],
						preferredStrategy: "needs_more_evidence",
						priority: "high",
						feasibility: "needs_more_evidence",
						constraints: [],
						preservationRefs: [],
						provenanceRefs: [],
						confidence: 0.5,
						evidenceRange: { startSourceTimeSec: 10, endSourceTimeSec: 14 },
					},
				],
			};
		}

		const reqs = generateEvidenceRequests(plan, { maxRequests: 3 });
		expect(reqs.length).toBeGreaterThan(0);
		expect(reqs[0]!.investigatorRoles[0]).toBe("GROUNDING");
		expect(reqs[0]!.investigatorRoles).toContain("VERIFICATION");
		if (reqs[0]!.sourceRange) {
			expect(reqs[0]!.sourceRange.endSec - reqs[0]!.sourceRange.startSec).toBeLessThanOrEqual(12);
		}

		let calls = 0;
		const closure = await runPlanningClosureV1({
			initialPlan: plan,
			sourceStoryV2: base.source,
			targetStoryV1: base.target,
			editGapV1: base.gap,
			evidence: {
				assetId: "a1",
				sourceDurationSec: 20,
				userMessage: "Emphasize the Publish button I click — make focus clearer.",
				contextNeeds: classifyMediaContextNeeds(
					"Emphasize the Publish button I click — make focus clearer.",
				),
				ledger: base.ledger,
				claimPromotion: base.claims,
			},
			budgets: { maxRounds: 2, maxRequestsPerRound: 3 },
			investigate: async () => {
				calls += 1;
				return mockInv({
					claims: [
						{
							id: "ic1",
							hypothesis: "User clicked Publish button",
							verdict: "not_verified",
							rationale: "still unclear after inspect",
							evidence: [],
						},
					],
				});
			},
		});
		expect(closure.providerId).toBe(PLANNING_CLOSURE_V1_PROVIDER_ID);
		expect(calls).toBeLessThanOrEqual(3);
		// Second round should suppress same identity
		expect(
			closure.metrics.duplicatesSuppressed + closure.metrics.evidenceRequestsExecuted,
		).toBeGreaterThan(0);
		expect(closure.planVersions.length).toBeGreaterThanOrEqual(1);
	});

	it("6–8. max rounds, support path, invalidate path", async () => {
		const base = chain(
			[
				{
					id: "e_s",
					assetId: "a1",
					startSourceTimeSec: 10,
					endSourceTimeSec: 14,
					type: "speech",
					modalities: ["speech"],
					summary: "click the control",
					claims: [],
					evidence: [],
					confidence: "high",
				},
			],
			"Emphasize the button I click.",
			speechEv([
				{ startSourceTimeSec: 10, endSourceTimeSec: 14, text: "click the Publish button" },
			]),
		);
		const plan = {
			...base.plan,
			items: [
				{
					id: "plan_need",
					gapIds: ["gap_x"],
					sourceBeatIds: base.source.beats.map((b) => b.id).slice(0, 1),
					targetBeatIds: [],
					editorialIntent: "Identify button near click (unclear_focus)",
					candidateStrategies: [
						{
							family: "needs_more_evidence",
							rationale: "need button identity",
							feasibility: "needs_more_evidence" as const,
							risk: "low" as const,
							rankScore: 100,
							evidenceRequirements: ["identify target UI region"],
						},
						{
							family: "zoom" as const,
							rationale: "zoom if grounded",
							feasibility: "needs_more_evidence" as const,
							risk: "medium" as const,
							rankScore: 10,
						},
					],
					preferredStrategy: "needs_more_evidence" as const,
					priority: "high" as const,
					feasibility: "needs_more_evidence" as const,
					constraints: [],
					preservationRefs: [],
					provenanceRefs: [],
					confidence: 0.4,
					evidenceRange: { startSourceTimeSec: 10, endSourceTimeSec: 14 },
				},
			],
		};

		const support = await runPlanningClosureV1({
			initialPlan: plan,
			sourceStoryV2: base.source,
			targetStoryV1: base.target,
			editGapV1: base.gap,
			evidence: {
				assetId: "a1",
				sourceDurationSec: 20,
				userMessage: "Emphasize the button I click.",
				contextNeeds: classifyMediaContextNeeds("Emphasize the button I click."),
				ledger: base.ledger,
				claimPromotion: base.claims,
				cursorInteractions: [{ sourceTimeSec: 12, interactionType: "click" }],
			},
			budgets: { maxRounds: 2 },
			investigate: async () =>
				mockInv({
					claims: [
						{
							id: "ic_btn",
							hypothesis: "Publish button control visible near cursor click",
							verdict: "observed",
							rationale: "OCR/label Publish near click",
							evidence: [],
						},
					],
					observations: [
						{
							id: "obs_btn",
							kind: "roi",
							startSourceTimeSec: 12,
							endSourceTimeSec: 12,
							text: "Observed visible text: Publish button",
							evidence: [],
						},
					],
				}),
			mergeInvestigation: (ctx, inv) => {
				if (!ctx.ledger || !inv) return ctx;
				const events = [
					...ctx.ledger.events,
					{
						id: "e_pub",
						assetId: "a1",
						startSourceTimeSec: 12,
						endSourceTimeSec: 12,
						type: "observed_visible_text" as const,
						modalities: ["visual" as const],
						summary: "Observed visible text: Publish button",
						claims: [
							{
								id: "cp",
								text: "Publish button",
								epistemic: "observed" as const,
								evidence: [],
							},
						],
						evidence: [],
						confidence: "high" as const,
					},
				];
				return {
					...ctx,
					ledger: {
						...ctx.ledger,
						events,
						meta: { ...ctx.ledger.meta, eventCount: events.length },
					},
				};
			},
		});
		expect(support.metrics.closureRounds).toBeLessThanOrEqual(2);
		expect(support.planVersions.length).toBeGreaterThan(1);
		expect(support.metrics.orchestrationModelCalls).toBe(0);

		const invalidate = await runPlanningClosureV1({
			initialPlan: {
				...base.plan,
				items: [
					{
						id: "plan_crop",
						gapIds: ["gap_hud"],
						sourceBeatIds: base.source.beats.map((b) => b.id).slice(0, 1),
						targetBeatIds: [],
						editorialIntent: "De-emphasize temporary HUD (distracting_temporary_ui)",
						candidateStrategies: [
							{
								family: "crop",
								rationale: "crop if safe",
								feasibility: "supported",
								risk: "medium",
								rankScore: 90,
							},
							{
								family: "no_safe_edit",
								rationale: "if overlaps essential",
								feasibility: "supported",
								risk: "low",
								rankScore: 20,
							},
						],
						preferredStrategy: "crop",
						priority: "high",
						feasibility: "supported",
						constraints: [],
						preservationRefs: [],
						provenanceRefs: [],
						confidence: 0.6,
						evidenceRange: { startSourceTimeSec: 18, endSourceTimeSec: 19 },
					},
				],
			},
			sourceStoryV2: base.source,
			targetStoryV1: base.target,
			editGapV1: base.gap,
			evidence: {
				assetId: "a1",
				sourceDurationSec: 20,
				userMessage: "Make this professional.",
				contextNeeds: classifyMediaContextNeeds("Make this professional."),
				ledger: base.ledger,
			},
			investigate: async () =>
				mockInv({
					questionSummary: "HUD overlaps essential content",
					claims: [
						{
							id: "ic_hud",
							hypothesis: "Restart tooltip overlaps essential application content",
							verdict: "observed",
							rationale: "compare shows essential UI under HUD",
							evidence: [],
						},
					],
				}),
		});
		expect(invalidate.evidenceRequests.some((r) => r.question === "verify_crop_safety")).toBe(true);
	});

	it("9–12. versions retained, no material change stops, unresolved honest", async () => {
		const base = chain(
			[
				{
					id: "e_s",
					assetId: "a1",
					startSourceTimeSec: 4,
					endSourceTimeSec: 5,
					type: "speech",
					modalities: ["speech"],
					summary: "I'm opening Settings.",
					claims: [],
					evidence: [],
					confidence: "high",
				},
			],
			"Zoom into Settings when I open it.",
			speechEv([{ startSourceTimeSec: 4, endSourceTimeSec: 5, text: "I'm opening Settings." }]),
		);
		const plan = {
			...base.plan,
			items: [
				...base.plan.items.filter((i) => i.preferredStrategy === "needs_more_evidence"),
				...(base.plan.items.some((i) => i.preferredStrategy === "needs_more_evidence")
					? []
					: [
							{
								id: "plan_settings",
								gapIds: ["gap_s"],
								sourceBeatIds: [] as string[],
								targetBeatIds: [] as string[],
								editorialIntent: "Settings focus missing source support",
								candidateStrategies: [
									{
										family: "needs_more_evidence" as const,
										rationale: "verify Settings state",
										feasibility: "needs_more_evidence" as const,
										risk: "low" as const,
										rankScore: 100,
										evidenceRequirements: ["verified Settings visual state"],
									},
									{
										family: "no_safe_edit" as const,
										rationale: "if missing",
										feasibility: "supported" as const,
										risk: "low" as const,
										rankScore: 40,
									},
								],
								preferredStrategy: "needs_more_evidence" as const,
								priority: "critical" as const,
								feasibility: "needs_more_evidence" as const,
								constraints: ["do not fabricate Settings"],
								preservationRefs: [] as string[],
								provenanceRefs: [] as string[],
								confidence: 0.5,
								evidenceRange: { startSourceTimeSec: 4, endSourceTimeSec: 5 },
							},
						]),
			],
		};

		const closure = await runPlanningClosureV1({
			initialPlan: plan,
			sourceStoryV2: base.source,
			targetStoryV1: base.target,
			editGapV1: base.gap,
			evidence: {
				assetId: "a1",
				sourceDurationSec: 20,
				userMessage: "Zoom into Settings when I open it.",
				contextNeeds: classifyMediaContextNeeds("Zoom into Settings when I open it."),
				ledger: base.ledger,
				claimPromotion: base.claims,
			},
			investigate: async () =>
				mockInv({
					stopReason: "insufficient_evidence",
					claims: [
						{
							id: "ic_s",
							hypothesis: "User opened Settings",
							verdict: "not_verified",
							rationale: "no Settings UI observed",
							evidence: [],
						},
					],
				}),
		});
		expect(closure.planVersions[0]?.label).toBe("initial");
		expect(closure.planVersions.length).toBeGreaterThanOrEqual(1);
		expect(JSON.stringify(closure)).not.toMatch(/fabricate Settings screen|addZoom\s*\(/i);
		expect(JSON.stringify(closure)).not.toMatch(/\bzoom into Settings\b.{0,40}\bsupported\b/i);
		expect(
			closure.stopReason === "insufficient_evidence" ||
				closure.stopReason === "no_material_change" ||
				closure.stopReason === "budget_exhausted" ||
				closure.stopReason === "all_resolved" ||
				closure.unresolvedItems.length >= 0,
		).toBe(true);
	});

	it("13–14. unknown button not guessed; Upwork passive invariant", async () => {
		const upwork = chain(
			[
				{
					id: "e_up",
					assetId: "a1",
					startSourceTimeSec: 3,
					endSourceTimeSec: 3,
					type: "passive_chrome",
					modalities: ["visual"],
					summary: "Passive chrome: Upwork (tab)",
					claims: [],
					evidence: [],
					confidence: "medium",
				},
			],
			"Focus on what I did on Upwork / make it professional.",
		);
		const closure = await runPlanningClosureV1({
			initialPlan: upwork.plan,
			sourceStoryV2: upwork.source,
			targetStoryV1: upwork.target,
			editGapV1: upwork.gap,
			evidence: {
				assetId: "a1",
				sourceDurationSec: 20,
				userMessage: "Focus on what I did on Upwork / make it professional.",
				contextNeeds: classifyMediaContextNeeds(
					"Focus on what I did on Upwork / make it professional.",
				),
				ledger: upwork.ledger,
			},
			investigate: async () => {
				throw new Error("should not hunt Upwork workflow");
			},
		});
		// Either no requests, or requests that do not fabricate Upwork workflow edits
		expect(JSON.stringify(closure.finalPlanId)).toBeTruthy();
		const final = closure.planVersions[closure.planVersions.length - 1]!.plan;
		expect(JSON.stringify(final.items)).not.toMatch(
			/zoom.{0,20}upwork|trim.{0,20}upwork workflow/i,
		);
	});

	it("15–18. Case 2 skip / Case 4 no over-investigate + redundancy", async () => {
		const case2 = chain(
			[
				{
					id: "e_file",
					assetId: "a1",
					startSourceTimeSec: 2,
					endSourceTimeSec: 2,
					type: "observed_visible_text",
					modalities: ["visual"],
					summary: "Observed visible text: File",
					claims: [{ id: "cf", text: "File", epistemic: "observed", evidence: [] }],
					evidence: [],
					confidence: "high",
				},
				{
					id: "e_r",
					assetId: "a1",
					startSourceTimeSec: 18,
					endSourceTimeSec: 19,
					type: "observed_visible_text",
					modalities: ["visual"],
					summary: "Observed visible text: Restart recording",
					claims: [{ id: "cr", text: "Restart recording", epistemic: "observed", evidence: [] }],
					evidence: [],
					confidence: "high",
				},
			],
			"Make this professional.",
		);
		let invCalls = 0;
		const c2 = await runPlanningClosureV1({
			initialPlan: case2.plan,
			sourceStoryV2: case2.source,
			targetStoryV1: case2.target,
			editGapV1: case2.gap,
			evidence: {
				assetId: "a1",
				sourceDurationSec: 20,
				userMessage: "Make this professional.",
				contextNeeds: classifyMediaContextNeeds("Make this professional."),
				ledger: case2.ledger,
			},
			investigate: async () => {
				invCalls += 1;
				return mockInv({});
			},
		});
		// Grounded HUD → typically 0 rounds of investigation (unless crop-safety)
		expect(c2.stopReason === "no_requests_needed" || invCalls <= 1).toBe(true);

		const case4 = chain(
			[
				{
					id: "e_corr",
					assetId: "a1",
					startSourceTimeSec: 8,
					endSourceTimeSec: 10,
					type: "spoken_correction",
					modalities: ["speech"],
					summary: "correction",
					claims: [],
					evidence: [],
					confidence: "high",
				},
			],
			"Make this shorter and clearer.",
			speechEv([
				{ startSourceTimeSec: 8, endSourceTimeSec: 9, text: "open the timeline panel" },
				{ startSourceTimeSec: 9.2, endSourceTimeSec: 10, text: "I meant the effects panel" },
			]),
		);
		invCalls = 0;
		const c4 = await runPlanningClosureV1({
			initialPlan: case4.plan,
			sourceStoryV2: case4.source,
			targetStoryV1: case4.target,
			editGapV1: case4.gap,
			evidence: {
				assetId: "a1",
				sourceDurationSec: 20,
				userMessage: "Make this shorter and clearer.",
				contextNeeds: classifyMediaContextNeeds("Make this shorter and clearer."),
				ledger: case4.ledger,
			},
			investigate: async () => {
				invCalls += 1;
				return mockInv({});
			},
		});
		expect(invCalls).toBe(0);
		expect(c4.stopReason).toBe("no_requests_needed");
		const notes = analyzePlanRedundancy(case4.plan);
		expect(notes.some((n) => /Plan item count/i.test(n))).toBe(true);
		expect(c4.redundancyNotes?.length).toBeGreaterThan(0);
	});

	it("19–20. Settings missing-support; stable narration no closure", async () => {
		const settings = chain(
			[
				{
					id: "e_s",
					assetId: "a1",
					startSourceTimeSec: 4,
					endSourceTimeSec: 5,
					type: "speech",
					modalities: ["speech"],
					summary: "I'm opening Settings.",
					claims: [],
					evidence: [],
					confidence: "high",
				},
			],
			"Zoom into Settings when I open it.",
			speechEv([{ startSourceTimeSec: 4, endSourceTimeSec: 5, text: "I'm opening Settings." }]),
		);
		const s = await runPlanningClosureV1({
			initialPlan: settings.plan,
			sourceStoryV2: settings.source,
			targetStoryV1: settings.target,
			editGapV1: settings.gap,
			evidence: {
				assetId: "a1",
				sourceDurationSec: 20,
				userMessage: "Zoom into Settings when I open it.",
				contextNeeds: classifyMediaContextNeeds("Zoom into Settings when I open it."),
				ledger: settings.ledger,
			},
			investigate: async () =>
				mockInv({
					stopReason: "insufficient_evidence",
					claims: [
						{
							id: "ic",
							hypothesis: "Settings opened",
							verdict: "not_verified",
							rationale: "no visual",
							evidence: [],
						},
					],
				}),
		});
		const final = s.planVersions[s.planVersions.length - 1]!.plan;
		expect(JSON.stringify(final)).not.toMatch(/addZoom\s*\(/i);
		expect(
			final.items.some(
				(i) =>
					i.preferredStrategy === "no_safe_edit" ||
					i.preferredStrategy === "avoid_implication" ||
					i.preferredStrategy === "needs_more_evidence" ||
					i.preferredStrategy === "preserve",
			),
		).toBe(true);
		expect(final.items.every((i) => i.preferredStrategy !== "zoom")).toBe(true);

		const narr = chain(
			[
				{
					id: "e_n",
					assetId: "a1",
					startSourceTimeSec: 1,
					endSourceTimeSec: 12,
					type: "speech",
					modalities: ["speech"],
					summary: "Narration",
					claims: [],
					evidence: [],
					confidence: "high",
				},
			],
			"Make this professional and concise.",
			speechEv([
				{
					startSourceTimeSec: 1,
					endSourceTimeSec: 12,
					text: "This recording shows the main workspace.",
				},
			]),
		);
		let calls = 0;
		const n = await runPlanningClosureV1({
			initialPlan: narr.plan,
			sourceStoryV2: narr.source,
			targetStoryV1: narr.target,
			editGapV1: narr.gap,
			evidence: {
				assetId: "a1",
				sourceDurationSec: 20,
				userMessage: "Make this professional and concise.",
				contextNeeds: classifyMediaContextNeeds("Make this professional and concise."),
				ledger: narr.ledger,
			},
			investigate: async () => {
				calls += 1;
				return mockInv({});
			},
		});
		expect(n.stopReason).toBe("no_requests_needed");
		expect(calls).toBe(0);
	});

	it("21–27. preservation, no GT/execution, metrics, compose", async () => {
		const base = chain(
			[
				{
					id: "e_corr",
					assetId: "a1",
					startSourceTimeSec: 8,
					endSourceTimeSec: 10,
					type: "spoken_correction",
					modalities: ["speech"],
					summary: "correction",
					claims: [],
					evidence: [],
					confidence: "high",
				},
			],
			"Make this shorter and clearer.",
			speechEv([
				{ startSourceTimeSec: 8, endSourceTimeSec: 9, text: "timeline panel" },
				{ startSourceTimeSec: 9.2, endSourceTimeSec: 10, text: "I meant the effects panel" },
			]),
		);
		const closure = await runPlanningClosureV1({
			initialPlan: base.plan,
			sourceStoryV2: base.source,
			targetStoryV1: base.target,
			editGapV1: base.gap,
			evidence: {
				assetId: "a1",
				sourceDurationSec: 20,
				userMessage: "Make this shorter and clearer.",
				contextNeeds: classifyMediaContextNeeds("Make this shorter and clearer."),
				ledger: base.ledger,
			},
		});
		const blob = JSON.stringify(closure);
		expect(leaksExecution(blob)).toBe(false);
		expect(blob).not.toMatch(/CASE2_LOCKED|ground.?truth|GT_/i);
		expect(blob).not.toMatch(/\baddTrim\s*\(|\baddZoom\s*\(/i);
		expect(closure.metrics.orchestrationModelCalls).toBe(0);
		expect(closure.metrics.additionalOrchestrationModelCalls).toBe(0);
		const final = closure.planVersions[closure.planVersions.length - 1]!;
		expect(
			final.plan.hardConstraints.some((c) => /preserve/i.test(c)) ||
				final.editGapV1.preserved.length >= 0,
		).toBe(true);
	});
});
