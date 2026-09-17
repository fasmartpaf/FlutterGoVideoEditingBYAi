/**
 * Deterministic promotion / demotion rules.
 * 0 LLM calls. Visible text ≠ action; speech ≠ visual fact.
 */

import type { ClaimKind, ClaimPromotionStatus, ClaimVerificationLevel } from "./types";

export interface PromotionDecision {
	status: ClaimPromotionStatus;
	verificationLevel: ClaimVerificationLevel;
	ruleId: string;
	reason: string;
	promoted: boolean;
	demoted: boolean;
}

/** Action-like wording that must never auto-verify from OCR alone. */
const ACTION_VERB_RE =
	/\b(opened?|open|navigat(?:e|ed|ion)|worked|clicked?|restart(?:ed)?|launched?|selected?)\b/i;

export function looksLikeActionHypothesis(text: string): boolean {
	return ACTION_VERB_RE.test(text);
}

/**
 * Passive app / tab visibility — OBSERVED or SUPPORTED visibility only.
 * Never VERIFIED open/navigate/work.
 */
export function decidePassiveVisibility(input: {
	subject: string;
	hasOcrOrVision: boolean;
	hasActionEvidence: boolean;
}): PromotionDecision {
	if (input.hasActionEvidence) {
		return {
			status: "verified",
			verificationLevel: "cross_modal",
			ruleId: "passive_with_action_evidence",
			reason: `Action evidence present for "${input.subject}" — verified only with interaction/state proof.`,
			promoted: true,
			demoted: false,
		};
	}
	if (input.hasOcrOrVision) {
		return {
			status: "supported",
			verificationLevel: "single_source",
			ruleId: "passive_visibility_supported",
			reason: `Passive visibility of "${input.subject}" supported by OCR/vision. Visibility ≠ open/navigate/work.`,
			promoted: true,
			demoted: false,
		};
	}
	return {
		status: "unknown",
		verificationLevel: "unsupported",
		ruleId: "passive_no_evidence",
		reason: `No evidence for "${input.subject}".`,
		promoted: false,
		demoted: false,
	};
}

/**
 * OCR visible text → OBSERVED; with before/after temporary UI → SUPPORTED visibility.
 * Never VERIFIED user performed the labeled action.
 */
export function decideVisibleText(input: {
	text: string;
	temporaryUiConfirmed: boolean;
	actionEvidence: boolean;
}): PromotionDecision {
	if (input.actionEvidence) {
		return {
			status: "verified",
			verificationLevel: "cross_modal",
			ruleId: "visible_text_with_action",
			reason: "Visible text plus independent action/interaction evidence.",
			promoted: true,
			demoted: false,
		};
	}
	if (input.temporaryUiConfirmed) {
		return {
			status: "supported",
			verificationLevel: "multi_evidence",
			ruleId: "temporary_ui_visibility_supported",
			reason: `Temporary UI text "${input.text}" visibility supported by before/after or OCR+change context. Not a verified user action.`,
			promoted: true,
			demoted: false,
		};
	}
	return {
		status: "observed",
		verificationLevel: "single_source",
		ruleId: "visible_text_observed",
		reason: `Observed visible text "${input.text}". Observed text ≠ action.`,
		promoted: false,
		demoted: false,
	};
}

/** Speech alone → SPOKEN; never SUPPORTED visual action. */
export function decideSpeechAssertion(input: {
	hasSupportingVisualState: boolean;
	hasContradictingVisual: boolean;
}): PromotionDecision {
	if (input.hasContradictingVisual) {
		return {
			status: "contradicted",
			verificationLevel: "contradicted",
			ruleId: "speech_visual_contradiction",
			reason: "Speech asserts UI action but visual neighborhood does not support it.",
			promoted: false,
			demoted: true,
		};
	}
	if (input.hasSupportingVisualState) {
		return {
			status: "supported",
			verificationLevel: "cross_modal",
			ruleId: "speech_plus_visual_state",
			reason: "Speech assertion supported by clear visual state change/presence.",
			promoted: true,
			demoted: false,
		};
	}
	return {
		status: "spoken",
		verificationLevel: "single_source",
		ruleId: "speech_only",
		reason: "Speech assertion retained as spoken. Speech ≠ visual fact.",
		promoted: false,
		demoted: false,
	};
}

/**
 * Keyword coincidence (OCR "Settings" + speech "opening Settings") without
 * verified Settings *state* → action remains unresolved / contradicted.
 */
export function decideKeywordCoincidenceAction(input: {
	keywordVisible: boolean;
	speechMentions: boolean;
	verifiedTargetState: boolean;
}): PromotionDecision {
	if (input.verifiedTargetState) {
		return {
			status: "verified",
			verificationLevel: "cross_modal",
			ruleId: "keyword_with_verified_state",
			reason: "Keyword + verified target UI state.",
			promoted: true,
			demoted: false,
		};
	}
	if (input.keywordVisible && input.speechMentions) {
		return {
			status: "contradicted",
			verificationLevel: "contradicted",
			ruleId: "keyword_coincidence_no_state",
			reason:
				"Speech and visible keyword coincide, but no verified target UI state. Keyword coincidence ≠ navigation/action.",
			promoted: false,
			demoted: true,
		};
	}
	if (input.speechMentions) {
		return {
			status: "spoken",
			verificationLevel: "single_source",
			ruleId: "speech_action_unresolved",
			reason: "Spoken action claim without verified visual state — not verified.",
			promoted: false,
			demoted: false,
		};
	}
	return {
		status: "unknown",
		verificationLevel: "unsupported",
		ruleId: "action_unsupported",
		reason: "No supporting evidence for action claim.",
		promoted: false,
		demoted: false,
	};
}

export function initialStatusForKind(kind: ClaimKind): ClaimPromotionStatus {
	switch (kind) {
		case "speech_assertion":
		case "spoken_correction":
			return "spoken";
		case "user_action":
		case "navigation_action":
			return "inferred";
		case "visible_text":
		case "temporary_ui_visibility":
		case "passive_app_visibility":
		case "ui_state_visibility":
		case "visual_change":
			return "observed";
		default:
			return "unknown";
	}
}
