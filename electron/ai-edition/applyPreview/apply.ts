/**
 * Transactional single apply via existing executeAgentTool.
 * Verified Apply Expansion: addTrim | addZoom | setClipCrop | addSpeed.
 * Decision: full AxcutDocument snapshot (structuredClone) for exact rollback.
 */

import {
	getCaptionSettings,
	patchCaptionSettings,
} from "../../../src/lib/ai-edition/captions/settings";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { executeAgentTool } from "../agent-tools";
import type { EditProposalItem } from "../editProposal/types";
import { fingerprintDocument } from "./fingerprint";
import type { ApplyPreflight, PreApplySnapshot } from "./types";

let snapSeq = 0;

export function capturePreApplySnapshot(document: AxcutDocument): {
	snapshot: PreApplySnapshot;
	snapshotMs: number;
} {
	const t0 = Date.now();
	snapSeq += 1;
	const cloned = structuredClone(document) as AxcutDocument;
	const fingerprint = fingerprintDocument(cloned);
	return {
		snapshot: {
			id: `ap_snap_${snapSeq}`,
			document: cloned,
			fingerprint,
			capturedAtIso: new Date().toISOString(),
		},
		snapshotMs: Date.now() - t0,
	};
}

export function restoreFromSnapshot(snapshot: PreApplySnapshot): AxcutDocument {
	return structuredClone(snapshot.document) as AxcutDocument;
}

/**
 * Apply exactly the approved proposal args — no editorial reinterpretation.
 */
export function applyApprovedProposal(args: {
	document: AxcutDocument;
	proposal: EditProposalItem;
	preflight: ApplyPreflight;
	editsAllowed?: boolean;
}): {
	ok: boolean;
	document: AxcutDocument;
	applyMs: number;
	toolCalls: number;
	error?: string;
	actualMutation?: { kind: string; detail: string };
	resultJson?: string;
} {
	const t0 = Date.now();
	const toolName = args.proposal.proposedCall?.toolName;
	const provisional = args.proposal.proposedCall?.provisionalArgs ?? {};
	if (!toolName) {
		return {
			ok: false,
			document: args.document,
			applyMs: Date.now() - t0,
			toolCalls: 0,
			error: "missing_tool_name",
		};
	}

	const sanitizedArgs: Record<string, unknown> = { ...provisional };
	const landing = args.preflight.landing;

	if (toolName === "addTrim" && landing) {
		sanitizedArgs.startSec = landing.startSourceTimeSec;
		sanitizedArgs.endSec = landing.endSourceTimeSec;
		if (args.preflight.assetId) sanitizedArgs.assetId = args.preflight.assetId;
		if (args.preflight.clipId) sanitizedArgs.clipId = args.preflight.clipId;
		if (typeof provisional.reason === "string") sanitizedArgs.reason = provisional.reason;
		else sanitizedArgs.reason = args.proposal.intent.slice(0, 200);
	}

	if ((toolName === "addZoom" || toolName === "setZoom") && landing) {
		sanitizedArgs.startSec = landing.startSourceTimeSec;
		sanitizedArgs.endSec = landing.endSourceTimeSec;
		if (args.preflight.clipId) sanitizedArgs.clipId = args.preflight.clipId;
		// depth/focus already required by family preflight — pass through exact.
	}

	if (toolName === "setClipCrop") {
		if (args.preflight.clipId) sanitizedArgs.clipId = args.preflight.clipId;
		// crop required by family preflight
	}

	if ((toolName === "addSpeed" || toolName === "setSpeed") && landing) {
		sanitizedArgs.startSec = landing.startSourceTimeSec;
		sanitizedArgs.endSec = landing.endSourceTimeSec;
	}

	if (toolName === "addGraphic" && landing) {
		sanitizedArgs.startSec = landing.startSourceTimeSec;
		sanitizedArgs.endSec = landing.endSourceTimeSec;
	}

	// Caption Verified Apply: settings-only mutation (derived cues from transcript SSOT).
	if (toolName === "enableCaptions") {
		const aspect =
			typeof sanitizedArgs.aspectValue === "number" ? sanitizedArgs.aspectValue : 16 / 9;
		const before = getCaptionSettings(args.document, aspect);
		if (before.enabled) {
			return {
				ok: false,
				document: args.document,
				applyMs: Date.now() - t0,
				toolCalls: 0,
				error: "captions_already_enabled",
			};
		}
		const next = patchCaptionSettings(args.document, { enabled: true }, aspect);
		return {
			ok: true,
			document: next,
			applyMs: Date.now() - t0,
			toolCalls: 1,
			resultJson: JSON.stringify({ enabled: true, preserveManualCaptions: true }),
			actualMutation: {
				kind: "enableCaptions",
				detail: "caption_settings_enabled",
			},
		};
	}

	const result = executeAgentTool(args.document, toolName, JSON.stringify(sanitizedArgs), {
		editsAllowed: args.editsAllowed !== false,
		mutationMode: "consented_apply",
	});

	if (!result.ok || !result.document) {
		return {
			ok: false,
			document: args.document,
			applyMs: Date.now() - t0,
			toolCalls: 1,
			error: result.summary ?? "tool_failed",
		};
	}

	return {
		ok: true,
		document: result.document,
		applyMs: Date.now() - t0,
		toolCalls: 1,
		resultJson: result.resultJson,
		actualMutation: {
			kind: toolName,
			detail: result.summary ?? "applied",
		},
	};
}
