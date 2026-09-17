/**
 * Local-first Chat control entry — routes to existing orch / direct / session restore.
 */

import { getCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import type { OpenScreenChatModelConfig } from "../deep-agent/chat-model";
import { isBareAffirmation, isVerbalProceed } from "../professionalEditOrchestrator/intent";
import { applyLocalDirectDocumentEdit } from "./direct";
import { extractCalloutStyleOp, extractCalloutText, listCalloutAnnotations } from "./directCallout";
import { extractCaptionStyleOp, extractCaptionTextReplace } from "./directCaptions";
import { listSpeedRegions } from "./directSpeed";
import { extractTitleStyleOp, extractTitleText, listTitleAnnotations } from "./directTitle";
import { extractTransitionStyleOp, listTransitionJoins } from "./directTransition";
import {
	playbackPointToRawTimelineSec,
	playbackRangeToZoomRawRange,
	programmeDurationSec,
	rawTimelineDurationSec,
} from "./directTrim";
import { loadCursorSamplesFromSidecar } from "./directZoomFocus";
import {
	buildDurationConstraintDecision,
	formatDurationConstraintReceipt,
} from "./durationConstraint";
import { isLocalEditorialResolvable, parseLocalEditorialRequest } from "./parse";
import { buildLocalEditorialReceipt } from "./receipt";
import { classifyLocalEditorialTurnWithSession } from "./resolveFollowUp";
import { understandSemanticRequest } from "./semanticBrain";
import { applySemanticToLocalRequest } from "./semanticContract";
import {
	classifySemanticEventKind,
	extractSemanticEventCue,
	loadVisualChangeIntervalsForDocument,
	resolveSemanticEditEvent,
	resolveSemanticEditEventAsync,
	type VisualChangeIntervalLite,
} from "./semanticEventResolve";
import {
	applyRequestToLocalEditorialSession,
	clearLocalEditorialPendingProposal,
	getLocalEditorialSession,
	pushLocalEditorialRevision,
	restorePreviousLocalEditorialDocument,
	setLocalEditorialPendingProposal,
} from "./session";
import type {
	DurationConstraintDecisionV1,
	EditFamilyRequest,
	LocalEditorialIntent,
	LocalEditorialPendingProposalV1,
	LocalEditorialRequestV1,
} from "./types";

type SemanticSkillFamilyV1 =
	| "zoom"
	| "callout"
	| "title"
	| "speed"
	| "trim"
	| "captions"
	| "transitions";

/** Intent the frozen executor must use when confirming a typed pending proposal. */
function pendingExecuteIntent(p: LocalEditorialPendingProposalV1): LocalEditorialIntent {
	if (p.parameters?.executeIntent) return p.parameters.executeIntent;
	if (p.kind === "advice_callout" || p.families.includes("callout")) return "CALLOUT";
	if (p.kind === "advice_title" || p.families.includes("title")) return "TITLE";
	if (p.kind === "advice_speed" || p.families.includes("speed")) return "SPEED_UP";
	if (p.kind === "advice_trim" || p.families.includes("trim")) return "REMOVE_RANGE";
	if (p.kind === "advice_transition" || p.families.includes("transitions")) {
		return "TRANSITION";
	}
	if (p.kind === "advice_zoom" || p.kind === "direct_zoom" || p.families.includes("zoom")) {
		return "ADD_ZOOM";
	}
	return "ADD_ZOOM";
}

function isZoomExecuteIntent(intent: LocalEditorialIntent): boolean {
	return intent === "ADD_ZOOM" || intent === "REMOVE_ZOOM" || intent === "ADJUST_ZOOM";
}

function missingApplyRange(resolved: LocalEditorialRequestV1): boolean {
	const range = resolved.range;
	if (!range) return true;
	// Transition joins (and other point targets) are valid as a single timestamp.
	if (range.nearTimestamp === true || range.singleTimestamp === true) {
		return !Number.isFinite(range.startSec);
	}
	return !(range.endSec > range.startSec);
}

/** True when a confirmed pending already carries frozen WHERE (do not re-ground). */
function isConfirmedGroundedPending(resolved: LocalEditorialRequestV1): boolean {
	return (
		resolved.authority === "USER_CONFIRMED" &&
		resolved.range != null &&
		!missingApplyRange(resolved)
	);
}

function transitionJoinStillValid(
	document: AxcutDocument,
	programmeJoinSec: number,
	clipId?: string | null,
): { ok: true; programmeJoinSec: number; clipId: string } | { ok: false; reason: string } {
	const joins = listTransitionJoins(document);
	if (joins.length === 0) {
		return {
			ok: false,
			reason:
				"The pending transition join is no longer valid — this project has no clip join to apply a transition on.",
		};
	}
	if (clipId) {
		const byId = joins.find((j) => j.clip.id === clipId);
		if (byId && Math.abs(byId.programmeJoinSec - programmeJoinSec) <= 0.05) {
			return {
				ok: true,
				programmeJoinSec: byId.programmeJoinSec,
				clipId: byId.clip.id,
			};
		}
		if (byId) {
			return {
				ok: false,
				reason:
					"The pending transition join moved on the timeline. Ask me again and I’ll re-ground it.",
			};
		}
		return {
			ok: false,
			reason: "The pending transition’s clip join is gone. Ask me again and I’ll re-ground it.",
		};
	}
	const exact = joins.find((j) => Math.abs(j.programmeJoinSec - programmeJoinSec) <= 0.05);
	if (exact) {
		return {
			ok: true,
			programmeJoinSec: exact.programmeJoinSec,
			clipId: exact.clip.id,
		};
	}
	return {
		ok: false,
		reason:
			"The pending transition join is no longer at that programme time. Ask me again and I’ll re-ground it.",
	};
}

/**
 * Registered skill family from AI WHAT / resolved intent (never phrase regex).
 * Captions enable is whole-programme; transitions are join-based.
 */
function skillFamilyFromResolved(resolved: LocalEditorialRequestV1): SemanticSkillFamilyV1 | null {
	const fams = resolved.requestedFamilies ?? [];
	const skills = resolved.semanticSkillRequest?.skills ?? [];
	const intent = resolved.intent;

	if (
		intent === "CALLOUT" ||
		intent === "ADJUST_CALLOUT" ||
		intent === "REMOVE_CALLOUT" ||
		fams.includes("callout") ||
		skills.includes("callout")
	) {
		return "callout";
	}
	if (
		intent === "TITLE" ||
		intent === "ADJUST_TITLE" ||
		intent === "REMOVE_TITLE" ||
		fams.includes("title") ||
		skills.includes("title")
	) {
		return "title";
	}
	if (
		intent === "SPEED_UP" ||
		intent === "SLOW_DOWN" ||
		fams.includes("speed") ||
		skills.includes("speed")
	) {
		return "speed";
	}
	if (intent === "REMOVE_RANGE" || fams.includes("trim") || skills.includes("trim")) {
		return "trim";
	}
	if (
		intent === "ENABLE_CAPTIONS" ||
		intent === "CAPTIONS" ||
		intent === "CAPTION_STYLE" ||
		intent === "CORRECT_CAPTION" ||
		fams.includes("captions") ||
		skills.includes("captions")
	) {
		return "captions";
	}
	if (
		intent === "TRANSITION" ||
		intent === "ADJUST_TRANSITION" ||
		intent === "REMOVE_TRANSITION" ||
		fams.includes("transitions") ||
		skills.includes("transitions")
	) {
		return "transitions";
	}
	if (
		intent === "ADD_ZOOM" ||
		intent === "REMOVE_ZOOM" ||
		intent === "ADJUST_ZOOM" ||
		fams.includes("zoom") ||
		skills.includes("zoom")
	) {
		return "zoom";
	}
	return null;
}

/** Skills that need a grounded time target before the frozen executor may run. */
function familyNeedsEvidenceWhere(family: SemanticSkillFamilyV1 | null): boolean {
	return (
		family === "zoom" ||
		family === "callout" ||
		family === "title" ||
		family === "speed" ||
		family === "trim" ||
		family === "transitions"
	);
}

/** V1 advisory families that can store a confirmable typed pending proposal. */
function familySupportsAdvicePending(family: SemanticSkillFamilyV1 | null): boolean {
	return (
		family === "zoom" ||
		family === "callout" ||
		family === "title" ||
		family === "speed" ||
		family === "trim" ||
		family === "transitions"
	);
}

function executeIntentForFamily(
	family: SemanticSkillFamilyV1,
	resolved: LocalEditorialRequestV1,
): LocalEditorialIntent {
	if (family === "callout") return "CALLOUT";
	if (family === "title") return "TITLE";
	if (family === "speed") {
		return resolved.intent === "SLOW_DOWN" ? "SLOW_DOWN" : "SPEED_UP";
	}
	if (family === "trim") return "REMOVE_RANGE";
	if (family === "transitions") return "TRANSITION";
	return "ADD_ZOOM";
}

function adviceOverlayText(args: {
	family: "callout" | "title";
	modificationText: string | null | undefined;
	cue: string;
}): string {
	const quoted = args.modificationText?.trim();
	if (quoted) return quoted;
	const stripped = args.cue.replace(/^when\s+/i, "").trim();
	if (stripped.length > 0 && stripped.length <= 48) return stripped;
	return args.family === "title" ? "Title" : "Note";
}

function nearestTransitionJoin(args: {
	document: AxcutDocument;
	programmeSec: number;
	maxDeltaSec?: number;
}): { programmeJoinSec: number; clipId: string } | null {
	const joins = listTransitionJoins(args.document);
	if (joins.length === 0) return null;
	const maxDelta = args.maxDeltaSec ?? 2.5;
	let best = joins[0]!;
	let bestDelta = Math.abs(best.programmeJoinSec - args.programmeSec);
	for (const j of joins.slice(1)) {
		const d = Math.abs(j.programmeJoinSec - args.programmeSec);
		if (d < bestDelta) {
			best = j;
			bestDelta = d;
		}
	}
	if (bestDelta > maxDelta) return null;
	return { programmeJoinSec: best.programmeJoinSec, clipId: best.clip.id };
}

/**
 * Relative / anaphoric speed follow-ups that should adjust an EXISTING speed
 * region on the document (including after Electron restart when Chat session
 * history is gone). Autonomous cues stay on the orchestrator path.
 */
function looksLikeDocumentGroundedSpeedFollowUp(userMessage: string): boolean {
	const t = userMessage.trim().toLowerCase();
	if (
		/\blow[\s-]?info(?:rmation)?\b|\bnavigation\b|\bscroll(?:ing)?\b|\bloading\b|\bwaiting\b|\bslow\s+parts?\b|\bwhere(?:ver)?\s+it\s+helps\b|\byou\s+decide\b/.test(
			t,
		)
	) {
		return false;
	}
	if (/\bzoom|trim|cut|pause|silence|dead\s*air\b/.test(t)) return false;
	if (/\b(?:that|this|the|last)\s+speed\b/.test(t)) return true;
	if (/\bmake\s+that\s+speed\b/.test(t)) return true;
	if (/\bmake\s+(?:it|that|this)\s+(?:a\s+little\s+)?(?:faster|slower|stronger|weaker)\b/.test(t)) {
		return true;
	}
	if (/^(?:a\s+little\s+)?(?:more|faster|slower)\.?$/.test(t)) return true;
	if (/\btoo\s+fast\b|\breduce\s+it\b/.test(t)) return true;
	if (/\breturn\b.+\bnormal\s+speed\b|\b(?:to\s+)?normal\s+speed\b/.test(t)) return true;
	if (/\bstart\s+(?:that\s+)?half\b|\bend\s+it\b/.test(t)) return true;
	return false;
}

function promoteSpeedFollowUpFromDocument(
	request: LocalEditorialRequestV1,
	document: AxcutDocument,
	userMessage: string,
): LocalEditorialRequestV1 {
	if (request.range != null) return request;
	if (listSpeedRegions(document).length === 0) return request;
	const speedIntent =
		request.intent === "SPEED_UP" ||
		request.intent === "SLOW_DOWN" ||
		request.intent === "REMOVE_EDIT" ||
		request.intent === "REVISE_PREVIOUS_EDIT";
	if (!speedIntent) return request;
	if (
		request.executionKind === "direct_document" &&
		request.referencedPreviousEdit === "last_speed"
	) {
		return request;
	}
	if (
		!(
			request.referencedPreviousEdit === "last_speed" ||
			looksLikeDocumentGroundedSpeedFollowUp(userMessage)
		)
	) {
		return request;
	}
	return {
		...request,
		executionKind: "direct_document",
		referencedPreviousEdit: "last_speed",
		orchestratorMessage: null,
		localCapabilityAvailable: true,
		routeClass: "LOCAL_RESOLVED",
		resolvedFromConversation: true,
		requestedFamilies: request.requestedFamilies.includes("speed")
			? request.requestedFamilies
			: [...request.requestedFamilies, "speed"],
	};
}

function looksLikeDocumentGroundedCaptionFollowUp(userMessage: string): boolean {
	const t = userMessage.trim().toLowerCase();
	if (/\bzoom|trim|cut|pause|speed|faster|slower\b/.test(t)) return false;
	return (
		/\b(?:the\s+)?captions?\b/.test(t) ||
		/\b(?:the\s+)?subtitles?\b/.test(t) ||
		/\bmake\s+them\b/.test(t) ||
		/\bmove\s+them\b/.test(t) ||
		/\bturn\s+(?:them|captions?|subtitles?)\b/.test(t) ||
		extractCaptionStyleOp(t) != null ||
		extractCaptionTextReplace(userMessage) != null
	);
}

function promoteCaptionFollowUpFromDocument(
	request: LocalEditorialRequestV1,
	document: AxcutDocument,
	userMessage: string,
): LocalEditorialRequestV1 {
	const captionsOn = getCaptionSettings(document).enabled;
	const hasCaptionState =
		captionsOn || Boolean((document.legacyEditor as Record<string, unknown> | null)?.captions);
	if (!hasCaptionState) return request;

	if (request.intent === "CORRECT_CAPTION" && request.executionKind === "direct_document") {
		return request;
	}

	if (
		request.intent === "CAPTION_STYLE" ||
		request.intent === "CAPTIONS" ||
		request.intent === "ENABLE_CAPTIONS" ||
		request.intent === "CORRECT_CAPTION"
	) {
		if (request.executionKind === "direct_document") {
			const styleOp = request.captionStyleOp ?? extractCaptionStyleOp(userMessage.toLowerCase());
			const textReplace = request.captionTextReplace ?? extractCaptionTextReplace(userMessage);
			return {
				...request,
				captionStyleOp: request.intent === "CAPTION_STYLE" ? styleOp : request.captionStyleOp,
				captionTextReplace:
					request.intent === "CORRECT_CAPTION" ? textReplace : request.captionTextReplace,
				referencedPreviousEdit: request.referencedPreviousEdit ?? "last_caption",
			};
		}
	}

	if (!looksLikeDocumentGroundedCaptionFollowUp(userMessage)) return request;

	const styleOp = extractCaptionStyleOp(userMessage.toLowerCase());
	const textReplace = extractCaptionTextReplace(userMessage);
	if (textReplace) {
		return {
			...request,
			intent: "CORRECT_CAPTION",
			executionKind: "direct_document",
			referencedPreviousEdit: "last_caption",
			captionTextReplace: textReplace,
			orchestratorMessage: null,
			localCapabilityAvailable: true,
			routeClass: "LOCAL_RESOLVED",
			resolvedFromConversation: true,
			requestedFamilies: request.requestedFamilies.includes("captions")
				? request.requestedFamilies
				: [...request.requestedFamilies, "captions"],
		};
	}
	if (
		/\b(?:off|hide|remove|disable)\b/i.test(userMessage) &&
		!/\bdon'?t\b/i.test(userMessage) &&
		/\bcaption|subtitle|them\b/i.test(userMessage)
	) {
		return {
			...request,
			intent: "CAPTIONS",
			executionKind: "direct_document",
			referencedPreviousEdit: "last_caption",
			orchestratorMessage: null,
			localCapabilityAvailable: true,
			routeClass: "LOCAL_RESOLVED",
			resolvedFromConversation: true,
			requestedFamilies: request.requestedFamilies.includes("captions")
				? request.requestedFamilies
				: [...request.requestedFamilies, "captions"],
		};
	}
	if (
		/\b(?:on|enable|show|back\s+on)\b/i.test(userMessage) &&
		/\bcaption|subtitle|them\b/i.test(userMessage)
	) {
		return {
			...request,
			intent: "ENABLE_CAPTIONS",
			executionKind: "direct_document",
			referencedPreviousEdit: "last_caption",
			orchestratorMessage: null,
			localCapabilityAvailable: true,
			routeClass: "LOCAL_RESOLVED",
			resolvedFromConversation: true,
			requestedFamilies: request.requestedFamilies.includes("captions")
				? request.requestedFamilies
				: [...request.requestedFamilies, "captions"],
		};
	}
	if (styleOp || /\bmake\s+them\b|\bmove\s+them\b/i.test(userMessage)) {
		return {
			...request,
			intent: "CAPTION_STYLE",
			executionKind: "direct_document",
			referencedPreviousEdit: "last_caption",
			captionStyleOp: styleOp ?? request.captionStyleOp ?? "smaller",
			orchestratorMessage: null,
			localCapabilityAvailable: true,
			routeClass: "LOCAL_RESOLVED",
			resolvedFromConversation: true,
			requestedFamilies: request.requestedFamilies.includes("captions")
				? request.requestedFamilies
				: [...request.requestedFamilies, "captions"],
		};
	}
	return request;
}

function looksLikeDocumentGroundedTitleFollowUp(userMessage: string): boolean {
	const t = userMessage.trim().toLowerCase();
	if (/\bzoom|caption|subtitle|trim|cut|pause|speed|faster|slower|callout|highlight\b/.test(t)) {
		return false;
	}
	return (
		/\btitle\b/.test(t) ||
		extractTitleStyleOp(t) != null ||
		/\bchange\s+(?:that|it)\s+to\b/.test(t) ||
		/\bmake\s+(?:it|that)\s+(?:a\s+little\s+)?(?:bigger|smaller|higher|lower)\b/.test(t) ||
		/\bmove\s+(?:it|that)\b/.test(t) ||
		/\bkeep\s+(?:it|that)\b.+\blonger\b/.test(t)
	);
}

function promoteTitleFollowUpFromDocument(
	request: LocalEditorialRequestV1,
	document: AxcutDocument,
	userMessage: string,
): LocalEditorialRequestV1 {
	if (listTitleAnnotations(document).length === 0) return request;
	if (
		(request.intent === "TITLE" ||
			request.intent === "ADJUST_TITLE" ||
			request.intent === "REMOVE_TITLE") &&
		request.executionKind === "direct_document"
	) {
		return {
			...request,
			titleStyleOp: request.titleStyleOp ?? extractTitleStyleOp(userMessage.toLowerCase()),
			titleText: request.titleText ?? extractTitleText(userMessage),
			referencedPreviousEdit: request.referencedPreviousEdit ?? "last_title",
		};
	}
	if (!looksLikeDocumentGroundedTitleFollowUp(userMessage)) return request;
	if (/\b(?:remove|delete|drop)\b/i.test(userMessage) && /\btitle\b/i.test(userMessage)) {
		return {
			...request,
			intent: "REMOVE_TITLE",
			executionKind: "direct_document",
			referencedPreviousEdit: "last_title",
			orchestratorMessage: null,
			localCapabilityAvailable: true,
			routeClass: "LOCAL_RESOLVED",
			resolvedFromConversation: true,
			requestedFamilies: request.requestedFamilies.includes("title")
				? request.requestedFamilies
				: [...request.requestedFamilies, "title"],
		};
	}
	const styleOp = extractTitleStyleOp(userMessage.toLowerCase());
	const text = extractTitleText(userMessage);
	if (
		styleOp ||
		text ||
		/\bchange\s+(?:that|it)\s+to\b/i.test(userMessage) ||
		/\bmake\s+(?:it|that)\b/i.test(userMessage) ||
		/\bmove\s+(?:it|that)\b/i.test(userMessage)
	) {
		return {
			...request,
			intent: "ADJUST_TITLE",
			executionKind: "direct_document",
			referencedPreviousEdit: "last_title",
			titleStyleOp: styleOp ?? request.titleStyleOp,
			titleText: text ?? request.titleText,
			orchestratorMessage: null,
			localCapabilityAvailable: true,
			routeClass: "LOCAL_RESOLVED",
			resolvedFromConversation: true,
			requestedFamilies: request.requestedFamilies.includes("title")
				? request.requestedFamilies
				: [...request.requestedFamilies, "title"],
		};
	}
	return request;
}

function looksLikeDocumentGroundedCalloutFollowUp(userMessage: string): boolean {
	const t = userMessage.trim().toLowerCase();
	if (/\bzoom|caption|subtitle|trim|cut|pause|speed|faster|slower|title\b/.test(t)) {
		return false;
	}
	return (
		/\bcallout|highlight\b/.test(t) ||
		extractCalloutStyleOp(t) != null ||
		/\bchange\s+(?:that|it|the\s+callout(?:\s+text)?)\s+to\b/.test(t) ||
		/\bchange\s+(?:the\s+)?text\s+to\b/.test(t) ||
		/\bmake\s+(?:it|that)\s+(?:a\s+little\s+)?(?:bigger|smaller|higher|lower|left|right)\b/.test(
			t,
		) ||
		/\bmove\s+(?:it|that)\b/.test(t) ||
		/\bkeep\s+(?:it|that)\b.+\blonger\b/.test(t) ||
		/\bshow\s+(?:it|that)\b.+\bearlier\b/.test(t)
	);
}

function promoteCalloutFollowUpFromDocument(
	request: LocalEditorialRequestV1,
	document: AxcutDocument,
	userMessage: string,
): LocalEditorialRequestV1 {
	if (listCalloutAnnotations(document).length === 0) return request;
	if (
		(request.intent === "CALLOUT" ||
			request.intent === "ADJUST_CALLOUT" ||
			request.intent === "REMOVE_CALLOUT") &&
		request.executionKind === "direct_document"
	) {
		return {
			...request,
			calloutStyleOp: request.calloutStyleOp ?? extractCalloutStyleOp(userMessage.toLowerCase()),
			calloutText: request.calloutText ?? extractCalloutText(userMessage),
			referencedPreviousEdit: request.referencedPreviousEdit ?? "last_callout",
		};
	}
	if (!looksLikeDocumentGroundedCalloutFollowUp(userMessage)) return request;
	if (/\b(?:remove|delete|drop)\b/i.test(userMessage) && /\bcallout\b/i.test(userMessage)) {
		return {
			...request,
			intent: "REMOVE_CALLOUT",
			executionKind: "direct_document",
			referencedPreviousEdit: "last_callout",
			orchestratorMessage: null,
			localCapabilityAvailable: true,
			routeClass: "LOCAL_RESOLVED",
			resolvedFromConversation: true,
			requestedFamilies: request.requestedFamilies.includes("callout")
				? request.requestedFamilies
				: [...request.requestedFamilies, "callout"],
		};
	}
	const styleOp = extractCalloutStyleOp(userMessage.toLowerCase());
	const text = extractCalloutText(userMessage);
	if (
		styleOp ||
		text ||
		/\bchange\s+(?:that|it)\s+to\b/i.test(userMessage) ||
		/\bchange\s+(?:the\s+)?text\s+to\b/i.test(userMessage) ||
		/\bmake\s+(?:it|that)\b/i.test(userMessage) ||
		/\bmove\s+(?:it|that)\b/i.test(userMessage)
	) {
		return {
			...request,
			intent: "ADJUST_CALLOUT",
			executionKind: "direct_document",
			referencedPreviousEdit: "last_callout",
			calloutStyleOp: styleOp ?? request.calloutStyleOp,
			calloutText: text ?? request.calloutText,
			orchestratorMessage: null,
			localCapabilityAvailable: true,
			routeClass: "LOCAL_RESOLVED",
			resolvedFromConversation: true,
			requestedFamilies: request.requestedFamilies.includes("callout")
				? request.requestedFamilies
				: [...request.requestedFamilies, "callout"],
		};
	}
	return request;
}

function looksLikeDocumentGroundedTransitionFollowUp(userMessage: string): boolean {
	const t = userMessage.trim().toLowerCase();
	if (
		/\bzoom|caption|subtitle|trim|cut\s+pause|speed|faster|slower|title|callout|highlight\b/.test(t)
	) {
		return false;
	}
	return (
		/\btransition|dissolve|crossfade\b/.test(t) ||
		extractTransitionStyleOp(t) != null ||
		/\bmake\s+(?:it|that)\s+(?:a\s+little\s+)?(?:shorter|longer|quicker)\b/.test(t)
	);
}

function promoteTransitionFollowUpFromDocument(
	request: LocalEditorialRequestV1,
	document: AxcutDocument,
	userMessage: string,
): LocalEditorialRequestV1 {
	if (listTransitionJoins(document).length === 0) return request;
	if (
		(request.intent === "TRANSITION" ||
			request.intent === "ADJUST_TRANSITION" ||
			request.intent === "REMOVE_TRANSITION") &&
		request.executionKind === "direct_document"
	) {
		return {
			...request,
			transitionStyleOp:
				request.transitionStyleOp ?? extractTransitionStyleOp(userMessage.toLowerCase()),
			referencedPreviousEdit: request.referencedPreviousEdit ?? "last_transition",
		};
	}
	if (!looksLikeDocumentGroundedTransitionFollowUp(userMessage)) return request;
	if (/\b(?:remove|delete|drop)\b/i.test(userMessage) && /\btransition\b/i.test(userMessage)) {
		return {
			...request,
			intent: "REMOVE_TRANSITION",
			executionKind: "direct_document",
			referencedPreviousEdit: "last_transition",
			orchestratorMessage: null,
			localCapabilityAvailable: true,
			routeClass: "LOCAL_RESOLVED",
			resolvedFromConversation: true,
			requestedFamilies: request.requestedFamilies.includes("transitions")
				? request.requestedFamilies
				: [...request.requestedFamilies, "transitions"],
		};
	}
	const styleOp = extractTransitionStyleOp(userMessage.toLowerCase());
	if (
		styleOp ||
		/\bmake\s+(?:it|that)\b/i.test(userMessage) ||
		/\bchange\s+(?:it|that)\b/i.test(userMessage)
	) {
		return {
			...request,
			intent: "ADJUST_TRANSITION",
			executionKind: "direct_document",
			referencedPreviousEdit: "last_transition",
			transitionStyleOp: styleOp ?? request.transitionStyleOp,
			orchestratorMessage: null,
			localCapabilityAvailable: true,
			routeClass: "LOCAL_RESOLVED",
			resolvedFromConversation: true,
			requestedFamilies: request.requestedFamilies.includes("transitions")
				? request.requestedFamilies
				: [...request.requestedFamilies, "transitions"],
		};
	}
	return request;
}

export type LocalEditorialControlResult = {
	handled: boolean;
	request: LocalEditorialRequestV1;
	document: AxcutDocument;
	mutated: boolean;
	userFacingText: string;
	cloudCalls: number;
	/** When true, caller should run professional orchestrator with orchestratorMessage. */
	needsProfessionalOrchestrator: boolean;
	durationDecision: DurationConstraintDecisionV1 | null;
	documentFingerprintBefore: string;
	documentFingerprintAfter: string;
	families: string[];
	/** DIRECT zoom focus selection trace (WHERE only). */
	zoomFocusTrace?: import("./directZoomFocus").DirectZoomFocusTrace | null;
	providerCalls?: number;
	understandingProviderId?: string | null;
	understandingLatencyMs?: number;
	outcomeKind?:
		| "APPLIED"
		| "NEEDS_UNDERSTANDING"
		| "UNDERSTANDING_FAILED"
		| "REJECTED_PENDING"
		| "STALE_PENDING"
		| "AMBIGUOUS"
		| "NOT_FOUND"
		| "ADVISORY"
		| "ORCH"
		| "UNCHANGED";
};

export function classifyLocalEditorialTurn(
	userMessage: string,
	projectId?: string | null,
): LocalEditorialRequestV1 {
	if (projectId) return classifyLocalEditorialTurnWithSession(userMessage, projectId);
	return parseLocalEditorialRequest(userMessage);
}

export function shouldHandleLocalEditorialWithoutCloud(
	userMessage: string,
	projectId?: string | null,
): boolean {
	const req = classifyLocalEditorialTurn(userMessage, projectId);
	return isLocalEditorialResolvable(req);
}

/**
 * Handle direct / restore / constraint-only locally.
 * Professional orchestrator intents return needsProfessionalOrchestrator=true.
 * For UNRESOLVED / semantic_understanding, prefer applyLocalEditorialControlWithBrain.
 */
export function applyLocalEditorialControl(args: {
	projectId: string;
	document: AxcutDocument;
	userMessage: string;
	assetId?: string | null;
	cursorSamples?: import("./directZoomFocus").CursorSampleLite[] | null;
	/** Optional pre-resolved request (after semantic brain). */
	resolvedRequest?: LocalEditorialRequestV1 | null;
	/** Local visual-change intervals for truthful WHERE grounding. */
	visualChangeEvents?: import("./semanticEventResolve").VisualChangeIntervalLite[] | null;
	visualAnalysisUsed?: boolean;
	/** Precomputed event-identity results (tests / WithBrain). */
	identityByAnchorSec?: Map<
		number,
		{
			requestedEventIdentified: boolean;
			visualChangeObserved: boolean;
			evidenceRefs: string[];
			onsetTokens: string[];
		}
	> | null;
	identityChecked?: boolean;
}): LocalEditorialControlResult {
	const request = args.resolvedRequest
		? args.resolvedRequest
		: promoteTransitionFollowUpFromDocument(
				promoteCalloutFollowUpFromDocument(
					promoteTitleFollowUpFromDocument(
						promoteCaptionFollowUpFromDocument(
							promoteSpeedFollowUpFromDocument(
								classifyLocalEditorialTurn(args.userMessage, args.projectId),
								args.document,
								args.userMessage,
							),
							args.document,
							args.userMessage,
						),
						args.document,
						args.userMessage,
					),
					args.document,
					args.userMessage,
				),
				args.document,
				args.userMessage,
			);

	if (request.executionKind === "semantic_understanding" && !args.resolvedRequest) {
		const beforeFp = fingerprintDocument(args.document).value;
		return {
			handled: true,
			request,
			document: args.document,
			mutated: false,
			userFacingText:
				"I understood this as an edit request, but semantic understanding is required before I can apply it. " +
				"Configure a language model in Settings, or use an explicit timed command (for example: zoom from 5 to 10 seconds).",
			cloudCalls: 0,
			needsProfessionalOrchestrator: false,
			durationDecision: null,
			documentFingerprintBefore: beforeFp,
			documentFingerprintAfter: beforeFp,
			families: [],
			providerCalls: 0,
			understandingProviderId: null,
			outcomeKind: "NEEDS_UNDERSTANDING",
		};
	}

	return applyResolvedLocalEditorialControl({
		...args,
		request,
	});
}

/**
 * Product path: run semantic brain when deterministic parse is UNRESOLVED, then execute.
 */
export async function applyLocalEditorialControlWithBrain(args: {
	projectId: string;
	document: AxcutDocument;
	userMessage: string;
	assetId?: string | null;
	cursorSamples?: import("./directZoomFocus").CursorSampleLite[] | null;
	/** @deprecated Ignored — brain uses chatModelConfig from OpenScreen Chat. */
	provider?: { providerId?: string } | null;
	/** Selected OpenScreen Chat provider/model (same as invokeOpenScreenAgent). */
	chatModelConfig?: OpenScreenChatModelConfig | null;
	/** Optional precomputed visual-change intervals (tests / fixtures). */
	visualChangeEvents?: VisualChangeIntervalLite[] | null;
	/** Skip disk visual analysis (wiring fixtures with /tmp media). */
	skipVisualAnalysis?: boolean;
	/** Test seam: OCR for event identity (or production uses platform OCR). */
	ocrRecognize?: (imagePath: string) => Promise<{ text: string; available: boolean }>;
	/** Force-skip identity OCR (wiring only — never product path). */
	skipIdentity?: boolean;
	/** Injected vision judge for identity tests. */
	visionJudge?: import("./semanticEventVisionIdentity").VisionIdentityJudge | null;
	presenceJudge?: import("./semanticEventVisionIdentity").VisualPresenceJudge | null;
	skipVision?: boolean;
}): Promise<LocalEditorialControlResult> {
	const classified = promoteTransitionFollowUpFromDocument(
		promoteCalloutFollowUpFromDocument(
			promoteTitleFollowUpFromDocument(
				promoteCaptionFollowUpFromDocument(
					promoteSpeedFollowUpFromDocument(
						classifyLocalEditorialTurn(args.userMessage, args.projectId),
						args.document,
						args.userMessage,
					),
					args.document,
					args.userMessage,
				),
				args.document,
				args.userMessage,
			),
			args.document,
			args.userMessage,
		),
		args.document,
		args.userMessage,
	);

	const classifiedFamily = skillFamilyFromResolved(classified);
	const needsAsyncWhere =
		Boolean(classified.semanticEventCue) &&
		missingApplyRange(classified) &&
		(familyNeedsEvidenceWhere(classifiedFamily) || classifiedFamily === "captions");

	const needsBrain =
		classified.executionKind === "semantic_understanding" ||
		classified.parseStatus === "UNRESOLVED" ||
		classified.requiresSemanticReasoning ||
		classified.constraints.includes("ADVICE_ONLY") ||
		// Parse may already know SPEED/TRIM/… but still lacks a time range —
		// selected AI (or injected brain) must still run so WHERE can ground.
		needsAsyncWhere;

	/**
	 * Deterministic fast path only for obvious local commands (timed/direct).
	 * Named-event time targets always take the async WHERE path — never hand
	 * range=null to a frozen executor.
	 */
	if (!needsBrain) {
		return applyLocalEditorialControl({
			...args,
			resolvedRequest: classified,
		});
	}

	const session = getLocalEditorialSession(args.projectId);
	const beforeFp = fingerprintDocument(args.document).value;
	const pending = session.pendingProposal;
	if (
		pending &&
		pending.documentFingerprint &&
		pending.documentFingerprint !== beforeFp &&
		pending.status !== "EXECUTED"
	) {
		pending.status = "STALE";
	}

	// Confirm/proceed against a stale proposal must not mutate or re-ask AI WHAT.
	if (
		pending &&
		pending.status === "STALE" &&
		(isBareAffirmation(args.userMessage) || isVerbalProceed(args.userMessage))
	) {
		return {
			handled: true,
			request: {
				...classified,
				authority: "USER_CONFIRMED",
				semanticGoal: "CONFIRM_PENDING",
			},
			document: args.document,
			mutated: false,
			userFacingText:
				"The pending suggestion is stale because the project changed. Ask me again and I’ll re-ground it.",
			cloudCalls: 0,
			needsProfessionalOrchestrator: false,
			durationDecision: null,
			documentFingerprintBefore: beforeFp,
			documentFingerprintAfter: beforeFp,
			families: [],
			providerCalls: 0,
			understandingProviderId: null,
			understandingLatencyMs: 0,
			outcomeKind: "STALE_PENDING",
		};
	}

	const relativeIntensity: "stronger" | "weaker" | null =
		/\bweaker\b|\bless\s+aggressive\b|\ba\s+bit\s+less\b/i.test(args.userMessage)
			? "weaker"
			: /\bstronger\b|\bharder\b|\bmore\s+aggressive\b|\ba\s+bit\s+more\b|\bpush\b.+\bzoom\b/i.test(
						args.userMessage,
					)
				? "stronger"
				: null;

	const t0 = Date.now();
	const semantic = await understandSemanticRequest({
		ctx: {
			userMessage: args.userMessage,
			pending: session.pendingProposal,
			lastAssistantDecision: session.lastAssistantDecision,
			committedFamilies: session.committedOperations,
			documentFingerprint: beforeFp,
			programmeDurationSec: session.currentProgrammeDurationSec,
			hasTranscript: Boolean(args.document.transcripts?.length || args.document.transcript),
			hasCursor: Boolean(args.cursorSamples?.length),
		},
		chatModelConfig: args.chatModelConfig ?? null,
		relativeIntensity,
		isBareOrProceed: isBareAffirmation(args.userMessage) || isVerbalProceed(args.userMessage),
	});
	const understandingMs = Date.now() - t0;

	if (semantic.parseStatus === "UNRESOLVED" || semantic.goal === "UNKNOWN") {
		session.lastWithheldReason = semantic.unresolvedReason;
		return {
			handled: true,
			request: {
				...classified,
				parseStatus: "UNRESOLVED",
				semanticSkillRequest: semantic,
				authority: semantic.authority,
				semanticGoal: semantic.goal,
			},
			document: args.document,
			mutated: false,
			userFacingText:
				semantic.unresolvedReason ?? "I could not confidently understand that edit request yet.",
			cloudCalls: semantic.cloudCalls,
			needsProfessionalOrchestrator: false,
			durationDecision: null,
			documentFingerprintBefore: beforeFp,
			documentFingerprintAfter: beforeFp,
			families: [],
			providerCalls: semantic.providerCalls,
			understandingProviderId: semantic.providerId,
			understandingLatencyMs: understandingMs,
			outcomeKind: "UNDERSTANDING_FAILED",
		};
	}

	if (semantic.goal === "REJECT_PENDING") {
		clearLocalEditorialPendingProposal(args.projectId);
		return {
			handled: true,
			request: applySemanticToLocalRequest(classified, semantic),
			document: args.document,
			mutated: false,
			userFacingText: "Okay — I cancelled the pending suggestion. Tell me what you’d like instead.",
			cloudCalls: semantic.cloudCalls,
			needsProfessionalOrchestrator: false,
			durationDecision: null,
			documentFingerprintBefore: beforeFp,
			documentFingerprintAfter: beforeFp,
			families: [],
			providerCalls: semantic.providerCalls,
			understandingProviderId: semantic.providerId,
			understandingLatencyMs: understandingMs,
			outcomeKind: "REJECTED_PENDING",
		};
	}

	let resolved = applySemanticToLocalRequest(classified, semantic);

	// Retarget: new semantic event while pending existed — keep AI WHAT skill, re-ground WHERE.
	if (
		semantic.goal === "MODIFY_PENDING" &&
		semantic.target.type === "SEMANTIC_EVENT" &&
		semantic.target.semanticEvent
	) {
		const retargetFamily = skillFamilyFromResolved(resolved);
		resolved = {
			...resolved,
			intent: retargetFamily ? executeIntentForFamily(retargetFamily, resolved) : resolved.intent,
			executionKind: "direct_document",
			zoomAuthorization: retargetFamily === "zoom" ? "execute" : null,
			authority: "USER_EXPLICIT",
			semanticEventCue: semantic.target.semanticEvent,
			range: null,
			routeClass: "LOCAL_RESOLVED",
			constraints: resolved.constraints.filter((c) => c !== "ADVICE_ONLY"),
		};
		clearLocalEditorialPendingProposal(args.projectId);
	} else if (
		(semantic.goal === "CONFIRM_PENDING" || semantic.goal === "MODIFY_PENDING") &&
		session.pendingProposal
	) {
		const p = session.pendingProposal;
		if (p.documentFingerprint !== beforeFp) {
			return {
				handled: true,
				request: resolved,
				document: args.document,
				mutated: false,
				userFacingText:
					"The pending suggestion is stale because the project changed. Ask me again and I’ll re-ground it.",
				cloudCalls: semantic.cloudCalls,
				needsProfessionalOrchestrator: false,
				durationDecision: null,
				documentFingerprintBefore: beforeFp,
				documentFingerprintAfter: beforeFp,
				families: [],
				providerCalls: semantic.providerCalls,
				understandingProviderId: semantic.providerId,
				understandingLatencyMs: understandingMs,
				outcomeKind: "STALE_PENDING",
			};
		}
		const execIntent = pendingExecuteIntent(p);
		const zoomExec = isZoomExecuteIntent(execIntent);
		const nextDepth = zoomExec
			? semantic.modification?.intensity === "stronger"
				? (Math.min(6, (p.zoomDepth ?? 3) + 1) as 1 | 2 | 3 | 4 | 5 | 6)
				: semantic.modification?.intensity === "weaker"
					? (Math.max(1, (p.zoomDepth ?? 3) - 1) as 1 | 2 | 3 | 4 | 5 | 6)
					: (p.zoomDepth ?? resolved.zoomDepth)
			: resolved.zoomDepth;
		const nearTs = p.parameters?.nearTimestamp === true;
		const transitionKindOnConfirm: "cut" | "dissolve" | null =
			p.parameters?.transitionKind ??
			resolved.transitionKind ??
			(p.kind === "advice_transition" ? "dissolve" : null);
		// Frozen transition HOW phrases the raw turn; "yes" alone is unsupported there.
		// Confirm carries the stored kind as an explicit apply phrase without re-WHERE.
		const confirmRawText =
			execIntent === "TRANSITION" || execIntent === "ADJUST_TRANSITION"
				? transitionKindOnConfirm === "cut"
					? "Add a cut transition at the join"
					: "Add a dissolve transition at the join"
				: resolved.rawText;
		resolved = {
			...resolved,
			intent: execIntent,
			rawText: confirmRawText,
			range: p.range
				? {
						startSec: p.range.startSec,
						endSec: nearTs ? p.range.startSec : p.range.endSec,
						...(nearTs ? { nearTimestamp: true as const, singleTimestamp: true as const } : {}),
					}
				: resolved.range,
			// Consume stored WHERE — never re-ground on confirm.
			semanticEventCue: null,
			zoomDepth: nextDepth,
			titleText: p.parameters?.titleText ?? resolved.titleText,
			calloutText: p.parameters?.calloutText ?? resolved.calloutText,
			speedMultiplier: p.parameters?.speedMultiplier ?? resolved.speedMultiplier,
			transitionKind: transitionKindOnConfirm,
			authority: "USER_CONFIRMED",
			executionKind: "direct_document",
			zoomAuthorization: zoomExec ? "execute" : null,
			requestedFamilies: p.families.length > 0 ? p.families : resolved.requestedFamilies,
			constraints: resolved.constraints.filter((c) => c !== "ADVICE_ONLY"),
			referencedPreviousEdit: zoomExec
				? "last_zoom"
				: execIntent === "CALLOUT" || execIntent === "ADJUST_CALLOUT"
					? "last_callout"
					: execIntent === "TITLE" || execIntent === "ADJUST_TITLE"
						? "last_title"
						: execIntent === "SPEED_UP" || execIntent === "SLOW_DOWN"
							? "last_speed"
							: execIntent === "REMOVE_RANGE"
								? "last_trim"
								: execIntent === "TRANSITION" || execIntent === "ADJUST_TRANSITION"
									? "last_transition"
									: resolved.referencedPreviousEdit,
			semanticSkillRequest: p.semanticSkillRequest ?? resolved.semanticSkillRequest,
		};

		if (
			execIntent === "TRANSITION" ||
			execIntent === "ADJUST_TRANSITION" ||
			p.kind === "advice_transition"
		) {
			const joinSec =
				p.parameters?.joinProgrammeSec ?? p.range?.startSec ?? resolved.range?.startSec;
			if (typeof joinSec !== "number" || !Number.isFinite(joinSec)) {
				return {
					handled: true,
					request: resolved,
					document: args.document,
					mutated: false,
					userFacingText:
						"The pending transition has no stored join. Ask me again and I’ll re-ground it.",
					cloudCalls: semantic.cloudCalls,
					needsProfessionalOrchestrator: false,
					durationDecision: null,
					documentFingerprintBefore: beforeFp,
					documentFingerprintAfter: beforeFp,
					families: ["transitions"],
					providerCalls: semantic.providerCalls,
					understandingProviderId: semantic.providerId,
					understandingLatencyMs: understandingMs,
					outcomeKind: "STALE_PENDING",
				};
			}
			const valid = transitionJoinStillValid(
				args.document,
				joinSec,
				p.parameters?.transitionClipId ?? null,
			);
			if (!valid.ok) {
				clearLocalEditorialPendingProposal(args.projectId);
				return {
					handled: true,
					request: resolved,
					document: args.document,
					mutated: false,
					userFacingText: valid.reason,
					cloudCalls: semantic.cloudCalls,
					needsProfessionalOrchestrator: false,
					durationDecision: null,
					documentFingerprintBefore: beforeFp,
					documentFingerprintAfter: beforeFp,
					families: ["transitions"],
					providerCalls: semantic.providerCalls,
					understandingProviderId: semantic.providerId,
					understandingLatencyMs: understandingMs,
					outcomeKind: "STALE_PENDING",
				};
			}
			resolved = {
				...resolved,
				range: {
					startSec: valid.programmeJoinSec,
					endSec: valid.programmeJoinSec,
					nearTimestamp: true,
					singleTimestamp: true,
				},
			};
		}
	}

	const isAdvice = resolved.constraints.includes("ADVICE_ONLY");
	const skillFamily = skillFamilyFromResolved(resolved);

	// Captions enable/style are whole-programme (or anaphoric) — not moment-bound in V1.
	if (
		skillFamily === "captions" &&
		Boolean(resolved.semanticEventCue) &&
		missingApplyRange(resolved)
	) {
		return {
			handled: true,
			request: resolved,
			document: args.document,
			mutated: false,
			userFacingText: isAdvice
				? "Captions in V1 are whole-transcript (enable/style/correct), not bound to a named on-screen moment — I can’t store a confirmable timed caption proposal for that event. Ask to enable captions, or use a timed skill (zoom/speed/trim/callout/title)."
				: "Captions in V1 are whole-transcript — I can’t apply enable/style to a named on-screen moment. Say “enable captions” without a moment, or choose a timed skill.",
			cloudCalls: semantic.cloudCalls,
			needsProfessionalOrchestrator: false,
			durationDecision: null,
			documentFingerprintBefore: beforeFp,
			documentFingerprintAfter: beforeFp,
			families: ["captions"],
			providerCalls: semantic.providerCalls,
			understandingProviderId: semantic.providerId,
			understandingLatencyMs: understandingMs,
			outcomeKind: "ADVISORY",
		};
	}

	const needsWhere =
		Boolean(resolved.semanticEventCue) &&
		familyNeedsEvidenceWhere(skillFamily) &&
		(isAdvice || missingApplyRange(resolved)) &&
		!isConfirmedGroundedPending(resolved);

	let visualLoad: {
		intervals: VisualChangeIntervalLite[] | null;
		used: boolean;
	} = {
		intervals: args.visualChangeEvents ?? null,
		used: Boolean(args.visualChangeEvents?.length),
	};

	if (needsWhere) {
		visualLoad = await ensureVisualIntervalsForSemanticWhere({
			document: args.document,
			semanticEventCue: resolved.semanticEventCue ?? semantic.target.semanticEvent,
			visualChangeEvents: args.visualChangeEvents,
			skipVisualAnalysis: args.skipVisualAnalysis ?? false,
		});

		const cue =
			resolved.semanticEventCue ??
			semantic.target.semanticEvent ??
			"when the described moment happens";
		let samples = args.cursorSamples ?? null;
		if (!samples?.length) {
			const media =
				args.document.assets.find((a) => a.id === args.document.project.primaryAssetId)
					?.originalPath ??
				args.document.assets[0]?.originalPath ??
				null;
			samples = loadCursorSamplesFromSidecar(media);
		}

		const grounded = await resolveSemanticEditEventAsync({
			cue,
			document: args.document,
			cursorSamples: samples,
			preferredFamily: skillFamily === "zoom" ? "zoom" : "generic",
			visualChangeEvents: visualLoad.intervals,
			skipVisualAnalysis: true,
			skipIdentity: args.skipIdentity === true,
			ocrRecognize: args.ocrRecognize,
			chatModelConfig: args.chatModelConfig ?? null,
			visionJudge: args.visionJudge,
			presenceJudge: args.presenceJudge,
			skipVision: args.skipVision,
		});

		const notGroundedReturn = () => ({
			handled: true as const,
			request: resolved,
			document: args.document,
			mutated: false,
			userFacingText: grounded.userFacingReason,
			cloudCalls: semantic.cloudCalls,
			needsProfessionalOrchestrator: false,
			durationDecision: null,
			documentFingerprintBefore: beforeFp,
			documentFingerprintAfter: beforeFp,
			families: [] as EditFamilyRequest[],
			providerCalls: semantic.providerCalls,
			understandingProviderId: semantic.providerId,
			understandingLatencyMs: understandingMs,
			outcomeKind:
				grounded.status === "AMBIGUOUS" ? ("AMBIGUOUS" as const) : ("NOT_FOUND" as const),
		});

		if (isAdvice) {
			const sessionAdv = getLocalEditorialSession(args.projectId);
			if (!(grounded.status === "FOUND" && grounded.best)) {
				return notGroundedReturn();
			}
			const best = grounded.best;

			if (!familySupportsAdvicePending(skillFamily) || skillFamily == null) {
				return {
					handled: true,
					request: resolved,
					document: args.document,
					mutated: false,
					userFacingText:
						skillFamily === "captions"
							? "Captions in V1 are whole-transcript — I can’t store a confirmable timed caption proposal for that event."
							: `I'd consider a ${skillFamily ?? "registered"} edit once that family can store a confirmable proposal in V1. Nothing was changed.`,
					cloudCalls: semantic.cloudCalls,
					needsProfessionalOrchestrator: false,
					durationDecision: null,
					documentFingerprintBefore: beforeFp,
					documentFingerprintAfter: beforeFp,
					families: skillFamily ? [skillFamily as EditFamilyRequest] : [],
					providerCalls: semantic.providerCalls,
					understandingProviderId: semantic.providerId,
					understandingLatencyMs: understandingMs,
					outcomeKind: "ADVISORY",
				};
			}

			if (skillFamily === "callout" || skillFamily === "title") {
				const overlay = adviceOverlayText({
					family: skillFamily,
					modificationText: semantic.modification?.text,
					cue,
				});
				setLocalEditorialPendingProposal(args.projectId, {
					kind: skillFamily === "callout" ? "advice_callout" : "advice_title",
					summary: `${skillFamily} ${best.startSec.toFixed(1)}s–${best.endSec.toFixed(1)}s programme at ${cue}`,
					documentFingerprint: beforeFp,
					createdAtIso: new Date().toISOString(),
					range: { startSec: best.startSec, endSec: best.endSec },
					zoomDepth: null,
					evidenceRefs: [
						...best.evidenceRefs,
						`semantic_playback_anchor@${best.anchorSec.toFixed(2)}`,
						`range_clock:programme`,
					],
					planFingerprint: null,
					families: [skillFamily],
					semanticEventCue: cue,
					semanticSkillRequest: semantic,
					requiresConfirmation: true,
					status: "PROPOSED",
					parameters: {
						executeIntent: executeIntentForFamily(skillFamily, resolved),
						calloutText: skillFamily === "callout" ? overlay : null,
						titleText: skillFamily === "title" ? overlay : null,
						rangeClock: "programme",
					},
				});
				sessionAdv.lastAssistantDecision = `propose ${skillFamily} @ ${best.anchorSec.toFixed(1)}s programme`;
				return {
					handled: true,
					request: resolved,
					document: args.document,
					mutated: false,
					userFacingText: `I'd add a ${skillFamily} around ${best.anchorSec.toFixed(1)}s (${best.label}; requested event identified). Say “yes” or “go ahead” and I'll apply it. Nothing was changed.`,
					cloudCalls: semantic.cloudCalls,
					needsProfessionalOrchestrator: false,
					durationDecision: null,
					documentFingerprintBefore: beforeFp,
					documentFingerprintAfter: beforeFp,
					families: [skillFamily],
					providerCalls: semantic.providerCalls,
					understandingProviderId: semantic.providerId,
					understandingLatencyMs: understandingMs,
					outcomeKind: "ADVISORY",
				};
			}

			if (skillFamily === "speed" || skillFamily === "trim") {
				const execIntent = executeIntentForFamily(skillFamily, resolved);
				const rate =
					skillFamily === "speed"
						? typeof resolved.speedMultiplier === "number" && resolved.speedMultiplier > 0
							? resolved.speedMultiplier
							: (semantic.modification?.multiplier ?? (execIntent === "SLOW_DOWN" ? 0.75 : 1.5))
						: null;
				setLocalEditorialPendingProposal(args.projectId, {
					kind: skillFamily === "speed" ? "advice_speed" : "advice_trim",
					summary: `${skillFamily} ${best.startSec.toFixed(1)}s–${best.endSec.toFixed(1)}s programme at ${cue}`,
					documentFingerprint: beforeFp,
					createdAtIso: new Date().toISOString(),
					range: { startSec: best.startSec, endSec: best.endSec },
					zoomDepth: null,
					evidenceRefs: [
						...best.evidenceRefs,
						`semantic_playback_anchor@${best.anchorSec.toFixed(2)}`,
						`range_clock:programme`,
					],
					planFingerprint: null,
					families: [skillFamily],
					semanticEventCue: cue,
					semanticSkillRequest: semantic,
					requiresConfirmation: true,
					status: "PROPOSED",
					parameters: {
						executeIntent: execIntent,
						speedMultiplier: rate,
						rangeClock: "programme",
					},
				});
				sessionAdv.lastAssistantDecision = `propose ${skillFamily} @ ${best.anchorSec.toFixed(1)}s programme`;
				const verb =
					skillFamily === "speed"
						? execIntent === "SLOW_DOWN"
							? "slow down"
							: "speed up"
						: "trim";
				return {
					handled: true,
					request: resolved,
					document: args.document,
					mutated: false,
					userFacingText: `I'd ${verb} ${best.startSec.toFixed(1)}s–${best.endSec.toFixed(1)}s (${best.label}; requested event identified). Say “yes” or “go ahead” and I'll apply it. Nothing was changed.`,
					cloudCalls: semantic.cloudCalls,
					needsProfessionalOrchestrator: false,
					durationDecision: null,
					documentFingerprintBefore: beforeFp,
					documentFingerprintAfter: beforeFp,
					families: [skillFamily],
					providerCalls: semantic.providerCalls,
					understandingProviderId: semantic.providerId,
					understandingLatencyMs: understandingMs,
					outcomeKind: "ADVISORY",
				};
			}

			if (skillFamily === "transitions") {
				const join = nearestTransitionJoin({
					document: args.document,
					programmeSec: best.anchorSec,
				});
				if (!join) {
					return {
						handled: true,
						request: resolved,
						document: args.document,
						mutated: false,
						userFacingText:
							"I found that moment, but transitions only apply at clip joins — there isn’t a join near the event to propose. Nothing was changed.",
						cloudCalls: semantic.cloudCalls,
						needsProfessionalOrchestrator: false,
						durationDecision: null,
						documentFingerprintBefore: beforeFp,
						documentFingerprintAfter: beforeFp,
						families: ["transitions"],
						providerCalls: semantic.providerCalls,
						understandingProviderId: semantic.providerId,
						understandingLatencyMs: understandingMs,
						outcomeKind: "ADVISORY",
					};
				}
				setLocalEditorialPendingProposal(args.projectId, {
					kind: "advice_transition",
					summary: `transition near join @ ${join.programmeJoinSec.toFixed(1)}s (event ${cue})`,
					documentFingerprint: beforeFp,
					createdAtIso: new Date().toISOString(),
					range: {
						startSec: join.programmeJoinSec,
						endSec: join.programmeJoinSec,
					},
					zoomDepth: null,
					evidenceRefs: [
						...best.evidenceRefs,
						`semantic_playback_anchor@${best.anchorSec.toFixed(2)}`,
						`transition_join@${join.programmeJoinSec.toFixed(2)}`,
						`transition_clip:${join.clipId}`,
						`range_clock:programme`,
					],
					planFingerprint: null,
					families: ["transitions"],
					semanticEventCue: cue,
					semanticSkillRequest: semantic,
					requiresConfirmation: true,
					status: "PROPOSED",
					parameters: {
						executeIntent: "TRANSITION",
						rangeClock: "programme",
						nearTimestamp: true,
						transitionClipId: join.clipId,
						joinProgrammeSec: join.programmeJoinSec,
						transitionKind: "dissolve",
					},
				});
				sessionAdv.lastAssistantDecision = `propose transition @ join ${join.programmeJoinSec.toFixed(1)}s`;
				return {
					handled: true,
					request: resolved,
					document: args.document,
					mutated: false,
					userFacingText: `I'd add a transition at the clip join near ${join.programmeJoinSec.toFixed(1)}s (${best.label}; requested event identified). Say “yes” or “go ahead” and I'll apply it. Nothing was changed.`,
					cloudCalls: semantic.cloudCalls,
					needsProfessionalOrchestrator: false,
					durationDecision: null,
					documentFingerprintBefore: beforeFp,
					documentFingerprintAfter: beforeFp,
					families: ["transitions"],
					providerCalls: semantic.providerCalls,
					understandingProviderId: semantic.providerId,
					understandingLatencyMs: understandingMs,
					outcomeKind: "ADVISORY",
				};
			}

			// Zoom advice: convert programme → Zoom RAW before pending.
			const zoomRange = playbackRangeToZoomRawRange(args.document, best.startSec, best.endSec);
			if (!zoomRange) {
				return {
					handled: true,
					request: resolved,
					document: args.document,
					mutated: false,
					userFacingText:
						"I found the event on the programme clock but could not map it onto the timeline ruler Zoom uses. Try again after undoing trims, or scrub to the moment and ask to zoom there.",
					cloudCalls: semantic.cloudCalls,
					needsProfessionalOrchestrator: false,
					durationDecision: null,
					documentFingerprintBefore: beforeFp,
					documentFingerprintAfter: beforeFp,
					families: [],
					providerCalls: semantic.providerCalls,
					understandingProviderId: semantic.providerId,
					understandingLatencyMs: understandingMs,
					outcomeKind: "AMBIGUOUS",
				};
			}
			const rawAnchor =
				playbackPointToRawTimelineSec(args.document, best.anchorSec) ?? zoomRange.startSec;
			setLocalEditorialPendingProposal(args.projectId, {
				kind: "advice_zoom",
				summary: `Zoom ${zoomRange.startSec.toFixed(1)}s–${zoomRange.endSec.toFixed(1)}s at ${cue}`,
				documentFingerprint: beforeFp,
				createdAtIso: new Date().toISOString(),
				range: zoomRange,
				zoomDepth: 3,
				evidenceRefs: [
					...best.evidenceRefs,
					`semantic_playback_anchor@${best.anchorSec.toFixed(2)}`,
					`zoom_raw_anchor@${rawAnchor.toFixed(2)}`,
					`range_clock:raw`,
				],
				planFingerprint: null,
				families: ["zoom"],
				semanticEventCue: cue,
				semanticSkillRequest: semantic,
				requiresConfirmation: true,
				status: "PROPOSED",
				parameters: {
					zoomDepth: 3,
					executeIntent: "ADD_ZOOM",
					rangeClock: "raw",
				},
			});
			sessionAdv.lastAssistantDecision = `propose zoom @ ${rawAnchor.toFixed(1)}s raw`;
			const progDur = programmeDurationSec(args.document);
			const rawDur = rawTimelineDurationSec(args.document);
			const assetDur =
				args.document.assets.find((a) => a.id === args.document.project.primaryAssetId)
					?.durationSec ??
				args.document.assets[0]?.durationSec ??
				null;
			const clocksDiverge = progDur > 0 && rawDur > 0 && Math.abs(rawDur - progDur) > 0.5;
			const clockHint = clocksDiverge
				? ` ruler ${rawAnchor.toFixed(1)}s / ${rawDur.toFixed(1)}s raw (playback programme ${best.anchorSec.toFixed(1)}s / ${progDur.toFixed(1)}s; source media ${Number(assetDur ?? rawDur).toFixed(1)}s)`
				: "";
			return {
				handled: true,
				request: resolved,
				document: args.document,
				mutated: false,
				userFacingText: `I'd zoom in around ${rawAnchor.toFixed(1)}s${clockHint} (${best.label}; requested event identified). Say “yes” or “go ahead” and I'll apply it.`,
				cloudCalls: semantic.cloudCalls,
				needsProfessionalOrchestrator: false,
				durationDecision: null,
				documentFingerprintBefore: beforeFp,
				documentFingerprintAfter: beforeFp,
				families: ["zoom"],
				providerCalls: semantic.providerCalls,
				understandingProviderId: semantic.providerId,
				understandingLatencyMs: understandingMs,
				outcomeKind: "ADVISORY",
			};
		}

		// Explicit (non-advice) time-target skills: ground before frozen HOW.
		if (!(grounded.status === "FOUND" && grounded.best)) {
			return notGroundedReturn();
		}
		const best = grounded.best;

		if (skillFamily === "zoom") {
			const zoomRange = playbackRangeToZoomRawRange(args.document, best.startSec, best.endSec);
			if (!zoomRange) {
				return {
					handled: true,
					request: resolved,
					document: args.document,
					mutated: false,
					userFacingText:
						"I found the event on the programme clock but could not map it onto the timeline ruler Zoom uses.",
					cloudCalls: semantic.cloudCalls,
					needsProfessionalOrchestrator: false,
					durationDecision: null,
					documentFingerprintBefore: beforeFp,
					documentFingerprintAfter: beforeFp,
					families: [],
					providerCalls: semantic.providerCalls,
					understandingProviderId: semantic.providerId,
					understandingLatencyMs: understandingMs,
					outcomeKind: "AMBIGUOUS",
				};
			}
			resolved = {
				...resolved,
				range: zoomRange,
				semanticEventCue: cue,
			};
		} else if (skillFamily === "callout" || skillFamily === "title") {
			resolved = {
				...resolved,
				range: { startSec: best.startSec, endSec: best.endSec },
				semanticEventCue: cue,
				calloutText:
					skillFamily === "callout"
						? (resolved.calloutText ??
							adviceOverlayText({
								family: "callout",
								modificationText: semantic.modification?.text,
								cue,
							}))
						: resolved.calloutText,
				titleText:
					skillFamily === "title"
						? (resolved.titleText ??
							adviceOverlayText({
								family: "title",
								modificationText: semantic.modification?.text,
								cue,
							}))
						: resolved.titleText,
			};
		} else if (skillFamily === "speed" || skillFamily === "trim") {
			resolved = {
				...resolved,
				range: { startSec: best.startSec, endSec: best.endSec },
				semanticEventCue: cue,
				intent: executeIntentForFamily(skillFamily, resolved),
				executionKind: "direct_document",
			};
		} else if (skillFamily === "transitions") {
			const join = nearestTransitionJoin({
				document: args.document,
				programmeSec: best.anchorSec,
			});
			if (!join) {
				return {
					handled: true,
					request: resolved,
					document: args.document,
					mutated: false,
					userFacingText:
						"I found that moment, but transitions only apply at clip joins — there isn’t a join near the event. Split the timeline or name a join explicitly.",
					cloudCalls: semantic.cloudCalls,
					needsProfessionalOrchestrator: false,
					durationDecision: null,
					documentFingerprintBefore: beforeFp,
					documentFingerprintAfter: beforeFp,
					families: ["transitions"],
					providerCalls: semantic.providerCalls,
					understandingProviderId: semantic.providerId,
					understandingLatencyMs: understandingMs,
					outcomeKind: "NOT_FOUND",
				};
			}
			resolved = {
				...resolved,
				range: {
					startSec: join.programmeJoinSec,
					endSec: join.programmeJoinSec,
					nearTimestamp: true,
					singleTimestamp: true,
				},
				semanticEventCue: cue,
				intent: "TRANSITION",
				executionKind: "direct_document",
			};
		}
	}

	const applied = applyLocalEditorialControl({
		...args,
		resolvedRequest: resolved,
		visualChangeEvents: visualLoad.intervals,
		visualAnalysisUsed: visualLoad.used,
	});
	return {
		...applied,
		providerCalls: (applied.providerCalls ?? 0) + semantic.providerCalls,
		cloudCalls: applied.cloudCalls + semantic.cloudCalls,
		understandingProviderId: semantic.providerId,
		understandingLatencyMs: understandingMs,
		request: {
			...applied.request,
			semanticSkillRequest: semantic,
			authority: resolved.authority,
			semanticGoal: resolved.semanticGoal,
			parseStatus: semantic.parseStatus,
		},
	};
}

async function ensureVisualIntervalsForSemanticWhere(args: {
	document: AxcutDocument;
	semanticEventCue: string | null | undefined;
	visualChangeEvents?: VisualChangeIntervalLite[] | null;
	skipVisualAnalysis?: boolean;
}): Promise<{ intervals: VisualChangeIntervalLite[] | null; used: boolean }> {
	if (args.visualChangeEvents != null) {
		return { intervals: args.visualChangeEvents, used: args.visualChangeEvents.length > 0 };
	}
	if (args.skipVisualAnalysis) {
		return { intervals: null, used: false };
	}
	const loaded = await loadVisualChangeIntervalsForDocument(args.document);
	return { intervals: loaded.intervals, used: loaded.used };
}

function applyResolvedLocalEditorialControl(args: {
	projectId: string;
	document: AxcutDocument;
	userMessage: string;
	assetId?: string | null;
	cursorSamples?: import("./directZoomFocus").CursorSampleLite[] | null;
	request: LocalEditorialRequestV1;
	visualChangeEvents?: VisualChangeIntervalLite[] | null;
	visualAnalysisUsed?: boolean;
	identityByAnchorSec?: Map<
		number,
		{
			requestedEventIdentified: boolean;
			visualChangeObserved: boolean;
			evidenceRefs: string[];
			onsetTokens: string[];
		}
	> | null;
	identityChecked?: boolean;
}): LocalEditorialControlResult {
	const request = args.request;
	const beforeFp = fingerprintDocument(args.document).value;
	const documentBefore = structuredClone(args.document);

	applyRequestToLocalEditorialSession(args.projectId, request);

	// Explicit caption enable: direct when transcript exists; else orch after STT.
	if (request.intent === "ENABLE_CAPTIONS") {
		const direct = applyLocalDirectDocumentEdit({
			document: args.document,
			request: { ...request, intent: "ENABLE_CAPTIONS", executionKind: "direct_document" },
		});
		if (direct.mutated || /already enabled/i.test(direct.userFacingText)) {
			const afterFp = fingerprintDocument(direct.document).value;
			if (direct.mutated) {
				pushLocalEditorialRevision({
					projectId: args.projectId,
					assetId: args.assetId ?? null,
					prompt: args.userMessage,
					intent: request.intent,
					documentBefore,
					committedFamilies: direct.families,
					userFacingText: direct.userFacingText,
				});
			}
			return {
				handled: true,
				request: { ...request, executionKind: "direct_document" },
				document: direct.document,
				mutated: direct.mutated,
				userFacingText: direct.userFacingText,
				cloudCalls: 0,
				needsProfessionalOrchestrator: false,
				durationDecision: null,
				documentFingerprintBefore: beforeFp,
				documentFingerprintAfter: afterFp,
				families: direct.families,
			};
		}
		// No transcript yet — force captions-only orch after STT prep in Chat service.
		return {
			handled: true,
			request: {
				...request,
				executionKind: "professional_orchestrator",
				orchestratorMessage:
					request.orchestratorMessage ??
					"Enable captions / subtitles from the transcript on this recording. Do not invent other edits. You decide. Proceed.",
				localCapabilityAvailable: true,
				routeClass: "LOCAL_RESOLVED",
			},
			document: args.document,
			mutated: false,
			userFacingText: "",
			cloudCalls: 0,
			needsProfessionalOrchestrator: true,
			durationDecision: null,
			documentFingerprintBefore: beforeFp,
			documentFingerprintAfter: beforeFp,
			families: [],
		};
	}

	if (request.executionKind === "constraint_only") {
		const session = getLocalEditorialSession(args.projectId);
		// Advice-only: propose a grounded zoom without mutating; await confirmation.
		if (request.constraints.includes("ADVICE_ONLY")) {
			// Sync path cannot run provider presence. Without precomputed identity /
			// visual intervals, refuse honestly rather than claiming frames unavailable.
			if (
				!args.identityChecked &&
				!(args.visualChangeEvents && args.visualChangeEvents.length > 0) &&
				!args.visualAnalysisUsed
			) {
				return {
					handled: true,
					request,
					document: args.document,
					mutated: false,
					userFacingText:
						"This advisory needs visual grounding (analysis + presence). Send it again in OpenScreen Chat so I can inspect the recording.",
					cloudCalls: 0,
					needsProfessionalOrchestrator: false,
					durationDecision: null,
					documentFingerprintBefore: beforeFp,
					documentFingerprintAfter: beforeFp,
					families: [],
					outcomeKind: "NOT_FOUND",
				};
			}
			let samples = args.cursorSamples ?? null;
			if (!samples?.length) {
				const media =
					args.document.assets.find((a) => a.id === args.document.project.primaryAssetId)
						?.originalPath ??
					args.document.assets[0]?.originalPath ??
					null;
				samples = loadCursorSamplesFromSidecar(media);
			}
			const cue = request.semanticEventCue ?? "when the described moment happens";
			const resolved = resolveSemanticEditEvent({
				cue,
				document: args.document,
				cursorSamples: samples,
				preferredFamily: "zoom",
				visualChangeEvents: args.visualChangeEvents,
				visualAnalysisUsed: args.visualAnalysisUsed,
				identityByAnchorSec: args.identityByAnchorSec,
				identityChecked: args.identityChecked,
			});
			if (resolved.status === "FOUND" && resolved.best) {
				const best = resolved.best;
				if (!best.requestedEventIdentified && classifySemanticEventKind(cue) === "VISUAL_OR_UI") {
					return {
						handled: true,
						request,
						document: args.document,
						mutated: false,
						userFacingText:
							"I need frame identity evidence before proposing a zoom for that visual event. Ask again with the Chat path, or share an approximate time.",
						cloudCalls: 0,
						needsProfessionalOrchestrator: false,
						durationDecision: null,
						documentFingerprintBefore: beforeFp,
						documentFingerprintAfter: beforeFp,
						families: [],
					};
				}
				const identityNote = best.requestedEventIdentified
					? "requested event identified"
					: best.modalities.join("+");
				const zoomRange = playbackRangeToZoomRawRange(args.document, best.startSec, best.endSec);
				if (!zoomRange) {
					return {
						handled: true,
						request,
						document: args.document,
						mutated: false,
						userFacingText:
							"I found the event on the programme clock but could not map it onto the timeline ruler Zoom uses.",
						cloudCalls: 0,
						needsProfessionalOrchestrator: false,
						durationDecision: null,
						documentFingerprintBefore: beforeFp,
						documentFingerprintAfter: beforeFp,
						families: [],
					};
				}
				const rawAnchor =
					playbackPointToRawTimelineSec(args.document, best.anchorSec) ?? zoomRange.startSec;
				setLocalEditorialPendingProposal(args.projectId, {
					kind: "advice_zoom",
					summary: `Zoom ${zoomRange.startSec.toFixed(1)}s–${zoomRange.endSec.toFixed(1)}s at ${cue}`,
					documentFingerprint: beforeFp,
					createdAtIso: new Date().toISOString(),
					range: zoomRange,
					zoomDepth: 3,
					evidenceRefs: [
						...best.evidenceRefs,
						`semantic_playback_anchor@${best.anchorSec.toFixed(2)}`,
						`zoom_raw_anchor@${rawAnchor.toFixed(2)}`,
					],
					planFingerprint: null,
					families: ["zoom"],
					semanticEventCue: cue,
					requiresConfirmation: true,
					status: "PROPOSED",
					parameters: { zoomDepth: 3 },
				});
				session.lastAssistantDecision = `propose zoom @ ${rawAnchor.toFixed(1)}s raw`;
				const progDurAdvice = programmeDurationSec(args.document);
				const rawDurAdvice = rawTimelineDurationSec(args.document);
				const assetDurAdvice =
					args.document.assets.find((a) => a.id === args.document.project.primaryAssetId)
						?.durationSec ??
					args.document.assets[0]?.durationSec ??
					null;
				const clocksDivergeAdvice =
					progDurAdvice > 0 && rawDurAdvice > 0 && Math.abs(rawDurAdvice - progDurAdvice) > 0.5;
				const clockHintAdvice = clocksDivergeAdvice
					? ` ruler ${rawAnchor.toFixed(1)}s / ${rawDurAdvice.toFixed(1)}s raw (playback programme ${best.anchorSec.toFixed(1)}s / ${progDurAdvice.toFixed(1)}s; source media ${Number(assetDurAdvice ?? rawDurAdvice).toFixed(1)}s)`
					: "";
				return {
					handled: true,
					request,
					document: args.document,
					mutated: false,
					userFacingText: `I'd zoom in around ${rawAnchor.toFixed(1)}s${clockHintAdvice} (${best.label}; ${identityNote}). Say “yes” or “go ahead” and I'll apply it.`,
					cloudCalls: 0,
					needsProfessionalOrchestrator: false,
					durationDecision: null,
					documentFingerprintBefore: beforeFp,
					documentFingerprintAfter: beforeFp,
					families: [],
				};
			}
			if (resolved.status === "AMBIGUOUS") {
				return {
					handled: true,
					request,
					document: args.document,
					mutated: false,
					userFacingText: resolved.userFacingReason,
					cloudCalls: 0,
					needsProfessionalOrchestrator: false,
					durationDecision: null,
					documentFingerprintBefore: beforeFp,
					documentFingerprintAfter: beforeFp,
					families: [],
				};
			}
			return {
				handled: true,
				request,
				document: args.document,
				mutated: false,
				userFacingText: resolved.userFacingReason,
				cloudCalls: 0,
				needsProfessionalOrchestrator: false,
				durationDecision: null,
				documentFingerprintBefore: beforeFp,
				documentFingerprintAfter: beforeFp,
				families: [],
			};
		}
		return {
			handled: true,
			request,
			document: args.document,
			mutated: false,
			userFacingText: `I'll keep that constraint for the next local edit (${session.preserve.join(", ") || "preserve noted"}).`,
			cloudCalls: 0,
			needsProfessionalOrchestrator: false,
			durationDecision: null,
			documentFingerprintBefore: beforeFp,
			documentFingerprintAfter: beforeFp,
			families: [],
		};
	}

	if (
		request.executionKind === "session_restore" ||
		request.intent === "RESTORE_PREVIOUS" ||
		request.intent === "UNDO_LAST_EDIT"
	) {
		const restored = restorePreviousLocalEditorialDocument(args.projectId);
		if (!restored.ok) {
			return {
				handled: true,
				request,
				document: args.document,
				mutated: false,
				userFacingText: restored.reason,
				cloudCalls: 0,
				needsProfessionalOrchestrator: false,
				durationDecision: null,
				documentFingerprintBefore: beforeFp,
				documentFingerprintAfter: beforeFp,
				families: [],
			};
		}
		const afterFp = fingerprintDocument(restored.document).value;
		return {
			handled: true,
			request,
			document: restored.document,
			mutated: afterFp !== beforeFp,
			userFacingText: `I restored the previous local edit version (before: “${restored.restoredFrom.prompt.slice(0, 80)}”).`,
			cloudCalls: 0,
			needsProfessionalOrchestrator: false,
			durationDecision: null,
			documentFingerprintBefore: beforeFp,
			documentFingerprintAfter: afterFp,
			families: ["restore"],
		};
	}

	if (request.executionKind === "direct_document") {
		let req = request;
		// Semantic WHERE resolution for user-decided WHAT (zoom without seconds).
		if (
			req.intent === "ADD_ZOOM" &&
			req.semanticEventCue &&
			(!req.range || !(req.range.endSec > req.range.startSec))
		) {
			let samples = args.cursorSamples ?? null;
			if (!samples?.length) {
				const media =
					args.document.assets.find((a) => a.id === args.document.project.primaryAssetId)
						?.originalPath ??
					args.document.assets[0]?.originalPath ??
					null;
				samples = loadCursorSamplesFromSidecar(media);
			}
			const resolved = resolveSemanticEditEvent({
				cue: req.semanticEventCue,
				document: args.document,
				cursorSamples: samples,
				preferredFamily: "zoom",
				visualChangeEvents: args.visualChangeEvents,
				visualAnalysisUsed: args.visualAnalysisUsed,
				identityByAnchorSec: args.identityByAnchorSec,
				identityChecked: args.identityChecked,
			});
			if (resolved.status === "AMBIGUOUS") {
				return {
					handled: true,
					request: req,
					document: args.document,
					mutated: false,
					userFacingText: resolved.userFacingReason,
					cloudCalls: 0,
					needsProfessionalOrchestrator: false,
					durationDecision: null,
					documentFingerprintBefore: beforeFp,
					documentFingerprintAfter: beforeFp,
					families: [],
					outcomeKind: "AMBIGUOUS",
				};
			}
			if (resolved.status === "NOT_FOUND" || !resolved.best) {
				return {
					handled: true,
					request: req,
					document: args.document,
					mutated: false,
					userFacingText: resolved.userFacingReason,
					cloudCalls: 0,
					needsProfessionalOrchestrator: false,
					durationDecision: null,
					documentFingerprintBefore: beforeFp,
					documentFingerprintAfter: beforeFp,
					families: [],
					outcomeKind: "NOT_FOUND",
				};
			}
			const zoomRange = playbackRangeToZoomRawRange(
				args.document,
				resolved.best.startSec,
				resolved.best.endSec,
			);
			if (!zoomRange) {
				return {
					handled: true,
					request: req,
					document: args.document,
					mutated: false,
					userFacingText:
						"I found the event on the programme clock but could not map it onto the timeline ruler Zoom uses.",
					cloudCalls: 0,
					needsProfessionalOrchestrator: false,
					durationDecision: null,
					documentFingerprintBefore: beforeFp,
					documentFingerprintAfter: beforeFp,
					families: [],
					outcomeKind: "AMBIGUOUS",
				};
			}
			req = {
				...req,
				range: zoomRange,
				zoomDepth: req.zoomDepth ?? 3,
				zoomAuthorization: "execute",
				authority: req.authority ?? "USER_EXPLICIT",
			};
		}

		const applied = applyLocalDirectDocumentEdit({
			document: args.document,
			request: req,
			cursorSamples: args.cursorSamples,
		});
		const afterFp = fingerprintDocument(applied.document).value;
		if (applied.mutated) {
			clearLocalEditorialPendingProposal(args.projectId);
			pushLocalEditorialRevision({
				projectId: args.projectId,
				assetId: args.assetId ?? null,
				prompt: args.userMessage,
				intent: req.intent,
				documentBefore,
				committedFamilies: applied.families,
				userFacingText: applied.userFacingText,
			});
		}
		const nextRequest =
			applied.focusTrace != null
				? {
						...req,
						zoomFocusSource: applied.focusTrace
							.focusSource as LocalEditorialRequestV1["zoomFocusSource"],
					}
				: req;
		const groundedNote =
			req.semanticEventCue && applied.mutated && req.range
				? ` Grounded “${req.semanticEventCue}” at ${req.range.startSec.toFixed(1)}s–${req.range.endSec.toFixed(1)}s.`
				: "";
		return {
			handled: true,
			request: nextRequest,
			document: applied.document,
			mutated: applied.mutated,
			userFacingText: buildLocalEditorialReceipt({
				intent: req.intent,
				mutated: applied.mutated,
				families: applied.families,
				baseText: `${applied.userFacingText}${groundedNote}`,
			}),
			cloudCalls: 0,
			needsProfessionalOrchestrator: false,
			durationDecision: null,
			documentFingerprintBefore: beforeFp,
			documentFingerprintAfter: afterFp,
			families: applied.families,
			zoomFocusTrace: applied.focusTrace ?? null,
			outcomeKind: applied.mutated ? "APPLIED" : "UNCHANGED",
		};
	}

	if (request.executionKind === "professional_orchestrator") {
		return {
			handled: true,
			request,
			document: args.document,
			mutated: false,
			userFacingText: "",
			cloudCalls: 0,
			needsProfessionalOrchestrator: true,
			durationDecision: null,
			documentFingerprintBefore: beforeFp,
			documentFingerprintAfter: beforeFp,
			families: [],
		};
	}

	return {
		handled: false,
		request,
		document: args.document,
		mutated: false,
		userFacingText: "",
		cloudCalls: 0,
		needsProfessionalOrchestrator: false,
		durationDecision: null,
		documentFingerprintBefore: beforeFp,
		documentFingerprintAfter: beforeFp,
		families: [],
	};
}

export function recordProfessionalOrchestratorLocalOutcome(args: {
	projectId: string;
	assetId: string | null;
	prompt: string;
	request: LocalEditorialRequestV1;
	documentBefore: AxcutDocument;
	documentAfter: AxcutDocument;
	userFacingText: string;
	families: string[];
	durationBeforeSec: number;
	durationAfterSec: number;
	durationAssessment: import("../professionalEditOrchestrator/types").DurationObjectiveAssessmentV1;
}): {
	userFacingText: string;
	durationDecision: DurationConstraintDecisionV1;
} {
	const durationDecision = buildDurationConstraintDecision({
		requestedDurationSec: args.request.durationTargetMaxSec ?? args.request.durationTargetSec,
		currentDurationSec: args.durationBeforeSec,
		duration: args.durationAssessment,
		operationsConsidered: args.families,
		operationsApplied: args.families,
		finalDurationSec: args.durationAfterSec,
	});
	let text = args.userFacingText;
	if (
		args.request.intent === "TARGET_DURATION" ||
		args.request.intent === "RELAX_PRESERVATION_FOR_TARGET_DURATION"
	) {
		text = formatDurationConstraintReceipt(durationDecision, text);
	}
	applyRequestToLocalEditorialSession(args.projectId, args.request);
	const session = getLocalEditorialSession(args.projectId);
	session.currentProgrammeDurationSec = args.durationAfterSec;
	session.lastAssistantDecision = text.slice(0, 240);
	if (
		fingerprintDocument(args.documentAfter).value !== fingerprintDocument(args.documentBefore).value
	) {
		pushLocalEditorialRevision({
			projectId: args.projectId,
			assetId: args.assetId,
			prompt: args.prompt,
			intent: args.request.intent,
			documentBefore: args.documentBefore,
			committedFamilies: args.families,
			userFacingText: text,
		});
	}
	return { userFacingText: text, durationDecision };
}

export type { CursorSampleLite, DirectZoomFocusTrace } from "./directZoomFocus";
export {
	loadCursorSamplesFromSidecar,
	selectDirectZoomFocus,
} from "./directZoomFocus";
export {
	detectSpeechAct,
	extractDurationSlot,
	extractTimeRangeSlot,
	isLocalEditorialResolvable,
	normalizeEditorialText,
	parseLocalEditorialRequest,
} from "./parse";
export { resolveLocalEditorialRequest } from "./resolveFollowUp";
export {
	resolveSemanticBrainProvider,
	setSemanticBrainForTests,
	understandSemanticRequest,
} from "./semanticBrain";
export {
	applySemanticToLocalRequest,
	repairSemanticProviderPayload,
	type SemanticSkillRequestV1,
	validateSemanticSkillRequest,
} from "./semanticContract";
export type { SemanticEventResolveResult, VisualChangeIntervalLite } from "./semanticEventResolve";
export {
	extractSemanticEventCue,
	isAdviceOnlyEditQuestion,
	isSemanticEditCommand,
	loadVisualChangeIntervalsForDocument,
	resolveSemanticEditEvent,
} from "./semanticEventResolve";
export {
	applyRequestToLocalEditorialSession,
	clearLocalEditorialPendingProposal,
	clearLocalEditorialSessionsForTests,
	getLocalEditorialPendingProposal,
	getLocalEditorialSession,
	setLocalEditorialPendingProposal,
} from "./session";
export {
	localIntentFromRegistrySkill,
	resolveExecutableRegistrySkill,
	SEMANTIC_TO_REGISTRY,
	validateAgainstSkillRegistry,
} from "./skillRegistryGate";
export type { DurationConstraintDecisionV1, LocalEditorialRequestV1 } from "./types";
