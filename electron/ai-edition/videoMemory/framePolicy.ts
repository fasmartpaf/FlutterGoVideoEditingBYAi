/**
 * Query-aware frame budget + selection with explicit attach reasons.
 * Whole-media selection uses coverage floor + temporal diversity (Coverage V1).
 */

import type { VisualChange, VisualEvidenceFrame } from "../visualEvidence/types";
import { MAX_VISUAL_FRAMES } from "../visualEvidence/types";
import {
	type FrameSelectionResult,
	selectFramesWithCoverage,
	type VisualEvidenceCoverage,
} from "./coverage";
import { EVIDENCE_RETRIEVAL_DEEPENING_V1_ID } from "./eventRegions";
import type { VideoMemoryQueryClass, VideoMemoryV1 } from "./index";
import type { AttachedFrameMeta, FrameAttachReason } from "./productionPath";
import {
	classifyQueryScope,
	type FocusWindow,
	needsWholeMediaCoverage,
	parseFocusWindow,
	type QueryScope,
} from "./queryScope";

export { EVIDENCE_RETRIEVAL_DEEPENING_V1_ID };

export type FrameBudgetPolicy = {
	maxFrames: number;
	/** Extract cap including coverage anchors + change deepen (may exceed attach). */
	maxExtract: number;
	preferChangeBoundaries: boolean;
	preferLateWindow: boolean;
	lateWindowStartFrac: number;
	coverageFirst: boolean;
};

export function frameBudgetForQuery(
	queryClass: VideoMemoryQueryClass,
	scope: QueryScope = "unknown",
): FrameBudgetPolicy {
	const whole = needsWholeMediaCoverage(queryClass, scope);
	switch (queryClass) {
		case "speech":
			return {
				maxFrames: 0,
				maxExtract: 0,
				preferChangeBoundaries: false,
				preferLateWindow: false,
				lateWindowStartFrac: 0.6,
				coverageFirst: false,
			};
		case "direct_edit":
			return {
				maxFrames: 0,
				maxExtract: 0,
				preferChangeBoundaries: false,
				preferLateWindow: false,
				lateWindowStartFrac: 0.6,
				coverageFirst: false,
			};
		case "action_verify":
			return {
				maxFrames: 4,
				maxExtract: 5,
				preferChangeBoundaries: true,
				preferLateWindow: false,
				lateWindowStartFrac: 0.5,
				coverageFirst: false,
			};
		case "visual":
			if (scope === "local") {
				return {
					maxFrames: 3,
					maxExtract: 4,
					preferChangeBoundaries: true,
					preferLateWindow: false,
					lateWindowStartFrac: 0.5,
					coverageFirst: false,
				};
			}
			if (scope === "bounded_range") {
				return {
					maxFrames: 4,
					maxExtract: 5,
					preferChangeBoundaries: true,
					preferLateWindow: /end/i.test(String(scope)),
					lateWindowStartFrac: 0.65,
					coverageFirst: false,
				};
			}
			return {
				maxFrames: 6,
				maxExtract: whole ? Math.min(10, MAX_VISUAL_FRAMES) : 6,
				preferChangeBoundaries: true,
				preferLateWindow: false,
				lateWindowStartFrac: 0.5,
				coverageFirst: whole,
			};
		case "cross_modal":
			return {
				maxFrames: 6,
				maxExtract: whole ? Math.min(10, MAX_VISUAL_FRAMES) : 6,
				preferChangeBoundaries: true,
				preferLateWindow: false,
				lateWindowStartFrac: 0.5,
				coverageFirst: whole,
			};
		case "editorial":
			return {
				maxFrames: 6,
				maxExtract: whole ? Math.min(10, MAX_VISUAL_FRAMES) : 6,
				preferChangeBoundaries: true,
				preferLateWindow: false,
				lateWindowStartFrac: 0.4,
				coverageFirst: whole,
			};
		default:
			return {
				maxFrames: 4,
				maxExtract: 4,
				preferChangeBoundaries: true,
				preferLateWindow: false,
				lateWindowStartFrac: 0.5,
				coverageFirst: false,
			};
	}
}

export function primaryFrameReason(
	queryClass: VideoMemoryQueryClass,
	frame: VisualEvidenceFrame,
	memory: VideoMemoryV1 | null,
): { reason: FrameAttachReason; note: string } {
	const t = frame.sourceTimeSec;
	if (queryClass === "action_verify") {
		return { reason: "requested_action_target", note: `action_verify @ ${t.toFixed(2)}s` };
	}
	if (queryClass === "cross_modal") {
		const nearContradiction = memory?.contradictionHints?.length
			? "near contradiction evidence"
			: "speech↔visual compare";
		return { reason: "cross_modal_compare", note: nearContradiction };
	}
	if (queryClass === "editorial") {
		if (frame.reason === "change_refinement" || frame.reason === "clip_boundary") {
			return { reason: "transition_boundary", note: `editorial transition @ ${t.toFixed(2)}s` };
		}
		if (
			memory?.temporaryUiHints?.length &&
			/restart|hud|recording/i.test(memory.temporaryUiHints.join(" "))
		) {
			return { reason: "temporary_ui", note: `temp UI neighborhood @ ${t.toFixed(2)}s` };
		}
		return { reason: "editorial_focus", note: `story beat sample @ ${t.toFixed(2)}s` };
	}
	if (frame.reason === "change_refinement") {
		return { reason: "transition_boundary", note: `change midpoint @ ${t.toFixed(2)}s` };
	}
	if (queryClass === "visual") {
		return { reason: "visual_overview", note: `visual sample @ ${t.toFixed(2)}s` };
	}
	return { reason: "periodic_coverage", note: `coverage @ ${t.toFixed(2)}s` };
}

/**
 * Cull prepared frames to query budget; attach explicit reasons.
 * Whole-media: coverage floor then relevance deepen with diversity.
 */
export function selectFramesForRetrieval(input: {
	frames: VisualEvidenceFrame[];
	queryClass: VideoMemoryQueryClass;
	memory?: VideoMemoryV1 | null;
	priorityTimesSec?: number[];
	queryScope?: QueryScope;
	userMessage?: string;
	focusWindow?: FocusWindow | null;
	durationSec?: number;
	changes?: VisualChange[];
}): FrameSelectionResult {
	const scope = input.queryScope ?? classifyQueryScope(input.userMessage ?? "", input.queryClass);
	const budget = frameBudgetForQuery(input.queryClass, scope);
	const duration = input.durationSec ?? input.memory?.sourceDurationSec ?? 0;
	const focusWindow =
		input.focusWindow ??
		(input.userMessage ? parseFocusWindow(input.userMessage, duration, scope) : null);

	return selectFramesWithCoverage({
		frames: input.frames,
		queryClass: input.queryClass,
		scope,
		maxFrames: budget.maxFrames,
		preferChangeBoundaries: budget.preferChangeBoundaries,
		preferLateWindow: budget.preferLateWindow,
		lateWindowStartFrac: budget.lateWindowStartFrac,
		memory: input.memory ?? null,
		priorityTimesSec: input.priorityTimesSec,
		focusWindow,
		durationSec: duration,
		changes: input.changes,
		primaryReason: primaryFrameReason,
	});
}

/** Rebuild multimodal content from a subset of frames (re-attach). */
export async function rebuildUserMessageWithSelectedFrames(input: {
	userMessageText: string;
	allPreparedFrames: VisualEvidenceFrame[];
	selected: VisualEvidenceFrame[];
	meta: AttachedFrameMeta[];
	buildContent: (
		userMessage: string,
		frames: VisualEvidenceFrame[],
	) => Promise<{ role: "user"; content: unknown }>;
}): Promise<{ role: "user"; content: unknown; frameMeta: AttachedFrameMeta[] }> {
	if (input.selected.length === 0) {
		return {
			role: "user",
			content: input.userMessageText,
			frameMeta: [],
		};
	}
	const msg = await input.buildContent(input.userMessageText, input.selected);
	const reasonLines = [
		"FRAME_ATTACH_REASONS (deterministic selection — not every frame of the video):",
		...input.meta.map(
			(m, i) => `  ${i + 1}. t=${m.sourceTimeSec.toFixed(2)}s reason=${m.reason} — ${m.note}`,
		),
		"",
	].join("\n");
	const content = msg.content;
	if (Array.isArray(content)) {
		return {
			role: "user",
			content: [{ type: "text", text: reasonLines }, ...content],
			frameMeta: input.meta,
		};
	}
	return { role: "user", content: `${reasonLines}${String(content)}`, frameMeta: input.meta };
}
