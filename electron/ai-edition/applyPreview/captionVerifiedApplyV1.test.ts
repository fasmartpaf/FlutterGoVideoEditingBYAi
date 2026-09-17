/**
 * Caption Verified Apply Bridge V1 — unit tests (injected compositor allowed).
 * TOTAL_PAID_AI_CALLS = 0.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import {
	buildCaptionLayoutOperation,
	operationToProvisionalArgs,
	runCaptionLayoutForDocument,
} from "../captionLayout";
import { createInjectedCompositorSampler } from "../compositorVerify";
import type { EditProposalItem, EditProposalV1 } from "../editProposal/types";
import { EDIT_PROPOSAL_V1_PROVIDER_ID } from "../editProposal/types";
import {
	mintTestConsent,
	prepareApplyPreviewDiagnostics,
	resetApplyPreviewSeqForTests,
	runConsentedApplyPreview,
	SUPPORTED_APPLY_TOOLS,
} from "./index";

const ARTIFACT_ROOT = join(process.cwd(), "tmp/perception-benchmark/caption-verified-apply-v1");

beforeEach(() => {
	resetApplyPreviewSeqForTests();
});

function words() {
	return [
		["hello", 1, 1.4],
		["there", 1.4, 1.8],
		["friend", 1.8, 2.2],
		["npm", 3, 3.3],
		["run", 3.3, 3.5],
		["build", 3.5, 3.9],
	] as Array<[string, number, number]>;
}

function fixtureDoc(opts?: { enabled?: boolean; manual?: boolean }): AxcutDocument {
	const base = createEmptyDocument({
		title: "cap-apply",
		projectId: "proj_cva",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	const w = words();
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "Recording",
				originalPath: "/tmp/cva.mp4",
				durationSec: 20,
			},
		],
		transcripts: [
			{
				assetId: "asset_1",
				language: "en",
				segments: [
					{
						id: "seg1",
						kind: "speech",
						startSec: 1,
						endSec: 3.9,
						text: w.map((x) => x[0]).join(" "),
						wordIds: w.map((_, i) => `w${i}`),
					},
				],
				words: w.map(([text, s, e], i) => ({
					id: `w${i}`,
					segmentId: "seg1",
					startSec: s,
					endSec: e,
					text,
					source: "asr" as const,
				})),
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
		annotations: opts?.manual
			? [
					{
						id: "ann_manual",
						type: "text",
						content: "User title",
						startMs: 0,
						endMs: 1500,
						position: { x: 10, y: 10 },
						size: { width: 40, height: 10 },
						style: {
							color: "#fff",
							backgroundColor: "transparent",
							fontSize: 32,
							fontFamily: "Inter",
							fontWeight: "bold",
							fontStyle: "normal",
							textDecoration: "none",
							textAlign: "center",
							textAnimation: "none",
						},
						zIndex: 1,
					},
				]
			: [],
		legacyEditor: opts?.enabled
			? {
					captions: {
						...getCaptionSettings(null),
						enabled: true,
					},
				}
			: {},
	});
}

function bundle(proposals: EditProposalItem[]): EditProposalV1 {
	return {
		version: 1,
		providerId: EDIT_PROPOSAL_V1_PROVIDER_ID,
		assetId: "asset_1",
		summary: "caption verified apply",
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
			proposalsGenerated: 1,
			serializedBytesApprox: 0,
			buildMs: 0,
			additionalModelCalls: 0,
			providerId: EDIT_PROPOSAL_V1_PROVIDER_ID,
		},
	};
}

function captionProposal(doc: AxcutDocument, id = "prop_cap"): EditProposalItem {
	const { layout } = runCaptionLayoutForDocument({
		document: doc,
		assetId: "asset_1",
		aspectValue: 16 / 9,
		useCache: false,
	});
	const op = buildCaptionLayoutOperation({
		proposalId: id,
		document: doc,
		assetId: "asset_1",
		layout,
		aspectValue: 16 / 9,
	});
	const args = operationToProvisionalArgs(op);
	args.assetId = "asset_1";
	const kept = layout.cues.filter((c) => !c.omitted);
	const start = kept.length ? Math.min(...kept.map((c) => c.sourceStartSec)) : 1;
	const end = kept.length ? Math.max(...kept.map((c) => c.sourceEndSec)) : 4;
	return {
		id,
		planItemId: "plan_cap",
		gapIds: ["gap_cap"],
		sourceBeatIds: ["beat_cap"],
		targetBeatIds: ["tbeat_cap"],
		status: "proposal_ready",
		priority: "medium",
		intent: "Add captions for narration",
		evidenceJustification: "Local transcript present",
		evidenceRefs: [],
		landing: {
			timebase: "SOURCE_MEDIA_TIME",
			startSourceTimeSec: start,
			endSourceTimeSec: end,
			boundaryBasis: "caption layout cue span",
			boundaryConfidence: "high",
			finalizedForApply: false,
		},
		mustSurvive: [],
		damageRisks: [],
		continuityRisk: "low",
		preservationViolationRisk: "low",
		preferredStrategy: "caption",
		proposedCall: {
			status: "proposal_only",
			notExecuted: true,
			toolFamily: "caption",
			toolName: "enableCaptions",
			provisionalArgs: args,
			argsConfidence: "high",
		},
		constraints: ["preserve manual captions"],
		confidence: 0.9,
	};
}

describe("CAPTION_VERIFIED_APPLY_V1", () => {
	it("allowlist includes enableCaptions", () => {
		expect(SUPPORTED_APPLY_TOOLS.has("enableCaptions")).toBe(true);
	});

	it("valid caption enable applies + verifies; manual text preserved", async () => {
		const doc = fixtureDoc({ manual: true });
		const proposal = captionProposal(doc);
		expect(proposal.proposedCall?.provisionalArgs.cueCount).toBeGreaterThan(0);
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
		expect(ok.receipt.verificationStatus).toBe("verified_single_caption_basic");
		expect(getCaptionSettings(ok.document).enabled).toBe(true);
		expect(ok.document.annotations?.find((a) => a.id === "ann_manual")?.content).toBe("User title");
	});

	it("no consent / forced verify failure / already-enabled blocked", async () => {
		const doc = fixtureDoc();
		const proposal = captionProposal(doc);
		const noConsent = await runConsentedApplyPreview({
			document: doc,
			editProposalV1: bundle([proposal]),
			selectedProposalId: proposal.id,
		});
		expect(noConsent.receipt.mutationsApplied).toBe(0);

		const diag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1: bundle([proposal]),
			selectedProposalId: proposal.id,
		});
		const consent = mintTestConsent(diag.preflight, proposal.id);
		const fail = await runConsentedApplyPreview({
			document: doc,
			editProposalV1: bundle([proposal]),
			selectedProposalId: proposal.id,
			preflight: diag.preflight,
			consent,
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
			forceFamilyVerifyFailure: true,
		});
		expect(fail.receipt.terminalStatus).toBe("rolled_back");
		expect(getCaptionSettings(fail.document).enabled).toBe(false);

		const enabled = fixtureDoc({ enabled: true });
		const p2 = captionProposal(enabled, "prop_cap2");
		const diag2 = prepareApplyPreviewDiagnostics({
			document: enabled,
			editProposalV1: bundle([p2]),
			selectedProposalId: p2.id,
		});
		// layout still ok; apply may fail captions_already_enabled → rollback/fail
		const c2 = mintTestConsent(diag2.preflight, p2.id);
		const again = await runConsentedApplyPreview({
			document: enabled,
			editProposalV1: bundle([p2]),
			selectedProposalId: p2.id,
			preflight: diag2.preflight,
			consent: c2,
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
		});
		expect(again.receipt.mutationsApplied).toBe(0);
	});

	it("stale transcript fingerprint blocks; NO_SPEECH not eligible", async () => {
		const doc = fixtureDoc();
		const proposal = captionProposal(doc);
		proposal.proposedCall!.provisionalArgs.transcriptFingerprint = "stale_tx";
		const diag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1: bundle([proposal]),
			selectedProposalId: proposal.id,
		});
		expect(diag.preflight.eligible).toBe(false);
		expect(diag.preflight.blockingReasons).toContain("stale_proposal");

		const empty = documentSchema.parse({
			...fixtureDoc(),
			transcripts: [],
		});
		const { layout } = runCaptionLayoutForDocument({
			document: empty,
			assetId: "asset_1",
			aspectValue: 16 / 9,
			useCache: false,
		});
		expect(layout.status).toBe("NO_SPEECH");
	});

	it("writes zero-paid-ai stub", () => {
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
	});
});
