/**
 * Modality-aware packet sufficiency — Reliability V2.
 * not_requested ≠ no_audio ≠ unavailable.
 */

import type { RequiredModalities } from "./requiredModalities";

export type ModalitySufficiencyState =
	| "AVAILABLE_AND_SUFFICIENT"
	| "AVAILABLE_BUT_INSUFFICIENT"
	| "UNAVAILABLE"
	| "NOT_APPLICABLE"
	| "NOT_REQUESTED_BUG";

export type SpeechMediaState =
	| "available"
	| "no_audio"
	| "no_speech_detected"
	| "unavailable"
	| "failed"
	| "not_requested"
	| "unknown";

export type ModalitySufficiencyReport = {
	speech: ModalitySufficiencyState;
	visual: ModalitySufficiencyState;
	cursor: ModalitySufficiencyState;
	ocr: ModalitySufficiencyState;
	packetEvidenceSufficient: boolean;
	missingEvidenceKinds: string[];
	speechMediaState: SpeechMediaState;
	notes: string[];
};

export function evaluatePacketSufficiency(input: {
	required: RequiredModalities;
	speechMediaState: SpeechMediaState;
	speechWindowCount: number;
	spokenClaimCount: number;
	frameCount: number;
	imagesAttached: number;
	visualCoverageSufficient: boolean | null;
	cursorEvidencePresent: boolean;
	ocrEvidencePresent: boolean;
	crossModalRequired: boolean;
	crossModalRelationCount: number;
}): ModalitySufficiencyReport {
	const missing: string[] = [];
	const notes: string[] = [];

	let speech: ModalitySufficiencyState = "NOT_APPLICABLE";
	if (input.required.speech) {
		if (input.speechMediaState === "not_requested") {
			speech = "NOT_REQUESTED_BUG";
			missing.push("speech_not_requested");
			notes.push("speech required but prepare was skipped (not_requested) — never claim no_audio");
		} else if (input.speechMediaState === "no_audio") {
			speech = "AVAILABLE_AND_SUFFICIENT";
			notes.push(
				"no_audio proven — speech cannot exist; represent honestly, do not invent transcript",
			);
		} else if (input.speechMediaState === "unavailable" || input.speechMediaState === "failed") {
			speech = "UNAVAILABLE";
			missing.push(`speech_${input.speechMediaState}`);
		} else if (input.speechMediaState === "no_speech_detected") {
			speech = "AVAILABLE_AND_SUFFICIENT";
			notes.push("no_speech_detected after STT — empty spoken is honest");
		} else if (input.speechWindowCount > 0 || input.spokenClaimCount > 0) {
			speech = "AVAILABLE_AND_SUFFICIENT";
		} else {
			speech = "AVAILABLE_BUT_INSUFFICIENT";
			missing.push("speech_windows");
		}
	}

	let visual: ModalitySufficiencyState = "NOT_APPLICABLE";
	if (input.required.visual) {
		const hasFrames = input.frameCount > 0 || input.imagesAttached > 0;
		if (!hasFrames) {
			visual = "AVAILABLE_BUT_INSUFFICIENT";
			missing.push("visual_frames");
		} else if (input.visualCoverageSufficient === false) {
			visual = "AVAILABLE_BUT_INSUFFICIENT";
			missing.push("visual_coverage");
		} else {
			visual = "AVAILABLE_AND_SUFFICIENT";
		}
	}

	let cursor: ModalitySufficiencyState = "NOT_APPLICABLE";
	if (input.required.cursor) {
		cursor = input.cursorEvidencePresent
			? "AVAILABLE_AND_SUFFICIENT"
			: "AVAILABLE_BUT_INSUFFICIENT";
		if (!input.cursorEvidencePresent) {
			// Cursor often optional — note but do not always fail packet for missing sidecar.
			notes.push("cursor required/soft — sidecar may be absent");
			cursor = "NOT_APPLICABLE";
		}
	}

	let ocr: ModalitySufficiencyState = "NOT_APPLICABLE";
	if (input.required.ocr) {
		ocr = input.ocrEvidencePresent ? "AVAILABLE_AND_SUFFICIENT" : "NOT_APPLICABLE";
		if (!input.ocrEvidencePresent) {
			notes.push("ocr not proven — do not invent UI labels");
		}
	}

	if (
		input.crossModalRequired &&
		speech === "AVAILABLE_AND_SUFFICIENT" &&
		visual === "AVAILABLE_AND_SUFFICIENT" &&
		input.crossModalRelationCount === 0 &&
		input.spokenClaimCount > 0
	) {
		missing.push("cross_modal_relations");
		notes.push("cross-modal ask needs typed spoken↔visual relations");
	}

	const blocking = missing.filter((m) => m !== "cross_modal_relations");
	const packetEvidenceSufficient =
		blocking.length === 0 &&
		speech !== "NOT_REQUESTED_BUG" &&
		speech !== "UNAVAILABLE" &&
		speech !== "AVAILABLE_BUT_INSUFFICIENT" &&
		visual !== "AVAILABLE_BUT_INSUFFICIENT" &&
		visual !== "UNAVAILABLE";

	// Cross-modal relations missing → insufficient for cross-modal decisions
	const sufficient =
		packetEvidenceSufficient &&
		!(input.crossModalRequired && missing.includes("cross_modal_relations"));

	return {
		speech,
		visual,
		cursor,
		ocr,
		packetEvidenceSufficient: sufficient,
		missingEvidenceKinds: missing,
		speechMediaState: input.speechMediaState,
		notes,
	};
}
