/**
 * DESIGN ONLY — phase-specific tool packing (not production).
 * Compact today gates by query class. This estimates savings if OpenScreen
 * exposed tools by cognition phase instead.
 *
 * Do not import from deep-agent/service.ts.
 */

import { MUTATING_TOOL_NAMES, OPENSCREEN_TOOL_NAMES } from "../agent-tools";
import { toolGateForQuery } from "./toolGate";

export const COGNITION_PHASES = ["understand", "plan", "propose", "apply", "verify"] as const;

export type CognitionPhase = (typeof COGNITION_PHASES)[number];

const READ_TOOLS = [
	"getCurrentDocument",
	"getTranscript",
	"getTranscriptRange",
	"getTranscriptWords",
	"getCursorTrack",
] as const;

const CAPTURE_TOOLS = ["listSources", "recordScreen", "generateCaptions", "exportProject"] as const;

/** Average schema chars from Promotion Gate (16759 chars / 35 tools). */
export const EST_CHARS_PER_TOOL_SCHEMA = Math.round(16759 / 35);

export function toolNamesForPhase(phase: CognitionPhase): string[] {
	const mutating = [...MUTATING_TOOL_NAMES].filter(
		(n) => n !== "recordScreen" && n !== "generateCaptions",
	);
	switch (phase) {
		case "understand":
			return [...READ_TOOLS];
		case "plan":
			return ["getCurrentDocument", "getTranscript"];
		case "propose":
			return ["getCurrentDocument", ...mutating];
		case "apply":
			return [];
		case "verify":
			return ["getCurrentDocument"];
		default:
			return [...OPENSCREEN_TOOL_NAMES];
	}
}

export function estimatePhaseSchemaChars(phase: CognitionPhase): {
	phase: CognitionPhase;
	toolCount: number;
	estSchemaChars: number;
	notes: string;
} {
	const names = toolNamesForPhase(phase);
	const notes: Record<CognitionPhase, string> = {
		understand: "Read/investigation only. Speech questions should not pay for 35 mutation schemas.",
		plan: "Trusted Target/Gap/Plan already computed locally — provider needs almost no write schemas.",
		propose:
			"Edit capability schemas for proposal language; mutation authority still proposal_only.",
		apply: "Deterministic consent/applyPreview IPC — do not expose write tools to the model.",
		verify: "Deterministic/native verify — provider at most inspects document state.",
	};
	return {
		phase,
		toolCount: names.length,
		estSchemaChars: names.length * EST_CHARS_PER_TOOL_SCHEMA,
		notes: notes[phase],
	};
}

export function compareQueryGateVsPhasePacking(): {
	recommendation: "RECOMMENDED" | "NOT_RECOMMENDED" | "NEEDS_MORE_EVIDENCE";
	queryClassToday: Record<string, { toolCount: number; estChars: number }>;
	phases: ReturnType<typeof estimatePhaseSchemaChars>[];
	fullSurfaceChars: number;
	understandVsFullSavedChars: number;
	narrative: string;
} {
	const classes = [
		"speech",
		"visual",
		"cross_modal",
		"editorial",
		"direct_edit",
		"general",
	] as const;
	const queryClassToday = Object.fromEntries(
		classes.map((c) => {
			const g = toolGateForQuery(c);
			return [
				c,
				{
					toolCount: g.allowedNames.size,
					estChars: g.allowedNames.size * EST_CHARS_PER_TOOL_SCHEMA,
				},
			];
		}),
	);
	const phases = COGNITION_PHASES.map(estimatePhaseSchemaChars);
	const fullSurfaceChars = OPENSCREEN_TOOL_NAMES.length * EST_CHARS_PER_TOOL_SCHEMA;
	const understandChars = phases.find((p) => p.phase === "understand")!.estSchemaChars;
	return {
		recommendation: "RECOMMENDED",
		queryClassToday,
		phases,
		fullSurfaceChars,
		understandVsFullSavedChars: fullSurfaceChars - understandChars,
		narrative: [
			"Query-class gating is the wrong axis for an edit workflow that starts as speech/visual understanding and later proposes trims.",
			"UNDERSTAND should expose ~5 read tools (~2.4k schema chars vs ~16.8k full).",
			"PROPOSE may expose mutation schemas; APPLY/VERIFY stay off the provider (existing authority/consent).",
			"Do not implement a new agent this milestone. Progressive exposure can reuse the current Compact gate keyed by phase instead of query class.",
			`Capture tools (${CAPTURE_TOOLS.join(", ")}) stay off UNDERSTAND/PLAN.`,
		].join(" "),
	};
}
