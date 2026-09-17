/**
 * Compositional follow-up resolution against LocalEditorialSessionStateV1.
 * Does not concatenate chat strings into an LLM — merges slots with prior state.
 */

import { isBareAffirmation, isVerbalProceed } from "../professionalEditOrchestrator/intent";
import { extractCalloutStyleOp } from "./directCallout";
import { extractCaptionStyleOp } from "./directCaptions";
import { extractTitleStyleOp } from "./directTitle";
import { extractTransitionStyleOp } from "./directTransition";
import { parseLocalEditorialRequest } from "./parse";
import { getLocalEditorialSession } from "./session";
import type {
	DurationTargetHardness,
	EditFamilyRequest,
	LocalEditorialIntent,
	LocalEditorialRequestV1,
	LocalEditorialSessionStateV1,
} from "./types";

function looksLikeRelaxPreservation(normalized: string, raw: string): boolean {
	const t = `${normalized} ${raw.toLowerCase()}`;
	return (
		/\bok\s+remove\b/.test(t) ||
		/\bremove\s+(?:a\s+)?some\b/.test(t) ||
		/\bremove\s+(?:some\s+)?(?:of\s+)?(?:them|those|these)\b/.test(t) ||
		/\bcut\s+(?:some|a\s+few|less\s+important)\b/.test(t) ||
		/\bremove\s+(?:the\s+)?(?:less\s+important|lower[\s-]?value|supporting)\b/.test(t) ||
		/\byes\s+remove\b/.test(t) ||
		/\bgo\s+ahead\s+and\s+remove\b/.test(t) ||
		/\bdo\s+whatever\s+needed\b/.test(t)
	);
}

function extractRequestedFamilies(normalized: string, raw: string): EditFamilyRequest[] {
	const t = `${normalized} ${raw.toLowerCase()}`;
	const out: EditFamilyRequest[] = [];
	if (/\btransitions?\b|\bdissolve\b|\bfade\b/.test(t)) out.push("transitions");
	if (/\bzoom|\bunzoom|\breframe|\bfocus\s+(?:more|in)\b/.test(t)) out.push("zoom");
	if (/\bcaptions?\b|\bsubtitles?\b/.test(t)) out.push("captions");
	if (/\bspeed|\bfaster|\bslower|\bpacing\b/.test(t)) out.push("speed");
	if (/\btrim|\bpause|\bsilence|\bdead\s*air|\bshorten\b/.test(t)) out.push("trim");
	if (/\bcrop\b/.test(t)) out.push("crop");
	if (/\btitle\b/.test(t)) out.push("title");
	if (/\bcallout|\bhighlight\b/.test(t)) out.push("callout");
	return [...new Set(out)];
}

function hardnessFromText(raw: string, relation: string | null): DurationTargetHardness {
	const t = raw.toLowerCase();
	if (/\bmust\b|\bhave\s+to\b|\bneed(?:ed)?\b|\brequired\b/.test(t)) return "MUST";
	if (relation === "under" || /\bunder\b|\bless\s+than\b|\bbelow\b/.test(t)) return "STRONG";
	if (/\bapprox|about|around|prefer|ideally\b/.test(t)) return "PREFERENCE";
	return "STRONG";
}

function buildRelaxOrchestratorMessage(targetSec: number): string {
	return [
		`The user previously required the video under ${targetSec} seconds.`,
		"They now authorize removing or shortening SOME lower-value / supporting explanation to approach that target.",
		"Preserve MUST_KEEP instructional actions and core explanation.",
		"Prefer in order: dead air, redundant speech, low-value navigation waits, shorten supporting explanation, speed remain-visible low-information movement, then remove lower-value supporting content.",
		"Do not remove must-keep instructional actions merely to hit the number.",
		"If the exact target remains unsafe, get as close as reasonably possible and explain what blocked the rest.",
		"You decide. Proceed.",
	].join(" ");
}

function buildMultiFamilyOrchestratorMessage(families: EditFamilyRequest[]): string {
	const bits: string[] = [];
	if (families.includes("transitions")) {
		bits.push(
			"Evaluate transitions at real editorial joins; apply a dissolve only where it improves continuity; otherwise leave transitions unchanged with a specific reason.",
		);
	}
	if (families.includes("zoom")) {
		bits.push(
			"Evaluate grounded zoom / unzoom around important clicks, dwell, or story-important regions; apply useful zooms where evidence exists; do not invent focus.",
		);
	}
	bits.push("Inspect each requested family independently. You decide. Proceed.");
	return bits.join(" ");
}

/**
 * Resolve a Chat turn against prior editorial session state.
 */
export function resolveLocalEditorialRequest(
	userMessage: string,
	session: LocalEditorialSessionStateV1 | null,
): LocalEditorialRequestV1 {
	const base = parseLocalEditorialRequest(userMessage);
	const sess = session;
	const normalized = userMessage.trim().toLowerCase();
	const familiesFromText = extractRequestedFamilies(base.rawText.toLowerCase(), userMessage);

	// Carry duration target from session when this turn does not restate it.
	let durationTargetMaxSec = base.durationTargetMaxSec;
	let durationTargetSec = base.durationTargetSec;
	let durationHardness =
		base.durationHardness ??
		(durationTargetMaxSec != null
			? hardnessFromText(userMessage, durationTargetMaxSec != null ? "under" : null)
			: null);
	let relaxPreservation = base.relaxPreservationForDuration;
	let requestedFamilies =
		base.requestedFamilies.length > 0 ? base.requestedFamilies : familiesFromText;
	let resolvedFromConversation = false;
	let intent: LocalEditorialIntent = base.intent;
	let secondaryIntents = [...base.secondaryIntents];
	let confidence = base.confidence;
	let referencedPreviousEdit = base.referencedPreviousEdit;
	let executionKind = base.executionKind;
	let orchestratorMessage = base.orchestratorMessage;
	let localCapabilityAvailable = base.localCapabilityAvailable;
	let routeClass = base.routeClass;

	// Confirmation / modify of a pending proposal — never re-enter autonomous assessment.
	const pending = sess?.pendingProposal ?? null;
	const relativeIntensity: "stronger" | "weaker" | null = /\bweaker\b/i.test(userMessage)
		? "weaker"
		: /\bstronger\b/i.test(userMessage)
			? "stronger"
			: base.relativeAdjustment === "MORE_AGGRESSIVE" || base.relativeAdjustment === "MORE"
				? "stronger"
				: base.relativeAdjustment === "LESS_AGGRESSIVE" || base.relativeAdjustment === "LESS"
					? "weaker"
					: null;
	const confirmingBare =
		pending != null && (isVerbalProceed(userMessage) || isBareAffirmation(userMessage));
	const confirmingWithModify =
		pending != null && relativeIntensity != null && /\b(yes|yeah|yep|ok|okay)\b/i.test(userMessage);
	const confirming = confirmingBare || confirmingWithModify;
	if (confirming && pending) {
		const nextDepth = ((): 1 | 2 | 3 | 4 | 5 | 6 => {
			const cur = pending.zoomDepth ?? base.zoomDepth ?? 3;
			if (confirmingWithModify && relativeIntensity === "stronger") {
				return Math.min(6, cur + 1) as 1 | 2 | 3 | 4 | 5 | 6;
			}
			if (confirmingWithModify && relativeIntensity === "weaker") {
				return Math.max(1, cur - 1) as 1 | 2 | 3 | 4 | 5 | 6;
			}
			return cur as 1 | 2 | 3 | 4 | 5 | 6;
		})();
		if (
			pending.kind === "direct_zoom" ||
			pending.kind === "advice_zoom" ||
			pending.kind === "semantic_edit"
		) {
			return {
				...base,
				intent: "ADD_ZOOM",
				executionKind: "direct_document",
				localCapabilityAvailable: true,
				routeClass: "LOCAL_RESOLVED",
				resolvedFromConversation: true,
				confidence: 0.95,
				zoomAuthorization: "execute",
				semanticEventCue: pending.semanticEventCue,
				range: pending.range
					? {
							startSec: pending.range.startSec,
							endSec: pending.range.endSec,
						}
					: base.range,
				zoomDepth: nextDepth,
				requestedFamilies: pending.families.length > 0 ? pending.families : ["zoom"],
				orchestratorMessage: null,
				referencedPreviousEdit: "last_zoom",
				parseStatus: "HIGH_CONFIDENCE",
				authority: "USER_CONFIRMED",
				semanticGoal: confirmingWithModify ? "MODIFY_PENDING" : "CONFIRM_PENDING",
				relativeAdjustment: confirmingWithModify
					? relativeIntensity === "stronger"
						? "MORE_AGGRESSIVE"
						: "LESS_AGGRESSIVE"
					: base.relativeAdjustment,
			};
		}
		if (pending.kind === "orch_plan") {
			return {
				...base,
				intent: "PROFESSIONALIZE",
				executionKind: "professional_orchestrator",
				localCapabilityAvailable: true,
				routeClass: "LOCAL_RESOLVED",
				resolvedFromConversation: true,
				confidence: 0.95,
				requestedFamilies: pending.families.length > 0 ? pending.families : base.requestedFamilies,
				orchestratorMessage:
					"The user confirmed the pending edit proposal. Proceed and apply the previously authorized safe plan now. You decide. Proceed.",
				semanticEventCue: pending.semanticEventCue,
				parseStatus: "HIGH_CONFIDENCE",
				authority: "USER_CONFIRMED",
				semanticGoal: "CONFIRM_PENDING",
			};
		}
	}

	if (sess?.durationTargetSec != null && durationTargetMaxSec == null) {
		durationTargetMaxSec = sess.durationTargetSec;
		durationTargetSec = sess.durationTargetSec;
		durationHardness = sess.durationHardness ?? durationHardness ?? "STRONG";
	}

	// Turn C pattern: "ok remove a some of thems" with prior duration target.
	if (
		(intent === "UNKNOWN" || looksLikeRelaxPreservation(normalized, userMessage)) &&
		sess?.durationTargetSec != null &&
		looksLikeRelaxPreservation(normalized, userMessage)
	) {
		intent = "RELAX_PRESERVATION_FOR_TARGET_DURATION";
		relaxPreservation = true;
		referencedPreviousEdit = "lower_value_content";
		secondaryIntents = ["TARGET_DURATION", ...secondaryIntents];
		confidence = Math.max(confidence, 0.9);
		executionKind = "professional_orchestrator";
		orchestratorMessage = buildRelaxOrchestratorMessage(sess.durationTargetSec);
		localCapabilityAvailable = true;
		routeClass = "LOCAL_RESOLVED";
		resolvedFromConversation = true;
		if (!requestedFamilies.includes("trim")) requestedFamilies = [...requestedFamilies, "trim"];
		if (!requestedFamilies.includes("speed")) requestedFamilies = [...requestedFamilies, "speed"];
	}

	// Turn D pattern: transitions + zoom/unzoom (typos normalized upstream).
	if (
		(intent === "UNKNOWN" || intent === "ADD_ZOOM" || intent === "TRANSITION") &&
		(requestedFamilies.includes("transitions") || requestedFamilies.includes("zoom")) &&
		(requestedFamilies.includes("transitions") && requestedFamilies.includes("zoom")
			? true
			: /\bzoom|\bunzoom|\btransition|\breframe\b/i.test(userMessage))
	) {
		const multi = requestedFamilies.includes("transitions") && requestedFamilies.includes("zoom");
		if (
			multi ||
			(intent === "UNKNOWN" &&
				requestedFamilies.length >= 1 &&
				(requestedFamilies.includes("transitions") || requestedFamilies.includes("zoom")))
		) {
			if (multi || requestedFamilies.length >= 2) {
				intent = "MULTI_FAMILY_VISUAL";
			} else if (requestedFamilies.includes("transitions")) {
				intent = "TRANSITION";
			} else {
				intent = "ADD_ZOOM";
			}
			confidence = Math.max(confidence, 0.88);
			executionKind = "professional_orchestrator";
			orchestratorMessage = buildMultiFamilyOrchestratorMessage(requestedFamilies);
			localCapabilityAvailable = true;
			routeClass = "LOCAL_RESOLVED";
			resolvedFromConversation = sess != null || multi;
		}
	}

	// Persist hardness when this turn sets a duration.
	if (base.intent === "TARGET_DURATION" && durationTargetMaxSec != null) {
		durationHardness = hardnessFromText(userMessage, "under");
		if (/\bmust\b|\bhave\s+to\b|\bneed(?:ed)?\b/.test(userMessage.toLowerCase())) {
			durationHardness = "MUST";
		}
	}

	// When session already has a duration and user professionalizes again, keep target.
	if (
		intent === "PROFESSIONALIZE" &&
		sess?.durationTargetSec != null &&
		durationTargetMaxSec == null
	) {
		durationTargetMaxSec = sess.durationTargetSec;
		durationTargetSec = sess.durationTargetSec;
		resolvedFromConversation = true;
	}

	// Anaphoric zoom follow-ups: "start it at 4", "keep it until 11", "make it stronger"
	// when the session already committed a zoom.
	const sessionHasZoom =
		sess?.committedOperations.includes("zoom") ||
		sess?.revisions.some((r) => r.committedFamilies.includes("zoom"));
	if (
		sessionHasZoom &&
		(intent === "UNKNOWN" ||
			(intent === "ADD_ZOOM" && base.executionKind === "professional_orchestrator"))
	) {
		const anaphora =
			/\b(?:start(?:\s+it)?\s+at|keep\s+it\s+until|end(?:\s+it)?\s+at|make\s+(?:it|that)\s+(?:a\s+little\s+)?(?:stronger|weaker|more|less)|undo\s+that)\b/i.test(
				userMessage,
			) ||
			(/\b(?:it|that)\b/i.test(userMessage) &&
				/\b(?:stronger|weaker|until|instead|after)\b/i.test(userMessage));
		if (anaphora) {
			if (/\bundo\s+that\b/i.test(userMessage)) {
				intent = "UNDO_LAST_EDIT";
				executionKind = "session_restore";
				referencedPreviousEdit = "last_edit_batch";
			} else {
				intent = "ADJUST_ZOOM";
				executionKind = "direct_document";
				referencedPreviousEdit = "last_zoom";
				orchestratorMessage = null;
			}
			confidence = Math.max(confidence, 0.9);
			localCapabilityAvailable = true;
			routeClass = "LOCAL_RESOLVED";
			resolvedFromConversation = true;
			if (!requestedFamilies.includes("zoom")) {
				requestedFamilies = [...requestedFamilies, "zoom"];
			}
		}
	}

	// Anaphoric trim / pause follow-ups against the last committed cut.
	const sessionHasTrim =
		sess?.committedOperations.includes("trim") ||
		sess?.revisions.some((r) => r.committedFamilies.includes("trim"));
	if (
		sessionHasTrim &&
		(intent === "UNKNOWN" || intent === "SHORTEN_PAUSES" || intent === "REVISE_PREVIOUS_EDIT")
	) {
		const trimAnaphora =
			/\b(?:that|the|last|this)\s+(?:cut|trim|removal|pause|silence)\b/i.test(userMessage) ||
			(/\b(?:it|that)\b/i.test(userMessage) &&
				/\b(?:shorter|longer|earlier|later|half\s+(?:a\s+)?sec|bit\s+more|little\s+(?:more|shorter)|tighter)\b/i.test(
					userMessage,
				)) ||
			/\bkeep\s+(?:a\s+)?bit\s+more\s+of\s+(?:that\s+)?(?:pause|silence)\b/i.test(userMessage) ||
			/\bmake\s+(?:it|that)\s+(?:a\s+little\s+)?shorter\b/i.test(userMessage);
		if (trimAnaphora) {
			if (/\bundo\s+that\b/i.test(userMessage)) {
				intent = "UNDO_LAST_EDIT";
				executionKind = "session_restore";
				referencedPreviousEdit = "last_edit_batch";
			} else {
				intent = "REVISE_PREVIOUS_EDIT";
				executionKind = "direct_document";
				referencedPreviousEdit = "last_trim";
				orchestratorMessage = null;
			}
			confidence = Math.max(confidence, 0.9);
			localCapabilityAvailable = true;
			routeClass = "LOCAL_RESOLVED";
			resolvedFromConversation = true;
			if (!requestedFamilies.includes("trim")) {
				requestedFamilies = [...requestedFamilies, "trim"];
			}
		}
	}

	// Anaphoric speed follow-ups against the last committed speed region.
	const sessionHasSpeed =
		sess?.committedOperations.includes("speed") ||
		sess?.revisions.some((r) => r.committedFamilies.includes("speed"));
	if (
		sessionHasSpeed &&
		(intent === "UNKNOWN" ||
			intent === "SPEED_UP" ||
			intent === "SLOW_DOWN" ||
			intent === "REMOVE_EDIT")
	) {
		const speedAnaphora =
			/\b(?:that|the|last|this)\s+speed\b/i.test(userMessage) ||
			/\b(?:a\s+little\s+)?(?:more|faster|slower)\b/i.test(userMessage) ||
			/\btoo\s+fast\b|\breduce\s+it\b|\breturn\b.+\bnormal\b/i.test(userMessage) ||
			(/\b(?:it|that)\b/i.test(userMessage) &&
				/\b(?:faster|slower|earlier|later|stronger|weaker|normal)\b/i.test(userMessage)) ||
			/\bstart\s+(?:that\s+)?half\b|\bend\s+it\b/i.test(userMessage);
		if (speedAnaphora && !/\bzoom|trim|cut|pause\b/i.test(userMessage)) {
			if (/\bundo\s+that\b/i.test(userMessage)) {
				intent = "UNDO_LAST_EDIT";
				executionKind = "session_restore";
				referencedPreviousEdit = "last_edit_batch";
			} else if (/\bnormal\b|\breset\b/.test(userMessage.toLowerCase())) {
				intent = "REMOVE_EDIT";
				executionKind = "direct_document";
				referencedPreviousEdit = "last_speed";
				orchestratorMessage = null;
			} else {
				intent = /\bslower|reduce|too\s+fast|weaker\b/i.test(userMessage)
					? "SLOW_DOWN"
					: "SPEED_UP";
				executionKind = "direct_document";
				referencedPreviousEdit = "last_speed";
				orchestratorMessage = null;
			}
			confidence = Math.max(confidence, 0.9);
			localCapabilityAvailable = true;
			routeClass = "LOCAL_RESOLVED";
			resolvedFromConversation = true;
			if (!requestedFamilies.includes("speed")) {
				requestedFamilies = [...requestedFamilies, "speed"];
			}
		}
	}

	// Anaphoric caption follow-ups against committed caption state.
	const sessionHasCaptions =
		sess?.committedOperations.includes("captions") ||
		sess?.revisions.some((r) => r.committedFamilies.includes("captions"));
	if (
		sessionHasCaptions &&
		(intent === "UNKNOWN" ||
			intent === "CAPTION_STYLE" ||
			intent === "CAPTIONS" ||
			intent === "ENABLE_CAPTIONS" ||
			intent === "CORRECT_CAPTION")
	) {
		const captionAnaphora =
			/\b(?:them|they|it)\b/i.test(userMessage) ||
			/\b(?:the|those|these|that)\s+captions?\b/i.test(userMessage) ||
			/\b(?:smaller|bigger|larger|higher|lower|center|bottom|top|readable)\b/i.test(userMessage);
		if (captionAnaphora && !/\bzoom|trim|cut|pause|speed|faster|slower\b/i.test(userMessage)) {
			if (/\bundo\s+that\b/i.test(userMessage)) {
				intent = "UNDO_LAST_EDIT";
				executionKind = "session_restore";
				referencedPreviousEdit = "last_edit_batch";
			} else if (
				/\b(?:off|hide|remove|disable)\b/i.test(userMessage) &&
				!/\bdon'?t\b/i.test(userMessage)
			) {
				intent = "CAPTIONS";
				executionKind = "direct_document";
				referencedPreviousEdit = "last_caption";
				orchestratorMessage = null;
			} else if (/\b(?:on|enable|show|back\s+on)\b/i.test(userMessage)) {
				intent = "ENABLE_CAPTIONS";
				executionKind = "direct_document";
				referencedPreviousEdit = "last_caption";
				orchestratorMessage = null;
			} else if (/\breplace\b|\bchange\b.+\bcaption\b|\bfix\b.+\bcaption\b/i.test(userMessage)) {
				intent = "CORRECT_CAPTION";
				executionKind = "direct_document";
				referencedPreviousEdit = "last_caption";
				orchestratorMessage = null;
			} else {
				intent = "CAPTION_STYLE";
				executionKind = "direct_document";
				referencedPreviousEdit = "last_caption";
				orchestratorMessage = null;
			}
			confidence = Math.max(confidence, 0.9);
			localCapabilityAvailable = true;
			routeClass = "LOCAL_RESOLVED";
			resolvedFromConversation = true;
			if (!requestedFamilies.includes("captions")) {
				requestedFamilies = [...requestedFamilies, "captions"];
			}
		}
	}

	// Anaphoric title follow-ups against committed title overlays.
	const sessionHasTitle =
		sess?.committedOperations.includes("title") ||
		sess?.revisions.some((r) => r.committedFamilies.includes("title"));
	if (
		sessionHasTitle &&
		(intent === "UNKNOWN" ||
			intent === "TITLE" ||
			intent === "ADJUST_TITLE" ||
			intent === "REMOVE_TITLE")
	) {
		const titleAnaphora =
			/\b(?:that|the|this|it)\s+title\b/i.test(userMessage) ||
			(/\b(?:it|that)\b/i.test(userMessage) &&
				/\b(?:bigger|smaller|higher|lower|longer|earlier|center|centre)\b/i.test(userMessage)) ||
			/\bchange\s+(?:that|it)\s+to\b/i.test(userMessage) ||
			/\bmake\s+(?:it|that)\s+(?:a\s+little\s+)?(?:bigger|smaller|higher|lower)\b/i.test(
				userMessage,
			) ||
			/\bmove\s+(?:it|that)\b/i.test(userMessage) ||
			/\bkeep\s+(?:it|that)\b.+\blonger\b/i.test(userMessage);
		if (
			titleAnaphora &&
			!/\bzoom|caption|subtitle|trim|speed|faster|slower|callout|highlight\b/i.test(userMessage)
		) {
			if (/\bundo\s+that\b/i.test(userMessage)) {
				intent = "UNDO_LAST_EDIT";
				executionKind = "session_restore";
				referencedPreviousEdit = "last_edit_batch";
			} else if (/\b(?:remove|delete|drop)\b/i.test(userMessage)) {
				intent = "REMOVE_TITLE";
				executionKind = "direct_document";
				referencedPreviousEdit = "last_title";
				orchestratorMessage = null;
			} else {
				intent = "ADJUST_TITLE";
				executionKind = "direct_document";
				referencedPreviousEdit = "last_title";
				orchestratorMessage = null;
			}
			confidence = Math.max(confidence, 0.9);
			localCapabilityAvailable = true;
			routeClass = "LOCAL_RESOLVED";
			resolvedFromConversation = true;
			if (!requestedFamilies.includes("title")) {
				requestedFamilies = [...requestedFamilies, "title"];
			}
		}
	}

	// Anaphoric callout follow-ups against committed callout overlays.
	const sessionHasCallout =
		sess?.committedOperations.includes("callout") ||
		sess?.revisions.some((r) => r.committedFamilies.includes("callout"));
	if (
		sessionHasCallout &&
		(intent === "UNKNOWN" ||
			intent === "CALLOUT" ||
			intent === "ADJUST_CALLOUT" ||
			intent === "REMOVE_CALLOUT")
	) {
		const calloutAnaphora =
			/\b(?:that|the|this|it)\s+callout\b/i.test(userMessage) ||
			(/\b(?:it|that)\b/i.test(userMessage) &&
				/\b(?:bigger|smaller|higher|lower|longer|earlier|left|right)\b/i.test(userMessage)) ||
			/\bchange\s+(?:that|it)\s+to\b/i.test(userMessage) ||
			/\bmake\s+(?:it|that)\s+(?:a\s+little\s+)?(?:bigger|smaller|higher|lower|left|right)\b/i.test(
				userMessage,
			) ||
			/\bmove\s+(?:it|that)\b/i.test(userMessage) ||
			/\bkeep\s+(?:it|that)\b.+\blonger\b/i.test(userMessage) ||
			/\bshow\s+(?:it|that)\b.+\bearlier\b/i.test(userMessage);
		if (
			calloutAnaphora &&
			!/\bzoom|caption|subtitle|trim|speed|faster|slower|title|transition\b/i.test(userMessage)
		) {
			if (/\bundo\s+that\b/i.test(userMessage)) {
				intent = "UNDO_LAST_EDIT";
				executionKind = "session_restore";
				referencedPreviousEdit = "last_edit_batch";
			} else if (/\b(?:remove|delete|drop)\b/i.test(userMessage)) {
				intent = "REMOVE_CALLOUT";
				executionKind = "direct_document";
				referencedPreviousEdit = "last_callout";
				orchestratorMessage = null;
			} else {
				intent = "ADJUST_CALLOUT";
				executionKind = "direct_document";
				referencedPreviousEdit = "last_callout";
				orchestratorMessage = null;
			}
			confidence = Math.max(confidence, 0.9);
			localCapabilityAvailable = true;
			routeClass = "LOCAL_RESOLVED";
			resolvedFromConversation = true;
			if (!requestedFamilies.includes("callout")) {
				requestedFamilies = [...requestedFamilies, "callout"];
			}
		}
	}

	// Anaphoric transition follow-ups against committed joins.
	const sessionHasTransition =
		sess?.committedOperations.includes("transitions") ||
		sess?.revisions.some((r) => r.committedFamilies.includes("transitions"));
	if (
		sessionHasTransition &&
		(intent === "UNKNOWN" ||
			intent === "TRANSITION" ||
			intent === "ADJUST_TRANSITION" ||
			intent === "REMOVE_TRANSITION")
	) {
		const transitionAnaphora =
			/\b(?:that|the|this|it)\s+transition\b/i.test(userMessage) ||
			(/\b(?:it|that)\b/i.test(userMessage) &&
				/\b(?:shorter|longer|quicker|slower|dissolve|cut|fade|gradual)\b/i.test(userMessage)) ||
			/\bchange\s+(?:that|it)\s+to\b/i.test(userMessage) ||
			/\bmake\s+(?:it|that)\s+(?:a\s+little\s+)?(?:shorter|longer|quicker)\b/i.test(userMessage);
		if (
			transitionAnaphora &&
			!/\bzoom|caption|subtitle|trim|speed|faster|slower|title|callout\b/i.test(userMessage)
		) {
			if (/\bundo\s+that\b/i.test(userMessage)) {
				intent = "UNDO_LAST_EDIT";
				executionKind = "session_restore";
				referencedPreviousEdit = "last_edit_batch";
			} else if (/\b(?:remove|delete|drop)\b/i.test(userMessage)) {
				intent = "REMOVE_TRANSITION";
				executionKind = "direct_document";
				referencedPreviousEdit = "last_transition";
				orchestratorMessage = null;
			} else {
				intent = "ADJUST_TRANSITION";
				executionKind = "direct_document";
				referencedPreviousEdit = "last_transition";
				orchestratorMessage = null;
			}
			confidence = Math.max(confidence, 0.9);
			localCapabilityAvailable = true;
			routeClass = "LOCAL_RESOLVED";
			resolvedFromConversation = true;
			if (!requestedFamilies.includes("transitions")) {
				requestedFamilies = [...requestedFamilies, "transitions"];
			}
		}
	}

	// Never re-escalate an already-direct explicit zoom through multi-family orch.
	if (
		base.executionKind === "direct_document" &&
		(base.intent === "ADD_ZOOM" || base.intent === "ADJUST_ZOOM" || base.intent === "REMOVE_ZOOM")
	) {
		executionKind = "direct_document";
		orchestratorMessage = null;
		intent = base.intent;
		localCapabilityAvailable = true;
		routeClass = "LOCAL_RESOLVED";
	}

	// Never re-escalate direct transition commands through multi-family orch.
	if (
		base.executionKind === "direct_document" &&
		(base.intent === "TRANSITION" ||
			base.intent === "ADJUST_TRANSITION" ||
			base.intent === "REMOVE_TRANSITION")
	) {
		executionKind = "direct_document";
		orchestratorMessage = null;
		intent = base.intent;
		localCapabilityAvailable = true;
		routeClass = "LOCAL_RESOLVED";
	}

	const requiresSemanticReasoning = base.requiresSemanticReasoning && intent === base.intent;

	return {
		...base,
		intent,
		secondaryIntents,
		durationTargetSec,
		durationTargetMaxSec,
		durationHardness,
		relaxPreservationForDuration:
			relaxPreservation || Boolean(sess?.userRelaxedPreservation && intent === "TARGET_DURATION"),
		requestedFamilies,
		relativeAdjustment: base.relativeAdjustment,
		referencedPreviousEdit,
		captionStyleOp:
			intent === "CAPTION_STYLE"
				? (base.captionStyleOp ?? extractCaptionStyleOp(userMessage.toLowerCase()) ?? "smaller")
				: base.captionStyleOp,
		titleStyleOp:
			intent === "ADJUST_TITLE"
				? (base.titleStyleOp ?? extractTitleStyleOp(userMessage.toLowerCase()) ?? null)
				: base.titleStyleOp,
		calloutStyleOp:
			intent === "ADJUST_CALLOUT"
				? (base.calloutStyleOp ?? extractCalloutStyleOp(userMessage.toLowerCase()) ?? null)
				: base.calloutStyleOp,
		transitionStyleOp:
			intent === "ADJUST_TRANSITION"
				? (base.transitionStyleOp ?? extractTransitionStyleOp(userMessage.toLowerCase()) ?? null)
				: base.transitionStyleOp,
		confidence,
		requiresSemanticReasoning,
		localCapabilityAvailable,
		executionKind,
		routeClass:
			localCapabilityAvailable && intent !== "UNKNOWN"
				? routeClass === "SEMANTIC_ESCALATION_REQUIRED"
					? "LOCAL_RESOLVED"
					: routeClass
				: routeClass,
		orchestratorMessage,
		resolvedFromConversation,
		target: durationTargetMaxSec != null ? `duration:${durationTargetMaxSec}s` : base.target,
		parseStatus:
			executionKind === "semantic_understanding"
				? "UNRESOLVED"
				: localCapabilityAvailable && intent !== "UNKNOWN"
					? "HIGH_CONFIDENCE"
					: base.parseStatus,
		authority:
			executionKind === "direct_document"
				? base.authority === "USER_CONFIRMED"
					? "USER_CONFIRMED"
					: "USER_EXPLICIT"
				: executionKind === "professional_orchestrator"
					? "AUTONOMOUS"
					: base.authority,
	};
}

export function classifyLocalEditorialTurnWithSession(
	userMessage: string,
	projectId: string | null | undefined,
): LocalEditorialRequestV1 {
	const session =
		projectId != null && projectId.length > 0 ? getLocalEditorialSession(projectId) : null;
	return resolveLocalEditorialRequest(userMessage, session);
}
