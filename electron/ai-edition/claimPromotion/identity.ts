/**
 * Conservative claim identity / dedupe — no embeddings.
 */

import type { ClaimKind } from "./types";

export function normalizeSubject(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Build a deterministic identity key.
 * Same event type + evidence class + time bucket + subject → same claim.
 * Do not merge different kinds (visible_text vs user_action).
 */
export function claimIdentityKey(input: {
	kind: ClaimKind;
	assetId: string;
	subject: string;
	startSourceTimeSec: number;
	endSourceTimeSec: number;
	isActionClaim: boolean;
}): string {
	const t0 = Math.round(input.startSourceTimeSec * 10) / 10;
	const t1 = Math.round(input.endSourceTimeSec * 10) / 10;
	const subj = normalizeSubject(input.subject).slice(0, 80);
	const action = input.isActionClaim ? "action" : "obs";
	return `${input.assetId}|${input.kind}|${action}|${subj}|${t0}-${t1}`;
}
