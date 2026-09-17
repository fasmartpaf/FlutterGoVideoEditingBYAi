/**
 * Local Professional Editorial Planner V1 — deterministic corpus A–M.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { patchCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import type { DeadAirCandidateV1 } from "../deadAir";
import { VISUAL_SAFETY_VERSION } from "../deadAir/visualActivityTypes";
import type {
	EditorialFocalAnalysisBundleV1,
	VisualChangeIntervalV1,
} from "../editorialFocalEvidence";
import { parseProfessionalEditIntent } from "../professionalEditOrchestrator/intent";
import { buildPackedEditorialTranscript } from "../professionalEditOrchestrator/packedTranscript";
import { buildProfessionalEditStory } from "../professionalEditOrchestrator/story";
import {
	planProfessionalEditorialOpportunities,
	resetPlannerOpportunitySeqForTests,
} from "./index";

const OUT = join(process.cwd(), "tmp/perception-benchmark/local-professional-editorial-planner-v1");

function write(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	writeFileSync(join(OUT, name), JSON.stringify(data, null, 2), "utf8");
}

function fixtureDoc(durationSec = 20, captionsOn = false): AxcutDocument {
	const base = createEmptyDocument({
		title: "PlannerCorpus",
		projectId: "proj_planner",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	let doc = documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "rec.mp4",
				originalPath: "/tmp/planner.mp4",
				durationSec,
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
		},
		transcripts: [
			{
				assetId: "asset_1",
				language: "en",
				segments: [
					{
						id: "seg1",
						kind: "speech",
						startSec: 0.5,
						endSec: 4,
						text: "Here is the important explanation",
						wordIds: ["w0", "w1"],
					},
					{
						id: "seg2",
						kind: "speech",
						startSec: 10,
						endSec: 12,
						text: "And the result",
						wordIds: ["w2", "w3"],
					},
				],
				words: [
					{ id: "w0", segmentId: "seg1", startSec: 0.5, endSec: 2, text: "Here", source: "asr" },
					{
						id: "w1",
						segmentId: "seg1",
						startSec: 2,
						endSec: 4,
						text: "explanation",
						source: "asr",
					},
					{ id: "w2", segmentId: "seg2", startSec: 10, endSec: 11, text: "And", source: "asr" },
					{
						id: "w3",
						segmentId: "seg2",
						startSec: 11,
						endSec: 12,
						text: "result",
						source: "asr",
					},
				],
			},
		],
	});
	if (captionsOn) {
		doc = patchCaptionSettings(doc, { enabled: true }, 16 / 9);
	}
	return doc;
}

function shortPause(id: string, start: number, end: number): DeadAirCandidateV1 {
	return {
		id,
		assetId: "asset_1",
		silenceRange: { timebase: "SOURCE_MEDIA_TIME", startSec: start, endSec: end },
		proposedTrimRange: null,
		silenceDurationSec: end - start,
		resultingRemovedDurationSec: 0,
		classification: "TOO_SHORT",
		confidence: "medium",
		evidenceRefs: [],
		speechBoundaryState: {
			before: { kind: "speech_segment", id: "seg1", text: "before" },
			after: { kind: "speech_segment", id: "seg2", text: "after" },
			blocking: false,
		},
		paddingBeforeSec: 0.2,
		paddingAfterSec: 0.35,
		targetPauseKeptSec: 0.55,
		preserveConstraints: [],
		safeToPropose: false,
		blockingReasons: ["silence_below_candidate_threshold"],
		visualActivity: [],
		visualActivityState: "NO_MATERIAL_VISUAL_ACTIVITY",
		visualEvidenceRefs: [],
		visualBlockingReasons: [],
		visualSafetyVersion: VISUAL_SAFETY_VERSION,
		warnings: [],
	};
}

function safeTrim(id: string, start: number, end: number, removed: number): DeadAirCandidateV1 {
	return {
		...shortPause(id, start, end),
		classification: "POSSIBLE_DEAD_AIR",
		confidence: "high",
		safeToPropose: true,
		blockingReasons: [],
		proposedTrimRange: {
			timebase: "SOURCE_MEDIA_TIME",
			startSec: start + 0.2,
			endSec: end - 0.35,
		},
		resultingRemovedDurationSec: removed,
		silenceDurationSec: end - start,
	};
}

function emptyFocal(): EditorialFocalAnalysisBundleV1 {
	return {
		version: 1,
		providerId: "CURRENT_OPENSCREEN_LOCAL_EDITORIAL_FOCAL_EVIDENCE_V1",
		sourceFingerprint: "fp",
		coverage: {
			cursor: "NOT_AVAILABLE",
			visual: "NOT_AVAILABLE",
			ocr: "NOT_AVAILABLE",
			focal: "NOT_AVAILABLE",
		},
		evidence: [],
		targets: [],
		investigations: [],
		zoomDecision: {
			decision: "NO_ZOOM_RECOMMENDED",
			reasonCode: "INSUFFICIENT_EVIDENCE",
			targetId: null,
			geometry: null,
			notes: [],
		},
		cropDecision: {
			decision: "NO_CROP_RECOMMENDED",
			reasonCode: "NO_ASPECT_FRAMING_REASON",
			targetId: null,
			notes: [],
		},
		metrics: { paidAiCalls: 0, buildMs: 0, additionalDecodePasses: 0 },
	};
}

function groundedZoomFocal(useful = true): EditorialFocalAnalysisBundleV1 {
	const base = emptyFocal();
	const start = useful ? 3 : 15;
	const end = useful ? 4.5 : 16;
	return {
		...base,
		coverage: { ...base.coverage, cursor: "AVAILABLE", focal: "AVAILABLE" },
		targets: [
			{
				targetId: "tgt_1",
				status: "GROUNDED",
				sourceRange: { startSec: start, endSec: end },
				normalizedRegion: { x: 0.35, y: 0.45, width: 0.2, height: 0.2 },
				focalPoint: { cx: 0.42, cy: 0.55 },
				confidence: "HIGH",
				reasonCode: useful ? "CLICK_DWELL" : "CLUSTER_ONLY",
				evidenceFamilies: useful ? ["CURSOR_CLICK", "CURSOR_DWELL"] : ["CURSOR_CLUSTER"],
				evidenceIds: ["e1"],
				stability: "STABLE",
				sourceFingerprint: "fp",
				survivesCurrentPlayback: true,
			},
		],
		zoomDecision: {
			decision: "ZOOM_ELIGIBLE",
			reasonCode: "GROUNDED_EMPHASIS",
			targetId: "tgt_1",
			geometry: {
				depth: 2,
				focalPoint: { cx: 0.42, cy: 0.55 },
				sourceStartSec: start,
				sourceEndSec: end,
				scale: 1.6,
				visibleWindow: { x: 0.2, y: 0.3, width: 0.5, height: 0.5 },
			},
			notes: [],
		},
	};
}

beforeEach(() => {
	resetPlannerOpportunitySeqForTests();
});

describe("LOCAL_PROFESSIONAL_EDITORIAL_PLANNER_V1 corpus", () => {
	const intent = parseProfessionalEditIntent("Make this video professional. You decide.");

	function run(args: {
		doc?: AxcutDocument;
		deadAir?: DeadAirCandidateV1[];
		focal?: EditorialFocalAnalysisBundleV1 | null;
		visual?: VisualChangeIntervalV1[];
		duration?: number;
		captionsLayoutOk?: boolean;
		cueCount?: number;
		framingCrop?: {
			x: number;
			y: number;
			width: number;
			height: number;
			clipId: string;
		} | null;
		aspectFramingRequired?: boolean;
	}) {
		const duration = args.duration ?? 20;
		const document = args.doc ?? fixtureDoc(duration);
		const packed = buildPackedEditorialTranscript({
			document,
			assetId: "asset_1",
			sourceDurationSec: duration,
			deadAirCandidates: args.deadAir ?? [],
		});
		const story = buildProfessionalEditStory({ packed, intent });
		return planProfessionalEditorialOpportunities({
			document,
			assetId: "asset_1",
			intent,
			packed,
			story,
			deadAir: args.deadAir ?? [],
			focal: args.focal ?? emptyFocal(),
			visualIntervals: args.visual ?? [],
			sourceDurationSec: duration,
			captionsLayoutOk: args.captionsLayoutOk ?? true,
			captionCueCount: args.cueCount ?? 4,
			framingCrop: args.framingCrop ?? null,
			aspectFramingRequired: args.aspectFramingRequired,
		});
	}

	it("A already-good: no unnecessary READY ops when captions on + no safe trim/speed/zoom", () => {
		const r = run({
			doc: fixtureDoc(12, true),
			deadAir: [shortPause("p1", 5, 5.8)],
			visual: [],
			duration: 12,
			cueCount: 0,
		});
		expect(r.metrics.temporalContextConsumed).toBe(true);
		expect(r.temporalPacketSummary?.consumed).toBe(true);
		expect(r.ready.filter((o) => o.family !== "LOUDNESS")).toHaveLength(0);
		write("corpus-A-already-good.json", {
			ready: r.ready.map((o) => o.family),
			statuses: r.opportunities.map((o) => [o.family, o.generationStatus]),
		});
	});

	it("B short natural pause during explanation → KEEP", () => {
		const r = run({
			deadAir: [shortPause("p1", 3.5, 4.3)],
			visual: [{ startSec: 3, endSec: 5, kind: "activity" }],
		});
		const trim = r.opportunities.find((o) => o.family === "TRIM")!;
		expect(["GROUNDED_NOT_USEFUL", "PRESERVATION_CONFLICT"]).toContain(trim.generationStatus);
		expect(trim.executionReadiness).toBe("NOT_READY");
	});

	it("C unnecessary pause with static visuals → trim candidate when safe", () => {
		const r = run({
			deadAir: [safeTrim("da1", 5, 9, 3.2)],
			visual: [{ startSec: 5, endSec: 9, kind: "stable" }],
		});
		expect(r.ready.some((o) => o.family === "TRIM")).toBe(true);
	});

	it("D page-load/wait span → speed candidate when preservation safe", () => {
		const r = run({
			visual: [{ startSec: 5, endSec: 9.5, kind: "stable" }],
			deadAir: [],
		});
		const speed = r.opportunities.find(
			(o) => o.family === "SPEED" && o.generationStatus === "GROUNDED_READY",
		);
		expect(speed).toBeTruthy();
		expect([1.25, 1.5, 2]).toContain(Number(speed!.derivedParameters.speed));
	});

	it("E important narrated UI action → no speed", () => {
		const r = run({
			visual: [{ startSec: 1, endSec: 3.5, kind: "stable" }],
			focal: groundedZoomFocal(true),
		});
		const speeds = r.opportunities.filter((o) => o.family === "SPEED");
		expect(
			speeds.every(
				(o) =>
					o.generationStatus === "PRESERVATION_CONFLICT" ||
					o.generationStatus === "GROUNDED_NOT_USEFUL" ||
					o.generationStatus === "INSUFFICIENT_EVIDENCE",
			),
		).toBe(true);
		expect(r.ready.every((o) => o.family !== "SPEED")).toBe(true);
	});

	it("F click+dwell meaningful → grounded zoom candidate", () => {
		const r = run({ focal: groundedZoomFocal(true) });
		expect(r.ready.some((o) => o.family === "ZOOM")).toBe(true);
	});

	it("G random cursor movement → no zoom", () => {
		const r = run({ focal: groundedZoomFocal(false) });
		const zoom = r.opportunities.find((o) => o.family === "ZOOM")!;
		expect(zoom.generationStatus).toBe("GROUNDED_NOT_USEFUL");
		expect(r.ready.every((o) => o.family !== "ZOOM")).toBe(true);
	});

	it("H persistent unused canvas → crop only with geometry", () => {
		const limited = run({});
		expect(limited.opportunities.find((o) => o.family === "CROP")!.generationStatus).toBe(
			"INSUFFICIENT_EVIDENCE",
		);
		const withGeom = run({
			framingCrop: { x: 0.1, y: 0.05, width: 0.8, height: 0.9, clipId: "clip_1" },
		});
		expect(withGeom.ready.some((o) => o.family === "CROP")).toBe(true);
	});

	it("I fullscreen application → no crop", () => {
		const r = run({});
		expect(r.ready.every((o) => o.family !== "CROP")).toBe(true);
	});

	it("J captions already good → KEEP; continue planning", () => {
		const r = run({
			doc: fixtureDoc(20, true),
			visual: [{ startSec: 5, endSec: 9, kind: "stable" }],
		});
		const cap = r.opportunities.find((o) => o.family === "CAPTIONS")!;
		expect(cap.generationStatus).toBe("GROUNDED_NOT_USEFUL");
		expect(r.metrics.temporalContextConsumed).toBe(true);
		expect(r.opportunities.some((o) => o.family === "SPEED")).toBe(true);
	});

	it("K audio already good → KEEP loudness", () => {
		const r = run({});
		const loud = r.opportunities.find((o) => o.family === "LOUDNESS")!;
		expect(loud.generationStatus).toBe("GROUNDED_NOT_USEFUL");
	});

	it("L protected region conflict → suppress conflicting op", () => {
		const r = run({
			visual: [{ startSec: 1, endSec: 4, kind: "stable" }],
			focal: groundedZoomFocal(true),
		});
		expect(r.ready.every((o) => o.family !== "SPEED")).toBe(true);
	});

	it("M combination: considers multiple families; only grounded useful ready", () => {
		const r = run({
			deadAir: [safeTrim("da1", 4.5, 8, 2.5), shortPause("p2", 8.2, 9)],
			visual: [
				{ startSec: 4.5, endSec: 8, kind: "stable" },
				{ startSec: 12, endSec: 16, kind: "stable" },
			],
			focal: groundedZoomFocal(true),
			doc: fixtureDoc(20, true),
		});
		expect(r.metrics.temporalContextConsumed).toBe(true);
		expect(r.storyPhases.length).toBeGreaterThan(0);
		const families = new Set(r.ready.map((o) => o.family));
		expect(families.has("CAPTIONS")).toBe(false);
		write("corpus-M-combination.json", {
			ready: r.ready.map((o) => ({
				family: o.family,
				status: o.generationStatus,
				reason: o.editorialReason,
			})),
			all: r.opportunities.map((o) => [o.family, o.generationStatus]),
			temporal: r.temporalPacketSummary,
		});
	});

	it("acceptance: contract + no paid AI + temporal consumed", () => {
		const r = run({
			deadAir: [safeTrim("da1", 5, 9, 3)],
			visual: [{ startSec: 5, endSec: 9, kind: "stable" }],
		});
		expect(r.providerId).toBe("CURRENT_OPENSCREEN_LOCAL_PROFESSIONAL_EDITORIAL_PLANNER_V1");
		expect(r.metrics.paidAiCalls).toBe(0);
		expect(r.metrics.temporalContextConsumed).toBe(true);
		for (const o of r.opportunities) {
			expect(o).toHaveProperty("generationStatus");
			expect(o).toHaveProperty("executionReadiness");
			expect(o).toHaveProperty("evidenceRefs");
		}
		write("acceptance-gates-unit.json", {
			TEMPORAL_CONTEXT_ACTUALLY_CONSUMED: r.metrics.temporalContextConsumed,
			LOCAL_EDITORIAL_OPPORTUNITY_CONTRACT: true,
			TOTAL_PAID_AI_CALLS: 0,
		});
	});
});
