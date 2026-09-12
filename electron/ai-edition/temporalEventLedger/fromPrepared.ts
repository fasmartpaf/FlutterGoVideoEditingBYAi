/**
 * Bridge prepared OpenScreen turn evidence → Temporal Event Ledger input.
 */

import type { SpeechEvidence } from "../speechEvidence/types";
import type { VisualSemanticGrounding } from "../visualEvidence/semantic";
import type { VisualChange, VisualEvidenceFrame } from "../visualEvidence/types";
import { buildTemporalEventLedger } from "./build";
import type { BuildTemporalEventLedgerInput, TemporalEventLedger } from "./types";

export interface PreparedEvidenceForLedger {
	assetId: string;
	sourceDurationSec: number;
	speechEvidence?: SpeechEvidence | null;
	frames?: VisualEvidenceFrame[];
	changes?: VisualChange[];
	cursorInteractions?: Array<{ sourceTimeSec: number; interactionType?: string }>;
	semanticGrounding?: VisualSemanticGrounding | null;
}

export function buildLedgerFromPreparedEvidence(
	input: PreparedEvidenceForLedger,
): TemporalEventLedger {
	const speech = input.speechEvidence;
	const payload: BuildTemporalEventLedgerInput = {
		assetId: input.assetId,
		sourceDurationSec: input.sourceDurationSec,
		speech: speech
			? {
					status: speech.status,
					segments: speech.segments.map((s, i) => ({
						id: `s${i + 1}`,
						startSourceTimeSec: s.startSourceTimeSec,
						endSourceTimeSec: s.endSourceTimeSec,
						text: s.text,
					})),
				}
			: undefined,
		frames: (input.frames ?? []).map((f) => ({
			sourceTimeSec: f.sourceTimeSec,
			reason: f.reason,
			imagePath: f.imagePath,
		})),
		changes: (input.changes ?? []).map((c) => ({
			fromSourceTimeSec: c.fromSourceTimeSec,
			toSourceTimeSec: c.toSourceTimeSec,
			classification: c.classification,
			score: c.score,
		})),
		cursorInteractions: input.cursorInteractions,
		semantic: input.semanticGrounding
			? {
					observations: input.semanticGrounding.observations.map((o) => ({
						sourceTimeSec: o.sourceTimeSec,
						frameSummary: o.frameSummary,
						frontmostSurface: o.frontmostSurface,
						backgroundSurfaces: o.backgroundSurfaces,
						observed: o.observed,
						inferred: o.inferred,
					})),
				}
			: undefined,
	};
	return buildTemporalEventLedger(payload);
}
