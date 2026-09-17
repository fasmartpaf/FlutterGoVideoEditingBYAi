/**
 * Deterministic caption grouping from timed words.
 * Text is never paraphrased — only segmented.
 */

import { mergeGroupingPolicy } from "./policy";
import type { CaptionGroupingPolicy, CaptionWordSpan } from "./types";

export interface CaptionGroupDraft {
	words: CaptionWordSpan[];
	sourceStartSec: number;
	sourceEndSec: number;
	text: string;
	flags: string[];
}

function endsWithPunctuation(text: string, chars: string): boolean {
	const t = text.trim();
	if (!t) return false;
	return chars.includes(t[t.length - 1]!);
}

function durationOf(words: CaptionWordSpan[]): number {
	if (words.length === 0) return 0;
	return Math.max(0, words[words.length - 1]!.sourceEndSec - words[0]!.sourceStartSec);
}

function readingFlags(words: CaptionWordSpan[], policy: CaptionGroupingPolicy): string[] {
	const flags: string[] = [];
	const dur = Math.max(1e-3, durationOf(words));
	const text = words.map((w) => w.text).join(" ");
	const cps = text.replace(/\s+/g, "").length / dur;
	const wps = words.length / dur;
	if (cps > policy.maxCharactersPerSecond) flags.push("reading_speed_cps_high");
	if (wps > policy.maxWordsPerSecond) flags.push("reading_speed_wps_high");
	if (cps < policy.minCharactersPerSecond && words.length >= policy.minWordsPerCue) {
		flags.push("reading_speed_cps_low");
	}
	if (dur > policy.maxCueDurationSec) flags.push("cue_duration_long");
	if (dur < policy.minCueDurationSec && words.length > 0) flags.push("cue_duration_short");
	return flags;
}

function flush(words: CaptionWordSpan[], policy: CaptionGroupingPolicy): CaptionGroupDraft | null {
	if (words.length === 0) return null;
	const text = words
		.map((w) => w.text.trim())
		.filter(Boolean)
		.join(" ");
	if (!text) return null;
	return {
		words: [...words],
		sourceStartSec: words[0]!.sourceStartSec,
		sourceEndSec: words[words.length - 1]!.sourceEndSec,
		text,
		flags: readingFlags(words, policy),
	};
}

/**
 * Split a dense run preferring mid-run break near punctuation / half-point.
 * Does not invent words or change speech timing.
 */
function splitDenseRun(
	words: CaptionWordSpan[],
	policy: CaptionGroupingPolicy,
): CaptionGroupDraft[] {
	if (words.length <= 1) {
		const one = flush(words, policy);
		return one ? [one] : [];
	}
	const out: CaptionGroupDraft[] = [];
	let i = 0;
	while (i < words.length) {
		const remaining = words.length - i;
		let take = Math.min(policy.maxWordsPerCue, remaining);
		if (remaining > policy.maxWordsPerCue) {
			// Prefer punctuation break inside window.
			let punctAt = -1;
			for (let j = i + policy.minWordsPerCue - 1; j < i + take; j++) {
				if (endsWithPunctuation(words[j]!.text, policy.punctuationBreakChars)) {
					punctAt = j;
				}
			}
			if (punctAt >= i + policy.minWordsPerCue - 1) {
				take = punctAt - i + 1;
			} else if (
				policy.orphanWordAvoidance &&
				remaining - take > 0 &&
				remaining - take < policy.minWordsPerCue
			) {
				take = Math.max(policy.minWordsPerCue, remaining - policy.minWordsPerCue);
			}
		}
		// Further split if still too dense on reading speed.
		const slice = words.slice(i, i + take);
		const dur = Math.max(1e-3, durationOf(slice));
		const cps =
			slice
				.map((w) => w.text)
				.join("")
				.replace(/\s+/g, "").length / dur;
		if (cps > policy.maxCharactersPerSecond && slice.length > policy.minWordsPerCue) {
			const half = Math.max(policy.minWordsPerCue, Math.floor(slice.length / 2));
			const a = flush(slice.slice(0, half), policy);
			const b = flush(slice.slice(half), policy);
			if (a) out.push(a);
			if (b) out.push(b);
		} else {
			const g = flush(slice, policy);
			if (g) out.push(g);
		}
		i += take;
	}
	return out;
}

export function groupWordsIntoCaptionDrafts(
	wordsIn: CaptionWordSpan[],
	policyPartial?: Partial<CaptionGroupingPolicy>,
): CaptionGroupDraft[] {
	const policy = mergeGroupingPolicy(policyPartial);
	const words = [...wordsIn]
		.filter((w) => w.text.trim().length > 0)
		.sort((a, b) => a.sourceStartSec - b.sourceStartSec || a.sourceEndSec - b.sourceEndSec);
	if (words.length === 0) return [];

	const runs: CaptionWordSpan[][] = [];
	let cur: CaptionWordSpan[] = [words[0]!];
	for (let i = 1; i < words.length; i++) {
		const prev = words[i - 1]!;
		const w = words[i]!;
		const gap = w.sourceStartSec - prev.sourceEndSec;
		const punctBreak = endsWithPunctuation(prev.text, policy.punctuationBreakChars);
		const runDur = durationOf(cur);
		const runWords = cur.length;
		if (
			gap >= policy.pauseBreakSec ||
			(punctBreak && runWords >= policy.minWordsPerCue) ||
			runWords >= policy.maxWordsPerCue ||
			runDur >= policy.maxCueDurationSec
		) {
			runs.push(cur);
			cur = [w];
		} else {
			cur.push(w);
		}
	}
	if (cur.length) runs.push(cur);

	const out: CaptionGroupDraft[] = [];
	for (const run of runs) {
		out.push(...splitDenseRun(run, policy));
	}
	return out;
}
