/**
 * UI Consent Surface V1
 * Identity: CURRENT_OPENSCREEN_UI_CONSENT_V1
 */

export { buildEditReviewAttachment, buildEditReviewCard } from "./buildReviewCard";
export { runUiConsentedApply } from "./runUiConsent";
export type {
	EditReviewAttachment,
	EditReviewCard,
	EditReviewPhase,
	EditReviewReadiness,
	HumanReadableRange,
	UiConsentApplyRequest,
	UiConsentApplyResult,
} from "./types";
export { UI_CONSENT_V1_PROVIDER_ID } from "./types";
