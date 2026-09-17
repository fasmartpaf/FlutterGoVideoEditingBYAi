/**
 * Compact editorial projection — DESIGN ONLY (not wired to AI cognition).
 */

import type { VisualAnalysisV1, VisualEditorialSignals } from "./types";

/**
 * Project VisualAnalysisV1 into later-editorial-friendly signals.
 * Does not infer narrative chapters or safe trim points.
 */
export function toVisualEditorialSignals(analysis: VisualAnalysisV1): VisualEditorialSignals {
	const meaningful = analysis.changeEvents.filter(
		(c) => c.level === "MODERATE" || c.level === "SIGNIFICANT",
	);
	return {
		meaningfulChangeRanges: meaningful.map((c) => ({
			startSec: c.fromSec,
			endSec: c.toSec,
			level: c.level,
		})),
		stableRanges: analysis.stableIntervals.map((s) => ({
			startSec: s.startSec,
			endSec: s.endSec,
		})),
		sceneBoundaryCandidates: analysis.sceneEvents.map((s) => ({
			timeSec: s.timeSec,
		})),
		blackRanges: analysis.blackIntervals.map((b) => ({
			startSec: b.startSec,
			endSec: b.endSec,
		})),
		freezeRanges: analysis.freezeIntervals.map((f) => ({
			startSec: f.startSec,
			endSec: f.endSec,
		})),
	};
}

/**
 * Future consumers (documented, not implemented):
 * - chapter candidates: cluster sceneBoundaryCandidates + significant change gaps
 * - rough-cut candidates: activityIntervals with speech anchors (speech not here)
 * - app/scene transition analysis: scene ≠ narrative; pair with OCR/ledger later
 * - before/after edit verification: rematch source events via programmeMap
 */
export const FUTURE_VISUAL_ANALYSIS_CONSUMERS = [
	"dead_air_visual_safety",
	"editorial_evidence",
	"chapter_candidates",
	"rough_cut_candidates",
	"transition_diagnostics",
	"post_edit_verification",
	"visual_memory",
	"trim_diagnostics",
] as const;
