/**
 * Speech / transcript boundary risk for trim cuts.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { SPEECH_BOUNDARY_EPSILON_SEC, type SpeechBoundaryRisk } from "./types";

export interface SpeechBoundaryResult {
	risk: SpeechBoundaryRisk;
	notes: string[];
	blocking: boolean;
	checkMs: number;
}

function segmentsForAsset(doc: AxcutDocument, assetId: string) {
	const t =
		doc.transcripts.find((x) => x.assetId === assetId) ??
		doc.transcripts[0] ??
		(doc.transcript?.assetId === assetId || !doc.transcript?.assetId ? doc.transcript : null);
	return t?.segments ?? [];
}

function classifyPoint(
	doc: AxcutDocument,
	assetId: string,
	t: number,
	protectedRanges: Array<{ startSourceSec: number; endSourceSec: number }>,
	confirmedSilenceRanges?: Array<{ startSourceSec: number; endSourceSec: number }>,
): { risk: SpeechBoundaryRisk; note?: string } {
	// Silencedetect-confirmed quiet is authoritative over inflated STT labels.
	for (const s of confirmedSilenceRanges ?? []) {
		if (
			t >= s.startSourceSec - SPEECH_BOUNDARY_EPSILON_SEC &&
			t <= s.endSourceSec + SPEECH_BOUNDARY_EPSILON_SEC
		) {
			return { risk: "safe_silence_boundary", note: `confirmed_silence:${t}` };
		}
	}

	for (const p of protectedRanges) {
		if (
			t > p.startSourceSec + SPEECH_BOUNDARY_EPSILON_SEC &&
			t < p.endSourceSec - SPEECH_BOUNDARY_EPSILON_SEC
		) {
			return { risk: "inside_protected_speech", note: `cut_inside_protected:${t}` };
		}
	}

	const segs = segmentsForAsset(doc, assetId);
	if (segs.length === 0) return { risk: "unknown", note: "no_transcript_segments" };

	const silenceHit = segs.some(
		(s) =>
			(s.kind === "silence" || (s.kind !== "speech" && !s.text)) &&
			t >= s.startSec - 1e-6 &&
			t <= s.endSec + 1e-6,
	);
	if (silenceHit) return { risk: "safe_silence_boundary" };

	for (const s of segs) {
		if (s.kind !== "speech" || !(s.endSec > s.startSec)) continue;
		if (
			t > s.startSec + SPEECH_BOUNDARY_EPSILON_SEC &&
			t < s.endSec - SPEECH_BOUNDARY_EPSILON_SEC
		) {
			return { risk: "inside_active_speech", note: `cut_inside_speech:${s.id ?? t}` };
		}
	}

	for (const s of segs) {
		if (s.kind !== "speech" || !(s.endSec > s.startSec)) continue;
		const near = Math.abs(t - s.startSec) <= 0.12 || Math.abs(t - s.endSec) <= 0.12;
		if (near) return { risk: "near_speech_boundary", note: `near_speech:${s.id ?? t}` };
	}

	return { risk: "safe_silence_boundary" };
}

export function assessSpeechBoundary(args: {
	document: AxcutDocument;
	assetId: string;
	trimStartSec: number;
	trimEndSec: number;
	mustSurviveRanges: Array<{ startSourceSec: number; endSourceSec: number }>;
	/** ffmpeg silencedetect intervals — cuts inside these are not "active speech". */
	confirmedSilenceRanges?: Array<{ startSourceSec: number; endSourceSec: number }>;
}): SpeechBoundaryResult {
	const t0 = Date.now();
	const notes: string[] = [];
	const a = classifyPoint(
		args.document,
		args.assetId,
		args.trimStartSec,
		args.mustSurviveRanges,
		args.confirmedSilenceRanges,
	);
	const b = classifyPoint(
		args.document,
		args.assetId,
		args.trimEndSec,
		args.mustSurviveRanges,
		args.confirmedSilenceRanges,
	);
	if (a.note) notes.push(a.note);
	if (b.note) notes.push(b.note);

	const rank: Record<SpeechBoundaryRisk, number> = {
		inside_protected_speech: 4,
		inside_active_speech: 3,
		near_speech_boundary: 2,
		unknown: 1,
		safe_silence_boundary: 0,
	};
	const risk = rank[a.risk] >= rank[b.risk] ? a.risk : b.risk;
	const blocking = risk === "inside_active_speech" || risk === "inside_protected_speech";
	if (blocking) notes.push(`BLOCKING:speech_boundary:${risk}`);

	return {
		risk,
		notes,
		blocking,
		checkMs: Date.now() - t0,
	};
}
