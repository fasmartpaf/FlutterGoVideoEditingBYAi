/**
 * Single Mutation Authority V1 — request-class → mutation mode.
 *
 * Semantic/editorial AI turns must not mutate AxcutDocument via agent tools.
 * Only Constrained Edit Proposal → UI Consent → Apply Preview may commit.
 *
 * Identity: CURRENT_OPENSCREEN_SINGLE_MUTATION_AUTHORITY_V1
 */

import type { MediaContextNeeds, MediaRequestCategory } from "../mediaContextNeeds/types";

export const MUTATION_AUTHORITY_V1_PROVIDER_ID =
	"CURRENT_OPENSCREEN_SINGLE_MUTATION_AUTHORITY_V1" as const;

export type MutationMode =
	/** Inspect / answer only — no timeline mutations. */
	| "read_only"
	/** Explicit deterministic timeline math — existing direct-tool contract preserved. */
	| "deterministic_edit"
	/** Editorial cognition may propose; agent tools must not mutate. */
	| "proposal_only"
	/** Consented Apply Preview path — single authorized tool execution. */
	| "consented_apply";

export type MutationAuthorityDecision = {
	mode: MutationMode;
	category: MediaRequestCategory;
	/** Effective editsAllowed for the main agent tool loop. */
	agentEditsAllowed: boolean;
	reason: string;
};

export function resolveMutationAuthority(input: {
	contextNeeds: MediaContextNeeds;
	/** Settings allowAgentEdits for this project. */
	editsAllowed: boolean;
	/** When true, this call is the Apply Preview consent path. */
	consentedApply?: boolean;
}): MutationAuthorityDecision {
	if (input.consentedApply) {
		return {
			mode: "consented_apply",
			category: input.contextNeeds.category,
			agentEditsAllowed: input.editsAllowed !== false,
			reason: "Verified Apply Preview / UI Consent path",
		};
	}

	const category = input.contextNeeds.category;

	if (category === "deterministicEdit") {
		return {
			mode: "deterministic_edit",
			category,
			agentEditsAllowed: input.editsAllowed !== false,
			reason: "Deterministic edit request — direct tools remain allowed when Project edits are on",
		};
	}

	if (category === "editingContext") {
		return {
			mode: "proposal_only",
			category,
			agentEditsAllowed: false,
			reason:
				"Semantic/editorial request — mutations only via Constrained Edit Proposal + consent + Apply Preview",
		};
	}

	return {
		mode: "read_only",
		category,
		agentEditsAllowed: false,
		reason: "Non-edit / inspection request — mutating tools refused",
	};
}

export function mutationAuthorityRefusal(
	toolName: string,
	args: unknown,
	mode: MutationMode,
): {
	error: string;
	code: string;
	tool: string;
	requestedArgs: unknown;
	howToProceed: string;
	mutationMode: MutationMode;
} {
	if (mode === "proposal_only") {
		return {
			error:
				"Semantic editorial turns cannot change the timeline directly. " +
				"OpenScreen must propose a reviewable edit and wait for your approval. Nothing was modified.",
			code: "mutation_authority_proposal_only",
			tool: toolName,
			requestedArgs: args,
			howToProceed:
				"Do NOT retry write tools. Explain the diagnosis and point the user to any Edit Review card. " +
				"Never say an edit was applied. Only an approved proposal through Apply Preview may mutate the project.",
			mutationMode: mode,
		};
	}
	return {
		error:
			"This turn is read-only analysis. Timeline editing tools are not available for this request. Nothing was modified.",
		code: "mutation_authority_read_only",
		tool: toolName,
		requestedArgs: args,
		howToProceed:
			"Answer from evidence only. Do not claim any edit was applied. If the user wants an edit, they must ask an editorial or exact-trim request.",
		mutationMode: mode,
	};
}

/** Strip / rewrite user-facing claims that edits were applied without a verified commit. */
export function bindFinalResponseToTransactionTruth(input: {
	userFacingText: string;
	mode: MutationMode;
	mutatingToolsExecuted: number;
	hasConsentableProposal: boolean;
	hasBlockedOnlyProposal: boolean;
	verifiedCommit?: boolean;
	/** When true, prefer proposal-awaiting copy even if verifiedCommit is set. */
	forceProposalAwaitingConsent?: boolean;
}): {
	text: string;
	claim: "nothing_applied" | "proposal_awaiting_consent" | "verified_applied" | "rewritten";
} {
	const text = input.userFacingText.trim();
	if (input.forceProposalAwaitingConsent && input.hasConsentableProposal) {
		const honest = "I found a safe change you can review below. Nothing has been changed yet.";
		const claimsImproved =
			/\b(?:I\s+)?(?:improved|enabled|balancing|enabling)\b/i.test(text) ||
			/\b(?:I\s+)?(?:have\s+)?(?:applied|added|shortened|trimmed|cut|zoomed)\b/i.test(text);
		if (claimsImproved) {
			return {
				text: honest,
				claim: "proposal_awaiting_consent",
			};
		}
		if (!/nothing has been changed yet|review below/i.test(text)) {
			return {
				text: text ? `${text}\n\n${honest}` : honest,
				claim: "proposal_awaiting_consent",
			};
		}
		return { text, claim: "proposal_awaiting_consent" };
	}
	if (input.verifiedCommit) {
		return { text, claim: "verified_applied" };
	}

	const claimsApplied =
		/\b(?:I\s+)?(?:have\s+)?(?:applied|added|shortened|trimmed|cut|zoomed|updated the timeline|made the (?:video|recording) shorter)\b/i.test(
			text,
		) || /\b(?:added|applied)\s+\d+\s+trims?\b/i.test(text);

	if (input.mode === "proposal_only" || input.mode === "read_only") {
		if (input.hasConsentableProposal) {
			const honest = "I found a safe change you can review below. Nothing has been changed yet.";
			if (claimsApplied || input.mutatingToolsExecuted > 0) {
				return {
					text: appendOrReplaceAppliedClaim(text, honest),
					claim: "proposal_awaiting_consent",
				};
			}
			if (!/nothing has been changed yet|review below/i.test(text)) {
				return {
					text: text ? `${text}\n\n${honest}` : honest,
					claim: "proposal_awaiting_consent",
				};
			}
			return { text, claim: "proposal_awaiting_consent" };
		}

		const honest = input.hasBlockedOnlyProposal
			? "I reviewed the recording, but I haven't applied a change because I couldn't find a safe edit that preserves the important explanation. Your project was not changed."
			: "I reviewed the recording. No timeline edit was applied. Your project was not changed.";

		if (claimsApplied || input.mutatingToolsExecuted > 0) {
			return {
				text: appendOrReplaceAppliedClaim(text, honest),
				claim: "rewritten",
			};
		}
		return { text, claim: "nothing_applied" };
	}

	return { text, claim: "nothing_applied" };
}

function appendOrReplaceAppliedClaim(original: string, honest: string): string {
	// Drop paragraphs that assert applied mutations; keep diagnostic prose when possible.
	const kept = original
		.split(/\n{2,}/)
		.filter(
			(para) =>
				!/\b(?:applied|added \d+ trims?|shortened the video|trimmed|I have (?:applied|added))\b/i.test(
					para,
				),
		)
		.join("\n\n")
		.trim();
	return kept ? `${kept}\n\n${honest}` : honest;
}

export type MutationTelemetry = {
	requestClass: MediaRequestCategory;
	mutationMode: MutationMode;
	mutatingToolsExposed: boolean;
	mutatingToolsAttempted: string[];
	mutatingToolsExecuted: string[];
	mutatingToolsRejected: Array<{ name: string; code: string }>;
	proposalId?: string | null;
	proposalReadiness?: string | null;
	consentPresent: boolean;
	documentFingerprintBefore: string | null;
	documentFingerprintAfterReasoning: string | null;
	documentFingerprintAfterProposal: string | null;
	persistedMutationCount: number;
	finalResponseClaim?: string | null;
	providerUsage: {
		textInputTokens: number | "not_available";
		imageInputTokens: number | "not_available";
		outputTokens: number | "not_available";
		modelCalls: number | "not_available";
		framesAttached: number | "not_available";
		totalImageBytes: number | "not_available";
		estimatedCostUsd: number | "not_available";
	};
};

export function emptyMutationTelemetry(
	partial: Partial<MutationTelemetry> & Pick<MutationTelemetry, "requestClass" | "mutationMode">,
): MutationTelemetry {
	return {
		mutatingToolsExposed: false,
		mutatingToolsAttempted: [],
		mutatingToolsExecuted: [],
		mutatingToolsRejected: [],
		consentPresent: false,
		documentFingerprintBefore: null,
		documentFingerprintAfterReasoning: null,
		documentFingerprintAfterProposal: null,
		persistedMutationCount: 0,
		providerUsage: {
			textInputTokens: "not_available",
			imageInputTokens: "not_available",
			outputTokens: "not_available",
			modelCalls: "not_available",
			framesAttached: "not_available",
			totalImageBytes: "not_available",
			estimatedCostUsd: "not_available",
		},
		...partial,
	};
}
