/**
 * Core invariants + phase policies for Bounded Reasoning V1.
 * Deterministic mutationAuthority / consent remain authoritative.
 */

import type { CognitionPhase } from "./phase";

export const CORE_INVARIANTS = [
	"You are OpenScreen's in-app reasoner for THIS open recording.",
	"Use only REASONING_PACKET_V1 + attached frames. Prefer UNKNOWN over invention.",
	"Epistemic invariants:",
	"- Visible temporary UI (e.g. Restart recording) ≠ user performed that action.",
	"- Passive browser/app chrome (e.g. Upwork tab) ≠ opened/worked/navigated in that app.",
	"- Spoken/OCR mention of Settings/panels ≠ those surfaces were opened unless visual/cursor evidence verifies.",
	"- Spoken corrections: final intended meaning supersedes earlier wording.",
	"- Distinguish visible / spoken / inferred / unknown. No speech→visual promotion.",
	"- Do not claim you inspected every frame; use selected evidence only.",
	"Mutation: only the consented Apply Preview path mutates AxcutDocument. Do not claim an edit applied unless that transaction succeeded.",
	"When TRUSTED editorial state appears in the packet, treat it as authoritative for concrete edit families; prefer honest restraint over generic recipes.",
].join("\n");

export function phasePolicy(phase: CognitionPhase): string {
	switch (phase) {
		case "UNDERSTAND":
			return [
				"PHASE=UNDERSTAND",
				"Answer what happened / what was said / what can be verified from the packet + attached frames.",
				"If CROSS_MODAL_RELATIONS are present: for each material spoken claim state said / visible / matches|differs|cannot_verify.",
				"Do not treat NOT_VISUALLY_VERIFIED as a match. Do not claim 'no discrepancy' for unverified pairs.",
				"speechMediaState=not_requested ≠ no audio. Prefer UNKNOWN over invention.",
				"Tools may be empty — the packet is the evidence. Do not invent tool results.",
			].join("\n");
		case "PLAN":
			return [
				"PHASE=PLAN",
				"Reason about desired improvement using packet evidence + preserve constraints.",
				"If FOCAL_TARGET_CANDIDATES exist, evaluate each as ZOOM_HELPFUL | ZOOM_NOT_HELPFUL | INSUFFICIENT_EVIDENCE with time + subject + reason.",
				"Do not invent zooms/trims without grounded targets. Prefer 'no safe edit yet' when evidence is thin.",
				"Do not call mutating tools. Tools may be empty.",
			].join("\n");
		case "PROPOSE":
			return [
				"PHASE=PROPOSE",
				"Form a reviewable candidate edit intent grounded in packet evidence.",
				"Mutating tool schemas (if present) are for naming proposals only — execution is refused until Apply Preview consent.",
			].join("\n");
		case "APPLY":
			return [
				"PHASE=APPLY",
				"Do not mutate. Tell the user to use the Edit Review / Apply Preview consent flow.",
			].join("\n");
		case "VERIFY":
			return [
				"PHASE=VERIFY",
				"Deterministic compositor/audio verify is authoritative. Do not invent pixel proof.",
			].join("\n");
	}
}

export function buildBoundedSystemPrompt(input: {
	phase: CognitionPhase;
	projectProjectionJson: string;
	editsAllowed: boolean;
	mutationMode?: "proposal_only" | "read_only" | "deterministic_edit" | "consented_apply";
}): string {
	const lines = [
		CORE_INVARIANTS,
		"",
		phasePolicy(input.phase),
		"",
		"Bounded project projection:",
		input.projectProjectionJson,
	];
	if (!input.editsAllowed) {
		lines.push("", "PROJECT EDITS DISABLED for agent tools this turn.");
	} else if (input.mutationMode === "proposal_only" || input.mutationMode === "read_only") {
		lines.push(
			"",
			"PROPOSAL_ONLY: do not call write tools. Never claim Project edits are disabled when Settings allows edits.",
			"Do not advertise unverified clip transitions.",
		);
	}
	return lines.join("\n");
}

/** Audit labels for the FULL BASE_SYSTEM_PROMPT (static). */
export const FULL_SYSTEM_SECTION_CLASSIFICATION = [
	{ id: "identity", class: "REQUIRED_FOR_REASONING" },
	{ id: "tool_recipe_map", class: "LEGACY" },
	{ id: "one_pass_finish_recipes", class: "LEGACY" },
	{ id: "trusted_editorial_chain", class: "REQUIRED_FOR_SAFETY" },
	{ id: "mutation_authority", class: "REQUIRED_FOR_SAFETY" },
	{ id: "evidence_contract", class: "REQUIRED_FOR_SAFETY" },
	{ id: "visual_semantic_emission", class: "REQUIRED_FOR_CURRENT_PHASE" },
	{ id: "source_target_story_emission", class: "REQUIRED_FOR_CURRENT_PHASE" },
	{ id: "open_project_full_json", class: "DUPLICATED" },
] as const;
