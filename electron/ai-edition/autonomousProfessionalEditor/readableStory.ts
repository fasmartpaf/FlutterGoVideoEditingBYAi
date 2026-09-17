/**
 * Human-readable multimodal source story for product review.
 */

import type { MultimodalSourceStoryV1 } from "./types";

export function formatSourceStoryReadable(story: MultimodalSourceStoryV1): string {
	const lines: string[] = [
		`# Source story — ${story.assetId}`,
		``,
		`Duration: ~${story.sourceDurationSec.toFixed(1)}s`,
		``,
		story.summary,
		``,
		`## Beats`,
		``,
	];
	for (const b of story.beats) {
		lines.push(
			`### ${b.kind} (${b.sourceRange.startSec.toFixed(1)}s–${b.sourceRange.endSec.toFixed(1)}s)`,
		);
		lines.push(`- Speech: ${b.speechSummary}`);
		lines.push(`- Visual: ${b.visualState}`);
		lines.push(`- Density: ${b.informationDensity}; preserve: ${b.preservationStatus}`);
		if (b.importantActions.length) {
			lines.push(`- Actions: ${b.importantActions.join("; ")}`);
		}
		if (b.focalEvidenceRefs.length) {
			lines.push(`- Focal: ${b.focalEvidenceRefs.join(", ")}`);
		}
		lines.push(`- Confidence: ${b.confidence}`);
		lines.push("");
	}
	return lines.join("\n");
}
