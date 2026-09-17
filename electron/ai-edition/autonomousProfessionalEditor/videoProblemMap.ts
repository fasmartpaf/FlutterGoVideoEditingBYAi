/**
 * VideoProblemMapV1 — beat-level editorial problems (not tool availability).
 */

import type { DeadAirCandidateV1 } from "../deadAir";
import type { EditorialFocalAnalysisBundleV1 } from "../editorialFocalEvidence";
import type { MultimodalSourceStoryV1, TargetEditStoryV1 } from "./types";

export type VideoProblemKindV1 =
	| "NO_PROBLEM"
	| "DEAD_AIR"
	| "EXCESSIVE_PAUSE"
	| "HESITATION"
	| "REPETITION"
	| "LOW_INFORMATION_WAIT"
	| "SLOW_NAVIGATION"
	| "IMPORTANT_ACTION"
	| "IMPORTANT_EXPLANATION"
	| "FOCAL_ACTION"
	| "VISUAL_DISTRACTION"
	| "WEAK_FRAMING"
	| "STATIC_TOO_LONG"
	| "TOPIC_INTRODUCTION"
	| "SECTION_CHANGE"
	| "ENDING_DEAD_AIR"
	| "OTHER_GROUNDED_PROBLEM";

export type VideoProblemDecisionV1 = "APPLY" | "KEEP" | "INSUFFICIENT_EVIDENCE";

export interface VideoProblemV1 {
	id: string;
	kind: VideoProblemKindV1;
	sourceBeatId: string;
	sourceRange: { startSec: number; endSec: number };
	programmeRange?: { startSec: number; endSec: number };
	evidenceRefs: string[];
	confidence: "HIGH" | "MEDIUM" | "LOW";
	whyItHurtsTheVideo: string;
	preservationRequirements: string[];
	desiredViewerExperience: string;
	possibleEditFamily:
		| "trim"
		| "speed"
		| "zoom"
		| "title"
		| "callout"
		| "captions"
		| "loudness"
		| "none";
	decision: VideoProblemDecisionV1;
	decisionReason: string;
}

export interface VideoProblemMapV1 {
	version: 1;
	assetId: string;
	problems: VideoProblemV1[];
	metrics: { buildMs: number; problemCount: number; applyCount: number };
}

function overlap(
	a: { startSec: number; endSec: number },
	b: { startSec: number; endSec: number },
): number {
	return Math.max(0, Math.min(a.endSec, b.endSec) - Math.max(a.startSec, b.startSec));
}

export function buildVideoProblemMap(args: {
	source: MultimodalSourceStoryV1;
	target: TargetEditStoryV1;
	deadAir?: DeadAirCandidateV1[] | null;
	focal?: EditorialFocalAnalysisBundleV1 | null;
}): VideoProblemMapV1 {
	const t0 = Date.now();
	const problems: VideoProblemV1[] = [];
	let seq = 0;
	const id = (k: string) => {
		seq += 1;
		return `vprob_${k}_${seq}`;
	};

	for (const beat of args.source.beats) {
		const targetBeat = args.target.beats.find((b) => b.sourceBeatIds.includes(beat.id));
		const range = beat.sourceRange;
		const overlappingAir = (args.deadAir ?? []).filter(
			(c) =>
				overlap(range, {
					startSec: c.silenceRange.startSec,
					endSec: c.silenceRange.endSec,
				}) > 0.2,
		);
		const focalHit =
			args.focal?.zoomDecision?.decision === "ZOOM_ELIGIBLE" &&
			args.focal.zoomDecision.geometry &&
			overlap(range, {
				startSec: args.focal.zoomDecision.geometry.sourceStartSec,
				endSec: args.focal.zoomDecision.geometry.sourceEndSec,
			}) > 0.15;

		if (beat.kind === "OPENING_SETUP" || (beat === args.source.beats[0] && beat.speechSummary)) {
			const titleWanted = targetBeat?.visualTreatment.title === "OPENING_TITLE";
			problems.push({
				id: id("intro"),
				kind: "TOPIC_INTRODUCTION",
				sourceBeatId: beat.id,
				sourceRange: { ...range },
				evidenceRefs: beat.evidenceRefs.slice(0, 4),
				confidence: beat.speechSummary.trim().length > 12 ? "MEDIUM" : "LOW",
				whyItHurtsTheVideo: "Viewer may lack a clear topic label at the start",
				preservationRequirements: ["do_not_invent_product_claims"],
				desiredViewerExperience: "Immediate orientation to what will be demonstrated",
				possibleEditFamily: "title",
				decision: titleWanted ? "INSUFFICIENT_EVIDENCE" : "KEEP",
				decisionReason: titleWanted
					? "Title only if grounded non-filler meaning exists (gate downstream)"
					: "No title treatment requested for this beat",
			});
		}

		for (const air of overlappingAir) {
			const safe = air.safeToPropose === true;
			const trailing = air.classification === "TRAILING_SILENCE";
			problems.push({
				id: id("pause"),
				kind: trailing
					? "ENDING_DEAD_AIR"
					: air.classification === "INTER_SENTENCE_PAUSE"
						? "EXCESSIVE_PAUSE"
						: "DEAD_AIR",
				sourceBeatId: beat.id,
				sourceRange: {
					startSec: air.silenceRange.startSec,
					endSec: air.silenceRange.endSec,
				},
				evidenceRefs: [`dead_air:${air.id}`, air.classification],
				confidence:
					air.confidence === "high" ? "HIGH" : air.confidence === "medium" ? "MEDIUM" : "LOW",
				whyItHurtsTheVideo: trailing
					? "Trailing silence delays a clean ending"
					: "Pause slows pacing without adding comprehension",
				preservationRequirements: ["preserve_word_boundaries", "keep_breath_if_shorten"],
				desiredViewerExperience: safe
					? "Tighter pacing while keeping a natural breath"
					: "Natural timing retained where speech/visual needs it",
				possibleEditFamily: "trim",
				decision: safe ? "APPLY" : "KEEP",
				decisionReason: safe
					? "Safe shorten/remove available under dead-air policy"
					: (air.blockingReasons?.[0] ?? "Not safe to propose"),
			});
		}

		if (
			beat.kind === "WAITING_REPETITION" ||
			(beat.informationDensity === "LOW" && beat.preservationStatus === "SAFE_TO_TIGHTEN")
		) {
			const wantSpeed = targetBeat?.pacingIntent === "ACCELERATE";
			problems.push({
				id: id("wait"),
				kind: beat.kind === "WAITING_REPETITION" ? "SLOW_NAVIGATION" : "LOW_INFORMATION_WAIT",
				sourceBeatId: beat.id,
				sourceRange: { ...range },
				evidenceRefs: beat.evidenceRefs.slice(0, 4),
				confidence: "MEDIUM",
				whyItHurtsTheVideo: "Viewer waits through low-information progression",
				preservationRequirements: ["do_not_speed_important_narration"],
				desiredViewerExperience: "Faster progress through waiting/navigation",
				possibleEditFamily: "speed",
				decision: wantSpeed ? "APPLY" : "KEEP",
				decisionReason: wantSpeed
					? "Target story asks ACCELERATE — compiler still requires grounded stable span"
					: "Target story does not request acceleration",
			});
		}

		if (beat.kind === "ACTION_DEMONSTRATION" || beat.focalEvidenceRefs.length > 0 || focalHit) {
			problems.push({
				id: id("focal"),
				kind: focalHit ? "FOCAL_ACTION" : "IMPORTANT_ACTION",
				sourceBeatId: beat.id,
				sourceRange: { ...range },
				evidenceRefs: [
					...beat.focalEvidenceRefs.slice(0, 3),
					...(focalHit ? [args.focal!.zoomDecision!.targetId ?? "zoom_eligible"] : []),
				],
				confidence: focalHit ? "HIGH" : beat.focalEvidenceRefs.length ? "MEDIUM" : "LOW",
				whyItHurtsTheVideo: "Important interaction may be easy to miss at full frame",
				preservationRequirements: ["no_speculative_geometry"],
				desiredViewerExperience: "Clear visual emphasis on the demonstrated control",
				possibleEditFamily: "zoom",
				decision: focalHit ? "APPLY" : "INSUFFICIENT_EVIDENCE",
				decisionReason: focalHit
					? "ZOOM_ELIGIBLE grounded focal"
					: "No ZOOM_ELIGIBLE geometry for this beat",
			});
		}

		if (beat.kind === "EXPLANATION" || beat.preservationStatus === "MUST_SURVIVE") {
			problems.push({
				id: id("explain"),
				kind: "IMPORTANT_EXPLANATION",
				sourceBeatId: beat.id,
				sourceRange: { ...range },
				evidenceRefs: beat.evidenceRefs.slice(0, 3),
				confidence: "HIGH",
				whyItHurtsTheVideo: "Cutting or speeding this would harm comprehension",
				preservationRequirements: ["must_survive_speech", "normal_pacing"],
				desiredViewerExperience: "Preserve explanation at natural speed",
				possibleEditFamily: "none",
				decision: "KEEP",
				decisionReason: "Preservation beat — no mutation",
			});
		}

		if (problems.filter((p) => p.sourceBeatId === beat.id).length === 0) {
			problems.push({
				id: id("ok"),
				kind: "NO_PROBLEM",
				sourceBeatId: beat.id,
				sourceRange: { ...range },
				evidenceRefs: [],
				confidence: "MEDIUM",
				whyItHurtsTheVideo: "No grounded pacing/attention problem detected",
				preservationRequirements: [],
				desiredViewerExperience: "Leave unchanged",
				possibleEditFamily: "none",
				decision: "KEEP",
				decisionReason: "No problem",
			});
		}
	}

	return {
		version: 1,
		assetId: args.source.assetId,
		problems,
		metrics: {
			buildMs: Date.now() - t0,
			problemCount: problems.filter((p) => p.kind !== "NO_PROBLEM").length,
			applyCount: problems.filter((p) => p.decision === "APPLY").length,
		},
	};
}
