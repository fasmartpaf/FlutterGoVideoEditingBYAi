/**
 * Audio Continuity Verification V1 — unit + apply-path fixtures.
 * Identity: CURRENT_OPENSCREEN_AUDIO_VERIFY_V1
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
	resetApplyPreviewSeqForTests,
	runConsentedApplyPreview,
} from "../applyPreview";
import { createInjectedCompositorSampler } from "../compositorVerify";
import type { EditProposalItem, EditProposalV1 } from "../editProposal/types";
import { EDIT_PROPOSAL_V1_PROVIDER_ID } from "../editProposal/types";
import {
	AUDIO_VERIFY_PAD_AFTER_SEC,
	AUDIO_VERIFY_PAD_BEFORE_SEC,
	AUDIO_VERIFY_SAMPLE_RATE,
	AUDIO_VERIFY_V1_PROVIDER_ID,
	analyzeJoinPcm,
	classifyWaveformPolicy,
	createSyntheticJoinPcmProvider,
	synthesizeJoinPcm,
	verifyTrimAudioContinuity,
} from "./index";

const FIXTURE_CREATED_AT = "2026-01-01T00:00:00.000Z";
const ARTIFACT_DIR = join(process.cwd(), "tmp/perception-benchmark/audio-verify-v1");

beforeEach(() => {
	resetApplyPreviewSeqForTests();
});

function writeArtifact(name: string, body: unknown): void {
	mkdirSync(ARTIFACT_DIR, { recursive: true });
	writeFileSync(join(ARTIFACT_DIR, name), JSON.stringify(body, null, 2), "utf8");
}

function fixtureDocument(): AxcutDocument {
	const base = createEmptyDocument({
		title: "AudioVerify",
		projectId: "proj_av",
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
				durationSec: 60,
			},
		],
		transcripts: [
			{
				assetId: "asset_1",
				language: "en",
				segments: [
					{
						id: "seg_speech",
						kind: "speech",
						startSec: 0,
						endSec: 5,
						text: "Hello effects panel",
						wordIds: [],
					},
					{
						id: "seg_silence",
						kind: "silence",
						startSec: 5,
						endSec: 8,
						text: "",
						wordIds: [],
					},
					{
						id: "seg_corrected",
						kind: "speech",
						startSec: 8,
						endSec: 12,
						text: "Open the Effects panel",
						wordIds: [],
					},
				],
				words: [],
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId: "asset_1",
					sourceStartSec: 0,
					sourceEndSec: 30,
					timelineStartSec: 0,
					timelineEndSec: 30,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
				{
					id: "clip_2",
					assetId: "asset_1",
					sourceStartSec: 30,
					sourceEndSec: 60,
					timelineStartSec: 30,
					timelineEndSec: 60,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
			trimRanges: [],
		},
	});
}

function baseProposalBundle(proposals: EditProposalItem[]): EditProposalV1 {
	return {
		version: 1,
		providerId: EDIT_PROPOSAL_V1_PROVIDER_ID,
		assetId: "asset_1",
		summary: "test",
		proposals,
		deferredPlanItemIds: [],
		hardConstraints: [],
		quality: {
			proposalCount: proposals.length,
			proposalReadyCount: proposals.filter((p) => p.status === "proposal_ready").length,
			noSafeProposalCount: proposals.filter((p) => p.status === "no_safe_proposal").length,
			provisionalCount: proposals.filter((p) => p.status === "provisional").length,
			needsMoreEvidenceCount: proposals.filter((p) => p.status === "needs_more_evidence").length,
			unsupportedCount: proposals.filter((p) => p.status === "unsupported").length,
			avgBoundaryConfidence: 1,
			highContinuityRiskCount: 0,
			preservationBlockingCount: 0,
		},
		metrics: {
			planItemsConsumed: proposals.length,
			proposalsGenerated: proposals.length,
			serializedBytesApprox: 0,
			buildMs: 0,
			additionalModelCalls: 0,
			providerId: EDIT_PROPOSAL_V1_PROVIDER_ID,
		},
	};
}

function readyDeadAirTrim(overrides: Partial<EditProposalItem> = {}): EditProposalItem {
	return {
		id: "prop_dead_air",
		planItemId: "plan_1",
		gapIds: ["gap_1"],
		sourceBeatIds: ["beat_1"],
		targetBeatIds: ["tbeat_1"],
		status: "proposal_ready",
		priority: "medium",
		intent: "Trim clearly bounded dead-air silence 5–8s",
		evidenceJustification: "Transcript silence segment with no protected speech",
		evidenceRefs: [{ kind: "speech_segment", id: "seg_silence", note: "silence 5-8" }],
		landing: {
			timebase: "SOURCE_MEDIA_TIME",
			startSourceTimeSec: 5,
			endSourceTimeSec: 8,
			boundaryBasis: "transcript silence segment",
			boundaryConfidence: "high",
			finalizedForApply: false,
		},
		mustSurvive: [
			{
				id: "surv_corrected",
				text: "Preserve corrected Effects meaning",
				sourceBeatIds: ["beat_fx"],
				reason: "survive:8-12",
			},
		],
		damageRisks: [
			{
				kind: "speech_meaning",
				level: "low",
				description: "Trim is silence-only; speech remains",
			},
		],
		continuityRisk: "low",
		preservationViolationRisk: "low",
		preferredStrategy: "trim",
		proposedCall: {
			status: "proposal_only",
			notExecuted: true,
			toolFamily: "trim",
			toolName: "addTrim",
			provisionalArgs: {
				assetId: "asset_1",
				clipId: "clip_1",
				startSec: 5,
				endSec: 8,
				reason: "dead air",
			},
			argsConfidence: "high",
		},
		constraints: ["SOURCE_MEDIA_TIME landing", "preserve corrected Effects"],
		confidence: 0.9,
		...overrides,
	};
}

function applyTrimLocally(doc: AxcutDocument, start: number, end: number): AxcutDocument {
	return documentSchema.parse({
		...doc,
		timeline: {
			...doc.timeline,
			trimRanges: [
				...doc.timeline.trimRanges,
				{
					id: "trim_test",
					assetId: "asset_1",
					clipId: "clip_1",
					startSec: start,
					endSec: end,
					reason: "test",
					origin: "agent",
				},
			],
		},
	});
}

describe("Audio Continuity Verification V1", () => {
	it("provider identity + pad constants", () => {
		expect(AUDIO_VERIFY_V1_PROVIDER_ID).toBe("CURRENT_OPENSCREEN_AUDIO_VERIFY_V1");
		expect(AUDIO_VERIFY_PAD_BEFORE_SEC).toBe(0.75);
		expect(AUDIO_VERIFY_PAD_AFTER_SEC).toBe(0.75);
		expect(AUDIO_VERIFY_SAMPLE_RATE).toBe(48_000);
	});

	it("1. audio verify runs only after successful mutation (apply path)", async () => {
		const doc = fixtureDocument();
		const p = readyDeadAirTrim();
		const editProposalV1 = baseProposalBundle([p]);
		const diag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1,
			selectedProposalId: p.id,
		});
		const result = await runConsentedApplyPreview({
			document: doc,
			editProposalV1,
			selectedProposalId: p.id,
			preflight: diag.preflight,
			consent: mintTestConsent(diag.preflight, p.id),
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
			audioPcmProvider: createSyntheticJoinPcmProvider("safe_silence"),
			proposalDocumentFingerprint: diag.preflight.documentFingerprint.value,
		});
		expect(result.mutatedAndVerified).toBe(true);
		expect(result.receipt.audioVerification?.status).toMatch(/^verified_audio_/);
		expect(result.receipt.mutationsApplied).toBe(1);
	});

	it("2. blocked proposal never enters audio verify", async () => {
		const doc = fixtureDocument();
		const p = readyDeadAirTrim({ id: "blocked", status: "no_safe_proposal" });
		const result = await runConsentedApplyPreview({
			document: doc,
			editProposalV1: baseProposalBundle([p]),
			selectedProposalId: p.id,
		});
		expect(result.receipt.mutationsApplied).toBe(0);
		expect(result.receipt.audioVerification).toBeUndefined();
	});

	it("3–5 + 8–11. analyzer: real metrics, discontinuity, RMS warning, clipping", () => {
		const safe = synthesizeJoinPcm({ mode: "safe_silence" });
		const safeM = analyzeJoinPcm({
			samples: safe.samples,
			sampleRate: safe.sampleRate,
			joinOffsetSec: safe.joinOffsetSec,
		});
		expect(safeM.boundarySampleJump).toBeLessThan(0.45);
		expect(classifyWaveformPolicy(safeM).blocking).toHaveLength(0);

		const pop = synthesizeJoinPcm({ mode: "click_pop" });
		const popM = analyzeJoinPcm({
			samples: pop.samples,
			sampleRate: pop.sampleRate,
			joinOffsetSec: pop.joinOffsetSec,
		});
		expect(popM.boundarySampleJump).toBeGreaterThanOrEqual(0.85);
		expect(classifyWaveformPolicy(popM).blocking.length).toBeGreaterThan(0);

		const loud = synthesizeJoinPcm({ mode: "loudness_jump" });
		const loudM = analyzeJoinPcm({
			samples: loud.samples,
			sampleRate: loud.sampleRate,
			joinOffsetSec: loud.joinOffsetSec,
		});
		const loudPol = classifyWaveformPolicy(loudM);
		expect(loudPol.blocking).toHaveLength(0);
		expect(loudPol.warnings.some((w) => w.startsWith("rms_"))).toBe(true);

		const clip = synthesizeJoinPcm({ mode: "clipping" });
		const clipM = analyzeJoinPcm({
			samples: clip.samples,
			sampleRate: clip.sampleRate,
			joinOffsetSec: clip.joinOffsetSec,
		});
		expect(clipM.clippingFraction).toBeGreaterThan(0.02);
		expect(classifyWaveformPolicy(clipM).blocking.some((b) => b.startsWith("clipping"))).toBe(true);
	});

	it("5+17+20+21. safe dead-air → verified_audio_basic + receipt + 0 LLM", async () => {
		const doc = fixtureDocument();
		const after = applyTrimLocally(doc, 5, 8);
		const ev = await verifyTrimAudioContinuity({
			proposalId: "prop_dead_air",
			trimSourceStartSec: 5,
			trimSourceEndSec: 8,
			assetId: "asset_1",
			afterDocument: after,
			beforeDocument: doc,
			mustSurviveRanges: [{ startSourceSec: 8, endSourceSec: 12 }],
			pcmProvider: createSyntheticJoinPcmProvider("safe_silence"),
		});
		expect(ev.status).toBe("verified_audio_basic");
		expect(ev.speechBoundaryRisk).toBe("safe_silence_boundary");
		expect(ev.programmeAudioWindow.sampleRate).toBe(48_000);
		expect(ev.programmeAudioWindow.channels).toBe(1);
		expect(ev.pcmSamplesAnalyzed).toBeGreaterThan(0);
		expect(ev.waveformMetrics).not.toBeNull();
		expect(ev.additionalModelCalls).toBe(0);
		expect(ev.programmeAudioWindow.endSec - ev.programmeAudioWindow.startSec).toBeLessThanOrEqual(
			1.6,
		);
		writeArtifact("safe-dead-air-audio.json", ev);
	});

	it("6. inside active speech fails (audio layer)", async () => {
		const doc = fixtureDocument();
		const after = applyTrimLocally(doc, 1, 3);
		const ev = await verifyTrimAudioContinuity({
			proposalId: "speech_cut",
			trimSourceStartSec: 1,
			trimSourceEndSec: 3,
			assetId: "asset_1",
			afterDocument: after,
			beforeDocument: doc,
			mustSurviveRanges: [],
			pcmProvider: createSyntheticJoinPcmProvider("safe_silence"),
		});
		expect(ev.status).toBe("audio_verification_failed");
		expect(ev.speechBoundaryRisk).toBe("inside_active_speech");
		expect(ev.blockingReasons.some((b) => b.includes("speech_boundary"))).toBe(true);
	});

	it("7. inside protected speech fails", async () => {
		const doc = fixtureDocument();
		const after = applyTrimLocally(doc, 9, 11);
		const ev = await verifyTrimAudioContinuity({
			proposalId: "protected_cut",
			trimSourceStartSec: 9,
			trimSourceEndSec: 11,
			assetId: "asset_1",
			afterDocument: after,
			beforeDocument: doc,
			mustSurviveRanges: [{ startSourceSec: 8, endSourceSec: 12 }],
			pcmProvider: createSyntheticJoinPcmProvider("safe_silence"),
		});
		expect(ev.status).toBe("audio_verification_failed");
		expect(ev.speechBoundaryRisk).toBe("inside_protected_speech");
	});

	it("9+14+15+16. severe discontinuity → apply rollback after compositor pass", async () => {
		const doc = fixtureDocument();
		const p = readyDeadAirTrim({ id: "prop_pop" });
		const editProposalV1 = baseProposalBundle([p]);
		const diag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1,
			selectedProposalId: p.id,
		});
		const beforeFp = fingerprintDocument(doc).value;
		const result = await runConsentedApplyPreview({
			document: doc,
			editProposalV1,
			selectedProposalId: p.id,
			preflight: diag.preflight,
			consent: mintTestConsent(diag.preflight, p.id),
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
			audioPcmProvider: createSyntheticJoinPcmProvider("click_pop"),
			proposalDocumentFingerprint: beforeFp,
			retainAudioArtifacts: true,
			audioArtifactDir: ARTIFACT_DIR,
		});
		expect(result.receipt.compositorVerification?.qualityState).toMatch(/^verified_compositor_/);
		expect(result.receipt.verificationStatus).toBe("audio_verification_failed");
		expect(result.receipt.terminalStatus).toBe("rolled_back");
		expect(result.receipt.rollbackFingerprintMatch).toBe(true);
		expect(fingerprintDocument(result.document).value).toBe(beforeFp);
		expect(result.receipt.audioVerification?.status).toBe("audio_verification_failed");
		writeArtifact("click-pop-rollback.json", {
			audio: result.receipt.audioVerification,
			compositor: result.receipt.compositorVerification?.qualityState,
		});
	});

	it("10. RMS jump → verified_audio_with_warnings (kept)", async () => {
		const doc = fixtureDocument();
		const p = readyDeadAirTrim({ id: "prop_loud" });
		const editProposalV1 = baseProposalBundle([p]);
		const diag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1,
			selectedProposalId: p.id,
		});
		const result = await runConsentedApplyPreview({
			document: doc,
			editProposalV1,
			selectedProposalId: p.id,
			preflight: diag.preflight,
			consent: mintTestConsent(diag.preflight, p.id),
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
			audioPcmProvider: createSyntheticJoinPcmProvider("loudness_jump"),
			proposalDocumentFingerprint: diag.preflight.documentFingerprint.value,
		});
		expect(result.mutatedAndVerified).toBe(true);
		expect(result.receipt.audioVerification?.status).toBe("verified_audio_with_warnings");
		expect(result.receipt.verificationStatus).toBe("verified_single_trim_with_warnings");
		writeArtifact("loudness-warning.json", result.receipt.audioVerification);
	});

	it("12. no_audio → not_applicable_no_audio (not unavailable)", async () => {
		const doc = fixtureDocument();
		const p = readyDeadAirTrim({ id: "prop_no_audio" });
		const editProposalV1 = baseProposalBundle([p]);
		const diag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1,
			selectedProposalId: p.id,
		});
		const result = await runConsentedApplyPreview({
			document: doc,
			editProposalV1,
			selectedProposalId: p.id,
			preflight: diag.preflight,
			consent: mintTestConsent(diag.preflight, p.id),
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
			forceNoAudio: true,
			proposalDocumentFingerprint: diag.preflight.documentFingerprint.value,
		});
		expect(result.mutatedAndVerified).toBe(true);
		expect(result.receipt.audioVerification?.status).toBe("not_applicable_no_audio");
		expect(result.receipt.verificationStatus).toBe("verified_single_trim_basic");
		expect(result.receipt.compositorVerification?.audioContinuity).toBe("not_applicable_no_audio");
		writeArtifact("no-audio.json", result.receipt.audioVerification);
	});

	it("13–14. extraction failure → audio_unavailable → rollback", async () => {
		const doc = fixtureDocument();
		const p = readyDeadAirTrim({ id: "prop_unavail" });
		const editProposalV1 = baseProposalBundle([p]);
		const diag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1,
			selectedProposalId: p.id,
		});
		const beforeFp = fingerprintDocument(doc).value;
		const result = await runConsentedApplyPreview({
			document: doc,
			editProposalV1,
			selectedProposalId: p.id,
			preflight: diag.preflight,
			consent: mintTestConsent(diag.preflight, p.id),
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
			forceAudioUnavailable: true,
			proposalDocumentFingerprint: beforeFp,
		});
		expect(result.receipt.verificationStatus).toBe("audio_unavailable");
		expect(result.receipt.audioVerification?.status).toBe("audio_unavailable");
		expect(result.receipt.terminalStatus).toBe("rolled_back");
		expect(fingerprintDocument(result.document).value).toBe(beforeFp);
		writeArtifact("audio-unavailable-rollback.json", result.receipt.audioVerification);
	});

	it("18–19. bounded window only (≤1.5s pad each side)", async () => {
		const doc = fixtureDocument();
		const after = applyTrimLocally(doc, 5, 8);
		const ev = await verifyTrimAudioContinuity({
			proposalId: "bounded",
			trimSourceStartSec: 5,
			trimSourceEndSec: 8,
			assetId: "asset_1",
			afterDocument: after,
			beforeDocument: doc,
			mustSurviveRanges: [{ startSourceSec: 8, endSourceSec: 12 }],
			pcmProvider: createSyntheticJoinPcmProvider("safe_silence"),
		});
		const span = ev.programmeAudioWindow.endSec - ev.programmeAudioWindow.startSec;
		expect(span).toBeLessThanOrEqual(
			AUDIO_VERIFY_PAD_BEFORE_SEC + AUDIO_VERIFY_PAD_AFTER_SEC + 0.01,
		);
		expect(span).toBeLessThan(60);
	});

	it("22–24. terminal verified_single_trim_basic + mapping + Effects survive", async () => {
		const doc = fixtureDocument();
		const p = readyDeadAirTrim();
		const editProposalV1 = baseProposalBundle([p]);
		const diag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1,
			selectedProposalId: p.id,
		});
		const result = await runConsentedApplyPreview({
			document: doc,
			editProposalV1,
			selectedProposalId: p.id,
			preflight: diag.preflight,
			consent: mintTestConsent(diag.preflight, p.id),
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
			audioPcmProvider: createSyntheticJoinPcmProvider("safe_silence"),
			proposalDocumentFingerprint: diag.preflight.documentFingerprint.value,
			retainAudioArtifacts: true,
			audioArtifactDir: ARTIFACT_DIR,
		});
		expect(result.receipt.verificationStatus).toBe("verified_single_trim_basic");
		expect(result.receipt.audioVerification?.providerId).toBe(AUDIO_VERIFY_V1_PROVIDER_ID);
		expect(result.receipt.audioVerification?.additionalModelCalls).toBe(0);
		expect(result.receipt.preservationOk).toBe(true);
		expect(result.receipt.compositorVerification?.audioContinuity).toBe("verified_audio_basic");
		expect(
			result.document.timeline.trimRanges.some((t) => t.startSec === 5 && t.endSec === 8),
		).toBe(true);
		writeArtifact("verified-single-trim-basic.json", {
			verificationStatus: result.receipt.verificationStatus,
			audio: result.receipt.audioVerification,
			compositor: result.receipt.compositorVerification?.qualityState,
		});
	});
});
