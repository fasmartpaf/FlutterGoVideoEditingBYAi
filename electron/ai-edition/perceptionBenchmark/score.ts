/**
 * Score predictions against human ground truth — no silent failure fixing.
 */

import type {
	BenchmarkObservation,
	DetectionVerdict,
	EventScore,
	GroundTruthEvent,
	GroundTruthMustNotClaim,
	HallucinationHit,
	PerceptionBenchmarkResult,
	PerceptionGroundTruth,
} from "./types";

function overlaps(a0: number, a1: number, b0: number, b1: number, padSec = 1.0): boolean {
	return a0 - padSec <= b1 && b0 <= a1 + padSec;
}

function textBlob(parts: string[]): string {
	return parts.join("\n").toLowerCase();
}

function hintsHit(blob: string, hints: string[] | undefined): boolean {
	if (!hints?.length) return false;
	const lower = blob.toLowerCase();
	return hints.some((h) => {
		const needle = h.toLowerCase();
		const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const re = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i");
		const m = re.exec(lower);
		if (!m) return false;
		const idx = m.index + (m[0].match(/^[a-z0-9]/i) ? 0 : 1);
		if (/^(no |without |not |silent)/.test(needle)) return true;
		const window = lower.slice(Math.max(0, idx - 24), idx + needle.length + 12);
		if (/\bno (visible )?|\bnot (a |any |the )?\b|\bwithout (any )?|\bnever\b/.test(window)) {
			return false;
		}
		return true;
	});
}

function observationTime(o: BenchmarkObservation): number | undefined {
	if (typeof o.timeSec === "number") return o.timeSec;
	if (typeof o.startSec === "number") return o.startSec;
	return undefined;
}

export function scoreEvent(
	event: GroundTruthEvent,
	observations: BenchmarkObservation[],
): EventScore {
	const near = observations.filter((o) => {
		const t = observationTime(o);
		const oStart = o.startSec ?? t;
		const oEnd = o.endSec ?? t;
		if (oStart == null || oEnd == null) {
			if (t == null) return hintsHit(o.description, event.matchHints);
			return t >= event.startSec - 1.5 && t <= event.endSec + 1.5;
		}
		return overlaps(event.startSec, event.endSec, oStart, oEnd, 1.25);
	});

	const blob = textBlob(near.map((o) => o.description));
	const anyHint = hintsHit(blob, event.matchHints);
	const broad = textBlob(observations.map((o) => o.description));
	const broadHint = hintsHit(broad, event.matchHints);

	let verdict: DetectionVerdict = "MISSED";
	let notes = "no overlapping observation with matching hints";
	let predictedTimeSec: number | undefined;
	let predictedStartSec: number | undefined;
	let predictedEndSec: number | undefined;

	if (near.length && anyHint) {
		verdict = "DETECTED_CORRECTLY";
		notes = `matched near ${near.length} observation(s)`;
		predictedStartSec = near[0]!.startSec ?? observationTime(near[0]!);
		predictedEndSec = near[0]!.endSec ?? predictedStartSec;
		predictedTimeSec = predictedStartSec;
	} else if (broadHint) {
		verdict = "PARTIALLY_DETECTED";
		notes = "hints found but outside temporal window (±1.25–1.5s)";
		const hit = observations.find((o) => hintsHit(o.description, event.matchHints));
		predictedTimeSec = hit ? observationTime(hit) : undefined;
	} else if (near.length && !event.matchHints?.length) {
		verdict = "PARTIALLY_DETECTED";
		notes = "temporal overlap without matchHints — cannot confirm meaning";
		predictedTimeSec = observationTime(near[0]!);
	} else if (
		near.length &&
		event.matchHints?.length &&
		!anyHint &&
		/\b(clicked|settings (is|are) open|frustrated|angry|mistake)\b/i.test(blob) &&
		!/\bno (audio|speech)|silent|without narration\b/i.test(blob)
	) {
		verdict = "INCORRECT";
		notes = "near-window observation contradicts or invents meaning";
	}

	const mid = (event.startSec + event.endSec) / 2;
	const absTimingErrorSec = predictedTimeSec != null ? Math.abs(predictedTimeSec - mid) : undefined;

	return {
		eventId: event.id,
		verdict,
		gtStartSec: event.startSec,
		gtEndSec: event.endSec,
		predictedTimeSec,
		predictedStartSec,
		predictedEndSec,
		absTimingErrorSec,
		notes,
	};
}

export function scoreHallucinations(
	mustNot: GroundTruthMustNotClaim[],
	texts: string[],
): HallucinationHit[] {
	const blob = texts.join("\n");
	const hits: HallucinationHit[] = [];
	for (const rule of mustNot) {
		for (const pat of rule.forbiddenPatterns) {
			const re = new RegExp(pat, "i");
			const m = blob.match(re);
			if (m) {
				hits.push({
					mustNotId: rule.id,
					kind: rule.kind,
					matchedText: m[0]!,
				});
				break;
			}
		}
	}
	return hits;
}

export function summarizeRecall(scores: EventScore[], gt: PerceptionGroundTruth) {
	const important = gt.events.filter(
		(e) => e.importance === "critical" || e.importance === "important",
	);
	const ids = new Set(important.map((e) => e.id));
	const subset = scores.filter((s) => ids.has(s.eventId));
	const detected = subset.filter((s) => s.verdict === "DETECTED_CORRECTLY").length;
	const partial = subset.filter((s) => s.verdict === "PARTIALLY_DETECTED").length;
	const missed = subset.filter((s) => s.verdict === "MISSED").length;
	const incorrect = subset.filter((s) => s.verdict === "INCORRECT").length;
	const denom = subset.length;
	return {
		criticalImportantTotal: denom,
		detected,
		partial,
		missed,
		incorrect,
		recall: denom === 0 ? null : (detected + 0.5 * partial) / denom,
	};
}

export function buildResultSkeleton(input: {
	gt: PerceptionGroundTruth;
	providerRunId: string;
	provider: string;
}): Pick<
	PerceptionBenchmarkResult,
	"caseId" | "providerRunId" | "provider" | "ranAt" | "groundTruthReady" | "mediaReady"
> {
	return {
		caseId: input.gt.caseId,
		providerRunId: input.providerRunId,
		provider: input.provider,
		ranAt: new Date().toISOString(),
		groundTruthReady: input.gt.events.length > 0 && input.gt.status !== "RECORDING_REQUIRED",
		mediaReady: Boolean(input.gt.mediaPath),
	};
}
