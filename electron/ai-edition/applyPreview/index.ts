/**
 * Consent + Apply Preview V1
 * One consented proposal → transactional apply → verify → accept or rollback.
 * NOT autonomous. NOT multi-edit. 0 orchestration LLM calls.
 */

export { applyApprovedProposal, capturePreApplySnapshot, restoreFromSnapshot } from "./apply";
export { createApplyConsent, mintTestConsent, validateConsent } from "./consent";
export { fingerprintDocument, fingerprintsEqual } from "./fingerprint";
export {
	buildApplyPreflight,
	resetApplyPreviewSeqForTests,
	SUPPORTED_APPLY_TOOLS,
	selectProposalForPreview,
} from "./preflight";
export { prepareApplyPreviewDiagnostics, runConsentedApplyPreview } from "./run";
export type {
	ApplyConsent,
	ApplyLifecycleState,
	ApplyPreflight,
	ApplyPreviewInput,
	ApplyPreviewResult,
	ApplyTerminalStatus,
	DocumentFingerprint,
	EditApplicationReceipt,
	EligibilityBlockReason,
	PreApplySnapshot,
} from "./types";
export {
	APPLY_PREVIEW_V1_PROVIDER_ID,
	isProposalEligibleShape,
	MAX_MUTATIONS_PER_PREVIEW,
} from "./types";
export { verifyAfterApply } from "./verify";
