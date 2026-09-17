/**
 * Compositional local editorial intent extraction.
 *
 * Pipeline: normalize → speech-act → slots (duration / preserve / relative /
 * reference / action family) → LocalEditorialRequestV1.
 * Not a catalogue of accepted sentences.
 */

import { extractCalloutStyleOp, extractCalloutText } from "./directCallout";
import { extractCaptionStyleOp, extractCaptionTextReplace } from "./directCaptions";
import { extractTitlePlacement, extractTitleStyleOp, extractTitleText } from "./directTitle";
import { extractTransitionKind, extractTransitionStyleOp } from "./directTransition";
import {
	detectSpeechAct,
	extractDurationSlot,
	extractTimeRangeSlot,
	normalizeEditorialText,
	type SpeechAct,
	type TimeRangeSlot,
} from "./normalize";
import { extractSemanticEventCue, isAdviceOnlyEditQuestion } from "./semanticEventResolve";
import type {
	DurationTargetHardness,
	EditFamilyRequest,
	LocalEditorialIntent,
	LocalEditorialRequestV1,
	PreserveClass,
	RelativeAdjustment,
} from "./types";

function extractPreserve(normalized: string, raw: string): PreserveClass[] {
	const t = `${normalized} ${raw.toLowerCase()}`;
	const out: PreserveClass[] = [];
	if (
		/\b(?:important\s+)?explanat|keep\s+(?:the\s+)?(?:important|speech|narrat|useful)|preserve\s+(?:the\s+)?(?:important|useful)|without\s+removing\s+(?:the\s+)?explanat|don'?t\s+remove\s+(?:the\s+)?explanat|keep\s+(?:the\s+)?(?:important\s+)?parts?\b/i.test(
			t,
		)
	) {
		out.push("IMPORTANT_EXPLANATION");
	}
	if (/\bimportant\s+action|keep\s+(?:the\s+)?(?:click|action|demo)\b/i.test(t)) {
		out.push("IMPORTANT_ACTION");
	}
	if (/\bkeep\s+(?:the\s+)?(?:speech|narrat)|don'?t\s+cut\s+(?:speech|audio)\b/i.test(t)) {
		out.push("SPEECH");
	}
	if (/\bkeep\s+(?:the\s+)?intro|don'?t\s+remove\s+(?:the\s+)?intro\b/i.test(t)) {
		out.push("INTRODUCTION");
	}
	if (/\bbreathing\s+room|natural\s+pause|keep\s+more\s+breath\b/i.test(t)) {
		out.push("NATURAL_BREATHING");
	}
	if (
		/\bdon'?t\s+(?:remove|delete|undo)\s+(?:that\s+|the\s+)?zoom\b|\bkeep\s+(?:that\s+|the\s+)?zoom\b/i.test(
			t,
		)
	) {
		// zoom preservation — treat as constraint, not REMOVE_ZOOM
		out.push("IMPORTANT_ACTION");
	}
	return [...new Set(out)];
}

function extractRelative(normalized: string): RelativeAdjustment {
	if (/\bmore\s+aggressive|remove\s+more|a\s+lot\s+faster|much\s+faster\b/.test(normalized)) {
		return "MORE_AGGRESSIVE";
	}
	if (
		/\ba\s+little\s+(?:stronger|more|harder)\b|\bslightly\s+(?:stronger|more)\b/.test(normalized)
	) {
		return "MORE";
	}
	if (/\ba\s+little\s+(?:weaker|less|softer)\b|\bslightly\s+(?:weaker|less)\b/.test(normalized)) {
		return "LESS";
	}
	if (
		/\ba\s+little|slightly|bit\s+faster|bit\s+slower|a\s+bit\b/.test(normalized) ||
		/\bzoom\s+(?:in\s+)?a\s+little\b/.test(normalized)
	) {
		return "A_LITTLE";
	}
	if (/\btoo\s+fast|less\s+aggressive|keep\s+more|slower\b/.test(normalized)) {
		return "LESS_AGGRESSIVE";
	}
	if (
		/\b(?:stronger|more\s+(?:zoom|intense)|zoom\s+in\s+more|make\s+(?:the\s+|that\s+)?zoom\s+(?:stronger|more))\b/.test(
			normalized,
		)
	) {
		return "MORE";
	}
	if (
		/\b(?:weaker|reduce\s+(?:the\s+)?zoom|too\s+much|less\s+zoom|dial\s+(?:the\s+)?zoom\s+back)\b/.test(
			normalized,
		)
	) {
		return "LESS";
	}
	if (/\bfaster\b|\bmore\b/.test(normalized)) return "MORE";
	if (/\bless\b/.test(normalized)) return "LESS";
	return null;
}

function extractZoomScale(normalized: string): number | null {
	if (!/\bzoom|closer|wider|magnif|scale\b/.test(normalized)) return null;
	const m = normalized.match(/\b(\d+(?:\.\d+)?)\s*x\b/);
	if (m) {
		const n = Number(m[1]);
		if (Number.isFinite(n) && n >= 1 && n <= 5) return n;
	}
	return null;
}

/** Explicit playback multiplier (“2x”, “0.75x”, “half speed”). */
export function extractSpeedMultiplierFromText(normalized: string): number | null {
	if (/\bhalf\s+speed\b/.test(normalized)) return 0.5;
	if (
		/\b(?:return|reset|to)\b/.test(normalized) &&
		/\b(?:normal\s+speed|1(?:\.0)?\s*x)\b/.test(normalized)
	) {
		return 1;
	}
	const m = normalized.match(/\b(\d+(?:\.\d+)?)\s*x\b/);
	if (!m) return null;
	if (/\bzoom|closer|wider|magnif\b/.test(normalized)) return null;
	const v = Number(m[1]);
	if (!Number.isFinite(v) || !(v > 0) || v > 16) return null;
	return v;
}

/** Explicit focus coords: "focus 0.3 0.4", "at (0.6, 0.2)", "cx=0.4 cy=0.5". */
function extractZoomUserFocus(normalized: string, raw: string): { cx: number; cy: number } | null {
	const t = `${normalized} ${raw.toLowerCase()}`;
	let m = t.match(
		/\b(?:focus|point|at)\s*(?:on\s+)?(?:\(|\[)?\s*(0?\.\d+|0|1)\s*[, ]\s*(0?\.\d+|0|1)\s*(?:\)|\])?/,
	);
	if (m) {
		const cx = Number(m[1]);
		const cy = Number(m[2]);
		if (Number.isFinite(cx) && Number.isFinite(cy) && cx >= 0 && cx <= 1 && cy >= 0 && cy <= 1) {
			return { cx, cy };
		}
	}
	m = t.match(/\bcx\s*[:=]\s*(0?\.\d+|0|1)\b.*\bcy\s*[:=]\s*(0?\.\d+|0|1)\b/);
	if (m) {
		const cx = Number(m[1]);
		const cy = Number(m[2]);
		if (Number.isFinite(cx) && Number.isFinite(cy)) return { cx, cy };
	}
	return null;
}

function looksLikeZoomScaleAdjust(normalized: string): boolean {
	return (
		/\bzoom\b/.test(normalized) &&
		/\b(\d+(?:\.\d+)?)\s*x\b/.test(normalized) &&
		/\b(?:make|set|zoom|that|it|this|to)\b/.test(normalized)
	);
}

function scaleToDepth(scale: number): 1 | 2 | 3 | 4 | 5 | 6 {
	const table: Array<{ d: 1 | 2 | 3 | 4 | 5 | 6; s: number }> = [
		{ d: 1, s: 1.25 },
		{ d: 2, s: 1.5 },
		{ d: 3, s: 1.8 },
		{ d: 4, s: 2.2 },
		{ d: 5, s: 3.5 },
		{ d: 6, s: 5.0 },
	];
	let best = table[0]!;
	for (const row of table) {
		if (Math.abs(row.s - scale) < Math.abs(best.s - scale)) best = row;
	}
	return best.d;
}

type EditReference = LocalEditorialRequestV1["referencedPreviousEdit"];

function extractReference(normalized: string): EditReference {
	if (/\bprevious\s+version|restore\s+previous|last\s+changes?\b/.test(normalized)) {
		return "previous_document";
	}
	if (
		/\blast\s+(?:edit|change|mutation)s?\b/.test(normalized) &&
		!/\bzoom|speed|trim\b/.test(normalized)
	) {
		return "last_edit_batch";
	}
	// Demonstrative / anaphoric zoom reference — not bare "add a zoom".
	if (
		/\b(?:that|this|the|last|latest)\s+zoom\b/.test(normalized) ||
		(/\b(?:make|start|keep|end|move)\s+(?:that|it|this)\b/.test(normalized) &&
			/\bzoom\b/.test(normalized))
	) {
		return "last_zoom";
	}
	if (/\b(?:that\s+|the\s+|last\s+)?speed\b/.test(normalized) && !/\bzoom\b/.test(normalized)) {
		return "last_speed";
	}
	if (/\b(?:that\s+|the\s+|last\s+)?(?:trim|pause)\b/.test(normalized)) return "last_trim";
	if (/\b(?:that\s+|the\s+|last\s+)?title\b/.test(normalized)) return "last_title";
	if (/\b(?:that\s+|the\s+|last\s+)?callout\b/.test(normalized)) return "last_callout";
	if (/\b(?:that\s+|the\s+|last\s+)?transitions?\b/.test(normalized)) return "last_transition";
	if (/\b(?:that\s+|the\s+|last\s+)?captions?\b/.test(normalized)) return "last_caption";
	return null;
}

interface ActionSlot {
	intent: LocalEditorialIntent;
	confidence: number;
	zoomDirection: LocalEditorialRequestV1["zoomDirection"];
}

function isAutonomousZoomCue(n: string): boolean {
	return (
		/\bwhere(?:ver)?\s+(?:useful|helpful|needed)\b/.test(n) ||
		/\bif\s+(?:it\s+)?(?:helps|useful)\b/.test(n) ||
		/\byou\s+decide\b/.test(n) ||
		/\bimprove\s+(?:the\s+)?(?:visual\s+)?focus\b/.test(n) ||
		/\badd\s+zooms?\s+where\b/.test(n) ||
		/\bzooms?\s+where(?:ver)?\b/.test(n)
	);
}

function isAutonomousCalloutCue(n: string): boolean {
	return (
		/\bwhere(?:ver)?\s+(?:useful|helpful|needed|they\s+help)\b/.test(n) ||
		(/\badd\s+callouts?\b/.test(n) && /\bwhere/.test(n)) ||
		/\byou\s+decide\b/.test(n)
	);
}

function classifyZoomDirection(n: string): LocalEditorialRequestV1["zoomDirection"] {
	if (
		/\bzoom\s+out\b|\bunzoom\b|\bpull\s+back\b|\bmake\s+(?:it|this)\s+wider\b|\breturn\s+to\s+(?:the\s+)?(?:full|normal|base)\b|\bfull\s+screen\b|\bwider\s+framing\b/.test(
			n,
		)
	) {
		if (/\breturn\s+to\s+(?:the\s+)?(?:full|normal|base)|full\s+screen|reset\b/.test(n)) {
			return "reset";
		}
		return "out";
	}
	if (/\bzoom\s+in\b|\bmake\s+(?:it|this)\s+closer\b|\bcloser\b|\badd\s+(?:a\s+)?zoom\b/.test(n)) {
		return "in";
	}
	if (/\bzoom\b/.test(n)) return "in";
	return null;
}

/**
 * Resolve primary action from slots + lexical cues on normalized text.
 * Order: safety (questions/constraints) → restore → undo → direct ops → duration → pacing → polish.
 */
function extractAction(args: {
	normalized: string;
	raw: string;
	speechAct: SpeechAct;
	durationMax: number | null;
	durationApprox: number | null;
	preserve: PreserveClass[];
	reference: EditReference;
	timeRange: TimeRangeSlot | null;
}): ActionSlot {
	const { normalized: n, speechAct } = args;
	const hasRange = args.timeRange != null;

	// Non-mutating speech acts
	if (speechAct === "QUESTION" || speechAct === "OPINION") {
		return { intent: "UNKNOWN", confidence: 0.15, zoomDirection: null };
	}
	if (speechAct === "CONSTRAINT") {
		return { intent: "PRESERVE_RANGE", confidence: 0.9, zoomDirection: null };
	}

	// Restore / undo batch
	if (
		/\bprevious\s+version\s+(?:was\s+)?better\b/.test(n) ||
		/\brestore\s+(?:the\s+)?previous\b/.test(n) ||
		/\bundo\s+(?:the\s+)?last\s+changes?\b/.test(n) ||
		/\brevert\s+(?:the\s+)?last\s+(?:edit|change)s?\b/.test(n) ||
		/\brevert\s+what\s+we\b/.test(n) ||
		/\bgo\s+back\s+to\s+how\s+it\s+was\b/.test(n) ||
		/\bbefore\s+(?:that\s+)?(?:last\s+)?batch\b/.test(n)
	) {
		return { intent: "RESTORE_PREVIOUS", confidence: 0.92, zoomDirection: null };
	}
	if (
		/\b(?:undo|revert)\s+(?:that\s+|the\s+)?(?:last\s+|latest\s+)?(?:change|edit|mutation)s?\b/.test(
			n,
		) &&
		!/\bzoom|speed|trim\b/.test(n)
	) {
		return { intent: "UNDO_LAST_EDIT", confidence: 0.88, zoomDirection: null };
	}
	if (/^\s*undo\s+that\b/.test(n) || /\bundo\s+that\b/.test(n)) {
		if (/\bzoom\b/.test(n)) {
			return { intent: "REMOVE_ZOOM", confidence: 0.92, zoomDirection: null };
		}
		return { intent: "UNDO_LAST_EDIT", confidence: 0.86, zoomDirection: null };
	}

	// Direct: zoom remove — only if not "don't remove"
	if (
		!/\bdon'?t\s+(?:remove|delete|undo)|do\s+not\s+(?:remove|delete|undo)|keep\s+(?:that\s+|the\s+)?zoom\b/.test(
			n,
		) &&
		(/\b(?:undo|revert|remove|delete|drop|kill)\s+(?:that\s+|the\s+|last\s+|latest\s+)?zoom\b/.test(
			n,
		) ||
			/\b(?:take|pull)\s+(?:off|away)\s+(?:that\s+|the\s+|last\s+)?zoom\b/.test(n) ||
			/\b(?:take|pull)\s+(?:the\s+|that\s+|last\s+)?zoom\s+off\b/.test(n) ||
			/\bzoom\s+off\s+(?:the\s+)?timeline\b/.test(n))
	) {
		return { intent: "REMOVE_ZOOM", confidence: 0.93, zoomDirection: null };
	}

	const zoomDir = classifyZoomDirection(n);
	const wantsZoomFamily =
		/\bzooms?\b|\bunzoom\b|\breframe\b|\bzooming\b|\bunzooming\b|\bcloser\b|\bwider\b|\bpull\s+back\b|\bfull\s+screen\b|\bvisual\s+focus\b/.test(
			n,
		);
	const adjustIntensity =
		/\b(?:stronger|weaker|too\s+much|reduce\s+(?:the\s+)?zoom|dial\s+(?:the\s+)?zoom|notch|a\s+little\s+(?:stronger|more|less)|make\s+(?:that|the|this)\s+zoom|make\s+(?:it|the\s+zoom)\s+(?:\d|\w+\s*x))\b/.test(
			n,
		) ||
		(/\bzoom\s+(?:a\s+little\s+)?(?:less|more|back)\b/.test(n) && !hasRange);
	const modifyBounds =
		args.reference === "last_zoom" &&
		(/\bstart(?:\s+it)?\s+at\b|\bkeep\s+it\s+until\b|\bend(?:\s+it)?\s+at\b|\bmove\s+(?:it|that)\b|\binstead\b/.test(
			n,
		) ||
			(hasRange && args.timeRange?.singleTimestamp === true));

	// Explicit range zoom-in / zoom-out — DIRECT authority (before ADJUST catch-all).
	if (wantsZoomFamily && hasRange && !adjustIntensity) {
		if (zoomDir === "out" || zoomDir === "reset") {
			return { intent: "ADJUST_ZOOM", confidence: 0.94, zoomDirection: zoomDir };
		}
		return { intent: "ADD_ZOOM", confidence: 0.95, zoomDirection: zoomDir ?? "in" };
	}

	// Intensity / bound modify on existing zoom
	if (wantsZoomFamily && (adjustIntensity || modifyBounds)) {
		return {
			intent: "ADJUST_ZOOM",
			confidence: 0.9,
			zoomDirection: zoomDir === "out" || zoomDir === "reset" ? zoomDir : "in",
		};
	}
	if (looksLikeZoomScaleAdjust(n) && extractZoomScale(n) != null) {
		return { intent: "ADJUST_ZOOM", confidence: 0.88, zoomDirection: "in" };
	}

	// Zoom out / reset without range — only DIRECT when clearly referring to
	// an existing zoom or an explicit return-to-normal command. Opportunistic
	// "unzooming some important parts" stays autonomous / multi-family.
	if (zoomDir === "out" || zoomDir === "reset") {
		const directOut =
			/\bpull\s+back\b|\breturn\s+to\s+(?:the\s+)?(?:full|normal|base)\b|\bfull\s+screen\b|\bafter\s+that\b|\b(?:that|this|the|last)\s+zoom\b/.test(
				n,
			) || args.reference === "last_zoom";
		const opportunistic =
			/\bimportant\s+parts?\b|\bwhere(?:ver)?\b|\byou\s+decide\b|\badd\b.*\b(?:zoom|unzoom|transition)/.test(
				n,
			) || /\btransitions?\b/.test(n);
		if (directOut && !opportunistic) {
			return { intent: "ADJUST_ZOOM", confidence: 0.88, zoomDirection: zoomDir };
		}
		// Fall through to multi-family / ADD_ZOOM autonomous handling.
	}

	// Legacy adjust phrasing without creating a new timed zoom
	if (
		/\b(?:adjust|dial|ease)\s+(?:the\s+)?zoom\b/.test(n) ||
		/\bdial\s+(?:the\s+)?zoom\s+back\b/.test(n)
	) {
		return { intent: "ADJUST_ZOOM", confidence: 0.82, zoomDirection: "in" };
	}

	if (
		/\b(?:undo|revert|remove)\s+(?:that\s+|the\s+|last\s+)?speed\b/.test(n) ||
		/\bundo\s+(?:the\s+)?last\s+speed\b/.test(n)
	) {
		return { intent: "REMOVE_EDIT", confidence: 0.9, zoomDirection: null };
	}

	if (
		/\b(?:turn|switch)\s+(?:the\s+)?captions?\s+off\b/.test(n) ||
		/\bdisable\s+captions?\b/.test(n) ||
		/\bcaptions?\s+off\b/.test(n) ||
		/\b(?:remove|kill|disable|hide)\s+(?:the\s+)?captions?\b/.test(n) ||
		/\b(?:remove|kill|disable|hide)\s+(?:the\s+)?subtitles?\b/.test(n) ||
		/\bturn\s+(?:the\s+)?subtitles?\s+off\b/.test(n)
	) {
		return { intent: "CAPTIONS", confidence: 0.93, zoomDirection: null };
	}
	// Caption text correction before enable/style
	if (
		/\breplace\s+['"].+['"]\s+with\s+['"]/.test(n) ||
		/\bchange\s+['"].+['"]\s+to\s+['"]/.test(n) ||
		/\b(?:change|fix)\s+(?:this|that|the)\s+caption\b/.test(n) ||
		/\bfix\s+(?:this\s+)?caption\s+to\b/.test(n)
	) {
		return { intent: "CORRECT_CAPTION", confidence: 0.92, zoomDirection: null };
	}
	// Style / position before bare "put captions" enable (avoid “put … at the bottom” → enable)
	if (
		/\bcaptions?\s+(?:smaller|bigger|larger|too\s+big|too\s+small|down|higher|lower)\b/.test(n) ||
		/\bsmaller\s+captions?\b/.test(n) ||
		/\bbigger\s+captions?\b/.test(n) ||
		/\breduce\s+caption\b/.test(n) ||
		/\bcaptions?\s+(?:are\s+)?too\s+(?:big|large|small)\b/.test(n) ||
		/\bcaptions?\s+down\s+in\s+size\b/.test(n) ||
		/\bturn\s+captions?\s+down\b/.test(n) ||
		/\bmake\s+(?:the\s+)?captions?\s+(?:a\s+little\s+)?(?:smaller|bigger|larger)\b/.test(n) ||
		/\bmake\s+them\s+(?:a\s+little\s+)?(?:smaller|bigger|larger|higher|lower)\b/.test(n) ||
		/\bmove\s+(?:the\s+)?(?:captions?|them)\b/.test(n) ||
		/\bput\s+(?:the\s+)?captions?\s+(?:at|near|on|to)\b/.test(n) ||
		/\bcenter(?:ed|re)?\s+(?:the\s+)?captions?\b/.test(n) ||
		/\beasier\s+to\s+read\b/.test(n) ||
		/\bfewer\s+words\b/.test(n) ||
		/\bkeep\s+each\s+caption\b.+\blonger\b/.test(n) ||
		/\bdisappear(?:s|ing)?\s+too\s+quickly\b/.test(n)
	) {
		return { intent: "CAPTION_STYLE", confidence: 0.9, zoomDirection: null };
	}
	if (
		/\b(?:add|enable|show|turn\s+on|switch\s+on)\s+(?:a\s+|the\s+)?(?:captions?|subtitles?)\b/.test(
			n,
		) ||
		/\b(?:captions?|subtitles?)\s+(?:on|please)\b/.test(n) ||
		/\b(?:add|enable|show)\s+(?:a\s+)?caption\b/.test(n) ||
		(/\bput\s+(?:a\s+|the\s+)?(?:captions?|subtitles?)\b/.test(n) &&
			!/\b(?:at|near|on|to)\s+(?:the\s+)?(?:bottom|top|center|centre)\b/.test(n)) ||
		/\bturn\s+(?:the\s+)?captions?\s+back\s+on\b/.test(n) ||
		/\bcan\s+you\s+caption\b/.test(n) ||
		/\bcaption\s+this\s+video\b/.test(n) ||
		/\badd\s+subtitles\s+to\b/.test(n)
	) {
		return { intent: "ENABLE_CAPTIONS", confidence: 0.94, zoomDirection: null };
	}
	if (
		/\b(?:remove|delete|drop)\s+(?:the\s+|that\s+|this\s+)?title\b/.test(n) ||
		/\bremove\s+(?:the\s+)?(?:ending|opening|first|last)\s+title\b/.test(n) ||
		/\b(?:remove|delete|drop)\s+(?:the\s+|that\s+)?(?:["'][^"']+["']|[^\s"']+(?:\s+[^\s"']+){0,8})\s+title\b/.test(
			n,
		) ||
		/\bdrop\s+the\s+title\s+card\b/.test(n)
	) {
		return { intent: "REMOVE_TITLE", confidence: 0.9, zoomDirection: null };
	}
	if (
		/\b(?:remove|delete|drop)\s+(?:the\s+|that\s+|this\s+)?callout\b/.test(n) ||
		/\bremove\s+(?:the\s+)?(?:ending|opening|first|last|second)\s+callout\b/.test(n) ||
		/\b(?:remove|delete|drop)\s+(?:the\s+|that\s+)?(?:["'][^"']+["']|[^\s"']+(?:\s+[^\s"']+){0,6})\s+callout\b/.test(
			n,
		)
	) {
		return { intent: "REMOVE_CALLOUT", confidence: 0.9, zoomDirection: null };
	}
	// Explicit titled text / timed show — before bare "add a title"
	if (
		/\bshow\s+['"][^'"]+['"]\s+from\b/.test(n) ||
		/\badd\s+(?:the\s+)?title\s+['"]/.test(n) ||
		/\badd\s+a\s+title\b.+\bsaying\s+['"]/.test(n) ||
		/\btitle\s+at\s+the\s+(?:beginning|start|end)\b.+\bsaying\b/.test(n) ||
		/\badd\s+(?:a\s+)?title\s+at\s+the\s+(?:beginning|start|end)\b/.test(n)
	) {
		return { intent: "TITLE", confidence: 0.94, zoomDirection: null };
	}
	if (
		/\bchange\s+(?:that|it|the\s+title)\s+to\b/.test(n) ||
		/\breplace\s+['"].+['"]\s+with\s+['"].+['"].*\btitle\b/.test(n) ||
		(/\breplace\s+['"].+['"]\s+with\s+['"]/.test(n) && args.reference === "last_title") ||
		/\bmake\s+(?:the\s+|that\s+)?(?:["'][^"']+["']|[^\s"']+(?:\s+[^\s"']+){0,8})\s+title\s+(?:a\s+little\s+)?(?:bigger|smaller|higher|lower)\b/.test(
			n,
		) ||
		(/\bmake\s+(?:that\s+|the\s+|it\s+)?(?:title\s+)?(?:a\s+little\s+)?(?:bigger|smaller|higher|lower)\b/.test(
			n,
		) &&
			(/\btitle\b/.test(n) || args.reference === "last_title")) ||
		/\bmove\s+(?:that\s+|the\s+)?title\b/.test(n) ||
		/\bput\s+(?:it|the\s+title)\s+(?:in\s+the\s+)?(?:center|centre|top)\b/.test(n) ||
		/\bkeep\s+(?:that\s+|the\s+)?title\b.+\blonger\b/.test(n) ||
		/\bstart\s+(?:that\s+|the\s+)?title\b/.test(n) ||
		(/\bmake\s+(?:it|that)\s+(?:a\s+little\s+)?(?:bigger|smaller|higher|lower)\b/.test(n) &&
			args.reference === "last_title")
	) {
		return { intent: "ADJUST_TITLE", confidence: 0.9, zoomDirection: null };
	}
	// Explicit / timed callout add
	if (
		/\b(?:add|put|place|show)\s+(?:a\s+|an\s+|the\s+)?(?:callouts?|highlights?|arrows?)\b/.test(
			n,
		) ||
		/\bpoint\s+to\b/.test(n) ||
		/\bhighlight\s+(?:the\s+)?/.test(n) ||
		/\blabel\s+saying\b/.test(n) ||
		/\barrow\s+on\b/.test(n)
	) {
		return { intent: "CALLOUT", confidence: 0.92, zoomDirection: null };
	}
	if (
		/\bchange\s+(?:that|it|the\s+callout(?:\s+text)?)\s+to\b/.test(n) ||
		/\bchange\s+(?:the\s+)?(?:callout\s+)?text\s+to\b/.test(n) ||
		/\bmake\s+(?:the\s+|that\s+)?(?:["'][^"']+["']|[^\s"']+(?:\s+[^\s"']+){0,6})\s+callout\s+(?:a\s+little\s+)?(?:bigger|smaller|higher|lower|longer)\b/.test(
			n,
		) ||
		(/\bmake\s+(?:that\s+|the\s+|it\s+)?(?:callout\s+)?(?:a\s+little\s+)?(?:bigger|smaller|higher|lower)\b/.test(
			n,
		) &&
			(/\bcallout\b/.test(n) || args.reference === "last_callout")) ||
		/\bmove\s+(?:that\s+|the\s+)?callout\b/.test(n) ||
		/\bkeep\s+(?:that\s+|the\s+)?callout\b.+\blonger\b/.test(n) ||
		/\bshow\s+(?:that\s+|the\s+|it\s+)?(?:callout\s+)?(?:a\s+little\s+|half\s+(?:a\s+)?second\s+)?earlier\b/.test(
			n,
		) ||
		(/\bmake\s+(?:it|that)\s+(?:a\s+little\s+)?(?:bigger|smaller|higher|lower|left|right)\b/.test(
			n,
		) &&
			args.reference === "last_callout")
	) {
		return { intent: "ADJUST_CALLOUT", confidence: 0.9, zoomDirection: null };
	}
	if (/\b(?:add|put)\s+(?:a\s+)?(?:simple\s+)?title\b/.test(n)) {
		return { intent: "TITLE", confidence: 0.8, zoomDirection: null };
	}
	if (/\b(?:quieter|louder)\b/.test(n) && /\b(?:audio|sound|volume)\b/.test(n)) {
		return { intent: "AUDIO_LEVEL", confidence: 0.88, zoomDirection: null };
	}

	// Explicit exact-range REMOVE (before duration — cut phrases must not become TARGET_DURATION)
	const nearPause = Boolean(args.timeRange?.nearTimestamp);
	const hardRange =
		hasRange &&
		!nearPause &&
		(args.timeRange?.relativeEdge === "first" ||
			args.timeRange?.relativeEdge === "last" ||
			!args.timeRange?.singleTimestamp);
	if (
		hardRange &&
		/\b(?:remove|cut|delete|drop|trim)\b/.test(n) &&
		!/\b(?:unnecessary\s+)?(?:pauses?|silences?|dead\s+air)\b/.test(n) &&
		!/\bzoom\b/.test(n)
	) {
		return { intent: "REMOVE_RANGE", confidence: 0.94, zoomDirection: null };
	}
	if (
		hardRange &&
		/\b(?:everything\s+between|section\s+between)\b/.test(n) &&
		!/\bzoom\b/.test(n)
	) {
		return { intent: "REMOVE_RANGE", confidence: 0.92, zoomDirection: null };
	}

	// Trim follow-up on an existing cut
	if (
		(/\b(?:that|the|last|this)\s+(?:cut|trim|removal)\b/.test(n) ||
			args.reference === "last_trim") &&
		/\b(?:earlier|later|shorter|longer|half\s+(?:a\s+)?sec|start|end|tighter|more)\b/.test(n) &&
		!/\bpause|silence|zoom\b/.test(n)
	) {
		return { intent: "REVISE_PREVIOUS_EDIT", confidence: 0.9, zoomDirection: null };
	}

	// Explicit range SPEED (user authority) — before duration targets
	const speedRate = extractSpeedMultiplierFromText(n);
	if (
		hardRange &&
		!/\bzoom\b/.test(n) &&
		(speedRate != null ||
			/\b(?:speed\s+up|faster|playback\s+speed|slower|slow)\b/.test(n) ||
			/\bmake\b.+\b(?:faster|slower|\d+(?:\.\d+)?\s*x)\b/.test(n))
	) {
		if (speedRate != null && speedRate < 1 - 1e-9) {
			return { intent: "SLOW_DOWN", confidence: 0.93, zoomDirection: null };
		}
		if (speedRate != null && Math.abs(speedRate - 1) < 1e-9) {
			return { intent: "REMOVE_EDIT", confidence: 0.9, zoomDirection: null };
		}
		if (/\bslower\b/.test(n) && (speedRate == null || speedRate < 1)) {
			return { intent: "SLOW_DOWN", confidence: 0.92, zoomDirection: null };
		}
		return { intent: "SPEED_UP", confidence: 0.93, zoomDirection: null };
	}

	// Transition before duration — "dissolve around 12 sec" must not become TARGET_DURATION
	const wantsTransitionEarly =
		/\btransitions?\b|\bdissolve\b|\bcross\s*-?\s*fade\b|\bcrossfade\b/.test(n) ||
		/\bwipe\b|\bslide\b|\bfade\s+to\s+black\b|\bfade\s+black\b/.test(n) ||
		/\badd\s+(?:a\s+)?(?:dissolve|fade|wipe|slide)\b/.test(n) ||
		/\bsmoother\s+cut\b/.test(n) ||
		/\bwhat\s+transitions?\s+(?:are\s+)?available\b/.test(n);
	if (
		/\b(?:remove|delete|drop)\s+(?:the\s+|that\s+|this\s+)?transitions?\b/.test(n) ||
		/\bremove\s+(?:the\s+)?(?:first|second|last)\s+transition\b/.test(n) ||
		/\bchange\s+(?:it|that)\s+back\s+to\s+(?:a\s+)?cuts?\b/.test(n)
	) {
		return { intent: "REMOVE_TRANSITION", confidence: 0.9, zoomDirection: null };
	}
	if (
		wantsTransitionEarly &&
		(/\bmake\s+(?:that\s+|the\s+|it\s+)?(?:transition\s+)?(?:a\s+little\s+)?(?:shorter|longer|quicker|faster|slower)\b/.test(
			n,
		) ||
			/\bchange\s+(?:that\s+|the\s+|it\s+)?(?:transition\s+)?to\b/.test(n) ||
			/\bmake\s+(?:it|that|the\s+transition)\s+(?:a\s+)?(?:dissolve|fade|cut|hard\s+cut|wipe|slide)\b/.test(
				n,
			) ||
			/\btry\s+the\s+other\s+direction\b/.test(n) ||
			(/\b(?:shorter|longer|quicker)\b/.test(n) &&
				(/\btransition\b/.test(n) || args.reference === "last_transition")))
	) {
		return { intent: "ADJUST_TRANSITION", confidence: 0.9, zoomDirection: null };
	}
	if (wantsTransitionEarly && wantsZoomFamily) {
		return { intent: "MULTI_FAMILY_VISUAL", confidence: 0.88, zoomDirection: zoomDir };
	}
	if (wantsTransitionEarly) {
		return { intent: "TRANSITION", confidence: 0.86, zoomDirection: null };
	}

	if (args.durationMax != null || args.durationApprox != null) {
		return { intent: "TARGET_DURATION", confidence: 0.92, zoomDirection: null };
	}

	if (
		/\bshorten\s+(?:the\s+|those\s+|these\s+|a\s+)?(?:awkward\s+)?(?:pauses?|silences?|gaps?)\b/.test(
			n,
		) ||
		/\b(?:pauses?|silences?|gaps?)\s+down\b/.test(n) ||
		/\bknock\s+(?:the\s+)?(?:pauses?|silences?|gaps?)\b/.test(n) ||
		(/\b(?:make|keep)\s+(?:the\s+|that\s+)?(?:pause|silence)\b/.test(n) &&
			/\b(?:shorter|longer|bit\s+more|little)\b/.test(n)) ||
		(/\breduce\s+(?:the\s+)?(?:pause|silence)\b/.test(n) && nearPause) ||
		(nearPause && /\b(?:shorten|reduce)\b/.test(n))
	) {
		return { intent: "SHORTEN_PAUSES", confidence: 0.9, zoomDirection: null };
	}
	if (
		/\b(?:remove|cut|delete|drop|trim\s+out)\s+(?:more\s+)?(?:unnecessary\s+)?(?:the\s+)?(?:pauses?|silences?|dead\s+air|gaps?)\b/.test(
			n,
		) ||
		/\b(?:pauses?|silences?|dead\s+air)\s+(?:out|away)\b/.test(n) ||
		/\btrim\s+out\s+(?:the\s+)?dead\s+air\b/.test(n)
	) {
		return { intent: "REMOVE_PAUSES", confidence: 0.9, zoomDirection: null };
	}

	if (
		(/\b(?:slow\s+parts?|navigation|low[\s-]?info(?:rmation)?|waiting|loading|scrolling|scroll)\b/.test(
			n,
		) &&
			/\b(?:faster|speed|snapp(?:y|ier)|through)\b/.test(n)) ||
		/\bspeed\s+(?:through|up)\b/.test(n) ||
		/\bmake\s+(?:it|this|them)\s+(?:a\s+little\s+)?(?:faster|snapp(?:y|ier))\b/.test(n) ||
		/\ba\s+little\s+faster\b/.test(n)
	) {
		return { intent: "SPEED_UP", confidence: 0.86, zoomDirection: null };
	}
	if (
		/\btoo\s+fast\b/.test(n) ||
		/\brushed\b/.test(n) ||
		/\bslow\s+(?:it|that|this)\s+down\b/.test(n) ||
		/\bmake\s+(?:it|this)\s+slower\b/.test(n) ||
		/\bease\s+it\s+back\b/.test(n)
	) {
		return { intent: "SLOW_DOWN", confidence: 0.84, zoomDirection: null };
	}
	if (
		/\breturn\b.+\bnormal\s+speed\b/.test(n) ||
		/\b(?:to\s+)?normal\s+speed\b/.test(n) ||
		/\breset\b.+\bspeed\b/.test(n)
	) {
		return { intent: "REMOVE_EDIT", confidence: 0.88, zoomDirection: null };
	}

	if (
		/\bprofessional\b|\bready\s+to\s+publish\b|\byou\s+decide\b|\bclean\s+(?:this|it)\s+up\b|\bpolish\b/.test(
			n,
		) ||
		(/\bmake\s+(?:this|it)\s+better\b|\bimprove\b/.test(n) &&
			!isAutonomousZoomCue(n) &&
			!wantsZoomFamily) ||
		/\bgoing\s+out\s+today\b/.test(n)
	) {
		return { intent: "PROFESSIONALIZE", confidence: 0.9, zoomDirection: null };
	}

	if (/\bkeep\s+(?:the\s+)?intro\b/.test(n)) {
		return { intent: "PRESERVE_RANGE", confidence: 0.82, zoomDirection: null };
	}

	if (wantsZoomFamily) {
		return {
			intent: "ADD_ZOOM",
			confidence: isAutonomousZoomCue(n) ? 0.86 : 0.8,
			zoomDirection: zoomDir ?? "in",
		};
	}

	if (
		/\bok\s+remove\b/.test(n) ||
		/\bremove\s+(?:a\s+)?some\b/.test(n) ||
		/\bremove\s+(?:some\s+)?(?:of\s+)?(?:them|those|these)\b/.test(n) ||
		/\bcut\s+(?:some|less\s+important)\b/.test(n)
	) {
		return {
			intent: "RELAX_PRESERVATION_FOR_TARGET_DURATION",
			confidence: 0.75,
			zoomDirection: null,
		};
	}

	return { intent: "UNKNOWN", confidence: 0.2, zoomDirection: null };
}

function executionFor(
	intent: LocalEditorialIntent,
	speechAct: SpeechAct,
	opts: {
		hasExplicitRange: boolean;
		autonomousZoom: boolean;
		hasExplicitTitleText: boolean;
		autonomousCallout: boolean;
		hasExplicitCalloutText: boolean;
		autonomousTransition: boolean;
	},
): LocalEditorialRequestV1["executionKind"] {
	// Free-language questions and unknowns need semantic understanding — not KEEP/escalate.
	if (speechAct === "QUESTION" || speechAct === "OPINION") return "semantic_understanding";
	switch (intent) {
		case "RESTORE_PREVIOUS":
		case "UNDO_LAST_EDIT":
			return "session_restore";
		case "REMOVE_ZOOM":
		case "CAPTIONS":
		case "CAPTION_STYLE":
		case "CORRECT_CAPTION":
		case "REMOVE_TITLE":
		case "ADJUST_TITLE":
		case "REMOVE_CALLOUT":
		case "ADJUST_CALLOUT":
		case "REMOVE_TRANSITION":
		case "ADJUST_TRANSITION":
		case "AUDIO_LEVEL":
		case "REMOVE_EDIT":
		case "ADJUST_ZOOM":
		case "REMOVE_RANGE":
		case "REVISE_PREVIOUS_EDIT":
			return "direct_document";
		case "TITLE":
			// Explicit user text or timed range = direct authority; bare "add a title" stays orch.
			if (opts.hasExplicitTitleText || opts.hasExplicitRange) return "direct_document";
			return "professional_orchestrator";
		case "CALLOUT":
			if (opts.autonomousCallout) return "professional_orchestrator";
			// Explicit timed/text callout = direct; bare add still executes with defaults.
			return "direct_document";
		case "TRANSITION":
			// Explicit join/time/type = direct; "wherever / you decide" stays orch.
			if (opts.autonomousTransition) return "professional_orchestrator";
			return "direct_document";
		case "ADD_ZOOM":
			if (opts.hasExplicitRange && !opts.autonomousZoom) return "direct_document";
			return "professional_orchestrator";
		case "ENABLE_CAPTIONS":
			return "professional_orchestrator";
		case "PRESERVE_RANGE":
			return "constraint_only";
		case "PROFESSIONALIZE":
		case "TARGET_DURATION":
		case "RELAX_PRESERVATION_FOR_TARGET_DURATION":
		case "REMOVE_PAUSES":
		case "SHORTEN_PAUSES":
		case "CHANGE_PACING":
		case "MULTI_FAMILY_VISUAL":
			return "professional_orchestrator";
		case "SPEED_UP":
		case "SLOW_DOWN":
			// Explicit range = DIRECT user authority; semantic-only stays orch.
			if (opts.hasExplicitRange) return "direct_document";
			return "professional_orchestrator";
		case "UNKNOWN":
			// UNRESOLVED ≠ KEEP / not-an-edit — send to semantic understanding.
			return "semantic_understanding";
		default:
			return "semantic_understanding";
	}
}

function extractRequestedFamilies(normalized: string): EditFamilyRequest[] {
	const out: EditFamilyRequest[] = [];
	if (/\btransitions?\b|\bdissolve\b|\bfade\b|\bwipe\b|\bslide\b/.test(normalized)) {
		out.push("transitions");
	}
	if (/\bzoom|\bunzoom|\breframe|closer|wider|pull\s+back|full\s+screen\b/.test(normalized)) {
		out.push("zoom");
	}
	if (/\bcaptions?\b|\bsubtitles?\b/.test(normalized)) out.push("captions");
	if (/\bspeed|\bfaster|\bslower|\bpacing\b/.test(normalized)) out.push("speed");
	if (/\btrim|\bpause|\bsilence|\bdead\s*air|\bshorten\b/.test(normalized)) out.push("trim");
	if (/\bcrop\b/.test(normalized)) out.push("crop");
	if (/\btitle\b/.test(normalized)) out.push("title");
	if (/\bcallout|\bhighlight\b/.test(normalized)) out.push("callout");
	return [...new Set(out)];
}

function hardnessFromRaw(raw: string): DurationTargetHardness {
	const t = raw.toLowerCase();
	if (/\bmust\b|\bhave\s+to\b|\bneed(?:ed)?\b|\brequired\b/.test(t)) return "MUST";
	if (/\bunder\b|\bless\s+than\b|\bbelow\b/.test(t)) return "STRONG";
	if (/\bapprox|about|around|prefer|ideally\b/.test(t)) return "PREFERENCE";
	return null;
}

function buildOrchestratorMessage(args: {
	intent: LocalEditorialIntent;
	raw: string;
	durationMax: number | null;
	preserve: PreserveClass[];
	relative: RelativeAdjustment;
	families: EditFamilyRequest[];
}): string {
	const bits: string[] = [];
	if (args.intent === "PROFESSIONALIZE") {
		bits.push(
			"Make this video professional and ready to publish. Improve pacing, remove or shorten unnecessary pauses, speed up low-information parts when it helps, preserve important explanations and actions, and improve visual focus where useful. You decide.",
		);
	} else if (args.intent === "TARGET_DURATION" && args.durationMax != null) {
		bits.push(
			`Make this video professional and keep it under ${args.durationMax} seconds. Preserve important explanation and actions. Use safe trims, pause shortening, and speed only on remain-visible low-information navigation. Do not cut important speech. You decide.`,
		);
	} else if (args.intent === "RELAX_PRESERVATION_FOR_TARGET_DURATION" && args.durationMax != null) {
		bits.push(
			`The user authorizes removing or shortening SOME lower-value content to approach under ${args.durationMax} seconds. Preserve must-keep instructional actions. Prefer dead air, redundant speech, low-value waits, then supporting explanation. You decide. Proceed.`,
		);
	} else if (args.intent === "MULTI_FAMILY_VISUAL" || args.intent === "TRANSITION") {
		if (args.families.includes("transitions") || args.intent === "TRANSITION") {
			bits.push(
				"Evaluate transitions at real editorial joins; apply a dissolve only where it improves continuity.",
			);
		}
		if (args.families.includes("zoom")) {
			bits.push(
				"Add grounded zoom or unzoom around important clicks or story-important regions where evidence exists.",
			);
		}
		bits.push("Inspect each requested family independently. You decide. Proceed.");
	} else if (args.intent === "REMOVE_PAUSES" || args.intent === "SHORTEN_PAUSES") {
		const near =
			args.raw.match(
				/\b(?:around|near|approx(?:imately)?|at)\s+(\d+(?:\.\d+)?)\s*(?:s(?:ec(?:onds?)?)?)?\b/i,
			)?.[1] ?? null;
		if (near && args.intent === "SHORTEN_PAUSES") {
			bits.push(
				`Shorten only the quiet pause nearest to ${near} seconds on the current programme. Keep a natural breath. Do not remove speech. Proceed.`,
			);
		} else {
			const more =
				args.relative === "MORE_AGGRESSIVE" || args.relative === "MORE"
					? "Remove more unnecessary pauses"
					: args.intent === "SHORTEN_PAUSES"
						? "Shorten unnecessary pauses"
						: "Remove or shorten unnecessary pauses";
			const breath = args.preserve.includes("NATURAL_BREATHING")
				? " but keep natural breathing room"
				: "";
			bits.push(
				`${more}${breath}. Preserve important speech and actions. Make the pacing tighter. You decide.`,
			);
		}
	} else if (args.intent === "SPEED_UP" || args.intent === "CHANGE_PACING") {
		const little = args.relative === "A_LITTLE" ? "a little " : "";
		bits.push(
			`Make the low-information navigation / slow parts ${little}faster with safe SPEED_UP where content should remain visible. Preserve important explanation and clicks. You decide.`,
		);
	} else if (args.intent === "SLOW_DOWN") {
		bits.push(
			"The previous speed changes feel too fast. Prefer gentler pacing; do not damage speech. You decide.",
		);
	} else if (args.intent === "ENABLE_CAPTIONS") {
		bits.push(
			"Enable captions / subtitles from the transcript on this recording. Do not invent other edits. You decide. Proceed.",
		);
	} else if (args.intent === "ADD_ZOOM") {
		bits.push(
			"Improve visual focus with grounded zoom on important clicks where useful. Prefer zoom-in on important actions and a smooth return to base framing (zoom out / reset) where the current programme needs it. Preserve explanations. You decide. Proceed.",
		);
	} else if (args.intent === "TITLE") {
		bits.push("Add a short title if useful. You decide.");
	} else {
		bits.push(args.raw.trim());
		bits.push("You decide.");
	}
	if (args.preserve.includes("INTRODUCTION")) bits.push("Keep the introduction.");
	// Preserve explicit user authority clauses (families + semantic WHEN) so orch
	// intent parsing cannot invent trim/speed and drop zoom.
	if (args.families.length > 0) {
		bits.push(`Explicitly requested families: ${args.families.join(", ")}.`);
	}
	const cue = extractSemanticEventCue(args.raw);
	if (cue) {
		bits.push(`User semantic target (must honor if grounded): ${cue}.`);
	}
	if (
		args.intent === "PROFESSIONALIZE" ||
		args.families.includes("zoom") ||
		args.intent === "ADD_ZOOM"
	) {
		bits.push(`Original user request: ${args.raw.trim().slice(0, 240)}`);
	}
	return bits.join(" ");
}

export function parseLocalEditorialRequest(userMessage: string): LocalEditorialRequestV1 {
	const raw = userMessage.trim();
	const normalized = normalizeEditorialText(raw);
	const speechAct = detectSpeechAct(raw, normalized);
	const timeRange = extractTimeRangeSlot(normalized);
	const duration = extractDurationSlot(normalized);
	const durationMax = duration.maxSec ?? duration.approxSec;
	const preserve = extractPreserve(normalized, raw);
	const relative = extractRelative(normalized);
	const reference = extractReference(normalized);
	const zoomScale = extractZoomScale(normalized);
	const action = extractAction({
		normalized,
		raw,
		speechAct,
		durationMax: duration.maxSec,
		durationApprox: duration.approxSec,
		preserve,
		reference,
		timeRange,
	});

	const intent = action.intent;
	const secondary: LocalEditorialIntent[] = [];
	if (intent === "TARGET_DURATION" && preserve.length) secondary.push("PRESERVE_RANGE");

	let referencedPreviousEdit = reference;
	if (intent === "RESTORE_PREVIOUS") referencedPreviousEdit = "previous_document";
	if (intent === "UNDO_LAST_EDIT") referencedPreviousEdit = "last_edit_batch";
	if (intent === "REMOVE_ZOOM") referencedPreviousEdit = "last_zoom";
	if (intent === "REMOVE_EDIT" && reference === "last_speed") {
		referencedPreviousEdit = "last_speed";
	}
	if (
		intent === "REMOVE_EDIT" &&
		!referencedPreviousEdit &&
		/\b(?:normal\s+speed|reset\b.+\bspeed|return\b.+\bspeed)\b/.test(normalized)
	) {
		referencedPreviousEdit = "last_speed";
	}
	if (intent === "ADJUST_ZOOM" && !referencedPreviousEdit) {
		referencedPreviousEdit = "last_zoom";
	}
	if (intent === "REVISE_PREVIOUS_EDIT" && !referencedPreviousEdit) {
		referencedPreviousEdit = "last_trim";
	}
	if (intent === "REMOVE_RANGE") {
		referencedPreviousEdit = referencedPreviousEdit ?? "last_trim";
	}

	const autonomousZoom =
		intent === "ADD_ZOOM" && isAutonomousZoomCue(normalized) && timeRange == null;

	const titleText = extractTitleText(raw);
	const titlePlacement = extractTitlePlacement(normalized);
	const titleStyleOp =
		intent === "ADJUST_TITLE" || intent === "TITLE" ? extractTitleStyleOp(normalized) : null;
	const calloutText = extractCalloutText(raw);
	const calloutStyleOp =
		intent === "ADJUST_CALLOUT" || intent === "CALLOUT" ? extractCalloutStyleOp(normalized) : null;

	const autonomousCallout =
		intent === "CALLOUT" && isAutonomousCalloutCue(normalized) && timeRange == null;

	const autonomousTransition =
		intent === "TRANSITION" &&
		(/\bwhere(?:ver)?\s+(?:useful|helpful|needed)\b/.test(normalized) ||
			/\byou\s+decide\b/.test(normalized) ||
			(/\badd\s+transitions?\b/.test(normalized) && /\bwhere/.test(normalized)));

	const transitionKind = extractTransitionKind(raw);
	const transitionStyleOp =
		intent === "ADJUST_TRANSITION" || intent === "TRANSITION"
			? extractTransitionStyleOp(normalized)
			: null;

	const executionKind = executionFor(intent, speechAct, {
		hasExplicitRange: timeRange != null,
		autonomousZoom,
		hasExplicitTitleText: Boolean(titleText),
		autonomousCallout,
		hasExplicitCalloutText: Boolean(calloutText),
		autonomousTransition,
	});

	if (intent === "ADJUST_TITLE" && !referencedPreviousEdit) {
		referencedPreviousEdit = "last_title";
	}
	if (intent === "REMOVE_TITLE" && !referencedPreviousEdit) {
		referencedPreviousEdit = "last_title";
	}
	if (intent === "TITLE" && titleText) {
		referencedPreviousEdit = referencedPreviousEdit ?? "last_title";
	}
	if (intent === "ADJUST_CALLOUT" && !referencedPreviousEdit) {
		referencedPreviousEdit = "last_callout";
	}
	if (intent === "REMOVE_CALLOUT" && !referencedPreviousEdit) {
		referencedPreviousEdit = "last_callout";
	}
	if (intent === "CALLOUT" && !autonomousCallout) {
		referencedPreviousEdit = referencedPreviousEdit ?? "last_callout";
	}
	if (intent === "ADJUST_TRANSITION" && !referencedPreviousEdit) {
		referencedPreviousEdit = "last_transition";
	}
	if (intent === "REMOVE_TRANSITION" && !referencedPreviousEdit) {
		referencedPreviousEdit = "last_transition";
	}
	if (intent === "TRANSITION" && !autonomousTransition) {
		referencedPreviousEdit = referencedPreviousEdit ?? "last_transition";
	}
	const localCapabilityAvailable =
		executionKind !== "escalate_cloud" &&
		executionKind !== "none" &&
		(intent !== "UNKNOWN" || executionKind === "semantic_understanding") &&
		(speechAct !== "QUESTION" || executionKind === "semantic_understanding") &&
		(speechAct !== "OPINION" || executionKind === "semantic_understanding");

	const requiresSemanticReasoning =
		executionKind === "semantic_understanding" ||
		speechAct === "QUESTION" ||
		speechAct === "OPINION" ||
		(intent === "ADD_ZOOM" && /\bbutton\s+i\s+clicked\b/i.test(raw) && timeRange == null);

	const routeClass =
		executionKind === "semantic_understanding" || intent === "UNKNOWN"
			? "SEMANTIC_ESCALATION_REQUIRED"
			: !localCapabilityAvailable
				? "SEMANTIC_ESCALATION_REQUIRED"
				: executionKind === "constraint_only"
					? "LOCAL_PARTIAL"
					: requiresSemanticReasoning
						? "LOCAL_PARTIAL"
						: "LOCAL_RESOLVED";

	const families = extractRequestedFamilies(normalized);
	if (
		(intent === "TITLE" || intent === "ADJUST_TITLE" || intent === "REMOVE_TITLE") &&
		!families.includes("title")
	) {
		families.push("title");
	}
	if (
		(intent === "CALLOUT" || intent === "ADJUST_CALLOUT" || intent === "REMOVE_CALLOUT") &&
		!families.includes("callout")
	) {
		families.push("callout");
	}
	if (
		(intent === "TRANSITION" || intent === "ADJUST_TRANSITION" || intent === "REMOVE_TRANSITION") &&
		!families.includes("transitions")
	) {
		families.push("transitions");
	}
	const durationHardness =
		durationMax != null && intent === "TARGET_DURATION"
			? (hardnessFromRaw(raw) ?? ("STRONG" as const))
			: null;
	const relaxPreservation =
		intent === "RELAX_PRESERVATION_FOR_TARGET_DURATION" ||
		/\bok\s+remove\b|\bremove\s+(?:a\s+)?some\b/.test(normalized);

	if (intent === "RELAX_PRESERVATION_FOR_TARGET_DURATION" && !referencedPreviousEdit) {
		referencedPreviousEdit = "lower_value_content";
	}

	const orchestratorMessage =
		executionKind === "professional_orchestrator"
			? buildOrchestratorMessage({
					intent,
					raw,
					durationMax,
					preserve,
					relative,
					families,
				})
			: null;

	let zoomDepth: LocalEditorialRequestV1["zoomDepth"] = null;
	if (zoomScale != null) zoomDepth = scaleToDepth(zoomScale);
	else if (relative === "A_LITTLE" && intent === "ADD_ZOOM") zoomDepth = 2;
	else if (intent === "ADD_ZOOM" && timeRange != null) zoomDepth = 3;

	const zoomAuthorization: LocalEditorialRequestV1["zoomAuthorization"] =
		executionKind === "direct_document" &&
		(intent === "ADD_ZOOM" || intent === "ADJUST_ZOOM" || intent === "REMOVE_ZOOM")
			? "execute"
			: intent === "ADD_ZOOM" && executionKind === "professional_orchestrator"
				? "propose"
				: null;

	const range =
		timeRange != null
			? {
					startSec: timeRange.startSec,
					endSec: timeRange.endSec,
					...(timeRange.singleTimestamp ? { singleTimestamp: true as const } : {}),
					...(timeRange.relativeEdge ? { relativeEdge: timeRange.relativeEdge } : {}),
					...(timeRange.nearTimestamp ? { nearTimestamp: true as const } : {}),
				}
			: null;

	const zoomUserFocus = extractZoomUserFocus(normalized, raw);
	const speedMultiplier = extractSpeedMultiplierFromText(normalized);
	const captionTextReplace = intent === "CORRECT_CAPTION" ? extractCaptionTextReplace(raw) : null;
	let captionStyleOp: LocalEditorialRequestV1["captionStyleOp"] = null;
	if (intent === "CAPTION_STYLE") {
		captionStyleOp = extractCaptionStyleOp(normalized) ?? "smaller";
	}
	const captionAtSec =
		intent === "CORRECT_CAPTION" && timeRange?.singleTimestamp ? timeRange.startSec : null;

	const semanticEventCueRaw = extractSemanticEventCue(raw);
	const adviceOnly = isAdviceOnlyEditQuestion(raw);
	// Advice questions often omit "when …" — derive a cue from UI nouns in the question.
	const semanticEventCue =
		semanticEventCueRaw ??
		(adviceOnly
			? (() => {
					const n = raw.toLowerCase().replace(/-/g, " ");
					const hit = [
						"landing page",
						"settings",
						"export",
						"dashboard",
						"browser",
						"pricing",
						"api",
					].find((p) => n.includes(p));
					return hit ? `when the ${hit} appears` : null;
				})()
			: null);

	let finalIntent = intent;
	let finalExecution = executionKind;
	let finalLocal = localCapabilityAvailable;
	let finalRoute = routeClass;
	let finalOrch = orchestratorMessage;
	let finalAuth = zoomAuthorization;
	let finalConstraints = [
		...preserve.map(String),
		...(speechAct === "CONSTRAINT" ? ["NEGATIVE_REMOVE"] : []),
	];
	let finalConfidence = action.confidence;

	if (adviceOnly) {
		// Advisory natural language: selected Chat AI decides WHAT (skill).
		// Do not force ADD_ZOOM / skip brain — only tag ADVICE_ONLY for no-mutation.
		finalIntent = "UNKNOWN";
		finalExecution = "semantic_understanding";
		finalLocal = true;
		finalRoute = "SEMANTIC_ESCALATION_REQUIRED";
		finalOrch = null;
		finalAuth = "propose";
		finalConstraints = [...finalConstraints, "ADVICE_ONLY"];
		finalConfidence = Math.max(finalConfidence, 0.55);
		// Keep any extracted when-cue as a soft hint for the brain payload only;
		// WHERE still waits for validated semantic target after understanding.
	} else if (
		finalIntent === "ADD_ZOOM" &&
		semanticEventCue &&
		timeRange == null &&
		!autonomousZoom
	) {
		// Semantic command: user decided WHAT; local resolver finds WHERE then direct execute.
		finalExecution = "direct_document";
		finalLocal = true;
		finalRoute = "LOCAL_RESOLVED";
		finalOrch = null;
		finalAuth = "execute";
		finalConfidence = Math.max(finalConfidence, 0.88);
	}

	return {
		version: 1,
		rawText: raw,
		intent: finalIntent,
		secondaryIntents: secondary,
		target: durationMax != null && intent === "TARGET_DURATION" ? `duration:${durationMax}s` : null,
		constraints: finalConstraints,
		preserve,
		durationTargetSec: intent === "TARGET_DURATION" ? durationMax : null,
		durationTargetMaxSec: intent === "TARGET_DURATION" ? (duration.maxSec ?? durationMax) : null,
		durationHardness,
		relaxPreservationForDuration: relaxPreservation,
		requestedFamilies: families,
		relativeAdjustment: relative,
		referencedPreviousEdit,
		range,
		zoomDirection: action.zoomDirection,
		zoomDepth,
		zoomScale,
		speedMultiplier,
		captionStyleOp,
		captionTextReplace,
		captionAtSec,
		titleText: intent === "TITLE" || intent === "ADJUST_TITLE" ? titleText : null,
		titlePlacement: intent === "TITLE" ? titlePlacement : null,
		titleStyleOp: intent === "ADJUST_TITLE" ? titleStyleOp : null,
		calloutText: intent === "CALLOUT" || intent === "ADJUST_CALLOUT" ? calloutText : null,
		calloutStyleOp: intent === "ADJUST_CALLOUT" ? calloutStyleOp : null,
		transitionKind:
			intent === "TRANSITION" || intent === "ADJUST_TRANSITION" ? transitionKind : null,
		transitionDurationSec: (() => {
			// Do not steal "around 10 seconds" near-time targeting as a duration.
			if (
				/\baround\b|\bnear\b|\bat\b(?!\s+\d)/i.test(raw) &&
				!/\b(?:set|to)\s+(?:the\s+)?(?:transition\s+)?(?:to\s+)?\d/i.test(raw)
			) {
				if (!/\b(?:set|make)\s+(?:the\s+)?(?:transition\s+)?(?:duration|length)\b/i.test(raw)) {
					return null;
				}
			}
			const m = raw.match(
				/\b(?:set|to)\s+(?:the\s+)?(?:transition\s+)?(?:to\s+)?(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)\b/i,
			);
			if (!m) return null;
			if (
				intent === "TRANSITION" ||
				intent === "ADJUST_TRANSITION" ||
				/\btransition\b/i.test(raw)
			) {
				const v = Number(m[1]);
				return Number.isFinite(v) ? Math.min(2, Math.max(0.1, v)) : null;
			}
			return null;
		})(),
		transitionStyleOp: intent === "ADJUST_TRANSITION" ? transitionStyleOp : null,
		zoomFocusSource: zoomUserFocus ? "user" : null,
		zoomUserFocus,
		zoomAuthorization: finalAuth,
		semanticEventCue,
		confidence: finalConfidence,
		requiresSemanticReasoning:
			adviceOnly || finalExecution === "semantic_understanding" ? true : requiresSemanticReasoning,
		localCapabilityAvailable: finalLocal,
		executionKind: finalExecution,
		routeClass: finalRoute as LocalEditorialRequestV1["routeClass"],
		orchestratorMessage: finalOrch,
		resolvedFromConversation: false,
		parseStatus:
			finalExecution === "semantic_understanding"
				? "UNRESOLVED"
				: finalConfidence >= 0.85 && finalRoute === "LOCAL_RESOLVED"
					? "HIGH_CONFIDENCE"
					: finalRoute === "SEMANTIC_ESCALATION_REQUIRED"
						? "UNRESOLVED"
						: "HIGH_CONFIDENCE",
		authority: (() => {
			if (adviceOnly || finalConstraints.includes("ADVICE_ONLY")) return "ADVISORY";
			if (finalAuth === "execute") return "USER_EXPLICIT";
			if (finalAuth === "propose") return "AUTONOMOUS";
			if (finalExecution === "direct_document") return "USER_EXPLICIT";
			if (finalExecution === "professional_orchestrator") return "AUTONOMOUS";
			return null;
		})(),
		semanticGoal: (() => {
			if (adviceOnly) return "RECOMMEND";
			if (finalIntent === "PROFESSIONALIZE") return "PROFESSIONALIZE";
			if (finalIntent === "ADD_ZOOM") return "EMPHASIZE";
			if (finalIntent === "SPEED_UP" || finalIntent === "CHANGE_PACING") return "IMPROVE_PACING";
			if (finalIntent === "REMOVE_RANGE" || finalIntent === "REMOVE_PAUSES") return "SHORTEN";
			if (finalIntent === "UNKNOWN") return "UNKNOWN";
			return "EXPLICIT_EDIT";
		})(),
		semanticSkillRequest: null,
	};
}

export function isLocalEditorialResolvable(req: LocalEditorialRequestV1): boolean {
	if (req.executionKind === "none") return false;
	// Semantic understanding is a first-class local path (brain may use a provider).
	if (req.executionKind === "semantic_understanding" || req.parseStatus === "UNRESOLVED") {
		return true;
	}
	if (!req.localCapabilityAvailable) return false;
	if (req.executionKind === "escalate_cloud") return false;
	return (
		req.routeClass === "LOCAL_RESOLVED" ||
		req.routeClass === "LOCAL_PARTIAL" ||
		(req.executionKind === "professional_orchestrator" && !req.requiresSemanticReasoning)
	);
}

/** Test/debug helper — expose normalization. */
export { detectSpeechAct, extractDurationSlot, extractTimeRangeSlot, normalizeEditorialText };
