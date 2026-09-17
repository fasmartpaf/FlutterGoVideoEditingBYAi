/**
 * Deterministic conflict / remap dispositions after sequential mutations.
 * Does not silently drop ops — records KEPT | REMAPPED | SUPPRESSED_CONFLICT | STALE | FAILED_VERIFY.
 */

export type EditCollisionDispositionV1 =
	| "KEPT"
	| "REMAPPED"
	| "SUPPRESSED_CONFLICT"
	| "STALE"
	| "FAILED_VERIFY";

export interface EditCollisionRecordV1 {
	stepId: string;
	family: string;
	disposition: EditCollisionDispositionV1;
	reason: string;
	relatedStepId?: string;
}

export function recordCollision(args: {
	stepId: string;
	family: string;
	disposition: EditCollisionDispositionV1;
	reason: string;
	relatedStepId?: string;
}): EditCollisionRecordV1 {
	return {
		stepId: args.stepId,
		family: args.family,
		disposition: args.disposition,
		reason: args.reason,
		...(args.relatedStepId ? { relatedStepId: args.relatedStepId } : {}),
	};
}

/** Zoom + callout on same grounded target is allowed when geometry remains finite. */
export function zoomCalloutCompatible(args: {
	zoomFocus?: { cx: number; cy: number } | null;
	calloutXY?: { x: number; y: number } | null;
}): { ok: boolean; reason: string } {
	if (!args.zoomFocus || !args.calloutXY) {
		return { ok: true, reason: "no_overlap_check_needed" };
	}
	const cx = args.zoomFocus.cx * 100;
	const cy = args.zoomFocus.cy * 100;
	const dx = Math.abs(cx - args.calloutXY.x);
	const dy = Math.abs(cy - args.calloutXY.y);
	if (dx > 35 || dy > 35) {
		return { ok: false, reason: "callout_far_from_zoom_focus" };
	}
	return { ok: true, reason: "same_target_geometry_safe" };
}
