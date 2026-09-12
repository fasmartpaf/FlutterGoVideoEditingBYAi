/**
 * Behavioral invariants for Temporal Event Ledger + Video Evidence Store V1.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SOURCE_TIMESTAMP_TOLERANCE_SEC } from "../sourceTiming";
import { summarizeLedgerForDiagnostics, writeLedgerDiagnosticArtifact } from "./diagnostics";
import {
	buildTemporalEventLedger,
	createVideoEvidenceStore,
	ledgerHasPassiveChromeObservation,
	ledgerHasVerifiedOpenAction,
} from "./index";

describe("Temporal Event Ledger V1", () => {
	it("1 — observed passive chrome ≠ verified open/work action (Upwork tab)", () => {
		const ledger = buildTemporalEventLedger({
			assetId: "asset_1",
			sourceDurationSec: 20,
			semantic: {
				observations: [
					{
						sourceTimeSec: 0,
						frameSummary: "Cursor frontmost; Upwork tab behind",
						frontmostSurface: { name: "Cursor", kind: "app" },
						backgroundSurfaces: [{ name: "Upwork", role: "tab" }],
					},
				],
			},
		});
		expect(ledgerHasPassiveChromeObservation(ledger, "Upwork")).toBe(true);
		expect(ledgerHasVerifiedOpenAction(ledger, "Upwork")).toBe(false);
		const passive = ledger.events.filter((e) => e.type === "passive_chrome");
		expect(passive.some((e) => e.claims.some((c) => c.epistemic === "unknown"))).toBe(true);
		expect(ledger.meta.additionalModelCalls).toBe(0);
	});

	it("2 — spoken correction retained; panel open not visually verified (Case 4 shape)", () => {
		const ledger = buildTemporalEventLedger({
			assetId: "a",
			sourceDurationSec: 18,
			speech: {
				status: "available",
				segments: [
					{
						id: "s1",
						startSourceTimeSec: 0.5,
						endSourceTimeSec: 4,
						text: "First I will open the timeline panel.",
					},
					{
						id: "s2",
						startSourceTimeSec: 4.2,
						endSourceTimeSec: 7,
						text: "I mean—actually, let me go back. I meant the effects panel.",
					},
					{
						id: "s3",
						startSourceTimeSec: 7.2,
						endSourceTimeSec: 10,
						text: "Okay, now looking at the effects panel.",
					},
				],
			},
			// Static screen — no material visual changes
			frames: [
				{ sourceTimeSec: 0, reason: "periodic" },
				{ sourceTimeSec: 8, reason: "periodic" },
			],
			changes: [
				{
					fromSourceTimeSec: 0,
					toSourceTimeSec: 8,
					classification: "minimal",
					score: 0.01,
				},
			],
		});
		expect(ledger.events.some((e) => e.type === "spoken_correction")).toBe(true);
		expect(ledger.events.some((e) => e.type === "contradiction")).toBe(true);
		const verifiedPanelOpen = ledger.events.some((e) =>
			e.claims.some(
				(c) =>
					c.epistemic === "verified" &&
					/\b(timeline|effects)\b/i.test(c.text) &&
					/\bopened?\b/i.test(c.text),
			),
		);
		expect(verifiedPanelOpen).toBe(false);
	});

	it("3 — inferred ≠ verified", () => {
		const ledger = buildTemporalEventLedger({
			assetId: "a",
			sourceDurationSec: 10,
			semantic: {
				observations: [
					{
						sourceTimeSec: 2,
						inferred: ["User might be preparing to export"],
					},
				],
			},
		});
		const inferred = ledger.events
			.flatMap((e) => e.claims)
			.filter((c) => c.epistemic === "inferred");
		expect(inferred.length).toBeGreaterThan(0);
		expect(inferred.every((c) => c.epistemic !== "verified")).toBe(true);
	});

	it("4 — contradiction retained for spoken Settings without visual change", () => {
		const ledger = buildTemporalEventLedger({
			assetId: "a",
			sourceDurationSec: 12,
			speech: {
				status: "available",
				segments: [
					{
						id: "s1",
						startSourceTimeSec: 1,
						endSourceTimeSec: 3,
						text: "I'm opening Settings now.",
					},
				],
			},
			changes: [],
		});
		const contra = ledger.events.filter((e) => e.type === "contradiction");
		expect(contra.length).toBeGreaterThan(0);
		expect(contra.some((e) => e.claims.some((c) => c.epistemic === "contradicted"))).toBe(true);
	});

	it("5 — multimodal provenance: speech + visual change + cursor refs", () => {
		const ledger = buildTemporalEventLedger({
			assetId: "a",
			sourceDurationSec: 15,
			speech: {
				status: "available",
				segments: [
					{
						id: "s1",
						startSourceTimeSec: 4,
						endSourceTimeSec: 6,
						text: "Now let's look at this.",
					},
				],
			},
			changes: [
				{
					fromSourceTimeSec: 4,
					toSourceTimeSec: 6,
					classification: "significant",
					score: 0.2,
				},
			],
			cursorInteractions: [{ sourceTimeSec: 5.1, interactionType: "click" }],
		});
		const store = createVideoEvidenceStore(ledger);
		const speech = store.speechInRange(3, 7);
		const visual = store.visualInRange(3, 7);
		const cursor = store.cursorInRange(3, 7);
		expect(speech.length).toBeGreaterThan(0);
		expect(visual.length).toBeGreaterThan(0);
		expect(cursor.length).toBeGreaterThan(0);
		const transition = visual.find((e) => e.type === "visual_transition")!;
		const refs = store.evidenceForEvent(transition.id);
		expect(refs.some((r) => r.modality === "visual" && r.changeClassification)).toBe(true);
	});

	it("6 — source-time within duration ± tolerance", () => {
		const duration = 10;
		const ledger = buildTemporalEventLedger({
			assetId: "a",
			sourceDurationSec: duration,
			speech: {
				status: "available",
				segments: [
					{
						startSourceTimeSec: 0,
						endSourceTimeSec: 9.9,
						text: "hello",
					},
				],
			},
			frames: [{ sourceTimeSec: 10.2, reason: "periodic" }],
		});
		for (const e of ledger.events) {
			expect(e.startSourceTimeSec).toBeGreaterThanOrEqual(-SOURCE_TIMESTAMP_TOLERANCE_SEC);
			expect(e.endSourceTimeSec).toBeLessThanOrEqual(duration + SOURCE_TIMESTAMP_TOLERANCE_SEC);
		}
		expect(ledger.meta.timebase).toBe("SOURCE_MEDIA_TIME");
	});

	it("7 — sparse-sample temporal uncertainty on visual transitions", () => {
		const ledger = buildTemporalEventLedger({
			assetId: "a",
			sourceDurationSec: 20,
			frames: [
				{ sourceTimeSec: 16, reason: "periodic" },
				{ sourceTimeSec: 18, reason: "periodic" },
			],
			changes: [
				{
					fromSourceTimeSec: 16,
					toSourceTimeSec: 18,
					classification: "significant",
					score: 0.15,
				},
			],
		});
		const tr = ledger.events.find((e) => e.type === "visual_transition")!;
		expect(tr.temporallyUncertain).toBe(true);
		expect(tr.claims[0]?.text).toMatch(/uncertain|between sampled/i);
		// Must NOT claim exact 18.000 onset as verified
		expect(tr.claims.some((c) => c.epistemic === "verified" && /exactly 18/i.test(c.text))).toBe(
			false,
		);
	});

	it("8 — no_audio speech status preserved distinctly", () => {
		const ledger = buildTemporalEventLedger({
			assetId: "a",
			sourceDurationSec: 13,
			speech: { status: "no_audio", segments: [] },
		});
		expect(ledger.meta.speechStatus).toBe("no_audio");
		const statusEvt = ledger.events.find((e) => e.type === "speech_status")!;
		expect(statusEvt.claims.some((c) => /no_audio/.test(c.text))).toBe(true);
		expect(ledger.meta.speechStatus).not.toBe("unavailable");
		expect(ledger.meta.speechStatus).not.toBe("failed");
	});

	it("9–11 — store range / modality / evidence lookup", () => {
		const ledger = buildTemporalEventLedger({
			assetId: "a",
			sourceDurationSec: 20,
			speech: {
				status: "available",
				segments: [{ id: "s1", startSourceTimeSec: 1, endSourceTimeSec: 2, text: "hi" }],
			},
			frames: [{ sourceTimeSec: 5, reason: "periodic" }],
			cursorInteractions: [{ sourceTimeSec: 5.2, interactionType: "click" }],
		});
		const store = createVideoEvidenceStore(ledger);
		expect(store.eventsInRange(0, 3).some((e) => e.type === "speech")).toBe(true);
		expect(store.eventsByModality("cursor").length).toBeGreaterThan(0);
		expect(store.eventsByType("visual_sample").length).toBe(1);
		const sample = store.eventsByType("visual_sample")[0]!;
		expect(store.evidenceForEvent(sample.id).length).toBeGreaterThan(0);
		expect(store.getEvent(sample.id)?.id).toBe(sample.id);
	});

	it("12 — ground truth cannot leak: ledger built only from provided evidence", () => {
		// Even if a "Restart tooltip" exists in benchmark GT, without evidence rows
		// the ledger must not invent it.
		const ledger = buildTemporalEventLedger({
			assetId: "a",
			sourceDurationSec: 20,
			frames: [
				{ sourceTimeSec: 16, reason: "periodic" },
				{ sourceTimeSec: 18, reason: "periodic" },
			],
			changes: [
				{
					fromSourceTimeSec: 16,
					toSourceTimeSec: 18,
					classification: "significant",
					score: 0.12,
				},
			],
			// No semantic observation naming Restart
		});
		const blob = JSON.stringify(ledger).toLowerCase();
		expect(blob).not.toMatch(/restart recording/);
		expect(blob).not.toMatch(/tooltip/);
		// What we DO know: material change with uncertain onset
		expect(ledger.events.some((e) => e.type === "visual_transition")).toBe(true);
	});

	it("13 — additional model calls always 0", () => {
		const ledger = buildTemporalEventLedger({
			assetId: "a",
			sourceDurationSec: 5,
			speech: { status: "available", segments: [] },
		});
		expect(ledger.meta.additionalModelCalls).toBe(0);
		expect(createVideoEvidenceStore(ledger).stats().additionalModelCalls).toBe(0);
	});

	it("14 — Case 2 shape: File-menu-like transition may be represented; Restart remains unknown without semantics", () => {
		const ledger = buildTemporalEventLedger({
			assetId: "a",
			sourceDurationSec: 20,
			semantic: {
				observations: [
					{
						sourceTimeSec: 2,
						frameSummary: "File menu open",
						observed: ["File menu dropdown visible"],
						frontmostSurface: { name: "Browser", kind: "app" },
					},
				],
			},
			changes: [
				{
					fromSourceTimeSec: 0,
					toSourceTimeSec: 2,
					classification: "significant",
					score: 0.2,
				},
				{
					fromSourceTimeSec: 16,
					toSourceTimeSec: 18,
					classification: "moderate",
					score: 0.08,
				},
			],
		});
		expect(ledger.events.some((e) => e.type === "frontmost_surface")).toBe(true);
		expect(ledger.events.some((e) => e.type === "visual_transition")).toBe(true);
		expect(JSON.stringify(ledger).toLowerCase()).not.toMatch(/restart recording/);
	});

	it("performance — construction is cheap vs Whisper/visual extract", () => {
		const segments = Array.from({ length: 80 }, (_, i) => ({
			id: `s${i}`,
			startSourceTimeSec: i * 0.4,
			endSourceTimeSec: i * 0.4 + 0.3,
			text: `word cluster ${i}`,
		}));
		const frames = Array.from({ length: 20 }, (_, i) => ({
			sourceTimeSec: i * 1.5,
			reason: "periodic" as const,
		}));
		const t0 = Date.now();
		const ledger = buildTemporalEventLedger({
			assetId: "a",
			sourceDurationSec: 40,
			speech: { status: "available", segments },
			frames,
			changes: frames.slice(0, -1).map((f, i) => ({
				fromSourceTimeSec: f.sourceTimeSec,
				toSourceTimeSec: frames[i + 1]!.sourceTimeSec,
				classification: i % 3 === 0 ? ("significant" as const) : ("minimal" as const),
			})),
		});
		const wall = Date.now() - t0;
		expect(ledger.meta.constructionMs).toBeLessThan(50);
		expect(wall).toBeLessThan(100);
		const store = createVideoEvidenceStore(ledger);
		const q0 = Date.now();
		store.eventsInRange(5, 15);
		expect(Date.now() - q0).toBeLessThan(20);
	});

	it("diagnostic artifacts — example ledgers for CTO report (tmp only)", () => {
		const out = path.join(process.cwd(), "tmp/perception-benchmark/ledger-v1-diagnostics");
		mkdirSync(out, { recursive: true });

		const upwork = buildTemporalEventLedger({
			assetId: "recording_demo",
			sourceDurationSec: 45,
			semantic: {
				observations: [
					{
						sourceTimeSec: 0,
						frameSummary: "Cursor IDE frontmost; browser chrome with Upwork tab behind",
						frontmostSurface: { name: "Cursor", kind: "app" },
						backgroundSurfaces: [{ name: "Upwork", role: "tab" }],
					},
				],
			},
		});
		writeLedgerDiagnosticArtifact(out, "example_upwork_passive", upwork);

		const case4 = buildTemporalEventLedger({
			assetId: "case04",
			sourceDurationSec: 18,
			speech: {
				status: "available",
				segments: [
					{
						id: "s1",
						startSourceTimeSec: 0.5,
						endSourceTimeSec: 4,
						text: "First I will open the timeline panel.",
					},
					{
						id: "s2",
						startSourceTimeSec: 4.2,
						endSourceTimeSec: 7,
						text: "I mean—actually, let me go back. I meant the effects panel.",
					},
				],
			},
			frames: [
				{ sourceTimeSec: 0, reason: "periodic" },
				{ sourceTimeSec: 8, reason: "periodic" },
			],
			changes: [
				{
					fromSourceTimeSec: 0,
					toSourceTimeSec: 8,
					classification: "minimal",
					score: 0.01,
				},
			],
		});
		writeLedgerDiagnosticArtifact(out, "example_case04_correction", case4);

		const case2 = buildTemporalEventLedger({
			assetId: "case02",
			sourceDurationSec: 20,
			frames: [
				{ sourceTimeSec: 16, reason: "periodic" },
				{ sourceTimeSec: 18, reason: "periodic" },
			],
			changes: [
				{
					fromSourceTimeSec: 16,
					toSourceTimeSec: 18,
					classification: "significant",
					score: 0.12,
				},
			],
		});
		writeLedgerDiagnosticArtifact(out, "example_case02_missed_tooltip", case2);

		const noAudio = buildTemporalEventLedger({
			assetId: "case01",
			sourceDurationSec: 13,
			speech: { status: "no_audio", segments: [] },
		});
		writeLedgerDiagnosticArtifact(out, "example_case01_no_audio", noAudio);

		const contra = buildTemporalEventLedger({
			assetId: "case10",
			sourceDurationSec: 12,
			speech: {
				status: "available",
				segments: [
					{
						id: "s1",
						startSourceTimeSec: 1,
						endSourceTimeSec: 3,
						text: "I am opening Settings now.",
					},
				],
			},
			changes: [],
		});
		writeLedgerDiagnosticArtifact(out, "example_contradiction_settings", contra);

		const store = createVideoEvidenceStore(case4);
		const q0 = Date.now();
		store.eventsInRange(0, 10);
		const queryMs = Date.now() - q0;
		writeFileSync(
			path.join(out, "perf-summary.json"),
			JSON.stringify(
				{
					constructionMs: case4.meta.constructionMs,
					queryMs,
					stats: store.stats(),
					additionalModelCalls: 0,
					upworkByType: summarizeLedgerForDiagnostics(upwork).byType,
					case4ByEpistemic: summarizeLedgerForDiagnostics(case4).byEpistemic,
				},
				null,
				2,
			),
			"utf8",
		);
		expect(JSON.stringify(case2).toLowerCase()).not.toMatch(/restart recording/);
	});
});
