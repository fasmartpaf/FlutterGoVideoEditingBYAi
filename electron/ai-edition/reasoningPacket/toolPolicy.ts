/**
 * Bounded tool-need policy — Reliability V2.
 * Sufficient packet → expose 0 tools (experimental Bounded path only).
 */

import type { ToolGateDecision } from "../videoMemory/toolGate";
import type { CognitionPhase } from "./phase";
import { toolGateForPhase } from "./toolFamilies";

export type ToolNeedPolicy = {
	packetCanAnswerWithoutTools: boolean;
	exposeTools: boolean;
	toolCount: number;
	allowedNames: Set<string>;
	reason: string;
	expectedModelCallBudget: 1;
};

export function resolveToolNeedPolicy(input: {
	phase: CognitionPhase;
	packetEvidenceSufficient: boolean;
	missingEvidenceKinds: string[];
	speechWindows: number;
	frameCount: number;
	queryClass: string;
}): ToolNeedPolicy {
	const base = toolGateForPhase(input.phase);

	if (input.phase === "APPLY" || input.phase === "VERIFY") {
		return {
			packetCanAnswerWithoutTools: true,
			exposeTools: false,
			toolCount: 0,
			allowedNames: new Set(),
			reason: `${input.phase}_no_provider_tools`,
			expectedModelCallBudget: 1,
		};
	}

	const packetCanAnswerWithoutTools =
		input.packetEvidenceSufficient &&
		(input.speechWindows > 0 ||
			input.frameCount > 0 ||
			input.queryClass === "speech" ||
			input.missingEvidenceKinds.includes("speech_not_requested") === false);

	// Sufficient UNDERSTAND/PLAN/PROPOSE → zero tools
	if (
		packetCanAnswerWithoutTools &&
		(input.phase === "UNDERSTAND" || input.phase === "PLAN" || input.phase === "PROPOSE")
	) {
		return {
			packetCanAnswerWithoutTools: true,
			exposeTools: false,
			toolCount: 0,
			allowedNames: new Set(),
			reason: "sufficient_packet_self_contained",
			expectedModelCallBudget: 1,
		};
	}

	// Insufficient → still prefer empty tools; local deepening should run before provider.
	// Expose minimal read tools only when speech/visual completely missing from packet
	// and phase is UNDERSTAND (last-resort). Prefer 0 for Reliability V2 smoke.
	if (input.missingEvidenceKinds.includes("speech_not_requested")) {
		return {
			packetCanAnswerWithoutTools: false,
			exposeTools: false,
			toolCount: 0,
			allowedNames: new Set(),
			reason: "insufficient_speech_not_requested_local_fix_required",
			expectedModelCallBudget: 1,
		};
	}

	return {
		packetCanAnswerWithoutTools: false,
		exposeTools: base.allowedNames.size > 0,
		toolCount: base.allowedNames.size,
		allowedNames: base.allowedNames,
		reason: base.notes,
		expectedModelCallBudget: 1,
	};
}

export function toolGateFromPolicy(
	policy: ToolNeedPolicy,
	phase: CognitionPhase,
): ToolGateDecision {
	if (!policy.exposeTools) {
		return {
			allowedNames: new Set(),
			required: [],
			optional: [],
			irrelevant: [...toolGateForPhase(phase).irrelevant, ...toolGateForPhase(phase).allowedNames],
			notes: policy.reason,
		};
	}
	return toolGateForPhase(phase);
}
