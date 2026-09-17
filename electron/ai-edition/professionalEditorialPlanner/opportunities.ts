/**
 * Opportunity generators — consume existing detector outputs.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type {
	MultimodalSourceStoryV1,
	TargetEditStoryV1,
} from "../autonomousProfessionalEditor/types";
import type { DeadAirCandidateV1 } from "../deadAir";
import type {
	EditorialFocalAnalysisBundleV1,
	VisualChangeIntervalV1,
} from "../editorialFocalEvidence";
import type {
	PackedEditorialTranscriptV1,
	ProfessionalEditStoryV1,
} from "../professionalEditOrchestrator/types";
import {
	carveAroundSpeech,
	speechOverlapFraction as effectiveSpeechOverlapFraction,
	effectiveSpeechRanges,
} from "../temporalPacing/speechEffective";
import type { GpuBackend } from "../transitionLibrary";
import { decideAutonomousTransitions } from "../transitionLibrary/autonomousIntelligence";
import { PLANNER_POLICY_V1 } from "./policy";
import { dominantPhaseAt } from "./storyPhases";
import { deriveProfessionalTitleText, shouldProposeOpeningTitle } from "./titleQuality";
import type {
	ProfessionalEditorialOpportunityV1,
	SourceRangeSec,
	StoryPhaseSegmentV1,
} from "./types";

let seq = 0;
export function resetPlannerOpportunitySeqForTests(): void {
	seq = 0;
}
function oid(family: string): string {
	seq += 1;
	return `peo_${family}_${seq}`;
}

function overlapFrac(a: SourceRangeSec, b: SourceRangeSec): number {
	const start = Math.max(a.startSec, b.startSec);
	const end = Math.min(a.endSec, b.endSec);
	const ov = Math.max(0, end - start);
	const dur = Math.max(1e-6, a.endSec - a.startSec);
	return ov / dur;
}

function overlapSeconds(a: SourceRangeSec, b: SourceRangeSec): number {
	return Math.max(0, Math.min(a.endSec, b.endSec) - Math.max(a.startSec, b.startSec));
}

function speechWindows(
	packed: PackedEditorialTranscriptV1,
	document?: {
		transcripts?: Array<{
			segments?: Array<{ startSec: number; endSec: number; text?: string; kind?: string }>;
		}>;
		transcript?: {
			segments?: Array<{ startSec: number; endSec: number; text?: string; kind?: string }>;
		} | null;
	},
): SourceRangeSec[] {
	const fromPacked = packed.segments
		.filter((s) => s.speechText.trim().length > 0)
		.map((s) => ({ startSec: s.startSec, endSec: s.endSec }));
	if (fromPacked.length > 0) return fromPacked;
	const segs = document?.transcripts?.[0]?.segments ?? document?.transcript?.segments ?? [];
	return segs
		.filter((s) => (s.text ?? "").trim().length > 0 || s.kind === "speech")
		.map((s) => ({ startSec: s.startSec, endSec: s.endSec }));
}

function speechOverlapFraction(range: SourceRangeSec, speech: SourceRangeSec[]): number {
	return effectiveSpeechOverlapFraction(range, speech);
}

function silenceRangesFromDeadAir(
	deadAir: DeadAirCandidateV1[] | null | undefined,
): SourceRangeSec[] {
	return (deadAir ?? []).map((c) => ({
		startSec: c.silenceRange.startSec,
		endSec: c.silenceRange.endSec,
	}));
}

function pushSpeedReady(
	out: ProfessionalEditorialOpportunityV1[],
	args: {
		range: SourceRangeSec;
		speechOv: number;
		phase: StoryPhaseSegmentV1["phase"] | undefined;
		reason: string;
		evidenceRefs: string[];
		refined?: boolean;
	},
): void {
	const span = args.range.endSec - args.range.startSec;
	let speed = PLANNER_POLICY_V1.speedRates.mild;
	if (span >= PLANNER_POLICY_V1.strongSpeedMinSpanSec && args.speechOv < 0.02) {
		speed = PLANNER_POLICY_V1.speedRates.strong;
	} else if (span >= PLANNER_POLICY_V1.mediumSpeedMinSpanSec && args.speechOv < 0.05) {
		speed = PLANNER_POLICY_V1.speedRates.medium;
	}
	const saved = span - span / speed;
	if (saved < PLANNER_POLICY_V1.minSpeedBenefitSec) {
		out.push({
			id: oid("speed"),
			family: "SPEED",
			sourceRange: { ...args.range },
			editorialReason: "Speed span too short to materially help pacing",
			evidenceRefs: args.evidenceRefs,
			confidence: "LOW",
			preservationStatus: "SAFE",
			generationStatus: "GROUNDED_NOT_USEFUL",
			requiredParameters: [],
			derivedParameters: { speed, saved, refinedAroundSpeech: args.refined === true },
			executionReadiness: "NOT_READY",
			storyPhase: args.phase,
			rankScore: 0,
		});
		return;
	}
	out.push({
		id: oid("speed"),
		family: "SPEED",
		sourceRange: { ...args.range },
		editorialReason: args.reason,
		evidenceRefs: args.evidenceRefs,
		confidence: args.speechOv < 0.02 ? "HIGH" : "MEDIUM",
		preservationStatus: "SAFE",
		generationStatus: "GROUNDED_READY",
		requiredParameters: ["startSec", "endSec", "speed"],
		derivedParameters: {
			startSec: args.range.startSec,
			endSec: args.range.endSec,
			speed,
			estimatedSavedSec: saved,
			refinedAroundSpeech: args.refined === true,
			speechOverlap: args.speechOv,
		},
		executionReadiness: "READY",
		storyPhase: args.phase === "UNKNOWN" || !args.phase ? "LOW_INFORMATION" : args.phase,
		rankScore: 6 + saved,
	});
}

export function generateSpeedOpportunities(args: {
	visualIntervals?: VisualChangeIntervalV1[] | null;
	packed: PackedEditorialTranscriptV1;
	phases: StoryPhaseSegmentV1[];
	focal: EditorialFocalAnalysisBundleV1 | null;
	deadAir?: DeadAirCandidateV1[] | null;
	document?: {
		transcripts?: Array<{
			segments?: Array<{ startSec: number; endSec: number; text?: string; kind?: string }>;
		}>;
		transcript?: {
			segments?: Array<{ startSec: number; endSec: number; text?: string; kind?: string }>;
		} | null;
	};
}): ProfessionalEditorialOpportunityV1[] {
	const out: ProfessionalEditorialOpportunityV1[] = [];
	const rawSpeech = speechWindows(args.packed, args.document);
	const silence = silenceRangesFromDeadAir(args.deadAir);
	const speech = effectiveSpeechRanges(rawSpeech, silence);
	const stables = (args.visualIntervals ?? []).filter(
		(v) => v.kind === "stable" && v.endSec - v.startSec >= PLANNER_POLICY_V1.minSpeedSpanSec,
	);

	if (stables.length === 0) {
		out.push({
			id: oid("speed"),
			family: "SPEED",
			editorialReason: "No sustained low-information visual span; checking speech gaps next",
			evidenceRefs: ["visual:no_stable_span"],
			confidence: "LOW",
			preservationStatus: "SAFE",
			generationStatus: "INSUFFICIENT_EVIDENCE",
			requiredParameters: ["stable visual span", "low speech overlap"],
			derivedParameters: {},
			executionReadiness: "NOT_READY",
			rankScore: 0,
		});
	}

	for (const s of stables) {
		const range = { startSec: s.startSec, endSec: s.endSec };
		const speechOv = speechOverlapFraction(range, speech);
		const phase = dominantPhaseAt(args.phases, range);
		const focalConflict = (args.focal?.targets ?? []).some(
			(t) => t.status === "GROUNDED" && overlapFrac(range, t.sourceRange) > 0.3,
		);

		if (focalConflict) {
			out.push({
				id: oid("speed"),
				family: "SPEED",
				sourceRange: { ...range },
				editorialReason: "Speed blocked — grounded interaction needs normal viewing time",
				evidenceRefs: [`visual:stable`, `speechOv:${speechOv.toFixed(2)}`, `phase:${phase}`],
				confidence: "HIGH",
				preservationStatus: "BLOCKED",
				generationStatus: "PRESERVATION_CONFLICT",
				requiredParameters: [],
				derivedParameters: { speechOverlap: speechOv },
				executionReadiness: "NOT_READY",
				storyPhase: phase,
				rankScore: 0,
			});
			continue;
		}

		const blockedBySpeech =
			speechOv > PLANNER_POLICY_V1.maxSpeechOverlapForSpeed ||
			((phase === "EXPLANATION" || phase === "IMPORTANT_ACTION") && speechOv > 0.05);

		if (blockedBySpeech) {
			// Candidate refinement: carve around effective speech fragments.
			const carved = carveAroundSpeech({
				candidate: range,
				speech,
				minSpanSec: PLANNER_POLICY_V1.minSpeedSpanSec,
				padSec: 0.1,
			});
			let emitted = false;
			for (const sub of carved) {
				const subOv = speechOverlapFraction(sub, speech);
				const subPhase = dominantPhaseAt(args.phases, sub);
				const subFocal = (args.focal?.targets ?? []).some(
					(t) => t.status === "GROUNDED" && overlapFrac(sub, t.sourceRange) > 0.3,
				);
				if (subFocal) continue;
				if (subOv > PLANNER_POLICY_V1.maxSpeechOverlapForSpeed) continue;
				if ((subPhase === "EXPLANATION" || subPhase === "IMPORTANT_ACTION") && subOv > 0.05) {
					continue;
				}
				pushSpeedReady(out, {
					range: sub,
					speechOv: subOv,
					phase: subPhase,
					reason: "Low-information span refined around speech boundary — mild speed-up",
					evidenceRefs: [
						`visual:stable`,
						`carved:${sub.startSec.toFixed(2)}-${sub.endSec.toFixed(2)}`,
						`speechOv:${subOv.toFixed(2)}`,
						`phase:${subPhase}`,
					],
					refined: true,
				});
				emitted = true;
			}
			if (!emitted) {
				out.push({
					id: oid("speed"),
					family: "SPEED",
					sourceRange: { ...range },
					editorialReason:
						speechOv > PLANNER_POLICY_V1.maxSpeechOverlapForSpeed
							? "Speed blocked — protected speech or explanation span"
							: "Speed blocked — important explanation/action phase with speech",
					evidenceRefs: [`visual:stable`, `speechOv:${speechOv.toFixed(2)}`, `phase:${phase}`],
					confidence: "HIGH",
					preservationStatus: "BLOCKED",
					generationStatus: "PRESERVATION_CONFLICT",
					requiredParameters: [],
					derivedParameters: { speechOverlap: speechOv },
					executionReadiness: "NOT_READY",
					storyPhase: phase,
					rankScore: 0,
				});
			}
			continue;
		}

		pushSpeedReady(out, {
			range,
			speechOv,
			phase,
			reason: "Low-information visually stable span with little speech — conservative speed-up",
			evidenceRefs: [`visual:stable`, `phase:${phase}`],
		});
	}

	// Quiet gaps between spoken segments — only when no visual stable spans were
	// available to evaluate (avoid inventing speed after a narrated stable KEEP).
	const hasVisualEvidence = (args.visualIntervals ?? []).length > 0;
	if (stables.length === 0 && !out.some((o) => o.generationStatus === "GROUNDED_READY")) {
		const sortedSpeech = [...speech].sort((a, b) => a.startSec - b.startSec);
		const minGap = Math.max(PLANNER_POLICY_V1.minSpeedSpanSec, 2.2);
		for (let i = 0; i < sortedSpeech.length - 1; i++) {
			const gapStart = sortedSpeech[i]!.endSec;
			const gapEnd = sortedSpeech[i + 1]!.startSec;
			const span = gapEnd - gapStart;
			if (span < minGap) continue;
			const range = { startSec: gapStart, endSec: gapEnd };
			// Without visual intervals, require silencedetect to confirm most of the gap.
			const silCov = silence.reduce((acc, s) => acc + overlapSeconds(range, s), 0);
			if (silCov < span * 0.45) continue;
			const phase = dominantPhaseAt(args.phases, range);
			if (phase === "IMPORTANT_ACTION") continue;
			const speechOv = speechOverlapFraction(range, speech);
			if (speechOv > PLANNER_POLICY_V1.maxSpeechOverlapForSpeed) continue;
			if (phase === "EXPLANATION" && speechOv > 0.05) continue;
			const focalConflict = (args.focal?.targets ?? []).some(
				(t) => t.status === "GROUNDED" && overlapFrac(range, t.sourceRange) > 0.15,
			);
			if (focalConflict) continue;
			pushSpeedReady(out, {
				range,
				speechOv,
				phase,
				reason: "Long quiet gap confirmed by silence — mild speed-up for waiting",
				evidenceRefs: [
					`speech_gap:${gapStart.toFixed(2)}-${gapEnd.toFixed(2)}`,
					`phase:${phase}`,
					`silence_cov:${(silCov / span).toFixed(2)}`,
				],
			});
		}
	}

	// Long confirmed silence with stable visuals: accelerate wait that must remain
	// visible (SPEED) when trim SHORTEN is not already ready for the same quiet —
	// REMOVE/SHORTEN vs SPEED distinction.
	if (!out.some((o) => o.generationStatus === "GROUNDED_READY")) {
		for (const sil of silence) {
			const span = sil.endSec - sil.startSec;
			if (span < PLANNER_POLICY_V1.minSpeedSpanSec) continue;
			const trimReady = (args.deadAir ?? []).some(
				(c) =>
					c.safeToPropose &&
					c.classification !== "TRAILING_SILENCE" &&
					overlapFrac(sil, {
						startSec: c.silenceRange.startSec,
						endSec: c.silenceRange.endSec,
					}) > 0.5,
			);
			if (trimReady) continue; // SHORTEN wins for pure dead air
			const speechOv = speechOverlapFraction(sil, speech);
			if (speechOv > PLANNER_POLICY_V1.maxSpeechOverlapForSpeed) continue;
			const phase = dominantPhaseAt(args.phases, sil);
			if (phase === "IMPORTANT_ACTION" || phase === "EXPLANATION") {
				if (speechOv > 0.05) continue;
			}
			const focalConflict = (args.focal?.targets ?? []).some(
				(t) => t.status === "GROUNDED" && overlapFrac(sil, t.sourceRange) > 0.15,
			);
			if (focalConflict) continue;
			const stableHit = (args.visualIntervals ?? []).some(
				(v) =>
					v.kind === "stable" && overlapFrac(sil, { startSec: v.startSec, endSec: v.endSec }) > 0.4,
			);
			if (!stableHit && hasVisualEvidence) continue;
			pushSpeedReady(out, {
				range: sil,
				speechOv,
				phase: phase === "UNKNOWN" ? "WAITING" : phase,
				reason:
					"Long low-information wait with confirmed quiet — accelerate while keeping end-state visible",
				evidenceRefs: [
					`silence_wait:${sil.startSec.toFixed(2)}-${sil.endSec.toFixed(2)}`,
					`phase:${phase}`,
				],
			});
		}
	}
	return out;
}

function activityInRange(
	visual: VisualChangeIntervalV1[] | null | undefined,
	range: SourceRangeSec,
): boolean {
	return (visual ?? []).some(
		(v) =>
			(v.kind === "activity" || v.kind === "significant") &&
			overlapFrac(range, { startSec: v.startSec, endSec: v.endSec }) > 0.2,
	);
}

export function generateTrimOpportunities(args: {
	deadAir: DeadAirCandidateV1[];
	story: ProfessionalEditStoryV1;
	phases: StoryPhaseSegmentV1[];
	visualIntervals?: VisualChangeIntervalV1[] | null;
}): ProfessionalEditorialOpportunityV1[] {
	const out: ProfessionalEditorialOpportunityV1[] = [];
	for (const c of args.deadAir) {
		const range = c.silenceRange;
		const phase = dominantPhaseAt(args.phases, range);
		const visualBusy = activityInRange(args.visualIntervals, range);
		const inExplanation = phase === "EXPLANATION" || phase === "IMPORTANT_ACTION";

		if (c.safeToPropose && c.proposedTrimRange) {
			const silenceDur = c.silenceDurationSec;
			const isLongEndingWait =
				c.classification === "TRAILING_SILENCE" && silenceDur >= PLANNER_POLICY_V1.minSpeedSpanSec;
			if (isLongEndingWait) {
				out.push({
					id: oid("trim"),
					family: "TRIM",
					sourceRange: { ...c.proposedTrimRange },
					editorialReason:
						"Long ending wait kept for SPEED_UP (visible end-state) rather than REMOVE",
					evidenceRefs: [`dead_air:${c.id}`, `phase:${phase}`, "prefer_speed_over_remove"],
					confidence: "MEDIUM",
					preservationStatus: "SAFE",
					generationStatus: "GROUNDED_NOT_USEFUL",
					requiredParameters: [],
					derivedParameters: {
						classification: c.classification,
						silenceDurationSec: silenceDur,
						temporalDecision: "SPEED_UP",
					},
					executionReadiness: "NOT_READY",
					storyPhase: phase,
					rankScore: 0,
				});
				continue;
			}
			out.push({
				id: oid("trim"),
				family: "TRIM",
				sourceRange: { ...c.proposedTrimRange },
				editorialReason: "Unnecessary quiet pause with safe removable excess",
				evidenceRefs: [`dead_air:${c.id}`, `phase:${phase}`, "temporal:SHORTEN"],
				confidence: "HIGH",
				preservationStatus: "SAFE",
				generationStatus: "GROUNDED_READY",
				requiredParameters: ["startSec", "endSec", "assetId"],
				derivedParameters: {
					...c.proposedTrimRange,
					candidateId: c.id,
					removedSec: c.resultingRemovedDurationSec,
					temporalDecision:
						c.resultingRemovedDurationSec >= silenceDur * 0.85 ? "REMOVE" : "SHORTEN",
					targetPauseKeptSec: c.targetPauseKeptSec,
				},
				executionReadiness: "READY",
				storyPhase: phase,
				rankScore: 8 + c.resultingRemovedDurationSec,
			});
			continue;
		}

		// Contextual KEEP — do not remap every failed trim as "Speech-adjacent"
		// merely because an inflated STT window made phase=EXPLANATION.
		let status: ProfessionalEditorialOpportunityV1["generationStatus"] = "GROUNDED_NOT_USEFUL";
		let reason = `Pause retained (${c.classification}): ${c.blockingReasons.join(",") || "policy"}`;
		if (visualBusy) {
			status = "PRESERVATION_CONFLICT";
			reason = "Visually active pause — keep natural timing for action comprehensibility";
		} else if (
			inExplanation &&
			(c.classification === "INTER_SENTENCE_PAUSE" ||
				c.blockingReasons.includes("natural_inter_sentence_pause"))
		) {
			status = "PRESERVATION_CONFLICT";
			reason = "Speech-adjacent comprehension pause — keep natural timing";
		} else if (c.classification === "TOO_SHORT") {
			status = "GROUNDED_NOT_USEFUL";
			reason =
				"Short pause; KEEP_SOME_PAUSE / minRemovable policy retains it (POLICY_CONSERVATISM)";
		}

		out.push({
			id: oid("trim"),
			family: "TRIM",
			sourceRange: { ...range },
			editorialReason: reason,
			evidenceRefs: [`dead_air:${c.id}`, `phase:${phase}`],
			confidence: "MEDIUM",
			preservationStatus: visualBusy ? "BLOCKED" : "SAFE",
			generationStatus: status,
			requiredParameters: [],
			derivedParameters: {
				classification: c.classification,
				blockingReasons: c.blockingReasons,
				silenceDurationSec: c.silenceDurationSec,
			},
			executionReadiness: "NOT_READY",
			storyPhase: phase,
			rankScore: 0,
		});
	}
	return out;
}

export function generateZoomOpportunities(args: {
	focal: EditorialFocalAnalysisBundleV1 | null;
	story: ProfessionalEditStoryV1;
	phases: StoryPhaseSegmentV1[];
	packed: PackedEditorialTranscriptV1;
}): ProfessionalEditorialOpportunityV1[] {
	const out: ProfessionalEditorialOpportunityV1[] = [];
	if (!args.focal) {
		out.push({
			id: oid("zoom"),
			family: "ZOOM",
			editorialReason: "Focal analysis unavailable",
			evidenceRefs: [],
			confidence: "LOW",
			preservationStatus: "UNKNOWN",
			generationStatus: "INSUFFICIENT_EVIDENCE",
			requiredParameters: ["focal geometry"],
			derivedParameters: {},
			executionReadiness: "NOT_READY",
			rankScore: 0,
		});
		return out;
	}

	const zd = args.focal.zoomDecision;
	if (zd.decision !== "ZOOM_ELIGIBLE" || !zd.geometry || !zd.targetId) {
		out.push({
			id: oid("zoom"),
			family: "ZOOM",
			editorialReason: `No executable zoom (${zd.reasonCode})`,
			evidenceRefs: [zd.reasonCode],
			confidence: "LOW",
			preservationStatus: "SAFE",
			generationStatus:
				zd.reasonCode === "AMBIGUOUS_TARGET" || zd.reasonCode === "PRESERVATION_CONFLICT"
					? "PRESERVATION_CONFLICT"
					: "INSUFFICIENT_EVIDENCE",
			requiredParameters: [],
			derivedParameters: { reasonCode: zd.reasonCode },
			executionReadiness: "NOT_READY",
			rankScore: 0,
		});
		return out;
	}

	const target = args.focal.targets.find((t) => t.targetId === zd.targetId);
	const range = target?.sourceRange ?? {
		startSec: zd.geometry.sourceStartSec,
		endSec: zd.geometry.sourceEndSec,
	};
	const phase = dominantPhaseAt(args.phases, range);
	const speech = speechWindows(args.packed);
	const speechOv = speechOverlapFraction(range, speech);
	const essentialHit = args.story.essentialRanges.some((r) => overlapFrac(range, r) > 0.15);
	const hasCursorEvidence =
		(target?.evidenceFamilies.includes("CURSOR_CLICK") ?? false) ||
		(target?.evidenceFamilies.includes("CURSOR_DWELL") ?? false) ||
		(target?.evidenceFamilies.includes("CURSOR_CLUSTER") ?? false) ||
		(target?.evidenceFamilies.includes("CURSOR_APPROACH") ?? false);
	// Zoom follows editorial attention: grounded interaction + speech/story benefit.
	// Grounded MEDIUM/HIGH click/dwell is enough for screen tutorials even before STT labels.
	const useful =
		essentialHit ||
		(hasCursorEvidence && phase === "IMPORTANT_ACTION") ||
		(hasCursorEvidence && speechOv >= 0.12) ||
		(hasCursorEvidence && (target?.confidence === "HIGH" || target?.confidence === "MEDIUM"));

	if (!useful) {
		out.push({
			id: oid("zoom"),
			family: "ZOOM",
			sourceRange: { ...range },
			editorialReason:
				"Grounded focal geometry exists but is not editorially useful for this story beat",
			evidenceRefs: [zd.targetId, `phase:${phase}`],
			confidence: "MEDIUM",
			preservationStatus: "SAFE",
			generationStatus: "GROUNDED_NOT_USEFUL",
			requiredParameters: [],
			derivedParameters: { geometry: zd.geometry, phase },
			executionReadiness: "NOT_READY",
			storyPhase: phase,
			rankScore: 1,
		});
		return out;
	}

	out.push({
		id: oid("zoom"),
		family: "ZOOM",
		sourceRange: { ...range },
		editorialReason:
			"Grounded interaction focus coincides with narration/action — emphasize for clarity",
		evidenceRefs: [zd.targetId, ...(target?.evidenceIds ?? []).slice(0, 4)],
		confidence: target?.confidence === "HIGH" ? "HIGH" : "MEDIUM",
		preservationStatus: "SAFE",
		generationStatus: "GROUNDED_READY",
		requiredParameters: ["focus", "depth", "startSec", "endSec"],
		derivedParameters: {
			depth: zd.geometry.depth,
			focus: zd.geometry.focalPoint,
			sourceStartSec: zd.geometry.sourceStartSec,
			sourceEndSec: zd.geometry.sourceEndSec,
			scale: zd.geometry.scale,
		},
		executionReadiness: "READY",
		storyPhase: phase,
		rankScore: 9,
	});
	return out;
}

export function generateCropOpportunities(args: {
	focal: EditorialFocalAnalysisBundleV1 | null;
	aspectFramingRequired?: boolean;
	framingCrop?: { x: number; y: number; width: number; height: number; clipId: string } | null;
}): ProfessionalEditorialOpportunityV1[] {
	if (args.framingCrop) {
		return [
			{
				id: oid("crop"),
				family: "CROP",
				editorialReason: "Explicit framing/aspect crop geometry provided",
				evidenceRefs: ["framing:explicit"],
				confidence: "HIGH",
				preservationStatus: "SAFE",
				generationStatus: "GROUNDED_READY",
				requiredParameters: ["clipId", "crop"],
				derivedParameters: { ...args.framingCrop },
				executionReadiness: "READY",
				rankScore: 5,
			},
		];
	}
	if (args.aspectFramingRequired && args.focal?.cropDecision.decision === "CROP_ELIGIBLE") {
		return [
			{
				id: oid("crop"),
				family: "CROP",
				editorialReason:
					"Aspect framing requested but no measured unused-margin crop rect is available",
				evidenceRefs: ["crop:aspect_required"],
				confidence: "LOW",
				preservationStatus: "UNKNOWN",
				generationStatus: "MISSING_PARAMETERS",
				requiredParameters: ["crop.x", "crop.y", "crop.width", "crop.height", "clipId"],
				derivedParameters: {},
				executionReadiness: "NOT_READY",
				rankScore: 0,
			},
		];
	}
	return [
		{
			id: oid("crop"),
			family: "CROP",
			editorialReason:
				"No safe autonomous crop geometry — fullscreen/content framing already appropriate or margins unknown",
			evidenceRefs: ["crop:insufficient_geometry"],
			confidence: "HIGH",
			preservationStatus: "SAFE",
			generationStatus: "INSUFFICIENT_EVIDENCE",
			requiredParameters: ["measured unused canvas / aspect framing rect"],
			derivedParameters: {
				honest: "HONESTLY_LIMITED",
				cropDecision: args.focal?.cropDecision.reasonCode ?? "NO_ASPECT_FRAMING_REASON",
			},
			executionReadiness: "NOT_READY",
			rankScore: 0,
		},
	];
}

export function generateCaptionOpportunities(args: {
	captionsEnabled: boolean;
	wantCaptions: boolean | "auto";
	layoutOk: boolean;
	cueCount: number;
}): ProfessionalEditorialOpportunityV1[] {
	if (args.captionsEnabled) {
		return [
			{
				id: oid("cap"),
				family: "CAPTIONS",
				editorialReason: "Captions already enabled — keep and continue other families",
				evidenceRefs: ["captions:already_enabled"],
				confidence: "HIGH",
				preservationStatus: "SAFE",
				generationStatus: "GROUNDED_NOT_USEFUL",
				requiredParameters: [],
				derivedParameters: { alreadyGood: true },
				executionReadiness: "NOT_READY",
				rankScore: 0,
			},
		];
	}
	const want =
		args.wantCaptions === true ||
		(args.wantCaptions === "auto" && args.layoutOk && args.cueCount > 0);
	if (want && args.layoutOk && args.cueCount > 0) {
		return [
			{
				id: oid("cap"),
				family: "CAPTIONS",
				editorialReason: "Enable captions from transcript with safe layout",
				evidenceRefs: ["caption_layout:ok"],
				confidence: "HIGH",
				preservationStatus: "SAFE",
				generationStatus: "GROUNDED_READY",
				requiredParameters: ["enableCaptions args"],
				derivedParameters: { cueCount: args.cueCount },
				executionReadiness: "READY",
				rankScore: 4,
			},
		];
	}
	return [
		{
			id: oid("cap"),
			family: "CAPTIONS",
			editorialReason: "No caption enable opportunity",
			evidenceRefs: [],
			confidence: "MEDIUM",
			preservationStatus: "SAFE",
			generationStatus: "INSUFFICIENT_EVIDENCE",
			requiredParameters: [],
			derivedParameters: {},
			executionReadiness: "NOT_READY",
			rankScore: 0,
		},
	];
}

/** Opening title from transcript/story — never invent product claims; never paste filler. */
export function generateTitleOpportunities(args: {
	story: ProfessionalEditStoryV1;
	packed: PackedEditorialTranscriptV1;
	wantProfessional: boolean;
	existingAnnotationCount: number;
}): ProfessionalEditorialOpportunityV1[] {
	const firstSpeech = args.packed.segments.find((s) => s.speechText.trim().length >= 8);
	const rawSpeech = (firstSpeech?.speechText ?? "").replace(/\s+/g, " ").trim();
	const derived = deriveProfessionalTitleText({
		rawSpeech,
		storyCommunicates: args.story.communicates,
		preferStory: true,
	});
	const gate = shouldProposeOpeningTitle({
		wantProfessional: args.wantProfessional,
		sourceDurationSec: args.packed.sourceDurationSec,
		existingNonCaptionAnnotations: args.existingAnnotationCount,
		derivedTitle: derived,
	});
	if (!gate.ok) {
		const status =
			gate.reason === "no_safe_title_meaning" || gate.reason === "not_professional_request"
				? gate.reason === "no_safe_title_meaning"
					? "INSUFFICIENT_EVIDENCE"
					: "GROUNDED_NOT_USEFUL"
				: "GROUNDED_NOT_USEFUL";
		return [
			{
				id: oid("title"),
				family: "TITLE",
				editorialReason:
					gate.reason === "no_safe_title_meaning"
						? "Opening speech is conversational filler — no professional title derived"
						: gate.reason === "clip_too_short"
							? "Clip too short for an opening title beat"
							: gate.reason === "title_already_present"
								? "Annotations/titles already present — skip opening title"
								: "Title not editorially justified for this turn",
				evidenceRefs: [`title:${gate.reason}`],
				confidence: "MEDIUM",
				preservationStatus: "SAFE",
				generationStatus: status,
				requiredParameters: [],
				derivedParameters: { gate: gate.reason, rawSpeechPreview: rawSpeech.slice(0, 48) },
				executionReadiness: "NOT_READY",
				rankScore: 0,
			},
		];
	}
	const text = derived!;
	const endSec = Math.min(
		2.8,
		Math.max(1.8, firstSpeech ? Math.min(firstSpeech.endSec, 2.8) : 2.4),
	);
	return [
		{
			id: oid("title"),
			family: "TITLE",
			sourceRange: { startSec: 0.2, endSec },
			editorialReason:
				"Concise opening title derived from tutorial/intro meaning (not raw transcript paste)",
			evidenceRefs: [
				"title:opening_derived",
				...(firstSpeech ? [`segment:${firstSpeech.id}`] : ["story:communicates"]),
			],
			confidence: "MEDIUM",
			preservationStatus: "SAFE",
			generationStatus: "GROUNDED_READY",
			requiredParameters: ["kind", "text", "startSec", "endSec"],
			derivedParameters: {
				kind: "title",
				text,
				startSec: 0.2,
				endSec,
				titleMode: "OPENING_TITLE",
				editorialProblem: "Viewer lacks a clear topic label at the start",
				expectedImprovement: "Immediate topic orientation without inventing claims",
			},
			executionReadiness: "READY",
			storyPhase: "INTRO",
			rankScore: 5.5,
		},
	];
}

/** Callout/highlight only with grounded focal geometry — never invent coordinates. */
export function generateCalloutOpportunities(args: {
	focal: EditorialFocalAnalysisBundleV1 | null;
	packed: PackedEditorialTranscriptV1;
}): ProfessionalEditorialOpportunityV1[] {
	const zd = args.focal?.zoomDecision;
	if (!args.focal || zd?.decision !== "ZOOM_ELIGIBLE" || !zd.geometry || !zd.targetId) {
		return [
			{
				id: oid("callout"),
				family: "CALLOUT",
				editorialReason: "No grounded focal geometry for a callout",
				evidenceRefs: [zd?.reasonCode ?? "no_focal"],
				confidence: "LOW",
				preservationStatus: "SAFE",
				generationStatus: "INSUFFICIENT_EVIDENCE",
				requiredParameters: ["grounded_focal"],
				derivedParameters: {},
				executionReadiness: "NOT_READY",
				rankScore: 0,
			},
		];
	}
	const target = args.focal.targets.find((t) => t.targetId === zd.targetId);
	const hasClick =
		target?.evidenceFamilies.includes("CURSOR_CLICK") ||
		target?.evidenceFamilies.includes("CURSOR_DWELL");
	if (!hasClick) {
		return [
			{
				id: oid("callout"),
				family: "CALLOUT",
				editorialReason: "Focal present but no click/dwell — skip decorative callout",
				evidenceRefs: [zd.targetId],
				confidence: "MEDIUM",
				preservationStatus: "SAFE",
				generationStatus: "GROUNDED_NOT_USEFUL",
				requiredParameters: [],
				derivedParameters: {},
				executionReadiness: "NOT_READY",
				rankScore: 1,
			},
		];
	}
	const range = target?.sourceRange ?? {
		startSec: zd.geometry.sourceStartSec,
		endSec: zd.geometry.sourceEndSec,
	};
	const nearSpeech = speechWindows(args.packed).some(
		(s) => overlapFrac(range, s) > 0.1 || Math.abs(s.startSec - range.startSec) < 1.2,
	);
	const labelBits = args.packed.segments
		.filter((s) => Math.abs(s.startSec - range.startSec) < 2.5)
		.map((s) => s.speechText.trim())
		.filter(Boolean);
	const rawLabel = (labelBits[0] ?? "").replace(/\s+/g, " ").trim();
	const labelWords = rawLabel.split(/\s+/).filter(Boolean).slice(0, 4);
	const label = labelWords.join(" ");
	const labelUseful =
		labelWords.length >= 2 &&
		!/^(focus|here|this|click|button|on|it|and|i)$/i.test(label) &&
		!/\b(um+|uh+|this is a|i am|i think|you can see|screen recording|limited|on it and)\b/i.test(
			label,
		);

	// Zoom already emphasizes the focal — callout only when it adds grounded label info.
	if (!nearSpeech || !labelUseful) {
		return [
			{
				id: oid("callout"),
				family: "CALLOUT",
				sourceRange: { ...range },
				editorialReason: !labelUseful
					? "Zoom covers emphasis; callout text is not a useful grounded label — skip to avoid clutter"
					: "Zoom covers emphasis; no nearby narration to justify a callout label",
				evidenceRefs: [zd.targetId],
				confidence: "MEDIUM",
				preservationStatus: "SAFE",
				generationStatus: "GROUNDED_NOT_USEFUL",
				requiredParameters: [],
				derivedParameters: {
					skippedBecauseZoomSufficient: true,
					labelPreview: label.slice(0, 32),
				},
				executionReadiness: "NOT_READY",
				rankScore: 2,
			},
		];
	}
	const cx = Math.round(zd.geometry.focalPoint.cx * 100);
	const cy = Math.round(zd.geometry.focalPoint.cy * 100);
	return [
		{
			id: oid("callout"),
			family: "CALLOUT",
			sourceRange: { ...range },
			editorialReason:
				"Grounded click/dwell with nearby narration label — callout adds information beyond zoom",
			evidenceRefs: [zd.targetId, ...(target?.evidenceIds ?? []).slice(0, 3)],
			confidence: "HIGH",
			preservationStatus: "SAFE",
			generationStatus: "GROUNDED_READY",
			requiredParameters: ["kind", "x", "y", "startSec", "endSec"],
			derivedParameters: {
				kind: "figure",
				text: label.slice(0, 32),
				x: Math.min(88, Math.max(4, cx - 6)),
				y: Math.min(88, Math.max(4, cy - 6)),
				width: 12,
				height: 12,
				startSec: range.startSec,
				endSec: Math.min(range.endSec, range.startSec + 2.4),
				arrowDirection: "down",
				editorialProblem: "Viewer may miss the named control without a brief label",
				expectedImprovement: "Callout names the control while zoom isolates it",
			},
			executionReadiness: "READY",
			storyPhase: "IMPORTANT_ACTION",
			rankScore: 6,
		},
	];
}

/**
 * Authorable transitions at real document clip joins (index > 0).
 * V5: relationship → family → Registry id. CUT/KEEP is first-class.
 * Most continuous / single-clip / busy joins correctly KEEP.
 */
export function generateTransitionOpportunities(args: {
	clipCount: number;
	secondClipId?: string | null;
	wantDissolve: boolean;
	document?: AxcutDocument | null;
	sourceStory?: MultimodalSourceStoryV1 | null;
	targetStory?: TargetEditStoryV1 | null;
	backend?: GpuBackend;
}): ProfessionalEditorialOpportunityV1[] {
	if (args.clipCount < 2 || !args.secondClipId) {
		return [
			{
				id: oid("trans"),
				family: "TRANSITION",
				editorialReason: "No multi-clip join — hard CUT is the default single-clip programme",
				evidenceRefs: ["transition:no_join"],
				confidence: "HIGH",
				preservationStatus: "SAFE",
				generationStatus: "GROUNDED_NOT_USEFUL",
				requiredParameters: ["multi_clip_join"],
				derivedParameters: { decision: "KEEP", relationship: "UNKNOWN_WEAK" },
				executionReadiness: "NOT_READY",
				rankScore: 0,
			},
		];
	}

	if (args.document) {
		const decisions = decideAutonomousTransitions({
			document: args.document,
			sourceStory: args.sourceStory ?? null,
			targetStory: args.targetStory ?? null,
			backend: args.backend ?? "metal",
			maxApply: args.wantDissolve ? 2 : 1,
		});
		const out: ProfessionalEditorialOpportunityV1[] = [];
		for (const d of decisions) {
			if (d.decision === "KEEP" || !d.transitionId || d.transitionId === "openscreen.cut") {
				out.push({
					id: oid("trans"),
					family: "TRANSITION",
					sourceRange: {
						startSec: Math.max(0, d.programmeJoinSec - 0.05),
						endSec: d.programmeJoinSec + 0.05,
					},
					editorialReason: d.reason,
					evidenceRefs: [
						"transition:keep_cut",
						`relationship:${d.relationship}`,
						`clip:${d.clipId}`,
					],
					confidence: d.confidence,
					preservationStatus: "SAFE",
					generationStatus: "GROUNDED_NOT_USEFUL",
					requiredParameters: [],
					derivedParameters: {
						clipId: d.clipId,
						kind: "cut",
						transitionId: "openscreen.cut",
						decision: "KEEP",
						relationship: d.relationship,
						family: d.family,
					},
					executionReadiness: "NOT_READY",
					rankScore: 1,
				});
				continue;
			}
			out.push({
				id: oid("trans"),
				family: "TRANSITION",
				sourceRange: {
					startSec: Math.max(0, d.programmeJoinSec - 0.05),
					endSec: d.programmeJoinSec + 0.05,
				},
				editorialReason: d.reason,
				evidenceRefs: [
					"transition:apply",
					`relationship:${d.relationship}`,
					`family:${d.family}`,
					`transitionId:${d.transitionId}`,
					`clip:${d.clipId}`,
				],
				confidence: d.confidence,
				preservationStatus: "SAFE",
				generationStatus: "GROUNDED_READY",
				requiredParameters: ["clipId", "transitionId"],
				derivedParameters: {
					clipId: d.clipId,
					kind: "dissolve",
					transitionId: d.transitionId,
					durationSec: d.durationSec,
					decision: "APPLY",
					relationship: d.relationship,
					family: d.family,
					editorialProblem: `Boundary relationship ${d.relationship}`,
					expectedImprovement: `Registry ${d.transitionId} signals the change`,
				},
				executionReadiness: "READY",
				rankScore: 3,
			});
		}
		if (out.length > 0) return out;
	}

	// Legacy fallback when document not supplied (unit tests / old callers).
	if (!args.wantDissolve) {
		return [
			{
				id: oid("trans"),
				family: "TRANSITION",
				editorialReason: "Target story prefers clean CUT at this join — leave default",
				evidenceRefs: ["transition:prefer_cut"],
				confidence: "MEDIUM",
				preservationStatus: "SAFE",
				generationStatus: "GROUNDED_NOT_USEFUL",
				requiredParameters: [],
				derivedParameters: {
					kind: "cut",
					clipId: args.secondClipId,
					transitionId: "openscreen.cut",
					decision: "KEEP",
				},
				executionReadiness: "NOT_READY",
				rankScore: 1,
			},
		];
	}
	return [
		{
			id: oid("trans"),
			family: "TRANSITION",
			editorialReason:
				"Story beat boundary across clips — short dissolve softens the join without stacking effects",
			evidenceRefs: ["transition:story_boundary", `clip:${args.secondClipId}`],
			confidence: "MEDIUM",
			preservationStatus: "SAFE",
			generationStatus: "GROUNDED_READY",
			requiredParameters: ["clipId", "kind"],
			derivedParameters: {
				clipId: args.secondClipId,
				kind: "dissolve",
				transitionId: "openscreen.dissolve",
				durationSec: 0.35,
				decision: "APPLY",
				editorialProblem: "Hard jump between story sections may feel abrupt",
				expectedImprovement: "Brief dissolve signals section change",
			},
			executionReadiness: "READY",
			rankScore: 3,
		},
	];
}

export function generateLoudnessOpportunity(args: {
	outcome?: string | null;
	safeToPropose?: boolean;
}): ProfessionalEditorialOpportunityV1 {
	if (args.safeToPropose) {
		return {
			id: oid("loud"),
			family: "LOUDNESS",
			editorialReason: "Safe loudness normalization available (settings path)",
			evidenceRefs: [`loudness:${args.outcome ?? "candidate"}`],
			confidence: "HIGH",
			preservationStatus: "SAFE",
			generationStatus: "GROUNDED_READY",
			requiredParameters: ["audioGainDb"],
			derivedParameters: { outcome: args.outcome },
			executionReadiness: "READY",
			rankScore: 5,
		};
	}
	return {
		id: oid("loud"),
		family: "LOUDNESS",
		editorialReason: args.outcome ?? "Audio already acceptable or not actionable",
		evidenceRefs: [],
		confidence: "MEDIUM",
		preservationStatus: "SAFE",
		generationStatus: "GROUNDED_NOT_USEFUL",
		requiredParameters: [],
		derivedParameters: { outcome: args.outcome },
		executionReadiness: "NOT_READY",
		rankScore: 0,
	};
}
