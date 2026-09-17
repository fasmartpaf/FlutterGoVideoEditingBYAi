/**
 * Render Verification V1 — bounded post-edit checks for single trim apply.
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
	fingerprintDocument,
	mintTestConsent,
	prepareApplyPreviewDiagnostics,
	runConsentedApplyPreview,
} from "../applyPreview";
import { createSyntheticJoinPcmProvider } from "../audioVerify";
import { createInjectedCompositorSampler } from "../compositorVerify";
import type { EditProposalItem, EditProposalV1 } from "../editProposal/types";
import { EDIT_PROPOSAL_V1_PROVIDER_ID } from "../editProposal/types";
import {
	analyzeTrimProgrammeMapping,
	createInjectedSampler,
	RENDER_VERIFY_PAD_AFTER_SEC,
	RENDER_VERIFY_PAD_BEFORE_SEC,
	RENDER_VERIFY_V1_PROVIDER_ID,
	verifyTrimRender,
} from "./index";

function goodAudio() {
	return createSyntheticJoinPcmProvider("safe_silence");
}

const FIXTURE_CREATED_AT = "2026-01-01T00:00:00.000Z";
const ARTIFACT_DIR = join(process.cwd(), "tmp/perception-benchmark/render-verify-v1");

function writeArtifact(name: string, body: unknown): void {
	mkdirSync(ARTIFACT_DIR, { recursive: true });
	writeFileSync(join(ARTIFACT_DIR, name), JSON.stringify(body, null, 2), "utf8");
}

function fixtureDocument(): AxcutDocument {
	const base = createEmptyDocument({
		title: "RenderVerify",
		projectId: "proj_rv",
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

function bundle(proposals: EditProposalItem[]): EditProposalV1 {
	return {
		version: 1,
		providerId: EDIT_PROPOSAL_V1_PROVIDER_ID,
		assetId: "asset_1",
		summary: "rv",
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
			planItemsConsumed: 1,
			proposalsGenerated: proposals.length,
			serializedBytesApprox: 0,
			buildMs: 0,
			additionalModelCalls: 0,
			providerId: EDIT_PROPOSAL_V1_PROVIDER_ID,
		},
	};
}

function readyDeadAir(overrides: Partial<EditProposalItem> = {}): EditProposalItem {
	return {
		id: "prop_dead_air",
		planItemId: "plan_1",
		gapIds: ["gap_1"],
		sourceBeatIds: ["beat_1"],
		targetBeatIds: ["tbeat_1"],
		status: "proposal_ready",
		priority: "medium",
		intent: "Trim dead-air silence 5–8s",
		evidenceJustification: "Silence segment",
		evidenceRefs: [{ kind: "speech_segment", id: "seg_silence", note: "silence" }],
		landing: {
			timebase: "SOURCE_MEDIA_TIME",
			startSourceTimeSec: 5,
			endSourceTimeSec: 8,
			boundaryBasis: "silence",
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
		damageRisks: [{ kind: "speech_meaning", level: "low", description: "silence only" }],
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
		constraints: [],
		confidence: 0.9,
		...overrides,
	};
}

function goodSampler() {
	return createInjectedSampler([
		{
			role: "before_boundary",
			sourceTimeSec: 0,
			valid: true,
			blank: false,
			byteLength: 2000,
			meanLuma: 100,
		},
		{
			role: "after_boundary",
			sourceTimeSec: 0,
			valid: true,
			blank: false,
			byteLength: 2000,
			meanLuma: 110,
		},
		{
			role: "pre_edit_context",
			sourceTimeSec: 0,
			valid: true,
			blank: false,
			byteLength: 2000,
			meanLuma: 90,
		},
		{
			role: "removed_probe",
			sourceTimeSec: 0,
			valid: true,
			blank: false,
			byteLength: 2000,
			meanLuma: 95,
		},
	]);
}

function goodCompositor() {
	return createInjectedCompositorSampler({ mode: "valid" });
}

describe("Render Verification V1", () => {
	it("provider identity + bounded window constants", () => {
		expect(RENDER_VERIFY_V1_PROVIDER_ID).toBe("CURRENT_OPENSCREEN_RENDER_VERIFY_V1");
		expect(RENDER_VERIFY_PAD_BEFORE_SEC).toBeLessThanOrEqual(1.5);
		expect(RENDER_VERIFY_PAD_AFTER_SEC).toBeLessThanOrEqual(1.5);
		expect(RENDER_VERIFY_PAD_BEFORE_SEC).toBeGreaterThanOrEqual(0.5);
	});

	it("1–5. safe trim apply → render evidence; removed absent; must-survive remains", async () => {
		const doc = fixtureDocument();
		const p = readyDeadAir();
		const editProposalV1 = bundle([p]);
		const diag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1,
			selectedProposalId: p.id,
		});
		const beforeClip2 = structuredClone(doc.timeline.clips.find((c) => c.id === "clip_2"));
		const result = await runConsentedApplyPreview({
			document: doc,
			editProposalV1,
			selectedProposalId: p.id,
			preflight: diag.preflight,
			consent: mintTestConsent(diag.preflight, p.id),
			compositorFrameSampler: goodCompositor(),
			allowInjectedCompositorAsAuthoritative: true,
			audioPcmProvider: goodAudio(),
			proposalDocumentFingerprint: diag.preflight.documentFingerprint.value,
			retainRenderArtifacts: true,
			renderArtifactDir: ARTIFACT_DIR,
		});

		expect(result.mutatedAndVerified).toBe(true);
		expect(result.receipt.compositorVerification?.qualityState).toMatch(
			/^verified_compositor_(basic|with_warnings)$/,
		);
		expect(
			result.receipt.compositorVerification?.evidence?.removedIntervalAbsentFromProgramme,
		).toBe(true);
		expect(result.receipt.compositorVerification?.evidence?.mustSurvivePresentInProgramme).toBe(
			true,
		);
		expect(result.receipt.compositorVerification?.evidence?.speechBoundaryRisk).toBe(
			"safe_silence_boundary",
		);
		expect(result.receipt.compositorVerification?.framesCaptured).toBeGreaterThan(0);
		expect(result.receipt.compositorVerification?.additionalModelCalls).toBe(0);
		expect(result.receipt.compositorVerification?.audioContinuity).toMatch(
			/^(verified_audio_|not_applicable_no_audio)/,
		);
		expect(result.receipt.lifecycle).toContain("render_verifying");
		expect(result.document.timeline.clips.find((c) => c.id === "clip_2")).toEqual(beforeClip2);

		const mapping = analyzeTrimProgrammeMapping({
			after: result.document,
			assetId: "asset_1",
			trimStartSec: 5,
			trimEndSec: 8,
		});
		expect(mapping.removedAbsent).toBe(true);
		expect(mapping.programmeDurationSec).toBeLessThan(60);

		writeArtifact("safe-trim-render.json", {
			receipt: result.receipt.compositorVerification,
			mapping,
		});
	});

	it("2. blocked proposal never renders", async () => {
		const doc = fixtureDocument();
		const p = readyDeadAir({ id: "case2", status: "no_safe_proposal" });
		const result = await runConsentedApplyPreview({
			document: doc,
			editProposalV1: bundle([p]),
			selectedProposalId: p.id,
			compositorFrameSampler: goodCompositor(),
			allowInjectedCompositorAsAuthoritative: true,
		});
		expect(result.receipt.mutationsApplied).toBe(0);
		expect(result.receipt.compositorVerification).toBeUndefined();
		writeArtifact("case2-no-render.json", { mutations: 0, renderRan: false });
	});

	it("6. active-speech / protected cut fails → rollback", async () => {
		const doc = fixtureDocument();
		// Interior of corrected Effects speech; preservation risk low so structural can pass
		const p = readyDeadAir({
			id: "bad_speech_cut",
			landing: {
				timebase: "SOURCE_MEDIA_TIME",
				startSourceTimeSec: 9,
				endSourceTimeSec: 10,
				boundaryBasis: "unsafe",
				boundaryConfidence: "low",
				finalizedForApply: false,
			},
			proposedCall: {
				status: "proposal_only",
				notExecuted: true,
				toolFamily: "trim",
				toolName: "addTrim",
				provisionalArgs: {
					assetId: "asset_1",
					clipId: "clip_1",
					startSec: 9,
					endSec: 10,
					reason: "unsafe",
				},
				argsConfidence: "low",
			},
			preservationViolationRisk: "low",
			continuityRisk: "low",
			mustSurvive: [
				{
					id: "surv_corrected",
					text: "Preserve corrected Effects meaning",
					sourceBeatIds: [],
					reason: "survive:8-12",
				},
			],
		});
		const editProposalV1 = bundle([p]);
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
			compositorFrameSampler: goodCompositor(),
			allowInjectedCompositorAsAuthoritative: true,
			proposalDocumentFingerprint: beforeFp,
		});

		expect(result.receipt.terminalStatus).toBe("rolled_back");
		expect(fingerprintDocument(result.document).value).toBe(beforeFp);
		expect(result.receipt.compositorVerification?.qualityState).toBe(
			"compositor_verification_failed",
		);
		expect(
			result.receipt.compositorVerification?.evidence?.speechBoundaryRisk ===
				"inside_active_speech" ||
				result.receipt.compositorVerification?.evidence?.speechBoundaryRisk ===
					"inside_protected_speech" ||
				result.receipt.compositorVerification?.evidence?.mustSurvivePresentInProgramme === false,
		).toBe(true);
		writeArtifact("bad-boundary-rollback.json", result.receipt.compositorVerification);
	});

	it("7–10. blank/invalid frames + unavailable → rollback (fail-closed)", async () => {
		const doc = fixtureDocument();
		const p = readyDeadAir({ id: "blank" });
		const editProposalV1 = bundle([p]);
		const diag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1,
			selectedProposalId: p.id,
		});
		const beforeFp = fingerprintDocument(doc).value;

		const blank = await runConsentedApplyPreview({
			document: doc,
			editProposalV1,
			selectedProposalId: p.id,
			preflight: diag.preflight,
			consent: mintTestConsent(diag.preflight, p.id),
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "blank" }),
			allowInjectedCompositorAsAuthoritative: true,
			proposalDocumentFingerprint: beforeFp,
		});
		expect(blank.receipt.terminalStatus).toBe("rolled_back");
		expect(blank.receipt.verificationStatus).toBe("compositor_verification_failed");
		expect(fingerprintDocument(blank.document).value).toBe(beforeFp);

		const diag2 = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1,
			selectedProposalId: p.id,
		});
		const unavail = await runConsentedApplyPreview({
			document: doc,
			editProposalV1,
			selectedProposalId: p.id,
			preflight: diag2.preflight,
			consent: mintTestConsent(diag2.preflight, p.id),
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "unavailable" }),
			allowInjectedCompositorAsAuthoritative: true,
			proposalDocumentFingerprint: fingerprintDocument(doc).value,
		});
		expect(unavail.receipt.terminalStatus).toBe("rolled_back");
		expect(unavail.receipt.verificationStatus).toBe("compositor_unavailable");
		expect(fingerprintDocument(unavail.document).value).toBe(beforeFp);
		writeArtifact("render-failure-rollback.json", {
			blank: blank.receipt.compositorVerification?.qualityState,
			unavailable: unavail.receipt.compositorVerification?.qualityState,
		});
	});

	it("12–13. bounded window only (no full-video claim)", async () => {
		const doc = fixtureDocument();
		const after = documentSchema.parse({
			...doc,
			timeline: {
				...doc.timeline,
				trimRanges: [
					{
						id: "t1",
						assetId: "asset_1",
						clipId: "clip_1",
						startSec: 5,
						endSec: 8,
						reason: "dead",
						origin: "agent",
					},
				],
			},
		});
		const ev = await verifyTrimRender({
			proposalId: "p",
			beforeDocumentFingerprint: "a",
			afterDocumentFingerprint: "b",
			trimSourceStartSec: 5,
			trimSourceEndSec: 8,
			assetId: "asset_1",
			afterDocument: after,
			beforeDocument: doc,
			mustSurviveRanges: [{ id: "s", startSourceSec: 8, endSourceSec: 12 }],
			sampleFrame: goodSampler(),
		});
		expect(ev.boundary.windowBeforeSec).toBe(RENDER_VERIFY_PAD_BEFORE_SEC);
		expect(ev.boundary.windowAfterSec).toBe(RENDER_VERIFY_PAD_AFTER_SEC);
		expect(ev.framesRendered).toBeLessThanOrEqual(12);
		expect(ev.additionalModelCalls).toBe(0);
	});

	it("16–20. Case 2 / Case 4 / Upwork / Settings / narrated — zero mutation, no render", async () => {
		const doc = fixtureDocument();
		for (const [id, status] of [
			["case2", "no_safe_proposal"],
			["case4", "provisional"],
			["upwork", "no_safe_proposal"],
			["settings", "needs_more_evidence"],
			["narrated", "no_safe_proposal"],
		] as const) {
			const p = readyDeadAir({ id, status });
			const result = await runConsentedApplyPreview({
				document: doc,
				editProposalV1: bundle([p]),
				selectedProposalId: id,
			});
			expect(result.receipt.mutationsApplied).toBe(0);
			expect(result.receipt.compositorVerification).toBeUndefined();
		}
		writeArtifact("refusals.json", { mutations: 0, renderRan: false });
	});

	it("15. zero required LLM calls on evidence", async () => {
		const doc = fixtureDocument();
		const after = documentSchema.parse({
			...doc,
			timeline: {
				...doc.timeline,
				trimRanges: [
					{
						id: "t1",
						assetId: "asset_1",
						startSec: 5,
						endSec: 8,
						reason: "",
						origin: "agent",
					},
				],
			},
		});
		const ev = await verifyTrimRender({
			proposalId: "p",
			beforeDocumentFingerprint: fingerprintDocument(doc).value,
			afterDocumentFingerprint: fingerprintDocument(after).value,
			trimSourceStartSec: 5,
			trimSourceEndSec: 8,
			assetId: "asset_1",
			afterDocument: after,
			beforeDocument: doc,
			mustSurviveRanges: [{ id: "s", startSourceSec: 8, endSourceSec: 12 }],
			sampleFrame: goodSampler(),
		});
		expect(ev.additionalModelCalls).toBe(0);
		expect(ev.optionalSemanticModelCalls).toBe(0);
		writeArtifact("identity.json", {
			CURRENT_OPENSCREEN_RENDER_VERIFY_V1: RENDER_VERIFY_V1_PROVIDER_ID,
			preserved: ["CURRENT_OPENSCREEN_APPLY_PREVIEW_V1"],
		});
	});
});
