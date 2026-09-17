/**
 * Constrained Target Story V1 prompt — same turn as Source Story.
 */

import { userFacingMediaNarrationGuidance } from "../../userFacingNarration";
import type { EditingIntent } from "../types";
import type { TargetStoryV1 } from "./types";

function formatTargetConstraints(story: TargetStoryV1): string {
	const lines: string[] = [
		"TARGET_STORY_V1_EVIDENCE (authoritative viewer-experience constraints)",
		`provider=${story.providerId}`,
		`viewerGoal: ${story.viewerGoal}`,
		`communicationGoal: ${story.communicationGoal}`,
		`desiredArc: ${story.desiredArc}`,
		`objectiveKind: ${story.objectiveKind}`,
		`pacingIntent: ${story.pacingIntent}`,
		`uncertaintyPolicy: ${story.uncertaintyPolicy}`,
		"",
		"TARGET_BEATS (must map to listed sourceBeatIds):",
	];
	for (const b of story.targetBeats) {
		lines.push(
			`  ${b.id} ← source[${b.sourceBeatIds.join(",")}] purpose=${b.purpose} disposition=${b.disposition} pacing=${b.pacingIntent}`,
		);
		lines.push(`    viewerShouldUnderstand: ${b.viewerShouldUnderstand}`);
		if (b.emphasize.length) lines.push(`    emphasize: ${b.emphasize.join(" | ")}`);
		if (b.deEmphasize.length) lines.push(`    deEmphasize: ${b.deEmphasize.join(" | ")}`);
	}
	lines.push("", "PRESERVE:");
	for (const p of story.preserve.slice(0, 12)) {
		lines.push(`  - ${p.text}`);
	}
	lines.push("", "DE_EMPHASIZE:");
	for (const p of story.deEmphasize.slice(0, 12)) {
		lines.push(`  - ${p.text}`);
	}
	lines.push("", "REMOVE_CANDIDATE (editorial candidate only — NOT a trim/cut command):");
	for (const p of story.removeCandidates.slice(0, 12)) {
		lines.push(`  - ${p.text} (${p.reason})`);
	}
	if (story.unsupportedRequests.length) {
		lines.push("", "REQUESTED_BUT_NOT_SOURCE_SUPPORTED:");
		for (const u of story.unsupportedRequests) {
			lines.push(`  - ${u.requestText}: ${u.note}`);
		}
	}
	if (story.unresolved.length) {
		lines.push("", "UNRESOLVED / HONESTY CONSTRAINTS:");
		for (const u of story.unresolved.slice(0, 12)) {
			lines.push(`  - [${u.kind}] ${u.text}`);
		}
	}
	lines.push(
		"",
		"HARD RULES:",
		"- Describe desired VIEWER EXPERIENCE only — never tool commands, zoom%, trim seconds, crop, transitions-as-effects, captions-as-tools.",
		"- Never turn passive Upwork/tab context into a workflow goal unless user explicitly asked and it is marked unsupported.",
		"- Never treat unknown restart/Settings/panel-open actions as completed story goals.",
		"- Every targetBeat.sourceBeatIds must come from Source Story V2 beat ids listed above.",
		"- REMOVE_CANDIDATE ≠ execute trim.",
	);
	return lines.join("\n");
}

export function buildTargetStoryV1PromptSection(input: {
	targetV1: TargetStoryV1;
	userMessage: string;
	intentHints: EditingIntent;
}): string {
	const constrained = formatTargetConstraints(input.targetV1);
	return [
		"",
		"TARGET STORY V1 (same turn — AFTER SOURCE_STORY, before final user-facing answer)",
		"Define the DESIRED VIEWER EXPERIENCE for the user's editing request.",
		"This is editorial direction — NOT trim/zoom/crop/transition/tool commands, NOT an edit list, NOT Axcut mutations.",
		"Do not run editing tools or mutate the timeline in this step.",
		"Do NOT invent source content.",
		"",
		constrained,
		"",
		"User-intent hints:",
		`- objective: ${input.intentHints.objective}`,
		`- constraints: ${input.intentHints.constraints.join("; ") || "(none)"}`,
		`- qualities: ${input.intentHints.desiredQualities.join("; ")}`,
		`- preserveMeaning: ${input.intentHints.preserveMeaning}`,
		`- user request: ${input.userMessage.slice(0, 240)}`,
		"",
		userFacingMediaNarrationGuidance(),
		"",
		"Emit ONE fenced JSON block TARGET_STORY (compatible schema):",
		"```json",
		"{",
		`  "objective": ${JSON.stringify(input.targetV1.viewerGoal)},`,
		'  "audienceExperience": "how the finished piece should feel",',
		`  "style": { "pacing": "${input.targetV1.pacingIntent}", "density": "balanced", "tone": "optional" },`,
		'  "editingIntent": {',
		`    "objective": "${input.targetV1.objectiveKind}",`,
		`    "constraints": ${JSON.stringify(input.intentHints.constraints)},`,
		`    "desiredQualities": ${JSON.stringify(input.intentHints.desiredQualities)},`,
		`    "preserveMeaning": ${input.intentHints.preserveMeaning}`,
		"  },",
		'  "targetBeats": [{ "id": "t1", "sourceBeatIds": ["sb1"], "purpose": "intro", "desiredOutcome": "...", "importance": "essential", "pacing": "preserve", "changeNeeded": false, "rationale": "..." }],',
		'  "preserve": [{ "id": "p1", "description": "..." }],',
		'  "change": [{ "id": "c1", "description": "editorial intention only", "rationale": "..." }],',
		'  "uncertainties": [{ "note": "...", "relatedSourceBeatIds": [] }]',
		"}",
		"```",
		"Prefer paraphrasing TARGET_STORY_V1_EVIDENCE. Do not invent Upwork workflows, restart actions, or Settings completion.",
		"Then answer the user about editorial direction in natural language — still no tool commands.",
	].join("\n");
}
