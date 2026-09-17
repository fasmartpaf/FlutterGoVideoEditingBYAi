/**
 * Editorial text normalization — compositional transforms, not phrase lists.
 * Turns wording variation into comparable tokens for slot extraction.
 */

const WORD_NUMBERS: Record<string, number> = {
	zero: 0,
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10,
	eleven: 11,
	twelve: 12,
	thirteen: 13,
	fourteen: 14,
	fifteen: 15,
	sixteen: 16,
	seventeen: 17,
	eighteen: 18,
	nineteen: 19,
	twenty: 20,
	thirty: 30,
};

/** Map common written numbers (including "twenty five") to digits. */
export function replaceWordNumbers(text: string): string {
	let out = text;
	// compound: twenty[- ]five
	out = out.replace(
		/\b(twenty|thirty)\s*[-\s]?\s*(one|two|three|four|five|six|seven|eight|nine)\b/gi,
		(_m, tens: string, ones: string) => {
			const t = WORD_NUMBERS[tens.toLowerCase()] ?? 0;
			const o = WORD_NUMBERS[ones.toLowerCase()] ?? 0;
			return String(t + o);
		},
	);
	out = out.replace(
		/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty)\b/gi,
		(m) => String(WORD_NUMBERS[m.toLowerCase()] ?? m),
	);
	return out;
}

/**
 * Normalize chat text for local editorial slot extraction.
 * Order matters: casing → punctuation → polite shells → fillers → units → numbers.
 */
export function normalizeEditorialText(raw: string): string {
	let t = raw.trim().toLowerCase();
	t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
	t = t.replace(/[!?]+$/g, "");
	t = t.replace(/[,;:]+/g, " ");
	t = t.replace(/~/g, " approx ");
	t = t.replace(/\s+/g, " ").trim();

	// Strip polite / discourse shells (not intent).
	t = t.replace(/^(?:hey|hi|hello|please|kindly|just|also|actually|so)\s+/g, "");
	t = t.replace(/^(?:can|could|would|will)\s+(?:you|we|u)\s+(?:please\s+)?/g, "");
	t = t.replace(/^(?:i\s+(?:need|want|d like|would like)\s+(?:you\s+to\s+)?)/g, "");
	t = t.replace(/^(?:try\s+to|try\s+and|help\s+me|let'?s)\s+/g, "");
	t = t.replace(/\bkidnly\b/g, "kindly"); // common typo → then strip if leading
	t = t.replace(/^kindly\s+/g, "");

	// Unit aliases → canonical "sec"
	t = t.replace(/\b(?:seconds?|secs?)\b/g, "sec");
	t = t.replace(/\b(\d+)\s*s\b/g, "$1 sec");
	// Preserve zoom scale tokens (1.5x) before "." → space, else "1.5x" becomes "1 5x".
	t = t.replace(/\b(\d+)\.(\d+)\s*x\b/g, "$1p$2x");
	t = t.replace(/\./g, " ");
	t = t.replace(/\b(\d+)p(\d+)x\b/g, "$1.$2x");
	t = t.replace(/\s+/g, " ").trim();

	// Approximate / filler before quantities
	t = t.replace(
		/\b(?:approximately|approx|roughly|around|about|near(?:ly)?|nearer|close\s+to|closer\s+to|toward|towards)\b/g,
		"approx",
	);

	// Duration relation verbs → under / to (must NOT eat "make it under")
	t = t.replace(/\b(?:less\s+than|below|under|no\s+more\s+than|at\s+most)\b/g, "under");
	t = t.replace(
		/\b(?:down\s+to|bring\s+(?:it|this|the\s+video)?\s*(?:down\s+)?to|get\s+(?:it|this)?\s*(?:down\s+)?to|cut\s+(?:it|this)?\s*(?:down\s+)?to|shorten\s+(?:(?:the|this)\s+)?(?:video\s+)?to)\b/g,
		"to",
	);
	t = t.replace(/\bbring\s+(?:it|this)\s+closer\s+to\b/g, "to");
	// "make it/this only N sec" → to N (duration only when a number follows soon)
	t = t.replace(/\bmake\s+(?:it|this)\s+(?:only\s+)?(?=\d)/g, "to ");

	// Drop determiner fillers before numbers: "a 12", "the 12"
	t = t.replace(/\b(?:a|an|the)\s+(?=\d)/g, "");
	t = t.replace(/\bapprox\s+(?:a|an|the)\s+/g, "approx ");

	t = replaceWordNumbers(t);

	// Common editorial typos / informalisms (slot tokens, not phrase catalogues).
	t = t.replace(/\bthems\b/g, "them");
	t = t.replace(/\btransations?\b/g, "transitions");
	t = t.replace(/\btrasitions?\b/g, "transitions");
	t = t.replace(/\bunzooming\b/g, "unzoom");
	t = t.replace(/\bzooming\b/g, "zoom");
	t = t.replace(/\brefram(?:e|ing)\b/g, "reframe");

	t = t.replace(/\s+/g, " ").trim();
	return t;
}

export type SpeechAct = "QUESTION" | "COMMAND" | "CONSTRAINT" | "OPINION";

/** Detect speech act before mutation routing. */
export function detectSpeechAct(raw: string, normalized: string): SpeechAct {
	const r = raw.trim();
	const n = normalized;

	// Explicit negative preservation — not a remove / add-zoom command.
	if (
		/\b(?:don'?t|do\s+not|never)\s+(?:remove|delete|cut|undo|zoom|add\s+(?:a\s+)?zoom)\b/.test(n)
	) {
		return "CONSTRAINT";
	}

	if (/\bwhat\s+do\s+you\s+think\b|\byour\s+(?:opinion|take)\b|\bthoughts\s+on\b/.test(n)) {
		return "OPINION";
	}

	const looksLikeQuestion =
		/^(?:why|what|how|when|where|who|which)\b/i.test(r) ||
		(/\?/.test(r) && /\b(?:why|what|how|think|opinion|feel|did\s+you|have\s+you)\b/i.test(r));

	if (looksLikeQuestion) {
		// "Can you make it under 12?" is still a COMMAND.
		if (
			/^(?:can|could|would|will)\s+(?:you|we|u)\b/i.test(r) &&
			/\b(?:make|edit|remove|cut|shorten|speed|undo|restore|turn|get|bring|add|zoom|unzoom|transition|caption|subtitle)\b/i.test(
				n,
			)
		) {
			return "COMMAND";
		}
		return "QUESTION";
	}

	return "COMMAND";
}

export interface DurationSlot {
	/** Upper bound when under/below/less-than. */
	maxSec: number | null;
	/** Soft target when about/around/to. */
	approxSec: number | null;
	relation: "under" | "approx" | "to" | null;
}

export interface TimeRangeSlot {
	startSec: number;
	endSec: number;
	/** True when only a single timestamp was given (end is a default hold). */
	singleTimestamp: boolean;
	/**
	 * Leading/trailing programme cut relative to current duration.
	 * Resolved to absolute programme seconds at apply time.
	 */
	relativeEdge?: "first" | "last" | null;
	/** True when the user pointed near a moment (pause grounding), not a hard cut span. */
	nearTimestamp?: boolean;
}

const DEFAULT_ZOOM_HOLD_SEC = 4;

function parseClockPair(a: string, b: string): number {
	const mm = Number(a);
	const ss = Number(b);
	if (!Number.isFinite(mm) || !Number.isFinite(ss)) return Number.NaN;
	return mm * 60 + ss;
}

/**
 * Extract an explicit timeline range (not programme duration) from normalized text.
 * Handles: from X to Y, between X and Y, until, MM SS clocks, single "at N".
 */
export function extractTimeRangeSlot(normalized: string): TimeRangeSlot | null {
	const n = normalized;

	// first / beginning N sec — absolute programme [0, N] once duration is known
	let m = n.match(
		/\b(?:first|leading|opening)\s+(\d+(?:\.\d+)?)(?:\s*sec)?\b|\b(?:beginning|start|intro)\s+(?:by\s+)?(\d+(?:\.\d+)?)(?:\s*sec)?\b|\btrim\s+(?:the\s+)?(?:beginning|start)\s+(?:by\s+)?(\d+(?:\.\d+)?)(?:\s*sec)?\b/,
	);
	if (m) {
		const sec = Number(m[1] ?? m[2] ?? m[3]);
		if (Number.isFinite(sec) && sec > 0) {
			return {
				startSec: 0,
				endSec: sec,
				singleTimestamp: false,
				relativeEdge: "first",
			};
		}
	}

	// last / ending / trailing N sec
	m = n.match(
		/\b(?:last|final|trailing|ending)\s+(\d+(?:\.\d+)?)(?:\s*sec)?\b|\b(?:end|ending|outro)\s+(?:by\s+)?(\d+(?:\.\d+)?)(?:\s*sec)?\b|\btrim\s+(?:the\s+)?(?:end|ending)\s+(?:by\s+)?(\d+(?:\.\d+)?)(?:\s*sec)?\b/,
	);
	if (m) {
		const sec = Number(m[1] ?? m[2] ?? m[3]);
		if (Number.isFinite(sec) && sec > 0) {
			return {
				startSec: 0,
				endSec: sec,
				singleTimestamp: false,
				relativeEdge: "last",
			};
		}
	}

	// from [a] [sec] 5 sec to 10 sec  |  from 5 sec to 10 sec  |  from 5 to 10
	m = n.match(
		/\bfrom\s+(?:(?:a|the)\s+)?(?:sec(?:ond)?\s+)?(\d+(?:\.\d+)?)(?:\s*sec)?\s+(?:to|until|till)\s+(?:(?:a|the)\s+)?(?:sec(?:ond)?\s+)?(\d+(?:\.\d+)?)(?:\s*sec)?\b/,
	);
	if (m) {
		const startSec = Number(m[1]);
		const endSec = Number(m[2]);
		if (Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec) {
			return { startSec, endSec, singleTimestamp: false };
		}
	}

	// between 5 and 10 [sec]
	m = n.match(/\bbetween\s+(\d+(?:\.\d+)?)(?:\s*sec)?\s+and\s+(\d+(?:\.\d+)?)(?:\s*sec)?\b/);
	if (m) {
		const startSec = Number(m[1]);
		const endSec = Number(m[2]);
		if (Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec) {
			return { startSec, endSec, singleTimestamp: false };
		}
	}

	// clock forms after ":" → space: "00 05 to 00 10"
	m = n.match(/\b(?:from\s+)?(\d{1,2})\s+(\d{2})\s+(?:to|until|till)\s+(\d{1,2})\s+(\d{2})\b/);
	if (m) {
		const startSec = parseClockPair(m[1]!, m[2]!);
		const endSec = parseClockPair(m[3]!, m[4]!);
		if (Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec) {
			return { startSec, endSec, singleTimestamp: false };
		}
	}

	// after N sec (open-ended → N .. N+hold) — caller may reinterpret
	m = n.match(/\bafter\s+(?:that\s+)?(?:at\s+)?(\d+(?:\.\d+)?)(?:\s*sec)?\b/);
	if (m && /\b(?:zoom\s+out|pull\s+back|return|wider|full\s+screen|unzoom)\b/.test(n)) {
		const startSec = Number(m[1]);
		if (Number.isFinite(startSec)) {
			return {
				startSec,
				endSec: startSec + DEFAULT_ZOOM_HOLD_SEC,
				singleTimestamp: true,
			};
		}
	}

	// cut/remove/trim 5 sec to 8 sec (no "from")
	m = n.match(
		/\b(?:cut|remove|delete|drop|trim)\s+(\d+(?:\.\d+)?)(?:\s*sec)?\s+(?:to|until|till|-)\s+(\d+(?:\.\d+)?)(?:\s*sec)?\b/,
	);
	if (m) {
		const startSec = Number(m[1]);
		const endSec = Number(m[2]);
		if (Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec) {
			return { startSec, endSec, singleTimestamp: false };
		}
	}

	// bare "5 to 10 seconds" / "8s to 12s" (speed / make Nx phrases)
	m = n.match(/\b(\d+(?:\.\d+)?)(?:\s*sec)?\s+(?:to|until|till|-)\s+(\d+(?:\.\d+)?)(?:\s*sec)?\b/);
	if (
		m &&
		/\b(?:speed|faster|slower|slow|make|playback)\b/.test(n) &&
		!/\b(?:under|approx|about|around)\b/.test(n)
	) {
		const startSec = Number(m[1]);
		const endSec = Number(m[2]);
		if (Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec) {
			return { startSec, endSec, singleTimestamp: false };
		}
	}

	// pause/silence near a moment — "around" normalizes to "approx"
	m = n.match(/\b(?:at|around|near|approx)\s+(\d+(?:\.\d+)?)(?:\s*sec)?\b/);
	if (m && /\b(?:pause|silence|silences|dead\s*air|gaps?|quiet)\b/.test(n)) {
		const startSec = Number(m[1]);
		if (Number.isFinite(startSec)) {
			return {
				startSec,
				endSec: startSec,
				singleTimestamp: true,
				nearTimestamp: true,
			};
		}
	}

	// transition / overlay near a programme moment ("around" → "approx")
	m = n.match(/\b(?:at|around|near|approx)\s+(\d+(?:\.\d+)?)(?:\s*sec)?\b/);
	if (
		m &&
		/\b(?:transition|dissolve|crossfade|cross\s*-?\s*fade|callout|title|caption|subtitle|label|highlight)\b/.test(
			n,
		)
	) {
		const startSec = Number(m[1]);
		if (Number.isFinite(startSec)) {
			return {
				startSec,
				endSec: startSec,
				singleTimestamp: true,
				nearTimestamp: true,
			};
		}
	}

	// at / around N sec — single timestamp with default hold (zoom)
	m = n.match(/\b(?:at|around|near|approx)\s+(\d+(?:\.\d+)?)(?:\s*sec)?\b/);
	if (m && /\bzoom\b/.test(n)) {
		const startSec = Number(m[1]);
		if (Number.isFinite(startSec)) {
			return {
				startSec,
				endSec: startSec + DEFAULT_ZOOM_HOLD_SEC,
				singleTimestamp: true,
			};
		}
	}

	// "start it at 4" / "until 11" — single bound (caller pairs with session zoom)
	m = n.match(/\b(?:start(?:\s+it)?\s+at|from)\s+(\d+(?:\.\d+)?)(?:\s*sec)?\b/);
	if (m && !/\bto\s+\d|\buntil\s+\d|\bbetween\b/.test(n)) {
		const startSec = Number(m[1]);
		if (Number.isFinite(startSec)) {
			return {
				startSec,
				endSec: startSec + DEFAULT_ZOOM_HOLD_SEC,
				singleTimestamp: true,
			};
		}
	}
	m = n.match(
		/\b(?:keep\s+it\s+until|until|till|end(?:\s+it)?\s+at)\s+(\d+(?:\.\d+)?)(?:\s*sec)?\b/,
	);
	if (m) {
		const endSec = Number(m[1]);
		if (Number.isFinite(endSec)) {
			return {
				startSec: Math.max(0, endSec - DEFAULT_ZOOM_HOLD_SEC),
				endSec,
				singleTimestamp: true,
			};
		}
	}

	return null;
}

/**
 * Extract duration target compositionally from normalized text.
 * Must not steal explicit timeline ranges ("from 5s to 10s") as programme duration.
 */
export function extractDurationSlot(normalized: string): DurationSlot {
	const empty: DurationSlot = { maxSec: null, approxSec: null, relation: null };

	const looksLikeTimelineRange =
		/\bfrom\b.+\b(?:to|until|till)\b/.test(normalized) ||
		/\bbetween\b.+\band\b/.test(normalized) ||
		/\b(?:cut|remove|delete|drop|trim)\s+\d+(?:\.\d+)?(?:\s*sec)?\s+(?:to|until|till|-)\s+\d+/.test(
			normalized,
		) ||
		/\b(?:first|last|leading|trailing|beginning|ending)\s+\d+(?:\.\d+)?(?:\s*sec)?\b/.test(
			normalized,
		) ||
		(/\b(?:pause|silence|dead\s*air|gaps?)\b/.test(normalized) &&
			/\b(?:at|around|near|approx)\s+\d+/.test(normalized)) ||
		// "make 5 to 10 seconds 2x" / "speed up 8s to 12s"
		(/\b\d+(?:\.\d+)?(?:\s*sec)?\s+(?:to|until|till|-)\s+\d+(?:\.\d+)?/.test(normalized) &&
			/\b(?:speed|faster|slower|\d+(?:\.\d+)?\s*x)\b/.test(normalized));
	const zoomOrFramingEdit = /\bzoom|unzoom|closer|wider|pull\s+back|reframe|full\s+screen\b/.test(
		normalized,
	);
	const explicitCutEdit =
		/\b(?:remove|cut|delete|drop|trim)\b/.test(normalized) &&
		!/\b(?:pause|silence|dead\s*air|unnecessary\s+pauses?)\b/.test(normalized);
	const explicitSpeedEdit =
		/\b(?:speed\s+up|faster|slower|playback\s+speed|\d+(?:\.\d+)?\s*x)\b/.test(normalized) &&
		!/\bzoom\b/.test(normalized);
	const explicitTransitionEdit =
		/\b(?:transition|dissolve|crossfade|cross\s*-?\s*fade)\b/.test(normalized) ||
		(/\bfade\b/.test(normalized) && !/\bfade\s+to\s+black\b/.test(normalized));

	if (
		looksLikeTimelineRange ||
		explicitCutEdit ||
		explicitSpeedEdit ||
		zoomOrFramingEdit ||
		explicitTransitionEdit
	) {
		// Still allow true programme targets: "shorten the video to 20 sec"
		const programmeOnly =
			/\b(?:video|runtime|duration|programme|program)\b/.test(normalized) &&
			/\b(?:under|to|approx)\b/.test(normalized);
		if (!programmeOnly) return empty;
	}

	// under N sec
	let m = normalized.match(/\bunder\s+(\d+(?:\.\d+)?)\s*sec\b/);
	if (m) {
		const n = Number(m[1]);
		return { maxSec: n, approxSec: n, relation: "under" };
	}

	// to approx N / approx N / to N sec
	m = normalized.match(/\b(?:to\s+)?approx\s+(\d+(?:\.\d+)?)\s*sec\b/);
	if (m) {
		const n = Number(m[1]);
		return { maxSec: n, approxSec: n, relation: "approx" };
	}

	m = normalized.match(/\bapprox\s+(\d+(?:\.\d+)?)\s*sec\b/);
	if (m) {
		const n = Number(m[1]);
		return { maxSec: n, approxSec: n, relation: "approx" };
	}

	// "to N sec" is programme duration only when it is NOT a from→to timeline range.
	m = normalized.match(/\bto\s+(\d+(?:\.\d+)?)\s*sec\b/);
	if (
		m &&
		!(
			looksLikeTimelineRange &&
			(zoomOrFramingEdit || !/\b(?:video|runtime|duration|shorten)\b/.test(normalized))
		)
	) {
		if (!looksLikeTimelineRange) {
			const n = Number(m[1]);
			return { maxSec: n, approxSec: n, relation: "to" };
		}
	}

	// N sec with shorten/cut/compress/too-long/shave/aim/runtime cues
	m = normalized.match(/\b(\d+(?:\.\d+)?)\s*sec\b/);
	if (
		m &&
		/\b(?:shorten|cut|compress|tighter|shorter|duration|too\s+long|length|shave|aim|runtime)\b/.test(
			normalized,
		) &&
		!zoomOrFramingEdit &&
		!looksLikeTimelineRange &&
		!explicitCutEdit
	) {
		const n = Number(m[1]);
		return { maxSec: n, approxSec: n, relation: "approx" };
	}

	return empty;
}
