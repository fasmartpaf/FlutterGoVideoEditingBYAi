/**
 * Bridge ready opportunities → ProfessionalEditPlanStepV1 fragments.
 */

import { randomUUID } from "node:crypto";
import { buildProfessionalZoomIntent } from "../professionalEditOrchestrator/professionalZoom";
import type { ProfessionalEditPlanStepV1 } from "../professionalEditOrchestrator/types";
import type { ProfessionalEditorialOpportunityV1 } from "./types";

export function opportunitiesToPlanSteps(
	ready: ProfessionalEditorialOpportunityV1[],
	startOrder = 1,
	assetDurationSec = 120,
): ProfessionalEditPlanStepV1[] {
	const steps: ProfessionalEditPlanStepV1[] = [];
	let order = startOrder;
	for (const o of ready) {
		if (o.family === "TRIM") {
			const start = Number(o.derivedParameters.startSec);
			const end = Number(o.derivedParameters.endSec);
			if (!(end > start)) continue;
			order += 1;
			steps.push({
				stepId: `step_trim_${order}`,
				family: "trim",
				reason: o.editorialReason,
				sourceStartSec: start,
				sourceEndSec: end,
				operationType: "addTrim",
				operationArgs: {
					startSec: start,
					endSec: end,
					startSourceTimeSec: start,
					endSourceTimeSec: end,
				},
				evidenceRefs: o.evidenceRefs,
				preservationRefs: [],
				expectedEffect: `Remove ~${Number(o.derivedParameters.removedSec ?? end - start).toFixed(1)}s quiet pause`,
				executionReadiness: "READY",
				verificationRequirement: "apply_preview",
				order,
				optional: false,
				proposalItemId: `prop_planner_trim_${randomUUID().slice(0, 8)}`,
			});
		} else if (o.family === "ZOOM") {
			const focus = o.derivedParameters.focus as { cx: number; cy: number } | undefined;
			const sourceStart = Number(o.derivedParameters.sourceStartSec);
			const sourceEnd = Number(o.derivedParameters.sourceEndSec);
			if (!focus || !(sourceEnd > sourceStart)) continue;
			const depth = Number(o.derivedParameters.depth ?? 2);
			const scale = Number(o.derivedParameters.scale ?? 1.45);
			const zoomIntent = buildProfessionalZoomIntent({
				sourceStartSec: sourceStart,
				sourceEndSec: sourceEnd,
				assetDurationSec,
				focus: { cx: focus.cx, cy: focus.cy },
				depth,
				scale,
				evidenceRefs: o.evidenceRefs,
				importance: o.confidence === "HIGH" ? "HIGH" : "MEDIUM",
			});
			order += 1;
			steps.push({
				stepId: `step_zoom_${order}`,
				family: "zoom",
				reason: o.editorialReason,
				sourceStartSec: zoomIntent.sourceStartSec,
				sourceEndSec: zoomIntent.sourceEndSec,
				operationType: "addZoom",
				operationArgs: {
					depth: zoomIntent.depth,
					focus: { ...zoomIntent.focusRegion },
					startSec: zoomIntent.sourceStartSec,
					endSec: zoomIntent.sourceEndSec,
					sourceStartSec: zoomIntent.sourceStartSec,
					sourceEndSec: zoomIntent.sourceEndSec,
					remapDisposition: "STILL_VALID",
					professionalZoomIntent: zoomIntent,
				},
				evidenceRefs: o.evidenceRefs,
				preservationRefs: [],
				expectedEffect: `Professional zoom enter(${zoomIntent.enterDurationSec.toFixed(2)}s)→hold(${zoomIntent.holdDurationSec.toFixed(2)}s)→exit(${zoomIntent.exitDurationSec.toFixed(2)}s)`,
				executionReadiness: "READY",
				verificationRequirement: "apply_preview",
				order,
				optional: true,
				proposalItemId: `prop_planner_zoom_${randomUUID().slice(0, 8)}`,
			});
		} else if (o.family === "SPEED") {
			const start = Number(o.derivedParameters.startSec);
			const end = Number(o.derivedParameters.endSec);
			const speed = Number(o.derivedParameters.speed);
			if (!(end > start) || !(speed > 1)) continue;
			order += 1;
			steps.push({
				stepId: `step_speed_${order}`,
				family: "speed",
				reason: o.editorialReason,
				sourceStartSec: start,
				sourceEndSec: end,
				operationType: "addSpeed",
				operationArgs: {
					startSec: start,
					endSec: end,
					speed,
					sourceStartSec: start,
					sourceEndSec: end,
					expectedProgrammeDurationSec: (end - start) / speed,
				},
				evidenceRefs: o.evidenceRefs,
				preservationRefs: [],
				expectedEffect: `Speed ${speed}× low-information span (~${Number(o.derivedParameters.estimatedSavedSec ?? 0).toFixed(1)}s saved)`,
				executionReadiness: "READY",
				verificationRequirement: "apply_preview",
				order,
				optional: true,
				proposalItemId: `prop_planner_speed_${randomUUID().slice(0, 8)}`,
			});
		} else if (o.family === "CROP") {
			const crop = o.derivedParameters as {
				clipId?: string;
				x?: number;
				y?: number;
				width?: number;
				height?: number;
			};
			if (
				!crop.clipId ||
				!Number.isFinite(crop.x) ||
				!Number.isFinite(crop.y) ||
				!Number.isFinite(crop.width) ||
				!Number.isFinite(crop.height)
			) {
				continue;
			}
			order += 1;
			steps.push({
				stepId: `step_crop_${order}`,
				family: "crop",
				reason: o.editorialReason,
				operationType: "setClipCrop",
				operationArgs: {
					clipId: crop.clipId,
					crop: {
						x: crop.x,
						y: crop.y,
						width: crop.width,
						height: crop.height,
					},
				},
				evidenceRefs: o.evidenceRefs,
				preservationRefs: [],
				expectedEffect: "Reframe to exclude unused canvas",
				executionReadiness: "READY",
				verificationRequirement: "apply_preview",
				order,
				optional: true,
				proposalItemId: `prop_planner_crop_${randomUUID().slice(0, 8)}`,
			});
		} else if (o.family === "TITLE") {
			const text = String(o.derivedParameters.text ?? "").trim();
			const start = Number(o.derivedParameters.startSec);
			const end = Number(o.derivedParameters.endSec);
			if (!text || !(end > start)) continue;
			order += 1;
			steps.push({
				stepId: `step_title_${order}`,
				family: "title",
				reason: o.editorialReason,
				sourceStartSec: start,
				sourceEndSec: end,
				operationType: "addGraphic",
				operationArgs: {
					kind: "title",
					text,
					startSec: start,
					endSec: end,
					titleMode: o.derivedParameters.titleMode ?? "OPENING_TITLE",
					textAnimation: "fade",
				},
				evidenceRefs: o.evidenceRefs,
				preservationRefs: [],
				expectedEffect: `Opening title: "${text.slice(0, 40)}"`,
				executionReadiness: "READY",
				verificationRequirement: "apply_preview",
				order,
				optional: true,
				proposalItemId: `prop_planner_title_${randomUUID().slice(0, 8)}`,
			});
		} else if (o.family === "CALLOUT") {
			const start = Number(o.derivedParameters.startSec);
			const end = Number(o.derivedParameters.endSec);
			const x = Number(o.derivedParameters.x);
			const y = Number(o.derivedParameters.y);
			if (!(end > start) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
			order += 1;
			steps.push({
				stepId: `step_callout_${order}`,
				family: "callout",
				reason: o.editorialReason,
				sourceStartSec: start,
				sourceEndSec: end,
				operationType: "addGraphic",
				operationArgs: {
					kind: String(o.derivedParameters.kind ?? "figure"),
					text: String(o.derivedParameters.text ?? "Focus").slice(0, 32),
					x,
					y,
					width: Number(o.derivedParameters.width ?? 12),
					height: Number(o.derivedParameters.height ?? 12),
					startSec: start,
					endSec: end,
					arrowDirection: o.derivedParameters.arrowDirection ?? "down",
				},
				evidenceRefs: o.evidenceRefs,
				preservationRefs: [],
				expectedEffect: "Grounded callout/highlight on focal UI",
				executionReadiness: "READY",
				verificationRequirement: "apply_preview",
				order,
				optional: true,
				proposalItemId: `prop_planner_callout_${randomUUID().slice(0, 8)}`,
			});
		} else if (o.family === "TRANSITION") {
			const clipId = String(o.derivedParameters.clipId ?? "");
			const transitionId = String(
				o.derivedParameters.transitionId ??
					(o.derivedParameters.kind === "cut" ? "openscreen.cut" : "openscreen.dissolve"),
			);
			const kind = transitionId === "openscreen.cut" ? "cut" : "dissolve";
			if (!clipId) continue;
			if (kind === "cut" || transitionId === "openscreen.cut") continue;
			order += 1;
			steps.push({
				stepId: `step_trans_${order}`,
				family: "transitions",
				reason: o.editorialReason,
				operationType: "setClipIncomingTransition",
				operationArgs: {
					clipId,
					transitionId,
					kind,
					durationSec: Number(o.derivedParameters.durationSec ?? 0.35),
				},
				evidenceRefs: o.evidenceRefs,
				preservationRefs: [],
				expectedEffect: `Incoming ${transitionId} at clip join`,
				executionReadiness: "READY",
				verificationRequirement: "apply_preview",
				order,
				optional: true,
				proposalItemId: `prop_planner_trans_${randomUUID().slice(0, 8)}`,
			});
		} else if (o.family === "CAPTIONS") {
			// Captions still built by plan.ts layout path for complete args —
			// planner marks readiness; plan merges.
			continue;
		}
	}
	return steps;
}
