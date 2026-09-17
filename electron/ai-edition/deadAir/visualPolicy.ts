/**
 * Visual safety policy for Dead-Air V1.1.
 * High precision: prefer blocking / uncertain over auto-safe.
 */

export interface VisualSafetyPolicy {
	/** Prefer existing prepared/ledger evidence before FFmpeg. */
	preferExistingEvidence: boolean;
	/** Run bounded scene probe when existing evidence is empty and candidate would otherwise be safe. */
	enableScdetFallback: boolean;
	/** Padding around silence when probing FFmpeg scene/black/freeze (seconds). */
	ffmpegProbePaddingSec: number;
	/** Scene threshold for select='gt(scene,thr)' (same family as visualSpecialist). */
	sceneThreshold: number;
	/** Significant Bug-3 / ledger transitions inside proposed removal → block. */
	blockSignificantChange: boolean;
	/**
	 * Moderate changes inside proposed removal → UNCERTAIN (not auto-safe).
	 * Density ≥ this many moderate hits upgrades to MATERIAL.
	 */
	moderateDensityBlockCount: number;
	/** Cursor non-move (click/mouseup/…) inside silence → block. */
	blockCursorInteraction: boolean;
	/** Move-only cursor does not block. */
	ignoreCursorMove: boolean;
	/** Cached OCR / observed_visible_text overlapping proposed removal → block. */
	blockVisibleTextChange: boolean;
	/** Protect trim edges near visual events (seconds). */
	visualEdgePaddingSec: number;
	/** Run blackdetect/freezedetect as observations only (never unlock). */
	enableBlackFreezeProbe: boolean;
	/** Timeout for bounded FFmpeg probes. */
	ffmpegTimeoutMs: number;
}

export const DEFAULT_VISUAL_SAFETY_POLICY: VisualSafetyPolicy = {
	preferExistingEvidence: true,
	enableScdetFallback: true,
	ffmpegProbePaddingSec: 0.25,
	sceneThreshold: 0.08,
	blockSignificantChange: true,
	moderateDensityBlockCount: 2,
	blockCursorInteraction: true,
	ignoreCursorMove: true,
	blockVisibleTextChange: true,
	visualEdgePaddingSec: 0.2,
	enableBlackFreezeProbe: true,
	ffmpegTimeoutMs: 20_000,
};
