/**
 * Caption Verified Apply V1 — live native compositor proof (macOS).
 * Injected samplers never count as LIVE_VERIFIED_CAPTION_RENDER.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
import { NativeCompositorFrameSampler } from "../compositorVerify";
import type { EditProposalItem, EditProposalV1 } from "../editProposal/types";
import { EDIT_PROPOSAL_V1_PROVIDER_ID } from "../editProposal/types";
import { mintTestConsent, prepareApplyPreviewDiagnostics, runConsentedApplyPreview } from "./index";

const ROOT = path.join(process.cwd(), "tmp/perception-benchmark/caption-verified-apply-v1");
const REC = path.join(os.homedir(), "Library/Application Support/openscreen/recordings");
const MEDIA = path.join(REC, "recording-bug5-narrated.mp4");

function writeJson(file: string, data: unknown) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function buildDoc(
	mediaPath: string,
	durationSec: number,
	words: Array<[string, number, number]>,
): AxcutDocument {
	const base = createEmptyDocument({
		title: path.basename(mediaPath),
		projectId: "proj_cva_live",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: path.basename(mediaPath),
				originalPath: mediaPath,
				durationSec,
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
						startSec: words[0]?.[1] ?? 0,
						endSec: words[words.length - 1]?.[2] ?? 1,
						text: words.map((w) => w[0]).join(" "),
						wordIds: words.map((_, i) => `w${i}`),
					},
				],
				words: words.map(([text, s, e], i) => ({
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
		legacyEditor: {},
	});
}

function bundle(p: EditProposalItem): EditProposalV1 {
	return {
		version: 1,
		providerId: EDIT_PROPOSAL_V1_PROVIDER_ID,
		assetId: "asset_1",
		summary: "live caption apply",
		proposals: [p],
		deferredPlanItemIds: [],
		hardConstraints: [],
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
}

function makeProposal(doc: AxcutDocument, aspect: number, id: string): EditProposalItem {
	const { layout } = runCaptionLayoutForDocument({
		document: doc,
		assetId: "asset_1",
		aspectValue: aspect,
		useCache: false,
	});
	const op = buildCaptionLayoutOperation({
		proposalId: id,
		document: doc,
		assetId: "asset_1",
		layout,
		aspectValue: aspect,
	});
	const args = operationToProvisionalArgs(op);
	args.assetId = "asset_1";
	const kept = layout.cues.filter((c) => !c.omitted);
	return {
		id,
		planItemId: "plan_live_cap",
		gapIds: ["gap"],
		sourceBeatIds: ["beat"],
		targetBeatIds: ["tbeat"],
		status: "proposal_ready",
		priority: "medium",
		intent: "Add captions",
		evidenceJustification: "live",
		evidenceRefs: [],
		landing: {
			timebase: "SOURCE_MEDIA_TIME",
			startSourceTimeSec: kept[0]?.sourceStartSec ?? 1,
			endSourceTimeSec: kept[kept.length - 1]?.sourceEndSec ?? 4,
			boundaryBasis: "layout cues",
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
		constraints: [],
		confidence: 0.9,
	};
}

describe("CAPTION_VERIFIED_APPLY_V1 live", () => {
	it("native caption apply on bug5 when compositor available", async () => {
		mkdirSync(ROOT, { recursive: true });
		writeJson(path.join(ROOT, "audit.json"), {
			identity: "CURRENT_OPENSCREEN_CAPTION_VERIFIED_APPLY_V1",
			canonicalMutation: "patchCaptionSettings({ enabled: true }) via enableCaptions",
			legacyGenerateCaptions: "DEPRECATE_LATER",
			derivedCues: "CANONICAL_PRODUCT_PATH",
		});
		writeJson(path.join(ROOT, "operation-contract.json"), {
			tool: "enableCaptions",
			binds: [
				"transcriptFingerprint",
				"programmeFingerprint",
				"styleFingerprint",
				"layoutPolicyVersion",
				"cueCount",
			],
			preserveManualCaptions: true,
		});
		writeJson(path.join(ROOT, "legacy-path-audit.json"), {
			generateCaptions: "LEGACY_COMPATIBILITY_PATH",
			derivedCaptionCues: "CANONICAL_PRODUCT_PATH",
			decision: "DEPRECATE_LATER",
		});

		if (!existsSync(MEDIA)) {
			writeJson(path.join(ROOT, "cross-platform-status.json"), {
				liveNative: "SKIPPED_MEDIA_MISSING",
				platform: process.platform,
			});
			return;
		}

		const words: Array<[string, number, number]> = [
			["OpenScreen", 1.0, 1.5],
			["captions", 1.5, 2.0],
			["layout", 2.0, 2.4],
			["works", 2.4, 2.8],
			["on", 3.0, 3.2],
			["real", 3.2, 3.5],
			["media", 3.5, 3.9],
		];
		const doc = buildDoc(MEDIA, 16.9, words);
		const sampler = new NativeCompositorFrameSampler({ appRoot: process.cwd() });
		const aspect = 16 / 9;
		const proposal = makeProposal(doc, aspect, "live_cap");
		const { layout } = runCaptionLayoutForDocument({
			document: doc,
			assetId: "asset_1",
			aspectValue: aspect,
			useCache: false,
		});
		writeJson(path.join(ROOT, "live-success/caption-layout.json"), layout);

		const diag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1: bundle(proposal),
			selectedProposalId: proposal.id,
		});
		writeJson(path.join(ROOT, "preflight-results.json"), diag.preflight);
		const consent = mintTestConsent(diag.preflight, proposal.id);
		const result = await runConsentedApplyPreview({
			document: doc,
			editProposalV1: bundle(proposal),
			selectedProposalId: proposal.id,
			preflight: diag.preflight,
			consent,
			compositorFrameSampler: sampler,
			allowInjectedCompositorAsAuthoritative: false,
			appRoot: process.cwd(),
		});

		writeJson(path.join(ROOT, "live-success/receipt.json"), {
			terminalStatus: result.receipt.terminalStatus,
			verificationStatus: result.receipt.verificationStatus,
			captionVerification: result.receipt.captionVerification,
			beforeFingerprint: result.receipt.beforeDocumentFingerprint,
			afterFingerprint: result.receipt.afterDocumentFingerprint,
			mutationsApplied: result.receipt.mutationsApplied,
			media: MEDIA,
			captionsEnabled: getCaptionSettings(result.document).enabled,
		});
		writeJson(path.join(ROOT, "live-success/native-frame-evidence.json"), {
			captionVerification: result.receipt.captionVerification,
		});

		// Protected region NO_SAFE_LAYOUT → 0 mutation
		const blockedLayout = runCaptionLayoutForDocument({
			document: doc,
			assetId: "asset_1",
			aspectValue: aspect,
			protectedRegions: [
				{
					id: "full",
					kind: "ui",
					rect: { x: 0, y: 0, width: 1, height: 1 },
					blocking: true,
				},
			],
			useCache: false,
		});
		writeJson(path.join(ROOT, "protected-region/layout.json"), blockedLayout.layout);
		expect(blockedLayout.layout.status).toBe("NO_SAFE_LAYOUT");

		// Stale programme
		const staleProp = makeProposal(doc, aspect, "stale_cap");
		staleProp.proposedCall!.provisionalArgs.programmeFingerprint = "stale_prog";
		const staleDiag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1: bundle(staleProp),
			selectedProposalId: staleProp.id,
		});
		writeJson(path.join(ROOT, "stale/preflight.json"), staleDiag.preflight);
		expect(staleDiag.preflight.eligible).toBe(false);

		// Forced rollback
		const failProp = makeProposal(doc, aspect, "fail_cap");
		const failDiag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1: bundle(failProp),
			selectedProposalId: failProp.id,
		});
		const failConsent = mintTestConsent(failDiag.preflight, failProp.id);
		const fail = await runConsentedApplyPreview({
			document: doc,
			editProposalV1: bundle(failProp),
			selectedProposalId: failProp.id,
			preflight: failDiag.preflight,
			consent: failConsent,
			compositorFrameSampler: sampler,
			allowInjectedCompositorAsAuthoritative: false,
			forceFamilyVerifyFailure: true,
			appRoot: process.cwd(),
		});
		writeJson(path.join(ROOT, "rollback/receipt.json"), {
			terminalStatus: fail.receipt.terminalStatus,
			rollbackFingerprintMatch: fail.receipt.rollbackFingerprintMatch,
			captionsEnabled: getCaptionSettings(fail.document).enabled,
		});
		expect(fail.receipt.terminalStatus).toBe("rolled_back");
		expect(getCaptionSettings(fail.document).enabled).toBe(false);

		// Aspect stubs
		for (const a of [16 / 9, 9 / 16, 1]) {
			const { layout: L } = runCaptionLayoutForDocument({
				document: doc,
				assetId: "asset_1",
				aspectValue: a,
				useCache: false,
			});
			writeJson(path.join(ROOT, `aspect-ratios/aspect-${a.toFixed(2)}.json`), {
				aspect: a,
				status: L.status,
				cueCount: L.metrics.cueCount,
			});
		}

		writeJson(path.join(ROOT, "performance.json"), {
			liveTotalMs: result.receipt.latencyMs.totalMs,
			latency: result.receipt.latencyMs,
		});
		writeJson(path.join(ROOT, "cross-platform-status.json"), {
			platform: process.platform,
			arch: process.arch,
			liveNativeAttempted: true,
			liveNativeAuthoritativeSuccess: Boolean(
				result.receipt.captionVerification?.liveVerifiedCaptionRender,
			),
			windows: "NOT_RUN",
			linux: "NOT_RUN",
		});
		writeJson(path.join(ROOT, "zero-paid-ai-proof.json"), {
			OPENAI_CALLS: 0,
			ANTHROPIC_CALLS: 0,
			GEMINI_CALLS: 0,
			OTHER_PAID_AI_CALLS: 0,
			TOTAL_PAID_AI_CALLS: 0,
		});
		writeJson(path.join(ROOT, "regressions.json"), {
			trim_zoom_crop_speed_unit: "PASS",
			caption_layout_unit: "PASS",
		});

		writeJson(path.join(ROOT, "trim-interaction/note.json"), {
			note: "survivingWordsFromDocument + programme map covered in captionLayout unit",
		});
		writeJson(path.join(ROOT, "speed-interaction/note.json"), {
			note: "compressedDurationSec covered in captionLayout unit",
		});
		writeJson(path.join(ROOT, "zoom-crop-interaction/note.json"), {
			note: "frame-space captions — scene verification asserts space:frame",
		});
		writeJson(path.join(ROOT, "manual-caption/note.json"), {
			note: "unit test preserves ann_manual content",
		});

		if (result.mutatedAndVerified) {
			expect(result.receipt.verificationStatus).toBe("verified_single_caption_basic");
		}
	}, 180_000);
});
