/**
 * Bounded story-phase hints from packed transcript + visual intervals.
 * Deterministic — no LLM, no semantic certainty claims.
 */

import type { VisualChangeIntervalV1 } from "../editorialFocalEvidence";
import type {
	PackedEditorialTranscriptV1,
	ProfessionalEditStoryV1,
} from "../professionalEditOrchestrator/types";
import type { SourceRangeSec, StoryPhaseHint, StoryPhaseSegmentV1 } from "./types";

export function deriveStoryPhases(args: {
	packed: PackedEditorialTranscriptV1;
	story: ProfessionalEditStoryV1;
	visualIntervals?: VisualChangeIntervalV1[] | null;
	sourceDurationSec: number;
}): StoryPhaseSegmentV1[] {
	const dur = Math.max(0.1, args.sourceDurationSec);
	const out: StoryPhaseSegmentV1[] = [];

	// Intro / outro by position
	out.push({
		phase: "INTRO",
		sourceRange: { startSec: 0, endSec: Math.min(dur * 0.12, 3) },
		evidenceRefs: ["position:intro"],
	});
	out.push({
		phase: "OUTRO",
		sourceRange: { startSec: Math.max(0, dur - Math.min(dur * 0.12, 3)), endSec: dur },
		evidenceRefs: ["position:outro"],
	});

	for (const r of args.story.essentialRanges) {
		out.push({
			phase: "EXPLANATION",
			sourceRange: { ...r },
			evidenceRefs: ["story:essential", r.reason ?? ""],
		});
	}
	for (const p of args.story.expendablePauses) {
		out.push({
			phase: "WAITING",
			sourceRange: { startSec: p.startSec, endSec: p.endSec },
			evidenceRefs: ["story:expendable", p.reason],
		});
	}

	for (const v of args.visualIntervals ?? []) {
		if (v.kind === "stable" && v.endSec - v.startSec >= 2.5) {
			const range = { startSec: v.startSec, endSec: v.endSec };
			const speechSegs = args.packed.segments.filter((s) => s.speechText.trim().length > 0);
			let speechOv = 0;
			for (const s of speechSegs) {
				const a = Math.max(range.startSec, s.startSec);
				const b = Math.min(range.endSec, s.endSec);
				speechOv += Math.max(0, b - a);
			}
			const speechFrac = speechOv / Math.max(1e-6, range.endSec - range.startSec);
			// Presence of any STT overlap must not force EXPLANATION — require
			// substantial speech density before blocking speed as narration.
			const hasSubstantialSpeech = speechFrac > 0.4;
			out.push({
				phase: hasSubstantialSpeech ? "EXPLANATION" : "LOW_INFORMATION",
				sourceRange: { startSec: v.startSec, endSec: v.endSec },
				evidenceRefs: [
					`visual:${v.kind}`,
					hasSubstantialSpeech
						? `speech_overlap:${speechFrac.toFixed(2)}`
						: speechFrac > 0
							? `speech_fragment:${speechFrac.toFixed(2)}`
							: "no_speech",
				],
			});
		}
		if (v.kind === "activity") {
			out.push({
				phase: "IMPORTANT_ACTION",
				sourceRange: { startSec: v.startSec, endSec: v.endSec },
				evidenceRefs: ["visual:activity"],
			});
		}
	}

	return out;
}

export function dominantPhaseAt(
	phases: StoryPhaseSegmentV1[],
	range: SourceRangeSec,
): StoryPhaseHint {
	let best: StoryPhaseHint = "UNKNOWN";
	let bestOverlap = 0;
	for (const p of phases) {
		const start = Math.max(p.sourceRange.startSec, range.startSec);
		const end = Math.min(p.sourceRange.endSec, range.endSec);
		const ov = Math.max(0, end - start);
		if (ov > bestOverlap) {
			bestOverlap = ov;
			best = p.phase;
		}
	}
	return best;
}
