/**
 * Build internal investigator briefing for the existing reasoning layer.
 * Never intended as the final user-facing answer.
 */

import type { InvestigationEvidenceSet } from "./types";

export function buildInvestigatorInternalBriefing(
	set: Omit<InvestigationEvidenceSet, "internalBriefing">,
): string {
	const lines: string[] = [
		"INVESTIGATOR_EVIDENCE_BRIEFING (internal — do not dump JSON or tool traces to the user)",
		`Focus: ${set.focusRange.startSourceTimeSec.toFixed(2)}s–${set.focusRange.endSourceTimeSec.toFixed(2)}s (${set.questionSummary})`,
		`Stop: ${set.stopReason}`,
		"Rules: observed visibility ≠ user action; spoken intent ≠ visually confirmed; pixel change ≠ named UI event; not observed ≠ did not happen unless coverage is strong.",
		"",
		"Observations:",
	];
	for (const o of set.observations.slice(0, 24)) {
		lines.push(`- [${o.kind}] ${o.text}`);
	}
	lines.push("", "Claim verdicts:");
	for (const c of set.claims.slice(0, 16)) {
		lines.push(`- (${c.verdict}) ${c.hypothesis} — ${c.rationale}`);
	}
	if (set.additionalFrames.length > 0) {
		lines.push(
			"",
			`Additional inspected stills attached: ${set.additionalFrames.length} (see images). Describe only what is visible; do not invent unseen labels.`,
		);
	}
	lines.push(
		"",
		"Respond to the user in calm natural prose only. No ledger IDs, no epistemic codes, no SOURCE_STORY labels.",
	);
	return lines.join("\n");
}

export function truncateBriefing(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, Math.max(0, maxChars - 20))}\n…[briefing truncated]`;
}

/** True if user-facing text looks like it leaked investigator internals. */
export function userFacingLeaksInvestigatorInternals(text: string): boolean {
	return (
		/INVESTIGATOR_EVIDENCE_BRIEFING/i.test(text) ||
		/\b(ic_\d+|obs_\d+|evt_\d+)\b/.test(text) ||
		/\b(get_events_in_range|inspect_video_range|insufficient_evidence)\b/i.test(text) ||
		/\bSOURCE_STORY\b/.test(text) ||
		/\bconfidence\s*=\s*0\.\d+/i.test(text)
	);
}
