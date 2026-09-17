/**
 * QueryScope — temporal evidence demand, independent of query class.
 * Deterministic; no LLM. Class answers *what modality*; scope answers *where in time*.
 */

/** Mirrors VideoMemoryQueryClass without importing index (avoid cycle). */
export type QueryClassForScope =
	| "speech"
	| "visual"
	| "cross_modal"
	| "editorial"
	| "action_verify"
	| "direct_edit"
	| "general";

export const EVIDENCE_RETRIEVAL_COVERAGE_V1_ID =
	"CURRENT_OPENSCREEN_EVIDENCE_RETRIEVAL_COVERAGE_V1" as const;

export type QueryScope = "local" | "bounded_range" | "whole_media" | "unknown";

export type FocusWindow = {
	startSec: number;
	endSec: number;
	kind: "timestamp" | "late" | "early" | "explicit_range";
};

const LOCAL_TIMESTAMP = /\b(?:at|around|near)\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds?)?\b/i;
const EXPLICIT_RANGE = /\b(\d+(?:\.\d+)?)\s*[–—\-to]+\s*(\d+(?:\.\d+)?)\s*(?:s|sec|seconds?)?\b/i;
const LATE =
	/\b(?:near|towards?|at)\s+(?:the\s+)?end\b|\blast\s+(?:few\s+)?(?:seconds?|moments?|bit)\b|\bending\b/i;
const EARLY = /\b(?:near|at)\s+(?:the\s+)?(?:start|beginning)\b|\bfirst\s+(?:few\s+)?seconds?\b/i;
const WHOLE_MEDIA =
	/\b(?:this|the|my|entire|whole|complete|full)\s+(?:recording|video|footage|clip)\b|\bover\s+time\b|\bfrom\s+(?:the\s+)?beginning\s+to\s+(?:the\s+)?end\b|\bchronolog|\bwhere would\b|\bwould you not\b|\bcompare what i\b|\bvisibly happening\b|\bmake this\b|\bprofessional\b|\bwhat would you not edit\b/i;

/**
 * Temporal scope of the question. Editorial / cross-modal default to whole_media
 * unless a timestamp or bounded phrase is the primary ask.
 */
export function classifyQueryScope(
	userMessage: string,
	queryClass?: QueryClassForScope,
): QueryScope {
	const t = userMessage.trim();
	if (!t) return "unknown";

	const hasTs = LOCAL_TIMESTAMP.test(t);
	const hasRange = EXPLICIT_RANGE.test(t);
	const late = LATE.test(t);
	const early = EARLY.test(t);
	const whole = WHOLE_MEDIA.test(t);

	if (queryClass === "speech") {
		if (late || early || hasTs || hasRange) return "bounded_range";
		return "unknown";
	}

	if (queryClass === "direct_edit") {
		if (hasTs || hasRange) return "local";
		return "unknown";
	}

	if (queryClass === "action_verify") {
		return "bounded_range";
	}

	if (queryClass === "editorial" || queryClass === "cross_modal") {
		if (hasTs && !whole) return "local";
		if ((late || early) && !whole && !/recording|video|this/i.test(t)) return "bounded_range";
		return "whole_media";
	}

	if (hasTs && !whole) return "local";
	if ((late || early || hasRange) && !whole) return "bounded_range";
	if (whole || queryClass === "visual") {
		if (
			late &&
			/popup|notification|toast|hud|restart/i.test(t) &&
			!/over time|beginning to end/i.test(t)
		) {
			return "bounded_range";
		}
		if (queryClass === "visual" && (whole || /over time|happening/i.test(t))) return "whole_media";
		if (whole) return "whole_media";
	}

	if (late || early || hasRange) return "bounded_range";
	if (hasTs) return "local";
	return "unknown";
}

export function parseFocusWindow(
	userMessage: string,
	durationSec: number,
	scope: QueryScope,
): FocusWindow | null {
	if (!(durationSec > 0)) return null;
	const t = userMessage;

	const range = t.match(EXPLICIT_RANGE);
	if (range && (scope === "local" || scope === "bounded_range")) {
		const a = Number(range[1]);
		const b = Number(range[2]);
		if (Number.isFinite(a) && Number.isFinite(b)) {
			const start = Math.max(0, Math.min(a, b) - 0.4);
			const end = Math.min(durationSec, Math.max(a, b) + 0.4);
			return { startSec: start, endSec: end, kind: "explicit_range" };
		}
	}

	const ts = t.match(LOCAL_TIMESTAMP);
	if (ts && (scope === "local" || scope === "bounded_range")) {
		const at = Number(ts[1]);
		if (Number.isFinite(at)) {
			const pad = Math.max(1.25, durationSec * 0.08);
			return {
				startSec: Math.max(0, at - pad),
				endSec: Math.min(durationSec, at + pad),
				kind: "timestamp",
			};
		}
	}

	if (scope === "local" || scope === "bounded_range") {
		if (LATE.test(t)) {
			const start = durationSec * 0.65;
			return { startSec: start, endSec: durationSec, kind: "late" };
		}
		if (EARLY.test(t)) {
			return { startSec: 0, endSec: durationSec * 0.3, kind: "early" };
		}
	}

	return null;
}

export function needsWholeMediaCoverage(
	queryClass: QueryClassForScope,
	scope: QueryScope,
): boolean {
	if (scope === "local" || scope === "bounded_range") return false;
	if (queryClass === "speech" || queryClass === "direct_edit") return false;
	if (queryClass === "action_verify") return false;
	if (scope === "whole_media") return true;
	return queryClass === "editorial" || queryClass === "cross_modal" || queryClass === "visual";
}
