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
	};
	const mark = (key: Exclude<keyof TurnTiming, "totalMs" | "toolCount">) => {
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
					sink.toolStart(name, args);
				},
			};
		},
		finish(): TurnTiming {
			if (timing.totalMs === null) timing.totalMs = now() - t0;
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
		`total ${fmt(t.totalMs)}`,
	].join(" · ");
}
