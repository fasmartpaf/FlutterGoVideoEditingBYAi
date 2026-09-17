/**
 * Per-project local editorial session — follow-up grounding without a cloud model.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import type {
	DurationTargetHardness,
	EditFamilyRequest,
	LocalEditorialIntent,
	LocalEditorialRequestV1,
	LocalEditorialSessionRevisionV1,
	LocalEditorialSessionStateV1,
	PreserveClass,
} from "./types";

const sessions = new Map<string, LocalEditorialSessionStateV1>();

function empty(projectId: string): LocalEditorialSessionStateV1 {
	return {
		projectId,
		assetId: null,
		constraints: [],
		preserve: [],
		latestPlanId: null,
		committedOperations: [],
		revisions: [],
		durationTargetSec: null,
		durationHardness: null,
		userRelaxedPreservation: false,
		currentProgrammeDurationSec: null,
		lastAssistantDecision: null,
		lastWithheldReason: null,
		requestedFamilies: [],
		originalUserGoal: null,
		pendingProposal: null,
	};
}

export function getLocalEditorialSession(projectId: string): LocalEditorialSessionStateV1 {
	let s = sessions.get(projectId);
	if (!s) {
		s = empty(projectId);
		sessions.set(projectId, s);
	}
	return s;
}

export function rememberLocalEditorialConstraints(
	projectId: string,
	preserve: PreserveClass[],
	constraints: string[],
	durationTargetSec: number | null,
	opts?: {
		durationHardness?: DurationTargetHardness;
		relaxPreservation?: boolean;
		requestedFamilies?: EditFamilyRequest[];
		originalUserGoal?: string | null;
		currentProgrammeDurationSec?: number | null;
		lastAssistantDecision?: string | null;
		lastWithheldReason?: string | null;
	},
): void {
	const s = getLocalEditorialSession(projectId);
	s.preserve = [...new Set([...s.preserve, ...preserve])];
	s.constraints = [...new Set([...s.constraints, ...constraints])];
	if (durationTargetSec != null) s.durationTargetSec = durationTargetSec;
	if (opts?.durationHardness != null) s.durationHardness = opts.durationHardness;
	if (opts?.relaxPreservation) s.userRelaxedPreservation = true;
	if (opts?.requestedFamilies?.length) {
		s.requestedFamilies = [...new Set([...s.requestedFamilies, ...opts.requestedFamilies])];
	}
	if (opts?.originalUserGoal && !s.originalUserGoal) {
		s.originalUserGoal = opts.originalUserGoal;
	}
	if (opts?.currentProgrammeDurationSec != null) {
		s.currentProgrammeDurationSec = opts.currentProgrammeDurationSec;
	}
	if (opts?.lastAssistantDecision != null) {
		s.lastAssistantDecision = opts.lastAssistantDecision;
	}
	if (opts?.lastWithheldReason != null) {
		s.lastWithheldReason = opts.lastWithheldReason;
	}
}

export function applyRequestToLocalEditorialSession(
	projectId: string,
	request: LocalEditorialRequestV1,
): void {
	rememberLocalEditorialConstraints(
		projectId,
		request.preserve,
		request.constraints,
		request.durationTargetMaxSec ?? request.durationTargetSec,
		{
			durationHardness: request.durationHardness,
			relaxPreservation: request.relaxPreservationForDuration,
			requestedFamilies: request.requestedFamilies,
			originalUserGoal: request.intent === "PROFESSIONALIZE" ? request.rawText : null,
		},
	);
}

export function pushLocalEditorialRevision(args: {
	projectId: string;
	assetId: string | null;
	prompt: string;
	intent: LocalEditorialIntent;
	/** Document state BEFORE this turn's mutations (for restore). */
	documentBefore: AxcutDocument;
	committedFamilies: string[];
	userFacingText: string;
}): void {
	const s = getLocalEditorialSession(args.projectId);
	s.assetId = args.assetId ?? s.assetId;
	const rev: LocalEditorialSessionRevisionV1 = {
		atIso: new Date().toISOString(),
		prompt: args.prompt,
		intent: args.intent,
		document: structuredClone(args.documentBefore),
		documentFingerprint: fingerprintDocument(args.documentBefore).value,
		committedFamilies: args.committedFamilies,
		userFacingText: args.userFacingText,
	};
	s.revisions.push(rev);
	// Cap memory — keep last 12 restores.
	if (s.revisions.length > 12) s.revisions.splice(0, s.revisions.length - 12);
	for (const f of args.committedFamilies) {
		if (!s.committedOperations.includes(f)) s.committedOperations.push(f);
	}
	s.lastAssistantDecision = args.userFacingText.slice(0, 240);
}

export function restorePreviousLocalEditorialDocument(projectId: string):
	| { ok: true; document: AxcutDocument; restoredFrom: LocalEditorialSessionRevisionV1 }
	| {
			ok: false;
			reason: string;
	  } {
	const s = getLocalEditorialSession(projectId);
	const last = s.revisions.pop();
	if (!last) {
		return {
			ok: false,
			reason: "No previous local edit revision is stored for this project yet.",
		};
	}
	return { ok: true, document: structuredClone(last.document), restoredFrom: last };
}

export function clearLocalEditorialSessionsForTests(): void {
	sessions.clear();
}

export function setLocalEditorialPendingProposal(
	projectId: string,
	proposal: import("./types").LocalEditorialPendingProposalV1 | null,
): void {
	getLocalEditorialSession(projectId).pendingProposal = proposal;
}

export function clearLocalEditorialPendingProposal(projectId: string): void {
	getLocalEditorialSession(projectId).pendingProposal = null;
}

export function getLocalEditorialPendingProposal(
	projectId: string,
): import("./types").LocalEditorialPendingProposalV1 | null {
	return getLocalEditorialSession(projectId).pendingProposal;
}
