/**
 * Local Dead-Air V1 — deterministic unit tests.
 * 0 paid AI calls.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import {
	fingerprintDocument,
	isProposalEligibleShape,
	mintTestConsent,
	prepareApplyPreviewDiagnostics,
	runConsentedApplyPreview,
} from "../applyPreview";
import { createSyntheticJoinPcmProvider } from "../audioVerify";
import { createInjectedCompositorSampler } from "../compositorVerify";
import {
	buildDeadAirCandidate,
	buildSilenceCacheKey,
	classifySilenceInterval,
	DEFAULT_DEAD_AIR_POLICY,
	deadAirCandidateToProposalItem,
	formatDeadAirReviewCopy,
	LOCAL_DEAD_AIR_V1_PROVIDER_ID,
	parseSilencedetectStderr,
	planKeepSomePause,
	readSilenceCache,
	resetDeadAirCandidateSeqForTests,
	type SilenceDetectorResult,
	type SilenceInterval,
	selectSingleDeadAirCandidate,
	wrapDeadAirProposal,
	writeSilenceCache,
} from "./index";

const FIXTURE_CREATED_AT = "2026-01-01T00:00:00.000Z";
const CACHE_DIR = join(process.cwd(), "tmp/perception-benchmark/local-dead-air-v1/test-cache");

beforeEach(() => {
	resetDeadAirCandidateSeqForTests();
	mkdirSync(CACHE_DIR, { recursive: true });
});

afterEach(() => {
	try {
		rmSync(CACHE_DIR, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
});

function interval(startSec: number, endSec: number): SilenceInterval {
	return {
		startSec,
		endSec,
		durationSec: endSec - startSec,
		source: "ffmpeg_silencedetect",
	};
}

function fixtureDoc(overrides?: {
	trims?: Array<{ startSec: number; endSec: number }>;
	speech?: Array<{ startSec: number; endSec: number; text: string }>;
	silenceSegs?: Array<{ startSec: number; endSec: number }>;
}): AxcutDocument {
	const base = createEmptyDocument({
		title: "DeadAir",
		projectId: "proj_da",
		createdAt: FIXTURE_CREATED_AT,
	});
	const speechSegs = (
		overrides?.speech ?? [
			{ startSec: 0, endSec: 5, text: "Hello world" },
			{ startSec: 10, endSec: 15, text: "Continuing" },
		]
	).map((s, i) => ({
		id: `seg_${i}`,
		kind: "speech" as const,
		startSec: s.startSec,
		endSec: s.endSec,
		text: s.text,
		wordIds: [] as string[],
	}));
	const silenceSegs = (overrides?.silenceSegs ?? [{ startSec: 5, endSec: 10 }]).map((s, i) => ({
		id: `sil_${i}`,
		kind: "silence" as const,
		startSec: s.startSec,
		endSec: s.endSec,
		text: "",
		wordIds: [] as string[],
	}));
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
				segments: [...speechSegs, ...silenceSegs].sort((a, b) => a.startSec - b.startSec),
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
			trimRanges: (overrides?.trims ?? []).map((t, i) => ({
				id: `trim_${i}`,
				assetId: "asset_1",
				clipId: "clip_1",
				startSec: t.startSec,
				endSec: t.endSec,
				reason: "fixture",
				origin: "user" as const,
			})),
		},
	});
}

describe("parseSilencedetectStderr", () => {
	it("parses start/end/duration lines", () => {
		const stderr = `
[silencedetect @ 0x] silence_start: 1.5
[silencedetect @ 0x] silence_end: 4.0 | silence_duration: 2.5
[silencedetect @ 0x] silence_start: 8.251479
[silencedetect @ 0x] silence_end: 10.902375 | silence_duration: 2.650896
`;
		const intervals = parseSilencedetectStderr(stderr);
		expect(intervals).toHaveLength(2);
		expect(intervals[0]).toMatchObject({ startSec: 1.5, endSec: 4.0, durationSec: 2.5 });
		expect(intervals[1].durationSec).toBeCloseTo(2.650896, 5);
	});
});

describe("planKeepSomePause", () => {
	it("keeps target pause and removes excess", () => {
		const plan = planKeepSomePause({
			silenceStartSec: 5,
			silenceEndSec: 7.8,
			classification: "POSSIBLE_DEAD_AIR",
			paddingBeforeSec: 0.15,
			paddingAfterSec: 0.15,
			policy: DEFAULT_DEAD_AIR_POLICY,
		});
		expect(plan.ok).toBe(true);
		expect(plan.proposedTrim).not.toBeNull();
		// window 5.15–7.65 = 2.5; keep 0.55 → remove 1.95 from 5.7–7.65
		expect(plan.targetPauseKeptSec).toBe(0.55);
		expect(plan.proposedTrim!.startSec).toBeCloseTo(5.7, 5);
		expect(plan.proposedTrim!.endSec).toBeCloseTo(7.65, 5);
		expect(plan.resultingRemovedDurationSec).toBeCloseTo(1.95, 5);
	});

	it("rejects when excess after keep is too small", () => {
		const plan = planKeepSomePause({
			silenceStartSec: 5,
			silenceEndSec: 6.0,
			classification: "POSSIBLE_DEAD_AIR",
			paddingBeforeSec: 0.15,
			paddingAfterSec: 0.15,
			policy: DEFAULT_DEAD_AIR_POLICY,
		});
		expect(plan.ok).toBe(false);
		expect(plan.reason).toBe("insufficient_excess_after_keep");
	});
});

describe("classifySilenceInterval", () => {
	const speech = [
		{ startSourceTimeSec: 0, endSourceTimeSec: 5, id: "a", text: "hi" },
		{ startSourceTimeSec: 10, endSourceTimeSec: 15, id: "b", text: "bye" },
	];

	it("marks short pauses TOO_SHORT", () => {
		expect(
			classifySilenceInterval({
				interval: interval(5, 5.7),
				durationSec: 20,
				speechWindows: speech,
				policy: DEFAULT_DEAD_AIR_POLICY,
			}),
		).toBe("TOO_SHORT");
	});

	it("marks leading silence", () => {
		expect(
			classifySilenceInterval({
				interval: interval(0, 2.5),
				durationSec: 20,
				speechWindows: speech,
				policy: DEFAULT_DEAD_AIR_POLICY,
			}),
		).toBe("LEADING_SILENCE");
	});

	it("marks trailing silence", () => {
		expect(
			classifySilenceInterval({
				interval: interval(17.5, 20),
				durationSec: 20,
				speechWindows: speech,
				policy: DEFAULT_DEAD_AIR_POLICY,
			}),
		).toBe("TRAILING_SILENCE");
	});

	it("marks interior long gap POSSIBLE_DEAD_AIR", () => {
		expect(
			classifySilenceInterval({
				interval: interval(5, 9.5),
				durationSec: 20,
				speechWindows: speech,
				policy: DEFAULT_DEAD_AIR_POLICY,
			}),
		).toBe("POSSIBLE_DEAD_AIR");
	});

	it("marks short inter-sentence INTER_SENTENCE_PAUSE", () => {
		expect(
			classifySilenceInterval({
				interval: interval(5, 6.1),
				durationSec: 20,
				speechWindows: speech,
				policy: DEFAULT_DEAD_AIR_POLICY,
			}),
		).toBe("INTER_SENTENCE_PAUSE");
	});

	it("unknown without speech windows", () => {
		expect(
			classifySilenceInterval({
				interval: interval(5, 8),
				durationSec: 20,
				speechWindows: [],
				policy: DEFAULT_DEAD_AIR_POLICY,
			}),
		).toBe("UNKNOWN");
	});
});

describe("buildDeadAirCandidate policy", () => {
	it("rejects short pause", async () => {
		const c = await buildDeadAirCandidate({
			assetId: "asset_1",
			mediaPath: "/tmp/x.mp4",
			interval: interval(5, 5.8),
			durationSec: 20,
			speechWindows: [
				{ startSourceTimeSec: 0, endSourceTimeSec: 5, text: "a" },
				{ startSourceTimeSec: 10, endSourceTimeSec: 12, text: "b" },
			],
			document: fixtureDoc(),
			visualHits: [],
		});
		expect(c.safeToPropose).toBe(false);
		expect(c.classification).toBe("TOO_SHORT");
	});

	it("proposes long dead-air with keep-some-pause", async () => {
		const c = await buildDeadAirCandidate({
			assetId: "asset_1",
			mediaPath: "/tmp/x.mp4",
			interval: interval(5, 9.5),
			durationSec: 20,
			speechWindows: [
				{ startSourceTimeSec: 0, endSourceTimeSec: 5, text: "Hello" },
				{ startSourceTimeSec: 9.5, endSourceTimeSec: 15, text: "World" },
			],
			document: fixtureDoc({
				speech: [
					{ startSec: 0, endSec: 5, text: "Hello" },
					{ startSec: 9.5, endSec: 15, text: "World" },
				],
				silenceSegs: [{ startSec: 5, endSec: 9.5 }],
			}),
			visualHits: [],
		});
		expect(c.classification).toBe("POSSIBLE_DEAD_AIR");
		expect(c.safeToPropose).toBe(true);
		expect(c.proposedTrimRange).not.toBeNull();
		expect(c.resultingRemovedDurationSec).toBeGreaterThan(0.4);
		expect(c.targetPauseKeptSec).toBe(0.55);
	});

	it("allows silencedetect quiet inside inflated STT window (presence ≠ importance)", async () => {
		const c = await buildDeadAirCandidate({
			assetId: "asset_1",
			mediaPath: "/tmp/x.mp4",
			interval: interval(2, 4),
			durationSec: 20,
			speechWindows: [{ startSourceTimeSec: 0, endSourceTimeSec: 5, text: "Hello" }],
			document: fixtureDoc({
				speech: [{ startSec: 0, endSec: 5, text: "Hello" }],
				silenceSegs: [{ startSec: 2, endSec: 4 }],
			}),
			visualHits: [],
			policy: {
				...DEFAULT_DEAD_AIR_POLICY,
				explicitUserCut: true,
				minSilenceForCandidateSec: 0.75,
				minRemovableSec: 0.28,
			},
		});
		expect(c.classification).not.toBe("WITHIN_PROTECTED_CONTEXT");
		expect(c.safeToPropose).toBe(true);
		expect(c.proposedTrimRange).not.toBeNull();
		expect(c.resultingRemovedDurationSec).toBeGreaterThan(0.4);
	});

	it("still blocks tiny STT-covered blips below candidate silence threshold", async () => {
		const c = await buildDeadAirCandidate({
			assetId: "asset_1",
			mediaPath: "/tmp/x.mp4",
			interval: interval(2, 2.7),
			durationSec: 20,
			speechWindows: [{ startSourceTimeSec: 0, endSourceTimeSec: 5, text: "Hello" }],
			document: fixtureDoc(),
			visualHits: [],
		});
		expect(["TOO_SHORT", "WITHIN_PROTECTED_CONTEXT"]).toContain(c.classification);
		expect(c.safeToPropose).toBe(false);
	});

	it("blocks important visual activity", async () => {
		const c = await buildDeadAirCandidate({
			assetId: "asset_1",
			mediaPath: "/tmp/x.mp4",
			interval: interval(5, 9.5),
			durationSec: 20,
			speechWindows: [
				{ startSourceTimeSec: 0, endSourceTimeSec: 5, text: "Hello" },
				{ startSourceTimeSec: 9.5, endSourceTimeSec: 15, text: "World" },
			],
			document: fixtureDoc({
				speech: [
					{ startSec: 0, endSec: 5, text: "Hello" },
					{ startSec: 9.5, endSec: 15, text: "World" },
				],
				silenceSegs: [{ startSec: 5, endSec: 9.5 }],
			}),
			visualHits: [{ kind: "cursor_interaction", sourceTimeSec: 7, note: "cursor_click@7" }],
		});
		expect(c.classification).toBe("VISUAL_ACTIVITY_PRESENT");
		expect(c.safeToPropose).toBe(false);
	});

	it("blocks already-trimmed source", async () => {
		const c = await buildDeadAirCandidate({
			assetId: "asset_1",
			mediaPath: "/tmp/x.mp4",
			interval: interval(5, 9.5),
			durationSec: 20,
			speechWindows: [
				{ startSourceTimeSec: 0, endSourceTimeSec: 5, text: "Hello" },
				{ startSourceTimeSec: 9.5, endSourceTimeSec: 15, text: "World" },
			],
			existingTrims: [{ startSec: 5, endSec: 9.5, assetId: "asset_1" }],
			visualHits: [],
		});
		expect(c.classification).toBe("ALREADY_REMOVED");
		expect(c.safeToPropose).toBe(false);
	});

	it("does not auto-propose trailing silence in V1", async () => {
		const c = await buildDeadAirCandidate({
			assetId: "asset_1",
			mediaPath: "/tmp/x.mp4",
			interval: interval(17, 20),
			durationSec: 20,
			speechWindows: [{ startSourceTimeSec: 10, endSourceTimeSec: 16, text: "end" }],
			document: fixtureDoc(),
			visualHits: [],
		});
		expect(c.classification).toBe("TRAILING_SILENCE");
		expect(c.safeToPropose).toBe(false);
		expect(c.blockingReasons).toContain("trailing_outro_uncertain");
	});
});

describe("proposal + apply path reuse", () => {
	it("maps candidate to addTrim proposal without LLM copy", async () => {
		const c = await buildDeadAirCandidate({
			assetId: "asset_1",
			mediaPath: "/tmp/x.mp4",
			interval: interval(5, 9.5),
			durationSec: 20,
			speechWindows: [
				{ startSourceTimeSec: 0, endSourceTimeSec: 5, text: "Hello" },
				{ startSourceTimeSec: 9.5, endSourceTimeSec: 15, text: "World" },
			],
			document: fixtureDoc({
				speech: [
					{ startSec: 0, endSec: 5, text: "Hello" },
					{ startSec: 9.5, endSec: 15, text: "World" },
				],
				silenceSegs: [{ startSec: 5, endSec: 9.5 }],
			}),
			visualHits: [],
		});
		const item = deadAirCandidateToProposalItem(c);
		expect(item).not.toBeNull();
		expect(item!.proposedCall?.toolName).toBe("addTrim");
		expect(item!.landing?.timebase).toBe("SOURCE_MEDIA_TIME");
		expect(item!.proposedCall?.notExecuted).toBe(true);
		expect(item!.proposedCall?.status).toBe("proposal_only");
		const copy = formatDeadAirReviewCopy(c);
		expect(copy.headline).toMatch(/Shorten a .* quiet pause/);
		expect(copy.detail).not.toMatch(/silencedetect @/);
		expect(isProposalEligibleShape(item!).ok).toBe(true);
	});

	it("no consent → zero mutation (consent not bypassed)", async () => {
		const doc = fixtureDoc({
			speech: [
				{ startSec: 0, endSec: 5, text: "Hello" },
				{ startSec: 9.5, endSec: 15, text: "World" },
			],
			silenceSegs: [{ startSec: 5, endSec: 9.5 }],
		});
		const c = await buildDeadAirCandidate({
			assetId: "asset_1",
			mediaPath: "/tmp/x.mp4",
			interval: interval(5, 9.5),
			durationSec: 20,
			speechWindows: [
				{ startSourceTimeSec: 0, endSourceTimeSec: 5, text: "Hello" },
				{ startSourceTimeSec: 9.5, endSourceTimeSec: 15, text: "World" },
			],
			document: doc,
			visualHits: [],
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
		expect(result.receipt.terminalStatus).toBe("blocked_no_consent");
		expect(fingerprintDocument(result.document).value).toBe(before);
	});

	it("consented apply requires compositor + audio; rollback on audio fail", async () => {
		const doc = fixtureDoc({
			speech: [
				{ startSec: 0, endSec: 5, text: "Hello" },
				{ startSec: 9.5, endSec: 15, text: "World" },
			],
			silenceSegs: [{ startSec: 5, endSec: 9.5 }],
		});
		const c = await buildDeadAirCandidate({
			assetId: "asset_1",
			mediaPath: "/tmp/x.mp4",
			interval: interval(5, 9.5),
			durationSec: 20,
			speechWindows: [
				{ startSourceTimeSec: 0, endSourceTimeSec: 5, text: "Hello" },
				{ startSourceTimeSec: 9.5, endSourceTimeSec: 15, text: "World" },
			],
			document: doc,
			visualHits: [],
		});
		const item = deadAirCandidateToProposalItem(c)!;
		const bundle = wrapDeadAirProposal({ assetId: "asset_1", item });
		const diag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1: bundle,
			selectedProposalId: item.id,
		});
		expect(diag.preflight.eligible).toBe(true);
		const beforeFp = fingerprintDocument(doc).value;
		const result = await runConsentedApplyPreview({
			document: doc,
			editProposalV1: bundle,
			selectedProposalId: item.id,
			preflight: diag.preflight,
			consent: mintTestConsent(diag.preflight, item.id),
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
			audioPcmProvider: createSyntheticJoinPcmProvider("click_pop"),
			proposalDocumentFingerprint: diag.preflight.documentFingerprint.value,
		});
		expect(result.receipt.mutationAttempted).toBe(true);
		expect(result.receipt.terminalStatus).toBe("rolled_back");
		expect(result.receipt.rollbackStatus).toBe("succeeded");
		expect(result.receipt.mutationsApplied).toBe(0);
		expect(fingerprintDocument(result.document).value).toBe(beforeFp);
		expect(result.receipt.lifecycle).toContain("render_verifying");
	});

	it("happy path verifies with compositor + audio still required", async () => {
		const doc = fixtureDoc({
			speech: [
				{ startSec: 0, endSec: 5, text: "Hello" },
				{ startSec: 9.5, endSec: 15, text: "World" },
			],
			silenceSegs: [{ startSec: 5, endSec: 9.5 }],
		});
		const c = await buildDeadAirCandidate({
			assetId: "asset_1",
			mediaPath: "/tmp/x.mp4",
			interval: interval(5, 9.5),
			durationSec: 20,
			speechWindows: [
				{ startSourceTimeSec: 0, endSourceTimeSec: 5, text: "Hello" },
				{ startSourceTimeSec: 9.5, endSourceTimeSec: 15, text: "World" },
			],
			document: doc,
			visualHits: [],
		});
		const item = deadAirCandidateToProposalItem(c)!;
		const bundle = wrapDeadAirProposal({ assetId: "asset_1", item });
		const diag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1: bundle,
			selectedProposalId: item.id,
		});
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
		expect(result.receipt.terminalStatus).toBe("verified");
		expect(result.receipt.mutationsApplied).toBe(1);
		expect(result.document.timeline.trimRanges.length).toBe(1);
		expect(result.receipt.lifecycle).toContain("render_verifying");
	});
});

describe("cache key", () => {
	it("round-trips source analysis cache", async () => {
		const media = join(CACHE_DIR, "fake.mp4");
		writeFileSync(media, "fake-media-bytes");
		const parts = {
			mediaPath: media,
			noiseThresholdDb: -35,
			minimumSilenceDurationSec: 0.55,
		};
		const built = await buildSilenceCacheKey(parts);
		expect(built).not.toBeNull();
		const result: SilenceDetectorResult = {
			assetId: "a",
			mediaPath: media,
			durationSec: 10,
			audioState: "present",
			intervals: [interval(1, 3)],
			ffmpegVersion: "8.1.2",
			parameters: {
				noiseThresholdDb: -35,
				minimumSilenceDurationSec: 0.55,
				timeoutMs: 60_000,
			},
			latencyMs: 12,
			cacheHit: false,
		};
		await writeSilenceCache(parts, result, CACHE_DIR);
		const hit = await readSilenceCache(parts, CACHE_DIR);
		expect(hit?.result.intervals).toHaveLength(1);
		expect(hit?.result.ffmpegVersion).toBe("8.1.2");
	});
});

describe("selectSingleDeadAirCandidate", () => {
	it("picks longest removable safe candidate only", async () => {
		const a = await buildDeadAirCandidate({
			assetId: "asset_1",
			mediaPath: "/tmp/x.mp4",
			interval: interval(5, 9.5),
			durationSec: 20,
			speechWindows: [
				{ startSourceTimeSec: 0, endSourceTimeSec: 5, text: "Hello" },
				{ startSourceTimeSec: 9.5, endSourceTimeSec: 12, text: "World" },
			],
			document: fixtureDoc({
				speech: [
					{ startSec: 0, endSec: 5, text: "Hello" },
					{ startSec: 9.5, endSec: 12, text: "World" },
				],
				silenceSegs: [{ startSec: 5, endSec: 9.5 }],
			}),
			visualHits: [],
		});
		const blocked = await buildDeadAirCandidate({
			assetId: "asset_1",
			mediaPath: "/tmp/x.mp4",
			interval: interval(0, 2),
			durationSec: 20,
			speechWindows: [{ startSourceTimeSec: 2, endSourceTimeSec: 5, text: "Hello" }],
			visualHits: [],
		});
		const picked = selectSingleDeadAirCandidate([blocked, a]);
		expect(picked?.id).toBe(a.id);
		expect(LOCAL_DEAD_AIR_V1_PROVIDER_ID).toContain("DEAD_AIR");
	});
});
