/**
 * Speech boundary verify for a programme join (deterministic, no LLM).
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { assessSpeechBoundary } from "../renderVerify/speechBoundary";
import type { JoinModalityResult, ProgrammeJoinV1 } from "./types";

function wordsNear(doc: AxcutDocument, assetId: string, t: number, pad = 0.35): string[] {
	const tr = doc.transcripts.find((x) => x.assetId === assetId);
	if (!tr?.words?.length) return [];
	return tr.words
		.filter((w) => w.endSec >= t - pad && w.startSec <= t + pad)
		.map((w) => w.id)
		.slice(0, 12);
}

function cutInsideWord(
	doc: AxcutDocument,
	assetId: string,
	t: number,
	eps = 0.05,
): { hit: boolean; wordId?: string } {
	const tr = doc.transcripts.find((x) => x.assetId === assetId);
	if (!tr?.words?.length) return { hit: false };
	for (const w of tr.words) {
		if (!(w.endSec > w.startSec) || !w.text.trim()) continue;
		if (t > w.startSec + eps && t < w.endSec - eps) {
			return { hit: true, wordId: w.id };
		}
	}
	return { hit: false };
}

export function verifyJoinSpeech(args: {
	document: AxcutDocument;
	join: ProgrammeJoinV1;
	mustSurviveRanges?: Array<{ startSourceSec: number; endSourceSec: number }>;
	/** ffmpeg silencedetect / dead-air intervals — STT spans covering confirmed quiet are not active speech. */
	confirmedSilenceRanges?: Array<{ startSourceSec: number; endSourceSec: number }>;
}): JoinModalityResult {
	const t0 = Date.now();
	const notes: string[] = [];
	const blocking: string[] = [];
	const warnings: string[] = [];
	const evidenceRefs: string[] = [];

	if (args.join.cause === "SPEED_BOUNDARY") {
		return {
			outcome: "NOT_APPLICABLE",
			blockingReasons: [],
			warnings: [],
			evidenceRefs: [],
			notes: ["speed_boundary_not_a_speech_cut"],
			latencyMs: Date.now() - t0,
			metrics: {},
		};
	}

	const leftCut = args.join.leftSourceRange.endSec;
	const rightCut = args.join.rightSourceRange.startSec;
	const assetId = args.join.leftAssetId;

	const tr = args.document.transcripts.find((x) => x.assetId === assetId);
	if (!tr?.segments?.length && !tr?.words?.length) {
		return {
			outcome: "INSUFFICIENT_EVIDENCE",
			blockingReasons: [],
			warnings: ["no_transcript"],
			evidenceRefs: [],
			notes: ["no_transcript_for_speech_join_check"],
			latencyMs: Date.now() - t0,
		};
	}

	const leftInside = cutInsideWord(args.document, assetId, leftCut);
	const rightInside = cutInsideWord(args.document, assetId, rightCut);
	if (leftInside.hit) {
		blocking.push(`cut_inside_word_left:${leftInside.wordId}`);
		evidenceRefs.push(`word:${leftInside.wordId}`);
	}
	if (rightInside.hit) {
		blocking.push(`cut_inside_word_right:${rightInside.wordId}`);
		evidenceRefs.push(`word:${rightInside.wordId}`);
	}

	const assessed = assessSpeechBoundary({
		document: args.document,
		assetId,
		trimStartSec: Math.min(leftCut, rightCut),
		trimEndSec: Math.max(leftCut, rightCut),
		mustSurviveRanges: args.mustSurviveRanges ?? [],
		confirmedSilenceRanges: args.confirmedSilenceRanges,
	});
	notes.push(...assessed.notes);
	if (assessed.blocking) {
		blocking.push(`speechBoundary:${assessed.risk}`);
	} else if (assessed.risk === "near_speech_boundary") {
		warnings.push(`near_speech_boundary`);
	} else if (assessed.risk === "unknown") {
		warnings.push("speech_risk_unknown");
	}

	args.join.speechContext = {
		leftWordIds: wordsNear(args.document, assetId, leftCut),
		rightWordIds: wordsNear(args.document, args.join.rightAssetId, rightCut),
		notes: [...notes],
	};

	const outcome = blocking.length > 0 ? "FAIL" : warnings.length > 0 ? "WARNING" : "PASS";

	return {
		outcome,
		blockingReasons: blocking,
		warnings,
		evidenceRefs,
		notes,
		latencyMs: Date.now() - t0,
		metrics: {
			leftCutSec: leftCut,
			rightCutSec: rightCut,
			speechRisk: assessed.risk,
		},
	};
}
