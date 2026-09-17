/**
 * Packet self-containment — Decision Requirements V4.
 * Derives from REQUIRED DECISION, not merely prepared modalities.
 */

import {
	type DecisionRequirementContract,
	type DecisionSection,
	type ReasoningDecisionKind,
	resolveDecisionRequirements,
} from "./decisionRequirements";
import type { ReasoningPacketV1 } from "./types";

export type SelfContainmentReport = {
	/** @deprecated use decisionKind — kept for V3 artifact compatibility */
	requiredDecision: string;
	decisionKind: ReasoningDecisionKind;
	requiredEvidenceKinds: string[];
	presentEvidenceKinds: string[];
	requiredStructuredSections: string[];
	presentStructuredSections: string[];
	requiredSections: DecisionSection[];
	optionalSections: DecisionSection[];
	presentSections: DecisionSection[];
	missingSections: DecisionSection[];
	selfContained: boolean;
	missing: string[];
	contractNotes: string[];
};

function listPresentSections(packet: ReasoningPacketV1): DecisionSection[] {
	const present: DecisionSection[] = [];
	if (packet.selectedSpeech.length > 0) present.push("selectedSpeech");
	if (packet.selectedVisualEvidence.length > 0 || packet.frameMeta.length > 0) {
		present.push("selectedVisual");
	}
	if (packet.crossModalRelations.length > 0) present.push("crossModalRelations");
	if (packet.correctionScaffold.present) present.push("correctionScaffold");
	if (packet.focalTargetCandidates.length > 0) present.push("focalTargetCandidates");
	if (packet.editorialFindings !== undefined) present.push("editorialFindings");
	if (packet.preservationConstraints.length > 0) present.push("preservationConstraints");
	if (packet.evidenceCoverage) present.push("visualCoverage");
	// Action evidence: visual frames, known/supported action-like claims, or explicit unknown
	const hasActionOrUnknown =
		packet.frameMeta.length > 0 ||
		packet.known.some((k) => /open|click|restart|settings|upwork|navigat/i.test(k.text)) ||
		packet.supported.some((k) => /open|click|restart|settings|upwork/i.test(k.text)) ||
		packet.unknown.some((k) => /open|click|restart|settings|upwork|cannot\s+verif/i.test(k.text)) ||
		packet.sufficiency.unresolvedCriticalClaims.length > 0;
	if (hasActionOrUnknown) present.push("actionEvidence");
	return present;
}

function sectionSatisfied(
	section: DecisionSection,
	packet: ReasoningPacketV1,
	present: Set<DecisionSection>,
	decisionKind: ReasoningDecisionKind,
): boolean {
	if (present.has(section)) {
		if (section === "editorialFindings") {
			// Empty findings array is valid when media evidence exists (honest "no change")
			return packet.editorialFindings !== undefined;
		}
		if (section === "focalTargetCandidates") {
			return packet.focalTargetCandidates.length > 0;
		}
		return true;
	}

	// Soft allowances
	if (section === "selectedSpeech") {
		const st = packet.sufficiency.speechMediaState;
		if (st === "no_audio" || st === "no_speech_detected") return true;
		return false;
	}
	if (section === "editorialFindings") {
		return packet.editorialFindings !== undefined;
	}
	if (section === "focalTargetCandidates") {
		// Explicit empty surface: FOCAL with no candidates represented as empty + note via capability
		// Prefer false when zoom ask and zero candidates — caller may mark no-candidate via empty with decisionKind
		if (decisionKind === "FOCAL_EDIT_JUDGMENT" && packet.frameMeta.length > 0) {
			// Coverage-only path should have produced weak candidates; if somehow empty, not satisfied
			return false;
		}
		return false;
	}
	if (section === "visualCoverage") {
		// Optional soft — never hard-fail when listed only optional; if required, need evidenceCoverage
		return Boolean(packet.evidenceCoverage);
	}
	if (section === "actionEvidence") {
		// UNKNOWN as a represented conclusion is sufficient for ACTION_VERIFY
		if (decisionKind === "ACTION_VERIFY") {
			return (
				packet.unknown.length > 0 ||
				packet.sufficiency.unresolvedCriticalClaims.length > 0 ||
				packet.frameMeta.length > 0 ||
				packet.known.length > 0
			);
		}
		return false;
	}
	if (section === "preservationConstraints") {
		return true; // soft when required rarely
	}
	return false;
}

export function evaluatePacketSelfContainment(packet: ReasoningPacketV1): SelfContainmentReport {
	const contract: DecisionRequirementContract =
		packet.decisionRequirements ??
		resolveDecisionRequirements({
			userMessage: packet.userIntent,
			queryClass: packet.queryClass,
			queryScope: packet.queryScope,
			phase: packet.phase,
		});

	const decisionKind = contract.decisionKind;
	const presentSections = listPresentSections(packet);
	const presentSet = new Set(presentSections);

	const presentEvidenceKinds: string[] = [];
	if (packet.selectedSpeech.length > 0 || packet.spoken.length > 0)
		presentEvidenceKinds.push("speech");
	if (packet.selectedVisualEvidence.length > 0 || packet.frameMeta.length > 0) {
		presentEvidenceKinds.push("visual");
	}
	if (packet.sufficiency.speechMediaState === "no_audio")
		presentEvidenceKinds.push("speech_no_audio");
	if (presentSet.has("actionEvidence")) presentEvidenceKinds.push("action_or_unknown");

	const missingSections: DecisionSection[] = [];
	for (const s of contract.requiredSections) {
		if (!sectionSatisfied(s, packet, presentSet, decisionKind)) {
			missingSections.push(s);
		}
	}

	const missing: string[] = [...missingSections];

	// Evidence kinds from decision contract (not "speech∧visual ⇒ relations")
	for (const k of contract.requiredEvidenceKinds) {
		if (k === "speech") {
			const ok =
				presentEvidenceKinds.includes("speech") ||
				presentEvidenceKinds.includes("speech_no_audio") ||
				packet.sufficiency.speechMediaState === "no_speech_detected" ||
				packet.sufficiency.speechMediaState === "no_audio";
			if (!ok) missing.push("speech");
		} else if (k === "visual") {
			if (!presentEvidenceKinds.includes("visual")) missing.push("visual");
		} else if (k === "action_or_unknown") {
			if (
				!presentEvidenceKinds.includes("action_or_unknown") &&
				!presentSet.has("actionEvidence")
			) {
				// ACTION_VERIFY with zero frames and zero epistemic items is insufficient
				if (
					packet.frameMeta.length === 0 &&
					packet.known.length === 0 &&
					packet.unknown.length === 0
				) {
					missing.push("action_or_unknown");
				}
			}
		}
	}

	// Editorial: findings empty + no usable media → not self-contained
	if (decisionKind === "EDITORIAL_DIAGNOSIS") {
		const findings = packet.editorialFindings ?? [];
		const editable = findings.filter((f) => f.preservationImpact !== "preserve");
		const hasMedia =
			presentEvidenceKinds.includes("visual") || presentEvidenceKinds.includes("speech");
		if (editable.length === 0 && !hasMedia) {
			if (!missing.includes("editorialFindings")) missing.push("editorialFindings");
			if (!missingSections.includes("editorialFindings")) missingSections.push("editorialFindings");
		}
	}

	// Modality sufficiency still gates provider when required modalities truly missing
	if (!packet.sufficiency.packetEvidenceSufficient) {
		for (const m of packet.sufficiency.missingEvidenceKinds) {
			missing.push(`sufficiency:${m}`);
		}
	}

	const uniqueMissing = [...new Set(missing)];
	const selfContained = uniqueMissing.length === 0 && packet.sufficiency.packetEvidenceSufficient;

	return {
		requiredDecision: `${decisionKind}: ${packet.requestedDecision}`,
		decisionKind,
		requiredEvidenceKinds: [...contract.requiredEvidenceKinds],
		presentEvidenceKinds,
		requiredStructuredSections: [...contract.requiredSections],
		presentStructuredSections: presentSections,
		requiredSections: [...contract.requiredSections],
		optionalSections: [...contract.optionalSections],
		presentSections,
		missingSections,
		selfContained,
		missing: uniqueMissing,
		contractNotes: contract.notes,
	};
}
