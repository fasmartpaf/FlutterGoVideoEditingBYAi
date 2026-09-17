/**
 * Multi-step session: sequential single verified applies + revalidation.
 */

import { randomUUID } from "node:crypto";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import {
	createApplyConsent,
	prepareApplyPreviewDiagnostics,
	runConsentedApplyPreview,
} from "../applyPreview";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import type { AudioPcmProvider } from "../audioVerify";
import {
	buildCaptionLayoutOperation,
	operationToProvisionalArgs,
	runCaptionLayoutForDocument,
} from "../captionLayout";
import {
	mapSourceSpanThroughDocument,
	sourceInstantSurvivesPlayback,
} from "../captionLayout/programmeMap";
import type { CompositedFrameSampler } from "../compositorVerify";
import type { EditProposalItem, EditProposalV1 } from "../editProposal/types";
import { EDIT_PROPOSAL_V1_PROVIDER_ID } from "../editProposal/types";
import { authorizationStillValid } from "./authorization";
import { type EditCollisionRecordV1, recordCollision } from "./collision";
import type { GroundedFocalTargetV1 } from "./focal";
import { remapGroundedFocalAfterMutation } from "./focal";
import type {
	PlanAuthorizationV1,
	ProfessionalEditExecutionSessionV1,
	ProfessionalEditPlanStepV1,
	ProfessionalEditPlanV1,
} from "./types";

function refreshTimedGraphicStepAgainstDocument(
	step: ProfessionalEditPlanStepV1,
	doc: AxcutDocument,
	assetId: string,
): { step: ProfessionalEditPlanStepV1; disposition: EditCollisionRecordV1 } {
	const sourceStart = Number(step.operationArgs.sourceStartSec ?? step.sourceStartSec);
	const sourceEnd = Number(step.operationArgs.sourceEndSec ?? step.sourceEndSec);
	if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || !(sourceEnd > sourceStart)) {
		return {
			step: { ...step, executionReadiness: "STALE_REPLAN_REQUIRED" },
			disposition: recordCollision({
				stepId: step.stepId,
				family: step.family,
				disposition: "STALE",
				reason: "missing_source_range",
			}),
		};
	}
	const mid = (sourceStart + sourceEnd) / 2;
	if (!sourceInstantSurvivesPlayback(doc, assetId, mid)) {
		return {
			step: { ...step, executionReadiness: "NO_LONGER_NEEDED" },
			disposition: recordCollision({
				stepId: step.stepId,
				family: step.family,
				disposition: "STALE",
				reason: "source_range_removed_by_trim",
			}),
		};
	}
	const mapped = mapSourceSpanThroughDocument(doc, assetId, sourceStart, sourceEnd);
	const first = mapped[0];
	if (!first) {
		return {
			step: { ...step, executionReadiness: "STALE_REPLAN_REQUIRED" },
			disposition: recordCollision({
				stepId: step.stepId,
				family: step.family,
				disposition: "STALE",
				reason: "programme_remap_empty",
			}),
		};
	}
	const last = mapped[mapped.length - 1]!;
	return {
		step: {
			...step,
			executionReadiness: "READY",
			sourceStartSec: sourceStart,
			sourceEndSec: sourceEnd,
			operationArgs: {
				...step.operationArgs,
				startSec: first.startSec,
				endSec: last.endSec,
				sourceStartSec: sourceStart,
				sourceEndSec: sourceEnd,
				remapDisposition: "STALE_BUT_REMAPPABLE",
			},
			proposalItemId: `prop_orch_${step.family}_${randomUUID().slice(0, 8)}`,
		},
		disposition: recordCollision({
			stepId: step.stepId,
			family: step.family,
			disposition: "REMAPPED",
			reason: "source_span_remapped_after_trim",
		}),
	};
}

function refreshZoomStepAgainstDocument(
	step: ProfessionalEditPlanStepV1,
	doc: AxcutDocument,
	assetId: string,
): ProfessionalEditPlanStepV1 {
	if (step.family !== "zoom") return step;
	const sourceStart = Number(step.operationArgs.sourceStartSec ?? step.sourceStartSec);
	const sourceEnd = Number(step.operationArgs.sourceEndSec ?? step.sourceEndSec);
	const focus = step.operationArgs.focus as { cx?: number; cy?: number } | undefined;
	if (
		!Number.isFinite(sourceStart) ||
		!Number.isFinite(sourceEnd) ||
		!Number.isFinite(focus?.cx) ||
		!Number.isFinite(focus?.cy)
	) {
		return { ...step, executionReadiness: "STALE_REPLAN_REQUIRED" };
	}
	const focal: GroundedFocalTargetV1 = {
		version: 1,
		sourceRange: { startSec: sourceStart, endSec: sourceEnd },
		focal: { cx: focus!.cx!, cy: focus!.cy! },
		evidenceType: "cursor_stable_cluster",
		evidenceRefs: step.evidenceRefs,
		confidence: "medium",
		reason: step.reason,
		programmeRanges: [],
		survivesCurrentPlayback: true,
		notes: [],
	};
	const remapped = remapGroundedFocalAfterMutation({
		document: doc,
		assetId,
		focal,
	});
	if (!remapped.candidate) {
		return {
			...step,
			executionReadiness:
				remapped.disposition === "STALE_AND_INVALID" ? "NO_LONGER_NEEDED" : "STALE_REPLAN_REQUIRED",
		};
	}
	const c = remapped.candidate;
	return {
		...step,
		executionReadiness: "READY",
		operationArgs: {
			depth: c.depth,
			focus: { cx: c.focus.cx, cy: c.focus.cy },
			startSec: c.programmeStartSec,
			endSec: c.programmeEndSec,
			sourceStartSec: c.sourceStartSec,
			sourceEndSec: c.sourceEndSec,
			remapDisposition: c.remapDisposition,
		},
		proposalItemId: `prop_orch_zoom_${randomUUID().slice(0, 8)}`,
	};
}

function wrapProposal(assetId: string, item: EditProposalItem): EditProposalV1 {
	return {
		version: 1,
		providerId: EDIT_PROPOSAL_V1_PROVIDER_ID,
		assetId,
		summary: item.intent,
		proposals: [item],
		deferredPlanItemIds: [],
		hardConstraints: ["professional_edit_orchestrator_v1", "single_mutation"],
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

function stepToProposalItem(
	step: ProfessionalEditPlanStepV1,
	assetId: string,
): EditProposalItem | null {
	if (step.family === "trim" && step.operationType === "addTrim") {
		const start = Number(step.operationArgs.startSec ?? step.sourceStartSec);
		const end = Number(step.operationArgs.endSec ?? step.sourceEndSec);
		if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return null;
		return {
			id: step.proposalItemId ?? step.stepId,
			planItemId: step.stepId,
			gapIds: [],
			sourceBeatIds: [],
			targetBeatIds: [],
			status: "proposal_ready",
			priority: "medium",
			intent: step.reason,
			evidenceJustification: step.expectedEffect,
			evidenceRefs: [],
			landing: {
				timebase: "SOURCE_MEDIA_TIME",
				startSourceTimeSec: start,
				endSourceTimeSec: end,
				boundaryBasis: "professional_edit_orchestrator_v1",
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
				provisionalArgs: {
					assetId,
					startSec: start,
					endSec: end,
					startSourceTimeSec: start,
					endSourceTimeSec: end,
					...step.operationArgs,
				},
				argsConfidence: "high",
			},
			constraints: [],
			confidence: 0.8,
		};
	}
	if (step.family === "captions" && step.operationType === "enableCaptions") {
		return {
			id: step.proposalItemId ?? step.stepId,
			planItemId: step.stepId,
			gapIds: [],
			sourceBeatIds: [],
			targetBeatIds: [],
			status: "proposal_ready",
			priority: "medium",
			intent: step.reason,
			evidenceJustification: step.expectedEffect,
			evidenceRefs: [],
			landing: {
				timebase: "SOURCE_MEDIA_TIME",
				startSourceTimeSec: 0,
				endSourceTimeSec: 1,
				boundaryBasis: "caption_enable",
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
				provisionalArgs: { ...step.operationArgs, assetId },
				argsConfidence: "high",
			},
			constraints: ["preserve_manual_captions"],
			confidence: 0.85,
		};
	}
	if (step.family === "zoom" && step.operationType === "addZoom") {
		const start = Number(step.operationArgs.startSec ?? step.sourceStartSec);
		const end = Number(step.operationArgs.endSec ?? step.sourceEndSec);
		const focus = step.operationArgs.focus as { cx?: number; cy?: number } | undefined;
		const cx = Number(focus?.cx);
		const cy = Number(focus?.cy);
		if (
			!Number.isFinite(start) ||
			!Number.isFinite(end) ||
			!(end > start) ||
			!Number.isFinite(cx) ||
			!Number.isFinite(cy)
		) {
			return null;
		}
		return {
			id: step.proposalItemId ?? step.stepId,
			planItemId: step.stepId,
			gapIds: [],
			sourceBeatIds: [],
			targetBeatIds: [],
			status: "proposal_ready",
			priority: "low",
			intent: step.reason,
			evidenceJustification: step.expectedEffect,
			evidenceRefs: [],
			landing: {
				timebase: "SOURCE_MEDIA_TIME",
				startSourceTimeSec: start,
				endSourceTimeSec: end,
				boundaryBasis: "professional_edit_focal",
				boundaryConfidence: "medium",
				finalizedForApply: false,
			},
			mustSurvive: [],
			damageRisks: [],
			continuityRisk: "medium",
			preservationViolationRisk: "low",
			preferredStrategy: "zoom",
			proposedCall: {
				status: "proposal_only",
				notExecuted: true,
				toolFamily: "zoom",
				toolName: "addZoom",
				provisionalArgs: {
					assetId,
					startSec: start,
					endSec: end,
					depth: Number(step.operationArgs.depth ?? 2),
					focus: { cx, cy },
				},
				argsConfidence: "medium",
			},
			constraints: [],
			confidence: 0.7,
		};
	}
	if (step.family === "speed" && step.operationType === "addSpeed") {
		const start = Number(step.operationArgs.startSec ?? step.sourceStartSec);
		const end = Number(step.operationArgs.endSec ?? step.sourceEndSec);
		const speed = Number(step.operationArgs.speed ?? 1.5);
		if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start) || !(speed > 1)) {
			return null;
		}
		return {
			id: step.proposalItemId ?? step.stepId,
			planItemId: step.stepId,
			gapIds: [],
			sourceBeatIds: [],
			targetBeatIds: [],
			status: "proposal_ready",
			priority: "medium",
			intent: step.reason,
			evidenceJustification: step.expectedEffect,
			evidenceRefs: [],
			landing: {
				timebase: "SOURCE_MEDIA_TIME",
				startSourceTimeSec: start,
				endSourceTimeSec: end,
				boundaryBasis: "professional_editorial_planner_v1",
				boundaryConfidence: "medium",
				finalizedForApply: false,
			},
			mustSurvive: [],
			damageRisks: [],
			continuityRisk: "medium",
			preservationViolationRisk: "low",
			preferredStrategy: "speed",
			proposedCall: {
				status: "proposal_only",
				notExecuted: true,
				toolFamily: "speed",
				toolName: "addSpeed",
				provisionalArgs: { assetId, startSec: start, endSec: end, speed },
				argsConfidence: "medium",
			},
			constraints: [],
			confidence: 0.7,
		};
	}
	if (step.family === "crop" && step.operationType === "setClipCrop") {
		const clipId = String(step.operationArgs.clipId ?? "");
		const crop = step.operationArgs.crop as
			| { x?: number; y?: number; width?: number; height?: number }
			| undefined;
		if (
			!clipId ||
			!crop ||
			!Number.isFinite(crop.x) ||
			!Number.isFinite(crop.y) ||
			!Number.isFinite(crop.width) ||
			!Number.isFinite(crop.height)
		) {
			return null;
		}
		return {
			id: step.proposalItemId ?? step.stepId,
			planItemId: step.stepId,
			gapIds: [],
			sourceBeatIds: [],
			targetBeatIds: [],
			status: "proposal_ready",
			priority: "low",
			intent: step.reason,
			evidenceJustification: step.expectedEffect,
			evidenceRefs: [],
			landing: {
				timebase: "SOURCE_MEDIA_TIME",
				startSourceTimeSec: 0,
				endSourceTimeSec: 1,
				boundaryBasis: "professional_editorial_planner_v1",
				boundaryConfidence: "medium",
				finalizedForApply: false,
			},
			mustSurvive: [],
			damageRisks: [],
			continuityRisk: "medium",
			preservationViolationRisk: "medium",
			preferredStrategy: "crop",
			proposedCall: {
				status: "proposal_only",
				notExecuted: true,
				toolFamily: "crop",
				toolName: "setClipCrop",
				provisionalArgs: {
					assetId,
					clipId,
					crop: { x: crop.x, y: crop.y, width: crop.width, height: crop.height },
				},
				argsConfidence: "medium",
			},
			constraints: [],
			confidence: 0.65,
		};
	}
	if (
		(step.family === "title" || step.family === "callout") &&
		step.operationType === "addGraphic"
	) {
		const start = Number(step.operationArgs.startSec ?? step.sourceStartSec);
		const end = Number(step.operationArgs.endSec ?? step.sourceEndSec);
		const kind = String(step.operationArgs.kind ?? (step.family === "title" ? "title" : "figure"));
		const text = typeof step.operationArgs.text === "string" ? step.operationArgs.text : "";
		if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return null;
		if ((kind === "title" || kind === "cta") && text.trim().length < 2) return null;
		return {
			id: step.proposalItemId ?? step.stepId,
			planItemId: step.stepId,
			gapIds: [],
			sourceBeatIds: [],
			targetBeatIds: [],
			status: "proposal_ready",
			priority: step.family === "title" ? "medium" : "low",
			intent: step.reason,
			evidenceJustification: step.expectedEffect,
			evidenceRefs: [],
			landing: {
				timebase: "SOURCE_MEDIA_TIME",
				startSourceTimeSec: start,
				endSourceTimeSec: end,
				boundaryBasis:
					step.family === "title"
						? "professional_editorial_title"
						: "professional_editorial_callout",
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
					assetId,
					...step.operationArgs,
					kind,
					text,
					startSec: start,
					endSec: end,
				},
				argsConfidence: "medium",
			},
			constraints: [],
			confidence: 0.7,
		};
	}
	if (step.family === "transitions" && step.operationType === "setClipIncomingTransition") {
		const clipId = String(step.operationArgs.clipId ?? "");
		const kind = String(step.operationArgs.kind ?? "");
		if (!clipId || (kind !== "cut" && kind !== "dissolve")) return null;
		return {
			id: step.proposalItemId ?? step.stepId,
			planItemId: step.stepId,
			gapIds: [],
			sourceBeatIds: [],
			targetBeatIds: [],
			status: "proposal_ready",
			priority: "low",
			intent: step.reason,
			evidenceJustification: step.expectedEffect,
			evidenceRefs: [],
			landing: {
				timebase: "SOURCE_MEDIA_TIME",
				startSourceTimeSec: 0,
				endSourceTimeSec: 1,
				boundaryBasis: "professional_editorial_transition",
				boundaryConfidence: "medium",
				finalizedForApply: false,
			},
			mustSurvive: [],
			damageRisks: [],
			continuityRisk: "low",
			preservationViolationRisk: "low",
			preferredStrategy: "preserve",
			proposedCall: {
				status: "proposal_only",
				notExecuted: true,
				toolFamily: "preserve",
				toolName: "setClipIncomingTransition",
				provisionalArgs: {
					assetId,
					clipId,
					kind,
					durationSec: step.operationArgs.durationSec,
				},
				argsConfidence: "medium",
			},
			constraints: [],
			confidence: 0.65,
		};
	}
	return null;
}

export function createExecutionSession(args: {
	document: AxcutDocument;
	plan: ProfessionalEditPlanV1;
	authorization: PlanAuthorizationV1 | null;
}): ProfessionalEditExecutionSessionV1 {
	const fp = fingerprintDocument(args.document).value;
	return {
		sessionId: `pes_${randomUUID().slice(0, 12)}`,
		originalDocumentFingerprint: fp,
		currentDocumentFingerprint: fp,
		planFingerprint: args.plan.planFingerprint,
		authorization: args.authorization,
		completed: [],
		skipped: [],
		failed: [],
		contextInvalidations: 0,
		finalProgrammeDurationSec: null,
		operationBudget: args.plan.maxOperations,
		operationsUsed: 0,
	};
}

function refreshCaptionStepAgainstDocument(
	step: ProfessionalEditPlanStepV1,
	doc: AxcutDocument,
	assetId: string,
	aspectValue = 16 / 9,
): ProfessionalEditPlanStepV1 {
	if (step.family !== "captions") return step;
	const { layout } = runCaptionLayoutForDocument({
		document: doc,
		assetId,
		aspectValue,
		useCache: false,
	});
	if (layout.status !== "ok" || layout.metrics.cueCount < 1) {
		return { ...step, executionReadiness: "NO_LONGER_NEEDED" };
	}
	const proposalId = step.proposalItemId ?? `prop_orch_cap_${randomUUID().slice(0, 8)}`;
	const op = buildCaptionLayoutOperation({
		proposalId,
		document: doc,
		assetId,
		layout,
		aspectValue,
	});
	const argsMap = operationToProvisionalArgs(op);
	argsMap.assetId = assetId;
	return {
		...step,
		operationArgs: argsMap,
		executionReadiness: "READY",
		proposalItemId: proposalId,
		expectedEffect: `Show ${layout.metrics.cueCount} caption lines`,
	};
}

export type SessionExecutionMode = "verified_apply" | "plan_only";

export async function executeAuthorizedPlan(args: {
	document: AxcutDocument;
	assetId: string;
	plan: ProfessionalEditPlanV1;
	session: ProfessionalEditExecutionSessionV1;
	mode?: SessionExecutionMode;
	compositorFrameSampler?: CompositedFrameSampler | null;
	allowInjectedCompositorAsAuthoritative?: boolean;
	pcmProvider?: AudioPcmProvider | null;
	appRoot?: string;
}): Promise<{
	document: AxcutDocument;
	session: ProfessionalEditExecutionSessionV1;
}> {
	let doc = args.document;
	const session = {
		...args.session,
		completed: [...args.session.completed],
		skipped: [...args.session.skipped],
		failed: [...args.session.failed],
	};
	const mode = args.mode ?? "verified_apply";
	const steps = args.plan.steps.map((s) => ({ ...s }));

	if (!authorizationStillValid(session.authorization, args.plan.planFingerprint)) {
		for (const step of steps) {
			session.skipped.push({
				stepId: step.stepId,
				status: "skipped",
				reason: "plan_not_authorized",
				documentFingerprintBefore: fingerprintDocument(doc).value,
				documentFingerprintAfter: null,
				verificationNotes: [],
			});
		}
		return { document: doc, session };
	}

	for (let i = 0; i < steps.length; i += 1) {
		let step = steps[i]!;
		if (session.operationsUsed >= session.operationBudget) {
			session.skipped.push({
				stepId: step.stepId,
				status: "skipped",
				reason: "operation_budget_exhausted",
				documentFingerprintBefore: fingerprintDocument(doc).value,
				documentFingerprintAfter: null,
				verificationNotes: [],
			});
			continue;
		}

		if (step.family === "captions" && session.contextInvalidations > 0) {
			step = refreshCaptionStepAgainstDocument(step, doc, args.assetId);
			steps[i] = step;
		}
		if (step.family === "zoom" && session.contextInvalidations > 0) {
			step = refreshZoomStepAgainstDocument(step, doc, args.assetId);
			steps[i] = step;
		}

		if (step.executionReadiness !== "READY") {
			session.skipped.push({
				stepId: step.stepId,
				status: "skipped",
				reason: step.executionReadiness,
				documentFingerprintBefore: fingerprintDocument(doc).value,
				documentFingerprintAfter: null,
				verificationNotes: [],
			});
			continue;
		}

		const beforeFp = fingerprintDocument(doc).value;
		session.currentDocumentFingerprint = beforeFp;

		if (mode === "plan_only") {
			session.skipped.push({
				stepId: step.stepId,
				status: "skipped",
				reason: "plan_only_mode",
				documentFingerprintBefore: beforeFp,
				documentFingerprintAfter: null,
				verificationNotes: ["not_executed"],
			});
			continue;
		}

		const item = stepToProposalItem(step, args.assetId);
		if (!item) {
			session.skipped.push({
				stepId: step.stepId,
				status: "skipped",
				reason: "family_not_wired_for_session_v1",
				documentFingerprintBefore: beforeFp,
				documentFingerprintAfter: null,
				verificationNotes: [],
			});
			continue;
		}

		const proposal = wrapProposal(args.assetId, item);
		const diag = prepareApplyPreviewDiagnostics({
			document: doc,
			editProposalV1: proposal,
			proposalDocumentFingerprint: beforeFp,
		});
		if (!diag.preflight.eligible) {
			session.failed.push({
				stepId: step.stepId,
				status: "blocked",
				reason: diag.preflight.blockingReasons.join(",") || "preflight_ineligible",
				documentFingerprintBefore: beforeFp,
				documentFingerprintAfter: null,
				verificationNotes: diag.preflight.blockingReasons,
			});
			continue;
		}

		const consent = createApplyConsent({
			proposalId: item.id,
			preflight: diag.preflight,
		});

		try {
			const result = await runConsentedApplyPreview({
				document: doc,
				editProposalV1: proposal,
				selectedProposalId: item.id,
				preflight: diag.preflight,
				consent,
				compositorFrameSampler: args.compositorFrameSampler ?? undefined,
				allowInjectedCompositorAsAuthoritative:
					args.allowInjectedCompositorAsAuthoritative === true,
				pcmProvider: args.pcmProvider ?? undefined,
				appRoot: args.appRoot,
			});

			if (result.receipt.terminalStatus === "verified" && result.document) {
				doc = result.document;
				session.operationsUsed += 1;
				session.contextInvalidations += 1;
				session.currentDocumentFingerprint = fingerprintDocument(doc).value;
				session.completed.push({
					stepId: step.stepId,
					status: "committed",
					reason: step.family,
					documentFingerprintBefore: beforeFp,
					documentFingerprintAfter: session.currentDocumentFingerprint,
					verificationNotes: result.receipt.verificationNotes ?? [],
				});
				// After a trim, refresh zoom via SOURCE remap (not blind stale skip).
				if (step.family === "trim") {
					for (let j = i + 1; j < steps.length; j += 1) {
						const later = steps[j]!;
						if (later.family === "zoom") {
							steps[j] = refreshZoomStepAgainstDocument(later, doc, args.assetId);
						}
						if (later.family === "title" || later.family === "callout") {
							const refreshed = refreshTimedGraphicStepAgainstDocument(later, doc, args.assetId);
							steps[j] = refreshed.step;
						}
						if (later.family === "speed") {
							const refreshed = refreshTimedGraphicStepAgainstDocument(
								{
									...later,
									operationArgs: {
										...later.operationArgs,
										sourceStartSec: later.operationArgs.sourceStartSec ?? later.sourceStartSec,
										sourceEndSec: later.operationArgs.sourceEndSec ?? later.sourceEndSec,
									},
								},
								doc,
								args.assetId,
							);
							if (refreshed.step.executionReadiness === "READY") {
								steps[j] = {
									...refreshed.step,
									family: "speed",
									operationType: "addSpeed",
									operationArgs: {
										...refreshed.step.operationArgs,
										speed: later.operationArgs.speed,
									},
								};
							} else {
								steps[j] = refreshed.step;
							}
						}
					}
				}
			} else if (result.receipt.terminalStatus === "rolled_back") {
				session.failed.push({
					stepId: step.stepId,
					status: "rolled_back",
					reason: result.receipt.verificationNotes?.join(";") || "verify_failed",
					documentFingerprintBefore: beforeFp,
					documentFingerprintAfter: fingerprintDocument(doc).value,
					verificationNotes: result.receipt.verificationNotes ?? [],
				});
			} else {
				session.failed.push({
					stepId: step.stepId,
					status: "failed",
					reason: result.receipt.terminalStatus,
					documentFingerprintBefore: beforeFp,
					documentFingerprintAfter: null,
					verificationNotes: result.receipt.verificationNotes ?? [],
				});
			}
		} catch (err) {
			session.failed.push({
				stepId: step.stepId,
				status: "failed",
				reason: err instanceof Error ? err.message.slice(0, 120) : String(err),
				documentFingerprintBefore: beforeFp,
				documentFingerprintAfter: null,
				verificationNotes: [],
			});
		}
	}

	return { document: doc, session };
}
