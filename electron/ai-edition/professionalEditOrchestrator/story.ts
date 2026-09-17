/**
 * Target edit story — structural, not creative prose.
 */

import type {
	PackedEditorialTranscriptV1,
	ProfessionalEditIntentV1,
	ProfessionalEditStoryV1,
} from "./types";

export function buildProfessionalEditStory(args: {
	packed: PackedEditorialTranscriptV1;
	intent: ProfessionalEditIntentV1;
}): ProfessionalEditStoryV1 {
	const important = args.packed.segments.filter((s) => s.preservation === "important");
	const expendable = args.packed.segments.filter((s) => s.preservation === "expendable");
	const mustSurviveSpeech = important
		.map((s) => s.speechText.trim())
		.filter((t) => t.length > 0)
		.slice(0, 8);

	const expendablePauses = expendable
		.filter((s) => s.deadAirSec >= 0.4)
		.map((s) => ({
			startSec: s.startSec,
			endSec: s.endSec,
			reason: `low-activity / dead-air ~${s.deadAirSec}s`,
		}));

	const essentialRanges = important.map((s) => ({
		startSec: s.startSec,
		endSec: s.endSec,
		reason: "speech_content",
	}));

	const optionalRanges = args.packed.segments
		.filter((s) => s.preservation === "optional")
		.map((s) => ({
			startSec: s.startSec,
			endSec: s.endSec,
			reason: "light_speech_or_mixed",
		}));

	const uncertainRanges = args.packed.segments
		.filter((s) => s.preservation === "uncertain")
		.map((s) => ({
			startSec: s.startSec,
			endSec: s.endSec,
			reason: "insufficient_local_label",
		}));

	const communicates = mustSurviveSpeech.join(" ").slice(0, 280);

	return {
		version: 1,
		communicates,
		mustSurviveSpeech,
		expendablePauses,
		majorVisualStates: ["unknown_local"],
		targetDurationSec: args.intent.targetDurationMaxSec ?? args.intent.targetDurationSec,
		essentialRanges,
		optionalRanges,
		uncertainRanges,
		structureHint:
			args.intent.targetDurationMaxSec != null
				? `Prefer essential speech; remove safe pauses toward ≤${args.intent.targetDurationMaxSec}s without cutting important speech.`
				: "Tighten safe pauses; preserve important speech; optional captions/audio.",
	};
}
