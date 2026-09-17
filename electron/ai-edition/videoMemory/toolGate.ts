/**
 * Tool-family gating for experimental VIDEO_MEMORY_RETRIEVAL_COMPACT.
 * Cognition remains local; this only limits which schemas reach the provider.
 * Mutation authority still refuses writes on proposal_only / read_only.
 */

import { MUTATING_TOOL_NAMES, OPENSCREEN_TOOL_NAMES } from "../agent-tools";
import type { VideoMemoryQueryClass } from "./index";

const CAPTURE_TOOLS = new Set(["listSources", "recordScreen", "generateCaptions", "exportProject"]);

export type ToolGateDecision = {
	allowedNames: Set<string>;
	required: string[];
	optional: string[];
	irrelevant: string[];
	notes: string;
};

/**
 * Deterministic audit + gate policy per query class.
 * Editorial keeps mutation schemas (authority still gates execution).
 * Speech/visual understanding prefer read-only schemas.
 */
export function toolGateForQuery(queryClass: VideoMemoryQueryClass): ToolGateDecision {
	const all = [...OPENSCREEN_TOOL_NAMES];
	const mutating = [...MUTATING_TOOL_NAMES];

	if (queryClass === "speech") {
		const required = [
			"getCurrentDocument",
			"getTranscript",
			"getTranscriptRange",
			"getTranscriptWords",
		];
		const optional = ["getCursorTrack"];
		const allowed = new Set([...required, ...optional]);
		return {
			allowedNames: allowed,
			required,
			optional,
			irrelevant: all.filter((n) => !allowed.has(n)),
			notes: "speech inspection — mutation/capture tools irrelevant to answering",
		};
	}

	if (queryClass === "visual" || queryClass === "cross_modal" || queryClass === "action_verify") {
		const required = [
			"getCurrentDocument",
			"getTranscript",
			"getTranscriptRange",
			"getCursorTrack",
		];
		const optional = ["getTranscriptWords"];
		const allowed = new Set([...required, ...optional]);
		return {
			allowedNames: allowed,
			required,
			optional,
			irrelevant: all.filter((n) => !allowed.has(n)),
			notes:
				"understanding / verify — propose later via consent; no write schemas needed this turn",
		};
	}

	if (queryClass === "direct_edit") {
		return {
			allowedNames: new Set(all),
			required: ["getCurrentDocument", ...mutating.slice(0, 8)],
			optional: [...CAPTURE_TOOLS],
			irrelevant: [],
			notes: "direct_edit may need full mutate surface; authority still applies",
		};
	}

	if (queryClass === "editorial") {
		// Keep mutate schemas so model can name precise tools in proposals, but
		// proposal_only mode refuses execution. Compact may still drop capture tools.
		const allowed = new Set(all.filter((n) => !CAPTURE_TOOLS.has(n) || n === "generateCaptions"));
		return {
			allowedNames: allowed,
			required: ["getCurrentDocument", "getTranscript", "addTrim", "addZoom", "addAnnotation"],
			optional: mutating.filter((n) => allowed.has(n)),
			irrelevant: all.filter((n) => !allowed.has(n)),
			notes: "editorial — keep edit schemas for proposal language; drop record/list/export",
		};
	}

	return {
		allowedNames: new Set(all),
		required: ["getCurrentDocument"],
		optional: all.slice(1),
		irrelevant: [],
		notes: "general — full tool surface",
	};
}

export function filterToolsByGate<T extends { name: string }>(
	tools: T[],
	gate: ToolGateDecision,
): T[] {
	return tools.filter((t) => gate.allowedNames.has(t.name));
}

/** Read-only helper for audits without mutating production. */
export function auditToolRelevance(queryClass: VideoMemoryQueryClass): ToolGateDecision {
	return toolGateForQuery(queryClass);
}
