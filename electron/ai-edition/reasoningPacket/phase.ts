/**
 * Bounded Reasoning V1 — cognition phase (not five agents).
 * Identity: CURRENT_OPENSCREEN_BOUNDED_REASONING_V1
 */

import type { MediaContextNeeds } from "../mediaContextNeeds/types";
import type { VideoMemoryQueryClass } from "../videoMemory";
import { BOUNDED_REASONING_V1_ID } from "../videoMemory/productionPath";

export const COGNITION_PHASES = ["UNDERSTAND", "PLAN", "PROPOSE", "APPLY", "VERIFY"] as const;

export type CognitionPhase = (typeof COGNITION_PHASES)[number];

export function resolveCognitionPhase(input: {
	userMessage: string;
	contextNeeds: MediaContextNeeds;
	queryClass: VideoMemoryQueryClass;
}): { phase: CognitionPhase; reason: string } {
	const msg = input.userMessage.toLowerCase();

	if (
		/\b(verify|did (the )?apply|confirm (the )?edit)\b/i.test(msg) &&
		/\b(export|render|compositor)\b/i.test(msg)
	) {
		return { phase: "VERIFY", reason: "verify-oriented wording" };
	}

	if (
		/\b(apply (the |this |that )?(edit|change|proposal|trim|zoom)|go ahead and (apply|make)|approve (the )?edit)\b/i.test(
			msg,
		)
	) {
		return {
			phase: "APPLY",
			reason: "apply wording — consent/applyPreview remains authority; model should not mutate",
		};
	}

	if (input.contextNeeds.category === "deterministicEdit") {
		return {
			phase: "PROPOSE",
			reason: "deterministicEdit — may name tools; mutationAuthority still gates execution",
		};
	}

	if (input.queryClass === "editorial" || input.contextNeeds.category === "editingContext") {
		if (
			/\b(propose|suggest (a |the )?trim|add (a )?zoom|make (this |it )shorter|cut (the |this )?pause)\b/i.test(
				msg,
			)
		) {
			return { phase: "PROPOSE", reason: "editorial with concrete edit ask" };
		}
		return { phase: "PLAN", reason: "editorial / editingContext — plan safe strategies" };
	}

	return {
		phase: "UNDERSTAND",
		reason: `inspection queryClass=${input.queryClass}`,
	};
}

export function phaseAllowsMutationTools(phase: CognitionPhase): boolean {
	// Schemas for proposal language only on PROPOSE; UNDERSTAND/PLAN/APPLY/VERIFY never.
	return phase === "PROPOSE";
}

export function phaseIdentity(): typeof BOUNDED_REASONING_V1_ID {
	return BOUNDED_REASONING_V1_ID;
}
