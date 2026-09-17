/**
 * Video Memory Retrieval Production Path V1 — packing modes & identities.
 * Identity: CURRENT_OPENSCREEN_VIDEO_MEMORY_RETRIEVAL_PRODUCTION_V1
 *
 * CURRENT_FULL_CONTEXT remains available for A/B. Retrieval does not change
 * mutation authority, consent, apply, or verification semantics.
 */

export const VIDEO_MEMORY_RETRIEVAL_PRODUCTION_V1_ID =
	"CURRENT_OPENSCREEN_VIDEO_MEMORY_RETRIEVAL_PRODUCTION_V1" as const;

export const VIDEO_MEMORY_RETRIEVAL_CLOSURE_V1_ID =
	"CURRENT_OPENSCREEN_VIDEO_MEMORY_RETRIEVAL_CLOSURE_V1" as const;

export const VIDEO_MEMORY_RETRIEVAL_PROMOTION_GATE_V1_ID =
	"CURRENT_OPENSCREEN_VIDEO_MEMORY_RETRIEVAL_PROMOTION_GATE_V1" as const;

export const EVIDENCE_RETRIEVAL_COVERAGE_V1_ID =
	"CURRENT_OPENSCREEN_EVIDENCE_RETRIEVAL_COVERAGE_V1" as const;

export const EVIDENCE_RETRIEVAL_DEEPENING_V1_ID =
	"CURRENT_OPENSCREEN_EVIDENCE_RETRIEVAL_DEEPENING_V1" as const;

export const VIDEO_MEMORY_RETRIEVAL_PROVIDER_GATE_V2_ID =
	"CURRENT_OPENSCREEN_VIDEO_MEMORY_RETRIEVAL_PROVIDER_GATE_V2" as const;

export const BOUNDED_REASONING_V1_ID = "CURRENT_OPENSCREEN_BOUNDED_REASONING_V1" as const;

export const CONTEXT_PACKING_MODES = [
	"CURRENT_FULL_CONTEXT",
	"VIDEO_MEMORY_RETRIEVAL",
	"VIDEO_MEMORY_RETRIEVAL_COMPACT",
	"BOUNDED_REASONING_V1",
] as const;

export type ContextPackingMode = (typeof CONTEXT_PACKING_MODES)[number];

/** Default stays FULL_CONTEXT until promotion gate passes. */
export const DEFAULT_CONTEXT_PACKING: ContextPackingMode = "CURRENT_FULL_CONTEXT";

export function resolveContextPackingMode(
	override?: ContextPackingMode | null,
	env: NodeJS.ProcessEnv = process.env,
): ContextPackingMode {
	if (
		override === "CURRENT_FULL_CONTEXT" ||
		override === "VIDEO_MEMORY_RETRIEVAL" ||
		override === "VIDEO_MEMORY_RETRIEVAL_COMPACT" ||
		override === "BOUNDED_REASONING_V1"
	) {
		return override;
	}
	const fromEnv = env.OPENSCREEN_CONTEXT_PACKING?.trim();
	if (
		fromEnv === "CURRENT_FULL_CONTEXT" ||
		fromEnv === "VIDEO_MEMORY_RETRIEVAL" ||
		fromEnv === "VIDEO_MEMORY_RETRIEVAL_COMPACT" ||
		fromEnv === "BOUNDED_REASONING_V1"
	) {
		return fromEnv;
	}
	return DEFAULT_CONTEXT_PACKING;
}

export function isRetrievalPacking(mode: ContextPackingMode): boolean {
	return mode === "VIDEO_MEMORY_RETRIEVAL" || mode === "VIDEO_MEMORY_RETRIEVAL_COMPACT";
}

export function isCompactPacking(mode: ContextPackingMode): boolean {
	return mode === "VIDEO_MEMORY_RETRIEVAL_COMPACT";
}

export function isBoundedReasoningPacking(mode: ContextPackingMode): boolean {
	return mode === "BOUNDED_REASONING_V1";
}

/** Shared local memory/evidence path (Retrieval + Bounded). */
export function isMemoryBackedPacking(mode: ContextPackingMode): boolean {
	return isRetrievalPacking(mode) || isBoundedReasoningPacking(mode);
}

export type FrameAttachReason =
	| "speech_visual_contradiction"
	| "temporary_ui"
	| "transition_boundary"
	| "requested_action_target"
	| "editorial_focus"
	| "investigator_deepen"
	| "cross_modal_compare"
	| "visual_overview"
	| "periodic_coverage"
	| "coverage_anchor"
	| "speech_aligned";

export type AttachedFrameMeta = {
	sourceTimeSec: number;
	reason: FrameAttachReason;
	note: string;
};
