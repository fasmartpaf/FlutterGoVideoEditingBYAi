/**
 * Compact system prompt for VIDEO_MEMORY_RETRIEVAL_COMPACT.
 * Keeps epistemic invariants; drops duplicated recipe/tool essays that typed
 * architecture already enforces locally.
 */

import type { VideoMemoryQueryClass } from "./index";

export function buildCompactSystemPrompt(input: {
	editsAllowed: boolean;
	mutationMode?: "proposal_only" | "read_only" | "deterministic_edit" | "consented_apply";
	queryClass: VideoMemoryQueryClass;
	openProjectSnapshot: string | Record<string, unknown>;
}): string {
	const snapshot =
		typeof input.openProjectSnapshot === "string"
			? input.openProjectSnapshot
			: JSON.stringify(input.openProjectSnapshot);
	const lines = [
		"You are OpenScreen's in-app agent. Help with THIS open recording using evidence provided this turn.",
		"AxcutDocument is the source of truth for timeline state. Prefer SOURCE_MEDIA_TIME when discussing the recording.",
		"",
		"Epistemic invariants (always):",
		"- Visible temporary UI (e.g. Restart recording) ≠ user performed that action.",
		"- Passive browser/app chrome (e.g. Upwork tab) ≠ user opened/worked in that app.",
		"- Spoken mention of Settings/panels ≠ those UI surfaces were opened unless visual/cursor evidence verifies.",
		"- Spoken corrections: final intended meaning supersedes earlier wording.",
		"- Prefer UNKNOWN over inventing UI actions, clicks, or pixel events between samples.",
		"",
		"Evidence: use VIDEO_MEMORY_PROVIDER_CONTEXT and any attached frames/reasons. Do not claim you inspected every frame.",
		"When TRUSTED_EDITORIAL_PLAN is present, treat it as authoritative for concrete edit families; do not invent zooms/trims.",
		"Mutation: on editorial/semantic turns, write tools may refuse. Propose edits; never claim Apply Preview happened without user consent.",
		"",
	];

	if (input.queryClass === "speech") {
		lines.push(
			"This turn is speech-focused. Answer from SPOKEN windows/transcript. Do not require visual frames.",
		);
	} else if (input.queryClass === "action_verify") {
		lines.push(
			"This turn verifies a named action. Require visual/cursor support; otherwise say UNKNOWN / not verified.",
		);
	} else if (input.queryClass === "editorial") {
		lines.push(
			"This turn is editorial. Be recording-specific. Prefer honest restraint over generic professional-video recipes.",
		);
	} else if (input.queryClass === "cross_modal") {
		lines.push(
			"Compare speech vs visible state explicitly. Separate match / differ / cannot verify.",
		);
	}

	if (!input.editsAllowed) {
		lines.push(
			"",
			"PROJECT EDITS DISABLED: do not call write tools; describe proposed changes and ask for confirmation.",
		);
	} else if (input.mutationMode === "proposal_only" || input.mutationMode === "read_only") {
		lines.push(
			"",
			"PROPOSAL_ONLY: do not call write tools; use review cards. Never claim Project edits are disabled when Settings allows edits.",
			"Do not advertise unverified clip transitions.",
		);
	}

	lines.push("", "Open project snapshot:", snapshot);
	return lines.join("\n");
}

/** Audit classification of BASE_SYSTEM_PROMPT sections (static analysis aid). */
export const SYSTEM_PROMPT_SECTION_AUDIT = [
	{
		id: "identity",
		kind: "universal",
		compact: "keep short",
		note: "agent identity",
	},
	{
		id: "tool_recipe_map",
		kind: "duplicated_by_typed_tools",
		compact: "drop_or_gate",
		note: "long how-tools-map essay; schemas already describe tools",
	},
	{
		id: "one_pass_finish_recipes",
		kind: "legacy_redundant",
		compact: "drop",
		note: "Recovery 4 + trusted plan supersede zoom recipes",
	},
	{
		id: "epistemic_evidence_contract",
		kind: "universal_safety",
		compact: "keep compact invariants",
		note: "must remain provider-facing",
	},
	{
		id: "source_target_story_json_instructions",
		kind: "duplicated_by_local_cognition",
		compact: "drop when stories computed offline",
		note: "Source/Target already built locally in pipeline",
	},
	{
		id: "open_project_snapshot",
		kind: "media_understanding",
		compact: "keep but prefer shorter snapshot options later",
		note: "documentSnapshotForModel still large",
	},
] as const;
