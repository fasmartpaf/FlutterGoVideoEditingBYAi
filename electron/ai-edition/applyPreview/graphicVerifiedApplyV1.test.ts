/**
 * Graphic Verified Apply V1 — metadata + injected compositor path.
 */

import { describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { createInjectedCompositorSampler } from "../compositorVerify";
import type { EditProposalItem, EditProposalV1 } from "../editProposal/types";
import { EDIT_PROPOSAL_V1_PROVIDER_ID } from "../editProposal/types";
import { VERIFIED_APPLY_TOOLS } from "./familyPreflight";
import {
	createApplyConsent,
	prepareApplyPreviewDiagnostics,
	runConsentedApplyPreview,
} from "./index";

function fixtureDoc(): AxcutDocument {
	const base = createEmptyDocument({
		title: "graphic-apply",
		projectId: "proj_graphic",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "t.mp4",
				originalPath: "/tmp/graphic.mp4",
				durationSec: 20,
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
		},
		annotations: [],
	});
}

function titleProposal(): EditProposalItem {
	return {
		id: "prop_title_1",
		planItemId: "step_title_1",
		gapIds: [],
		sourceBeatIds: [],
		targetBeatIds: [],
		status: "proposal_ready",
		priority: "medium",
		intent: "Opening title",
		evidenceJustification: "Grounded intro speech",
		evidenceRefs: [],
		landing: {
			timebase: "SOURCE_MEDIA_TIME",
			startSourceTimeSec: 0.15,
			endSourceTimeSec: 2.8,
			boundaryBasis: "professional_editorial_title",
			boundaryConfidence: "medium",
			finalizedForApply: false,
		},
		mustSurvive: [],
		damageRisks: [],
		continuityRisk: "low",
		preservationViolationRisk: "low",
		preferredStrategy: "graphic",
		proposedCall: {
			status: "proposal_only",
			notExecuted: true,
			toolFamily: "graphic",
			toolName: "addGraphic",
			provisionalArgs: {
				assetId: "asset_1",
				kind: "title",
				text: "Creating a New Project",
				startSec: 0.15,
				endSec: 2.8,
				textAnimation: "fade",
			},
			argsConfidence: "medium",
		},
		constraints: [],
		confidence: 0.7,
	};
}

describe("GRAPHIC_VERIFIED_APPLY_V1", () => {
	it("allowlists addGraphic", () => {
		expect(VERIFIED_APPLY_TOOLS.has("addGraphic")).toBe(true);
	});

	it("applies title graphic with injected compositor verify + rollback safety", async () => {
		const doc = fixtureDoc();
		const item = titleProposal();
		const proposal: EditProposalV1 = {
			version: 1,
			providerId: EDIT_PROPOSAL_V1_PROVIDER_ID,
			assetId: "asset_1",
			summary: item.intent,
			proposals: [item],
			deferredPlanItemIds: [],
			hardConstraints: ["single_mutation"],
			quality: {
				proposalCount: 1,
				proposalReadyCount: 1,
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
				proposalsGenerated: 1,
				serializedBytesApprox: 0,
				buildMs: 0,
				additionalModelCalls: 0,
				providerId: EDIT_PROPOSAL_V1_PROVIDER_ID,
			},
		};
		const diag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1: proposal,
		});
		expect(diag.preflight.eligible).toBe(true);
		const consent = createApplyConsent({
			proposalId: item.id,
			preflight: diag.preflight,
		});
		const sampler = createInjectedCompositorSampler({ mode: "valid" });
		const result = await runConsentedApplyPreview({
			document: doc,
			editProposalV1: proposal,
			selectedProposalId: item.id,
			preflight: diag.preflight,
			consent,
			compositorFrameSampler: sampler,
			allowInjectedCompositorAsAuthoritative: true,
		});
		expect(result.receipt.terminalStatus).toBe("verified");
		expect(result.mutatedAndVerified).toBe(true);
		expect(result.document?.annotations?.length).toBeGreaterThan(0);
		expect(result.receipt.graphicVerification?.status).toMatch(/LIVE_VERIFIED|verified/);
	});
});
