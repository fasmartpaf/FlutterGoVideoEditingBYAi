/**
 * Per-turn latency marks for the chat: how long from Send until the user saw
 * the first sign of life, the first reasoning, the first word of the reply,
 * the first edit, and the end. This is the number Phase 1 is judged on
 * (first streamed token under 1 s), so every turn logs it.
 */

import type { ChatEventSink } from "./chat-service";

export interface TurnTiming {
	firstStatusMs: number | null;
	firstThinkingMs: number | null;
	firstTextMs: number | null;
	firstToolMs: number | null;
	totalMs: number | null;
	toolCount: number;
	/** Wall time with at least one tool running (renders, ffmpeg, edits). */
	toolMs: number;
	/** Everything else — mostly waiting for the model's replies. */
	modelMs: number | null;
	/** The slowest tool calls, longest first. */
	slowTools: Array<{ name: string; ms: number }>;
}

export function createTurnTimer(now: () => number = Date.now) {
	const t0 = now();
	const timing: TurnTiming = {
		firstStatusMs: null,
		firstThinkingMs: null,
		firstTextMs: null,
		firstToolMs: null,
		totalMs: null,
		toolCount: 0,
		toolMs: 0,
		modelMs: null,
		slowTools: [],
	};
	const started = new Map<string, number[]>();
	const durations: Array<{ name: string; ms: number }> = [];
	let active = 0;
	let activeSince = 0;
	const mark = (key: "firstStatusMs" | "firstThinkingMs" | "firstTextMs" | "firstToolMs") => {
		if (timing[key] === null) timing[key] = now() - t0;
	};
	return {
		timing,
		/** Wrap a sink so every event also records its first-seen time. */
		wrap(sink: Required<ChatEventSink>): Required<ChatEventSink> {
			return {
				...sink,
				status: (phase: string, detail?: string) => {
					mark("firstStatusMs");
					sink.status(phase, detail);
				},
				thinking: (delta: string) => {
					if (delta) mark("firstThinkingMs");
					sink.thinking(delta);
				},
				text: (delta: string) => {
					if (delta) mark("firstTextMs");
					sink.text(delta);
				},
				toolStart: (name: string, args: unknown) => {
					mark("firstToolMs");
					timing.toolCount += 1;
					const t = now();
					started.set(name, [...(started.get(name) ?? []), t]);
					if (active++ === 0) activeSince = t;
					sink.toolStart(name, args);
				},
				toolEnd: (name: string, ok: boolean, summary?: string) => {
					const t = now();
					const queue = started.get(name);
					const begin = queue?.shift();
					if (begin !== undefined) durations.push({ name, ms: t - begin });
					if (active > 0 && --active === 0) timing.toolMs += t - activeSince;
					sink.toolEnd(name, ok, summary);
				},
			};
		},
		finish(): TurnTiming {
			if (timing.totalMs === null) {
				const t = now();
				if (active > 0) timing.toolMs += t - activeSince;
				timing.totalMs = t - t0;
				timing.modelMs = Math.max(0, timing.totalMs - timing.toolMs);
				timing.slowTools = [...durations].sort((a, b) => b.ms - a.ms).slice(0, 5);
			}
			return timing;
		},
	};
}

function fmt(ms: number | null): string {
	return ms === null ? "—" : `${ms}ms`;
}

/** One log line, e.g. `status 8ms · thinking 1200ms · text 2400ms · tools 3 · total 9100ms`. */
export function formatTurnTiming(t: TurnTiming): string {
	return [
		`status ${fmt(t.firstStatusMs)}`,
		`thinking ${fmt(t.firstThinkingMs)}`,
		`text ${fmt(t.firstTextMs)}`,
		`first tool ${fmt(t.firstToolMs)}`,
		`tools ${t.toolCount}`,
		`tool time ${fmt(t.toolMs)}`,
		`model time ${fmt(t.modelMs)}`,
		`total ${fmt(t.totalMs)}`,
	].join(" · ");
}

/**
 * Append one JSON line per turn to `<generated-graphics>/<project>/.logs/turns.jsonl`
 * (next to the recording). Silent when the project has no recording folder.
 */
export function appendTurnLog(documentInput: unknown, record: Record<string, unknown>): void {
	void (async () => {
		const { documentSchema } = await import("../../src/lib/ai-edition/schema");
		const parsed = documentSchema.safeParse(documentInput);
		if (!parsed.success) return;
		const { resolveGeneratedGraphicsDir } = await import("./agentToolMedia");
		const { appendFileSync, mkdirSync } = await import("node:fs");
		const { join } = await import("node:path");
		const line = `${JSON.stringify(record)}\n`;
		const dir = join(resolveGeneratedGraphicsDir(parsed.data), ".logs");
		mkdirSync(dir, { recursive: true });
		appendFileSync(join(dir, "turns.jsonl"), line);
		// Running from source (npm run dev): keep a copy in the repo too, where the
		// timings can be read without access to the app's data folder.
		if (process.env.VITE_DEV_SERVER_URL) {
			const devDir = join(process.cwd(), ".fluttergo", "logs");
			mkdirSync(devDir, { recursive: true });
			appendFileSync(join(devDir, "turns.jsonl"), line);
		}
	})().catch(() => {});
}
