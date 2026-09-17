/**
 * Decision requirements — Decision Requirements V4.
 * Separates REQUIRED DECISION from prepared modalities.
 * Deterministic; 0 model calls.
 */

import type { VideoMemoryQueryClass } from "../videoMemory";
import type { QueryScope } from "../videoMemory/queryScope";
import type { CognitionPhase } from "./phase";

export const REASONING_DECISION_KINDS = [
	"FACTUAL_SPEECH",
	"VISUAL_SUMMARY",
	"CROSS_MODAL_COMPARE",
	"ACTION_VERIFY",
	"EDITORIAL_DIAGNOSIS",
	"FOCAL_EDIT_JUDGMENT",
	"CORRECTION_UNDERSTANDING",
	"OTHER",
] as const;

export type ReasoningDecisionKind = (typeof REASONING_DECISION_KINDS)[number];

/** Structured packet sections used by self-containment. */
export type DecisionSection =
	| "selectedSpeech"
	| "selectedVisual"
	| "crossModalRelations"
	| "correctionScaffold"
	| "focalTargetCandidates"
	| "editorialFindings"
	| "preservationConstraints"
	| "visualCoverage"
	| "actionEvidence";

export type DecisionRequirementContract = {
	decisionKind: ReasoningDecisionKind;
	requiredSections: DecisionSection[];
	optionalSections: DecisionSection[];
	/** Evidence kinds required for this decision (independent of modality flags as relation gates). */
	requiredEvidenceKinds: Array<"speech" | "visual" | "action_or_unknown">;
	notes: string[];
};

const ZOOM_ASK = /\bzoom|crop|focus|highlight|annotation\s+emphasis\b/i;
const PROFESSIONAL_ASK =
	/\bprofessional|improv(?:e|ement)|polish|make\s+this\s+(?:recording|video)|genuinely\s+be\s+improved\b/i;
const CROSS_MODAL_ASK =
	/\bcompare\s+what\s+i|what\s+matches|what\s+differs|cannot\s+be\s+verified|speech\s+(?:vs|versus|and)\s+(?:what\s+)?(?:is\s+)?visib|listen\s+carefully.*(?:screen|visib)|watch\s+and\s+listen\b/i;
const CORRECTION_ASK =
	/\bcorrect(?:ed|ion|ing|s)?\s+myself|first\s+say|listen\s+carefully|how\s+did\s+i\s+correct\b/i;
const SPEECH_ASK = /\bwhat\s+did\s+i\s+say|near\s+the\s+end|transcript|spoken\b/i;
const VISUAL_ASK =
	/\bwhat\s+(?:do\s+)?(?:you\s+)?see|visually\s+happening|describe\s+(?:the\s+)?(?:screen|video|recording)\b/i;
const ACTION_ASK =
	/\bdid\s+i\s+(?:open|click|restart|navigate|go\s+to)|actually\s+open|open\s+(?:settings|upwork)\b/i;

/**
 * Resolve decision kind from local intent + queryClass + phase.
 * Not a model classifier.
 */
export function resolveReasoningDecisionKind(input: {
	userMessage: string;
	queryClass: VideoMemoryQueryClass;
	queryScope: QueryScope;
	phase: CognitionPhase;
}): ReasoningDecisionKind {
	const msg = input.userMessage;
	const qc = input.queryClass;

	// Focal before generic editorial — zoom asks are FOCAL_EDIT_JUDGMENT
	if (ZOOM_ASK.test(msg) && (input.phase === "PLAN" || qc === "editorial")) {
		return "FOCAL_EDIT_JUDGMENT";
	}

	if (CORRECTION_ASK.test(msg) || (qc === "cross_modal" && /correct|first\s+say/i.test(msg))) {
		return "CORRECTION_UNDERSTANDING";
	}

	if (qc === "cross_modal" || CROSS_MODAL_ASK.test(msg)) {
		return "CROSS_MODAL_COMPARE";
	}

	if (qc === "action_verify" || ACTION_ASK.test(msg)) {
		return "ACTION_VERIFY";
	}

	if (
		qc === "editorial" ||
		(input.phase === "PLAN" && PROFESSIONAL_ASK.test(msg)) ||
		PROFESSIONAL_ASK.test(msg)
	) {
		// Zoom already returned FOCAL above
		return "EDITORIAL_DIAGNOSIS";
	}

	if (qc === "speech" || (SPEECH_ASK.test(msg) && !VISUAL_ASK.test(msg))) {
		return "FACTUAL_SPEECH";
	}

	if (qc === "visual" || VISUAL_ASK.test(msg)) {
		return "VISUAL_SUMMARY";
	}

	return "OTHER";
}

/** Map decision → required/optional sections. Modalities do NOT imply crossModalRelations. */
export function decisionRequirementContract(
	kind: ReasoningDecisionKind,
	opts?: { queryScope?: QueryScope },
): DecisionRequirementContract {
	switch (kind) {
		case "FACTUAL_SPEECH":
			return {
				decisionKind: kind,
				requiredSections: ["selectedSpeech"],
				optionalSections: [],
				requiredEvidenceKinds: ["speech"],
				notes: ["Speech quote/factual ask — selectedSpeech only"],
			};
		case "VISUAL_SUMMARY":
			return {
				decisionKind: kind,
				requiredSections: ["selectedVisual"],
				optionalSections:
					opts?.queryScope === "whole_media" ? ["visualCoverage"] : ["visualCoverage"],
				requiredEvidenceKinds: ["visual"],
				notes: ["Visual summary — frames/visual refs; coverage optional soft"],
			};
		case "CROSS_MODAL_COMPARE":
			return {
				decisionKind: kind,
				requiredSections: ["selectedSpeech", "selectedVisual", "crossModalRelations"],
				optionalSections: [],
				requiredEvidenceKinds: ["speech", "visual"],
				notes: ["Only this decision requires crossModalRelations"],
			};
		case "ACTION_VERIFY":
			return {
				decisionKind: kind,
				requiredSections: ["selectedVisual", "actionEvidence"],
				optionalSections: ["selectedSpeech", "crossModalRelations"],
				requiredEvidenceKinds: ["action_or_unknown"],
				notes: [
					"Action verify — visual/action evidence or explicit UNKNOWN is sufficient",
					"crossModalRelations only optional when speech-vs-visual compare is material",
				],
			};
		case "EDITORIAL_DIAGNOSIS":
			return {
				decisionKind: kind,
				requiredSections: ["editorialFindings", "selectedVisual"],
				optionalSections: [
					"selectedSpeech",
					"preservationConstraints",
					"focalTargetCandidates",
					"crossModalRelations",
				],
				requiredEvidenceKinds: ["visual"],
				notes: [
					"Professional/editorial — editorialFindings required; crossModalRelations NOT automatic",
				],
			};
		case "FOCAL_EDIT_JUDGMENT":
			return {
				decisionKind: kind,
				requiredSections: ["focalTargetCandidates", "selectedVisual"],
				optionalSections: ["visualCoverage", "editorialFindings", "selectedSpeech"],
				requiredEvidenceKinds: ["visual"],
				notes: ["Zoom/focus — focal candidates + visual; not automatic editorialFindings"],
			};
		case "CORRECTION_UNDERSTANDING":
			return {
				decisionKind: kind,
				requiredSections: ["selectedSpeech", "correctionScaffold"],
				optionalSections: ["selectedVisual", "crossModalRelations"],
				requiredEvidenceKinds: ["speech"],
				notes: ["Correction scaffold + speech; visual optional when ask includes screen verify"],
			};
		default:
			return {
				decisionKind: "OTHER",
				requiredSections: [],
				optionalSections: [
					"selectedSpeech",
					"selectedVisual",
					"editorialFindings",
					"focalTargetCandidates",
				],
				requiredEvidenceKinds: [],
				notes: ["Fallback — rely on modality sufficiency only"],
			};
	}
}

export function resolveDecisionRequirements(input: {
	userMessage: string;
	queryClass: VideoMemoryQueryClass;
	queryScope: QueryScope;
	phase: CognitionPhase;
}): DecisionRequirementContract {
	const kind = resolveReasoningDecisionKind(input);
	return decisionRequirementContract(kind, { queryScope: input.queryScope });
}
