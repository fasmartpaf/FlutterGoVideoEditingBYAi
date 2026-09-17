/**
 * Build grounded multi-step plan — planner-driven when available; no invented geometry.
 */

import { createHash, randomUUID } from "node:crypto";
import { getCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import {
	buildCaptionLayoutOperation,
	operationToProvisionalArgs,
	runCaptionLayoutForDocument,
} from "../captionLayout";
import {
	type DeadAirCandidateV1,
	deadAirCandidateToProposalItem,
	selectSingleDeadAirCandidate,
} from "../deadAir";
import { programmePointToSourceSec } from "../localEditorialChat/directTrim";
import {
	opportunitiesToPlanSteps,
	type ProfessionalEditorialPlannerResultV1,
} from "../professionalEditorialPlanner";
import { fingerprintPlan } from "./authorization";
import type { GroundedFocalTargetV1, ZoomExecutionCandidateV1 } from "./focal";
import { remapGroundedFocalAfterMutation } from "./focal";
import type {
	DurationObjectiveAssessmentV1,
	ProfessionalEditIntentV1,
	ProfessionalEditPlanStepV1,
	ProfessionalEditPlanV1,
	ProfessionalEditStoryV1,
	TargetedInvestigationResultV1,
} from "./types";

const DEFAULT_MAX_OPS = 12;

export function buildProfessionalEditPlan(args: {
	document: AxcutDocument;
	assetId: string;
	aspectValue?: number;
	intent: ProfessionalEditIntentV1;
	story: ProfessionalEditStoryV1;
	duration: DurationObjectiveAssessmentV1;
	deadAirCandidates: DeadAirCandidateV1[];
	focalInvestigation?: TargetedInvestigationResultV1 | null;
	groundedFocals?: GroundedFocalTargetV1[] | null;
	maxOperations?: number;
	/** Local Professional Editorial Planner V1 — preferred source of ops. */
	planner?: ProfessionalEditorialPlannerResultV1 | null;
}): ProfessionalEditPlanV1 {
	const maxOps = args.maxOperations ?? DEFAULT_MAX_OPS;
	const aspect = args.aspectValue ?? 16 / 9;
	const steps: ProfessionalEditPlanStepV1[] = [];
	let order = 0;

	const plannerUsed = Boolean(args.planner);
	if (args.planner) {
		const fromPlanner = opportunitiesToPlanSteps(
			args.planner.ready,
			order,
			args.document.assets.find((a) => a.id === args.assetId)?.durationSec ??
				args.document.assets[0]?.durationSec ??
				120,
		);
		for (const s of fromPlanner) {
			if (steps.length >= maxOps) break;
			if (!args.intent.allowedFamilies.includes(s.family as never)) continue;
			steps.push(s);
			order = Math.max(order, s.order);
		}
	} else {
		const safe = args.deadAirCandidates
			.filter((c) => c.safeToPropose && c.proposedTrimRange)
			.sort((a, b) => b.resultingRemovedDurationSec - a.resultingRemovedDurationSec);

		const trimBudget =
			args.duration.kind === "ACHIEVABLE_SAFE" || args.intent.pacingPreference === "tighter"
				? Math.min(3, maxOps)
				: Math.min(2, maxOps);

		for (const c of safe.slice(0, trimBudget)) {
			const item = deadAirCandidateToProposalItem(c);
			if (!item?.proposedCall) continue;
			order += 1;
			steps.push({
				stepId: `step_trim_${order}`,
				family: "trim",
				reason: `Shorten safe pause (${c.silenceDurationSec.toFixed(1)}s)`,
				sourceStartSec: c.proposedTrimRange!.startSec,
				sourceEndSec: c.proposedTrimRange!.endSec,
				operationType: "addTrim",
				operationArgs: { ...item.proposedCall.provisionalArgs },
				evidenceRefs: [`dead_air:${c.id}`],
				preservationRefs: item.mustSurvive.map((m) => m.id),
				expectedEffect: `Remove ~${c.resultingRemovedDurationSec.toFixed(1)}s quiet pause`,
				executionReadiness: "READY",
				verificationRequirement: "apply_preview",
				order,
				optional: false,
				proposalItemId: item.id,
			});
		}

		// User authorized cutting some lower-value / supporting content toward a duration target.
		const needMoreDuration =
			args.intent.allowOptionalContentRemoval &&
			(args.duration.kind === "ACHIEVABLE_WITH_OPTIONAL_CONTENT_REMOVAL" ||
				args.duration.kind === "NOT_ACHIEVABLE_WITHOUT_IMPORTANT_CONTENT_LOSS" ||
				(args.intent.targetDurationMaxSec != null &&
					args.duration.projectedSafeDurationSec > args.intent.targetDurationMaxSec + 0.5));
		if (needMoreDuration && args.intent.allowedFamilies.includes("trim")) {
			const target = args.intent.targetDurationMaxSec;
			let remaining =
				target != null ? Math.max(0, args.duration.projectedSafeDurationSec - target) : 4;
			const optionalSorted = [...args.story.optionalRanges].sort(
				(a, b) => b.endSec - b.startSec - (a.endSec - a.startSec),
			);
			for (const r of optionalSorted) {
				if (steps.length >= maxOps || remaining < 0.6) break;
				const span = Math.max(0, r.endSec - r.startSec);
				if (span < 0.9) continue;
				// Shorten supporting content — keep edges, cut a middle slice.
				const cut = Math.min(remaining, Math.max(0.7, span * 0.45));
				const mid = (r.startSec + r.endSec) / 2;
				const startSec = Math.max(r.startSec, mid - cut / 2);
				const endSec = Math.min(r.endSec, startSec + cut);
				if (endSec - startSec < 0.55) continue;
				order += 1;
				steps.push({
					stepId: `step_trim_optional_${order}`,
					family: "trim",
					reason: "Shorten lower-value supporting content (user-authorized)",
					sourceStartSec: startSec,
					sourceEndSec: endSec,
					operationType: "addTrim",
					operationArgs: {
						startSec,
						endSec,
						reason: "optional_content_authorized",
					},
					evidenceRefs: [`optional_range:${startSec.toFixed(2)}-${endSec.toFixed(2)}`],
					preservationRefs: [],
					expectedEffect: `Remove ~${(endSec - startSec).toFixed(1)}s supporting content`,
					executionReadiness: "READY",
					verificationRequirement: "apply_preview",
					order,
					optional: false,
					proposalItemId: `prop_orch_opt_${order}`,
				});
				remaining -= endSec - startSec;
			}
		}
	}

	// Even when planner supplied steps, honor user-authorized optional content cuts toward duration.
	if (
		args.intent.allowOptionalContentRemoval &&
		args.intent.allowedFamilies.includes("trim") &&
		(args.duration.kind === "ACHIEVABLE_WITH_OPTIONAL_CONTENT_REMOVAL" ||
			args.duration.kind === "NOT_ACHIEVABLE_WITHOUT_IMPORTANT_CONTENT_LOSS" ||
			(args.intent.targetDurationMaxSec != null &&
				args.duration.projectedSafeDurationSec > args.intent.targetDurationMaxSec + 0.5))
	) {
		const target = args.intent.targetDurationMaxSec;
		let remaining =
			target != null ? Math.max(0, args.duration.projectedSafeDurationSec - target) : 4;
		const alreadyOptional = steps.filter((s) => s.stepId.includes("optional")).length;
		if (alreadyOptional === 0) {
			const optionalSorted = [...args.story.optionalRanges].sort(
				(a, b) => b.endSec - b.startSec - (a.endSec - a.startSec),
			);
			for (const r of optionalSorted) {
				if (steps.length >= maxOps || remaining < 0.6) break;
				const span = Math.max(0, r.endSec - r.startSec);
				if (span < 0.9) continue;
				const cut = Math.min(remaining, Math.max(0.7, span * 0.45));
				const mid = (r.startSec + r.endSec) / 2;
				const startSec = Math.max(r.startSec, mid - cut / 2);
				const endSec = Math.min(r.endSec, startSec + cut);
				if (endSec - startSec < 0.55) continue;
				order += 1;
				steps.push({
					stepId: `step_trim_optional_${order}`,
					family: "trim",
					reason: "Shorten lower-value supporting content (user-authorized)",
					sourceStartSec: startSec,
					sourceEndSec: endSec,
					operationType: "addTrim",
					operationArgs: {
						startSec,
						endSec,
						reason: "optional_content_authorized",
					},
					evidenceRefs: [`optional_range:${startSec.toFixed(2)}-${endSec.toFixed(2)}`],
					preservationRefs: [],
					expectedEffect: `Remove ~${(endSec - startSec).toFixed(1)}s supporting content`,
					executionReadiness: "READY",
					verificationRequirement: "apply_preview",
					order,
					optional: false,
					proposalItemId: `prop_orch_opt_${order}`,
				});
				remaining -= endSec - startSec;
			}
		}
	}

	const captionsEnabled = getCaptionSettings(args.document, aspect).enabled;
	const wantCap =
		args.intent.wantCaptions === true ||
		(args.intent.wantCaptions === "auto" && args.intent.requestedOutcome === "MAKE_PROFESSIONAL");
	// Explicit caption commands must not depend on planner "opportunity" gating.
	const captionOppReady =
		args.intent.wantCaptions === true ||
		args.planner?.ready.some((o) => o.family === "CAPTIONS") === true ||
		(!plannerUsed && wantCap);

	if (wantCap && !captionsEnabled && captionOppReady && steps.length < maxOps) {
		const { layout } = runCaptionLayoutForDocument({
			document: args.document,
			assetId: args.assetId,
			aspectValue: aspect,
			useCache: true,
		});
		if (layout.status === "ok" && layout.metrics.cueCount > 0) {
			const proposalId = `prop_orch_cap_${randomUUID().slice(0, 8)}`;
			const op = buildCaptionLayoutOperation({
				proposalId,
				document: args.document,
				assetId: args.assetId,
				layout,
				aspectValue: aspect,
			});
			const argsMap = operationToProvisionalArgs(op);
			argsMap.assetId = args.assetId;
			order += 1;
			steps.push({
				stepId: `step_cap_${order}`,
				family: "captions",
				reason: "Enable captions from transcript with safe layout",
				operationType: "enableCaptions",
				operationArgs: argsMap,
				evidenceRefs: ["caption_layout:ok"],
				preservationRefs: ["transcript"],
				expectedEffect: `Show ${layout.metrics.cueCount} caption lines`,
				executionReadiness: "READY",
				verificationRequirement: "apply_preview",
				order,
				optional: false, // publish-ready polish: captions are first-class when layout is ready
				proposalItemId: proposalId,
			});
		}
	}

	// Legacy zoom path when planner not used, OR when user explicitly requested zoom
	// and the planner did not already schedule one.
	const plannerHasZoom = steps.some((s) => s.family === "zoom");
	const wantExplicitZoom =
		args.intent.explicitlyRequestedFamilies.includes("zoom") ||
		/\bzoom|\bunzoom|\breframe\b/i.test(args.intent.rawText);
	if ((!plannerUsed || (wantExplicitZoom && !plannerHasZoom)) && steps.length < maxOps) {
		const zoomCandidates: ZoomExecutionCandidateV1[] = [];
		for (const f of args.groundedFocals ?? []) {
			if (!f.survivesCurrentPlayback) continue;
			const remapped = remapGroundedFocalAfterMutation({
				document: args.document,
				assetId: args.assetId,
				focal: f,
			});
			if (remapped.candidate) zoomCandidates.push(remapped.candidate);
		}

		if (args.intent.allowedFamilies.includes("zoom") && zoomCandidates.length > 0) {
			const z = zoomCandidates[0]!;
			order += 1;
			steps.push({
				stepId: `step_zoom_${order}`,
				family: "zoom",
				reason: z.reason,
				sourceStartSec: z.sourceStartSec,
				sourceEndSec: z.sourceEndSec,
				operationType: "addZoom",
				operationArgs: {
					depth: z.depth,
					focus: { cx: z.focus.cx, cy: z.focus.cy },
					startSec: z.programmeStartSec,
					endSec: z.programmeEndSec,
					sourceStartSec: z.sourceStartSec,
					sourceEndSec: z.sourceEndSec,
					remapDisposition: z.remapDisposition,
				},
				evidenceRefs: z.evidenceRefs,
				preservationRefs: [],
				expectedEffect: "Emphasize grounded on-screen focus",
				executionReadiness: "READY",
				verificationRequirement: "apply_preview",
				order,
				optional: true,
				proposalItemId: `prop_orch_zoom_${randomUUID().slice(0, 8)}`,
			});
		}
	}

	let ready = steps
		.filter((s) => s.executionReadiness === "READY")
		.slice(0, maxOps)
		.map((s, i) => ({ ...s, order: i + 1 }));

	// Explicit "shorten the pause around N" → one grounded pause (programme time → source).
	const nearMatch = args.intent.rawText.match(
		/\b(?:around|near|approx(?:imately)?|at|nearest to)\s+(\d+(?:\.\d+)?)\s*(?:s(?:ec(?:onds?)?)?)?\b/i,
	);
	const nearProgSec = nearMatch ? Number(nearMatch[1]) : null;
	const shortenNear =
		nearProgSec != null &&
		Number.isFinite(nearProgSec) &&
		/\b(?:shorten|quiet pause nearest|keep a natural breath|reduce\s+(?:the\s+)?(?:pause|silence))\b/i.test(
			args.intent.rawText,
		);
	if (shortenNear) {
		const nearSource = programmePointToSourceSec(args.document, nearProgSec!) ?? nearProgSec!;
		const one = selectSingleDeadAirCandidate(args.deadAirCandidates, nearSource);
		if (one?.proposedTrimRange) {
			const item = deadAirCandidateToProposalItem(one);
			if (item?.proposedCall) {
				ready = [
					{
						stepId: "step_trim_near",
						family: "trim",
						reason: `Shorten quiet pause nearest to programme ${nearProgSec!.toFixed(1)}s`,
						sourceStartSec: one.proposedTrimRange.startSec,
						sourceEndSec: one.proposedTrimRange.endSec,
						operationType: "addTrim",
						operationArgs: { ...item.proposedCall.provisionalArgs },
						evidenceRefs: [`dead_air:${one.id}`],
						preservationRefs: item.mustSurvive.map((m) => m.id),
						expectedEffect: `Shorten one grounded pause (~${one.resultingRemovedDurationSec.toFixed(1)}s removed, breath kept)`,
						executionReadiness: "READY",
						verificationRequirement: "apply_preview",
						order: 1,
						optional: false,
						proposalItemId: item.id,
					},
				];
			}
		} else {
			// Do not invent a pause — leave empty so receipt can explain miss.
			ready = ready.filter((s) => s.family !== "trim");
		}
	}

	const planId = `pep_${createHash("sha256").update(args.intent.rawText).digest("hex").slice(0, 10)}`;
	const plan: ProfessionalEditPlanV1 = {
		version: 1,
		planId,
		planFingerprint: "",
		intent: args.intent,
		steps: ready,
		requestedButUnsupported: args.intent.requestedUnsupported,
		maxOperations: maxOps,
		summary:
			ready.length === 0
				? "No READY verified operations for this objective yet."
				: `Plan ${ready.length} verified step(s): ${ready.map((s) => s.family).join(", ")}.`,
	};
	plan.planFingerprint = fingerprintPlan(plan);

	// Fallback single trim only for legacy (non-planner) empty plans — restraint when planner ran.
	if (plan.steps.length === 0 && !plannerUsed && !shortenNear) {
		const nearSec = nearProgSec;
		const nearSource =
			nearSec != null ? (programmePointToSourceSec(args.document, nearSec) ?? nearSec) : null;
		const one = selectSingleDeadAirCandidate(args.deadAirCandidates, nearSource);
		if (one) {
			const item = deadAirCandidateToProposalItem(one);
			if (item?.proposedCall) {
				plan.steps = [
					{
						stepId: "step_trim_fallback",
						family: "trim",
						reason: "Single safest dead-air trim",
						sourceStartSec: one.proposedTrimRange!.startSec,
						sourceEndSec: one.proposedTrimRange!.endSec,
						operationType: "addTrim",
						operationArgs: { ...item.proposedCall.provisionalArgs },
						evidenceRefs: [`dead_air:${one.id}`],
						preservationRefs: [],
						expectedEffect: "Shorten one safe pause",
						executionReadiness: "READY",
						verificationRequirement: "apply_preview",
						order: 1,
						optional: false,
						proposalItemId: item.id,
					},
				];
				plan.planFingerprint = fingerprintPlan(plan);
				plan.summary = "Fallback: one safe pause trim.";
			}
		}
	}

	return plan;
}
