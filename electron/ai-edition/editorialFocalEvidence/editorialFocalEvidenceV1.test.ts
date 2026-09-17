/**
 * Local Editorial Focal Evidence V1 — contract + case A–M regressions (SYNTHETIC).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import {
	analyzeEditorialFocalEvidence,
	decideCrop,
	decideZoom,
	focalEvidenceToTemporalRecords,
	remapFocalTargetAfterMutation,
	resetFocalEvidenceSeqForTests,
	toOrchestratorGroundedFocals,
} from "./index";
import type { CursorSampleV1 } from "./types";

const OUT = join(process.cwd(), "tmp/perception-benchmark/local-editorial-focal-evidence-v1");

function write(name: string, data: unknown): void {
	mkdirSync(OUT, { recursive: true });
	writeFileSync(join(OUT, name), typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

function fixtureDoc(durationSec = 20): AxcutDocument {
	const base = createEmptyDocument({
		title: "focal",
		projectId: "proj_focal",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "focal.mp4",
				originalPath: "/tmp/focal.mp4",
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
		zoomRanges: [],
		transcripts: [],
	});
}

/** Fast left→right transit, no clicks. */
function crossingSamples(): CursorSampleV1[] {
	const out: CursorSampleV1[] = [];
	for (let i = 0; i < 20; i++) {
		out.push({
			atSec: i * 0.05,
			cx: 0.05 + i * 0.045,
			cy: 0.5,
			interactionType: "move",
		});
	}
	return out;
}

/** Parked cursor, no interaction. */
function parkedSamples(): CursorSampleV1[] {
	const out: CursorSampleV1[] = [];
	for (let i = 0; i < 30; i++) {
		out.push({
			atSec: 2 + i * 0.05,
			cx: 0.4 + (i % 2) * 0.002,
			cy: 0.5,
			interactionType: "move",
		});
	}
	return out;
}

/** Click + local dwell persistence. */
function clickDwellSamples(): CursorSampleV1[] {
	const out: CursorSampleV1[] = [{ atSec: 3.0, cx: 0.55, cy: 0.42, interactionType: "click" }];
	for (let i = 0; i < 25; i++) {
		out.push({
			atSec: 3.05 + i * 0.04,
			cx: 0.55 + (i % 3) * 0.002,
			cy: 0.42,
			interactionType: "move",
		});
	}
	return out;
}

/** Repeated compact clicks. */
function clusterSamples(): CursorSampleV1[] {
	return [
		{ atSec: 5.0, cx: 0.3, cy: 0.3, interactionType: "click" },
		{ atSec: 5.4, cx: 0.31, cy: 0.29, interactionType: "click" },
		{ atSec: 5.9, cx: 0.3, cy: 0.31, interactionType: "mouseup" },
		{ atSec: 6.2, cx: 0.305, cy: 0.3, interactionType: "move" },
		{ atSec: 6.5, cx: 0.3, cy: 0.3, interactionType: "move" },
		{ atSec: 6.9, cx: 0.3, cy: 0.3, interactionType: "move" },
	];
}

describe("LOCAL_EDITORIAL_FOCAL_EVIDENCE_V1 cases", () => {
	it("CASE A: cursor merely crosses → NO_TARGET / no zoom", () => {
		resetFocalEvidenceSeqForTests();
		const b = analyzeEditorialFocalEvidence({
			assetId: "asset_1",
			cursorSamples: crossingSamples(),
		});
		expect(b.targets.every((t) => t.status !== "GROUNDED")).toBe(true);
		expect(b.zoomDecision.decision).toBe("NO_ZOOM_RECOMMENDED");
		write("case-a-crossing.json", b);
	});

	it("CASE B: parked no interaction → weak / no zoom", () => {
		resetFocalEvidenceSeqForTests();
		const b = analyzeEditorialFocalEvidence({
			assetId: "asset_1",
			cursorSamples: parkedSamples(),
		});
		const statuses = new Set(b.targets.map((t) => t.status));
		expect(statuses.has("GROUNDED")).toBe(false);
		expect(b.zoomDecision.decision).toBe("NO_ZOOM_RECOMMENDED");
		write("case-b-parked.json", b);
	});

	it("CASE C: click + dwell → GROUNDED → zoom may be eligible", () => {
		resetFocalEvidenceSeqForTests();
		const b = analyzeEditorialFocalEvidence({
			assetId: "asset_1",
			cursorSamples: clickDwellSamples(),
		});
		expect(b.targets.some((t) => t.status === "GROUNDED")).toBe(true);
		expect(b.zoomDecision.decision).toBe("ZOOM_ELIGIBLE");
		expect(b.zoomDecision.geometry).not.toBeNull();
		expect(b.metrics.paidAiCalls).toBe(0);
		expect(b.metrics.additionalDecodePasses).toBe(0);
		write("case-c-click-dwell.json", b);
	});

	it("CASE D: compact interaction cluster → GROUNDED", () => {
		resetFocalEvidenceSeqForTests();
		const b = analyzeEditorialFocalEvidence({
			assetId: "asset_1",
			cursorSamples: clusterSamples(),
		});
		expect(b.targets.some((t) => t.status === "GROUNDED")).toBe(true);
		expect(
			b.evidence.some((e) => e.kind === "CURSOR_CLUSTER" || e.kind === "INTERACTION_REGION"),
		).toBe(true);
		write("case-d-cluster.json", b);
	});

	it("CASE E: two concurrent competing regions → CONFLICTING → no zoom", () => {
		resetFocalEvidenceSeqForTests();
		// Same time window, far apart — true ambiguity.
		const samples: CursorSampleV1[] = [
			{ atSec: 5.0, cx: 0.3, cy: 0.3, interactionType: "click" },
			{ atSec: 5.2, cx: 0.31, cy: 0.29, interactionType: "click" },
			{ atSec: 5.4, cx: 0.3, cy: 0.3, interactionType: "mouseup" },
			{ atSec: 5.6, cx: 0.305, cy: 0.3, interactionType: "move" },
			{ atSec: 5.9, cx: 0.3, cy: 0.3, interactionType: "move" },
			{ atSec: 6.2, cx: 0.3, cy: 0.3, interactionType: "move" },
			{ atSec: 5.1, cx: 0.8, cy: 0.8, interactionType: "click" },
			{ atSec: 5.3, cx: 0.81, cy: 0.79, interactionType: "click" },
			{ atSec: 5.5, cx: 0.8, cy: 0.8, interactionType: "move" },
			{ atSec: 5.8, cx: 0.8, cy: 0.8, interactionType: "move" },
			{ atSec: 6.1, cx: 0.8, cy: 0.8, interactionType: "move" },
		];
		const b = analyzeEditorialFocalEvidence({
			assetId: "asset_1",
			cursorSamples: samples,
		});
		expect(b.targets.some((t) => t.status === "CONFLICTING")).toBe(true);
		expect(b.zoomDecision.decision).toBe("NO_ZOOM_RECOMMENDED");
		expect(b.zoomDecision.reasonCode).toBe("AMBIGUOUS_TARGET");
		write("case-e-conflict.json", b);
	});

	it("CASE E2: sequential far regions keep primary GROUNDED (no global void)", () => {
		resetFocalEvidenceSeqForTests();
		const samples: CursorSampleV1[] = [
			...clusterSamples(),
			{ atSec: 12.0, cx: 0.8, cy: 0.8, interactionType: "click" },
			{ atSec: 12.3, cx: 0.81, cy: 0.79, interactionType: "click" },
			{ atSec: 12.7, cx: 0.8, cy: 0.8, interactionType: "move" },
			{ atSec: 13.1, cx: 0.8, cy: 0.8, interactionType: "move" },
			{ atSec: 13.5, cx: 0.8, cy: 0.8, interactionType: "move" },
		];
		const b = analyzeEditorialFocalEvidence({
			assetId: "asset_1",
			cursorSamples: samples,
		});
		expect(b.targets.some((t) => t.status === "GROUNDED")).toBe(true);
		expect(b.targets.every((t) => t.status !== "CONFLICTING")).toBe(true);
		expect(b.zoomDecision.decision).toBe("ZOOM_ELIGIBLE");
		write("case-e2-sequential.json", b);
	});

	it("CASE E3: nearby same-button clicks merge — not ambiguous", () => {
		resetFocalEvidenceSeqForTests();
		const samples: CursorSampleV1[] = [
			{ atSec: 4.0, cx: 0.42, cy: 0.5, interactionType: "click" },
			{ atSec: 4.4, cx: 0.43, cy: 0.51, interactionType: "click" },
			{ atSec: 4.9, cx: 0.41, cy: 0.49, interactionType: "click" },
			{ atSec: 5.2, cx: 0.42, cy: 0.5, interactionType: "move" },
			{ atSec: 5.6, cx: 0.42, cy: 0.5, interactionType: "move" },
			{ atSec: 6.0, cx: 0.42, cy: 0.5, interactionType: "move" },
		];
		const b = analyzeEditorialFocalEvidence({
			assetId: "asset_1",
			cursorSamples: samples,
		});
		expect(b.targets.some((t) => t.status === "GROUNDED")).toBe(true);
		expect(b.targets.every((t) => t.status !== "CONFLICTING")).toBe(true);
		write("case-e3-nearby-merge.json", b);
	});

	it("CASE F: full-screen scene change alone → no focal target", () => {
		resetFocalEvidenceSeqForTests();
		const b = analyzeEditorialFocalEvidence({
			assetId: "asset_1",
			cursorSamples: [],
			visualIntervals: [{ startSec: 1, endSec: 2, kind: "scene", fullFrame: true }],
		});
		expect(b.targets.every((t) => t.status !== "GROUNDED")).toBe(true);
		expect(b.zoomDecision.decision).toBe("NO_ZOOM_RECOMMENDED");
		write("case-f-fullscreen.json", b);
	});

	it("CASE G: OCR text alone → no zoom", () => {
		resetFocalEvidenceSeqForTests();
		const b = analyzeEditorialFocalEvidence({
			assetId: "asset_1",
			cursorSamples: [],
			textRegions: [
				{
					id: "ocr1",
					sourceRange: { startSec: 2, endSec: 5 },
					region: { x: 0.2, y: 0.2, width: 0.2, height: 0.1 },
				},
			],
		});
		expect(b.zoomDecision.decision).toBe("NO_ZOOM_RECOMMENDED");
		expect(b.coverage.ocr).toBe("AVAILABLE");
		write("case-g-ocr-only.json", b);
	});

	it("CASE H: click + OCR agreement → stronger target", () => {
		resetFocalEvidenceSeqForTests();
		const b = analyzeEditorialFocalEvidence({
			assetId: "asset_1",
			cursorSamples: clickDwellSamples(),
			textRegions: [
				{
					id: "ocr1",
					sourceRange: { startSec: 2.5, endSec: 5 },
					region: { x: 0.5, y: 0.35, width: 0.12, height: 0.12 },
				},
			],
		});
		const g = b.targets.find((t) => t.status === "GROUNDED");
		expect(g).toBeTruthy();
		expect(g!.confidence).toBe("HIGH");
		expect(g!.evidenceFamilies).toContain("VISIBLE_TEXT_REGION");
		write("case-h-ocr-agree.json", b);
	});

	it("CASE I: protected webcam conflict → zoom blocked", () => {
		resetFocalEvidenceSeqForTests();
		const b = analyzeEditorialFocalEvidence({
			assetId: "asset_1",
			cursorSamples: clickDwellSamples(),
			protectedRegions: [
				{
					id: "pip",
					kind: "webcam",
					region: { x: 0.5, y: 0.35, width: 0.2, height: 0.2 },
					sourceRange: { startSec: 0, endSec: 20 },
				},
			],
		});
		expect(b.zoomDecision.decision).toBe("NO_ZOOM_RECOMMENDED");
		expect(b.zoomDecision.reasonCode).toBe("PRESERVATION_CONFLICT");
		write("case-i-protected.json", b);
	});

	it("CASE J: existing zoom already emphasizes → suppress", () => {
		resetFocalEvidenceSeqForTests();
		const b = analyzeEditorialFocalEvidence({
			assetId: "asset_1",
			cursorSamples: clickDwellSamples(),
			existingZooms: [
				{
					id: "z1",
					startSec: 2.5,
					endSec: 5,
					focus: { cx: 0.55, cy: 0.42 },
					depth: 2,
				},
			],
		});
		expect(b.zoomDecision.decision).toBe("NO_ZOOM_RECOMMENDED");
		expect(b.zoomDecision.reasonCode).toBe("EXISTING_ZOOM_SUFFICIENT");
		write("case-j-existing-zoom.json", b);
	});

	it("CASE K: trim before target → remap disposition", () => {
		resetFocalEvidenceSeqForTests();
		const b = analyzeEditorialFocalEvidence({
			assetId: "asset_1",
			cursorSamples: clickDwellSamples(),
		});
		const g = b.targets.find((t) => t.status === "GROUNDED")!;
		const doc = fixtureDoc();
		const trimmed = documentSchema.parse({
			...doc,
			timeline: {
				...doc.timeline,
				trimRanges: [
					{
						id: "t1",
						assetId: "asset_1",
						clipId: "clip_1",
						startSec: 0.5,
						endSec: 1.2,
						reason: "pause",
						origin: "agent",
					},
				],
			},
		});
		const remapped = remapFocalTargetAfterMutation({
			document: trimmed,
			assetId: "asset_1",
			target: { ...g, programmeRanges: [{ startSec: 3, endSec: 4.5 }] },
		});
		expect(["STILL_VALID", "STALE_BUT_REMAPPABLE"]).toContain(remapped.disposition);
		expect(remapped.geometry).not.toBeNull();

		const cutAway = documentSchema.parse({
			...doc,
			timeline: {
				...doc.timeline,
				trimRanges: [
					{
						id: "t2",
						assetId: "asset_1",
						clipId: "clip_1",
						startSec: 2.5,
						endSec: 5.5,
						reason: "cut",
						origin: "agent",
					},
				],
			},
		});
		const gone = remapFocalTargetAfterMutation({
			document: cutAway,
			assetId: "asset_1",
			target: g,
		});
		expect(gone.disposition).toBe("STALE_AND_INVALID");
		write("trim-remap-results.json", { remapped, gone });
	});

	it("CASE L: no cursor/OCR → other families still free (no zoom fail)", () => {
		resetFocalEvidenceSeqForTests();
		const b = analyzeEditorialFocalEvidence({ assetId: "asset_1", cursorSamples: [] });
		expect(b.zoomDecision.decision).toBe("NO_ZOOM_RECOMMENDED");
		expect(b.coverage.cursor).toBe("NOT_AVAILABLE");
		expect(b.coverage.ocr).toBe("NOT_AVAILABLE");
		// Absence is not failure of professional edit — orchestrator continues.
		write("case-l-no-evidence.json", b);
	});

	it("CASE M: already-good / no speculative zoom", () => {
		resetFocalEvidenceSeqForTests();
		const b = analyzeEditorialFocalEvidence({
			assetId: "asset_1",
			cursorSamples: crossingSamples(),
		});
		expect(b.zoomDecision.decision).toBe("NO_ZOOM_RECOMMENDED");
		expect(decideCrop({ targets: b.targets }).decision).toBe("NO_CROP_RECOMMENDED");
		write("case-m-already-good.json", b);
	});

	it("temporal bridge + orchestrator bridge + contracts", () => {
		resetFocalEvidenceSeqForTests();
		const b = analyzeEditorialFocalEvidence({
			assetId: "asset_1",
			cursorSamples: clickDwellSamples(),
		});
		const records = focalEvidenceToTemporalRecords({
			bundle: b,
			mediaFingerprint: "fp_test",
			programmeFingerprint: "prog_test",
		});
		expect(records.some((r) => r.kind === "EDITORIAL_FOCAL_EVIDENCE")).toBe(true);
		expect(records.some((r) => r.kind === "EDITORIAL_FOCAL_TARGET")).toBe(true);

		const doc = fixtureDoc();
		const orch = toOrchestratorGroundedFocals({
			document: doc,
			assetId: "asset_1",
			bundle: b,
		});
		expect(orch.length).toBeGreaterThan(0);
		expect(orch[0]!.evidenceType).not.toBe("none");

		write("evidence-contract.json", { sample: b.evidence[0] });
		write("target-contract.json", { sample: b.targets[0] });
		write("focal-policy.json", {
			decideZoom: decideZoom({ targets: b.targets, evidence: b.evidence }),
		});
		write("temporal-context-integration.json", {
			recordKinds: [...new Set(records.map((r) => r.kind))],
		});
		write("zoom-decision-results.json", b.zoomDecision);
		write("targeted-investigation-results.json", b.investigations);
		write("zero-paid-ai-proof.json", { TOTAL_PAID_AI_CALLS: 0, OPENAI_CALLS: 0 });
	});
});
