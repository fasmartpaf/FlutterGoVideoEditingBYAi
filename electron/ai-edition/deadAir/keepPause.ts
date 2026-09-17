/**
 * KEEP_SOME_PAUSE — shorten excess dead air; never collapse pauses to zero.
 */

import { type DeadAirPolicyConfig, targetPauseForClassification } from "./config";
import type { SilenceClassification, SourceTimeRange } from "./types";

export interface KeepPausePlan {
	ok: boolean;
	proposedTrim: SourceTimeRange | null;
	targetPauseKeptSec: number;
	resultingRemovedDurationSec: number;
	reason?: string;
}

/**
 * Preserve `targetKeep` at the **start** of the padded silence window
 * (breath after prior speech), remove excess until padded end.
 */
export function planKeepSomePause(args: {
	silenceStartSec: number;
	silenceEndSec: number;
	classification: SilenceClassification;
	paddingBeforeSec: number;
	paddingAfterSec: number;
	policy: DeadAirPolicyConfig;
	/** Optional override from pause-function intelligence (SHORTEN retain amount). */
	targetPauseKeptSecOverride?: number;
}): KeepPausePlan {
	const targetPauseKeptSec =
		typeof args.targetPauseKeptSecOverride === "number" &&
		Number.isFinite(args.targetPauseKeptSecOverride)
			? Math.max(0.12, args.targetPauseKeptSecOverride)
			: targetPauseForClassification(args.classification, args.policy);
	const windowStart = args.silenceStartSec + args.paddingBeforeSec;
	const windowEnd = args.silenceEndSec - args.paddingAfterSec;
	const available = windowEnd - windowStart;

	if (!(available > 0)) {
		return {
			ok: false,
			proposedTrim: null,
			targetPauseKeptSec,
			resultingRemovedDurationSec: 0,
			reason: "padded_window_empty",
		};
	}

	const removable = available - targetPauseKeptSec;
	if (removable + 1e-9 < args.policy.minRemovableSec) {
		return {
			ok: false,
			proposedTrim: null,
			targetPauseKeptSec,
			resultingRemovedDurationSec: 0,
			reason: "insufficient_excess_after_keep",
		};
	}

	const trimStart = windowStart + targetPauseKeptSec;
	const trimEnd = windowEnd;
	if (!(trimEnd > trimStart + 1e-6)) {
		return {
			ok: false,
			proposedTrim: null,
			targetPauseKeptSec,
			resultingRemovedDurationSec: 0,
			reason: "degenerate_trim",
		};
	}

	return {
		ok: true,
		proposedTrim: {
			timebase: "SOURCE_MEDIA_TIME",
			startSec: trimStart,
			endSec: trimEnd,
		},
		targetPauseKeptSec,
		resultingRemovedDurationSec: trimEnd - trimStart,
	};
}
