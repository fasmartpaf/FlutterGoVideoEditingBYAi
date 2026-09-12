/**
 * Prompt section asking the SAME model turn to emit TARGET_STORY after SOURCE_STORY.
 * EditingContext only. Not an edit plan / tool list.
 */

import { userFacingMediaNarrationGuidance } from "../userFacingNarration";
import { inferEditingIntentHints } from "./intent";
import type { EditingIntent } from "./types";

export function buildTargetStoryPromptSection(input: {
	userMessage: string;
	intentHints?: EditingIntent;
}): string {
	const hints = input.intentHints ?? inferEditingIntentHints(input.userMessage);
	return [
		"",
		"TARGET STORY (same turn — required AFTER SOURCE_STORY, before your final user-facing answer)",
		"Given SOURCE_STORY + the user's editing request, define the DESIRED VIEWER EXPERIENCE.",
		"This is editorial direction — NOT trim/zoom/crop/transition/tool commands, NOT an edit list.",
		"Do NOT execute edits. Do NOT invent source content that does not exist in SOURCE_STORY.",
		"",
		"Reasoning order in this turn:",
		"1) Emit SOURCE_STORY (understand what exists).",
		"2) Emit TARGET_STORY (define what the finished video should communicate).",
		"3) Answer the user in natural prose about the editorial direction (no JSON).",
		userFacingMediaNarrationGuidance(),
		"",
		"User-intent hints (deterministic; refine from the actual request + Source Story):",
		`- suggested objective kind: ${hints.objective}`,
		`- suggested constraints: ${hints.constraints.length ? hints.constraints.join("; ") : "(none explicit)"}`,
		`- desired qualities: ${hints.desiredQualities.join("; ")}`,
		`- preserveMeaning bias: ${hints.preserveMeaning}`,
		"",
		"Rules:",
		"- User constraints dominate (e.g. keep everything / don't over-edit / keep spoken explanation).",
		"- Same Source Story + different requests must produce different Target Stories.",
		"- Map every target beat to sourceBeatIds from SOURCE_STORY whenever possible.",
		"- changeNeeded:false is first-class when a source beat already satisfies the goal (do not force changes).",
		"- A pause/gap is NOT automatically 'remove it'. A static section is NOT automatically 'speed up'.",
		"- An app switch is NOT automatically 'add a transition effect'. Cursor motion is NOT automatically 'zoom'.",
		"- Do not invent missing introductions, testimonials, results, or spoken lines.",
		"- If the user goal cannot be supported by the source (e.g. testimonial from a code walkthrough), record uncertainties — do not fabricate material.",
		"- Keep chronological order of source beats by default. Reordering requires reorderJustification.",
		"- Forbidden in Target Story text: zoom %, crop coords, trim/cut seconds, dissolve/wipe, saturation/EQ, 'add lower third', tool names as commands.",
		"- Allowed: viewer-experience outcomes like 'keep attention on the relevant code while it is explained'.",
		"- After both JSON blocks, answer naturally. Do NOT show TARGET_STORY / SOURCE_STORY JSON unless the user asks for raw/structured data.",
		"",
		"Emit ONE fenced JSON block for TARGET_STORY:",
		"```json",
		"{",
		'  "objective": "short statement of the finished-video goal",',
		'  "audienceExperience": "how the finished piece should feel to a viewer",',
		'  "style": { "pacing": "slower|balanced|faster", "density": "minimal|balanced|rich", "tone": "optional" },',
		'  "editingIntent": {',
		'    "objective": "polish|shorten|clarify|focus|restructure|repurpose|custom",',
		'    "constraints": ["explicit user constraints"],',
		'    "desiredQualities": ["clarity", "..."],',
		'    "preserveMeaning": true',
		"  },",
		'  "targetBeats": [{',
		'    "id": "t1",',
		'    "sourceBeatIds": ["b1"],',
		'    "purpose": "hook|intro|setup|explanation|demonstration|transition|result|outro|other",',
		'    "desiredOutcome": "viewer-facing outcome for this phase",',
		'    "importance": "essential|supporting|optional",',
		'    "pacing": "compress|preserve|expand_attention",',
		'    "changeNeeded": false,',
		'    "rationale": "why preserve or change",',
		'    "reorderJustification": "only if reordering source chronology"',
		"  }],",
		'  "preserve": [{ "id": "p1", "description": "what must remain" }],',
		'  "change": [{ "id": "c1", "description": "editorial intention only", "rationale": "why" }],',
		'  "uncertainties": [{ "note": "source limitation if any", "relatedSourceBeatIds": [] }]',
		"}",
		"```",
		"Enums must be exact snake_case / listed tokens. changeNeeded must be boolean.",
		"Then answer the user request in natural language about editorial direction — still no tool commands.",
	].join("\n");
}
