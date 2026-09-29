/**
 * One long-lived Claude Code process per chat conversation.
 *
 * Spawning `claude -p` for every model step costs a CLI start-up (and a full
 * re-send of the conversation) each time — seconds of dead air per tool round.
 * Instead the process is started once with `--input-format stream-json` and
 * kept alive: each model step writes ONE user message on stdin and reads the
 * NDJSON stream until that turn's `result` event.
 *
 * Lifecycle:
 *  - one turn at a time per process (calls are queued);
 *  - Stop / timeout kills the whole process tree; the next call starts a new
 *    process that `--resume`s the same Claude session;
 *  - idle processes are closed after IDLE_SHUTDOWN_MS, and all of them on quit.
 */

import { type ChildProcess, spawn } from "node:child_process";
import os from "node:os";
import { StringDecoder } from "node:string_decoder";
import { formatLocalCliError, localCliSpawnEnv } from "../local-agents";
import {
	consumeClaudeStreamJsonLine,
	HEARTBEAT_MS,
	killProcessTree,
	LOCAL_CLI_HARD_TIMEOUT_MS,
	LOCAL_CLI_IDLE_TIMEOUT_MS,
	type LocalCliProgressEvent,
	MAX_STDOUT_CHARS,
} from "./claudeStream";

/** Close a live process after this long without a turn. */
export const IDLE_SHUTDOWN_MS = 10 * 60 * 1000;

export interface LiveTurnOptions {
	onEvent: (event: LocalCliProgressEvent) => void;
	signal?: AbortSignal;
	idleTimeoutMs?: number;
	hardTimeoutMs?: number;
	agentId?: string;
}

interface PendingTurn {
	resolve: (raw: string) => void;
	reject: (err: Error) => void;
	options: LiveTurnOptions;
	state: { assistantText: string; result: string | null; apiError?: string | null; fromDeltas?: boolean };
	startedAt: number;
	firstTextAt: number | null;
	lastOutputAt: number;
	cleanup: () => void;
}

function abortError(): Error {
	const err = new Error("Agent stopped.");
	err.name = "AbortError";
	return err;
}

/** Remove session flags so a create→resume change does not count as new args. */
export function argsKeyWithoutSession(argv: string[], cwd: string): string {
	const kept: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--session-id" || argv[i] === "--resume") {
			i += 1;
			continue;
		}
		kept.push(argv[i]!);
	}
	return JSON.stringify([cwd, ...kept]);
}

export class ClaudeLiveSession {
	readonly argsKey: string;
	/** Fingerprints of the conversation messages this process has already seen. */
	sentFingerprints: string[] = [];
	/** The user messages this process has seen, in order (see buildIncrementalPrompt). */
	sentHumanKeys: string[] = [];
	/** The SYSTEM text it last saw (project updates are sent as a diff against it). */
	sentSystemText: string | undefined = undefined;
	/** Frame list already described to this process (re-sent only when it changes). */
	sentFrameKey = "";
	/** Tool catalogue already given to this process (re-sent only when it changes). */
	sentToolsKey = "";
	private child: ChildProcess | null = null;
	private dead = false;
	private lineBuf = "";
	private stderrTail = "";
	private readonly decoder = new StringDecoder("utf8");
	private current: PendingTurn | null = null;
	private queue: Promise<unknown> = Promise.resolve();
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private onDead?: () => void;

	constructor(
		private readonly binPath: string,
		private readonly argv: string[],
		private readonly cwd: string,
		onDead?: () => void,
	) {
		this.argsKey = argsKeyWithoutSession(argv, cwd);
		this.onDead = onDead;
	}

	get alive(): boolean {
		return !this.dead;
	}

	get busy(): boolean {
		return this.current !== null;
	}

	/** Run one model step: send `text` as a user message, resolve with the turn's result. */
	runTurn(text: string, options: LiveTurnOptions): Promise<string> {
		const run = () => this.runTurnNow(text, options);
		const next = this.queue.then(run, run);
		this.queue = next.catch(() => undefined);
		return next;
	}

	/** Kill the process tree (Stop, timeout, app quit, args changed). */
	close(reason: Error = new Error("Local CLI session closed.")): void {
		if (this.dead) return;
		this.dead = true;
		if (this.idleTimer) clearTimeout(this.idleTimer);
		const child = this.child;
		if (child) {
			killProcessTree(child, "SIGTERM");
			setTimeout(() => killProcessTree(child, "SIGKILL"), 2_000).unref?.();
		}
		this.failCurrent(reason);
		this.onDead?.();
	}

	private ensureStarted(): ChildProcess {
		if (this.child) return this.child;
		const child = spawn(this.binPath, this.argv, {
			cwd: this.cwd || os.tmpdir(),
			env: localCliSpawnEnv() as NodeJS.ProcessEnv,
			stdio: ["pipe", "pipe", "pipe"],
			// Own process group so Stop can kill everything the agent started.
			detached: process.platform !== "win32",
		});
		this.child = child;
		child.stdout!.on("data", (chunk: Buffer) => this.onStdout(this.decoder.write(chunk)));
		child.stderr!.on("data", (chunk: Buffer) => {
			const textOut = chunk.toString("utf8");
			this.stderrTail = (this.stderrTail + textOut).slice(-4_000);
			const snippet = textOut.replace(/\s+/g, " ").trim().slice(0, 160);
			if (snippet && this.current) this.current.options.onEvent({ kind: "progress", delta: `${snippet}\n` });
		});
		child.stdin!.on("error", () => {
			// EPIPE when the CLI died — the `close` handler reports it.
		});
		child.on("error", (err) => this.close(err));
		child.on("close", (code) => {
			const pending = this.current;
			this.child = null;
			if (!this.dead) {
				this.dead = true;
				if (this.idleTimer) clearTimeout(this.idleTimer);
				this.onDead?.();
			}
			if (pending) {
				const detail = this.stderrTail.slice(-400) || "No output.";
				this.failCurrent(
					new Error(
						formatLocalCliError(`Local CLI exited ${code ?? "null"} mid-turn. ${detail}`, pending.options.agentId),
					),
				);
			}
		});
		return child;
	}

	private runTurnNow(text: string, options: LiveTurnOptions): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			if (this.dead) {
				reject(new Error("Local CLI session is closed."));
				return;
			}
			if (options.signal?.aborted) {
				reject(abortError());
				return;
			}
			if (this.idleTimer) {
				clearTimeout(this.idleTimer);
				this.idleTimer = null;
			}
			const child = this.ensureStarted();
			const startedAt = Date.now();
			const idleMs = options.idleTimeoutMs ?? LOCAL_CLI_IDLE_TIMEOUT_MS;
			const hardMs = options.hardTimeoutMs ?? LOCAL_CLI_HARD_TIMEOUT_MS;
			let idleTimer: ReturnType<typeof setTimeout> | undefined;
			const onAbort = () => this.close(abortError());
			const bumpIdle = () => {
				if (idleTimer) clearTimeout(idleTimer);
				idleTimer = setTimeout(
					() => this.close(new Error(formatLocalCliError("Local CLI timed out (no output).", options.agentId))),
					idleMs,
				);
				idleTimer.unref?.();
			};
			const hardTimer = setTimeout(
				() => this.close(new Error(formatLocalCliError("Local CLI timed out.", options.agentId))),
				hardMs,
			);
			hardTimer.unref?.();
			const heartbeat = setInterval(() => {
				const turn = this.current;
				if (!turn) return;
				const elapsed = Math.round((Date.now() - turn.startedAt) / 1000);
				const quiet = Math.round((Date.now() - turn.lastOutputAt) / 1000);
				options.onEvent({
					kind: "progress",
					delta:
						quiet > 3
							? `Still working (${elapsed}s) — ${quiet}s since last output…\n`
							: `Still working (${elapsed}s)…\n`,
				});
			}, HEARTBEAT_MS);
			heartbeat.unref?.();
			options.signal?.addEventListener("abort", onAbort, { once: true });

			this.current = {
				resolve,
				reject,
				options,
				state: { assistantText: "", result: null, apiError: null },
				startedAt,
				firstTextAt: null,
				lastOutputAt: startedAt,
				cleanup: () => {
					if (idleTimer) clearTimeout(idleTimer);
					clearTimeout(hardTimer);
					clearInterval(heartbeat);
					options.signal?.removeEventListener("abort", onAbort);
				},
			};
			// Bump inside the turn so the idle clock starts now.
			const turn = this.current;
			const origOnEvent = options.onEvent;
			turn.options = {
				...options,
				onEvent: (ev) => {
					bumpIdle();
					origOnEvent(ev);
				},
			};
			bumpIdle();
			const line = `${JSON.stringify({
				type: "user",
				message: { role: "user", content: [{ type: "text", text }] },
				// Same shape the Agent SDK sends (SDKUserMessage).
				parent_tool_use_id: null,
			})}\n`;
			child.stdin!.write(line);
		});
	}

	private onStdout(chunk: string): void {
		if (!chunk) return;
		this.lineBuf += chunk;
		if (this.lineBuf.length > MAX_STDOUT_CHARS) this.lineBuf = this.lineBuf.slice(-MAX_STDOUT_CHARS);
		const lines = this.lineBuf.split("\n");
		this.lineBuf = lines.pop() ?? "";
		for (const line of lines) this.onLine(line);
	}

	private onLine(line: string): void {
		const turn = this.current;
		if (!turn) return; // output between turns (e.g. init) — nothing is waiting
		turn.lastOutputAt = Date.now();
		for (const ev of consumeClaudeStreamJsonLine(line, turn.state)) {
			if (ev.kind === "text" && turn.firstTextAt === null) turn.firstTextAt = Date.now();
			turn.options.onEvent(ev);
		}
		let parsedLine: {
			type?: string;
			subtype?: string;
			is_error?: boolean;
			result?: unknown;
			errors?: unknown;
		};
		try {
			parsedLine = JSON.parse(line);
		} catch {
			return;
		}
		if (parsedLine.type !== "result") return;
		// End of this turn.
		this.current = null;
		turn.cleanup();
		const since = (t: number | null) => (t === null ? "—" : `${t - turn.startedAt}ms`);
		console.info(
			`[local-cli] live turn: first text ${since(turn.firstTextAt)} · total ${Date.now() - turn.startedAt}ms`,
		);
		this.armIdleShutdown();
		if (turn.state.apiError) {
			turn.reject(new Error(formatLocalCliError(turn.state.apiError, turn.options.agentId)));
			return;
		}
		const raw = (turn.state.result ?? "").trim() || turn.state.assistantText.trim();
		const failed = parsedLine.is_error === true || (parsedLine.subtype && parsedLine.subtype !== "success");
		if (!raw || failed) {
			// Surface what the CLI actually said instead of a generic message.
			const errors = Array.isArray(parsedLine.errors) ? parsedLine.errors.map(String).join("; ") : "";
			const detail = [
				parsedLine.subtype ? `subtype ${parsedLine.subtype}` : "",
				errors,
				typeof parsedLine.result === "string" ? parsedLine.result : "",
				this.stderrTail.trim().slice(-400),
			]
				.filter(Boolean)
				.join(" — ");
			console.warn(`[local-cli] live turn failed: ${line.slice(0, 2_000)}`);
			const err = new Error(
				formatLocalCliError(`Local CLI turn failed${detail ? `: ${detail}` : " without a reply."}`, turn.options.agentId),
			);
			err.name = "LiveTurnError";
			turn.reject(err);
			return;
		}
		turn.resolve(raw);
	}

	private failCurrent(err: Error): void {
		const turn = this.current;
		if (!turn) return;
		this.current = null;
		turn.cleanup();
		turn.reject(err);
	}

	private armIdleShutdown(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = setTimeout(() => this.close(), IDLE_SHUTDOWN_MS);
		this.idleTimer.unref?.();
	}
}

// --- registry -------------------------------------------------------------

const live = new Map<string, ClaudeLiveSession>();

/**
 * The live process for a Claude session id, (re)started when missing, dead,
 * or launched with different arguments (e.g. watch permission changed).
 */
export function acquireLiveSession(
	key: string,
	binPath: string,
	argv: string[],
	cwd: string,
): ClaudeLiveSession {
	const wantKey = argsKeyWithoutSession(argv, cwd);
	const existing = live.get(key);
	if (existing?.alive && existing.argsKey === wantKey) return existing;
	existing?.close(new Error("Local CLI restarted with new settings."));
	const created = new ClaudeLiveSession(binPath, argv, cwd, () => {
		if (live.get(key) === created) live.delete(key);
	});
	// Resuming the same Claude session (another model for this stage, a
	// restart after Stop): Claude reloads what it has seen from disk, so keep
	// our record of it too — only new messages get sent, not the whole chat.
	if (existing && argv.includes("--resume")) {
		created.sentFingerprints = existing.sentFingerprints;
		created.sentHumanKeys = existing.sentHumanKeys;
		created.sentSystemText = existing.sentSystemText;
		created.sentFrameKey = existing.sentFrameKey;
		created.sentToolsKey = existing.sentToolsKey;
	}
	live.set(key, created);
	return created;
}

export function peekLiveSession(key: string): ClaudeLiveSession | undefined {
	return live.get(key);
}

export function closeLiveSession(key: string): void {
	live.get(key)?.close();
	live.delete(key);
}

/** App quit — stop every live Claude process. */
export function closeAllLiveSessions(): number {
	const all = [...live.values()];
	live.clear();
	for (const session of all) session.close();
	return all.length;
}
