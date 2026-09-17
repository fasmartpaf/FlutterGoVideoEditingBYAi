/**
 * Quality-closure gap audit — diagnostic only (no product behavior change).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type AxcutDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import {
	createApplyConsent,
	prepareApplyPreviewDiagnostics,
	runConsentedApplyPreview,
} from "../applyPreview";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import {
	buildCaptionLayoutOperation,
	operationToProvisionalArgs,
	runCaptionLayoutForDocument,
	verifyCaptionLayoutRender,
} from "../captionLayout";
import { NativeCompositorFrameSampler } from "../compositorVerify";
import { analyzeDeadAir } from "../deadAir";
import type { EditProposalItem, EditProposalV1 } from "../editProposal/types";
import { EDIT_PROPOSAL_V1_PROVIDER_ID } from "../editProposal/types";
import { verifyFinalSequenceCutQuality } from "../finalSequenceCutQualityVerify";
import { runLoudnessNormalizeAnalysis } from "../loudness";

const OUT = path.join(
	process.cwd(),
	"tmp/perception-benchmark/professional-edit-quality-closure-v1",
);
const PROJECT = path.join(
	os.homedir(),
	"Library/Application Support/openscreen/projects/proj_e63f1a50-6a31-4074-b8e1-be6185c56c51.openscreen",
);
const MEDIA = path.join(
	os.homedir(),
	"Library/Application Support/openscreen/recordings/recording-1789424212470.mp4",
);

function write(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2), "utf8");
}

function stripAgentDeadAir(doc: AxcutDocument): AxcutDocument {
	return documentSchema.parse({
		...doc,
		timeline: {
			...doc.timeline,
			trimRanges: (doc.timeline.trimRanges ?? []).filter(
				(t) => !(t.origin === "agent" && /dead_air/i.test(t.reason ?? "")),
			),
		},
	});
}

function wrap(item: EditProposalItem, assetId: string): EditProposalV1 {
	return {
		version: 1,
		providerId: EDIT_PROPOSAL_V1_PROVIDER_ID,
		assetId,
		summary: item.intent,
		proposals: [item],
		deferredPlanItemIds: [],
		hardConstraints: ["audit"],
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

describe("quality-closure gap audit", () => {
	it("writes real-result-gap-audit.json", async () => {
		if (!existsSync(PROJECT) || !existsSync(MEDIA)) {
			write("real-result-gap-audit.json", { skipped: true, reason: "media_missing" });
			return;
		}

		const loaded = documentSchema.parse(JSON.parse(readFileSync(PROJECT, "utf8"))) as AxcutDocument;
		const baseline = stripAgentDeadAir(loaded);
		const asset =
			baseline.assets.find((a) => a.id === baseline.project.primaryAssetId) ?? baseline.assets[0]!;
		const assetId = asset.id;
		const mediaPath = asset.originalPath ?? MEDIA;

		// --- Caption timing: baseline (no trims) vs after dead-air trims ---
		const aspect = 16 / 9;
		const layout0 = runCaptionLayoutForDocument({
			document: baseline,
			assetId,
			aspectValue: aspect,
			useCache: false,
		}).layout;
		const sampler = new NativeCompositorFrameSampler({ appRoot: process.cwd() });
		const verify0 = await verifyCaptionLayoutRender({
			document: baseline,
			layout: layout0,
			aspectValue: aspect,
			sampler,
			requireNativeAuthoritative: true,
		});

		const dead = await analyzeDeadAir({
			assetId,
			mediaPath,
			document: baseline,
		});
		const safe = dead.candidates.filter((c) => c.safeToPropose && c.proposedTrimRange);

		let doc = baseline;
		const trimReceipts: unknown[] = [];
		for (const c of safe.slice(0, 2)) {
			const start = c.proposedTrimRange!.startSec;
			const end = c.proposedTrimRange!.endSec;
			const item: EditProposalItem = {
				id: `audit_trim_${c.id}`,
				planItemId: c.id,
				gapIds: [],
				sourceBeatIds: [],
				targetBeatIds: [],
				status: "proposal_ready",
				priority: "medium",
				intent: "audit trim",
				evidenceJustification: "audit",
				evidenceRefs: [],
				landing: {
					timebase: "SOURCE_MEDIA_TIME",
					startSourceTimeSec: start,
					endSourceTimeSec: end,
					boundaryBasis: "audit",
					boundaryConfidence: "high",
					finalizedForApply: false,
				},
				mustSurvive: [],
				damageRisks: [],
				continuityRisk: "low",
				preservationViolationRisk: "low",
				preferredStrategy: "trim",
				proposedCall: {
					status: "proposal_only",
					notExecuted: true,
					toolFamily: "trim",
					toolName: "addTrim",
					provisionalArgs: { assetId, startSec: start, endSec: end },
					argsConfidence: "high",
				},
				constraints: [],
				confidence: 0.8,
			};
			const proposal = wrap(item, assetId);
			const beforeFp = fingerprintDocument(doc).value;
			const diag = prepareApplyPreviewDiagnostics({
				document: doc,
				editProposalV1: proposal,
				proposalDocumentFingerprint: beforeFp,
			});
			const consent = createApplyConsent({
				proposalId: item.id,
				preflight: diag.preflight,
			});
			const result = await runConsentedApplyPreview({
				document: doc,
				editProposalV1: proposal,
				selectedProposalId: item.id,
				preflight: diag.preflight,
				consent,
				compositorFrameSampler: sampler,
				appRoot: process.cwd(),
			});
			trimReceipts.push({
				id: c.id,
				terminal: result.receipt.terminalStatus,
				notes: result.receipt.verificationNotes,
			});
			if (result.document) doc = result.document;
		}

		const layout1 = runCaptionLayoutForDocument({
			document: doc,
			assetId,
			aspectValue: aspect,
			useCache: false,
		}).layout;
		const verify1 = await verifyCaptionLayoutRender({
			document: doc,
			layout: layout1,
			aspectValue: aspect,
			sampler,
			requireNativeAuthoritative: true,
		});

		// Caption apply after trims
		const proposalId = "audit_cap";
		const op = buildCaptionLayoutOperation({
			proposalId,
			document: doc,
			assetId,
			layout: layout1,
			aspectValue: aspect,
		});
		const argsMap = operationToProvisionalArgs(op);
		argsMap.assetId = assetId;
		const capItem: EditProposalItem = {
			id: proposalId,
			planItemId: "cap",
			gapIds: [],
			sourceBeatIds: [],
			targetBeatIds: [],
			status: "proposal_ready",
			priority: "medium",
			intent: "enable captions",
			evidenceJustification: "audit",
			evidenceRefs: [],
			landing: {
				timebase: "SOURCE_MEDIA_TIME",
				startSourceTimeSec: 0,
				endSourceTimeSec: 1,
				boundaryBasis: "caption",
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
				provisionalArgs: argsMap,
				argsConfidence: "high",
			},
			constraints: [],
			confidence: 0.85,
		};
		const capProposal = wrap(capItem, assetId);
		const capFp = fingerprintDocument(doc).value;
		const capDiag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1: capProposal,
			proposalDocumentFingerprint: capFp,
		});
		const capConsent = createApplyConsent({
			proposalId,
			preflight: capDiag.preflight,
		});
		const capResult = await runConsentedApplyPreview({
			document: doc,
			editProposalV1: capProposal,
			selectedProposalId: proposalId,
			preflight: capDiag.preflight,
			consent: capConsent,
			compositorFrameSampler: sampler,
			appRoot: process.cwd(),
		});

		const loudness = await runLoudnessNormalizeAnalysis({
			assetId,
			mediaPath,
			document: baseline,
		});

		const qcDoc = capResult.document ?? doc;
		const finalQc = await verifyFinalSequenceCutQuality({
			document: qcDoc,
			assetId,
			useCache: false,
		});

		const abutting = layout1.cues
			.filter((c) => !c.omitted)
			.map((c) => ({
				id: c.id,
				start: c.programmeStartSec,
				end: c.programmeEndSec,
			}));

		const audit = {
			identity: "CURRENT_OPENSCREEN_PROFESSIONAL_EDIT_QUALITY_CLOSURE_V1",
			recording: MEDIA,
			questions: {
				A_captionVerifyFail: {
					failureNotes: capResult.receipt.verificationNotes,
					terminalStatus: capResult.receipt.terminalStatus,
					captionVerification: capResult.receipt.captionVerification ?? null,
					codePath:
						"captionLayout/verify.ts:verifyCaptionLayoutRender → timing_${phase}_unexpected when any caption annotation is active at midCue±0.12s",
				},
				B_failureClass: {
					staleProgrammeMapping: false,
					staleTranscriptFingerprint: false,
					captionLayoutCache: false,
					nativeCompositorSampling: !(capResult.receipt.verificationNotes ?? []).some((n) =>
						/native_compositor/.test(n),
					)
						? "native_ok_or_not_blocking"
						: "native_issue",
					sceneTiming: true,
					preflight: !capDiag.preflight.eligible ? capDiag.preflight.blockingReasons : "eligible",
					expectedProgrammeRanges: "rebuilt_after_trim_via_runCaptionLayoutForDocument",
					rootCause:
						"Abutting continuous caption cues: mid-cue before/after samples fall inside neighboring caption annotations. sceneCaptionsAt() counts ANY caption, so timing_before_unexpected + timing_after_unexpected fire even when the mid cue itself is correctly timed.",
					evidence: {
						verifyBaselineNoTrim: {
							passed: verify0.passed,
							blocking: verify0.blockingReasons,
							timingChecks: verify0.timingChecks,
						},
						verifyAfterTrims: {
							passed: verify1.passed,
							blocking: verify1.blockingReasons,
							timingChecks: verify1.timingChecks,
						},
						abuttingProgrammeCues: abutting,
					},
				},
				C_noZoom: {
					orchestratorPath:
						"professionalEditOrchestrator/run.ts → investigateFocalInRange with cursorSamples undefined/empty",
					classification: "cursor_focal_evidence_unavailable_at_orchestrator_call_site",
					not: [
						"recommendation_surface_suppressed",
						"execution_readiness_failed_after_candidate",
						"focal_became_stale_after_trim",
					],
					notes:
						"Plan only adds zoom when focalInvestigation.focalFound. Deep-agent invoke does not pass cursorSamples into runProfessionalEditOrchestrator. No OCR/visual-activity focal path in V1 investigation.",
				},
				D_loudness: {
					available: loudness.analysis.audioState === "present",
					classification: loudness.candidate?.classification ?? null,
					safeToPropose: loudness.candidate?.safeToPropose ?? false,
					whyNotInSession:
						"professionalEditOrchestrator never imports/runs loudness; plan families allow loudness but plan.ts never emits loudness steps",
					analysis: {
						integratedLufs: loudness.analysis.integratedLufs,
						truePeakDbTp: loudness.analysis.truePeakDbTp,
						audioState: loudness.analysis.audioState,
					},
				},
				E_finalSequenceWarnings: {
					overall: finalQc.overall,
					joins: finalQc.joins.map((j) => ({
						joinId: j.join.joinId,
						overall: j.overall,
						warnings: j.warnings,
						blocking: j.blockingReasons,
						speech: j.speech?.outcome,
						audio: j.audio?.outcome,
						visual: j.visual?.outcome,
						captions: j.captions?.outcome,
						speed: j.speed?.outcome,
						preservation: j.preservation?.outcome,
					})),
					dispositionsDraft: finalQc.joins.flatMap((j) =>
						j.warnings.map((w) => ({
							warning: w,
							joinId: j.join.joinId,
							draft: /intentional|hard.?cut|visual_discontinuity/i.test(w)
								? "ACCEPTABLE_INTENTIONAL"
								: /caption/i.test(w)
									? "ACTIONABLE_EXISTING_CAPABILITY"
									: /insufficient|unknown|missing/i.test(w)
										? "INSUFFICIENT_EVIDENCE"
										: "NEEDS_USER_REVIEW",
						})),
					),
				},
			},
			trimReceipts,
			safeDeadAirCount: safe.length,
		};

		write("real-result-gap-audit.json", audit);
		expect(audit.questions.A_captionVerifyFail.codePath).toMatch(/captionLayout\/verify/);
	}, 180_000);
});
