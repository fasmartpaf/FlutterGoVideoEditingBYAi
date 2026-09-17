/**
 * Speech presence vs speech value — shared temporal helpers.
 * Silencedetect quiet punches inflated STT windows (presence ≠ importance).
 */

export type SourceRangeSec = { startSec: number; endSec: number };

export type SpeechValueClass =
	| "ESSENTIAL"
	| "USEFUL"
	| "FILLER"
	| "HESITATION"
	| "REPETITION"
	| "FRAGMENT"
	| "TRANSITIONAL"
	| "UNCERTAIN"
	| "NONE";

export type TemporalDecisionKind = "REMOVE" | "SHORTEN" | "SPEED_UP" | "KEEP";

export type ContentValueClass =
	| "ESSENTIAL_EXPLANATION"
	| "USEFUL_EXPLANATION"
	| "IMPORTANT_ACTION"
	| "SUPPORTING_ACTION"
	| "NAVIGATION"
	| "WAITING"
	| "REPETITION"
	| "HESITATION"
	| "BREATHING_ROOM"
	| "DEAD_AIR"
	| "LOW_INFORMATION"
	| "UNKNOWN";

export type PauseFunctionClass =
	| "COMPREHENSION_PAUSE"
	| "ACTION_PAUSE"
	| "HESITATION"
	| "WAITING"
	| "DEAD_AIR"
	| "SECTION_BOUNDARY"
	| "ENDING_SILENCE"
	| "UNKNOWN";

function clampRange(r: SourceRangeSec): SourceRangeSec | null {
	if (!(r.endSec > r.startSec + 1e-6)) return null;
	return { startSec: r.startSec, endSec: r.endSec };
}

/** Merge overlapping/adjacent ranges. */
export function mergeRanges(ranges: SourceRangeSec[], joinGapSec = 0.02): SourceRangeSec[] {
	const sorted = [...ranges]
		.map(clampRange)
		.filter((r): r is SourceRangeSec => r != null)
		.sort((a, b) => a.startSec - b.startSec);
	if (sorted.length === 0) return [];
	const out: SourceRangeSec[] = [{ ...sorted[0]! }];
	for (let i = 1; i < sorted.length; i++) {
		const cur = sorted[i]!;
		const last = out[out.length - 1]!;
		if (cur.startSec <= last.endSec + joinGapSec) {
			last.endSec = Math.max(last.endSec, cur.endSec);
		} else {
			out.push({ ...cur });
		}
	}
	return out;
}

/** Subtract block ranges from a subject range. */
export function subtractRanges(
	subject: SourceRangeSec,
	blocks: SourceRangeSec[],
): SourceRangeSec[] {
	let parts: SourceRangeSec[] = [{ ...subject }];
	for (const b of mergeRanges(blocks)) {
		const next: SourceRangeSec[] = [];
		for (const p of parts) {
			if (b.endSec <= p.startSec || b.startSec >= p.endSec) {
				next.push(p);
				continue;
			}
			if (p.startSec < b.startSec) {
				const left = clampRange({ startSec: p.startSec, endSec: b.startSec });
				if (left) next.push(left);
			}
			if (b.endSec < p.endSec) {
				const right = clampRange({ startSec: b.endSec, endSec: p.endSec });
				if (right) next.push(right);
			}
		}
		parts = next;
	}
	return parts;
}

/** STT speech minus silencedetect-confirmed quiet → effective speech presence. */
export function effectiveSpeechRanges(
	speech: SourceRangeSec[],
	silence: SourceRangeSec[],
): SourceRangeSec[] {
	const out: SourceRangeSec[] = [];
	for (const s of mergeRanges(speech)) {
		out.push(...subtractRanges(s, silence));
	}
	return mergeRanges(out);
}

export function overlapSeconds(a: SourceRangeSec, b: SourceRangeSec): number {
	return Math.max(0, Math.min(a.endSec, b.endSec) - Math.max(a.startSec, b.startSec));
}

export function speechOverlapFraction(range: SourceRangeSec, speech: SourceRangeSec[]): number {
	let ov = 0;
	for (const s of speech) ov += overlapSeconds(range, s);
	return ov / Math.max(1e-6, range.endSec - range.startSec);
}

/**
 * Carve a candidate into subranges with low effective speech overlap.
 * Refinement around boundary fragments — not a global threshold change.
 */
export function carveAroundSpeech(args: {
	candidate: SourceRangeSec;
	speech: SourceRangeSec[];
	minSpanSec: number;
	padSec?: number;
}): SourceRangeSec[] {
	const pad = args.padSec ?? 0.1;
	const quiet = subtractRanges(args.candidate, args.speech).map((r) =>
		clampRange({
			startSec: r.startSec + pad,
			endSec: r.endSec - pad,
		}),
	);
	return quiet
		.filter((r): r is SourceRangeSec => r != null && r.endSec - r.startSec >= args.minSpanSec)
		.sort((a, b) => b.endSec - b.startSec - (a.endSec - a.startSec));
}

const FILLER_RE = /\b(um+|uh+|er+|ah+|like|you know|basically|actually|so yeah|okay so|ok so)\b/i;
const HESITATION_RE = /\b(um+|uh+|er+|hmm+)\b/i;

export function classifySpeechValue(args: {
	text: string;
	durationSec: number;
	overlapRatio: number;
}): SpeechValueClass {
	const text = args.text.trim();
	if (!text || args.overlapRatio <= 0) return "NONE";
	const words = text.split(/\s+/).filter(Boolean);
	if (words.length <= 2 && args.durationSec <= 1.2) return "FRAGMENT";
	if (HESITATION_RE.test(text) && words.length <= 4) return "HESITATION";
	if (FILLER_RE.test(text) && words.length <= 6) return "FILLER";
	if (words.length <= 4 && args.durationSec >= 2.5) return "TRANSITIONAL";
	const density = words.length / Math.max(0.4, args.durationSec);
	if (density >= 1.2 && words.length >= 6) return "USEFUL";
	if (density >= 0.8 && words.length >= 4) return "USEFUL";
	if (words.length >= 8) return "ESSENTIAL";
	return "UNCERTAIN";
}

export function classifyPauseFunction(args: {
	classification: string;
	durationSec: number;
	hasVisualActivity: boolean;
	hasClickOrAction: boolean;
	phase?: string;
}): PauseFunctionClass {
	if (args.classification === "LEADING_SILENCE") return "WAITING";
	if (args.classification === "TRAILING_SILENCE") return "ENDING_SILENCE";
	if (args.hasClickOrAction || args.phase === "IMPORTANT_ACTION") return "ACTION_PAUSE";
	if (args.hasVisualActivity) return "COMPREHENSION_PAUSE";
	if (args.durationSec >= 1.6) return "DEAD_AIR";
	if (args.durationSec >= 0.95) return "HESITATION";
	if (args.classification === "INTER_SENTENCE_PAUSE") return "COMPREHENSION_PAUSE";
	if (args.phase === "OUTRO" || args.phase === "INTRO") return "SECTION_BOUNDARY";
	return "UNKNOWN";
}

/** Retain more for comprehension/action; less for hesitation/dead air. */
export function targetPauseForFunction(
	fn: PauseFunctionClass,
	policy: {
		targetPauseInteriorSec: number;
		targetPauseLeadingSec: number;
		targetPauseTrailingSec: number;
	},
): number {
	switch (fn) {
		case "COMPREHENSION_PAUSE":
			return Math.max(policy.targetPauseInteriorSec, 0.55);
		case "ACTION_PAUSE":
			return Math.max(policy.targetPauseInteriorSec, 0.5);
		case "SECTION_BOUNDARY":
			return Math.max(policy.targetPauseInteriorSec, 0.45);
		case "WAITING":
			return policy.targetPauseLeadingSec;
		case "ENDING_SILENCE":
			return policy.targetPauseTrailingSec;
		case "HESITATION":
			return Math.min(policy.targetPauseInteriorSec, 0.35);
		case "DEAD_AIR":
			return Math.min(policy.targetPauseInteriorSec, 0.28);
		default:
			return policy.targetPauseInteriorSec;
	}
}

export function temporalDecisionFromEvidence(args: {
	contentValues: ContentValueClass[];
	speechValue: SpeechValueClass;
	speechOverlapRatio: number;
	pauseFunction?: PauseFunctionClass | null;
	visualUsefulSlow: boolean;
	silenceDurationSec?: number;
}): TemporalDecisionKind {
	const values = new Set(args.contentValues);
	const speechProtect =
		args.speechValue === "ESSENTIAL" ||
		args.speechValue === "USEFUL" ||
		(args.speechOverlapRatio > 0.35 &&
			args.speechValue !== "FRAGMENT" &&
			args.speechValue !== "FILLER" &&
			args.speechValue !== "NONE");

	if (speechProtect && !values.has("DEAD_AIR") && !values.has("WAITING")) {
		return "KEEP";
	}
	if (values.has("DEAD_AIR") || values.has("WAITING") || values.has("HESITATION")) {
		const dur = args.silenceDurationSec ?? 0;
		if (args.pauseFunction === "DEAD_AIR" && dur >= 1.2) return "SHORTEN";
		if (args.pauseFunction === "HESITATION" || args.pauseFunction === "WAITING") {
			return dur >= 0.9 ? "SHORTEN" : "KEEP";
		}
		if (args.pauseFunction === "ENDING_SILENCE") return dur >= 0.9 ? "SHORTEN" : "KEEP";
		if (dur >= 0.9) return "SHORTEN";
	}
	if (args.visualUsefulSlow && !speechProtect) return "SPEED_UP";
	if (values.has("LOW_INFORMATION") || values.has("NAVIGATION") || values.has("REPETITION")) {
		if (!speechProtect) return "SPEED_UP";
	}
	return "KEEP";
}
