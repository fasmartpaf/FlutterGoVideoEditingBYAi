/**
 * Temporal Context Store adapter — refs/summaries only, no PCM/frame blobs.
 */

import type { FinalSequenceCutQualityResultV1, FinalSequenceJoinVerificationV1 } from "./types";

export interface TemporalJoinVerifyRecord {
	kind: "FINAL_SEQUENCE_JOIN_VERIFY";
	id: string;
	joinId: string;
	programmeTimeSec: number;
	cause: string;
	overall: string;
	severity: string;
	payloadRef: string;
	normalizedSummary: string;
	mediaFingerprint: string;
	programmeFingerprint: string;
}

export function temporalRecordsFromSequenceResult(
	result: FinalSequenceCutQualityResultV1,
): TemporalJoinVerifyRecord[] {
	return result.joins.map((j) => joinToTemporalRecord(j, result));
}

export function joinToTemporalRecord(
	v: FinalSequenceJoinVerificationV1,
	result: FinalSequenceCutQualityResultV1,
): TemporalJoinVerifyRecord {
	return {
		kind: "FINAL_SEQUENCE_JOIN_VERIFY",
		id: `tcs_${v.join.joinId}`,
		joinId: v.join.joinId,
		programmeTimeSec: v.join.programmeTimeSec,
		cause: v.join.cause,
		overall: v.overall,
		severity: v.severity,
		payloadRef: `finalSequenceCutQualityVerify:${v.join.joinId}`,
		normalizedSummary: `${v.overall} ${v.join.cause} @${v.join.programmeTimeSec.toFixed(2)}s blocking=${v.blockingReasons.length}`,
		mediaFingerprint: result.mediaFingerprint,
		programmeFingerprint: result.programmeFingerprint,
	};
}
