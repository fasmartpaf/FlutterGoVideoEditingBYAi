/**
 * Stable deterministic identities for Temporal Context records.
 */

import { createHash } from "node:crypto";
import type { TemporalRecordKind } from "./types";

export function stableHash(parts: unknown[]): string {
	return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

/**
 * Identity rules (identity-policy.json):
 * - Speech word: transcript asset + word id (or text+start+end if no id)
 * - Dead-air: candidate id from deadAir module
 * - Visual activity: kind + rounded start/end + reason
 * - Focal: owner focal id
 * - Editorial finding/rec/question: orchestration ids
 * - Existing edits: document entity ids
 * Refreshing analysis must not mint unrelated IDs for identical evidence.
 */
export function recordIdFor(args: {
	kind: TemporalRecordKind;
	mediaFingerprint: string;
	parts: unknown[];
}): string {
	return `tcr_${args.kind.toLowerCase()}_${stableHash([args.mediaFingerprint, args.kind, ...args.parts])}`;
}

export function roundTime(sec: number): number {
	return Math.round(sec * 1000) / 1000;
}
