/**
 * Readable source/target story + diff for product evidence.
 */

import type { MultimodalSourceStoryV1, TargetEditStoryV1 } from "./types";

export function formatSourceStoryMarkdown(source: MultimodalSourceStoryV1): string {
	const lines: string[] = [
		`# Source Story`,
		``,
		`Asset: \`${source.assetId}\` · Duration: ${source.sourceDurationSec.toFixed(1)}s`,
		``,
		source.summary,
		``,
		`## Beats`,
		``,
	];
	for (const b of source.beats) {
		lines.push(
			`### ${b.id} — ${b.kind} (${b.sourceRange.startSec.toFixed(1)}–${b.sourceRange.endSec.toFixed(1)}s)`,
		);
		lines.push(`- Speech: ${b.speechSummary || "(none)"}`);
		lines.push(`- Density: ${b.informationDensity} · Preserve: ${b.preservationStatus}`);
		lines.push(`- Confidence: ${b.confidence}`);
		if (b.focalEvidenceRefs.length) lines.push(`- Focal refs: ${b.focalEvidenceRefs.join(", ")}`);
		lines.push(``);
	}
	return lines.join("\n");
}

export function formatTargetStoryMarkdown(target: TargetEditStoryV1): string {
	const lines: string[] = [
		`# Target Story`,
		``,
		`Goal: ${target.viewerGoal}`,
		`Arc: ${target.desiredArc}`,
		``,
		`## Beats`,
		``,
	];
	for (const b of target.beats) {
		const vt = b.visualTreatment;
		lines.push(`### ${b.id} — ${b.purpose}`);
		lines.push(`- Viewer should understand: ${b.viewerShouldUnderstand || "(unclear)"}`);
		lines.push(`- Pacing: ${b.pacingIntent} · Attention: ${b.attentionIntent}`);
		lines.push(
			`- Visual: framing=${vt.framing}, title=${vt.title}, callout=${vt.callout}, transition=${vt.transition}, speed=${vt.speedMultiplier}x`,
		);
		lines.push(`- Skills: ${b.skillHints.join(", ") || "(none)"}`);
		lines.push(``);
	}
	if (target.unsupportedDesiredSkills.length) {
		lines.push(`## Unsupported desired skills`);
		for (const u of target.unsupportedDesiredSkills) {
			lines.push(`- ${u.skill}: ${u.reason}`);
		}
	}
	return lines.join("\n");
}

export function formatStoryDiffMarkdown(
	source: MultimodalSourceStoryV1,
	target: TargetEditStoryV1,
): string {
	const lines: string[] = [`# Story Diff (Source → Target)`, ``];
	const n = Math.max(source.beats.length, target.beats.length);
	for (let i = 0; i < n; i += 1) {
		const s = source.beats[i];
		const t = target.beats[i];
		lines.push(`## Beat ${i + 1}`);
		if (s) {
			lines.push(
				`Source: ${s.kind} @ ${s.sourceRange.startSec.toFixed(1)}–${s.sourceRange.endSec.toFixed(1)}s — ${s.speechSummary || "(no speech)"}`,
			);
		} else lines.push(`Source: (none)`);
		if (t) {
			lines.push(
				`Target: ${t.pacingIntent} / ${t.attentionIntent} / title=${t.visualTreatment.title} / speed=${t.visualTreatment.speedMultiplier}x`,
			);
			lines.push(`Action: ${t.skillHints.join(" → ") || "LEAVE_UNCHANGED"}`);
		} else lines.push(`Target: (none)`);
		lines.push(``);
	}
	return lines.join("\n");
}
