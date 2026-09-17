/**
 * Visual join verify — integrity vs discontinuity (not aesthetic).
 */

import { analyzeRgba8 } from "../compositorVerify";
import type { JoinModalityResult, ProgrammeJoinV1 } from "./types";

export interface JoinFrameSample {
	programmeTimeSec: number;
	width: number;
	height: number;
	rgba: Uint8Array | Buffer;
	label: "pre_delta" | "pre_eps" | "post_eps" | "post_delta" | "at_join";
}

function meanLuma(rgba: Uint8Array | Buffer, width: number, height: number): number {
	return analyzeRgba8(rgba, width, height).meanLuma;
}

export function verifyJoinVisual(args: {
	join: ProgrammeJoinV1;
	frames?: JoinFrameSample[] | null;
}): JoinModalityResult {
	const t0 = Date.now();
	const notes: string[] = [];
	const blocking: string[] = [];
	const warnings: string[] = [];
	const evidenceRefs: string[] = [];

	if (args.join.cause === "SPEED_BOUNDARY") {
		return {
			outcome: "NOT_APPLICABLE",
			blockingReasons: [],
			warnings: [],
			evidenceRefs: [],
			notes: ["speed_boundary_motion_change_not_integrity_failure"],
			latencyMs: Date.now() - t0,
			metrics: { VISUAL_DISCONTINUITY_PRESENT: false, VISUAL_INTEGRITY_FAILURE: false },
		};
	}

	if (!args.frames?.length) {
		return {
			outcome: "INSUFFICIENT_EVIDENCE",
			blockingReasons: [],
			warnings: ["no_compositor_frames"],
			evidenceRefs: [],
			notes: ["visual_frames_not_supplied"],
			latencyMs: Date.now() - t0,
			metrics: { VISUAL_DISCONTINUITY_PRESENT: false, VISUAL_INTEGRITY_FAILURE: false },
		};
	}

	let integrityFailure = false;
	let discontinuityPresent = false;
	const lumas: number[] = [];

	for (const f of args.frames) {
		const stats = analyzeRgba8(f.rgba, f.width, f.height);
		evidenceRefs.push(`frame:${f.label}@${f.programmeTimeSec.toFixed(3)}`);
		if (!stats.valid || stats.entirelyTransparent) {
			integrityFailure = true;
			blocking.push(`invalid_frame:${f.label}`);
			notes.push(`VISUAL_INTEGRITY_FAILURE:${f.label}`);
		} else if (stats.uniform && stats.nearBlackFraction > 0.99 && stats.meanLuma < 1) {
			// Pure black void (not merely a dark UI frame)
			integrityFailure = true;
			blocking.push(`blank_black_frame:${f.label}`);
			notes.push(`VISUAL_INTEGRITY_FAILURE:black:${f.label}`);
		}
		lumas.push(meanLuma(f.rgba, f.width, f.height));
	}

	if (lumas.length >= 2) {
		const pre = lumas[0] ?? 0;
		const post = lumas[lumas.length - 1] ?? 0;
		const delta = Math.abs(post - pre);
		if (delta > 40) {
			discontinuityPresent = true;
			notes.push("VISUAL_DISCONTINUITY_PRESENT");
			// Intentional hard cuts are NOT blocking integrity failures.
			warnings.push(`visual_discontinuity_luma_delta:${delta.toFixed(1)}`);
		}
	}

	args.join.visualContext = { notes: [...notes] };

	const outcome = integrityFailure ? "FAIL" : warnings.length > 0 ? "WARNING" : "PASS";

	return {
		outcome,
		blockingReasons: blocking,
		warnings,
		evidenceRefs,
		notes,
		latencyMs: Date.now() - t0,
		metrics: {
			VISUAL_DISCONTINUITY_PRESENT: discontinuityPresent,
			VISUAL_INTEGRITY_FAILURE: integrityFailure,
			frameCount: args.frames.length,
		},
	};
}

/** Suggested sample times around a join (programme seconds). */
export function suggestedVisualSampleTimes(
	joinProgrammeSec: number,
	delta = 0.25,
	eps = 0.04,
): Array<{ programmeTimeSec: number; label: JoinFrameSample["label"] }> {
	return [
		{ programmeTimeSec: Math.max(0, joinProgrammeSec - delta), label: "pre_delta" },
		{ programmeTimeSec: Math.max(0, joinProgrammeSec - eps), label: "pre_eps" },
		{ programmeTimeSec: joinProgrammeSec, label: "at_join" },
		{ programmeTimeSec: joinProgrammeSec + eps, label: "post_eps" },
		{ programmeTimeSec: joinProgrammeSec + delta, label: "post_delta" },
	];
}
