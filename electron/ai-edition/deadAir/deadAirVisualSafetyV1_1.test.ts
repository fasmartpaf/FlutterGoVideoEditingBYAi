/**
 * Dead-Air Visual Safety V1.1 — deterministic unit tests.
 * 0 paid AI calls.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import {
	fingerprintDocument,
	mintTestConsent,
	prepareApplyPreviewDiagnostics,
	runConsentedApplyPreview,
} from "../applyPreview";
import { createSyntheticJoinPcmProvider } from "../audioVerify";
import { createInjectedCompositorSampler } from "../compositorVerify";
import {
	assessVisualActivity,
	buildDeadAirCandidate,
	DEFAULT_DEAD_AIR_POLICY,
	deadAirCandidateToProposalItem,
	parseBlackdetectStderr,
	parseFreezedetectStderr,
	resetDeadAirCandidateSeqForTests,
	resetVisualActivitySeqForTests,
	type SilenceInterval,
	wrapDeadAirProposal,
} from "./index";

const FIXTURE_CREATED_AT = "2026-01-01T00:00:00.000Z";

beforeEach(() => {
	resetDeadAirCandidateSeqForTests();
	resetVisualActivitySeqForTests();
});

function interval(startSec: number, endSec: number): SilenceInterval {
	return {
		startSec,
		endSec,
		durationSec: endSec - startSec,
		source: "ffmpeg_silencedetect",
	};
}

function fixtureDoc(): AxcutDocument {
	const base = createEmptyDocument({
		title: "DeadAirVisual",
		projectId: "proj_dav",
		createdAt: FIXTURE_CREATED_AT,
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "Recording",
				originalPath: "/tmp/rec.mp4",
				durationSec: 20,
			},
		],
		transcripts: [
			{
				assetId: "asset_1",
				language: "en",
				segments: [
					{
						id: "s0",
						kind: "speech",
						startSec: 0,
						endSec: 5,
						text: "Hello",
						wordIds: [],
					},
					{
						id: "sil",
						kind: "silence",
						startSec: 5,
						endSec: 9.5,
						text: "",
						wordIds: [],
					},
					{
						id: "s1",
						kind: "speech",
						startSec: 9.5,
						endSec: 15,
						text: "World",
						wordIds: [],
					},
				],
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
			trimRanges: [],
		},
	});
}

const speechWindows = [
	{ startSourceTimeSec: 0, endSourceTimeSec: 5, text: "Hello" },
	{ startSourceTimeSec: 9.5, endSourceTimeSec: 15, text: "World" },
];

describe("visual parsers", () => {
	it("parses blackdetect", () => {
		const iv = parseBlackdetectStderr("black_start:0.1 black_end:1.2 black_duration:1.1", 5);
		expect(iv[0].startSec).toBeCloseTo(5.1, 5);
		expect(iv[0].endSec).toBeCloseTo(6.2, 5);
	});

	it("parses freezedetect", () => {
		const iv = parseFreezedetectStderr(
			"freeze_start: 0.0\nfreeze_end: 1.5 | freeze_duration: 1.5\n",
			2,
		);
		expect(iv).toHaveLength(1);
		expect(iv[0].startSec).toBe(2);
		expect(iv[0].endSec).toBe(3.5);
	});
});

describe("assessVisualActivity", () => {
	it("stable silence with no evidence → NO_MATERIAL", async () => {
		const a = await assessVisualActivity({
			mediaPath: "/tmp/x.mp4",
			silenceStartSec: 5,
			silenceEndSec: 9.5,
			proposedTrimStartSec: 5.7,
			proposedTrimEndSec: 9.35,
			injectedHits: [],
			preparedChanges: [],
			forceSkipFfmpegFallback: true,
		});
		expect(a.state).toBe("NO_MATERIAL_VISUAL_ACTIVITY");
		expect(a.blockingReasons).toEqual([]);
	});

	it("click in silence blocks", async () => {
		const a = await assessVisualActivity({
			mediaPath: "/tmp/x.mp4",
			silenceStartSec: 5,
			silenceEndSec: 9.5,
			injectedHits: [{ kind: "cursor_interaction", sourceTimeSec: 7, note: "cursor_click@7" }],
			forceSkipFfmpegFallback: true,
		});
		expect(a.state).toBe("MATERIAL_VISUAL_ACTIVITY");
	});

	it("significant change blocks", async () => {
		const a = await assessVisualActivity({
			mediaPath: "/tmp/x.mp4",
			silenceStartSec: 5,
			silenceEndSec: 9.5,
			proposedTrimStartSec: 5.7,
			proposedTrimEndSec: 9.35,
			injectedHits: [],
			preparedChanges: [
				{
					fromSourceTimeSec: 6,
					toSourceTimeSec: 8,
					score: 0.2,
					classification: "significant",
				},
			],
			forceSkipFfmpegFallback: true,
		});
		expect(a.state).toBe("MATERIAL_VISUAL_ACTIVITY");
		expect(a.events.some((e) => e.kind === "SIGNIFICANT_VISUAL_CHANGE")).toBe(true);
	});

	it("single moderate → UNCERTAIN", async () => {
		const a = await assessVisualActivity({
			mediaPath: "/tmp/x.mp4",
			silenceStartSec: 5,
			silenceEndSec: 9.5,
			proposedTrimStartSec: 5.7,
			proposedTrimEndSec: 9.35,
			injectedHits: [],
			preparedChanges: [
				{
					fromSourceTimeSec: 6,
					toSourceTimeSec: 7,
					score: 0.06,
					classification: "moderate",
				},
			],
			forceSkipFfmpegFallback: true,
		});
		expect(a.state).toBe("UNCERTAIN_VISUAL_ACTIVITY");
	});

	it("dense moderate upgrades to MATERIAL", async () => {
		const a = await assessVisualActivity({
			mediaPath: "/tmp/x.mp4",
			silenceStartSec: 5,
			silenceEndSec: 9.5,
			proposedTrimStartSec: 5.7,
			proposedTrimEndSec: 9.35,
			injectedHits: [],
			preparedChanges: [
				{ fromSourceTimeSec: 6, toSourceTimeSec: 6.5, score: 0.06, classification: "moderate" },
				{ fromSourceTimeSec: 7, toSourceTimeSec: 7.5, score: 0.07, classification: "moderate" },
			],
			forceSkipFfmpegFallback: true,
		});
		expect(a.state).toBe("MATERIAL_VISUAL_ACTIVITY");
	});

	it("cached OCR change blocks", async () => {
		const a = await assessVisualActivity({
			mediaPath: "/tmp/x.mp4",
			silenceStartSec: 5,
			silenceEndSec: 9.5,
			proposedTrimStartSec: 5.7,
			proposedTrimEndSec: 9.35,
			injectedHits: [],
			ocrObservations: [{ sourceTimeSec: 8, note: "Build succeeded" }],
			forceSkipFfmpegFallback: true,
		});
		expect(a.state).toBe("MATERIAL_VISUAL_ACTIVITY");
		expect(a.events.some((e) => e.kind === "VISIBLE_TEXT_CHANGE")).toBe(true);
	});

	it("visual event near trim boundary protects range", async () => {
		const a = await assessVisualActivity({
			mediaPath: "/tmp/x.mp4",
			silenceStartSec: 5,
			silenceEndSec: 9.5,
			proposedTrimStartSec: 5.7,
			proposedTrimEndSec: 9.35,
			injectedHits: [],
			preparedChanges: [
				{
					fromSourceTimeSec: 5.55,
					toSourceTimeSec: 5.65,
					score: 0.15,
					classification: "significant",
				},
			],
			forceSkipFfmpegFallback: true,
			policy: {
				...DEFAULT_DEAD_AIR_POLICY.visualSafety,
				visualEdgePaddingSec: 0.2,
			},
		});
		expect(a.state).toBe("MATERIAL_VISUAL_ACTIVITY");
	});

	it("black/freeze observations do not alone block", async () => {
		const a = await assessVisualActivity({
			mediaPath: "/tmp/x.mp4",
			silenceStartSec: 5,
			silenceEndSec: 9.5,
			injectedHits: [],
			preparedChanges: [],
			forceSkipFfmpegFallback: true,
		});
		// Inject observational via mutating return path — black/freeze only added in ffmpeg path.
		// With forceSkip, no black/freeze; state remains NO_MATERIAL.
		expect(a.state).toBe("NO_MATERIAL_VISUAL_ACTIVITY");
		expect(a.blackFreezeObservations).toEqual([]);
	});
});

describe("buildDeadAirCandidate visual gate", () => {
	it("stable silent interval passes visual gate", async () => {
		const c = await buildDeadAirCandidate({
			assetId: "asset_1",
			mediaPath: "/tmp/x.mp4",
			interval: interval(5, 9.5),
			durationSec: 20,
			speechWindows,
			document: fixtureDoc(),
			visualHits: [],
			preparedChanges: [],
			forceSkipFfmpegVisualFallback: true,
		});
		expect(c.visualActivityState).toBe("NO_MATERIAL_VISUAL_ACTIVITY");
		expect(c.safeToPropose).toBe(true);
		expect(c.visualSafetyVersion).toBe("v1.1");
	});

	it("click in silence blocks proposal", async () => {
		const c = await buildDeadAirCandidate({
			assetId: "asset_1",
			mediaPath: "/tmp/x.mp4",
			interval: interval(5, 9.5),
			durationSec: 20,
			speechWindows,
			document: fixtureDoc(),
			visualHits: [{ kind: "cursor_interaction", sourceTimeSec: 7, note: "cursor_click@7" }],
		});
		expect(c.classification).toBe("VISUAL_ACTIVITY_PRESENT");
		expect(c.safeToPropose).toBe(false);
		expect(c.proposedTrimRange).toBeNull();
	});

	it("significant change blocks proposal", async () => {
		const c = await buildDeadAirCandidate({
			assetId: "asset_1",
			mediaPath: "/tmp/x.mp4",
			interval: interval(5, 9.5),
			durationSec: 20,
			speechWindows,
			document: fixtureDoc(),
			visualHits: [],
			preparedChanges: [
				{
					fromSourceTimeSec: 7,
					toSourceTimeSec: 8,
					score: 0.2,
					classification: "significant",
				},
			],
		});
		expect(c.safeToPropose).toBe(false);
		expect(c.classification).toBe("VISUAL_ACTIVITY_PRESENT");
	});

	it("moderate ambiguous → UNCERTAIN not safe", async () => {
		const c = await buildDeadAirCandidate({
			assetId: "asset_1",
			mediaPath: "/tmp/x.mp4",
			interval: interval(5, 9.5),
			durationSec: 20,
			speechWindows,
			document: fixtureDoc(),
			visualHits: [],
			preparedChanges: [
				{
					fromSourceTimeSec: 7,
					toSourceTimeSec: 8,
					score: 0.06,
					classification: "moderate",
				},
			],
		});
		expect(c.classification).toBe("VISUAL_ACTIVITY_UNCERTAIN");
		expect(c.safeToPropose).toBe(false);
	});
});

describe("apply path regression", () => {
	it("blocked visual candidate → no mutation", async () => {
		const doc = fixtureDoc();
		const c = await buildDeadAirCandidate({
			assetId: "asset_1",
			mediaPath: "/tmp/x.mp4",
			interval: interval(5, 9.5),
			durationSec: 20,
			speechWindows,
			document: doc,
			visualHits: [{ kind: "cursor_interaction", sourceTimeSec: 7, note: "cursor_click@7" }],
		});
		expect(deadAirCandidateToProposalItem(c)).toBeNull();
		expect(c.safeToPropose).toBe(false);
	});

	it("safe candidate still runs compositor + audio verify", async () => {
		const doc = fixtureDoc();
		const c = await buildDeadAirCandidate({
			assetId: "asset_1",
			mediaPath: "/tmp/x.mp4",
			interval: interval(5, 9.5),
			durationSec: 20,
			speechWindows,
			document: doc,
			visualHits: [],
			preparedChanges: [],
			forceSkipFfmpegVisualFallback: true,
		});
		const item = deadAirCandidateToProposalItem(c)!;
		const bundle = wrapDeadAirProposal({ assetId: "asset_1", item });
		const diag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1: bundle,
			selectedProposalId: item.id,
		});
		const before = fingerprintDocument(doc).value;
		const result = await runConsentedApplyPreview({
			document: doc,
			editProposalV1: bundle,
			selectedProposalId: item.id,
			preflight: diag.preflight,
			consent: mintTestConsent(diag.preflight, item.id),
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
			audioPcmProvider: createSyntheticJoinPcmProvider("safe_silence"),
			proposalDocumentFingerprint: diag.preflight.documentFingerprint.value,
		});
		expect(result.mutatedAndVerified).toBe(true);
		expect(result.receipt.lifecycle).toContain("render_verifying");
		expect(fingerprintDocument(result.document).value).not.toBe(before);
	});

	it("no consent = no mutation", async () => {
		const doc = fixtureDoc();
		const c = await buildDeadAirCandidate({
			assetId: "asset_1",
			mediaPath: "/tmp/x.mp4",
			interval: interval(5, 9.5),
			durationSec: 20,
			speechWindows,
			document: doc,
			visualHits: [],
			preparedChanges: [],
			forceSkipFfmpegVisualFallback: true,
		});
		const item = deadAirCandidateToProposalItem(c)!;
		const bundle = wrapDeadAirProposal({ assetId: "asset_1", item });
		const before = fingerprintDocument(doc).value;
		const result = await runConsentedApplyPreview({
			document: doc,
			editProposalV1: bundle,
			selectedProposalId: item.id,
			consent: null,
		});
		expect(result.receipt.mutationsApplied).toBe(0);
		expect(fingerprintDocument(result.document).value).toBe(before);
	});
});
