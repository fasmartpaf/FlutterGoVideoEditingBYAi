/**
 * Constrained evidence block for the same-turn LLM narrative.
 * Model may group/summarize; must not invent unsupported actions.
 */

import { userFacingMediaNarrationGuidance } from "../../userFacingNarration";
import { formatSourceStoryScaffoldText } from "../scaffold";
import type { SourceStoryScaffold } from "../types";
import type { SourceStoryV2 } from "./types";

function formatConstrainedFacts(story: SourceStoryV2): string {
	const lines: string[] = [
		"SOURCE_STORY_V2_EVIDENCE (authoritative — do not invent beyond this)",
		`provider=${story.providerId}`,
		`duration=${story.sourceDurationSec}s speechStatus=${story.speechStatus}`,
		`mediaSummary: ${story.mediaSummary}`,
		"",
		"ALLOWED_STORY_FACTS (epistemic labeled):",
	];
	for (const b of story.beats) {
		lines.push(
			`BEAT ${b.id} [${b.startSourceTimeSec.toFixed(2)}–${b.endSourceTimeSec.toFixed(2)}s] importance=${b.importance.toFixed(1)} (${b.importanceReasons.join(",")})`,
		);
		lines.push(`  constrainedSummary: ${b.summary}`);
		for (const f of b.facts) {
			lines.push(`  FACT [${f.epistemic}]: ${f.text}`);
		}
		for (const c of b.context) {
			lines.push(`  CONTEXT [${fEp(c.epistemic)}] (NOT an action): ${c.text}`);
		}
		for (const s of b.spoken) {
			lines.push(`  SPOKEN [${s.epistemic}/${s.kind}]: ${s.text}`);
		}
		for (const a of b.actions) {
			lines.push(`  UNRESOLVED_ACTION [unknown]: ${a.text} — MUST NOT narrate as performed`);
		}
		for (const x of b.contradictions) {
			lines.push(`  CONTRADICTION [contradicted]: ${x.text}`);
		}
		for (const u of b.uncertainties) {
			lines.push(`  UNKNOWN: ${u.text}`);
		}
	}
	if (story.persistentContext.length) {
		lines.push("", "PERSISTENT_CONTEXT (visibility only — never user action):");
		for (const c of story.persistentContext) {
			lines.push(`  - [${c.epistemic}] ${c.text}`);
		}
	}
	if (story.corrections.length) {
		lines.push("", "CORRECTIONS (supersede earlier spoken intention for narrative):");
		for (const c of story.corrections) {
			lines.push(`  - from “${c.fromText.slice(0, 80)}” → “${c.toText.slice(0, 80)}”`);
		}
	}
	if (story.contradictions.length) {
		lines.push("", "CONTRADICTIONS:");
		for (const c of story.contradictions) {
			lines.push(
				`  - ${c.claim} (${c.supportingModality} vs ${c.conflictingModality}; ${c.resolutionStatus})`,
			);
		}
	}
	if (story.unresolved.length) {
		lines.push("", "UNRESOLVED (retain as UNKNOWN — do not promote):");
		for (const u of story.unresolved.slice(0, 12)) {
			lines.push(`  - ${u.text}`);
		}
	}
	lines.push(
		"",
		"HARD RULES:",
		"- Visible app/tab/text = CONTEXT, not opened/worked/navigated.",
		"- OCR text ≠ click/restart/save/submit.",
		"- Speech intention ≠ visually performed action.",
		"- Corrected spoken intent: treat earlier intent as superseded.",
		"- Contradictions must appear as unresolved/contradicted, not as facts.",
		"- Prefer SOURCE_STORY beat summaries that paraphrase ALLOWED facts only.",
		"- Do not invent visual actions to match narration when visuals are stable.",
	);
	return lines.join("\n");
}

function fEp(e: string): string {
	return e;
}

/**
 * V2 prompt: constrained evidence + legacy scaffold + SOURCE_STORY JSON request.
 * Still same-turn LLM for narrative grouping (not a second call).
 */
export function buildSourceStoryV2PromptSection(input: {
	storyV2: SourceStoryV2;
	scaffold: SourceStoryScaffold;
}): string {
	const constrained = formatConstrainedFacts(input.storyV2);
	const scaffoldText = formatSourceStoryScaffoldText(input.scaffold);
	return [
		"",
		"SOURCE STORY V2 (same turn — evidence-grounded)",
		"Build INTERNAL chronological Source Story JSON. Truth is constrained by SOURCE_STORY_V2_EVIDENCE below.",
		"You may group topics and write concise summaries, but MUST NOT invent actions or visual facts absent from ALLOWED lists.",
		"This is NOT Target Story / edit plan.",
		"",
		constrained,
		"",
		"Legacy multimodal timing scaffold (timestamps only — not permission to invent actions):",
		scaffoldText,
		"",
		"Emit ONE fenced JSON block SOURCE_STORY (compatible schema):",
		"```json",
		"{",
		`  "sourceDurationSec": ${input.scaffold.sourceDurationSec},`,
		'  "overallSummary": "evidence-grounded stages; mark contradictions/unknowns honestly",',
		'  "contentType": "tutorial|demo|presentation|screen_recording|talking_head|mixed|unknown",',
		'  "primaryGoal": "optional",',
		'  "storyBeats": [{',
		'    "id": "b1",',
		'    "startSourceTimeSec": 0,',
		'    "endSourceTimeSec": 1,',
		'    "purpose": "intro|setup|explanation|demonstration|navigation|transition|result|pause|repetition|correction|outro|unknown",',
		'    "summary": "only from ALLOWED facts/context/spoken — never unverified actions",',
		'    "spokenMeaning": "optional spoken-only",',
		'    "visualMeaning": "optional — only ALLOWED visual facts/context",',
		'    "interactionMeaning": "optional — only if VERIFIED action exists (rare)",',
		'    "evidence": { "speechSegmentIds": ["s1"], "visualTimes": [], "cursorEventTimes": [] },',
		'    "confidence": "high|medium|low"',
		"  }],",
		'  "unresolvedEvidence": [{ "note": "unknown/contradicted actions" }]',
		"}",
		"```",
		userFacingMediaNarrationGuidance(),
		"- Do NOT show SOURCE_STORY JSON / epistemic labels to the user unless asked for raw/debug.",
		"Then answer the user in natural language.",
	].join("\n");
}
