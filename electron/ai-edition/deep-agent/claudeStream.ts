/**
 * Shared pieces for driving the Claude Code CLI: parsing its stream-json
 * output, and killing a CLI together with everything it started. Used by
 * the one-shot spawn path and by the long-lived session.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { toolActivityProgressLine } from "../toolActivityLabels";

export interface LocalCliProgressEvent {
	/**
	 * progress — status lines (tool use, heartbeats) for the thinking strip
	 * text     — assistant text (raw from the CLI; filtered before display)
	 * thinking — the model's own reasoning tokens
	 * boundary — a new assistant message started (reset reply parsing)
	 */
	kind: "progress" | "text" | "thinking" | "boundary";
	delta: string;
}

/** Cap on buffered stdout (stream-json with --verbose can be very chatty). */
export const MAX_STDOUT_CHARS = 4 * 1024 * 1024;

/**
 * Kill the CLI AND everything it started (ffmpeg, node, shells). The child is
 * spawned as a process-group leader on POSIX so a negative pid reaches the
 * whole tree; on Windows `taskkill /T` walks the tree.
 */
export function killProcessTree(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
	const pid = child.pid;
	if (pid == null) return;
	try {
		if (process.platform === "win32") {
			spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }).on(
				"error",
				() => {},
			);
			return;
		}
		process.kill(-pid, signal);
	} catch {
		// Group already gone, or not a group leader — fall back to the child.
		try {
			child.kill(signal);
		} catch {
			// already exited
		}
	}
}

/** Hard cap for one Claude/Codex spawn. Watching a recording (ffmpeg stills
 *  + Read) plus a first JSON reply routinely exceeds the old 180s wall clock. */
export const LOCAL_CLI_HARD_TIMEOUT_MS = 10 * 60 * 1000;
/** Kill only after this long with no stdout/stderr. Claude's text print mode
 *  is silent until the end, so this must stay longer than a typical watch. */
export const LOCAL_CLI_IDLE_TIMEOUT_MS = 6 * 60 * 1000;

export const HEARTBEAT_MS = 2_000;

export type LocalCliStreamEvent =
	| { kind: "progress"; delta: string }
	| { kind: "text"; delta: string }
	| { kind: "done"; raw: string };

/**
 * Parse one NDJSON line from Claude `--output-format stream-json`.
 * Returns progress/text deltas and optionally a final result string.
 */
export function consumeClaudeStreamJsonLine(
	line: string,
	state: {
		assistantText: string;
		result: string | null;
		fromDeltas?: boolean;
		apiError?: string | null;
	},
): LocalCliProgressEvent[] {
	const trimmed = line.trim();
	if (!trimmed.startsWith("{")) return [];
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(trimmed) as Record<string, unknown>;
	} catch {
		return [];
	}
	const events: LocalCliProgressEvent[] = [];
	const type = typeof parsed.type === "string" ? parsed.type : "";

	if (type === "assistant") {
		const message = parsed.message as { content?: unknown } | undefined;
		const content = message?.content;
		// Without partial messages every `assistant` event is one whole message
		// (one step of the CLI's own loop) — mark the boundary so reply parsing
		// restarts for it.
		if (!state.fromDeltas) events.push({ kind: "boundary", delta: "" });
		if (Array.isArray(content)) {
			for (const part of content) {
				if (!part || typeof part !== "object") continue;
				const p = part as { type?: string; text?: string; name?: string };
				if (p.type === "text" && typeof p.text === "string" && p.text) {
					// Verbose stream-json also emits content_block_delta tokens.
					// Prefer those for live text; treat assistant snapshots as sync only
					// so the chat bubble does not double every sentence.
					if (state.fromDeltas) {
						if (p.text.length >= state.assistantText.length) {
							state.assistantText = p.text;
						}
						continue;
					}
					const prior = state.assistantText;
					if (p.text.startsWith(prior)) {
						const delta = p.text.slice(prior.length);
						state.assistantText = p.text;
						if (delta) events.push({ kind: "text", delta });
					} else if (prior.startsWith(p.text)) {
						// Older snapshot — ignore.
					} else {
						state.assistantText += p.text;
						events.push({ kind: "text", delta: p.text });
					}
				} else if (p.type === "tool_use" && typeof p.name === "string" && !state.fromDeltas) {
					events.push({ kind: "progress", delta: `${toolActivityProgressLine(p.name)}\n` });
				}
			}
		}
	} else if (type === "stream_event") {
		// `--include-partial-messages`: raw Anthropic streaming events, token by token.
		// Once these flow, the later `assistant` snapshots are for syncing only.
		state.fromDeltas = true;
		const ev = parsed.event as
			| {
					type?: string;
					delta?: { type?: string; text?: string; thinking?: string };
					content_block?: { type?: string; name?: string };
			  }
			| undefined;
		if (ev?.type === "message_start") {
			events.push({ kind: "boundary", delta: "" });
		} else if (ev?.type === "content_block_start" && ev.content_block?.type === "tool_use") {
			const toolName = ev.content_block.name;
			if (toolName) events.push({ kind: "progress", delta: `${toolActivityProgressLine(toolName)}\n` });
		} else if (ev?.type === "content_block_delta") {
			if (ev.delta?.type === "text_delta" && ev.delta.text) {
				state.assistantText += ev.delta.text;
				events.push({ kind: "text", delta: ev.delta.text });
			} else if (ev.delta?.type === "thinking_delta" && ev.delta.thinking) {
				events.push({ kind: "thinking", delta: ev.delta.thinking });
			}
		}
	} else if (type === "content_block_delta") {
		const delta = parsed.delta as { type?: string; text?: string } | undefined;
		if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text) {
			state.fromDeltas = true;
			state.assistantText += delta.text;
			events.push({ kind: "text", delta: delta.text });
		}
	} else if (type === "result") {
		const result =
			typeof parsed.result === "string"
				? parsed.result
				: typeof (parsed as { result?: { result?: string } }).result === "object"
					? String((parsed as { result?: { result?: string } }).result?.result ?? "")
					: "";
		if (result) state.result = result;
		const apiErrorStatus =
			typeof (parsed as { api_error_status?: unknown }).api_error_status === "number"
				? (parsed as { api_error_status: number }).api_error_status
				: null;
		if (apiErrorStatus != null && apiErrorStatus >= 400) {
			state.apiError = result || `Claude API error ${apiErrorStatus}`;
			events.push({
				kind: "progress",
				delta: `Local CLI API error ${apiErrorStatus}\n`,
			});
		}
		const subtype = typeof parsed.subtype === "string" ? parsed.subtype : "";
		if (subtype && subtype !== "success") {
			events.push({ kind: "progress", delta: `Local CLI result: ${subtype}\n` });
		}
	} else if (type === "system") {
		const subtype = typeof parsed.subtype === "string" ? parsed.subtype : "";
		if (subtype === "init") {
			const modelId =
				typeof parsed.model === "string"
					? parsed.model
					: typeof (parsed as { model?: unknown }).model === "string"
						? String((parsed as { model: string }).model)
						: "";
			const modelNote = modelId ? ` (${modelId})` : "";
			events.push({ kind: "progress", delta: `Local CLI started${modelNote}…\n` });
		}
	} else if (type === "user" || type === "tool_progress") {
		events.push({ kind: "progress", delta: "Local CLI working…\n" });
	}
	return events;
}

