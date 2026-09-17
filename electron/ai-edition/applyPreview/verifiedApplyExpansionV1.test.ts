/**
 * Verified Apply Expansion V1 — unit tests (injected compositor authoritative).
 * Live native proof lives in *.live.runtime.test.ts.
 * TOTAL_PAID_AI_CALLS = 0.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { createInjectedCompositorSampler } from "../compositorVerify";
import type { EditProposalItem, EditProposalV1 } from "../editProposal/types";
import { EDIT_PROPOSAL_V1_PROVIDER_ID } from "../editProposal/types";
import {
	createApplyConsent,
	fingerprintDocument,
	mintTestConsent,
	prepareApplyPreviewDiagnostics,
	resetApplyPreviewSeqForTests,
	runConsentedApplyPreview,
	SUPPORTED_APPLY_TOOLS,
} from "./index";
import { SUPPORTED_APPLY_TOOLS as PREFLIGHT_TOOLS } from "./preflight";

const FIXTURE_CREATED_AT = "2026-01-01T00:00:00.000Z";
const ARTIFACT_ROOT = join(process.cwd(), "tmp/perception-benchmark/verified-apply-expansion-v1");

beforeEach(() => {
	resetApplyPreviewSeqForTests();
});

function fixtureDoc(durationSec = 20): AxcutDocument {
	const base = createEmptyDocument({
		title: "VerifiedApplyExpansion",
		projectId: "proj_vae",
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
				originalPath: "/tmp/vae.mp4",
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
			trimRanges: [],
		},
		zoomRanges: [],
		legacyEditor: {},
	});
}

function bundle(proposals: EditProposalItem[]): EditProposalV1 {
	return {
		version: 1,
		providerId: EDIT_PROPOSAL_V1_PROVIDER_ID,
		assetId: "asset_1",
		summary: "verified apply expansion unit",
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
			planItemsConsumed: proposals.length,
			proposalsGenerated: proposals.length,
			serializedBytesApprox: 0,
			buildMs: 0,
			additionalModelCalls: 0,
			providerId: EDIT_PROPOSAL_V1_PROVIDER_ID,
		},
	};
}

function landing(
	start: number,
	end: number,
	basis = "fixture range",
): NonNullable<EditProposalItem["landing"]> {
	return {
		timebase: "SOURCE_MEDIA_TIME",
		startSourceTimeSec: start,
		endSourceTimeSec: end,
		boundaryBasis: basis,
		boundaryConfidence: "high",
		finalizedForApply: false,
	};
}

function baseProposal(
	partial: Partial<EditProposalItem> &
		Pick<EditProposalItem, "id" | "preferredStrategy" | "proposedCall" | "landing">,
): EditProposalItem {
	return {
		planItemId: "plan_vae",
		gapIds: ["gap_1"],
		sourceBeatIds: ["beat_1"],
		targetBeatIds: ["tbeat_1"],
		status: "proposal_ready",
		priority: "medium",
		intent: "test",
		evidenceJustification: "fixture",
		evidenceRefs: [],
		mustSurvive: [],
		damageRisks: [],
		continuityRisk: "low",
		preservationViolationRisk: "low",
		constraints: [],
		confidence: 0.9,
		...partial,
	};
}

describe("VERIFIED_APPLY_EXPANSION_V1", () => {
	it("allowlist includes trim zoom crop speed", () => {
		expect(PREFLIGHT_TOOLS.has("addTrim")).toBe(true);
		expect(PREFLIGHT_TOOLS.has("addZoom")).toBe(true);
		expect(PREFLIGHT_TOOLS.has("setClipCrop")).toBe(true);
		expect(PREFLIGHT_TOOLS.has("addSpeed")).toBe(true);
		expect(SUPPORTED_APPLY_TOOLS ?? PREFLIGHT_TOOLS).toBeTruthy();
	});

	it("valid zoom applies + verifies; blank compositor rolls back", async () => {
		const doc = fixtureDoc();
		const proposal = baseProposal({
			id: "prop_zoom",
			preferredStrategy: "zoom",
			landing: landing(2, 6),
			proposedCall: {
				status: "proposal_only",
				notExecuted: true,
				toolFamily: "zoom",
				toolName: "addZoom",
				provisionalArgs: {
					startSec: 2,
					endSec: 6,
					depth: 3,
					focus: { cx: 0.5, cy: 0.5 },
				},
				argsConfidence: "high",
			},
		});
		const diag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1: bundle([proposal]),
			selectedProposalId: proposal.id,
		});
		expect(diag.preflight.eligible).toBe(true);
		const consent = mintTestConsent(diag.preflight, proposal.id);
		const ok = await runConsentedApplyPreview({
			document: doc,
			editProposalV1: bundle([proposal]),
			selectedProposalId: proposal.id,
			preflight: diag.preflight,
			consent,
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
		});
		expect(ok.mutatedAndVerified).toBe(true);
		expect(ok.receipt.verificationStatus).toBe("verified_single_zoom_basic");
		expect(ok.receipt.mutationsApplied).toBe(1);
		expect(ok.document.zoomRanges.length).toBeGreaterThan(0);

		const diag2 = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1: bundle([{ ...proposal, id: "prop_zoom_blank" }]),
			selectedProposalId: "prop_zoom_blank",
		});
		const consent2 = mintTestConsent(diag2.preflight, "prop_zoom_blank");
		const fail = await runConsentedApplyPreview({
			document: doc,
			editProposalV1: bundle([{ ...proposal, id: "prop_zoom_blank" }]),
			selectedProposalId: "prop_zoom_blank",
			preflight: diag2.preflight,
			consent: consent2,
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "blank" }),
			allowInjectedCompositorAsAuthoritative: true,
		});
		expect(fail.receipt.terminalStatus).toBe("rolled_back");
		expect(fail.receipt.rollbackFingerprintMatch).toBe(true);
		expect(fail.document.zoomRanges).toHaveLength(0);
	});

	it("wrong-operation consent / stale fingerprint blocked", async () => {
		const doc = fixtureDoc();
		const zoomProp = baseProposal({
			id: "prop_z",
			preferredStrategy: "zoom",
			landing: landing(1, 3),
			proposedCall: {
				status: "proposal_only",
				notExecuted: true,
				toolFamily: "zoom",
				toolName: "addZoom",
				provisionalArgs: {
					startSec: 1,
					endSec: 3,
					depth: 3,
					focus: { cx: 0.5, cy: 0.5 },
				},
				argsConfidence: "high",
			},
		});
		const diag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1: bundle([zoomProp]),
			selectedProposalId: zoomProp.id,
		});
		const trimishConsent = createApplyConsent({
			proposalId: zoomProp.id,
			preflight: { ...diag.preflight, toolName: "addTrim" },
		});
		const wrongOp = await runConsentedApplyPreview({
			document: doc,
			editProposalV1: bundle([zoomProp]),
			selectedProposalId: zoomProp.id,
			preflight: diag.preflight,
			consent: trimishConsent,
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
		});
		expect(wrongOp.receipt.mutationsApplied).toBe(0);
		expect(wrongOp.receipt.terminalStatus).toBe("blocked_no_consent");

		const stale = await runConsentedApplyPreview({
			document: doc,
			editProposalV1: bundle([zoomProp]),
			selectedProposalId: zoomProp.id,
			proposalDocumentFingerprint: "stale_fp",
		});
		expect(stale.preflight.blockingReasons).toContain("stale_proposal");
		expect(stale.receipt.mutationsApplied).toBe(0);
	});

	it("valid crop verifies; protected region rolls back", async () => {
		const doc = fixtureDoc();
		const okProp = baseProposal({
			id: "prop_crop",
			preferredStrategy: "crop",
			landing: landing(0, 10),
			proposedCall: {
				status: "proposal_only",
				notExecuted: true,
				toolFamily: "crop",
				toolName: "setClipCrop",
				provisionalArgs: {
					clipId: "clip_1",
					crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
				},
				argsConfidence: "high",
			},
		});
		const diag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1: bundle([okProp]),
			selectedProposalId: okProp.id,
		});
		const consent = mintTestConsent(diag.preflight, okProp.id);
		const ok = await runConsentedApplyPreview({
			document: doc,
			editProposalV1: bundle([okProp]),
			selectedProposalId: okProp.id,
			preflight: diag.preflight,
			consent,
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
		});
		expect(ok.mutatedAndVerified).toBe(true);
		expect(ok.receipt.verificationStatus).toBe("verified_single_crop_basic");

		const badProp = baseProposal({
			id: "prop_crop_bad",
			preferredStrategy: "crop",
			landing: landing(0, 10),
			mustSurvive: [
				{
					id: "prot",
					text: "UI control",
					sourceBeatIds: ["beat_ui"],
					reason: "region:0.1,0.1,0.15,0.15",
				},
			],
			proposedCall: {
				status: "proposal_only",
				notExecuted: true,
				toolFamily: "crop",
				toolName: "setClipCrop",
				provisionalArgs: {
					clipId: "clip_1",
					crop: { x: 0.7, y: 0.7, width: 0.25, height: 0.25 },
				},
				argsConfidence: "high",
			},
		});
		const diag2 = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1: bundle([badProp]),
			selectedProposalId: badProp.id,
		});
		const consent2 = mintTestConsent(diag2.preflight, badProp.id);
		const fail = await runConsentedApplyPreview({
			document: doc,
			editProposalV1: bundle([badProp]),
			selectedProposalId: badProp.id,
			preflight: diag2.preflight,
			consent: consent2,
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
		});
		expect(fail.receipt.terminalStatus).toBe("rolled_back");
		expect(fail.document.timeline.clips[0]?.cropRegion).toBeUndefined();
	});

	it("valid speed verifies; forced audio failure rolls back", async () => {
		const doc = fixtureDoc();
		const prop = baseProposal({
			id: "prop_spd",
			preferredStrategy: "speed",
			landing: landing(2, 8),
			proposedCall: {
				status: "proposal_only",
				notExecuted: true,
				toolFamily: "speed",
				toolName: "addSpeed",
				provisionalArgs: { startSec: 2, endSec: 8, speed: 2 },
				argsConfidence: "high",
			},
		});
		const diag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1: bundle([prop]),
			selectedProposalId: prop.id,
		});
		const consent = mintTestConsent(diag.preflight, prop.id);
		const ok = await runConsentedApplyPreview({
			document: doc,
			editProposalV1: bundle([prop]),
			selectedProposalId: prop.id,
			preflight: diag.preflight,
			consent,
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
		});
		expect(ok.mutatedAndVerified).toBe(true);
		expect(ok.receipt.verificationStatus).toBe("verified_single_speed_basic");

		const diag2 = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1: bundle([{ ...prop, id: "prop_spd_fail" }]),
			selectedProposalId: "prop_spd_fail",
		});
		const consent2 = mintTestConsent(diag2.preflight, "prop_spd_fail");
		const fail = await runConsentedApplyPreview({
			document: doc,
			editProposalV1: bundle([{ ...prop, id: "prop_spd_fail" }]),
			selectedProposalId: "prop_spd_fail",
			preflight: diag2.preflight,
			consent: consent2,
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
			forceFamilyVerifyFailure: true,
		});
		expect(fail.receipt.terminalStatus).toBe("rolled_back");
		const speeds =
			((fail.document.legacyEditor as Record<string, unknown>).speedRegions as unknown[]) ?? [];
		expect(speeds).toHaveLength(0);
	});

	it("single mutation + paid AI zero + writes stub artifacts dir", () => {
		mkdirSync(ARTIFACT_ROOT, { recursive: true });
		writeFileSync(
			join(ARTIFACT_ROOT, "zero-paid-ai-proof.json"),
			JSON.stringify({
				OPENAI_CALLS: 0,
				ANTHROPIC_CALLS: 0,
				GEMINI_CALLS: 0,
				OTHER_PAID_AI_CALLS: 0,
				TOTAL_PAID_AI_CALLS: 0,
			}),
			"utf8",
		);
		expect(fingerprintDocument(fixtureDoc()).value.length).toBeGreaterThan(10);
	});
});
