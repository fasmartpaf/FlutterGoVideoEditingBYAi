/**
 * Spoken self-correction scaffold — general, not Case4-specific.
 */

import type { ClaimPromotionSet } from "../claimPromotion/types";
import type { PacketEpistemicItem } from "./types";

export type CorrectionScaffoldItem = {
	role: "initial_intention" | "corrected_intention" | "correction_marker";
	text: string;
	state: "SPOKEN";
	superseded: boolean;
	supersedesRef: string | null;
	claimId: string | null;
	sourceTimeSec: number | null;
	visualVerification: "NOT_VERIFIED" | "VERIFIED" | "CONTRADICTED" | "UNKNOWN";
};

export type CorrectionScaffold = {
	present: boolean;
	items: CorrectionScaffoldItem[];
	summary: string | null;
};

const CORRECTION_HINT =
	/\b(?:i\s+mean(?:t)?|actually|correct(?:ed)?\s+myself|sorry|wait|rather|instead|no[, ]+i\s+meant|first\s+i\s+said|then\s+i)\b/i;

/**
 * Detect supersession chains from spoken claims / correction kinds.
 */
export function buildCorrectionScaffold(input: {
	spoken: PacketEpistemicItem[];
	claims: ClaimPromotionSet | null;
	userMessage: string;
}): CorrectionScaffold {
	const wants =
		CORRECTION_HINT.test(input.userMessage) ||
		/\bcorrect(?:ed)?\s+myself|first\s+(?:say|said)|listen/i.test(input.userMessage);

	const correctionClaims =
		input.claims?.claims.filter(
			(c) => c.kind === "spoken_correction" || CORRECTION_HINT.test(c.text),
		) ?? [];

	const spokenSorted = [...input.spoken].sort(
		(a, b) => (a.sourceTimeSec ?? 0) - (b.sourceTimeSec ?? 0),
	);

	if (!wants && correctionClaims.length === 0) {
		return { present: false, items: [], summary: null };
	}

	const items: CorrectionScaffoldItem[] = [];

	if (spokenSorted.length >= 2) {
		const initial = spokenSorted[0]!;
		const corrected = spokenSorted[spokenSorted.length - 1]!;
		items.push({
			role: "initial_intention",
			text: initial.text.slice(0, 220),
			state: "SPOKEN",
			superseded: true,
			supersedesRef: null,
			claimId: initial.claimId ?? null,
			sourceTimeSec: initial.sourceTimeSec ?? null,
			visualVerification: "NOT_VERIFIED",
		});
		if (correctionClaims.length || CORRECTION_HINT.test(input.userMessage)) {
			items.push({
				role: "correction_marker",
				text: "Speaker indicated a correction / supersession of earlier wording",
				state: "SPOKEN",
				superseded: false,
				supersedesRef: initial.claimId ?? "initial",
				claimId: correctionClaims[0]?.id ?? null,
				sourceTimeSec: correctionClaims[0]?.provenance?.[0]?.sourceTimeSec ?? null,
				visualVerification: "UNKNOWN",
			});
		}
		items.push({
			role: "corrected_intention",
			text: corrected.text.slice(0, 220),
			state: "SPOKEN",
			superseded: false,
			supersedesRef: initial.claimId ?? "initial",
			claimId: corrected.claimId ?? null,
			sourceTimeSec: corrected.sourceTimeSec ?? null,
			visualVerification: "NOT_VERIFIED",
		});
	} else if (spokenSorted.length === 1) {
		const only = spokenSorted[0]!;
		items.push({
			role: "corrected_intention",
			text: only.text.slice(0, 220),
			state: "SPOKEN",
			superseded: false,
			supersedesRef: null,
			claimId: only.claimId ?? null,
			sourceTimeSec: only.sourceTimeSec ?? null,
			visualVerification: "NOT_VERIFIED",
		});
	}

	for (const c of correctionClaims.slice(0, 3)) {
		if (items.some((i) => i.claimId === c.id)) continue;
		items.push({
			role: "correction_marker",
			text: c.text.slice(0, 220),
			state: "SPOKEN",
			superseded: false,
			supersedesRef: null,
			claimId: c.id,
			sourceTimeSec: c.provenance?.[0]?.sourceTimeSec ?? null,
			visualVerification: "NOT_VERIFIED",
		});
	}

	const summary = items.length
		? `Correction scaffold: ${items.map((i) => i.role).join(" → ")}. Panel/action opens remain NOT_VERIFIED unless visual evidence proves them.`
		: null;

	return { present: items.length > 0, items, summary };
}
