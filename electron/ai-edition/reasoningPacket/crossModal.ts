/**
 * Deterministic cross-modal spoken↔visual relations — Reliability V2.
 * Lack of contradiction ≠ MATCH. Prefer NOT_VISUALLY_VERIFIED.
 */

import type { ClaimPromotionSet } from "../claimPromotion/types";
import type { PacketEpistemicItem } from "./types";

export type VisualSupportLabel =
	| "VERIFIED_MATCH"
	| "POSSIBLE_MATCH"
	| "NOT_VISUALLY_VERIFIED"
	| "CONTRADICTED"
	| "UNKNOWN";

export type CrossModalEvidenceRelation = {
	spokenClaimRef: string;
	spokenText: string;
	speechRange: { startSec: number | null; endSec: number | null };
	visualRange: { startSec: number | null; endSec: number | null };
	visualSupport: VisualSupportLabel;
	evidenceRefs: string[];
	note: string;
};

const ACTIONISH =
	/\b(?:open|opened|click|clicked|select|selected|navigat|switch|restart|work(?:ed)?\s+on|show(?:ed)?|went\s+to)\b/i;

/**
 * Build relations for material spoken claims using Claim Promotion + local lists.
 * Never invents VERIFIED_MATCH without supported/verified visual status.
 */
export function buildCrossModalRelations(input: {
	spoken: PacketEpistemicItem[];
	supported: PacketEpistemicItem[];
	contradicted: PacketEpistemicItem[];
	known: PacketEpistemicItem[];
	claims: ClaimPromotionSet | null;
	frameTimes: number[];
}): CrossModalEvidenceRelation[] {
	const relations: CrossModalEvidenceRelation[] = [];
	const frameMin = input.frameTimes.length ? Math.min(...input.frameTimes) : null;
	const frameMax = input.frameTimes.length ? Math.max(...input.frameTimes) : null;

	for (const s of input.spoken.slice(0, 8)) {
		const claimId = s.claimId ?? `spoken:${s.text.slice(0, 40)}`;
		const claim = input.claims?.claims.find((c) => c.id === s.claimId);
		const contradictedNear = input.contradicted.some(
			(c) =>
				(s.sourceTimeSec != null &&
					c.sourceTimeSec != null &&
					Math.abs(c.sourceTimeSec - s.sourceTimeSec) < 8) ||
				tokenOverlap(c.text, s.text) >= 2,
		);
		const supportedNear = input.supported.some(
			(c) =>
				(s.sourceTimeSec != null &&
					c.sourceTimeSec != null &&
					Math.abs(c.sourceTimeSec - s.sourceTimeSec) < 8) ||
				tokenOverlap(c.text, s.text) >= 2,
		);
		const knownTextNear = input.known.some((k) => tokenOverlap(k.text, s.text) >= 3);

		let visualSupport: VisualSupportLabel = "NOT_VISUALLY_VERIFIED";
		let note = "Spoken claim has no confirming visual status in packet";

		if (contradictedNear || claim?.status === "contradicted") {
			visualSupport = "CONTRADICTED";
			note = "Local contradiction evidence present";
		} else if (supportedNear || claim?.status === "supported" || claim?.status === "verified") {
			visualSupport = "VERIFIED_MATCH";
			note = "Claim status supported/verified against local visual evidence";
		} else if (knownTextNear && !ACTIONISH.test(s.text)) {
			visualSupport = "POSSIBLE_MATCH";
			note = "Lexical overlap with known visible text — not action verification";
		} else if (ACTIONISH.test(s.text)) {
			visualSupport = "NOT_VISUALLY_VERIFIED";
			note = "Action-like speech remains unverified unless visual/cursor proves it";
		} else if (input.frameTimes.length === 0) {
			visualSupport = "UNKNOWN";
			note = "No frames attached for visual check";
		}

		relations.push({
			spokenClaimRef: claimId,
			spokenText: s.text.slice(0, 200),
			speechRange: {
				startSec: s.sourceTimeSec ?? null,
				endSec: s.sourceTimeSec != null ? s.sourceTimeSec + 4 : null,
			},
			visualRange: { startSec: frameMin, endSec: frameMax },
			visualSupport,
			evidenceRefs: [
				claimId,
				...((claim?.provenance?.map((p) => p.eventId).filter(Boolean) as string[]) ?? []),
			].slice(0, 6),
			note,
		});
	}

	return relations;
}

function tokenOverlap(a: string, b: string): number {
	const ta = new Set(
		a
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((t) => t.length > 3),
	);
	const tb = b
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length > 3);
	let n = 0;
	for (const t of tb) if (ta.has(t)) n += 1;
	return n;
}
