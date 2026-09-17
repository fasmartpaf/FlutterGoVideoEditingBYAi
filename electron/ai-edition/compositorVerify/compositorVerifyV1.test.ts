/**
 * Offscreen Native Compositor Verification V1 — unit + policy tests.
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
import type { EditProposalItem, EditProposalV1 } from "../editProposal/types";
import { EDIT_PROPOSAL_V1_PROVIDER_ID } from "../editProposal/types";
import {
	analyzeRgba8,
	assertSourceOutsideRemoved,
	COMPOSITOR_VERIFY_V1_PROVIDER_ID,
	createInjectedCompositorSampler,
	locateProgrammeInstant,
	makeGradientRgba,
	makeSolidRgba,
	verifyTrimWithCompositor,
} from "./index";

function goodAudio() {
	return createSyntheticJoinPcmProvider("safe_silence");
}

const ARTIFACT_DIR = join(process.cwd(), "tmp/perception-benchmark/compositor-verify-v1");
const FIXTURE_CREATED_AT = "2026-01-01T00:00:00.000Z";

function writeArtifact(name: string, body: unknown): void {
	mkdirSync(ARTIFACT_DIR, { recursive: true });
	writeFileSync(join(ARTIFACT_DIR, name), JSON.stringify(body, null, 2), "utf8");
}

function fixtureDocument(mediaPath = "/tmp/rec.mp4"): AxcutDocument {
	const base = createEmptyDocument({
		title: "CompositorVerify",
		projectId: "proj_cv",
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
				originalPath: mediaPath,
				durationSec: 60,
			},
		],
		transcripts: [
			{
				assetId: "asset_1",
				language: "en",
				segments: [
					{ id: "s1", kind: "speech", startSec: 0, endSec: 5, text: "Hello", wordIds: [] },
					{ id: "sil", kind: "silence", startSec: 5, endSec: 8, text: "", wordIds: [] },
					{
						id: "s2",
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
			],
			trimRanges: [],
		},
	});
}

function readyDeadAir(overrides: Partial<EditProposalItem> = {}): EditProposalItem {
	return {
		id: "prop_dead_air",
		planItemId: "plan_1",
		gapIds: [],
		sourceBeatIds: [],
		targetBeatIds: [],
		status: "proposal_ready",
		priority: "medium",
		intent: "Trim silence",
		evidenceJustification: "silence",
		evidenceRefs: [{ kind: "speech_segment", id: "sil", note: "silence" }],
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
				id: "surv",
				text: "Preserve corrected Effects meaning",
				sourceBeatIds: [],
				reason: "survive:8-12",
			},
		],
		damageRisks: [{ kind: "speech_meaning", level: "low", description: "ok" }],
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
				reason: "dead",
			},
			argsConfidence: "high",
		},
		constraints: [],
		confidence: 0.9,
		...overrides,
	};
}

function bundle(proposals: EditProposalItem[]): EditProposalV1 {
	return {
		version: 1,
		providerId: EDIT_PROPOSAL_V1_PROVIDER_ID,
		assetId: "asset_1",
		summary: "cv",
		proposals,
		deferredPlanItemIds: [],
		hardConstraints: [],
		quality: {
			proposalCount: proposals.length,
			proposalReadyCount: proposals.filter((p) => p.status === "proposal_ready").length,
			noSafeProposalCount: 0,
			provisionalCount: 0,
			needsMoreEvidenceCount: 0,
			unsupportedCount: 0,
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

describe("Compositor Verify V1 — pixels + mapping", () => {
	it("provider identity", () => {
		expect(COMPOSITOR_VERIFY_V1_PROVIDER_ID).toBe("CURRENT_OPENSCREEN_COMPOSITOR_VERIFY_V1");
	});

	it("6–9. pixel validation: blank/transparent fail; dark-but-valid passes", () => {
		const blank = analyzeRgba8(makeSolidRgba(32, 18, [0, 0, 0, 255]), 32, 18);
		expect(blank.valid).toBe(false);
		expect(blank.uniform).toBe(true);

		const transparent = analyzeRgba8(makeSolidRgba(32, 18, [0, 0, 0, 0]), 32, 18);
		expect(transparent.valid).toBe(false);
		expect(transparent.entirelyTransparent).toBe(true);

		const dark = analyzeRgba8(makeGradientRgba(32, 18, true), 32, 18);
		expect(dark.darkButValid).toBe(true);
		expect(dark.valid).toBe(true);

		const bright = analyzeRgba8(makeGradientRgba(32, 18, false), 32, 18);
		expect(bright.valid).toBe(true);
	});

	it("2–5. programme-time mapping; removed source not sampled", () => {
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
						reason: "",
						origin: "agent",
					},
				],
			},
		});
		const beforeJoin = locateProgrammeInstant(after, 4.9);
		const afterJoin = locateProgrammeInstant(after, 5.1);
		expect(beforeJoin?.sourceTimeSec).toBeLessThan(5);
		expect(afterJoin?.sourceTimeSec).toBeGreaterThanOrEqual(8);
		expect(assertSourceOutsideRemoved(beforeJoin!.sourceTimeSec, 5, 8)).toBe(true);
		expect(assertSourceOutsideRemoved(afterJoin!.sourceTimeSec, 5, 8)).toBe(true);
		expect(assertSourceOutsideRemoved(6.5, 5, 8)).toBe(false);
	});
});

describe("Compositor Verify V1 — apply gate", () => {
	it("11. ffmpeg/injected without allowInjected does not upgrade authoritative status", async () => {
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
		const ev = await verifyTrimWithCompositor({
			proposalId: "p",
			beforeDocumentFingerprint: "a",
			afterDocumentFingerprint: "b",
			trimSourceStartSec: 5,
			trimSourceEndSec: 8,
			assetId: "asset_1",
			afterDocument: after,
			beforeDocument: doc,
			mustSurviveRanges: [{ id: "s", startSourceSec: 8, endSourceSec: 12 }],
			sampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedAsAuthoritative: false,
		});
		expect(ev.qualityState).toBe("compositor_unavailable");
		expect(ev.authoritativeSatisfied).toBe(false);
		expect(ev.ffmpegSourceUsedAsAuthoritative).toBe(false);
	});

	it("12–16. safe trim with authoritative injected double + receipt", async () => {
		const doc = fixtureDocument();
		const p = readyDeadAir();
		const editProposalV1 = bundle([p]);
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
			audioPcmProvider: goodAudio(),
			proposalDocumentFingerprint: diag.preflight.documentFingerprint.value,
			retainRenderArtifacts: true,
			renderArtifactDir: ARTIFACT_DIR,
		});
		expect(result.mutatedAndVerified).toBe(true);
		expect(result.receipt.compositorVerification?.qualityState).toMatch(/^verified_compositor_/);
		expect(result.receipt.compositorVerification?.authoritativeSatisfied).toBe(true);
		expect(result.receipt.compositorVerification?.frameProvider).toBe("injected_test");
		expect(result.receipt.compositorVerification?.audioContinuity).toMatch(
			/^(verified_audio_|not_applicable_no_audio)/,
		);
		expect(result.receipt.compositorVerification?.additionalModelCalls).toBe(0);
		writeArtifact("safe-trim-compositor.json", result.receipt.compositorVerification);
	});

	it("10+13–14. blank / unavailable → rollback + fingerprint", async () => {
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
		expect(unavail.receipt.verificationStatus).toBe("compositor_unavailable");
		expect(fingerprintDocument(unavail.document).value).toBe(beforeFp);
		writeArtifact("compositor-failure-rollback.json", {
			blank: blank.receipt.compositorVerification?.qualityState,
			unavailable: unavail.receipt.compositorVerification?.qualityState,
		});
	});

	it("21–23. case refusals — zero mutation, no compositor samples", async () => {
		const doc = fixtureDocument();
		for (const [id, status] of [
			["case2", "no_safe_proposal"],
			["case4", "provisional"],
			["upwork", "no_safe_proposal"],
			["settings", "needs_more_evidence"],
			["narrated", "no_safe_proposal"],
		] as const) {
			const result = await runConsentedApplyPreview({
				document: doc,
				editProposalV1: bundle([readyDeadAir({ id, status })]),
				selectedProposalId: id,
			});
			expect(result.receipt.mutationsApplied).toBe(0);
			expect(result.receipt.compositorVerification).toBeUndefined();
		}
		writeArtifact("refusals.json", { mutations: 0 });
		writeArtifact("identity.json", {
			CURRENT_OPENSCREEN_COMPOSITOR_VERIFY_V1: COMPOSITOR_VERIFY_V1_PROVIDER_ID,
			preserved: ["CURRENT_OPENSCREEN_RENDER_VERIFY_V1", "CURRENT_OPENSCREEN_APPLY_PREVIEW_V1"],
		});
	});
});
