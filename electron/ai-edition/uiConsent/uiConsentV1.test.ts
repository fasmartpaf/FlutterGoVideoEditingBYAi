/**
 * UI Consent Surface V1 — review-card adapter + policy tests.
 * @vitest-environment jsdom
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { prepareApplyPreviewDiagnostics } from "../applyPreview";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import type { EditProposalItem, EditProposalV1 } from "../editProposal/types";
import { EDIT_PROPOSAL_V1_PROVIDER_ID } from "../editProposal/types";
import { buildEditReviewAttachment, buildEditReviewCard, UI_CONSENT_V1_PROVIDER_ID } from "./index";

const ARTIFACT_DIR = join(process.cwd(), "tmp/perception-benchmark/ui-consent-v1");

function writeArtifact(name: string, body: unknown): void {
	mkdirSync(ARTIFACT_DIR, { recursive: true });
	writeFileSync(join(ARTIFACT_DIR, name), JSON.stringify(body, null, 2), "utf8");
}

function fixtureDocument(): AxcutDocument {
	const base = createEmptyDocument({
		title: "UiConsent",
		projectId: "proj_uc",
		createdAt: "2026-01-01T00:00:00.000Z",
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
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId: "asset_1",
					sourceStartSec: 0,
					sourceEndSec: 60,
					timelineStartSec: 0,
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

function readyTrim(overrides: Partial<EditProposalItem> = {}): EditProposalItem {
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
		evidenceRefs: [],
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
				text: "The corrected Effects explanation",
				sourceBeatIds: ["beat_fx"],
				reason: "survive:8-12",
			},
		],
		damageRisks: [
			{
				kind: "speech_meaning",
				level: "low",
				description: "Trim is silence-only",
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

describe("UI Consent Surface V1", () => {
	it("provider identity", () => {
		expect(UI_CONSENT_V1_PROVIDER_ID).toBe("CURRENT_OPENSCREEN_UI_CONSENT_V1");
	});

	it("1. ready proposal → canApply", () => {
		const doc = fixtureDocument();
		const p = readyTrim();
		const editProposalV1 = bundle([p]);
		const diag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1,
			selectedProposalId: p.id,
			proposalDocumentFingerprint: fingerprintDocument(doc).value,
		});
		const card = buildEditReviewCard({
			proposal: p,
			preflight: diag.preflight,
			documentFingerprint: diag.preflight.documentFingerprint.value,
		});
		expect(card.canApply).toBe(true);
		expect(card.readiness).toBe("ready");
		expect(card.title).toMatch(/quiet pause/i);
		expect(card.preserves.some((x) => /Effects/i.test(x))).toBe(true);
		expect(card.explanation).not.toMatch(/epistemic|Claim Promotion|Edit Gap/i);
		writeArtifact("ready-card.json", card);
	});

	it("2–5. provisional / no_safe / needs_more / unsupported → no Apply", () => {
		const doc = fixtureDocument();
		const fp = fingerprintDocument(doc).value;
		for (const status of [
			"provisional",
			"no_safe_proposal",
			"needs_more_evidence",
			"unsupported",
		] as const) {
			const card = buildEditReviewCard({
				proposal: readyTrim({ id: `p_${status}`, status }),
				preflight: null,
				documentFingerprint: fp,
			});
			expect(card.canApply).toBe(false);
			expect(card.readiness).toBe("blocked");
		}
	});

	it("7–9. human language + preservation + risks only when relevant", () => {
		const quiet = buildEditReviewCard({
			proposal: readyTrim(),
			preflight: {
				id: "pf",
				proposalId: "prop_dead_air",
				eligible: true,
				blockingReasons: [],
				documentFingerprint: {
					algorithm: "json_sha256_relevant",
					value: "x",
					scope: "",
				},
				mustSurviveIds: [],
				damageRiskLevels: [],
				stale: false,
				preflightMs: 0,
			},
			documentFingerprint: "x",
		});
		expect(quiet.risks).toHaveLength(0);
		expect(quiet.preserves.length).toBeGreaterThan(0);

		const risky = buildEditReviewCard({
			proposal: readyTrim({
				id: "near",
				continuityRisk: "high",
				damageRisks: [
					{
						kind: "speech_meaning",
						level: "medium",
						description: "Cut is near speech",
					},
				],
			}),
			preflight: {
				id: "pf2",
				proposalId: "near",
				eligible: true,
				blockingReasons: [],
				documentFingerprint: {
					algorithm: "json_sha256_relevant",
					value: "x",
					scope: "",
				},
				mustSurviveIds: [],
				damageRiskLevels: [],
				stale: false,
				preflightMs: 0,
			},
			documentFingerprint: "x",
		});
		expect(risky.risks.length).toBeGreaterThan(0);
		expect(risky.risks.join(" ")).toMatch(/audio|speech/i);
	});

	it("21–24. Case 2 / Case 4 / Upwork / Settings — no actionable Apply", () => {
		const fp = "fp";
		const case2 = buildEditReviewCard({
			proposal: readyTrim({
				id: "case2",
				status: "no_safe_proposal",
				intent: "HUD Restart recording visible",
				preferredStrategy: "crop",
				rejectionReason:
					"OpenScreen noticed the recording controls near the end, but there isn’t a safe edit that removes them without risking useful content.",
			}),
			preflight: null,
			documentFingerprint: fp,
		});
		expect(case2.canApply).toBe(false);
		expect(case2.explanation).toMatch(/safe edit/i);

		const case4 = buildEditReviewCard({
			proposal: readyTrim({
				id: "case4",
				status: "provisional",
				intent: "Timeline wording could potentially be shortened",
			}),
			preflight: null,
			documentFingerprint: fp,
		});
		expect(case4.canApply).toBe(false);

		const upwork = buildEditReviewCard({
			proposal: readyTrim({
				id: "upwork",
				status: "no_safe_proposal",
				intent: "Upwork tab visible in background",
				rejectionReason: "Visible tab is not evidence of workflow activity.",
			}),
			preflight: null,
			documentFingerprint: fp,
		});
		expect(upwork.canApply).toBe(false);
		expect(upwork.explanation).not.toMatch(/navigat|browsing jobs/i);

		const settings = buildEditReviewCard({
			proposal: readyTrim({
				id: "settings",
				status: "unsupported",
				preferredStrategy: "zoom",
				intent: "Zoom around Settings",
			}),
			preflight: null,
			documentFingerprint: fp,
		});
		expect(settings.canApply).toBe(false);
		writeArtifact("blocked-cases.json", { case2, case4, upwork, settings });
	});

	it("attachment selects ready card + 0 LLM", () => {
		const doc = fixtureDocument();
		const editProposalV1 = bundle([
			readyTrim({ id: "blocked", status: "no_safe_proposal" }),
			readyTrim({ id: "ready" }),
		]);
		const diag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1,
			selectedProposalId: "ready",
			proposalDocumentFingerprint: fingerprintDocument(doc).value,
		});
		const att = buildEditReviewAttachment({
			editProposalV1,
			preflight: diag.preflight,
			documentFingerprint: diag.preflight.documentFingerprint.value,
		});
		expect(att.providerId).toBe(UI_CONSENT_V1_PROVIDER_ID);
		expect(att.additionalModelCalls).toBe(0);
		expect(att.cards.some((c) => c.canApply)).toBe(true);
		writeArtifact("attachment.json", {
			providerId: att.providerId,
			selectedProposalId: att.selectedProposalId,
			cards: att.cards,
		});
	});

	it("identity artifact", () => {
		writeArtifact("identity.json", {
			providerId: UI_CONSENT_V1_PROVIDER_ID,
			preserved: [
				"CURRENT_OPENSCREEN_APPLY_PREVIEW_V1",
				"CURRENT_OPENSCREEN_RENDER_VERIFY_V1",
				"CURRENT_OPENSCREEN_COMPOSITOR_VERIFY_V1",
				"CURRENT_OPENSCREEN_AUDIO_VERIFY_V1",
				"CURRENT_OPENSCREEN_UI_CONSENT_V1",
			],
		});
	});
});
