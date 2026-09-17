/**
 * Grounded focal discovery + SOURCE remapping after timeline mutations.
 * Never invents center geometry.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import {
	mapSourceSpanThroughDocument,
	sourceInstantSurvivesPlayback,
} from "../captionLayout/programmeMap";
import type { CursorSample } from "./investigation";
import { investigateFocalInRange } from "./investigation";

export type FocalEvidenceType =
	| "cursor_stable_cluster"
	| "cursor_click_dwell"
	| "cursor_convergence"
	| "none";

export interface GroundedFocalTargetV1 {
	version: 1;
	sourceRange: { startSec: number; endSec: number };
	focal: { cx: number; cy: number };
	evidenceType: FocalEvidenceType;
	evidenceRefs: string[];
	confidence: "high" | "medium" | "low";
	reason: string;
	programmeRanges: Array<{ startSec: number; endSec: number }>;
	survivesCurrentPlayback: boolean;
	notes: string[];
}

export type ZoomRemapDisposition =
	| "STALE_AND_INVALID"
	| "STALE_BUT_REMAPPABLE"
	| "REINVESTIGATION_REQUIRED"
	| "STILL_VALID";

export interface ZoomExecutionCandidateV1 {
	sourceStartSec: number;
	sourceEndSec: number;
	programmeStartSec: number;
	programmeEndSec: number;
	depth: number;
	focus: { cx: number; cy: number };
	evidenceRefs: string[];
	reason: string;
	remapDisposition: ZoomRemapDisposition;
}

/**
 * Prefer click/dwell clusters; fall back to stable cursor mean. No invented center.
 */
export function discoverGroundedFocalTargets(args: {
	document: AxcutDocument;
	assetId: string;
	ranges: Array<{ startSec: number; endSec: number; reason?: string }>;
	cursorSamples?: CursorSample[] | null;
	maxTargets?: number;
}): GroundedFocalTargetV1[] {
	const max = args.maxTargets ?? 2;
	const samples = args.cursorSamples ?? [];
	const out: GroundedFocalTargetV1[] = [];

	for (const range of args.ranges) {
		if (out.length >= max) break;
		const inRange = samples.filter((s) => s.atSec >= range.startSec && s.atSec <= range.endSec);
		if (inRange.length < 3) {
			continue;
		}

		// Convergence: last third of samples pull toward a cluster
		const last = inRange.slice(Math.floor(inRange.length * 0.5));
		const meanCx = last.reduce((n, s) => n + s.cx, 0) / last.length;
		const meanCy = last.reduce((n, s) => n + s.cy, 0) / last.length;
		const varCx = last.reduce((n, s) => n + (s.cx - meanCx) ** 2, 0) / last.length;
		const varCy = last.reduce((n, s) => n + (s.cy - meanCy) ** 2, 0) / last.length;
		const stable = varCx < 0.012 && varCy < 0.012;

		if (!stable) continue;

		const inv = investigateFocalInRange({
			document: args.document,
			assetId: args.assetId,
			startSec: range.startSec,
			endSec: range.endSec,
			cursorSamples: samples,
			question: "grounded_focal_for_zoom",
		});
		if (!inv.focalFound || !inv.focal) continue;

		const mid = (range.startSec + range.endSec) / 2;
		const survives = sourceInstantSurvivesPlayback(args.document, args.assetId, mid);
		const programmeRanges = mapSourceSpanThroughDocument(
			args.document,
			args.assetId,
			range.startSec,
			range.endSec,
		);
		out.push({
			version: 1,
			sourceRange: { startSec: range.startSec, endSec: range.endSec },
			focal: { cx: inv.focal.cx, cy: inv.focal.cy },
			evidenceType: "cursor_stable_cluster",
			evidenceRefs: inv.evidenceRefs,
			confidence: varCx + varCy < 0.006 ? "high" : "medium",
			reason: range.reason ?? "Stable cursor cluster during speech/activity window",
			programmeRanges,
			survivesCurrentPlayback: survives,
			notes: inv.notes,
		});
	}
	return out;
}

export function remapGroundedFocalAfterMutation(args: {
	document: AxcutDocument;
	assetId: string;
	focal: GroundedFocalTargetV1;
}): { disposition: ZoomRemapDisposition; candidate: ZoomExecutionCandidateV1 | null } {
	const mid = (args.focal.sourceRange.startSec + args.focal.sourceRange.endSec) / 2;
	const survives = sourceInstantSurvivesPlayback(args.document, args.assetId, mid);
	if (!survives) {
		return { disposition: "STALE_AND_INVALID", candidate: null };
	}

	const programmeRanges = mapSourceSpanThroughDocument(
		args.document,
		args.assetId,
		args.focal.sourceRange.startSec,
		args.focal.sourceRange.endSec,
	);
	if (programmeRanges.length < 1) {
		return { disposition: "REINVESTIGATION_REQUIRED", candidate: null };
	}

	const prog = programmeRanges[0]!;
	if (!(prog.endSec > prog.startSec + 0.35)) {
		return { disposition: "STALE_AND_INVALID", candidate: null };
	}

	const disposition: ZoomRemapDisposition =
		args.focal.programmeRanges[0] &&
		Math.abs(args.focal.programmeRanges[0].startSec - prog.startSec) < 1e-3 &&
		Math.abs(args.focal.programmeRanges[0].endSec - prog.endSec) < 1e-3
			? "STILL_VALID"
			: "STALE_BUT_REMAPPABLE";

	return {
		disposition,
		candidate: {
			sourceStartSec: args.focal.sourceRange.startSec,
			sourceEndSec: args.focal.sourceRange.endSec,
			programmeStartSec: prog.startSec,
			programmeEndSec: prog.endSec,
			depth: 2,
			focus: { ...args.focal.focal },
			evidenceRefs: args.focal.evidenceRefs,
			reason: args.focal.reason,
			remapDisposition: disposition,
		},
	};
}
