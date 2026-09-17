/**
 * Speech-aware silence classification + DeadAirCandidate builder.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { assessSpeechBoundary } from "../renderVerify/speechBoundary";
import type { SpeechEvidence } from "../speechEvidence/types";
import type { TemporalEventLedger } from "../temporalEventLedger/types";
import {
	type PauseFunctionClass,
	subtractRanges,
	targetPauseForFunction,
} from "../temporalPacing/speechEffective";
import type { VisualChange } from "../visualEvidence/types";
import { DEFAULT_DEAD_AIR_POLICY, type DeadAirPolicyConfig } from "./config";
import { planKeepSomePause } from "./keepPause";
import type {
	DeadAirCandidateV1,
	DeadAirConfidence,
	SilenceClassification,
	SilenceInterval,
	SpeechAnchorRef,
	VisualActivityHit,
} from "./types";
import { VISUAL_SAFETY_VERSION } from "./visualActivityTypes";
import {
	assessVisualActivity,
	type CachedOcrObservation,
	visualAssessmentBlocksSafePropose,
} from "./visualSafety";

export interface SpeechWindow {
	startSourceTimeSec: number;
	endSourceTimeSec: number;
	id?: string;
	text?: string;
}

let candSeq = 0;
export function resetDeadAirCandidateSeqForTests(): void {
	candSeq = 0;
}

function nextCandId(): string {
	candSeq += 1;
	return `dead_air_${candSeq}`;
}

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
	return a0 < b1 - 1e-6 && a1 > b0 + 1e-6;
}

function fullyCoveredByTrims(
	start: number,
	end: number,
	trims: Array<{ startSec: number; endSec: number; assetId?: string }>,
	assetId: string,
): boolean {
	const relevant = trims
		.filter((t) => !t.assetId || t.assetId === assetId)
		.filter((t) => overlaps(start, end, t.startSec, t.endSec))
		.sort((a, b) => a.startSec - b.startSec);
	if (relevant.length === 0) return false;
	let coveredTo = start;
	for (const t of relevant) {
		if (t.startSec > coveredTo + 1e-4) return false;
		coveredTo = Math.max(coveredTo, t.endSec);
		if (coveredTo >= end - 1e-4) return true;
	}
	return coveredTo >= end - 1e-4;
}

export function speechWindowsFromEvidence(
	speech: SpeechEvidence | null | undefined,
): SpeechWindow[] {
	if (!speech || speech.status !== "available") return [];
	return speech.segments
		.filter((s) => s.endSourceTimeSec > s.startSourceTimeSec && s.text.trim().length > 0)
		.map((s, i) => ({
			startSourceTimeSec: s.startSourceTimeSec,
			endSourceTimeSec: s.endSourceTimeSec,
			id: `speech_${i}`,
			text: s.text,
		}));
}

export function speechWindowsFromTranscript(
	document: AxcutDocument | null | undefined,
	assetId: string,
): SpeechWindow[] {
	if (!document) return [];
	const t =
		document.transcripts.find((x) => x.assetId === assetId) ??
		document.transcripts[0] ??
		(document.transcript?.assetId === assetId || !document.transcript?.assetId
			? document.transcript
			: null);
	if (!t?.segments) return [];
	return t.segments
		.filter((s) => s.kind === "speech" && s.endSec > s.startSec)
		.map((s) => ({
			startSourceTimeSec: s.startSec,
			endSourceTimeSec: s.endSec,
			id: s.id,
			text: s.text,
		}));
}

function findSpeechBefore(windows: SpeechWindow[], t: number): SpeechAnchorRef {
	let best: SpeechWindow | null = null;
	for (const w of windows) {
		if (w.endSourceTimeSec <= t + 1e-3) {
			if (!best || w.endSourceTimeSec > best.endSourceTimeSec) best = w;
		}
	}
	if (!best) return { kind: "none" };
	return {
		kind: "speech_segment",
		id: best.id,
		startSourceTimeSec: best.startSourceTimeSec,
		endSourceTimeSec: best.endSourceTimeSec,
		text: best.text,
	};
}

function findSpeechAfter(windows: SpeechWindow[], t: number): SpeechAnchorRef {
	let best: SpeechWindow | null = null;
	for (const w of windows) {
		if (w.startSourceTimeSec >= t - 1e-3) {
			if (!best || w.startSourceTimeSec < best.startSourceTimeSec) best = w;
		}
	}
	if (!best) return { kind: "none" };
	return {
		kind: "speech_segment",
		id: best.id,
		startSourceTimeSec: best.startSourceTimeSec,
		endSourceTimeSec: best.endSourceTimeSec,
		text: best.text,
	};
}

function overlapsSpeechInterior(
	windows: SpeechWindow[],
	start: number,
	end: number,
	eps = 0.05,
): boolean {
	for (const w of windows) {
		if (start < w.endSourceTimeSec - eps && end > w.startSourceTimeSec + eps) {
			const deep = start > w.startSourceTimeSec + eps && end < w.endSourceTimeSec - eps;
			const substantial =
				Math.min(end, w.endSourceTimeSec) - Math.max(start, w.startSourceTimeSec) > 0.2;
			if (deep || substantial) return true;
		}
	}
	return false;
}

export function classifySilenceInterval(args: {
	interval: SilenceInterval;
	durationSec: number | null;
	speechWindows: SpeechWindow[];
	policy: DeadAirPolicyConfig;
}): SilenceClassification {
	const { interval, durationSec, speechWindows, policy } = args;
	if (interval.durationSec + 1e-9 < policy.minSilenceForCandidateSec) {
		return "TOO_SHORT";
	}

	const leadSlack = 0.35;
	const trailSlack = 0.35;
	const isLeading = interval.startSec <= leadSlack;
	const isTrailing = durationSec != null && interval.endSec >= durationSec - trailSlack;

	// Leading/trailing classified before interior speech-overlap so intro pad
	// that abuts first speech is not mistaken for "inside speech".
	if (isLeading && !isTrailing) return "LEADING_SILENCE";
	if (isTrailing && !isLeading) return "TRAILING_SILENCE";

	const before = findSpeechBefore(speechWindows, interval.startSec);
	const after = findSpeechAfter(speechWindows, interval.endSec);

	// Silencedetect-confirmed quiet is authoritative over inflated STT windows.
	// STT presence covering a quiet interval is NOT automatic WITHIN_PROTECTED —
	// speech-boundary assessment (with silence punched out) still protects words.
	// Only treat as protected when the interval is deeply inside speech *and*
	// shorter than a real pause (likely mis-detected blip), not a ≥1s quiet gap.
	if (
		overlapsSpeechInterior(speechWindows, interval.startSec, interval.endSec) &&
		interval.durationSec + 1e-9 < Math.max(policy.minSilenceForCandidateSec, 1.0)
	) {
		return "WITHIN_PROTECTED_CONTEXT";
	}

	if (before.kind === "none" && after.kind === "none") {
		return speechWindows.length === 0 ? "UNKNOWN" : "POSSIBLE_DEAD_AIR";
	}
	if (before.kind !== "none" && after.kind !== "none") {
		if (interval.durationSec <= policy.interSentenceMaxProposeSec) {
			return "INTER_SENTENCE_PAUSE";
		}
		return "POSSIBLE_DEAD_AIR";
	}
	return "POSSIBLE_DEAD_AIR";
}

function confidenceFor(
	classification: SilenceClassification,
	before: SpeechAnchorRef,
	after: SpeechAnchorRef,
): DeadAirConfidence {
	if (classification === "TOO_SHORT" || classification === "UNKNOWN") return "none";
	if (before.kind !== "none" && after.kind !== "none") return "high";
	if (before.kind !== "none" || after.kind !== "none") return "medium";
	if (classification === "LEADING_SILENCE" || classification === "TRAILING_SILENCE") {
		return "medium";
	}
	return "low";
}

const HARD_BLOCK_REASONS = new Set([
	"visual_activity_in_silence",
	"overlaps_protected_speech",
	"speech_boundary_unknown",
	"already_trimmed_source",
	"trailing_outro_uncertain",
	"silence_below_candidate_threshold",
	"padded_window_empty",
	"insufficient_excess_after_keep",
	"degenerate_trim",
	"natural_inter_sentence_pause",
	"keep_pause_rejected",
]);

function isVisualHardBlock(reason: string): boolean {
	return (
		HARD_BLOCK_REASONS.has(reason) ||
		reason.startsWith("speech_boundary_") ||
		reason.startsWith("visual_")
	);
}

const EMPTY_VISUAL = {
	visualActivity: [] as VisualActivityHit[],
	visualActivityState: "NO_MATERIAL_VISUAL_ACTIVITY" as const,
	visualEvidenceRefs: [] as Array<{ kind: string; id: string; note: string }>,
	visualBlockingReasons: [] as string[],
	visualSafetyVersion: VISUAL_SAFETY_VERSION,
};

export async function buildDeadAirCandidate(args: {
	assetId: string;
	mediaPath: string;
	interval: SilenceInterval;
	durationSec: number | null;
	speechWindows: SpeechWindow[];
	document?: AxcutDocument | null;
	existingTrims?: Array<{ startSec: number; endSec: number; assetId?: string }>;
	policy?: DeadAirPolicyConfig;
	/** V1 injection — mapped to visual assessor. */
	visualHits?: VisualActivityHit[];
	preparedChanges?: VisualChange[] | null;
	ledger?: TemporalEventLedger | null;
	ocrObservations?: CachedOcrObservation[] | null;
	forceSkipFfmpegVisualFallback?: boolean;
}): Promise<DeadAirCandidateV1> {
	const policy = args.policy ?? DEFAULT_DEAD_AIR_POLICY;
	const pad = policy.speechPaddingSec;
	let blockingReasons: string[] = [];
	const warnings: string[] = [];
	const preserveConstraints = [
		"must_survive_adjacent_speech",
		"keep_some_pause",
		"source_media_time_trim_only",
		"visual_activity_safety_v1_1",
	];

	if (
		fullyCoveredByTrims(
			args.interval.startSec,
			args.interval.endSec,
			args.existingTrims ?? [],
			args.assetId,
		)
	) {
		return {
			id: nextCandId(),
			assetId: args.assetId,
			silenceRange: {
				timebase: "SOURCE_MEDIA_TIME",
				startSec: args.interval.startSec,
				endSec: args.interval.endSec,
			},
			proposedTrimRange: null,
			silenceDurationSec: args.interval.durationSec,
			resultingRemovedDurationSec: 0,
			classification: "ALREADY_REMOVED",
			confidence: "none",
			evidenceRefs: [
				{
					kind: "silence_interval",
					id: `${args.interval.startSec}-${args.interval.endSec}`,
					note: "already covered by trimRanges",
				},
			],
			speechBoundaryState: {
				before: { kind: "none" },
				after: { kind: "none" },
				blocking: true,
			},
			paddingBeforeSec: pad,
			paddingAfterSec: pad,
			targetPauseKeptSec: 0,
			preserveConstraints,
			safeToPropose: false,
			blockingReasons: ["already_trimmed_source"],
			warnings,
			...EMPTY_VISUAL,
		};
	}

	let classification = classifySilenceInterval({
		interval: args.interval,
		durationSec: args.durationSec,
		speechWindows: args.speechWindows,
		policy,
	});

	const before = findSpeechBefore(args.speechWindows, args.interval.startSec);
	const after = findSpeechAfter(args.speechWindows, args.interval.endSec);

	if (classification === "TOO_SHORT") {
		blockingReasons.push("silence_below_candidate_threshold");
	}
	if (classification === "WITHIN_PROTECTED_CONTEXT") {
		blockingReasons.push("overlaps_protected_speech");
	}
	if (classification === "UNKNOWN") {
		blockingReasons.push("speech_boundary_unknown");
	}
	if (classification === "INTER_SENTENCE_PAUSE") {
		const minShorten = policy.interSentenceMinShortenSec ?? 0.95;
		const allowShorten =
			policy.allowInterSentenceShorten === true && args.interval.durationSec + 1e-9 >= minShorten;
		if (allowShorten) {
			warnings.push(
				"Inter-sentence pause eligible for SHORTEN (keep natural breath; remove excess).",
			);
		} else {
			blockingReasons.push("natural_inter_sentence_pause");
			warnings.push("Inter-sentence pause kept; not proposed as dead air.");
		}
	}
	if (classification === "TRAILING_SILENCE" && !policy.allowTrailingPropose) {
		blockingReasons.push("trailing_outro_uncertain");
	}

	const pauseFn: PauseFunctionClass =
		classification === "LEADING_SILENCE"
			? "WAITING"
			: classification === "TRAILING_SILENCE"
				? "ENDING_SILENCE"
				: classification === "INTER_SENTENCE_PAUSE"
					? "COMPREHENSION_PAUSE"
					: before.kind !== "none" && after.kind !== "none"
						? "COMPREHENSION_PAUSE"
						: args.interval.durationSec >= 1.6
							? "DEAD_AIR"
							: "HESITATION";
	const keepOverride = targetPauseForFunction(pauseFn, policy);

	const keep = planKeepSomePause({
		silenceStartSec: args.interval.startSec,
		silenceEndSec: args.interval.endSec,
		classification,
		paddingBeforeSec: pad,
		paddingAfterSec: pad,
		policy,
		targetPauseKeptSecOverride: keepOverride,
	});

	let proposedTrimRange = keep.ok ? keep.proposedTrim : null;
	let resultingRemovedDurationSec = keep.resultingRemovedDurationSec;
	if (
		!keep.ok &&
		(classification === "POSSIBLE_DEAD_AIR" ||
			classification === "LEADING_SILENCE" ||
			(classification === "INTER_SENTENCE_PAUSE" && policy.allowInterSentenceShorten))
	) {
		blockingReasons.push(keep.reason ?? "keep_pause_rejected");
	}

	// Punch this silencedetect interval out of STT must-survive ranges so
	// inflated transcript windows cannot block cuts in confirmed quiet.
	const silenceBlock = {
		startSec: args.interval.startSec,
		endSec: args.interval.endSec,
	};
	const mustSurviveRanges = args.speechWindows.flatMap((w) =>
		subtractRanges({ startSec: w.startSourceTimeSec, endSec: w.endSourceTimeSec }, [
			silenceBlock,
		]).map((r) => ({
			startSourceSec: r.startSec,
			endSourceSec: r.endSec,
		})),
	);

	const confirmedSilenceRanges = [
		{
			startSourceSec: args.interval.startSec,
			endSourceSec: args.interval.endSec,
		},
	];

	let speechBoundaryBlocking = false;
	let assessedRisk: string | undefined;
	if (proposedTrimRange && args.document) {
		const assessment = assessSpeechBoundary({
			document: args.document,
			assetId: args.assetId,
			trimStartSec: proposedTrimRange.startSec,
			trimEndSec: proposedTrimRange.endSec,
			mustSurviveRanges,
			confirmedSilenceRanges,
		});
		assessedRisk = assessment.risk;
		speechBoundaryBlocking = assessment.blocking;
		if (assessment.blocking) {
			blockingReasons.push(`speech_boundary_${assessment.risk}`);
			proposedTrimRange = null;
			resultingRemovedDurationSec = 0;
			// Clamp after overlapping *effective* speech (silence punched).
			const overlapEnds = mustSurviveRanges
				.filter(
					(w) => w.endSourceSec > args.interval.startSec && w.startSourceSec < args.interval.endSec,
				)
				.map((w) => w.endSourceSec);
			const afterSpeech =
				overlapEnds.length > 0 ? Math.max(...overlapEnds) : args.interval.startSec;
			const clampStart = Math.max(args.interval.startSec + pad, afterSpeech + pad);
			const clampEnd = args.interval.endSec - pad;
			const removed = clampEnd - clampStart;
			if (removed >= policy.minRemovableSec && args.document) {
				const clamped = {
					timebase: "SOURCE_MEDIA_TIME" as const,
					startSec: clampStart,
					endSec: clampEnd,
				};
				const reassessment = assessSpeechBoundary({
					document: args.document,
					assetId: args.assetId,
					trimStartSec: clamped.startSec,
					trimEndSec: clamped.endSec,
					mustSurviveRanges,
					confirmedSilenceRanges,
				});
				if (!reassessment.blocking) {
					proposedTrimRange = clamped;
					resultingRemovedDurationSec = removed;
					speechBoundaryBlocking = false;
					assessedRisk = reassessment.risk;
					blockingReasons = blockingReasons.filter((r) => !r.startsWith("speech_boundary_"));
					warnings.push("Trim clamped after transcript speech to preserve spoken words.");
				}
			}
			// LEADING: also try clamp before first effective speech (intro pad).
			if (!proposedTrimRange && classification === "LEADING_SILENCE") {
				const speechStarts = mustSurviveRanges
					.filter((w) => w.startSourceSec < args.interval.endSec)
					.map((w) => w.startSourceSec);
				const beforeSpeech =
					speechStarts.length > 0 ? Math.min(...speechStarts) : args.interval.endSec;
				const leadKeep = Math.max(policy.targetPauseLeadingSec, keepOverride);
				const leadStart = args.interval.startSec + leadKeep;
				const leadEnd = Math.min(args.interval.endSec - pad, beforeSpeech - pad);
				const leadRemoved = leadEnd - leadStart;
				if (leadRemoved >= policy.minRemovableSec) {
					const clamped = {
						timebase: "SOURCE_MEDIA_TIME" as const,
						startSec: leadStart,
						endSec: leadEnd,
					};
					const reassessment = assessSpeechBoundary({
						document: args.document,
						assetId: args.assetId,
						trimStartSec: clamped.startSec,
						trimEndSec: clamped.endSec,
						mustSurviveRanges,
						confirmedSilenceRanges,
					});
					if (!reassessment.blocking) {
						proposedTrimRange = clamped;
						resultingRemovedDurationSec = leadRemoved;
						speechBoundaryBlocking = false;
						assessedRisk = reassessment.risk;
						blockingReasons = blockingReasons.filter((r) => !r.startsWith("speech_boundary_"));
						warnings.push("Leading silence clamped before speech onset.");
					}
				}
			}
		}
	} else if (
		proposedTrimRange &&
		args.speechWindows.length === 0 &&
		(classification === "POSSIBLE_DEAD_AIR" || classification === "UNKNOWN")
	) {
		blockingReasons.push("speech_boundary_unknown");
		proposedTrimRange = null;
		resultingRemovedDurationSec = 0;
	}

	const mayProposeClassification =
		classification === "POSSIBLE_DEAD_AIR" ||
		classification === "LEADING_SILENCE" ||
		(classification === "TRAILING_SILENCE" && policy.allowTrailingPropose) ||
		(classification === "INTER_SENTENCE_PAUSE" &&
			policy.allowInterSentenceShorten === true &&
			args.interval.durationSec + 1e-9 >= (policy.interSentenceMinShortenSec ?? 0.95));

	const speechWouldBeSafe =
		mayProposeClassification &&
		proposedTrimRange != null &&
		resultingRemovedDurationSec >= policy.minRemovableSec &&
		!speechBoundaryBlocking &&
		!blockingReasons.some((r) => isVisualHardBlock(r));

	const visualPolicy = {
		...policy.visualSafety,
		blockCursorInteraction: policy.visualCursorBlock && policy.visualSafety.blockCursorInteraction,
	};

	const visualAssessment = await assessVisualActivity({
		mediaPath: args.mediaPath,
		silenceStartSec: args.interval.startSec,
		silenceEndSec: args.interval.endSec,
		proposedTrimStartSec: proposedTrimRange?.startSec ?? null,
		proposedTrimEndSec: proposedTrimRange?.endSec ?? null,
		preparedChanges: args.preparedChanges,
		ledger: args.ledger,
		ocrObservations: args.ocrObservations,
		policy: visualPolicy,
		injectedHits: args.visualHits,
		forceSkipFfmpegFallback:
			args.forceSkipFfmpegVisualFallback === true ||
			args.visualHits != null ||
			args.preparedChanges != null ||
			args.ledger != null,
		candidateWouldBeSpeechSafe: speechWouldBeSafe,
	});

	const legacyHits: VisualActivityHit[] =
		args.visualHits ??
		visualAssessment.events
			.filter((e) => e.kind === "CURSOR_INTERACTION")
			.map((e) => ({
				kind: "cursor_interaction" as const,
				sourceTimeSec: e.range.startSec,
				note: e.note ?? "cursor",
			}));

	if (visualAssessmentBlocksSafePropose(visualAssessment)) {
		if (visualAssessment.state === "MATERIAL_VISUAL_ACTIVITY") {
			classification = "VISUAL_ACTIVITY_PRESENT";
			blockingReasons.push("visual_activity_in_silence");
		} else {
			classification = "VISUAL_ACTIVITY_UNCERTAIN";
			blockingReasons.push("visual_activity_uncertain");
		}
		for (const r of visualAssessment.blockingReasons) {
			blockingReasons.push(r);
		}
		// Explicit pause removal: if the remaining cut is speech-safe, keep it.
		// Users asked to remove no-voice gaps; cursor drift / minor motion in a
		// quiet tail must not erase a verified-safe timeline shorten.
		if (
			policy.explicitUserCut &&
			proposedTrimRange &&
			!speechBoundaryBlocking &&
			resultingRemovedDurationSec >= policy.minRemovableSec
		) {
			warnings.push(
				"Visual activity noted during silence; keeping speech-safe trim for explicit pause removal.",
			);
			// Restore editorial classification for trailing/interior quiet.
			if (
				classification === "VISUAL_ACTIVITY_PRESENT" ||
				classification === "VISUAL_ACTIVITY_UNCERTAIN"
			) {
				classification =
					args.interval.endSec >= (args.durationSec ?? args.interval.endSec) - 0.35
						? "TRAILING_SILENCE"
						: "POSSIBLE_DEAD_AIR";
			}
		} else {
			proposedTrimRange = null;
			resultingRemovedDurationSec = 0;
		}
	}

	const hardBlock = blockingReasons.some((r) => isVisualHardBlock(r));
	const explicitSpeechSafe =
		Boolean(policy.explicitUserCut) &&
		proposedTrimRange != null &&
		resultingRemovedDurationSec >= policy.minRemovableSec &&
		!speechBoundaryBlocking;

	const actuallySafe =
		(mayProposeClassification &&
			classification !== "VISUAL_ACTIVITY_PRESENT" &&
			classification !== "VISUAL_ACTIVITY_UNCERTAIN" &&
			proposedTrimRange != null &&
			resultingRemovedDurationSec >= policy.minRemovableSec &&
			!speechBoundaryBlocking &&
			!hardBlock &&
			visualAssessment.state === "NO_MATERIAL_VISUAL_ACTIVITY") ||
		explicitSpeechSafe;

	return {
		id: nextCandId(),
		assetId: args.assetId,
		silenceRange: {
			timebase: "SOURCE_MEDIA_TIME",
			startSec: args.interval.startSec,
			endSec: args.interval.endSec,
		},
		proposedTrimRange: actuallySafe ? proposedTrimRange : null,
		silenceDurationSec: args.interval.durationSec,
		resultingRemovedDurationSec: actuallySafe ? resultingRemovedDurationSec : 0,
		classification,
		confidence: confidenceFor(classification, before, after),
		evidenceRefs: [
			{
				kind: "silence_interval",
				id: `${args.interval.startSec.toFixed(3)}_${args.interval.endSec.toFixed(3)}`,
				note: `ffmpeg_silencedetect ${args.interval.durationSec.toFixed(3)}s`,
			},
			...(before.id
				? [{ kind: "speech_before", id: before.id, note: before.text ?? "speech_before" }]
				: []),
			...(after.id
				? [{ kind: "speech_after", id: after.id, note: after.text ?? "speech_after" }]
				: []),
			...visualAssessment.events.flatMap((e) => e.evidenceRefs),
		],
		speechBoundaryState: {
			before,
			after,
			assessedRisk,
			blocking: speechBoundaryBlocking,
		},
		paddingBeforeSec: pad,
		paddingAfterSec: pad,
		targetPauseKeptSec: keep.targetPauseKeptSec,
		preserveConstraints,
		safeToPropose: actuallySafe,
		blockingReasons: actuallySafe ? [] : [...new Set(blockingReasons)],
		visualActivity: legacyHits,
		visualActivityState: visualAssessment.state,
		visualEvidenceRefs: visualAssessment.events.flatMap((e) => e.evidenceRefs),
		visualBlockingReasons: visualAssessment.blockingReasons,
		visualSafetyVersion: VISUAL_SAFETY_VERSION,
		visualActivityAssessment: visualAssessment,
		warnings,
	};
}

export function resolveSpeechWindows(args: {
	document?: AxcutDocument | null;
	assetId: string;
	speechEvidence?: SpeechEvidence | null;
}): SpeechWindow[] {
	const fromEv = speechWindowsFromEvidence(args.speechEvidence);
	if (fromEv.length > 0) return fromEv;
	return speechWindowsFromTranscript(args.document, args.assetId);
}
