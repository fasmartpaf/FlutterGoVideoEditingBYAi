export {
	assertSourceTimestampsWithinDuration,
	ensureCanonicalSourceDuration,
	isAssetDurationStale,
	repairDocumentSourceDuration,
	resolveCanonicalSourceDuration,
} from "./canonical";
export {
	probeSourceDurations,
	resolveFfprobe,
	selectCanonicalDurationSec,
} from "./probe";
export type {
	CanonicalSourceDuration,
	ProbedSourceDurations,
	TimeValueKind,
} from "./types";
export {
	SOURCE_TIMESTAMP_TOLERANCE_SEC,
	STALE_DURATION_TOLERANCE_SEC,
	STREAM_DURATION_TOLERANCE_SEC,
} from "./types";
