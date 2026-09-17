/**
 * Phase → tool family mapping for Bounded Reasoning V1.
 * UNDERSTAND/PLAN/APPLY/VERIFY never expose mutating schemas.
 * PROPOSE may expose mutate schemas for proposal language; mutationAuthority still refuses writes.
 */

import { MUTATING_TOOL_NAMES, OPENSCREEN_TOOL_NAMES } from "../agent-tools";
import type { ToolGateDecision } from "../videoMemory/toolGate";
import type { CognitionPhase } from "./phase";
import { phaseAllowsMutationTools } from "./phase";

const READ_TOOLS = [
	"getCurrentDocument",
	"getTranscript",
	"getTranscriptRange",
	"getTranscriptWords",
	"getCursorTrack",
] as const;

const CAPTURE = new Set(["listSources", "recordScreen", "generateCaptions", "exportProject"]);

export function toolGateForPhase(phase: CognitionPhase): ToolGateDecision {
	const all = [...OPENSCREEN_TOOL_NAMES];
	const mutating = [...MUTATING_TOOL_NAMES].filter((n) => !CAPTURE.has(n));

	if (phase === "UNDERSTAND") {
		const allowed = new Set<string>(READ_TOOLS);
		return {
			allowedNames: allowed,
			required: [...READ_TOOLS.slice(0, 4)],
			optional: ["getCursorTrack"],
			irrelevant: all.filter((n) => !allowed.has(n)),
			notes: "UNDERSTAND — read/inspect only; cannot mutate AxcutDocument via tools",
		};
	}

	if (phase === "PLAN") {
		const allowed = new Set(["getCurrentDocument", "getTranscript", "getTranscriptRange"]);
		return {
			allowedNames: allowed,
			required: ["getCurrentDocument", "getTranscript"],
			optional: ["getTranscriptRange"],
			irrelevant: all.filter((n) => !allowed.has(n)),
			notes: "PLAN — trusted Target/Gap/Plan are local; no write schemas",
		};
	}

	if (phase === "PROPOSE") {
		const allowed = new Set<string>(["getCurrentDocument", "getTranscript", ...mutating]);
		return {
			allowedNames: allowed,
			required: ["getCurrentDocument"],
			optional: mutating,
			irrelevant: all.filter((n) => !allowed.has(n)),
			notes:
				"PROPOSE — edit schemas for proposal language only; mutationAuthority still proposal_only/read_only",
		};
	}

	if (phase === "APPLY" || phase === "VERIFY") {
		return {
			allowedNames: new Set(),
			required: [],
			optional: [],
			irrelevant: all,
			notes: `${phase} — provider tool surface empty; consent/applyPreview or native verify is authority`,
		};
	}

	return {
		allowedNames: new Set(all),
		required: ["getCurrentDocument"],
		optional: all.slice(1),
		irrelevant: [],
		notes: "fallback full surface",
	};
}

export function assertPhaseMutationInvariant(
	phase: CognitionPhase,
	toolNames: string[],
): {
	ok: boolean;
	violations: string[];
} {
	const violations: string[] = [];
	if (!phaseAllowsMutationTools(phase)) {
		for (const n of toolNames) {
			if (MUTATING_TOOL_NAMES.has(n) && n !== "generateCaptions") {
				violations.push(n);
			}
		}
	}
	return { ok: violations.length === 0, violations };
}
