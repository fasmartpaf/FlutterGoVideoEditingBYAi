/**
 * Multimodal source story — deterministic beats from local evidence.
 * Narrative language for humans; detector uncertainty stays uncertainty.
 * Does NOT invent UI actions or OCR.
 */

import type { DeadAirCandidateV1 } from "../deadAir";
import type {
	EditorialFocalAnalysisBundleV1,
	VisualChangeIntervalV1,
} from "../editorialFocalEvidence";
import type { PackedEditorialTranscriptV1 } from "../professionalEditOrchestrator/types";
import {
	AUTONOMOUS_PROFESSIONAL_EDITOR_V1_ID,
	type MultimodalSourceStoryV1,
	type MultimodalStoryBeatV1,
	type StoryBeatKindV1,
} from "./types";

function overlaps(
	a: { startSec: number; endSec: number },
	b: { startSec: number; endSec: number },
): number {
	return Math.max(0, Math.min(a.endSec, b.endSec) - Math.max(a.startSec, b.startSec));
}

function classifyBeat(args: {
	index: number;
	count: number;
	hasSpeech: boolean;
	visualBusy: boolean;
	waiting: boolean;
	focal: boolean;
}): StoryBeatKindV1 {
	if (args.index === 0) return "OPENING_SETUP";
	if (args.index >= args.count - 1) return "CLOSING";
	if (args.waiting && !args.hasSpeech) return "WAITING_REPETITION";
	if (args.focal || (args.visualBusy && args.hasSpeech)) return "ACTION_DEMONSTRATION";
	if (args.hasSpeech) return "EXPLANATION";
	if (!args.hasSpeech && !args.visualBusy) return "WAITING_REPETITION";
	return "UNCERTAIN";
}

function beatNarrative(args: {
	kind: StoryBeatKindV1;
	speech: string;
	visualBusy: boolean;
	waiting: boolean;
	focalCount: number;
	deadAirSafe: boolean;
	index: number;
	count: number;
}): string {
	const speech = args.speech.trim();
	const parts: string[] = [];
	if (args.index === 0) {
		parts.push(
			speech
				? `The speaker opens by saying: “${speech.slice(0, 120)}”.`
				: "The recording opens; spoken topic is not clearly labeled yet.",
		);
	} else if (args.kind === "CLOSING" || args.index >= args.count - 1) {
		parts.push(
			speech
				? `Toward the end, the speaker says: “${speech.slice(0, 100)}”.`
				: "The ending trails without a clear closing statement.",
		);
		if (args.deadAirSafe) parts.push("There is unused quiet time before the cut.");
	} else if (speech) {
		parts.push(`The speaker explains: “${speech.slice(0, 140)}”.`);
	} else {
		parts.push("There is little useful speech in this stretch.");
	}

	if (args.focalCount > 0) {
		parts.push(
			args.focalCount === 1
				? "A clear on-screen interaction draws attention."
				: "On-screen interactions occur that may need visual emphasis.",
		);
	} else if (args.visualBusy) {
		parts.push("The screen is changing while the demonstration continues.");
	} else if (args.waiting) {
		parts.push("The viewer is waiting through low-information screen time.");
	}

	if (args.deadAirSafe && args.kind !== "CLOSING") {
		parts.push("A pause here slows pacing without adding information.");
	}

	return parts.join(" ");
}

function buildSummary(beats: MultimodalStoryBeatV1[], dur: number): string {
	const speechBits = beats
		.map((b) => b.speechSummary)
		.filter((t) => t && !t.startsWith("(") && t.length > 8)
		.slice(0, 4);
	const hasFocal = beats.some((b) => b.focalEvidenceRefs.length > 0);
	const hasWait = beats.some(
		(b) => b.kind === "WAITING_REPETITION" || b.preservationStatus === "SAFE_TO_TIGHTEN",
	);
	const arcs: string[] = [];
	if (speechBits[0]) {
		arcs.push(`Someone is demonstrating while speaking (“${speechBits[0].slice(0, 80)}”).`);
	} else {
		arcs.push(`A ~${dur.toFixed(0)}s screen demonstration with sparse labeled speech.`);
	}
	if (hasFocal) arcs.push("Important clicks/actions appear mid-sequence.");
	if (hasWait) arcs.push("There are stretches where the viewer waits.");
	const last = beats[beats.length - 1];
	if (last?.kind === "CLOSING")
		arcs.push("The ending should feel intentional, not abrupt dead air.");
	return arcs.join(" ");
}

export function buildMultimodalSourceStory(args: {
	assetId: string;
	sourceDurationSec: number;
	packed: PackedEditorialTranscriptV1;
	visualIntervals?: VisualChangeIntervalV1[] | null;
	focal?: EditorialFocalAnalysisBundleV1 | null;
	deadAir?: DeadAirCandidateV1[] | null;
}): MultimodalSourceStoryV1 {
	const t0 = Date.now();
	const dur = Math.max(0.1, args.sourceDurationSec);
	const segs = args.packed.segments;
	const beats: MultimodalStoryBeatV1[] = [];

	const windows =
		segs.length > 0
			? segs.map((s) => ({ startSec: s.startSec, endSec: s.endSec, speech: s.speechText }))
			: [
					{ startSec: 0, endSec: dur * 0.2, speech: "" },
					{ startSec: dur * 0.2, endSec: dur * 0.7, speech: "" },
					{ startSec: dur * 0.7, endSec: dur, speech: "" },
				];

	for (let i = 0; i < windows.length; i += 1) {
		const w = windows[i]!;
		const range = { startSec: w.startSec, endSec: w.endSec };
		const visualBusy = (args.visualIntervals ?? []).some(
			(v) =>
				(v.kind === "activity" || v.kind === "significant") &&
				overlaps(range, { startSec: v.startSec, endSec: v.endSec }) > 0.15,
		);
		const waiting = (args.visualIntervals ?? []).some(
			(v) =>
				v.kind === "stable" &&
				overlaps(range, { startSec: v.startSec, endSec: v.endSec }) >
					0.5 * Math.max(0.1, range.endSec - range.startSec),
		);
		const focals = (args.focal?.targets ?? []).filter(
			(t) => t.status === "GROUNDED" && overlaps(range, t.sourceRange) > 0.1,
		);
		const da = (args.deadAir ?? []).filter((c) => overlaps(range, c.silenceRange) > 0.2);
		const deadAirSafe = da.some((c) => c.safeToPropose);
		const silenceCov = da.reduce((acc, c) => acc + overlaps(range, c.silenceRange), 0);
		const rangeDur = Math.max(0.1, range.endSec - range.startSec);
		// STT text overlapping silencedetect quiet is presence, not value.
		const mostlyQuiet = silenceCov / rangeDur > 0.45;
		const hasSpeech = w.speech.trim().length > 0 && !mostlyQuiet;
		const kind = classifyBeat({
			index: i,
			count: windows.length,
			hasSpeech,
			visualBusy,
			waiting: waiting || deadAirSafe,
			focal: focals.length > 0,
		});
		const density =
			hasSpeech && visualBusy
				? "HIGH"
				: hasSpeech || visualBusy
					? "MEDIUM"
					: waiting
						? "LOW"
						: "UNKNOWN";

		const speechSummary = w.speech.trim().slice(0, 160) || "(no speech in beat)";
		const narrative = beatNarrative({
			kind,
			speech: w.speech,
			visualBusy,
			waiting: waiting || deadAirSafe,
			focalCount: focals.length,
			deadAirSafe,
			index: i,
			count: windows.length,
		});

		beats.push({
			id: `msb_${i}`,
			kind,
			sourceRange: range,
			speechSummary,
			visualState: narrative,
			importantActions: focals.map(
				(f) => `Interaction near (${f.focalPoint.cx.toFixed(2)}, ${f.focalPoint.cy.toFixed(2)})`,
			),
			focalEvidenceRefs: focals.map((f) => f.targetId),
			informationDensity: density,
			preservationStatus: hasSpeech
				? "MUST_SURVIVE"
				: deadAirSafe
					? "SAFE_TO_TIGHTEN"
					: "UNCERTAIN",
			confidence: hasSpeech || focals.length > 0 ? "HIGH" : waiting ? "MEDIUM" : "LOW",
			evidenceRefs: [
				`packed_seg:${i}`,
				...da.map((c) => `dead_air:${c.id}`),
				...focals.map((f) => f.targetId),
			],
		});
	}

	return {
		version: 1,
		providerId: AUTONOMOUS_PROFESSIONAL_EDITOR_V1_ID,
		assetId: args.assetId,
		sourceDurationSec: dur,
		summary: buildSummary(beats, dur),
		beats,
		metrics: { buildMs: Date.now() - t0, paidAiCalls: 0 },
	};
}
