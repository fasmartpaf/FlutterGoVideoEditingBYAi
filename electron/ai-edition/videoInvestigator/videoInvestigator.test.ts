/**
 * Behavioral invariants for Master Video Investigator Agent V1.
 */
import { describe, expect, it } from "vitest";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import { buildTemporalEventLedger, createVideoEvidenceStore } from "../temporalEventLedger";
import {
	DEFAULT_INVESTIGATION_BUDGETS,
	inferFocusRange,
	planInvestigation,
	runMasterVideoInvestigatorV1,
	shouldRunInvestigator,
	userFacingLeaksInvestigatorInternals,
	verifyInvestigationClaims,
} from "./index";
import {
	type InvestigatorToolContext,
	toolGetCursorEvents,
	toolGetEventsInRange,
	toolGetEvidenceForEvent,
	toolGetTranscriptRange,
} from "./tools";

function emptySpeechTimings() {
	return {
		audioProbeMs: 0,
		audioExtractMs: 0,
		sttMs: 0,
		transcriptParseMs: 0,
		transcriptCacheMs: 0,
		segmentCount: 0,
		cacheHit: false,
	};
}

function baseCtx(
	overrides: Partial<InvestigatorToolContext> & { store: InvestigatorToolContext["store"] },
): InvestigatorToolContext {
	return {
		assetId: "a1",
		sourceDurationSec: 20,
		videoPath: null,
		existingFrames: [],
		cursorInteractions: [],
		extractDeps: { cacheDir: "/tmp/os-inv-test" },
		ffmpegPath: null,
		...overrides,
	};
}

describe("Master Video Investigator V1", () => {
	it("1 — starts from ledger / evidence store (memory-first)", async () => {
		const ledger = buildTemporalEventLedger({
			assetId: "a1",
			sourceDurationSec: 20,
			speech: {
				status: "available",
				segments: [{ id: "s1", startSourceTimeSec: 1, endSourceTimeSec: 2, text: "hello" }],
			},
			changes: [
				{
					fromSourceTimeSec: 16,
					toSourceTimeSec: 18,
					classification: "significant",
					score: 0.12,
				},
			],
		});
		const set = await runMasterVideoInvestigatorV1({
			userMessage: "What happened near the end?",
			needs: classifyMediaContextNeeds(
				"Understand this recording from beginning to end including what I say and what is visible.",
			),
			assetId: "a1",
			sourceDurationSec: 20,
			videoPath: null,
			ledger,
			speechEvidence: {
				assetId: "a1",
				status: "available",
				engine: "whisper",
				sourceDurationSec: 20,
				audioStreamPresent: true,
				timings: emptySpeechTimings(),
				segments: [{ startSourceTimeSec: 1, endSourceTimeSec: 2, text: "hello" }],
			},
			ffmpegPath: null,
		});
		expect(set).not.toBeNull();
		expect(set!.metrics.investigatorModelCalls).toBe(0);
		expect(set!.toolTrace.some((t) => t.tool === "get_events_in_range")).toBe(true);
		expect(set!.observations.some((o) => o.kind === "ledger_events")).toBe(true);
		expect(set!.timebase).toBe("SOURCE_MEDIA_TIME");
	});

	it("2–4 — bounded range / transcript / cursor retrieval", () => {
		const ledger = buildTemporalEventLedger({
			assetId: "a1",
			sourceDurationSec: 20,
			speech: {
				status: "available",
				segments: [
					{ id: "s1", startSourceTimeSec: 5, endSourceTimeSec: 6, text: "now" },
					{ id: "s2", startSourceTimeSec: 15, endSourceTimeSec: 16, text: "later" },
				],
			},
			cursorInteractions: [{ sourceTimeSec: 15.2, interactionType: "click" }],
		});
		const store = createVideoEvidenceStore(ledger);
		const ctx = baseCtx({
			store,
			speechEvidence: {
				assetId: "a1",
				status: "available",
				engine: "whisper",
				sourceDurationSec: 20,
				audioStreamPresent: true,
				timings: emptySpeechTimings(),
				segments: [
					{ startSourceTimeSec: 5, endSourceTimeSec: 6, text: "now" },
					{ startSourceTimeSec: 15, endSourceTimeSec: 16, text: "later" },
				],
			},
			cursorInteractions: [{ sourceTimeSec: 15.2, interactionType: "click" }],
		});
		expect(toolGetEventsInRange(ctx, 14, 20).events.length).toBeGreaterThan(0);
		const tr = toolGetTranscriptRange(ctx, 14, 20);
		expect(tr.segments.map((s) => s.text)).toEqual(["later"]);
		expect(toolGetCursorEvents(ctx, 14, 20).events).toHaveLength(1);
	});

	it("5–7 — frame/range/compare are evidence-not-conclusions; provenance preserved", async () => {
		const ledger = buildTemporalEventLedger({
			assetId: "a1",
			sourceDurationSec: 20,
			changes: [
				{
					fromSourceTimeSec: 16,
					toSourceTimeSec: 18,
					classification: "significant",
					score: 0.15,
				},
			],
		});
		const set = await runMasterVideoInvestigatorV1({
			userMessage: "What happened near the end of this recording?",
			needs: {
				category: "mediaUnderstanding",
				visual: true,
				speech: false,
				cursor: false,
				injectSpeech: false,
			},
			assetId: "a1",
			sourceDurationSec: 20,
			videoPath: null,
			ledger,
			ffmpegPath: null,
			budgets: { maxRoiInspections: 0 },
		});
		expect(
			set!.toolTrace.some(
				(t) => t.tool === "compare_visual_states" || t.tool === "inspect_video_range",
			),
		).toBe(true);
		const compareObs = set!.observations.find((o) => o.kind === "visual_compare");
		if (compareObs) {
			expect(compareObs.text.toLowerCase()).not.toMatch(/restart recording/);
			// Without a video path, compare may fail — still must not invent UI labels.
			expect(compareObs.text.toLowerCase()).not.toMatch(/tooltip appeared|opened settings/);
		}
		const ev = toolGetEvidenceForEvent(
			baseCtx({ store: createVideoEvidenceStore(ledger) }),
			ledger.events.find((e) => e.type === "visual_transition")!.id,
		);
		expect(ev.refs.length).toBeGreaterThan(0);
	});

	it("8 — observed ≠ action (Upwork passive)", async () => {
		const ledger = buildTemporalEventLedger({
			assetId: "a1",
			sourceDurationSec: 30,
			semantic: {
				observations: [
					{
						sourceTimeSec: 0,
						frontmostSurface: { name: "Cursor", kind: "app" },
						backgroundSurfaces: [{ name: "Upwork", role: "tab" }],
					},
				],
			},
		});
		const set = await runMasterVideoInvestigatorV1({
			userMessage:
				"Watch and understand this complete recording. Tell me what the recording is about.",
			needs: {
				category: "mediaUnderstanding",
				visual: true,
				speech: true,
				cursor: true,
				injectSpeech: true,
			},
			assetId: "a1",
			sourceDurationSec: 30,
			videoPath: null,
			ledger,
			ffmpegPath: null,
		});
		const upwork = set!.claims.find((c) => /upwork/i.test(c.hypothesis));
		expect(upwork).toBeTruthy();
		expect(["not_verified", "unknown", "observed"].includes(upwork!.verdict)).toBe(true);
		expect(upwork!.verdict).not.toBe("verified");
		expect(JSON.stringify(set!.claims)).not.toMatch(/verified.*opened Upwork/i);
	});

	it("9–10 — spoken ≠ visual; contradiction retained (Case 4 + Settings)", async () => {
		const ledger = buildTemporalEventLedger({
			assetId: "a1",
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
						text: "I mean—actually, I meant the effects panel.",
					},
					{
						id: "s3",
						startSourceTimeSec: 8,
						endSourceTimeSec: 10,
						text: "I'm opening Settings now.",
					},
				],
			},
			changes: [
				{
					fromSourceTimeSec: 0,
					toSourceTimeSec: 8,
					classification: "minimal",
					score: 0.01,
				},
			],
		});
		const set = await runMasterVideoInvestigatorV1({
			userMessage: "What am I saying and what is happening on screen?",
			needs: {
				category: "mediaUnderstanding",
				visual: true,
				speech: true,
				cursor: false,
				injectSpeech: true,
			},
			assetId: "a1",
			sourceDurationSec: 18,
			videoPath: null,
			ledger,
			speechEvidence: {
				assetId: "a1",
				status: "available",
				engine: "whisper",
				sourceDurationSec: 18,
				audioStreamPresent: true,
				timings: emptySpeechTimings(),
				segments: [
					{
						startSourceTimeSec: 0.5,
						endSourceTimeSec: 4,
						text: "First I will open the timeline panel.",
					},
					{
						startSourceTimeSec: 4.2,
						endSourceTimeSec: 7,
						text: "I mean—actually, I meant the effects panel.",
					},
					{ startSourceTimeSec: 8, endSourceTimeSec: 10, text: "I'm opening Settings now." },
				],
			},
			ffmpegPath: null,
		});
		expect(set!.claims.some((c) => c.verdict === "spoken")).toBe(true);
		expect(set!.claims.some((c) => c.verdict === "contradicted")).toBe(true);
		expect(
			set!.claims.some(
				(c) => c.verdict === "verified" && /timeline|effects|settings/i.test(c.hypothesis),
			),
		).toBe(false);
	});

	it("11–13 — insufficient evidence / no infinite loop / budgets enforced", async () => {
		const ledger = buildTemporalEventLedger({
			assetId: "a1",
			sourceDurationSec: 20,
			changes: [
				{ fromSourceTimeSec: 10, toSourceTimeSec: 12, classification: "significant", score: 0.2 },
				{ fromSourceTimeSec: 14, toSourceTimeSec: 16, classification: "significant", score: 0.2 },
				{ fromSourceTimeSec: 16, toSourceTimeSec: 18, classification: "significant", score: 0.2 },
			],
		});
		const set = await runMasterVideoInvestigatorV1({
			userMessage: "What happened near the end?",
			needs: {
				category: "visualInspection",
				visual: true,
				speech: false,
				cursor: false,
				injectSpeech: false,
			},
			assetId: "a1",
			sourceDurationSec: 20,
			videoPath: null,
			ledger,
			ffmpegPath: null,
			budgets: {
				maxSteps: 4,
				maxRangeInspections: 1,
				maxRepeatedRangeInspections: 1,
				maxRoiInspections: 0,
				maxCompareCalls: 1,
				maxFrameInspections: 1,
			},
		});
		expect(set!.metrics.stepsUsed).toBeLessThanOrEqual(4);
		expect(set!.metrics.stepsUsed).toBeLessThanOrEqual(DEFAULT_INVESTIGATION_BUDGETS.maxSteps);
		expect(set!.stopReason === "budget_exhausted" || set!.toolTrace.length <= 4).toBe(true);
		const rangeCalls = set!.toolTrace.filter((t) => t.tool === "inspect_video_range" && t.ok);
		expect(rangeCalls.length).toBeLessThanOrEqual(1);
	});

	it("14 — ground truth cannot leak into investigator", async () => {
		const ledger = buildTemporalEventLedger({
			assetId: "a1",
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
		const set = await runMasterVideoInvestigatorV1({
			userMessage: "What happened near the end?",
			needs: {
				category: "mediaUnderstanding",
				visual: true,
				speech: false,
				cursor: false,
				injectSpeech: false,
			},
			assetId: "a1",
			sourceDurationSec: 20,
			videoPath: null,
			ledger,
			ffmpegPath: null,
		});
		const blob = JSON.stringify(set).toLowerCase();
		expect(blob).not.toMatch(/restart recording/);
		expect(blob).not.toMatch(/case02|case_2|ground.?truth/i);
	});

	it("15 — no internal JSON leakage helpers", () => {
		expect(userFacingLeaksInvestigatorInternals("At the end a tooltip appears.")).toBe(false);
		expect(userFacingLeaksInvestigatorInternals("INVESTIGATOR_EVIDENCE_BRIEFING\nfoo")).toBe(true);
		expect(userFacingLeaksInvestigatorInternals("event evt_12 confidence=0.83")).toBe(true);
	});

	it("16 — no_audio preserved", async () => {
		const ledger = buildTemporalEventLedger({
			assetId: "a1",
			sourceDurationSec: 13,
			speech: { status: "no_audio", segments: [] },
		});
		const set = await runMasterVideoInvestigatorV1({
			userMessage: "Understand this recording.",
			needs: {
				category: "mediaUnderstanding",
				visual: true,
				speech: true,
				cursor: false,
				injectSpeech: true,
			},
			assetId: "a1",
			sourceDurationSec: 13,
			videoPath: null,
			ledger,
			speechEvidence: {
				assetId: "a1",
				status: "no_audio",
				engine: "none",
				sourceDurationSec: 13,
				audioStreamPresent: false,
				timings: emptySpeechTimings(),
				segments: [],
			},
			ffmpegPath: null,
		});
		const tr = set!.observations.find((o) => o.kind === "transcript");
		expect(tr?.text).toMatch(/no_audio/);
		expect(tr?.text).not.toMatch(/speechStatus=unavailable|speechStatus=failed/);
	});

	it("18 — deterministic edit does not trigger expensive investigation", async () => {
		expect(shouldRunInvestigator(classifyMediaContextNeeds("trim silences"))).toBe(false);
		const set = await runMasterVideoInvestigatorV1({
			userMessage: "trim silences",
			needs: classifyMediaContextNeeds("trim silences"),
			assetId: "a1",
			sourceDurationSec: 20,
			videoPath: null,
			ffmpegPath: null,
		});
		expect(set!.stopReason).toBe("deterministic_edit_skip");
		expect(set!.metrics.toolCalls).toBe(0);
		expect(set!.additionalFrames).toHaveLength(0);
	});

	it("21 — Case 2 shape: late uncertainty triggers targeted inspect without inventing Restart", async () => {
		const ledger = buildTemporalEventLedger({
			assetId: "case02_shape",
			sourceDurationSec: 20,
			frames: [
				{ sourceTimeSec: 0, reason: "periodic" },
				{ sourceTimeSec: 2, reason: "periodic" },
				{ sourceTimeSec: 16, reason: "periodic" },
				{ sourceTimeSec: 18, reason: "periodic" },
			],
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
					classification: "significant",
					score: 0.12,
				},
			],
		});
		const focus = inferFocusRange("What happened near the end?", 20);
		expect(focus.startSourceTimeSec).toBeGreaterThan(10);
		const { actions } = planInvestigation({
			userMessage: "What happened near the end?",
			store: createVideoEvidenceStore(ledger),
			sourceDurationSec: 20,
			needs: {
				category: "mediaUnderstanding",
				visual: true,
				speech: false,
				cursor: false,
				injectSpeech: false,
			},
		});
		expect(actions.some((a) => a.tool === "inspect_video_range")).toBe(true);
		expect(actions.some((a) => a.tool === "inspect_region")).toBe(true);
		const set = await runMasterVideoInvestigatorV1({
			userMessage: "What happened near the end?",
			needs: {
				category: "mediaUnderstanding",
				visual: true,
				speech: false,
				cursor: false,
				injectSpeech: false,
			},
			assetId: "case02_shape",
			sourceDurationSec: 20,
			videoPath: null,
			ledger,
			ffmpegPath: null,
		});
		expect(set!.coverage.rangesInspected.length).toBeGreaterThan(0);
		expect(JSON.stringify(set).toLowerCase()).not.toMatch(/restart recording/);
		// Without video path, ROI/frame extract may fail — stop cleanly, not invent.
		expect(["sufficient_evidence", "budget_exhausted", "insufficient_evidence"]).toContain(
			set!.stopReason,
		);
	});

	it("verifyClaims — passive chrome not_verified", () => {
		const ledger = buildTemporalEventLedger({
			assetId: "a1",
			sourceDurationSec: 10,
			semantic: {
				observations: [
					{
						sourceTimeSec: 1,
						backgroundSurfaces: [{ name: "Upwork", role: "tab" }],
					},
				],
			},
		});
		const claims = verifyInvestigationClaims({
			store: createVideoEvidenceStore(ledger),
			observations: [],
			focusStart: 0,
			focusEnd: 10,
		});
		expect(claims.some((c) => /upwork/i.test(c.hypothesis) && c.verdict === "not_verified")).toBe(
			true,
		);
	});
});
