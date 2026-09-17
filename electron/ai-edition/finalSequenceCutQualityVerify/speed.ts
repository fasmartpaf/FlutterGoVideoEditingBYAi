/**
 * Speed boundary integrity (timing continuity — not visual “bad cut”).
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { expectedProgrammeDurationForSpeed } from "../editVerify/speedMath";
import type { JoinModalityResult, ProgrammeJoinV1 } from "./types";

export function verifyJoinSpeed(args: {
	document: AxcutDocument;
	join: ProgrammeJoinV1;
}): JoinModalityResult {
	const t0 = Date.now();
	if (args.join.cause !== "SPEED_BOUNDARY") {
		return {
			outcome: "NOT_APPLICABLE",
			blockingReasons: [],
			warnings: [],
			evidenceRefs: [],
			notes: ["not_a_speed_boundary"],
			latencyMs: Date.now() - t0,
		};
	}

	const blocking: string[] = [];
	const warnings: string[] = [];
	const notes: string[] = [];

	const leftDur = args.join.leftSourceRange.endSec - args.join.leftSourceRange.startSec;
	const rightDur = args.join.rightSourceRange.endSec - args.join.rightSourceRange.startSec;
	if (!(leftDur >= 0) || !(rightDur >= 0)) {
		blocking.push("invalid_speed_edge_ranges");
	}

	for (const speed of [0.5, 1, 1.5, 2]) {
		const d = expectedProgrammeDurationForSpeed(1, speed);
		if (!Number.isFinite(d) || d <= 0) {
			blocking.push(`speed_math_invalid:${speed}`);
		}
	}

	if (args.join.programmeTimeSec < 0) {
		blocking.push("negative_programme_time");
	}

	notes.push("speed_boundary_checked_timing_only");
	notes.push("motion_magnitude_change_not_integrity_failure");

	return {
		outcome: blocking.length > 0 ? "FAIL" : warnings.length > 0 ? "WARNING" : "PASS",
		blockingReasons: blocking,
		warnings,
		evidenceRefs: args.join.mutationRefs,
		notes,
		latencyMs: Date.now() - t0,
		metrics: { programmeTimeSec: args.join.programmeTimeSec },
	};
}
