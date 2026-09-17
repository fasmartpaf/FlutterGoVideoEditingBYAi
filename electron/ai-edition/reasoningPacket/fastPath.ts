/**
 * Deterministic fast-path contract for Bounded Reasoning V1.
 * Only ship paths that are already safe without semantic interpretation.
 */

import type { MediaContextNeeds } from "../mediaContextNeeds/types";
import type { CognitionPhase } from "./phase";

export type FastPathDecision =
	| { kind: "skip_provider"; reason: string; userText: string }
	| { kind: "use_provider"; reason: string }
	| { kind: "candidate_unshipped"; reason: string };

/**
 * Safe subset:
 * - APPLY / VERIFY phases: do not run general reasoner for mutation/verify authority.
 * Everything else that needs NLU stays on the provider.
 */
export function resolveDeterministicFastPath(input: {
	phase: CognitionPhase;
	contextNeeds: MediaContextNeeds;
	userMessage: string;
}): FastPathDecision {
	if (input.phase === "APPLY") {
		return {
			kind: "skip_provider",
			reason: "APPLY phase — consent/applyPreview is authority",
			userText:
				"To apply an edit, use the Edit Review card and approve Apply Preview. I won't change the timeline from this chat turn alone.",
		};
	}
	if (input.phase === "VERIFY") {
		return {
			kind: "skip_provider",
			reason: "VERIFY phase — compositor/audio verify is local authority",
			userText:
				"Verification is handled by OpenScreen's local compositor/audio checks after apply — not by inventing pixel proof in chat.",
		};
	}

	// Candidates — design only
	if (
		input.contextNeeds.category === "deterministicEdit" &&
		/\b(aspect|9:16|1:1|wallpaper|background)\b/i.test(input.userMessage)
	) {
		return {
			kind: "candidate_unshipped",
			reason:
				"exact aspect/background could be T0 — keep existing deterministicEdit tool path for now",
		};
	}

	return { kind: "use_provider", reason: "semantic interpretation required" };
}
