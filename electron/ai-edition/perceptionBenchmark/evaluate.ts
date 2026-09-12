/**
 * Extract BenchmarkObservations from current-stack evidence for scoring.
 */

import type {
	BenchmarkObservation,
	DetectionVerdict,
	EventScore,
	PerceptionBenchmarkResult,
	PerceptionGroundTruth,
	PerceptionRunEvidence,
} from "./types";

export function observationsFromEvidence(
	evidence: PerceptionRunEvidence,
	extra: BenchmarkObservation[] = [],
): BenchmarkObservation[] {
	const out: BenchmarkObservation[] = [...extra];

	for (const seg of evidence.speechSegments) {
		out.push({
			startSec: seg.startSec,
			endSec: seg.endSec,
			modality: "speech",
			description: seg.text,
			source: "speech",
		});
	}

	if (evidence.speechStatus === "no_audio" || evidence.speechStatus === "no_speech_detected") {
		out.push({
			modality: "speech",
			description: `speechStatus=${evidence.speechStatus}; no speech segments`,
			source: "speech",
		});
	}

	for (const ch of evidence.changeScores) {
		out.push({
			startSec: ch.fromSec,
			endSec: ch.toSec,
			modality: "visual",
			description: `visual change ${ch.classification} score=${ch.score.toFixed(3)}`,
			source: "visual_change",
		});
	}

	if (evidence.validatedSemanticSummary) {
		out.push({
			modality: "visual",
			description: evidence.validatedSemanticSummary,
			source: "semantic",
		});
	}

	if (evidence.sourceStorySummary) {
		out.push({
			modality: "multimodal",
			description: evidence.sourceStorySummary,
			source: "source_story",
		});
	}

	for (const beat of evidence.sourceStoryBeats ?? []) {
		out.push({
			startSec: beat.startSec,
			endSec: beat.endSec,
			modality: "multimodal",
			description: `${beat.purpose}: ${beat.summary}`,
			source: "source_story",
		});
	}

	// Sidecar presence stays on evidence.* — only count when the model affirms activity
	// (not when it denies cursor/pointer presence).
	const modelBlob = [
		evidence.finalUserText,
		evidence.sourceStorySummary,
		...(evidence.sourceStoryBeats ?? []).map((b) => b.summary),
		evidence.validatedSemanticSummary,
	]
		.filter(Boolean)
		.join("\n");
	const affirmsCursor =
		/\b(cursor|pointer|mouse)\b.{0,40}\b(move|moved|moving|click|clicked|activity|interaction)/i.test(
			modelBlob,
		) || /\b(click|clicked|pointer activity|cursor activity|cursor movement)\b/i.test(modelBlob);
	const deniesCursor =
		/\bno (visible )?cursor\b|\bno cursor (movements?|activity|interactions?)\b|\bwithout (any )?cursor\b/i.test(
			modelBlob,
		);
	if (evidence.cursorEventCount > 0 && affirmsCursor && !deniesCursor) {
		out.push({
			modality: "cursor",
			description: `model-acknowledged cursor/pointer activity (${evidence.cursorEventCount} sidecar samples)`,
			source: "cursor",
		});
	}

	if (evidence.finalUserText) {
		out.push({
			modality: "multimodal",
			description: evidence.finalUserText,
			source: "user_text",
		});
	}

	// Intentionally omit rawSemanticText from scoring observations — it may contain
	// scaffold/tool/document labels (e.g. asset names) that inflate recall.

	return out;
}

export function evaluateSpeech(
	gt: PerceptionGroundTruth,
	scores: EventScore[],
	evidence: PerceptionRunEvidence,
	allText: string,
): PerceptionBenchmarkResult["speechEval"] {
	const speechEvents = gt.events.filter((e) => e.modality === "speech");
	if (speechEvents.length === 0 && !gt.referenceSpeech?.length) {
		return {
			semanticCorrect: null,
			technicalNameErrors: [],
			correctionDetected: null,
			pauseDetected: null,
			hallucinatedSpeech: false,
			notes: "no speech ground truth for this case",
		};
	}

	const pauseScore = scores.find((s) => /pause/i.test(s.eventId));
	const correctionScore = scores.find((s) => /correct/i.test(s.eventId));
	const speechScores = scores.filter((id) => speechEvents.some((e) => e.id === id.eventId));
	const detected = speechScores.filter((s) => s.verdict === "DETECTED_CORRECTLY").length;
	const semanticCorrect = speechScores.length === 0 ? null : detected / speechScores.length >= 0.5;

	const technicalNameErrors: string[] = [];
	const expectedNames = ["OpenScreen", "timeline", "technical audit"];
	for (const name of expectedNames) {
		const refHas = (gt.referenceSpeech ?? []).some((r) =>
			r.text.toLowerCase().includes(name.toLowerCase()),
		);
		if (!refHas) continue;
		const got = evidence.speechSegments.some((s) =>
			s.text.toLowerCase().includes(name.toLowerCase()),
		);
		if (!got && !allText.toLowerCase().includes(name.toLowerCase())) {
			technicalNameErrors.push(name);
		}
	}

	const silentExpected = speechEvents.some((e) =>
		/no spoken|no audio|silent/i.test(e.expectedMeaning),
	);
	const hallucinatedSpeech =
		silentExpected &&
		(evidence.speechSegments.some((s) => s.text.trim().length > 8) ||
			/\b(speaker|narrator) (said|says|explains)\b/i.test(allText));

	return {
		semanticCorrect,
		technicalNameErrors,
		correctionDetected: correctionScore
			? correctionScore.verdict === "DETECTED_CORRECTLY" ||
				correctionScore.verdict === "PARTIALLY_DETECTED"
			: null,
		pauseDetected: pauseScore
			? pauseScore.verdict === "DETECTED_CORRECTLY" || pauseScore.verdict === "PARTIALLY_DETECTED"
			: null,
		hallucinatedSpeech,
		notes: `speech events scored=${speechScores.length}; segments=${evidence.speechSegments.length}; status=${evidence.speechStatus ?? "?"}`,
	};
}

export function evaluateVisual(
	gt: PerceptionGroundTruth,
	scores: EventScore[],
): PerceptionBenchmarkResult["visualEval"] {
	const pick = (pred: (id: string, meaning: string) => boolean): DetectionVerdict | "N/A" => {
		const ev = gt.events.find((e) => e.modality === "visual" && pred(e.id, e.expectedMeaning));
		if (!ev) return "N/A";
		return scores.find((s) => s.eventId === ev.id)?.verdict ?? "MISSED";
	};

	return {
		notes: `visual events=${gt.events.filter((e) => e.modality === "visual").length}`,
		appStateChange: pick((id, m) => /matrix|scroll|change|progress/i.test(id + m)),
		briefUiEvent: pick((id, m) => /brief|dropdown|notification|flash/i.test(id + m)),
		smallText: pick((id, m) => /small|table|ocr|text/i.test(id + m)),
	};
}

export function evaluateMultimodal(
	gt: PerceptionGroundTruth,
	scores: EventScore[],
	allText: string,
): PerceptionBenchmarkResult["multimodalEval"] {
	const mm = gt.events.find((e) => e.modality === "multimodal");
	if (!mm) {
		const hasSpeech = gt.events.some((e) => e.modality === "speech");
		const hasVisual = gt.events.some((e) => e.modality === "visual");
		if (!(hasSpeech && hasVisual)) {
			return { notes: "not applicable", correlated: null };
		}
		// Heuristic: both modalities detected in overlapping windows
		const speechOk = scores.some(
			(s) =>
				gt.events.find((e) => e.id === s.eventId)?.modality === "speech" &&
				(s.verdict === "DETECTED_CORRECTLY" || s.verdict === "PARTIALLY_DETECTED"),
		);
		const visualOk = scores.some(
			(s) =>
				gt.events.find((e) => e.id === s.eventId)?.modality === "visual" &&
				(s.verdict === "DETECTED_CORRECTLY" || s.verdict === "PARTIALLY_DETECTED"),
		);
		return {
			notes: "implicit speech+visual co-presence (no dedicated multimodal GT event)",
			correlated: speechOk && visualOk,
		};
	}
	const score = scores.find((s) => s.eventId === mm.id);
	const correlated =
		score?.verdict === "DETECTED_CORRECTLY" ||
		(score?.verdict === "PARTIALLY_DETECTED" &&
			/\b(but|does not|cannot confirm|mentions)\b/i.test(allText));
	return {
		notes: score?.notes ?? "multimodal event unscored",
		correlated: correlated ?? false,
	};
}
