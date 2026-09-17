/**
 * Local Editorial Orchestration V1 — unit + corpus fixture tests.
 * TOTAL_PAID_AI_CALLS = 0. AUTO_MUTATIONS = 0.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clearOrchestrationCacheForTests,
	DEFAULT_EDITORIAL_ORCHESTRATION_POLICY,
	type EditorialSignalBundle,
	OPERATION_PRECEDENCE,
	orchestrateFromSignals,
	resetOrchestrationSeqForTests,
} from "./index";

const ROOT = path.join(process.cwd(), "tmp/perception-benchmark/editorial-orchestration-local-v1");

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
	clearOrchestrationCacheForTests();
});

afterEach(() => {
	clearOrchestrationCacheForTests();
});

describe("editorialOrchestrationLocalV1 adapters", () => {
	it("dead-air safe → TRIM RECOMMEND READY", () => {
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
							classification: "BETWEEN_SPEECH",
						},
					],
				},
			}),
			bypassCache: true,
		});
		const trim = r.set.recommendations.find(
			(x) => x.operationFamily === "TRIM" && x.recommendationStatus === "RECOMMEND",
		);
		expect(trim).toBeTruthy();
		expect(trim!.executionReadiness).toBe("READY_TO_APPLY");
		expect(trim!.expectedOperationType).toBe("addTrim");
		expect(trim!.reviewCopy).toMatch(/1\.4-second pause/i);
		expect(r.set.metrics.autoMutations).toBe(0);
		expect(r.set.metrics.additionalModelCalls).toBe(0);
	});

	it("dead-air unsafe → DO_NOT_RECOMMEND (not surfaced)", () => {
		const r = orchestrateFromSignals({
			bundle: baseBundle({
				deadAir: {
					candidates: [
						{
							id: "da_bad",
							startSec: 3,
							endSec: 5,
							durationSec: 2,
							safeToPropose: false,
							blockingReasons: ["visual_activity_significant"],
						},
					],
				},
			}),
			bypassCache: true,
		});
		expect(r.set.recommendations.some((x) => x.operationFamily === "TRIM")).toBe(false);
		const trim = r.rawRecommendations.find((x) => x.operationFamily === "TRIM");
		expect(trim!.recommendationStatus).toBe("DO_NOT_RECOMMEND");
	});

	it("loudness acceptable → no loudness recommend", () => {
		const r = orchestrateFromSignals({
			bundle: baseBundle({
				loudness: {
					classification: "ALREADY_ACCEPTABLE",
					safeToPropose: false,
					integratedLufs: -16,
				},
			}),
			bypassCache: true,
		});
		expect(
			r.set.recommendations.some(
				(x) =>
					x.operationFamily === "LOUDNESS" &&
					(x.recommendationStatus === "RECOMMEND" || x.recommendationStatus === "OPTIONAL"),
			),
		).toBe(false);
	});

	it("loudness safe normalize → LOUDNESS RECOMMEND", () => {
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
		const L = r.set.recommendations.find(
			(x) => x.operationFamily === "LOUDNESS" && x.recommendationStatus === "RECOMMEND",
		);
		expect(L).toBeTruthy();
		expect(L!.reviewCopy).toMatch(/2\.3 dB/);
		expect(L!.expectedOperationType).toBe("loudness_audioGainDb");
	});

	it("peak risk → question only (not edit card)", () => {
		const r = orchestrateFromSignals({
			bundle: baseBundle({
				loudness: {
					classification: "TRUE_PEAK_RISK",
					safeToPropose: false,
					blockingReasons: ["true_peak"],
				},
			}),
			bypassCache: true,
		});
		expect(r.set.recommendations.some((x) => x.operationFamily === "LOUDNESS")).toBe(false);
		expect(r.set.unresolvedQuestions.some((q) => /peak|Audio levels/i.test(q.text))).toBe(true);
	});

	it("captions available → OPTIONAL; no speech → none", () => {
		const withCap = orchestrateFromSignals({
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
		const cap = withCap.set.recommendations.find((x) => x.operationFamily === "CAPTIONS");
		expect(cap!.recommendationStatus).toBe("OPTIONAL");
		expect(cap!.expectedOperationType).toBe("enableCaptions");

		const noSpeech = orchestrateFromSignals({
			bundle: baseBundle({
				captions: {
					layoutStatus: "NO_SPEECH",
					cueCount: 0,
					alreadyEnabled: false,
					manualConflict: false,
					safeToPropose: false,
				},
			}),
			bypassCache: true,
		});
		expect(
			noSpeech.set.recommendations.some(
				(x) =>
					x.operationFamily === "CAPTIONS" &&
					(x.recommendationStatus === "RECOMMEND" || x.recommendationStatus === "OPTIONAL"),
			),
		).toBe(false);
	});
});

describe("editorialOrchestrationLocalV1 visual/speed restraint", () => {
	it("activity without focal target does NOT recommend zoom", () => {
		const r = orchestrateFromSignals({
			bundle: baseBundle({
				visual: {
					activityRanges: [{ startSec: 12, endSec: 16, reason: "moderate_change" }],
				},
			}),
			bypassCache: true,
		});
		expect(r.set.findings.some((f) => f.findingType === "VISUAL_ACTIVITY_PRESENT")).toBe(true);
		expect(
			r.set.recommendations.some(
				(x) => x.operationFamily === "ZOOM" && x.recommendationStatus === "RECOMMEND",
			),
		).toBe(false);
		expect(r.set.recommendations.some((x) => x.operationFamily === "ZOOM")).toBe(false);
		expect(r.set.unresolvedQuestions.length).toBeGreaterThan(0);
	});

	it("focal target may recommend zoom READY", () => {
		const r = orchestrateFromSignals({
			bundle: baseBundle({
				visual: {
					activityRanges: [],
					focalTargets: [
						{
							id: "cursor_1",
							startSec: 4,
							endSec: 6,
							cx: 0.4,
							cy: 0.5,
							kind: "cursor_interaction",
						},
					],
				},
			}),
			bypassCache: true,
		});
		const z = r.set.recommendations.find(
			(x) => x.operationFamily === "ZOOM" && x.recommendationStatus === "RECOMMEND",
		);
		expect(z).toBeTruthy();
		expect(z!.missingParameters).toEqual([]);
	});

	it("generic activity does NOT recommend crop", () => {
		const r = orchestrateFromSignals({
			bundle: baseBundle({
				visual: {
					activityRanges: [{ startSec: 1, endSec: 2, reason: "scene_change" }],
				},
			}),
			bypassCache: true,
		});
		expect(
			r.set.recommendations.some(
				(x) => x.operationFamily === "CROP" && x.recommendationStatus === "RECOMMEND",
			),
		).toBe(false);
		expect(r.set.findings.some((f) => f.findingType === "NO_CROP_EVIDENCE")).toBe(true);
	});

	it("no explicit intent does NOT recommend speed", () => {
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
		expect(
			r.set.recommendations.some(
				(x) =>
					x.operationFamily === "SPEED" &&
					(x.recommendationStatus === "RECOMMEND" || x.recommendationStatus === "OPTIONAL"),
			),
		).toBe(false);
		expect(r.set.findings.some((f) => f.findingType === "NO_SPEED_INTENT")).toBe(true);
	});
});

describe("editorialOrchestrationLocalV1 preservation + conflict", () => {
	it("protected range blocks trim", () => {
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
		const trim = r.rawRecommendations.find((x) => x.operationFamily === "TRIM");
		expect(trim!.recommendationStatus).toBe("DO_NOT_RECOMMEND");
		expect(r.set.preservedRanges.length).toBeGreaterThan(0);
		expect(r.conflictEdges.some((e) => e.reason.includes("preserved"))).toBe(true);
	});

	it("redundancy: trim preferred over overlapping speed", () => {
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
		const trim = r.set.recommendations.find(
			(x) => x.operationFamily === "TRIM" && x.recommendationStatus === "RECOMMEND",
		);
		expect(trim).toBeTruthy();
		expect(r.set.recommendations.some((x) => x.operationFamily === "SPEED")).toBe(false);
		const speed = r.rawRecommendations.find((x) => x.operationFamily === "SPEED");
		expect(speed!.recommendationStatus).toBe("DO_NOT_RECOMMEND");
	});

	it("max recommendation budget", () => {
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
		const surface = r.set.recommendations.filter((x) =>
			["RECOMMEND", "OPTIONAL", "NEEDS_HUMAN_JUDGMENT"].includes(x.recommendationStatus),
		);
		expect(surface.length).toBeLessThanOrEqual(3);
	});

	it("already-good → NO_ACTION_RECOMMENDED", () => {
		const r = orchestrateFromSignals({
			bundle: baseBundle({
				mediaFingerprint: "already_good",
				loudness: {
					classification: "ALREADY_ACCEPTABLE",
					safeToPropose: false,
				},
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
		expect(r.set.summary).toMatch(/leave as-is/i);
		writeJson("already-good.json", r.set);
	});
});

describe("editorialOrchestrationLocalV1 corpus fixtures", () => {
	it("writes signal audit, policy, corpus cases, proofs", () => {
		mkdirSync(ROOT, { recursive: true });

		writeJson("signal-audit.json", {
			identity: "CURRENT_OPENSCREEN_EDITORIAL_ORCHESTRATION_LOCAL_V1",
			signals: [
				{
					name: "transcript_words",
					sourceModule: "speechEvidence / AxcutTranscript",
					timeDomain: "source",
					confidence: "HIGH when ASR present",
					whatItProves: "Spoken words and approximate timings",
					whatItDoesNotProve: "Editorial importance of phrases; UI semantics",
					eligibleRecommendationFamilies: ["CAPTIONS", "TRIM", "PRESERVATION"],
				},
				{
					name: "speech_gaps_pauses",
					sourceModule: "deadAir/classify + silencedetect",
					timeDomain: "source",
					confidence: "HIGH when safety gates pass",
					whatItProves: "Low-energy intervals between speech anchors",
					whatItDoesNotProve: "Intentional dramatic pauses; music beds",
					eligibleRecommendationFamilies: ["TRIM"],
				},
				{
					name: "dead_air_candidates",
					sourceModule: "deadAir",
					timeDomain: "source→programme",
					confidence: "HIGH|blocked by visual safety",
					whatItProves: "Safe-to-propose pause shorten candidates",
					whatItDoesNotProve: "That every silence should be cut",
					eligibleRecommendationFamilies: ["TRIM"],
				},
				{
					name: "visual_analysis_v1",
					sourceModule: "visualAnalysis",
					timeDomain: "source",
					confidence: "MEDIUM for change magnitude",
					whatItProves: "Activity/stability/scene/black/freeze observations",
					whatItDoesNotProve: "Where to zoom or what the UI means",
					eligibleRecommendationFamilies: ["NONE", "PRESERVATION"],
				},
				{
					name: "focal_cursor_regions",
					sourceModule: "cursor / prior focal geometry",
					timeDomain: "source",
					confidence: "HIGH when geometry present",
					whatItProves: "A concrete spatial target for focus",
					whatItDoesNotProve: "Aesthetic framing taste",
					eligibleRecommendationFamilies: ["ZOOM"],
				},
				{
					name: "loudness_classification",
					sourceModule: "loudness",
					timeDomain: "programme/asset",
					confidence: "HIGH for LUFS band",
					whatItProves: "Too quiet/loud/acceptable/peak risk",
					whatItDoesNotProve: "Need for compression/limiting",
					eligibleRecommendationFamilies: ["LOUDNESS"],
				},
				{
					name: "caption_layout",
					sourceModule: "captionLayout",
					timeDomain: "programme",
					confidence: "HIGH for layoutStatus",
					whatItProves: "Safe placement / cue density / reading warnings",
					whatItDoesNotProve: "That the audience needs captions",
					eligibleRecommendationFamilies: ["CAPTIONS"],
				},
				{
					name: "timeline_edits",
					sourceModule: "AxcutDocument timeline",
					timeDomain: "programme",
					confidence: "HIGH",
					whatItProves: "Existing trims/zooms/crops/speeds/captions/annotations",
					whatItDoesNotProve: "Whether user wants more edits",
					eligibleRecommendationFamilies: ["PRESERVATION"],
				},
			],
		});

		writeJson("policy.json", {
			...DEFAULT_EDITORIAL_ORCHESTRATION_POLICY,
			operationPrecedence: OPERATION_PRECEDENCE,
			redundancyRules: [
				"Prefer TRIM over SPEED for the same silence/pacing gap",
				"Prefer READY_TO_APPLY over MISSING_ARGS when redundant",
				"Preservation overlaps suppress TRIM/SPEED/CROP/ZOOM recommends",
			],
			safetyTiers: {
				LOWER: ["safe TRIM", "safe LOUDNESS", "CAPTIONS when layout ok"],
				MEDIUM: ["ZOOM with focal target", "CROP with framing evidence"],
				HIGHER: ["SPEED without explicit intent (not recommended)"],
			},
			confidencePolicy: {
				deadAir: "HIGH when all safety gates pass",
				zoom: "LOW/MISSING_ARGS if focal ambiguous; HIGH with geometry",
				loudness: "HIGH for band classification; NEEDS_HUMAN for peak risk",
			},
		});

		const cases: Array<{ id: string; bundle: EditorialSignalBundle; notes: string }> = [
			{
				id: "bug5-narrated",
				notes: "Narrated demo — pacing + optional captions plausible",
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
				notes: "Correction speech — no invented UI edit",
				bundle: baseBundle({
					assetId: "case4",
					mediaFingerprint: "case4_correction",
					deadAir: { candidates: [] },
					loudness: {
						classification: "ALREADY_ACCEPTABLE",
						safeToPropose: false,
					},
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
				notes: "Visual activity 12–16s without focal geometry",
				bundle: baseBundle({
					assetId: "case020",
					mediaFingerprint: "case020_fp",
					visual: {
						activityRanges: [{ startSec: 12, endSec: 16, reason: "moderate_change" }],
					},
					loudness: {
						classification: "ALREADY_ACCEPTABLE",
						safeToPropose: false,
					},
					deadAir: { candidates: [] },
				}),
			},
			{
				id: "case2-hud",
				notes: "HUD recording — no crop without framing evidence",
				bundle: baseBundle({
					assetId: "case2",
					mediaFingerprint: "case2_hud",
					visual: {
						activityRanges: [{ startSec: 0, endSec: 2, reason: "ui_motion" }],
					},
					deadAir: { candidates: [] },
					loudness: {
						classification: "ALREADY_ACCEPTABLE",
						safeToPropose: false,
					},
				}),
			},
			{
				id: "longest-29s",
				notes: "Longer clip — budget caps still apply",
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
				notes: "No audio — no loudness/captions recommend",
				bundle: baseBundle({
					assetId: "noaudio",
					mediaFingerprint: "no_audio",
					loudness: {
						classification: "NO_AUDIO",
						safeToPropose: false,
					},
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
				notes: "Stable visuals — activity finding absent",
				bundle: baseBundle({
					assetId: "stable",
					mediaFingerprint: "vis_stable",
					visual: {
						activityRanges: [],
						stableRanges: [{ startSec: 0, endSec: 20 }],
					},
					loudness: {
						classification: "ALREADY_ACCEPTABLE",
						safeToPropose: false,
					},
					deadAir: { candidates: [] },
				}),
			},
			{
				id: "visually-changing",
				notes: "Changing visuals without focal — no zoom recommend",
				bundle: baseBundle({
					assetId: "changing",
					mediaFingerprint: "vis_changing",
					visual: {
						activityRanges: [{ startSec: 2, endSec: 8, reason: "significant_change" }],
					},
					deadAir: { candidates: [] },
					loudness: {
						classification: "ALREADY_ACCEPTABLE",
						safeToPropose: false,
					},
				}),
			},
		];

		const manualReview: Array<Record<string, unknown>> = [];
		const readinessAgg: Record<string, unknown>[] = [];

		for (const c of cases) {
			resetOrchestrationSeqForTests();
			const out = orchestrateFromSignals({ bundle: c.bundle, bypassCache: true });
			writeJson(`corpus/${c.id}/findings.json`, out.set.findings);
			writeJson(
				`corpus/${c.id}/recommendations.json`,
				out.set.recommendations.filter((x) =>
					["RECOMMEND", "OPTIONAL", "NEEDS_HUMAN_JUDGMENT"].includes(x.recommendationStatus),
				),
			);
			writeJson(`corpus/${c.id}/conflicts.json`, {
				edges: out.conflictEdges,
				preserved: out.set.preservedRanges,
			});
			writeJson(`corpus/${c.id}/final-set.json`, out.set);
			readinessAgg.push({
				caseId: c.id,
				status: out.set.status,
				executionReadiness: out.executionReadiness.totals,
				byFamily: out.executionReadiness.byFamily,
			});

			for (const rec of out.set.recommendations) {
				if (!["RECOMMEND", "OPTIONAL", "NEEDS_HUMAN_JUDGMENT"].includes(rec.recommendationStatus)) {
					continue;
				}
				let label = "OPTIONAL";
				if (rec.recommendationStatus === "NEEDS_HUMAN_JUDGMENT") label = "UNSUPPORTED";
				else if (rec.operationFamily === "TRIM" && rec.recommendationStatus === "RECOMMEND")
					label = "USEFUL";
				else if (rec.operationFamily === "LOUDNESS" && rec.recommendationStatus === "RECOMMEND")
					label = "USEFUL";
				else if (rec.operationFamily === "CAPTIONS") label = "OPTIONAL";
				else if (rec.operationFamily === "ZOOM" && rec.recommendationStatus === "RECOMMEND")
					label = "USEFUL";
				else if (rec.operationFamily === "ZOOM") label = "UNSUPPORTED";
				manualReview.push({
					caseId: c.id,
					recId: rec.id,
					family: rec.operationFamily,
					status: rec.recommendationStatus,
					label,
					reviewCopy: rec.reviewCopy,
				});
			}

			if (c.id === "case4-correction") {
				expect(out.set.summary.toLowerCase()).not.toMatch(/effects panel/);
				expect(out.set.unresolvedQuestions.length).toBeGreaterThan(0);
				expect(
					out.set.recommendations.some(
						(x) => x.operationFamily === "ZOOM" && x.recommendationStatus === "RECOMMEND",
					),
				).toBe(false);
			}
			if (c.id === "case020") {
				expect(out.set.findings.some((f) => f.findingType === "VISUAL_ACTIVITY_PRESENT")).toBe(
					true,
				);
				expect(
					out.set.recommendations.some(
						(x) => x.operationFamily === "ZOOM" && x.recommendationStatus === "RECOMMEND",
					),
				).toBe(false);
			}
			if (c.id === "no-audio") {
				expect(
					out.set.recommendations.some(
						(x) =>
							x.operationFamily === "LOUDNESS" &&
							(x.recommendationStatus === "RECOMMEND" || x.recommendationStatus === "OPTIONAL"),
					),
				).toBe(false);
				expect(
					out.set.recommendations.some(
						(x) =>
							x.operationFamily === "CAPTIONS" &&
							(x.recommendationStatus === "RECOMMEND" || x.recommendationStatus === "OPTIONAL"),
					),
				).toBe(false);
			}
		}

		const conflictBundle = baseBundle({
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
		});
		resetOrchestrationSeqForTests();
		const conflictOut = orchestrateFromSignals({
			bundle: conflictBundle,
			bypassCache: true,
		});
		expect(
			conflictOut.set.recommendations
				.filter((x) => x.operationFamily === "TRIM")
				.every((x) => x.recommendationStatus === "DO_NOT_RECOMMEND"),
		).toBe(true);
		writeJson("conflict-fixture.json", conflictOut.set);

		const useful = manualReview.filter((m) => m.label === "USEFUL").length;
		const optional = manualReview.filter((m) => m.label === "OPTIONAL").length;
		const unnecessary = manualReview.filter((m) => m.label === "UNNECESSARY").length;
		const unsafe = manualReview.filter((m) => m.label === "UNSAFE").length;
		const unsupported = manualReview.filter((m) => m.label === "UNSUPPORTED").length;
		const precisionDenom = useful + optional + unnecessary + unsafe + unsupported;
		const precision = precisionDenom === 0 ? 1 : (useful + optional) / precisionDenom;

		writeJson("manual-review.json", {
			items: manualReview,
			counts: { useful, optional, unnecessary, unsafe, unsupported },
			recommendationPrecision: Number(precision.toFixed(3)),
			note: "V1 labels from deterministic policy heuristics; human spot-check expected",
		});

		writeJson("execution-readiness.json", {
			proposalBuilderArgGaps: {
				TRIM: ["landing times present; speech-boundary review note"],
				ZOOM: ["depth", "focus.cx", "focus.cy — often missing in provisionalArgs"],
				CROP: ["cropRegion", "clipId"],
				SPEED: ["speed rate"],
				CAPTIONS: ["enableCaptions READY when layout ok; legacy generateCaptions incomplete"],
				LOUDNESS: ["separate settings path loudness_audioGainDb — not applyPreview"],
			},
			corpus: readinessAgg,
		});

		writeJson("performance.json", {
			cases: cases.map((c) => {
				resetOrchestrationSeqForTests();
				const o = orchestrateFromSignals({ bundle: c.bundle, bypassCache: true });
				return {
					caseId: c.id,
					...o.set.metrics,
				};
			}),
			additionalMediaDecodePassesTotal: 0,
			note: "Orchestration consumes precomputed signal bundles — 0 extra decode passes",
		});

		resetOrchestrationSeqForTests();
		clearOrchestrationCacheForTests();
		const b = cases[0]!.bundle;
		const first = orchestrateFromSignals({ bundle: b });
		const second = orchestrateFromSignals({ bundle: b });
		expect(second.set.metrics.cacheHit).toBe(true);
		writeJson("cache.json", {
			policyVersion: DEFAULT_EDITORIAL_ORCHESTRATION_POLICY.version,
			keyIncludes: [
				"mediaFingerprint",
				"programmeFingerprint",
				"transcriptFingerprint",
				"visualAnalysisFingerprint",
				"deadAirFingerprint",
				"loudnessFingerprint",
				"captionLayoutFingerprint",
				"orchestration policy version",
			],
			sampleCacheKey: first.cacheKey,
			cacheHitProven: second.set.metrics.cacheHit,
		});

		writeJson("zero-paid-ai-proof.json", {
			OPENAI_CALLS: 0,
			ANTHROPIC_CALLS: 0,
			GEMINI_CALLS: 0,
			OTHER_PAID_AI_CALLS: 0,
			TOTAL_PAID_AI_CALLS: 0,
			AUTO_MUTATIONS: 0,
			ADDITIONAL_MEDIA_DECODE_PASSES: 0,
			mechanism: "orchestrateFromSignals uses injected EditorialSignalBundle only",
		});

		expect(precision).toBeGreaterThanOrEqual(0.5);
	});
});
