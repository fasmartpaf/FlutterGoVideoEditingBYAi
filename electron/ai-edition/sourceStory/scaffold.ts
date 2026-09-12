/**
 * Deterministic multimodal evidence scaffold for Source Story.
 * Does not invent visual facts or story purposes — only arranges known evidence.
 */

import type { SpeechEvidence, SpeechSegment } from "../speechEvidence/types";
import type { VisualChange, VisualEvidenceFrame } from "../visualEvidence/types";
import type {
	SourceStoryScaffold,
	SourceStoryScaffoldSpeech,
	SourceStoryScaffoldWindow,
} from "./types";

const BOUNDARY_MERGE_SEC = 0.45;
const PAUSE_GAP_SEC = 1.0;

function near(a: number, b: number, eps = BOUNDARY_MERGE_SEC): boolean {
	return Math.abs(a - b) <= eps;
}

function formatClock(sec: number): string {
	const s = Math.max(0, sec);
	const m = Math.floor(s / 60);
	const rem = s - m * 60;
	const whole = Math.floor(rem);
	const frac = Math.round((rem - whole) * 100);
	return `${String(m).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(frac).padStart(2, "0")}`;
}

export function speechSegmentsToScaffoldSpeech(
	segments: SpeechSegment[],
): SourceStoryScaffoldSpeech[] {
	return segments
		.filter((s) => s.text.trim() && s.endSourceTimeSec >= s.startSourceTimeSec)
		.map((s, i) => ({
			id: `s${i + 1}`,
			startSourceTimeSec: s.startSourceTimeSec,
			endSourceTimeSec: s.endSourceTimeSec,
			text: s.text.trim(),
		}));
}

function mergeBoundaries(raw: number[], durationSec: number): number[] {
	const sorted = [...new Set(raw.map((t) => Math.max(0, Math.min(durationSec, t))))].sort(
		(a, b) => a - b,
	);
	const out: number[] = [];
	for (const t of sorted) {
		const last = out[out.length - 1];
		if (last != null && near(last, t)) {
			// Prefer keeping earlier boundary; skip near-duplicates.
			continue;
		}
		out.push(t);
	}
	if (out[0] !== 0) out.unshift(0);
	if (out[out.length - 1] !== durationSec) out.push(durationSec);
	return out;
}

/**
 * Candidate beat boundaries from combined modalities.
 * Not one-per-transcript-segment and not one-per-frame — speech edges,
 * substantial pauses, and material visual changes (especially without narration).
 */
export function collectStoryBoundaryCandidates(input: {
	sourceDurationSec: number;
	speech: SourceStoryScaffoldSpeech[];
	visualChanges: VisualChange[];
	cursorEventTimes: number[];
	hasSpeech: boolean;
}): number[] {
	const { sourceDurationSec: dur } = input;
	const boundaries: number[] = [0, dur];
	for (const s of input.speech) {
		boundaries.push(s.startSourceTimeSec, s.endSourceTimeSec);
	}
	for (let i = 0; i < input.speech.length - 1; i++) {
		const a = input.speech[i]!;
		const b = input.speech[i + 1]!;
		const gap = b.startSourceTimeSec - a.endSourceTimeSec;
		if (gap >= PAUSE_GAP_SEC) {
			boundaries.push(a.endSourceTimeSec, b.startSourceTimeSec);
		}
	}
	for (const c of input.visualChanges) {
		if (c.classification === "minimal") continue;
		// Material visual change is a story-boundary candidate; with narration,
		// prefer changes that fall in/near speech gaps.
		if (!input.hasSpeech) {
			boundaries.push(c.toSourceTimeSec);
			continue;
		}
		const inGap = input.speech.some((s, i) => {
			const next = input.speech[i + 1];
			if (!next) return false;
			return (
				c.toSourceTimeSec + 0.05 >= s.endSourceTimeSec &&
				c.toSourceTimeSec - 0.05 <= next.startSourceTimeSec
			);
		});
		if (inGap || c.classification === "significant") {
			boundaries.push(c.toSourceTimeSec);
		}
	}
	for (const t of input.cursorEventTimes) {
		if (!input.hasSpeech) boundaries.push(t);
	}
	return mergeBoundaries(boundaries, dur);
}

function windowForRange(
	start: number,
	end: number,
	speech: SourceStoryScaffoldSpeech[],
	visualTimes: number[],
	visualChanges: VisualChange[],
	cursorEventTimes: number[],
): SourceStoryScaffoldWindow {
	const speechIn = speech.filter(
		(s) => s.endSourceTimeSec > start + 0.05 && s.startSourceTimeSec < end - 0.05,
	);
	const visualIn = visualTimes.filter((t) => t + 1e-6 >= start && t - 1e-6 <= end);
	const changesIn = visualChanges
		.filter(
			(c) =>
				c.classification !== "minimal" &&
				c.toSourceTimeSec + 1e-6 >= start &&
				c.fromSourceTimeSec - 1e-6 <= end,
		)
		.map((c) => ({
			fromSourceTimeSec: c.fromSourceTimeSec,
			toSourceTimeSec: c.toSourceTimeSec,
			classification: c.classification,
		}));
	const cursorIn = cursorEventTimes.filter((t) => t + 1e-6 >= start && t - 1e-6 <= end);
	const speechGap = speechIn.length === 0 && end - start >= PAUSE_GAP_SEC * 0.8;
	return {
		startSourceTimeSec: start,
		endSourceTimeSec: end,
		...(speechGap ? { speechGap: true } : {}),
		speech: speechIn,
		visualTimes: visualIn,
		visualChanges: changesIn,
		cursorEventTimes: cursorIn,
	};
}

export function buildSourceStoryScaffold(input: {
	sourceDurationSec: number;
	speechEvidence?: SpeechEvidence | null;
	frames?: VisualEvidenceFrame[];
	changes?: VisualChange[];
	cursorEventTimes?: number[];
	now?: () => number;
}): SourceStoryScaffold {
	const t0 = (input.now ?? Date.now)();
	const durationSec = input.sourceDurationSec;
	const speechStatus =
		input.speechEvidence?.status ?? (input.speechEvidence == null ? "none" : "unavailable");
	const speech = speechSegmentsToScaffoldSpeech(input.speechEvidence?.segments ?? []);
	const visualTimes = (input.frames ?? []).map((f) => f.sourceTimeSec).sort((a, b) => a - b);
	const changes = input.changes ?? [];
	const cursorEventTimes = [...(input.cursorEventTimes ?? [])].sort((a, b) => a - b);
	const hasSpeech = speech.length > 0;

	const boundaries = collectStoryBoundaryCandidates({
		sourceDurationSec: durationSec,
		speech,
		visualChanges: changes,
		cursorEventTimes,
		hasSpeech,
	});

	const windows: SourceStoryScaffoldWindow[] = [];
	for (let i = 0; i < boundaries.length - 1; i++) {
		const start = boundaries[i]!;
		const end = boundaries[i + 1]!;
		if (end - start < 0.05) continue;
		windows.push(windowForRange(start, end, speech, visualTimes, changes, cursorEventTimes));
	}

	const draft: SourceStoryScaffold = {
		sourceDurationSec: durationSec,
		speechStatus,
		speechSegments: speech,
		visualTimes,
		cursorEventTimes,
		windows,
		timings: {
			storyScaffoldPreparationMs: 0,
			inputEvidenceChars: 0,
			promptChars: 0,
		},
	};
	const evidenceText = formatSourceStoryScaffoldText(draft);
	draft.timings.inputEvidenceChars = evidenceText.length;
	draft.timings.storyScaffoldPreparationMs = (input.now ?? Date.now)() - t0;
	return draft;
}

/** Human-readable chronological scaffold for the model (SOURCE_MEDIA_TIME). */
export function formatSourceStoryScaffoldText(scaffold: SourceStoryScaffold): string {
	const lines: string[] = [
		`SOURCE STORY EVIDENCE SCAFFOLD (SOURCE_MEDIA_TIME, duration ${scaffold.sourceDurationSec.toFixed(3)}s)`,
		`speechStatus: ${scaffold.speechStatus}`,
		"These windows are evidence groupings — NOT the final story beats. Interpret communication purpose; merge/split windows when purpose requires it.",
		"Do NOT invent visual facts beyond supplied frames. Do NOT treat spoken claims as verified on-screen facts without visual support.",
		"A pause/gap is evidence (pause/transition) — never label it 'unnecessary dead time' (that is an edit judgment).",
	];
	if (scaffold.speechStatus === "no_audio") {
		lines.push(
			"Recording has NO AUDIO STREAM — there is no spoken narration (media state, not a transcription failure/unavailable). Do not invent speech. Do not create pause/silence story beats solely because audio is absent.",
		);
	} else if (scaffold.speechStatus === "no_speech_detected") {
		lines.push(
			"Audio stream present but no spoken narration detected — distinct from no_audio and from transcription unavailable.",
		);
	} else if (scaffold.speechStatus === "unavailable" || scaffold.speechStatus === "failed") {
		lines.push(
			"Transcription was requested but is unavailable/failed for this turn — distinct from no_audio.",
		);
	}
	lines.push("");
	for (const w of scaffold.windows) {
		lines.push(
			`${formatClock(w.startSourceTimeSec)}–${formatClock(w.endSourceTimeSec)}${w.speechGap ? " [speech gap]" : ""}`,
		);
		if (w.speech.length === 0) {
			lines.push("  SPEECH: (none in this window)");
		} else {
			for (const s of w.speech) {
				lines.push(
					`  SPEECH [${s.id}] ${formatClock(s.startSourceTimeSec)}–${formatClock(s.endSourceTimeSec)}: "${s.text}"`,
				);
			}
		}
		if (w.visualTimes.length === 0) {
			lines.push("  VISUAL: (no sampled frame timestamp in this window)");
		} else {
			lines.push(
				`  VISUAL sample times: ${w.visualTimes.map((t) => formatClock(t)).join(", ")} (describe only from attached frames)`,
			);
		}
		if (w.visualChanges.length > 0) {
			lines.push(
				`  VISUAL changes: ${w.visualChanges
					.map(
						(c) =>
							`${formatClock(c.fromSourceTimeSec)}→${formatClock(c.toSourceTimeSec)} ${c.classification}`,
					)
					.join("; ")}`,
			);
		}
		if (w.cursorEventTimes.length === 0) {
			lines.push("  CURSOR: (none / unavailable)");
		} else {
			lines.push(
				`  CURSOR event times: ${w.cursorEventTimes.map((t) => formatClock(t)).join(", ")}`,
			);
		}
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}
