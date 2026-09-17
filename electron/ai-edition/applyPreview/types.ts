/**
 * Consent + Apply Preview V1
 * First mutation boundary: one consented proposal → transactional apply → verify → accept/rollback.
 * NOT autonomous. NOT multi-edit.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type {
	AudioContinuityEvidence,
	AudioContinuityStatus,
	AudioPcmProvider,
} from "../audioVerify";
import type {
	CompositedFrameSampler,
	CompositorTrimVerifyEvidence,
	CompositorVerifyQualityState,
} from "../compositorVerify";
import type { EditProposalItem, EditProposalV1 } from "../editProposal/types";
import type {
	RenderFrameSampler,
	RenderVerificationEvidence,
	RenderVerifyQualityState,
} from "../renderVerify/types";

export const APPLY_PREVIEW_V1_PROVIDER_ID = "CURRENT_OPENSCREEN_APPLY_PREVIEW_V1";

export const MAX_MUTATIONS_PER_PREVIEW = 1 as const;

export type ApplyLifecycleState =
	| "proposal_received"
	| "preflight_blocked"
	| "preflight_passed"
	| "awaiting_consent"
	| "consented"
	| "applying"
	| "applied"
	| "verifying"
	| "render_verifying"
	| "verified"
	| "verification_failed"
	| "rolling_back"
	| "rolled_back"
	| "rollback_failed"
	| "apply_failed";

export type ApplyTerminalStatus =
	| "verified"
	| "rolled_back"
	| "rollback_failed"
	| "apply_failed"
	| "blocked_preflight"
	| "blocked_no_consent"
	| "blocked_not_eligible";

export type EligibilityBlockReason =
	| "proposal_not_ready"
	| "provisional"
	| "no_safe_proposal"
	| "needs_more_evidence"
	| "unsupported"
	| "missing_landing"
	| "missing_proposed_call"
	| "missing_tool_name"
	| "capability_unsupported"
	| "missing_asset"
	| "missing_clip"
	| "stale_proposal"
	| "blocking_damage_risk"
	| "blocking_preservation_risk"
	| "invalid_landing"
	| "not_executed_flag_missing"
	| "max_mutations_exceeded"
	| "invalid_operation_args";

export interface DocumentFingerprint {
	algorithm: "json_sha256_relevant";
	value: string;
	/** Human-readable summary of what was hashed. */
	scope: string;
}

export interface ApplyPreflight {
	id: string;
	proposalId: string;
	eligible: boolean;
	blockingReasons: EligibilityBlockReason[];
	documentFingerprint: DocumentFingerprint;
	assetId?: string;
	clipId?: string;
	capability?: string;
	toolName?: string;
	landing?: {
		timebase: "SOURCE_MEDIA_TIME";
		startSourceTimeSec: number;
		endSourceTimeSec: number;
	};
	mustSurviveIds: string[];
	damageRiskLevels: string[];
	stale: boolean;
	preflightMs: number;
	/** Fingerprint of tool + provisional args + landing (consent binding). */
	operationArgsFingerprint?: string;
}

export interface ApplyConsent {
	id: string;
	proposalId: string;
	preflightId: string;
	documentFingerprint: string;
	authorizedMutation: true;
	scope: "single_proposal_preview";
	consentedAtIso: string;
	/** Bound tool — a trim consent cannot authorize zoom. */
	toolName?: string;
	/** Bound operation args fingerprint. */
	operationArgsFingerprint?: string;
}

export interface PreApplySnapshot {
	id: string;
	document: AxcutDocument;
	fingerprint: DocumentFingerprint;
	capturedAtIso: string;
}

export interface EditApplicationReceipt {
	id: string;
	proposalId: string;
	preflightId: string;
	consentId: string | null;
	providerId: typeof APPLY_PREVIEW_V1_PROVIDER_ID;
	lifecycle: ApplyLifecycleState[];
	terminalStatus: ApplyTerminalStatus;

	toolFamily: string | null;
	toolName: string | null;
	sanitizedArgs: Record<string, unknown> | null;

	beforeDocumentFingerprint: string;
	afterDocumentFingerprint: string | null;

	mutationAttempted: boolean;
	mutationSucceeded: boolean;
	mutationsApplied: 0 | 1;

	affectedClipIds: string[];
	affectedAssetIds: string[];

	requestedLanding?: {
		timebase: "SOURCE_MEDIA_TIME";
		startSourceTimeSec: number;
		endSourceTimeSec: number;
	};
	actualMutation?: {
		kind: string;
		detail: string;
	};

	verificationStatus:
		| "not_run"
		| "passed"
		| "failed"
		| "structurally_valid_but_quality_unverified"
		| "verified_render_basic"
		| "verified_render_with_warnings"
		| "render_verification_failed"
		| "render_unavailable"
		| "verified_compositor_basic"
		| "verified_compositor_with_warnings"
		| "compositor_verification_failed"
		| "compositor_unavailable"
		| "verified_single_trim_basic"
		| "verified_single_trim_with_warnings"
		| "verified_single_zoom_basic"
		| "verified_single_zoom_with_warnings"
		| "verified_single_crop_basic"
		| "verified_single_crop_with_warnings"
		| "verified_single_speed_basic"
		| "verified_single_speed_with_warnings"
		| "verified_single_caption_basic"
		| "verified_single_caption_with_warnings"
		| "verified_single_graphic_basic"
		| "verified_single_graphic_with_warnings"
		| "verified_single_transition_basic"
		| "verified_single_edit"
		| "family_verification_failed"
		| "audio_verification_failed"
		| "audio_unavailable";
	verificationNotes: string[];
	preservationOk: boolean | null;
	structuralOk: boolean | null;

	/** Family verification (zoom/crop/speed) — Edit Verify Expansion. */
	editVerification?: {
		providerId: "CURRENT_OPENSCREEN_LOCAL_EDIT_VERIFY_EXPANSION_V1";
		operationType: "zoom" | "crop" | "speed";
		status: string;
		levelsAchieved: string[];
		claims: string[];
		blockingReasons: string[];
		frameProvider: string | null;
		authoritativeSatisfied: boolean;
		familyVerificationMs: number;
		additionalModelCalls: 0;
	};

	/** Caption Verified Apply family attachment. */
	captionVerification?: {
		providerId: "CURRENT_OPENSCREEN_LOCAL_CAPTION_LAYOUT_V1";
		status: string;
		frameProvider: string | null;
		authoritativeSatisfied: boolean;
		sceneCaptionCount: number;
		sampledProgrammeTimes: number[];
		blockingReasons: string[];
		notes: string[];
		familyVerificationMs: number;
		liveVerifiedCaptionRender: boolean;
		additionalModelCalls: 0;
	};

	/** Title / callout / graphic Verified Apply attachment. */
	graphicVerification?: {
		providerId: "CURRENT_OPENSCREEN_GRAPHIC_VERIFIED_APPLY_V1";
		status: string;
		annotationId: string | null;
		kind: string | null;
		frameProvider: string | null;
		authoritativeSatisfied: boolean;
		sampledProgrammeTimes: number[];
		blockingReasons: string[];
		notes: string[];
		familyVerificationMs: number;
		liveVerifiedGraphicRender: boolean;
		additionalModelCalls: 0;
	};

	/** Render Verification V1 attachment (trim only). Absent when render stage not reached. */
	renderVerification?: {
		providerId: "CURRENT_OPENSCREEN_RENDER_VERIFY_V1";
		qualityState: RenderVerifyQualityState;
		evidence: RenderVerificationEvidence | null;
		renderVerificationMs: number;
		framesRendered: number;
		speechBoundaryRisk: string | null;
		additionalModelCalls: 0;
	};

	/** Offscreen Native Compositor Verification V1 — authoritative visual gate. */
	compositorVerification?: {
		providerId: "CURRENT_OPENSCREEN_COMPOSITOR_VERIFY_V1";
		qualityState: CompositorVerifyQualityState;
		evidence: CompositorTrimVerifyEvidence | null;
		frameProvider: string;
		authoritativeSatisfied: boolean;
		/** Filled after Audio Continuity V1; NOT_VERIFIED until that stage runs. */
		audioContinuity: AudioContinuityStatus | "NOT_VERIFIED";
		compositorVerificationMs: number;
		framesCaptured: number;
		additionalModelCalls: 0;
	};

	/** Audio Continuity Verification V1 — programme PCM around trim join. */
	audioVerification?: {
		providerId: "CURRENT_OPENSCREEN_AUDIO_VERIFY_V1";
		status: AudioContinuityStatus;
		evidence: AudioContinuityEvidence;
		capturePath: string;
		speechBoundaryRisk: string;
		audioVerificationMs: number;
		pcmSamplesAnalyzed: number;
		additionalModelCalls: 0;
	};

	rollbackStatus: "not_needed" | "not_run" | "succeeded" | "failed";
	rollbackFingerprintMatch: boolean | null;

	latencyMs: {
		preflightMs: number;
		snapshotMs: number;
		applyMs: number;
		structuralVerificationMs: number;
		preservationVerificationMs: number;
		renderVerificationMs: number;
		audioVerificationMs: number;
		rollbackMs: number;
		totalMs: number;
	};
	toolCalls: number;
	additionalOrchestrationModelCalls: 0;
	timestamps: {
		startedAtIso: string;
		finishedAtIso: string;
	};
}

export interface ApplyPreviewInput {
	document: AxcutDocument;
	editProposalV1: EditProposalV1;
	/** Explicit proposal to apply; required for mutation. */
	selectedProposalId?: string;
	/** Explicit consent; without it, mutation = 0. */
	consent?: ApplyConsent | null;
	/**
	 * Preflight produced earlier for this document state.
	 * Required for consented apply so consent.preflightId can match.
	 * If omitted, a fresh preflight is built (diagnostics / blocked paths).
	 */
	preflight?: ApplyPreflight;
	/**
	 * Fingerprint the proposal was generated against.
	 * If omitted, preflight uses current document (fresh proposals only).
	 */
	proposalDocumentFingerprint?: string | null;
	/** Test hook: force verification failure after successful mutation. */
	forceVerificationFailure?: boolean;
	/** Test hook: force apply to use wrong args (should still be blocked by exact-proposal apply). */
	editsAllowed?: boolean;
	/**
	 * Render Verification V1 frame sampler (legacy / diagnostics).
	 * Authoritative visual gate is compositorVerification.
	 */
	renderFrameSampler?: RenderFrameSampler;
	/** Offscreen native compositor sampler (authoritative). */
	compositorFrameSampler?: CompositedFrameSampler;
	/** Unit tests only: allow injected compositor sampler as authoritative. */
	allowInjectedCompositorAsAuthoritative?: boolean;
	/** Retain render-verify artifacts under artifactDir. */
	retainRenderArtifacts?: boolean;
	renderArtifactDir?: string;
	/** Default true — render/compositor unavailable triggers rollback. */
	failClosedIfRenderUnavailable?: boolean;
	/** Injected programme PCM for unit tests (skips bounded exportMulti). */
	audioPcmProvider?: AudioPcmProvider;
	/** Treat media as no_audio without probing (tests). */
	forceNoAudio?: boolean;
	/** Force audio extraction failure (tests). */
	forceAudioUnavailable?: boolean;
	/** Retain temporary composed audio under audioArtifactDir. */
	retainAudioArtifacts?: boolean;
	audioArtifactDir?: string;
	/** Native addon appRoot for live export path. */
	appRoot?: string;
	/** Force zoom/crop/speed family verify failure (tests). */
	forceFamilyVerifyFailure?: boolean;
}

export interface ApplyPreviewResult {
	version: 1;
	providerId: typeof APPLY_PREVIEW_V1_PROVIDER_ID;
	preflight: ApplyPreflight;
	consentAccepted: boolean;
	receipt: EditApplicationReceipt;
	/** Resulting document: verified mutation, rolled-back original, or unchanged. */
	document: AxcutDocument;
	mutatedAndVerified: boolean;
}

export function isProposalEligibleShape(p: EditProposalItem): {
	ok: boolean;
	reasons: EligibilityBlockReason[];
} {
	const reasons: EligibilityBlockReason[] = [];
	if (p.status === "provisional") reasons.push("provisional");
	if (p.status === "no_safe_proposal") reasons.push("no_safe_proposal");
	if (p.status === "needs_more_evidence") reasons.push("needs_more_evidence");
	if (p.status === "unsupported") reasons.push("unsupported");
	if (p.status !== "proposal_ready") {
		if (!reasons.length) reasons.push("proposal_not_ready");
	}
	if (!p.landing) reasons.push("missing_landing");
	if (p.landing) {
		// Proposal layer always keeps finalizedForApply === false; apply preview
		// finalizes only after consent. Reject only invalid ranges.
		if (!(p.landing.endSourceTimeSec > p.landing.startSourceTimeSec)) {
			reasons.push("invalid_landing");
		}
		if (p.landing.timebase !== "SOURCE_MEDIA_TIME") {
			reasons.push("invalid_landing");
		}
	}
	if (!p.proposedCall) reasons.push("missing_proposed_call");
	if (p.proposedCall && p.proposedCall.notExecuted !== true) {
		reasons.push("not_executed_flag_missing");
	}
	if (p.proposedCall && !p.proposedCall.toolName) reasons.push("missing_tool_name");
	if (p.preservationViolationRisk === "blocking") reasons.push("blocking_preservation_risk");
	if (p.continuityRisk === "blocking" || p.damageRisks.some((d) => d.level === "blocking")) {
		reasons.push("blocking_damage_risk");
	}
	return { ok: reasons.length === 0, reasons };
}
