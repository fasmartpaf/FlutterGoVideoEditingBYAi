/**
 * Packed editorial transcript — bounded planning projection from local evidence.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { DeadAirCandidateV1 } from "../deadAir";
import type { PackedEditorialSegmentV1, PackedEditorialTranscriptV1 } from "./types";

function wordsInRange(doc: AxcutDocument, assetId: string, start: number, end: number): string {
	const tr =
		doc.transcripts.find((t) => t.assetId === assetId) ??
		doc.transcripts[0] ??
		(doc.transcript?.assetId === assetId || !doc.transcript?.assetId ? doc.transcript : null);
	if (!tr) return "";
	if (tr.words?.length) {
		return tr.words
			.filter((w) => w.endSec > start && w.startSec < end && w.text.trim())
			.map((w) => w.text)
			.join(" ")
			.slice(0, 220);
	}
	// Segment fallback when word timings are absent — STT presence still counts.
	return (tr.segments ?? [])
		.filter(
			(s) =>
				s.endSec > start && s.startSec < end && (s.kind === "speech" || Boolean(s.text?.trim())),
		)
		.map((s) => s.text ?? "")
		.join(" ")
		.slice(0, 220);
}

export function buildPackedEditorialTranscript(args: {
	document: AxcutDocument;
	assetId: string;
	sourceDurationSec: number;
	deadAirCandidates?: DeadAirCandidateV1[];
	bucketSec?: number;
}): PackedEditorialTranscriptV1 {
	const t0 = Date.now();
	const bucket = args.bucketSec ?? 2;
	const dur = Math.max(0.1, args.sourceDurationSec);
	const segments: PackedEditorialSegmentV1[] = [];
	const dead = args.deadAirCandidates ?? [];

	for (let start = 0, i = 0; start < dur - 1e-6; start += bucket, i += 1) {
		const end = Math.min(dur, start + bucket);
		const speechText = wordsInRange(args.document, args.assetId, start, end);
		const overlapping = dead.filter(
			(c) => c.silenceRange.endSec > start && c.silenceRange.startSec < end,
		);
		const deadAirSec = overlapping.reduce((n, c) => n + c.silenceDurationSec, 0);
		const hasSpeech = speechText.trim().length > 0;
		const preservation =
			hasSpeech && speechText.trim().split(/\s+/).length >= 3
				? "important"
				: deadAirSec >= 0.6 && !hasSpeech
					? "expendable"
					: hasSpeech
						? "optional"
						: "uncertain";

		segments.push({
			id: `pes_${i}`,
			startSec: start,
			endSec: end,
			speechText,
			visualSummary: "unknown_local",
			activity: overlapping.some((c) => c.visualActivity?.length)
				? "medium"
				: deadAirSec > 0.4
					? "none"
					: "unknown",
			deadAirSec: Math.round(deadAirSec * 100) / 100,
			preservation,
			evidenceRefs: overlapping.map((c) => `dead_air:${c.id}`),
		});
	}

	return {
		version: 1,
		assetId: args.assetId,
		sourceDurationSec: dur,
		segments,
		buildMs: Date.now() - t0,
	};
}
