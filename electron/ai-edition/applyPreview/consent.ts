/**
 * Explicit consent gate — proposal_ready ≠ consented_for_preview.
 * Verified Apply Expansion: binds toolName + operation args fingerprint.
 */

import { createHash, randomUUID } from "node:crypto";
import type { ApplyConsent, ApplyPreflight } from "./types";

export function createApplyConsent(args: {
	proposalId: string;
	preflight: ApplyPreflight;
	consentedAtIso?: string;
}): ApplyConsent {
	const consentedAtIso = args.consentedAtIso ?? new Date().toISOString();
	const toolName = args.preflight.toolName ?? "";
	const opFp = args.preflight.operationArgsFingerprint ?? "";
	const id = createHash("sha256")
		.update(
			`${args.proposalId}|${args.preflight.id}|${args.preflight.documentFingerprint.value}|${toolName}|${opFp}|${consentedAtIso}`,
		)
		.digest("hex")
		.slice(0, 24);
	return {
		id: `ap_consent_${id}`,
		proposalId: args.proposalId,
		preflightId: args.preflight.id,
		documentFingerprint: args.preflight.documentFingerprint.value,
		authorizedMutation: true,
		scope: "single_proposal_preview",
		consentedAtIso,
		toolName: args.preflight.toolName,
		operationArgsFingerprint: args.preflight.operationArgsFingerprint,
	};
}

/** Test helper: mint a consent object (still must match preflight fingerprint). */
export function mintTestConsent(preflight: ApplyPreflight, proposalId: string): ApplyConsent {
	return createApplyConsent({
		proposalId,
		preflight,
		consentedAtIso: "2026-01-01T00:00:00.000Z",
	});
}

export function validateConsent(args: {
	consent: ApplyConsent | null | undefined;
	proposalId: string;
	preflight: ApplyPreflight;
	currentFingerprint: string;
}): { ok: boolean; reason?: string } {
	const c = args.consent;
	if (!c) return { ok: false, reason: "missing_consent" };
	if (c.authorizedMutation !== true) return { ok: false, reason: "not_authorized" };
	if (c.scope !== "single_proposal_preview") return { ok: false, reason: "invalid_scope" };
	if (c.proposalId !== args.proposalId) return { ok: false, reason: "proposal_id_mismatch" };
	if (c.preflightId !== args.preflight.id) return { ok: false, reason: "preflight_id_mismatch" };
	if (c.documentFingerprint !== args.preflight.documentFingerprint.value) {
		return { ok: false, reason: "consent_fingerprint_mismatch" };
	}
	if (c.documentFingerprint !== args.currentFingerprint) {
		return { ok: false, reason: "document_changed_after_consent" };
	}
	// Operation binding (Verified Apply Expansion V1).
	if (
		c.toolName != null &&
		args.preflight.toolName != null &&
		c.toolName !== args.preflight.toolName
	) {
		return { ok: false, reason: "operation_type_mismatch" };
	}
	if (
		c.operationArgsFingerprint != null &&
		args.preflight.operationArgsFingerprint != null &&
		c.operationArgsFingerprint !== args.preflight.operationArgsFingerprint
	) {
		return { ok: false, reason: "operation_args_mismatch" };
	}
	return { ok: true };
}

export function newConsentId(): string {
	return `ap_consent_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
