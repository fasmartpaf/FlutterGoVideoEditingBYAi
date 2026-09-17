/**
 * Editorial pause decision — story-aware KEEP / SHORTEN / REMOVE labels
 * over dead-air candidates (does not invent ranges).
 */

import type { DeadAirCandidateV1 } from "../deadAir";

export type EditorialPauseActionV1 = "KEEP" | "SHORTEN" | "REMOVE";

export interface EditorialPauseDecisionV1 {
	candidateId: string;
	action: EditorialPauseActionV1;
	sourceStartSec: number;
	sourceEndSec: number;
	silenceDurationSec: number;
	resultingRemovedDurationSec: number;
	classification: string;
	reason: string;
	speechSafe: boolean;
}

export function buildEditorialPauseDecisions(
	candidates: DeadAirCandidateV1[],
): EditorialPauseDecisionV1[] {
	return candidates.map((c) => {
		const speechSafe = !c.speechBoundaryState?.blocking;
		if (c.safeToPropose && c.proposedTrimRange && c.resultingRemovedDurationSec > 0) {
			const removesMost =
				c.resultingRemovedDurationSec >= Math.max(0.8, c.silenceDurationSec * 0.55);
			return {
				candidateId: c.id,
				action: removesMost ? "REMOVE" : "SHORTEN",
				sourceStartSec: c.proposedTrimRange.startSec,
				sourceEndSec: c.proposedTrimRange.endSec,
				silenceDurationSec: c.silenceDurationSec,
				resultingRemovedDurationSec: c.resultingRemovedDurationSec,
				classification: c.classification,
				reason: removesMost
					? "Unnecessary quiet gap; speech-safe excess removed"
					: "Shortened quiet gap while keeping a natural breath",
				speechSafe,
			};
		}
		return {
			candidateId: c.id,
			action: "KEEP",
			sourceStartSec: c.silenceRange.startSec,
			sourceEndSec: c.silenceRange.endSec,
			silenceDurationSec: c.silenceDurationSec,
			resultingRemovedDurationSec: 0,
			classification: c.classification,
			reason: c.blockingReasons.join("; ") || "Policy retained pause",
			speechSafe,
		};
	});
}
