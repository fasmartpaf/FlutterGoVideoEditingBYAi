/**
 * Early-stop policy for Investigator V1.1 runner.
 */

import type { PlannedAction } from "../plan";
import type { InvestigationObservation, InvestigationStopReason } from "../types";
import { isSpeechPrimary } from "./intents";
import type { InvestigationIntent } from "./types";

export function shouldStopAfterAction(input: {
	intents: InvestigationIntent[];
	action: PlannedAction;
	observations: InvestigationObservation[];
	toolCalls: number;
	stopHint: "sufficient_after_plan" | "insufficient_after_plan" | "continue";
	userMessage?: string;
}): { stop: boolean; reason: InvestigationStopReason; detail: string } | null {
	const speechPrimary = isSpeechPrimary(input.intents, input.userMessage ?? "");

	if (speechPrimary && input.action.tool === "get_transcript_range") {
		const hasTranscript = input.observations.some((o) => o.kind === "transcript");
		if (hasTranscript) {
			return {
				stop: true,
				reason: "sufficient_evidence",
				detail: "SPEECH_INSPECTION complete — skip visual/OCR for transcript-only question",
			};
		}
	}

	if (
		input.intents.includes("action_verification") &&
		input.action.tool === "get_evidence_for_event" &&
		/passive/i.test(input.action.why) &&
		input.toolCalls >= 3 &&
		!input.intents.includes("temporary_ui")
	) {
		const hasCursorOrPassive = input.observations.some(
			(o) => o.kind === "cursor" || o.kind === "provenance",
		);
		if (hasCursorOrPassive && !input.intents.includes("text_ui_reading")) {
			return {
				stop: true,
				reason: "sufficient_evidence",
				detail: "Action verification has passive/cursor evidence — stop without full-video OCR",
			};
		}
	}

	return null;
}

export function finalizeStopReason(input: {
	plannedStopHint: "sufficient_after_plan" | "insufficient_after_plan" | "continue";
	current: InvestigationStopReason;
	observations: InvestigationObservation[];
	actionsPlanned: number;
	actionsRun: number;
}): InvestigationStopReason {
	if (
		input.current === "budget_exhausted" ||
		input.current === "deterministic_edit_skip" ||
		input.current === "media_not_required"
	) {
		return input.current;
	}
	if (input.plannedStopHint === "insufficient_after_plan" && input.observations.length <= 1) {
		return "insufficient_evidence";
	}
	if (input.actionsRun === 0 && input.actionsPlanned === 0) {
		return "no_uncertainty";
	}
	return input.current === "sufficient_evidence" ? "sufficient_evidence" : input.current;
}
