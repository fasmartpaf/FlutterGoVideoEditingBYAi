/**
 * Join investigation artifact (QC debugging) — local JSON only.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FinalSequenceJoinVerificationV1 } from "./types";

export function buildJoinInvestigationArtifact(args: {
	verification: FinalSequenceJoinVerificationV1;
	pcmSummary?: Record<string, number | string | null>;
	frameLabels?: string[];
}): Record<string, unknown> {
	const v = args.verification;
	return {
		joinId: v.join.joinId,
		programmeTimeSec: v.join.programmeTimeSec,
		cause: v.join.cause,
		editCreated: v.join.editCreated,
		leftSourceRange: v.join.leftSourceRange,
		rightSourceRange: v.join.rightSourceRange,
		speechWords: v.join.speechContext,
		captionCues: v.join.captionContext,
		pcmSummary: args.pcmSummary ?? v.audio.metrics ?? null,
		frameLabels: args.frameLabels ?? [],
		overall: v.overall,
		blockingReasons: v.blockingReasons,
		warnings: v.warnings,
		modalities: {
			speech: v.speech.outcome,
			audio: v.audio.outcome,
			visual: v.visual.outcome,
			caption: v.caption.outcome,
			preservation: v.preservation.outcome,
		},
	};
}

export function writeJoinInvestigationArtifact(args: {
	verification: FinalSequenceJoinVerificationV1;
	outDir: string;
	pcmSummary?: Record<string, number | string | null>;
}): string {
	mkdirSync(args.outDir, { recursive: true });
	const path = join(args.outDir, `${args.verification.join.joinId}.json`);
	writeFileSync(
		path,
		JSON.stringify(
			buildJoinInvestigationArtifact({
				verification: args.verification,
				pcmSummary: args.pcmSummary,
			}),
			null,
			2,
		),
	);
	return path;
}
