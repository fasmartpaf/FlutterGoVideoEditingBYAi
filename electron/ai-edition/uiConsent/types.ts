/**
 * UI Consent Surface V1 — presentation types for one human-reviewed edit.
 * Identity: CURRENT_OPENSCREEN_UI_CONSENT_V1
 *
 * Wire-safe DTO only. No internal cognition names in user-facing fields.
 */

export const UI_CONSENT_V1_PROVIDER_ID = "CURRENT_OPENSCREEN_UI_CONSENT_V1";

export type EditReviewReadiness = "ready" | "blocked" | "stale";

export type EditReviewPhase =
	| "idle"
	| "applying"
	| "checking_timeline"
	| "checking_video"
	| "checking_audio"
	| "verified"
	| "verified_with_warning"
	| "rolled_back"
	| "apply_failed"
	| "rejected"
	| "stale_blocked";

export interface HumanReadableRange {
	label: string;
	startSourceSec: number;
	endSourceSec: number;
	durationSec: number;
}

export interface EditReviewCard {
	proposalId: string;
	title: string;
	explanation: string;
	changeSummary: string;
	reasonSummary: string;
	affectedRange?: HumanReadableRange;
	preserves: string[];
	risks: string[];
	readiness: EditReviewReadiness;
	blockedReason?: string;
	capabilityLabel: string;
	canApply: boolean;
	consentScope: "single_proposal_preview";
	/** Opaque: for apply IPC only — not shown in UI. */
	documentFingerprint: string;
}

/** Attached to chat result when proposals exist. */
export interface EditReviewAttachment {
	providerId: typeof UI_CONSENT_V1_PROVIDER_ID;
	cards: EditReviewCard[];
	/** Full proposal bundle for consented apply (main process rebuilds preflight). */
	editProposalV1: unknown;
	selectedProposalId: string | null;
	additionalModelCalls: 0;
}

export interface UiConsentApplyRequest {
	document: unknown;
	editProposalV1: unknown;
	selectedProposalId: string;
	/** Fingerprint the card was built against — stale if document moved. */
	proposalDocumentFingerprint: string;
}

export interface UiConsentApplyResult {
	success: boolean;
	phase: EditReviewPhase;
	terminalStatus?: string;
	verificationStatus?: string;
	mutationsApplied: 0 | 1;
	document?: unknown;
	userMessage: string;
	detailMessage?: string;
	warnings: string[];
	rollbackSucceeded?: boolean;
	stale?: boolean;
	additionalModelCalls: 0;
	latencyMs: {
		preflightMs: number;
		consentMintMs: number;
		applyVerifyMs: number;
		totalMs: number;
	};
}
