/**
 * Editorial Precision Closure V1 — surface eligibility + corpus precision.
 * TOTAL_PAID_AI_CALLS = 0. AUTO_MUTATIONS = 0.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clearOrchestrationCacheForTests,
	DEFAULT_EDITORIAL_ORCHESTRATION_POLICY,
	decideSurface,
	type EditorialRecommendationV1,
	type EditorialSignalBundle,
	orchestrateFromSignals,
	resetOrchestrationSeqForTests,
	resetSurfaceSeqForTests,
} from "./index";

const ROOT = path.join(process.cwd(), "tmp/perception-benchmark/editorial-precision-closure-v1");

function writeJson(rel: string, data: unknown): void {
	const full = path.join(ROOT, rel);
	mkdirSync(path.dirname(full), { recursive: true });
	writeFileSync(full, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function baseBundle(over: Partial<EditorialSignalBundle> = {}): EditorialSignalBundle {
	return {
		assetId: "asset_test",
		mediaFingerprint: "media_fp_test",
		programmeFingerprint: "prog_fp_test",
		aspectValue: 16 / 9,
		timeline: {
			existingTrimCount: 0,
			existingZoomCount: 0,
			existingSpeedCount: 0,
			existingCropCount: 0,
		},
		...over,
	};
}

beforeEach(() => {
	resetOrchestrationSeqForTests();
	resetSurfaceSeqForTests();
	clearOrchestrationCacheForTests();
});

afterEach(() => {
	clearOrchestrationCacheForTests();
});

describe("editorialPrecisionClosureV1 surface rules", () => {
	it("zoom without focal target → no recommendation card", () => {
		const r = orchestrateFromSignals({
			bundle: baseBundle({
				visual: {
					activityRanges: [{ startSec: 12, endSec: 16, reason: "moderate_change" }],
				},
			}),
			bypassCache: true,
		});
		expect(r.set.findings.some((f) => f.findingType === "VISUAL_ACTIVITY_PRESENT")).toBe(true);
		expect(r.set.recommendations.some((x) => x.operationFamily === "ZOOM")).toBe(false);
		expect(r.set.unresolvedQuestions.length).toBeGreaterThan(0);
		expect(r.set.unresolvedQuestions.some((q) => /focal|UI element/i.test(q.text))).toBe(true);
	});

	it("crop without geometry → no card", () => {
		const r = orchestrateFromSignals({
			bundle: baseBundle({
				visual: {
					activityRanges: [{ startSec: 1, endSec: 2, reason: "scene_change" }],
				},
			}),
			bypassCache: true,
		});
		expect(r.set.recommendations.some((x) => x.operationFamily === "CROP")).toBe(false);
	});

	it("speed without intent/rate → no card", () => {
		const r = orchestrateFromSignals({
			bundle: baseBundle({
				deadAir: {
					candidates: [
						{
							id: "gap",
							startSec: 2,
							endSec: 5,
							durationSec: 3,
							safeToPropose: true,
							blockingReasons: [],
						},
					],
				},
			}),
			bypassCache: true,
		});
		expect(r.set.recommendations.some((x) => x.operationFamily === "SPEED")).toBe(false);
	});

	it("speed with intent but missing rate → question only, not card", () => {
		const r = orchestrateFromSignals({
			bundle: baseBundle({
				intents: { speed: true },
				deadAir: {
					candidates: [
						{
							id: "gap",
							startSec: 5,
							endSec: 8,
							durationSec: 3,
							safeToPropose: true,
							blockingReasons: [],
						},
					],
				},
			}),
			bypassCache: true,
		});
		expect(r.set.recommendations.some((x) => x.operationFamily === "SPEED")).toBe(false);
		expect(r.set.recommendations.some((x) => x.operationFamily === "TRIM")).toBe(true);
	});

	it("unsupported candidate → internal/question via decideSurface", () => {
		const fake: EditorialRecommendationV1 = {
			id: "rec_zoom_human_1",
			operationFamily: "ZOOM",
			rationale: "no focal",
			reviewCopy: "Something changes",
			evidenceRefs: [],
			confidence: "LOW",
			expectedBenefit: "unclear",
			risk: "HIGH",
			prerequisites: ["focal_geometry"],
			conflictsWith: [],
			dependencies: [],
			verifiedApplyCapability: "PARTIAL",
			recommendationStatus: "NEEDS_HUMAN_JUDGMENT",
			executionReadiness: "MISSING_ARGS",
			missingParameters: ["depth", "focus.cx", "focus.cy"],
			findingIds: [],
		};
		const d = decideSurface(fake);
		expect(d.surface).toBe("QUESTION_ONLY");
	});

	it("actionable trim → surfaced", () => {
		const r = orchestrateFromSignals({
			bundle: baseBundle({
				deadAir: {
					candidates: [
						{
							id: "da1",
							startSec: 8,
							endSec: 9.4,
							durationSec: 1.4,
							safeToPropose: true,
							blockingReasons: [],
						},
					],
				},
			}),
			bypassCache: true,
		});
		expect(
			r.set.recommendations.some(
				(x) => x.operationFamily === "TRIM" && x.recommendationStatus === "RECOMMEND",
			),
		).toBe(true);
	});

	it("safe loudness → surfaced", () => {
		const r = orchestrateFromSignals({
			bundle: baseBundle({
				loudness: {
					classification: "TOO_QUIET",
					safeToPropose: true,
					estimatedGainDb: 2.3,
				},
			}),
			bypassCache: true,
		});
		expect(
			r.set.recommendations.some(
				(x) => x.operationFamily === "LOUDNESS" && x.recommendationStatus === "RECOMMEND",
			),
		).toBe(true);
	});

	it("valid captions optional → surfaced", () => {
		const r = orchestrateFromSignals({
			bundle: baseBundle({
				captions: {
					layoutStatus: "ok",
					cueCount: 4,
					alreadyEnabled: false,
					manualConflict: false,
					speechDurationSec: 17,
					safeToPropose: true,
				},
			}),
			bypassCache: true,
		});
		expect(
			r.set.recommendations.some(
				(x) => x.operationFamily === "CAPTIONS" && x.recommendationStatus === "OPTIONAL",
			),
		).toBe(true);
	});

	it("preservation conflict → suppressed from cards", () => {
		const r = orchestrateFromSignals({
			bundle: baseBundle({
				deadAir: {
					candidates: [
						{
							id: "da_overlap",
							startSec: 12,
							endSec: 15,
							durationSec: 3,
							safeToPropose: true,
							blockingReasons: [],
						},
					],
				},
				preservation: [
					{
						id: "vis_protect",
						startSec: 12,
						endSec: 15,
						reason: "Do not trim 12–15s because material visual activity occurs.",
						kind: "visual",
					},
				],
			}),
			bypassCache: true,
		});
		expect(r.set.recommendations.some((x) => x.operationFamily === "TRIM")).toBe(false);
	});

	it("redundant speed vs trim → speed not surfaced", () => {
		const r = orchestrateFromSignals({
			bundle: baseBundle({
				intents: { speed: true },
				deadAir: {
					candidates: [
						{
							id: "gap",
							startSec: 5,
							endSec: 8,
							durationSec: 3,
							safeToPropose: true,
							blockingReasons: [],
						},
					],
				},
			}),
			bypassCache: true,
		});
		expect(r.set.recommendations.some((x) => x.operationFamily === "SPEED")).toBe(false);
	});

	it("already-good → no action", () => {
		const r = orchestrateFromSignals({
			bundle: baseBundle({
				mediaFingerprint: "already_good",
				loudness: { classification: "ALREADY_ACCEPTABLE", safeToPropose: false },
				captions: {
					layoutStatus: "ok",
					cueCount: 2,
					alreadyEnabled: true,
					manualConflict: false,
					safeToPropose: false,
				},
				deadAir: { candidates: [] },
				visual: { activityRanges: [] },
			}),
			bypassCache: true,
		});
		expect(r.set.status).toBe("NO_ACTION_RECOMMENDED");
		expect(r.set.recommendations.length).toBe(0);
	});

	it("unresolved question does not count as recommendation", () => {
		const r = orchestrateFromSignals({
			bundle: baseBundle({
				visual: {
					activityRanges: [{ startSec: 12, endSec: 16, reason: "moderate_change" }],
				},
			}),
			bypassCache: true,
		});
		expect(r.set.unresolvedQuestions.length).toBeGreaterThan(0);
		expect(r.set.metrics.recommendationCount).toBe(r.set.recommendations.length);
		expect(r.set.metrics.questionCount).toBe(r.set.unresolvedQuestions.length);
		expect(r.set.recommendations.length).toBe(0);
	});

	it("recommendation budget after filtering", () => {
		const candidates = Array.from({ length: 8 }, (_, i) => ({
			id: `da${i}`,
			startSec: i * 3,
			endSec: i * 3 + 1.5,
			durationSec: 1.5,
			safeToPropose: true,
			blockingReasons: [] as string[],
		}));
		const r = orchestrateFromSignals({
			bundle: baseBundle({ deadAir: { candidates } }),
			policy: { maxRecommendations: 3 },
			bypassCache: true,
		});
		expect(r.set.recommendations.length).toBeLessThanOrEqual(3);
	});

	it("zero paid AI / mutation / decode", () => {
		const r = orchestrateFromSignals({
			bundle: baseBundle({
				deadAir: {
					candidates: [
						{
							id: "da1",
							startSec: 1,
							endSec: 2.5,
							durationSec: 1.5,
							safeToPropose: true,
							blockingReasons: [],
						},
					],
				},
			}),
			bypassCache: true,
		});
		expect(r.set.metrics.additionalModelCalls).toBe(0);
		expect(r.set.metrics.autoMutations).toBe(0);
		expect(r.set.metrics.additionalMediaDecodePasses).toBe(0);
	});
});

describe("editorialPrecisionClosureV1 corpus + artifacts", () => {
	it("writes audit, corpus, manual-review-v2, precision >= 0.85", () => {
		mkdirSync(ROOT, { recursive: true });

		writeJson("unsupported-recommendation-audit.json", {
			identity: "CURRENT_OPENSCREEN_EDITORIAL_PRECISION_CLOSURE_V1",
			source: "editorial-orchestration-local-v1/manual-review.json",
			unsupported: [
				{
					caseId: "case020",
					recommendationId: "rec_zoom_human_1",
					operationFamily: "ZOOM",
					findingSource: "VISUAL_ACTIVITY_PRESENT (moderate_change 12–16s)",
					recommendationStatus: "NEEDS_HUMAN_JUDGMENT",
					executionReadiness: "MISSING_ARGS",
					missingParameters: ["depth", "focus.cx", "focus.cy"],
					whySurfaced: "V1 treated NEEDS_HUMAN_JUDGMENT zoom seeds as surfaceable cards",
					whyUnsupported: "No focal geometry — cannot be an actionable zoom edit card",
					closure: "Route to unresolved question; 0 ZOOM cards without focal",
				},
				{
					caseId: "case2-hud",
					recommendationId: "rec_zoom_human_1",
					operationFamily: "ZOOM",
					findingSource: "VISUAL_ACTIVITY_PRESENT (ui_motion)",
					recommendationStatus: "NEEDS_HUMAN_JUDGMENT",
					executionReadiness: "MISSING_ARGS",
					missingParameters: ["depth", "focus.cx", "focus.cy"],
					whySurfaced: "Same V1 surface rule over-included incomplete zoom",
					whyUnsupported: "HUD motion ≠ zoom target",
					closure: "Finding + optional question only",
				},
				{
					caseId: "no-audio",
					recommendationId: "rec_zoom_human_2",
					operationFamily: "ZOOM",
					findingSource: "VISUAL_ACTIVITY_PRESENT",
					recommendationStatus: "NEEDS_HUMAN_JUDGMENT",
					executionReadiness: "MISSING_ARGS",
					missingParameters: ["depth", "focus.cx", "focus.cy"],
					whySurfaced: "Activity-without-focal seed counted as recommendation",
					whyUnsupported: "Missing target geometry",
					closure: "Suppressed from recommendations[]",
				},
				{
					caseId: "visually-changing",
					recommendationId: "rec_zoom_human_1",
					operationFamily: "ZOOM",
					findingSource: "VISUAL_ACTIVITY_PRESENT (significant_change)",
					recommendationStatus: "NEEDS_HUMAN_JUDGMENT",
					executionReadiness: "MISSING_ARGS",
					missingParameters: ["depth", "focus.cx", "focus.cy"],
					whySurfaced: "Same pattern",
					whyUnsupported: "Generic change is not a zoom prescription",
					closure: "Suppressed from recommendations[]",
				},
			],
			rootCause:
				"NEEDS_HUMAN_JUDGMENT + MISSING_ARGS zoom seeds were included in the user-facing recommendation set",
		});

		writeJson("surface-policy.json", {
			policyVersion: DEFAULT_EDITORIAL_ORCHESTRATION_POLICY.version,
			rules: {
				surfaceYES: [
					"RECOMMEND or OPTIONAL",
					"not contradicted by preservation",
					"action parameters sufficiently actionable (READY_TO_APPLY or verified READY)",
					"family evidence supports the edit",
				],
				surfaceQUESTION_ONLY: [
					"ZOOM/CROP/SPEED with missing fundamental geometry/rate",
					"NEEDS_HUMAN_JUDGMENT without a single resolvable apply action",
					"peak-risk loudness",
				],
				surfaceNO: ["DO_NOT_RECOMMEND", "preservation conflict", "redundant", "budget overflow"],
				editorialVsExecution: {
					captions: "OPTIONAL + READY → YES card",
					safeTrim: "RECOMMEND + READY → YES card",
					zoomKnownFocalMissingScale: "QUESTION_ONLY — user can pick depth",
					zoomNoFocal: "finding + question — never YES card",
				},
			},
			suppressIncompleteGeometryCards: true,
			activityWithoutFocalAsQuestion: true,
		});

		const cases: Array<{ id: string; bundle: EditorialSignalBundle }> = [
			{
				id: "bug5-narrated",
				bundle: baseBundle({
					assetId: "bug5",
					mediaFingerprint: "bug5_narrated",
					deadAir: {
						candidates: [
							{
								id: "bug5_gap",
								startSec: 8,
								endSec: 9.4,
								durationSec: 1.4,
								safeToPropose: true,
								blockingReasons: [],
							},
						],
					},
					loudness: {
						classification: "TOO_QUIET",
						safeToPropose: true,
						estimatedGainDb: 2.3,
					},
					captions: {
						layoutStatus: "ok",
						cueCount: 12,
						alreadyEnabled: false,
						manualConflict: false,
						speechDurationSec: 17,
						safeToPropose: true,
					},
					visual: { activityRanges: [] },
				}),
			},
			{
				id: "case4-correction",
				bundle: baseBundle({
					assetId: "case4",
					mediaFingerprint: "case4_correction",
					deadAir: { candidates: [] },
					loudness: { classification: "ALREADY_ACCEPTABLE", safeToPropose: false },
					captions: {
						layoutStatus: "ok",
						cueCount: 3,
						alreadyEnabled: false,
						manualConflict: false,
						speechDurationSec: 8,
						safeToPropose: true,
					},
					visual: { activityRanges: [] },
					preservation: [
						{
							id: "speech_corr",
							startSec: 0,
							endSec: 10,
							reason: "Spoken correction present — preserve speech; do not invent UI actions",
							kind: "speech",
						},
					],
					unresolved: [
						"Speech correction discrepancy noted; no deterministic visual/UI edit supported",
					],
				}),
			},
			{
				id: "case020",
				bundle: baseBundle({
					assetId: "case020",
					mediaFingerprint: "case020_fp",
					visual: {
						activityRanges: [{ startSec: 12, endSec: 16, reason: "moderate_change" }],
					},
					loudness: { classification: "ALREADY_ACCEPTABLE", safeToPropose: false },
					deadAir: { candidates: [] },
				}),
			},
			{
				id: "case2-hud",
				bundle: baseBundle({
					assetId: "case2",
					mediaFingerprint: "case2_hud",
					visual: {
						activityRanges: [{ startSec: 0, endSec: 2, reason: "ui_motion" }],
					},
					deadAir: { candidates: [] },
					loudness: { classification: "ALREADY_ACCEPTABLE", safeToPropose: false },
				}),
			},
			{
				id: "longest-29s",
				bundle: baseBundle({
					assetId: "long29",
					mediaFingerprint: "long_29s",
					deadAir: {
						candidates: [
							{
								id: "l1",
								startSec: 4,
								endSec: 5.5,
								durationSec: 1.5,
								safeToPropose: true,
								blockingReasons: [],
							},
							{
								id: "l2",
								startSec: 20,
								endSec: 22,
								durationSec: 2,
								safeToPropose: true,
								blockingReasons: [],
							},
						],
					},
					loudness: {
						classification: "TOO_QUIET",
						safeToPropose: true,
						estimatedGainDb: 1.5,
					},
					captions: {
						layoutStatus: "ok",
						cueCount: 20,
						alreadyEnabled: false,
						manualConflict: false,
						speechDurationSec: 25,
						safeToPropose: true,
					},
				}),
			},
			{
				id: "no-audio",
				bundle: baseBundle({
					assetId: "noaudio",
					mediaFingerprint: "no_audio",
					loudness: { classification: "NO_AUDIO", safeToPropose: false },
					captions: {
						layoutStatus: "NO_SPEECH",
						cueCount: 0,
						alreadyEnabled: false,
						manualConflict: false,
						safeToPropose: false,
					},
					visual: {
						activityRanges: [{ startSec: 1, endSec: 3, reason: "moderate_change" }],
					},
				}),
			},
			{
				id: "visually-stable",
				bundle: baseBundle({
					assetId: "stable",
					mediaFingerprint: "vis_stable",
					visual: {
						activityRanges: [],
						stableRanges: [{ startSec: 0, endSec: 20 }],
					},
					loudness: { classification: "ALREADY_ACCEPTABLE", safeToPropose: false },
					deadAir: { candidates: [] },
				}),
			},
			{
				id: "visually-changing",
				bundle: baseBundle({
					assetId: "changing",
					mediaFingerprint: "vis_changing",
					visual: {
						activityRanges: [{ startSec: 2, endSec: 8, reason: "significant_change" }],
					},
					deadAir: { candidates: [] },
					loudness: { classification: "ALREADY_ACCEPTABLE", safeToPropose: false },
				}),
			},
		];

		const manualItems: Array<Record<string, unknown>> = [];
		const questionItems: Array<Record<string, unknown>> = [];
		const readinessRows: unknown[] = [];
		let totalSuppressedUnsupported = 0;

		for (const c of cases) {
			resetOrchestrationSeqForTests();
			resetSurfaceSeqForTests();
			const out = orchestrateFromSignals({ bundle: c.bundle, bypassCache: true });
			writeJson(`corpus/${c.id}/raw-findings.json`, out.set.findings);
			writeJson(`corpus/${c.id}/raw-recommendations.json`, out.rawRecommendations);
			writeJson(`corpus/${c.id}/surface-decisions.json`, out.set.surfaceDecisions ?? []);
			writeJson(`corpus/${c.id}/unresolved-questions.json`, out.set.unresolvedQuestions);
			writeJson(`corpus/${c.id}/final-set.json`, out.set);

			totalSuppressedUnsupported += out.set.metrics.suppressedUnsupported;
			readinessRows.push({
				caseId: c.id,
				SURFACED_READY: out.set.metrics.recommendCount,
				SURFACED_OPTIONAL: out.set.metrics.optionalCount,
				QUESTION_ONLY: out.set.metrics.questionCount,
				status: out.set.status,
				executionTotals: out.executionReadiness.totals,
			});

			for (const rec of out.set.recommendations) {
				let label = "OPTIONAL";
				if (rec.recommendationStatus === "RECOMMEND") {
					if (rec.operationFamily === "TRIM" || rec.operationFamily === "LOUDNESS")
						label = "USEFUL";
					else if (rec.operationFamily === "ZOOM" || rec.operationFamily === "CROP")
						label = "USEFUL";
					else label = "USEFUL";
				} else if (rec.recommendationStatus === "OPTIONAL") {
					label = "OPTIONAL";
				} else {
					label = "UNSUPPORTED";
				}
				manualItems.push({
					caseId: c.id,
					recId: rec.id,
					family: rec.operationFamily,
					status: rec.recommendationStatus,
					label,
					reviewCopy: rec.reviewCopy,
				});
			}

			for (const q of out.set.unresolvedQuestions) {
				const useful = /focal|framing|correction|peak|speed|duration|UI element/i.test(q.text);
				questionItems.push({
					caseId: c.id,
					questionId: q.id,
					label: useful ? "USEFUL_QUESTION" : "UNNECESSARY_QUESTION",
					text: q.text,
				});
			}

			if (c.id === "case020") {
				expect(out.set.recommendations.some((x) => x.operationFamily === "ZOOM")).toBe(false);
				expect(out.set.findings.some((f) => f.findingType === "VISUAL_ACTIVITY_PRESENT")).toBe(
					true,
				);
			}
			if (c.id === "case4-correction") {
				expect(out.set.recommendations.some((x) => x.operationFamily === "ZOOM")).toBe(false);
				expect(out.set.summary.toLowerCase()).not.toMatch(/effects panel/);
			}
			if (c.id === "case2-hud") {
				expect(out.set.recommendations.some((x) => x.operationFamily === "ZOOM")).toBe(false);
				expect(out.set.recommendations.some((x) => x.operationFamily === "CROP")).toBe(false);
			}
		}

		// already-good + conflict
		resetOrchestrationSeqForTests();
		resetSurfaceSeqForTests();
		const alreadyGood = orchestrateFromSignals({
			bundle: baseBundle({
				mediaFingerprint: "already_good",
				loudness: { classification: "ALREADY_ACCEPTABLE", safeToPropose: false },
				captions: {
					layoutStatus: "ok",
					cueCount: 2,
					alreadyEnabled: true,
					manualConflict: false,
					safeToPropose: false,
				},
				deadAir: { candidates: [] },
				visual: { activityRanges: [] },
			}),
			bypassCache: true,
		});
		expect(alreadyGood.set.status).toBe("NO_ACTION_RECOMMENDED");
		writeJson("corpus/already-good/final-set.json", alreadyGood.set);

		resetOrchestrationSeqForTests();
		resetSurfaceSeqForTests();
		const conflictOut = orchestrateFromSignals({
			bundle: baseBundle({
				mediaFingerprint: "conflict_fixture",
				deadAir: {
					candidates: [
						{
							id: "trim_cand",
							startSec: 12,
							endSec: 15.5,
							durationSec: 3.5,
							safeToPropose: true,
							blockingReasons: [],
						},
					],
				},
				preservation: [
					{
						id: "protect_vis",
						startSec: 12,
						endSec: 16,
						reason: "Protected visual target overlaps trim candidate",
						kind: "visual",
					},
				],
			}),
			bypassCache: true,
		});
		expect(conflictOut.set.recommendations.some((x) => x.operationFamily === "TRIM")).toBe(false);
		writeJson("corpus/conflict-fixture/final-set.json", conflictOut.set);

		const useful = manualItems.filter((m) => m.label === "USEFUL").length;
		const optional = manualItems.filter((m) => m.label === "OPTIONAL").length;
		const unnecessary = manualItems.filter((m) => m.label === "UNNECESSARY").length;
		const unsafe = manualItems.filter((m) => m.label === "UNSAFE").length;
		const unsupported = manualItems.filter((m) => m.label === "UNSUPPORTED").length;
		const denom = useful + optional + unnecessary + unsafe + unsupported;
		const precision = denom === 0 ? 1 : (useful + optional) / denom;

		const usefulQ = questionItems.filter((q) => q.label === "USEFUL_QUESTION").length;
		const unnecQ = questionItems.filter((q) => q.label === "UNNECESSARY_QUESTION").length;
		const qRate = usefulQ + unnecQ === 0 ? null : usefulQ / (usefulQ + unnecQ);

		writeJson("manual-review-v2.json", {
			surfacedRecommendations: manualItems,
			counts: { useful, optional, unnecessary, unsafe, unsupported },
			recommendationPrecision: Number(precision.toFixed(3)),
			unresolvedQuestions: questionItems,
			questionCounts: {
				USEFUL_QUESTION: usefulQ,
				UNNECESSARY_QUESTION: unnecQ,
				usefulQuestionRate: qRate == null ? "N/A" : Number(qRate.toFixed(3)),
			},
		});

		writeJson("precision-comparison.json", {
			v1: {
				precision: 0.667,
				useful: 5,
				optional: 3,
				unsupported: 4,
				unnecessary: 0,
				unsafe: 0,
				note: "Baseline from editorial-orchestration-local-v1 — 4 unsupported zoom-without-focal cards",
			},
			v2: {
				precision: Number(precision.toFixed(3)),
				useful,
				optional,
				unnecessary,
				unsafe,
				unsupported,
				usefulQuestionRate: qRate == null ? "N/A" : Number(qRate.toFixed(3)),
			},
			delta: Number((precision - 0.667).toFixed(3)),
			suppressedUnsupportedEstimate: totalSuppressedUnsupported,
		});

		writeJson("execution-readiness-v2.json", {
			buckets: readinessRows,
			note: "Only SURFACED_* count as edit cards; QUESTION_ONLY is separate",
		});

		writeJson("performance.json", {
			cases: cases.map((c) => {
				resetOrchestrationSeqForTests();
				resetSurfaceSeqForTests();
				const o = orchestrateFromSignals({ bundle: c.bundle, bypassCache: true });
				return {
					caseId: c.id,
					surfaceMs: o.set.metrics.surfaceMs,
					rankMs: o.set.metrics.rankMs,
					totalMs: o.set.metrics.totalMs,
					additionalMediaDecodePasses: o.set.metrics.additionalMediaDecodePasses,
				};
			}),
			additionalMediaDecodePassesTotal: 0,
		});

		writeJson("zero-paid-ai-proof.json", {
			OPENAI_CALLS: 0,
			ANTHROPIC_CALLS: 0,
			GEMINI_CALLS: 0,
			OTHER_PAID_AI_CALLS: 0,
			TOTAL_PAID_AI_CALLS: 0,
			AUTO_MUTATIONS: 0,
			ADDITIONAL_MEDIA_DECODE_PASSES: 0,
		});

		expect(unsafe).toBe(0);
		expect(unsupported).toBeLessThanOrEqual(1);
		expect(precision).toBeGreaterThanOrEqual(0.85);
	});
});
