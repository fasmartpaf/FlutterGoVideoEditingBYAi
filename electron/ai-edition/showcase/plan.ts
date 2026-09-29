/**
 * Showcase video — the plan.
 *
 * A showcase turns a screen recording into a branded, motion-designed video:
 * the recording plays inside a floating 3D window over an animated brand
 * background, with a logo intro/outro, step cards, zooms, highlights, ticks
 * and click ripples. The agent describes WHAT happens and WHEN in the
 * recording's own seconds (the times it sees in getVideoSummary and
 * sampleFrames from:'recording'); this module turns that into the timing the
 * renderer uses after the trim and speed-ups are applied.
 *
 * Everything here is pure (no IO) so the timing maths is unit-tested.
 */

import { z } from "zod";

const frac = z.number().min(0).max(1);
const sec = z.number().min(0);

/** A box on the recording, as fractions of the full recording frame. */
const boxSchema = z.object({ x: frac, y: frac, width: z.number().gt(0).max(1), height: z.number().gt(0).max(1) });

export const showcaseArgsSchema = z.object({
	/** Part of the recording to use (source seconds). Default: all of it. */
	trim: z.object({ startSec: sec, endSec: sec }).optional(),
	/** Show only this part of the screen (fractions of the recording) — e.g. drop half-visible sidebars. */
	crop: boxSchema.optional(),
	/** Speed up slow or repetitive stretches (long scrolls, waiting). Source seconds; rate 1.25–8. */
	speed: z
		.array(z.object({ startSec: sec, endSec: sec, rate: z.number().min(1.1).max(8) }))
		.max(12)
		.optional(),
	/** Camera push-ins on what matters. x/y = centre of interest (fractions of the recording), zoom 1.05–2.2. */
	focus: z
		.array(z.object({ startSec: sec, endSec: sec, x: frac, y: frac, zoom: z.number().min(1.05).max(2.2).default(1.35) }))
		.max(12)
		.optional(),
	/** Step cards beside the window, one idea each. Source seconds. */
	steps: z
		.array(
			z.object({
				startSec: sec,
				endSec: sec,
				/** Short headline, 2–5 words. */
				title: z.string().trim().min(1).max(48),
				/** Word(s) of the title drawn in the brand gradient. Default: the last word. */
				accent: z.string().trim().max(40).optional(),
				/** One short line under the headline. */
				body: z.string().trim().max(110).optional(),
				/** Small label above the headline. Default "Step n". */
				kicker: z.string().trim().max(24).optional(),
				/** Show a big counter that counts up to this number (e.g. 5 tasks). */
				count: z.number().int().min(0).max(999).optional(),
			}),
		)
		.max(8)
		.optional(),
	/** Glowing rings around something on screen (a button, a line of text). */
	highlights: z.array(boxSchema.extend({ startSec: sec, endSec: sec })).max(12).optional(),
	/** Tick badges that pop in one by one (list items being done). */
	checks: z.array(z.object({ atSec: sec, x: frac, y: frac, untilSec: sec.optional() })).max(20).optional(),
	/** Click ripples. */
	clicks: z.array(z.object({ atSec: sec, x: frac, y: frac })).max(20).optional(),
	/** Floating tags in the background (product words: "Dart", "iOS", "AI agent"). */
	tags: z.array(z.string().trim().min(1).max(24)).max(8).optional(),
	/** Line under the logo at the end, e.g. "From brief to build plan." */
	tagline: z.string().trim().max(60).optional(),
	/** Pill under the tagline, e.g. "fluttergo.ai". */
	url: z.string().trim().max(40).optional(),
	/** Logo intro (default true when the brand kit has a name or logo). */
	intro: z.boolean().optional(),
	/** Logo outro (default true when the brand kit has a name or logo). */
	outro: z.boolean().optional(),
	theme: z.enum(["dark", "light"]).default("dark"),
	/** Sharpen and lift contrast of the recording (default true). */
	enhance: z.boolean().default(true),
	/** Keep the recording's sound (sped-up parts are time-stretched). Default true. */
	keepAudio: z.boolean().default(true),
	fps: z.union([z.literal(30), z.literal(60)]).default(60),
	/**
	 * Fill what the plan leaves out from what the recording already knows:
	 * click ripples and push-ins from the recorded clicks, speed-ups over still
	 * stretches (waiting, loading). Default true; anything the plan sets wins.
	 */
	auto: z.boolean().default(true),
	/**
	 * replace = the showcase becomes the whole timeline (default);
	 * none = render only, to preview; start / end = add it next to what is there.
	 */
	place: z.enum(["replace", "none", "start", "end"]).default("replace"),
	label: z.string().trim().max(80).optional(),
});

export type ShowcaseArgs = z.infer<typeof showcaseArgsSchema>;

/** A stretch of the source played at one rate. */
export interface TimeSegment {
	srcStart: number;
	srcEnd: number;
	rate: number;
	/** Where the segment starts in the footage (after speed-ups), seconds. */
	outStart: number;
}

/**
 * Split [trimStart, trimEnd] into constant-rate segments. Overlapping speed
 * ranges are resolved first-come; ranges are clipped to the trim.
 */
export function buildSegments(trimStart: number, trimEnd: number, speed: ShowcaseArgs["speed"] = []): TimeSegment[] {
	const ranges = [...(speed ?? [])]
		.map((r) => ({ start: Math.max(trimStart, r.startSec), end: Math.min(trimEnd, r.endSec), rate: r.rate }))
		.filter((r) => r.end - r.start >= 0.2)
		.sort((a, b) => a.start - b.start);
	const clean: typeof ranges = [];
	for (const r of ranges) {
		const last = clean[clean.length - 1];
		if (last && r.start < last.end) {
			if (r.end <= last.end) continue;
			r.start = last.end;
		}
		clean.push(r);
	}
	const out: TimeSegment[] = [];
	let cursor = trimStart;
	let outT = 0;
	const push = (s: number, e: number, rate: number) => {
		if (e - s < 1e-3) return;
		out.push({ srcStart: s, srcEnd: e, rate, outStart: outT });
		outT += (e - s) / rate;
	};
	for (const r of clean) {
		push(cursor, r.start, 1);
		push(r.start, r.end, r.rate);
		cursor = r.end;
	}
	push(cursor, trimEnd, 1);
	return out;
}

export function footageDuration(segments: TimeSegment[]): number {
	const last = segments[segments.length - 1];
	return last ? last.outStart + (last.srcEnd - last.srcStart) / last.rate : 0;
}

/** Source seconds → footage seconds (clamped to the trim). */
export function mapTime(segments: TimeSegment[], src: number): number {
	if (segments.length === 0) return 0;
	const first = segments[0]!;
	if (src <= first.srcStart) return 0;
	for (const s of segments) {
		if (src <= s.srcEnd) return s.outStart + (src - s.srcStart) / s.rate;
	}
	return footageDuration(segments);
}

/** Crop in source pixels (even numbers, inside the frame). */
export function resolveCrop(
	crop: ShowcaseArgs["crop"],
	size: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
	const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
	if (!crop) return { x: 0, y: 0, width: even(size.width), height: even(size.height) };
	const x = Math.min(size.width - 16, Math.max(0, Math.round(crop.x * size.width)));
	const y = Math.min(size.height - 16, Math.max(0, Math.round(crop.y * size.height)));
	const width = even(Math.min(size.width - x, Math.max(16, crop.width * size.width)));
	const height = even(Math.min(size.height - y, Math.max(16, crop.height * size.height)));
	const evenPos = (n: number) => Math.max(0, Math.floor(n / 2) * 2);
	return { x: evenPos(x), y: evenPos(y), width, height };
}

/** Everything the page needs, in footage seconds and footage pixels. */
export interface ShowcaseTimeline {
	footageSec: number;
	footage: { width: number; height: number };
	camera: Array<[t: number, zoom: number, fx: number, fy: number]>;
	steps: Array<{ in: number; out: number; kicker: string; title: string; accent: string; body: string; count: number | null }>;
	highlights: Array<{ in: number; out: number; x: number; y: number; width: number; height: number }>;
	checks: Array<{ at: number; until: number; x: number; y: number }>;
	clicks: Array<{ at: number; x: number; y: number }>;
}

const EASE_SEC = 0.7;

/**
 * Resolve the agent's plan (source seconds, fractions of the full frame) into
 * the page's timeline (footage seconds, footage pixels). Items that fall
 * outside the crop or the trim are dropped.
 */
export function resolveTimeline(
	args: Pick<ShowcaseArgs, "focus" | "steps" | "highlights" | "checks" | "clicks">,
	segments: TimeSegment[],
	crop: { x: number; y: number; width: number; height: number },
	source: { width: number; height: number },
): ShowcaseTimeline {
	const footageSec = footageDuration(segments);
	const T = (s: number) => Math.min(footageSec, mapTime(segments, s));
	const px = (fx: number) => fx * source.width - crop.x;
	const py = (fy: number) => fy * source.height - crop.y;
	const inside = (x: number, y: number) => x >= -4 && y >= -4 && x <= crop.width + 4 && y <= crop.height + 4;
	const cx = crop.width / 2;
	const cy = crop.height / 2;

	// Camera: rest at 1× between push-ins; ease in/out around each focus.
	const camera: ShowcaseTimeline["camera"] = [[0, 1, cx, cy]];
	const focus = [...(args.focus ?? [])]
		.map((f) => ({ a: T(f.startSec), b: T(f.endSec), zoom: f.zoom, x: px(f.x), y: py(f.y) }))
		.filter((f) => f.b - f.a >= 0.3)
		.sort((p, q) => p.a - q.a);
	let prevEnd = 0;
	focus.forEach((f, i) => {
		const start = Math.max(prevEnd, f.a - EASE_SEC);
		const last = camera[camera.length - 1]!;
		if (start > last[0] + 0.01) camera.push([start, last[1], last[2], last[3]]);
		camera.push([Math.max(start + 0.3, f.a), f.zoom, f.x, f.y]);
		camera.push([f.b, f.zoom, f.x, f.y]);
		const next = focus[i + 1];
		// Glide straight to the next focus when it follows closely; otherwise return to 1×.
		if (!next || next.a - f.b > EASE_SEC * 1.6) {
			camera.push([Math.min(footageSec, f.b + EASE_SEC), 1, cx, cy]);
		}
		prevEnd = camera[camera.length - 1]![0];
	});
	const tail = camera[camera.length - 1]!;
	if (tail[0] < footageSec) camera.push([footageSec, tail[1], tail[2], tail[3]]);

	const steps = (args.steps ?? [])
		.map((s, i) => {
			const words = s.title.split(/\s+/);
			const accent = s.accent && s.title.includes(s.accent) ? s.accent : words.length > 1 ? words[words.length - 1]! : "";
			return {
				in: T(s.startSec),
				out: T(s.endSec),
				kicker: s.kicker ?? `Step ${i + 1}`,
				title: s.title,
				accent,
				body: s.body ?? "",
				count: s.count ?? null,
			};
		})
		.filter((s) => s.out - s.in >= 0.8)
		.sort((p, q) => p.in - q.in);
	// Cards never overlap: each leaves before the next arrives.
	for (let i = 0; i + 1 < steps.length; i++) {
		if (steps[i]!.out > steps[i + 1]!.in - 0.1) steps[i]!.out = Math.max(steps[i]!.in + 0.6, steps[i + 1]!.in - 0.1);
	}

	const highlights = (args.highlights ?? [])
		.map((h) => ({ in: T(h.startSec), out: T(h.endSec), x: px(h.x), y: py(h.y), width: h.width * source.width, height: h.height * source.height }))
		.filter((h) => h.out - h.in >= 0.4 && inside(h.x, h.y) && inside(h.x + h.width, h.y + h.height));

	const checks = (args.checks ?? [])
		.map((c) => ({ at: T(c.atSec), until: c.untilSec !== undefined ? T(c.untilSec) : footageSec, x: px(c.x), y: py(c.y) }))
		.filter((c) => c.until - c.at >= 0.3 && inside(c.x, c.y))
		.sort((p, q) => p.at - q.at);

	const clicks = (args.clicks ?? [])
		.map((c) => ({ at: T(c.atSec), x: px(c.x), y: py(c.y) }))
		.filter((c) => inside(c.x, c.y));

	return { footageSec, footage: { width: crop.width, height: crop.height }, camera, steps, highlights, checks, clicks };
}

/** atempo only accepts 0.5–2 per stage: chain stages for larger rates. */
export function atempoChain(rate: number): string {
	const parts: string[] = [];
	let r = rate;
	while (r > 2) {
		parts.push("atempo=2");
		r /= 2;
	}
	parts.push(`atempo=${r.toFixed(4)}`);
	return parts.join(",");
}

/**
 * The ffmpeg filter graph that crops, enhances and retimes the recording.
 * Video → [v]; audio (when asked) → [a].
 */
export function buildFootageFilter(input: {
	segments: TimeSegment[];
	crop: { x: number; y: number; width: number; height: number };
	fps: number;
	enhance: boolean;
	audio: boolean;
}): string {
	const { segments, crop, fps, enhance, audio } = input;
	const n = segments.length;
	const pre = [`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`];
	if (enhance) pre.push("eq=contrast=1.05:gamma=0.9", "unsharp=5:5:0.5:5:5:0");
	const parts: string[] = [`[0:v]${pre.join(",")},split=${n}${segments.map((_, i) => `[s${i}]`).join("")}`];
	segments.forEach((s, i) => {
		const pts = s.rate === 1 ? "PTS-STARTPTS" : `(PTS-STARTPTS)/${s.rate.toFixed(4)}`;
		parts.push(`[s${i}]trim=${s.srcStart.toFixed(3)}:${s.srcEnd.toFixed(3)},setpts=${pts},fps=${fps}[v${i}]`);
	});
	if (audio) {
		parts.push(`[0:a]asplit=${n}${segments.map((_, i) => `[as${i}]`).join("")}`);
		segments.forEach((s, i) => {
			const tempo = s.rate === 1 ? "" : `,${atempoChain(s.rate)}`;
			parts.push(`[as${i}]atrim=${s.srcStart.toFixed(3)}:${s.srcEnd.toFixed(3)},asetpts=PTS-STARTPTS${tempo}[a${i}]`);
		});
		parts.push(`${segments.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${n}:v=1:a=1[vc][a]`);
	} else {
		parts.push(`${segments.map((_, i) => `[v${i}]`).join("")}concat=n=${n}:v=1:a=0[vc]`);
	}
	parts.push(`[vc]fps=${fps},format=yuvj444p[v]`);
	return parts.join(";");
}

/** What the recording already knows, for filling a plan's gaps. */
export interface RecordingSignals {
	/** Recorded pointer samples (cx/cy 0–1 of the recording; interactionType "click" for clicks). */
	cursor?: Array<{ timeMs: number; cx: number; cy: number; interactionType?: string | null }>;
	/** Stretches where nothing on screen moves (source seconds). */
	stillStretches?: Array<[number, number]>;
	/** Quiet stretches, when the recording has sound: speed-ups stay inside them so speech is never sped up. */
	silences?: Array<[number, number]>;
}

/** The parts of `a` that are also inside one of `b`. */
function intersectRanges(a: Array<[number, number]>, b: Array<[number, number]>): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	for (const [a0, a1] of a) for (const [b0, b1] of b) {
		const s = Math.max(a0, b0);
		const e = Math.min(a1, b1);
		if (e > s) out.push([s, e]);
	}
	return out.sort((p, q) => p[0] - q[0]);
}

export interface AutoPlanResult {
	args: ShowcaseArgs;
	/** What was filled in automatically, in plain words (for the agent / receipt). */
	filled: string[];
}

const AUTO = {
	clickGapSec: 0.25,
	maxClicks: 20,
	minStillSec: 2.5,
	stillMarginSec: 0.3,
	clusterGapSec: 2.5,
	focusLeadSec: 0.9,
	focusTailSec: 1.4,
	focusZoom: 1.3,
	maxFocus: 4,
} as const;

/**
 * Fill the gaps in a plan from the recording: only the parts the plan left
 * empty (clicks, speed, focus) are filled, so an agent that planned them
 * keeps its own. Times stay in the recording's seconds.
 */
export function autoPlan(args: ShowcaseArgs, signals: RecordingSignals, trim: { startSec: number; endSec: number }): AutoPlanResult {
	if (!args.auto) return { args, filled: [] };
	const next: ShowcaseArgs = { ...args };
	const filled: string[] = [];
	const inTrim = (t: number) => t >= trim.startSec && t <= trim.endSec;

	const clicks: Array<{ atSec: number; x: number; y: number }> = [];
	for (const s of [...(signals.cursor ?? [])].sort((a, b) => a.timeMs - b.timeMs)) {
		if (s.interactionType !== "click") continue;
		const at = s.timeMs / 1000;
		if (!inTrim(at) || !(s.cx >= 0 && s.cx <= 1 && s.cy >= 0 && s.cy <= 1)) continue;
		const last = clicks[clicks.length - 1];
		if (last && at - last.atSec < AUTO.clickGapSec) continue;
		clicks.push({ atSec: Math.round(at * 100) / 100, x: s.cx, y: s.cy });
		if (clicks.length >= AUTO.maxClicks) break;
	}

	if (!args.clicks?.length && clicks.length) {
		next.clicks = clicks;
		filled.push(`${clicks.length} click ripple${clicks.length === 1 ? "" : "s"} from the recorded clicks`);
	}

	if (!args.speed?.length) {
		const stills = signals.silences ? intersectRanges(signals.stillStretches ?? [], signals.silences) : (signals.stillStretches ?? []);
		const speed = stills
			.map(([a, b]) => ({ a: Math.max(a, trim.startSec) + AUTO.stillMarginSec, b: Math.min(b, trim.endSec) - AUTO.stillMarginSec }))
			.filter((r) => r.b - r.a >= AUTO.minStillSec - 2 * AUTO.stillMarginSec)
			.slice(0, 12)
			.map((r) => ({ startSec: r.a, endSec: r.b, rate: Math.min(4, Math.max(2, Math.round(((r.b - r.a) / 1.2) * 2) / 2)) }));
		if (speed.length) {
			next.speed = speed;
			filled.push(`${speed.length} still stretch${speed.length === 1 ? "" : "es"} sped up`);
		}
	}

	if (!args.focus?.length && clicks.length) {
		const clusters: Array<typeof clicks> = [];
		for (const c of clicks) {
			const cur = clusters[clusters.length - 1];
			if (cur && c.atSec - cur[cur.length - 1]!.atSec <= AUTO.clusterGapSec) cur.push(c);
			else clusters.push([c]);
		}
		const focus: NonNullable<ShowcaseArgs["focus"]> = [];
		for (const cl of clusters) {
			const startSec = Math.max(trim.startSec, cl[0]!.atSec - AUTO.focusLeadSec);
			const endSec = Math.min(trim.endSec, cl[cl.length - 1]!.atSec + AUTO.focusTailSec);
			const prev = focus[focus.length - 1];
			if (prev && startSec < prev.endSec + 0.8) continue;
			if (endSec - startSec < 1) continue;
			const x = cl.reduce((acc, c) => acc + c.x, 0) / cl.length;
			const y = cl.reduce((acc, c) => acc + c.y, 0) / cl.length;
			focus.push({ startSec, endSec, x, y, zoom: AUTO.focusZoom });
			if (focus.length >= AUTO.maxFocus) break;
		}
		if (focus.length) {
			next.focus = focus;
			filled.push(`${focus.length} push-in${focus.length === 1 ? "" : "s"} on where you clicked`);
		}
	}
	return { args: next, filled };
}

