// LangChain chat model that shells out to a local coding-agent CLI
// (claude / codex / cursor-agent / gemini). HTTP local servers (Ollama,
// LM Studio) stay on the OpenAI-compatible ChatOpenAI path.

import { type ChildProcess, spawn } from "node:child_process";
import os from "node:os";
import { dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { BaseChatModel, type BindToolsInput } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, type BaseMessage, ToolMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import {
	formatLocalCliError,
	localCliPromptOnStdin,
	localCliSpawnEnv,
	printArgvForAgent,
} from "../local-agents";
import { toolActivityProgressLine } from "../toolActivityLabels";

interface BoundTool {
	name: string;
	description?: string;
	schema?: unknown;
}

export interface LocalCliProgressEvent {
	kind: "progress" | "text";
	delta: string;
}

export interface LocalCliChatModelFields {
	agentId: string;
	binPath: string;
	tools?: BoundTool[];
	/** Parent folders of open recordings — Claude may Read those videos. */
	mediaDirs?: string[];
	/** Absolute JPEG paths OpenScreen already sampled for this turn. */
	framePaths?: string[];
	/** Claude `--model` (fable / opus / sonnet / full id). */
	cliModel?: string;
	/**
	 * Called for every CLI progress/heartbeat/text event even when LangChain
	 * uses invoke/_generate (no on_chat_model_stream). Keeps the chat UI alive.
	 */
	onProgress?: (event: LocalCliProgressEvent) => void;
	/** Stop button / chat.cancel — kills the spawned CLI child. */
	abortSignal?: AbortSignal;
	/** Persistent Claude `--session-id` for this OpenScreen chat conversation. */
	cliSessionId?: string;
	/** Resume prior Claude session memory across tool rounds / follow-ups. */
	resumeCliSession?: boolean;
	/** Preferred cwd for Cursor/Codex (openscreen userData or media folder). */
	workspaceRoot?: string;
	/** Called after a CLI spawn finishes so the host can mark the session started. */
	onCliSpawnComplete?: () => void;
	/**
	 * Read at EVERY spawn: true once this chat's CLI session exists, so the
	 * second tool round of the same turn resumes instead of re-creating it.
	 * Falls back to `resumeCliSession` when not provided.
	 */
	isCliSessionStarted?: () => boolean;
	/**
	 * Whether the user granted the agent access to the recording folders.
	 * When false the CLI gets NO file/shell tools and no --add-dir, even if a
	 * workspace root is known. Defaults to "granted iff mediaDirs is non-empty".
	 */
	watchGranted?: boolean;
}

/** Cap on buffered stdout (stream-json with --verbose can be very chatty). */
const MAX_STDOUT_CHARS = 4 * 1024 * 1024;

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

function messageText(message: BaseMessage): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return String(content ?? "");
	return content
		.map((part) => {
			if (typeof part === "string") return part;
			if (part && typeof part === "object" && "text" in part) {
				return String((part as { text?: unknown }).text ?? "");
			}
			// Local CLI cannot consume multimodal image_url parts — frame paths
			// are injected separately via `framePaths` / the path prompt section.
			return "";
		})
		.join("");
}

function flattenTools(tools: BindToolsInput[]): BoundTool[] {
	return tools.map((tool) => {
		const row = tool as {
			name?: string;
			description?: string;
			schema?: unknown;
		};
		return {
			name: String(row.name ?? "tool"),
			description: row.description,
			schema: row.schema,
		};
	});
}

function framePathSection(framePaths: string[]): string {
	if (framePaths.length === 0) return "";
	const lines = [
		"OPENSCREEN SAMPLED FRAMES — JPEG files already extracted for this turn.",
		"Read these paths (do not re-extract unless the user asks). They are chronological samples, not every frame.",
		"After watching, you may author motion graphics (SVG/HTML/canvas/ffmpeg → PNG), then place them with addGraphic.",
		"Prefer addGraphic with imagePath (absolute path to a PNG/JPEG/WebP you rendered) over huge data URIs.",
		"Keep stills under ~1280px wide / ~1MB — OpenScreen downscales larger files when possible.",
		"For titles/CTAs prefer kind title/cta/lowerThird with textAnimation (fade|rise|pop|slide-left|typewriter|pulse).",
		"Analyze → decide edits/graphics → call OpenScreen tools → finish with a short receipt of what landed.",
		"",
	];
	for (let i = 0; i < framePaths.length; i++) {
		lines.push(`Frame ${i + 1}/${framePaths.length}: ${framePaths[i]}`);
	}
	return `${lines.join("\n")}\n`;
}

function buildPrompt(
	messages: BaseMessage[],
	tools: BoundTool[],
	options?: { framePaths?: string[] },
): string {
	const conversationHint = messages
		.map((m) => messageText(m))
		.join("\n")
		.toLowerCase();
	const lines: string[] = [
		"You are the autonomous local execution agent behind OpenScreen — behave like Cursor Desktop's agent.",
		"The user message is a COMPLETE objective. Pass it through UNDERSTAND → EXPLORE → PLAN → ACT → OBSERVE → CORRECT → VERIFY → COMPLETE.",
		"You may repeat ACT / OBSERVE / CORRECT as many times as needed. A successful tool call is NOT task completion — completion is the original user objective.",
		"For non-trivial asks, inspect BEFORE major edits: project metadata, timeline clips, modifiers/annotations/graphics, representative frames, duration/resolution, media, transcript/speech if present, prior agent assets.",
		"Do NOT collapse a broad ask into a fixed helper recipe (e.g. 'clean / improve / add motion graphics' ≠ immediately addBeatGraphics(5)). OpenScreen tools are capabilities, not the workflow.",
		"Optional shortcuts (addBeatGraphics, createMotionGraphicPreview, addGraphic, …) exist — use only when they fit. Prefer Bash/FFmpeg/HTML/SVG/Remotion/Node/Python/custom assets when a professional custom result needs it, then import into OpenScreen.",
		"Video loop when possible: inspect source → edit → render/preview → sample frames → inspect result → revise. Check clipping, overlays covering UI, timing, generic graphics, hierarchy.",
		"The SYSTEM message is the live AxcutDocument. mediaCapabilities states evidence channels; mediaContext is textual outline; visibleMedia paths are inventory. visualFrames is true only when OPENSCREEN SAMPLED FRAMES are listed below.",
		"OpenScreen JSON tools edit the timeline. Local CLI may also Read/Bash/Edit/Write/Glob/Grep in allowed dirs — use them to inspect, render, and verify. Do not put Read or Bash inside JSON tool_calls; use the CLI's own tools for that.",
		"Stay inside the assigned project/workspace unless the user explicitly authorizes otherwise. Keep confirmation rules for destructive actions.",
		'Final {"message":"…"} must be short and outcome-oriented (what changed / what you verified). NEVER dump receipts, absolute paths, modifier IDs, or per-op remove lists into the user message — those stay in tool results / activity details.',
		"When you create important media files, still return paths in tool results (exportedPaths/videoPath) so chat can register artifacts — but do not make filesystem paths the primary chat prose.",
	];
	const hasToolResults = messages.some((m) => ToolMessage.isInstance(m) || m.getType() === "tool");
	if (hasToolResults) {
		lines.push(
			'You received TOOL RESULT(s). Continue the loop if the user objective is not yet verified (inspect, edit, preview, fix). When the objective is met, reply ONLY with {"message":"…"} — short outcome, no receipt dump. Do NOT retry the same failing tool with the same args; only call a DIFFERENT fix when needed.',
		);
	}
	// Soft hints only — never CRITICAL forced recipes that steal the objective.
	const wantsPrivacy =
		/\b(?:blur|mosaic|hide|cover|redact|censor|privacy|pii|profile\s*(?:pic|picture|photo)?|avatar|my\s+name|account\s*(?:name|label)?)\b/i.test(
			conversationHint,
		);
	if (wantsPrivacy && !hasToolResults) {
		lines.push(
			'Hint: privacy / hide name / avatar asks usually fit addPrivacyCover({preset:"topStrip"}) — still inspect first if unsure.',
		);
	}
	lines.push(
		"Reply with ONE JSON object and nothing else.",
		'If you need an OpenScreen edit tool: {"tool_calls":[{"name":"<tool>","args":{...}}]}',
		'If you are done talking to the user: {"message":"<plain text>"}',
		"For greetings, reply briefly about what you can do — not a clinical 'no mutation' notice.",
		"insertStartThumbnail only if no start cover exists (or replace:true when user asks to change it). Never stack a second opener.",
		"The user can rewind a chat turn to undo OpenScreen timeline mutations.",
	);
	const frames = framePathSection(options?.framePaths ?? []);
	if (frames) lines.push(frames.trimEnd());
	if (tools.length > 0) {
		lines.push("Available OpenScreen tools (optional primitives):");
		lines.push(JSON.stringify(tools, null, 2));
	}
	lines.push("Conversation:");
	for (const message of messages) {
		if (ToolMessage.isInstance(message) || message.getType() === "tool") {
			lines.push(`TOOL RESULT: ${messageText(message)}`);
			continue;
		}
		const role =
			message.getType() === "human" ? "USER" : message.getType() === "ai" ? "ASSISTANT" : "SYSTEM";
		const text = messageText(message);
		if (text) lines.push(`${role}: ${text}`);
	}
	return lines.join("\n");
}

function parseModelJson(raw: string): {
	message?: string;
	tool_calls?: Array<{ name: string; args: unknown }>;
} {
	const trimmed = raw.trim();
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start < 0 || end <= start) return { message: trimmed };
	try {
		return JSON.parse(trimmed.slice(start, end + 1)) as {
			message?: string;
			tool_calls?: Array<{ name: string; args: unknown }>;
		};
	} catch {
		return { message: trimmed };
	}
}

/** Hard cap for one Claude/Codex spawn. Watching a recording (ffmpeg stills
 *  + Read) plus a first JSON reply routinely exceeds the old 180s wall clock. */
export const LOCAL_CLI_HARD_TIMEOUT_MS = 10 * 60 * 1000;
/** Kill only after this long with no stdout/stderr. Claude's text print mode
 *  is silent until the end, so this must stay longer than a typical watch. */
export const LOCAL_CLI_IDLE_TIMEOUT_MS = 6 * 60 * 1000;

const HEARTBEAT_MS = 2_000;

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
				} else if (p.type === "tool_use" && typeof p.name === "string") {
					events.push({ kind: "progress", delta: `${toolActivityProgressLine(p.name)}\n` });
				}
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

function runCliStreaming(
	binPath: string,
	args: string[],
	options: {
		stdinText?: string;
		streamJson: boolean;
		/** Agent id for timeout / error copy (claude, cursor, …). */
		agentId?: string;
		/** Working directory — media/frame folder for Cursor/Codex so absolute paths resolve. */
		cwd?: string;
		onEvent: (event: LocalCliProgressEvent) => void;
		abortSignal?: AbortSignal;
	},
): Promise<string> {
	return new Promise((resolve, reject) => {
		if (options.abortSignal?.aborted) {
			const err = new Error("Agent stopped.");
			err.name = "AbortError";
			reject(err);
			return;
		}
		const child = spawn(binPath, args, {
			cwd: options.cwd && options.cwd.length > 0 ? options.cwd : os.tmpdir(),
			env: localCliSpawnEnv() as NodeJS.ProcessEnv,
			stdio: ["pipe", "pipe", "pipe"],
			// Own process group (POSIX) so Stop/timeout can kill grandchildren too.
			detached: process.platform !== "win32",
		});
		let stdout = "";
		let stderr = "";
		let lineBuf = "";
		let settled = false;
		let idleTimer: ReturnType<typeof setTimeout> | undefined;
		let hardTimer: ReturnType<typeof setTimeout> | undefined;
		let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
		const streamState = {
			assistantText: "",
			result: null as string | null,
			apiError: null as string | null,
		};
		const startedAt = Date.now();
		let lastProgressAt = Date.now();
		const agentId = options.agentId;
		// Cursor / Codex / Gemini print nothing until the end — an idle kill would
		// always fire before a real reply. Only Claude stream-json gets idle timeout.
		const useIdleTimeout = options.streamJson;

		const finish = (error?: Error, value?: string) => {
			if (settled) return;
			settled = true;
			if (hardTimer) clearTimeout(hardTimer);
			if (idleTimer) clearTimeout(idleTimer);
			if (heartbeatTimer) clearInterval(heartbeatTimer);
			options.abortSignal?.removeEventListener("abort", onAbort);
			if (error) reject(error);
			else resolve(value ?? "");
		};
		const killCli = () => {
			killProcessTree(child, "SIGTERM");
			setTimeout(() => killProcessTree(child, "SIGKILL"), 2_000).unref();
		};
		const onAbort = () => {
			killCli();
			const err = new Error("Agent stopped.");
			err.name = "AbortError";
			finish(err);
		};
		options.abortSignal?.addEventListener("abort", onAbort, { once: true });
		const bumpIdle = () => {
			if (!useIdleTimeout) return;
			if (idleTimer) clearTimeout(idleTimer);
			idleTimer = setTimeout(() => {
				killCli();
				finish(
					new Error(
						formatLocalCliError(
							`Local CLI timed out (${pathName(binPath)}). ${stderr.slice(-400) || "No output yet."}`,
							agentId,
						),
					),
				);
			}, LOCAL_CLI_IDLE_TIMEOUT_MS);
		};
		const emitProgress = (delta: string) => {
			lastProgressAt = Date.now();
			options.onEvent({ kind: "progress", delta });
		};

		options.onEvent({
			kind: "progress",
			delta: `Starting ${pathName(binPath)}…\n`,
		});

		heartbeatTimer = setInterval(() => {
			if (settled) return;
			const idleSec = Math.round((Date.now() - lastProgressAt) / 1000);
			const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
			emitProgress(
				idleSec > 3
					? `Still working (${elapsedSec}s) — ${idleSec}s since last output…\n`
					: `Still working (${elapsedSec}s)…\n`,
			);
		}, HEARTBEAT_MS);
		heartbeatTimer.unref?.();

		const handleStdoutChunk = (chunk: string) => {
			stdout += chunk;
			if (stdout.length > MAX_STDOUT_CHARS) stdout = stdout.slice(-MAX_STDOUT_CHARS);
			bumpIdle();
			lastProgressAt = Date.now();
			if (!options.streamJson) {
				// Non-stream CLIs are silent until the end — keep heartbeats only.
				return;
			}
			lineBuf += chunk;
			const lines = lineBuf.split("\n");
			lineBuf = lines.pop() ?? "";
			for (const line of lines) {
				for (const ev of consumeClaudeStreamJsonLine(line, streamState)) {
					options.onEvent(ev);
				}
			}
		};

		// Decoders keep multi-byte characters (emoji, CJK) intact across chunks.
		const stdoutDecoder = new StringDecoder("utf8");
		const stderrDecoder = new StringDecoder("utf8");
		child.stdout.on("data", (chunk: Buffer) => {
			handleStdoutChunk(stdoutDecoder.write(chunk));
		});
		child.stderr.on("data", (chunk: Buffer) => {
			const text = stderrDecoder.write(chunk);
			if (stderr.length > MAX_STDOUT_CHARS) stderr = stderr.slice(-MAX_STDOUT_CHARS);
			stderr += text;
			bumpIdle();
			lastProgressAt = Date.now();
			const snippet = text.replace(/\s+/g, " ").trim().slice(0, 160);
			if (snippet) emitProgress(`${snippet}\n`);
		});
		// Without a listener, EPIPE (CLI exited before reading a large prompt)
		// would surface as an uncaught exception in the Electron main process.
		child.stdin.on("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "EPIPE" || error.code === "ERR_STREAM_DESTROYED") return;
			finish(error);
		});
		if (options.stdinText != null) child.stdin.write(options.stdinText);
		child.stdin.end();
		child.on("error", (error) => finish(error));
		hardTimer = setTimeout(() => {
			killCli();
			finish(
				new Error(
					formatLocalCliError(
						`Local CLI timed out (${pathName(binPath)}). ${stderr.slice(-400) || "No output yet."}`,
						agentId,
					),
				),
			);
		}, LOCAL_CLI_HARD_TIMEOUT_MS);
		bumpIdle();
		child.on("close", (code) => {
			const tail = stdoutDecoder.end();
			if (tail) handleStdoutChunk(tail);
			if (options.streamJson && lineBuf.trim()) {
				for (const ev of consumeClaudeStreamJsonLine(lineBuf, streamState)) {
					options.onEvent(ev);
				}
				lineBuf = "";
			}
			if (streamState.apiError) {
				finish(new Error(formatLocalCliError(streamState.apiError, agentId)));
				return;
			}
			const raw =
				(streamState.result && streamState.result.trim()) ||
				(options.streamJson ? streamState.assistantText.trim() : "") ||
				stdout.trim();
			// Claude may exit 0 with a "success" subtype that still carries a rate-limit sentence.
			// Real replies are JSON objects, so only plain-text results are checked —
			// a reply that merely mentions "rate limit" must not become a quota error.
			if (
				code === 0 &&
				raw &&
				!raw.trimStart().startsWith("{") &&
				/weekly limit|hit your.*limit|api_error_status/i.test(raw)
			) {
				finish(new Error(formatLocalCliError(raw, agentId)));
				return;
			}
			if (code === 0 && raw) {
				finish(undefined, raw);
				return;
			}
			finish(
				new Error(
					formatLocalCliError(
						`Local CLI exited ${code ?? "null"} (${pathName(binPath)}). ${stderr.slice(-400) || stdout.slice(-400) || raw.slice(-400)}`,
						agentId,
					),
				),
			);
		});
	});
}

function pathName(binPath: string): string {
	const parts = binPath.split(/[/\\]/);
	return parts[parts.length - 1] ?? binPath;
}

function thinkingChunk(delta: string): ChatGenerationChunk {
	return new ChatGenerationChunk({
		text: "",
		message: new AIMessageChunk({
			content: [{ type: "thinking", thinking: delta }],
		}),
	});
}

function textChunk(delta: string): ChatGenerationChunk {
	return new ChatGenerationChunk({
		text: delta,
		message: new AIMessageChunk({ content: delta }),
	});
}

export class LocalCliChatModel extends BaseChatModel {
	readonly agentId: string;
	readonly binPath: string;
	readonly boundTools: BoundTool[];
	readonly mediaDirs: string[];
	readonly framePaths: string[];
	readonly cliModel?: string;
	readonly onProgress?: (event: LocalCliProgressEvent) => void;
	readonly abortSignal?: AbortSignal;
	readonly cliSessionId?: string;
	readonly resumeCliSession?: boolean;
	readonly workspaceRoot?: string;
	readonly onCliSpawnComplete?: () => void;
	readonly isCliSessionStarted?: () => boolean;
	readonly watchGranted: boolean;

	constructor(fields: LocalCliChatModelFields) {
		super({});
		this.agentId = fields.agentId;
		this.binPath = fields.binPath;
		this.boundTools = fields.tools ?? [];
		this.mediaDirs = fields.mediaDirs ?? [];
		this.framePaths = fields.framePaths ?? [];
		this.cliModel = fields.cliModel;
		this.onProgress = fields.onProgress;
		this.abortSignal = fields.abortSignal;
		this.cliSessionId = fields.cliSessionId;
		this.resumeCliSession = fields.resumeCliSession;
		this.workspaceRoot = fields.workspaceRoot;
		this.onCliSpawnComplete = fields.onCliSpawnComplete;
		this.isCliSessionStarted = fields.isCliSessionStarted;
		this.watchGranted = fields.watchGranted ?? this.mediaDirs.length > 0;
	}

	_llmType(): string {
		return "openscreen-local-cli";
	}

	bindTools(tools: BindToolsInput[]): LocalCliChatModel {
		return new LocalCliChatModel({
			agentId: this.agentId,
			binPath: this.binPath,
			tools: flattenTools(tools),
			mediaDirs: this.mediaDirs,
			framePaths: this.framePaths,
			cliModel: this.cliModel,
			onProgress: this.onProgress,
			abortSignal: this.abortSignal,
			cliSessionId: this.cliSessionId,
			resumeCliSession: this.resumeCliSession,
			workspaceRoot: this.workspaceRoot,
			onCliSpawnComplete: this.onCliSpawnComplete,
			isCliSessionStarted: this.isCliSessionStarted,
			watchGranted: this.watchGranted,
		});
	}

	private async generateFromCli(
		messages: BaseMessage[],
		onEvent?: (event: LocalCliProgressEvent) => void,
	): Promise<ChatResult> {
		const prompt = buildPrompt(messages, this.boundTools, { framePaths: this.framePaths });
		const streamJson = this.agentId === "claude";
		const workDir =
			this.workspaceRoot ??
			this.mediaDirs[0] ??
			(this.framePaths[0] ? dirname(this.framePaths[0]) : undefined);
		// Folder access (and with it Read/Bash/Write) only when the user granted
		// watch permission. A known workspace root alone must not unlock tools.
		const addDirs = this.watchGranted
			? [
					...this.mediaDirs,
					...(this.workspaceRoot ? [this.workspaceRoot] : []),
					...(this.workspaceRoot ? [`${this.workspaceRoot}/generated-graphics`] : []),
				].filter(Boolean)
			: [];
		const resumeCliSession = this.isCliSessionStarted?.() ?? this.resumeCliSession;
		const forward = (event: LocalCliProgressEvent) => {
			onEvent?.(event);
			// When LangChain is streaming (`onEvent` set), text/thinking chunks are
			// yielded once via `_streamResponseChunks`. Only fan progress/heartbeats
			// through onProgress there — otherwise the chat bubble doubles every line.
			if (!onEvent || event.kind === "progress") {
				this.onProgress?.(event);
			}
		};
		const raw = await runCliStreaming(
			this.binPath,
			printArgvForAgent(this.agentId, prompt, {
				addDirs,
				outputFormat: streamJson ? "stream-json" : undefined,
				model: this.cliModel,
				cliSessionId: this.cliSessionId,
				resumeCliSession,
			}),
			{
				stdinText: localCliPromptOnStdin(this.agentId) ? prompt : undefined,
				streamJson,
				agentId: this.agentId,
				// Prefer project workspace; Claude also gets --add-dir. Cursor/Codex need cwd.
				cwd: workDir && workDir.length > 0 ? workDir : os.tmpdir(),
				onEvent: forward,
				abortSignal: this.abortSignal,
			},
		);
		this.onCliSpawnComplete?.();
		const parsed = parseModelJson(raw);
		const toolCalls = (parsed.tool_calls ?? [])
			.filter((call) => typeof call.name === "string" && call.name)
			.map((call, index) => ({
				id: `call_${index}`,
				name: call.name,
				args: call.args && typeof call.args === "object" ? call.args : {},
				type: "tool_call" as const,
			}));
		const text = parsed.message ?? (toolCalls.length ? "" : raw);
		return {
			generations: [
				{
					text,
					message: new AIMessage({
						content: text,
						tool_calls: toolCalls,
					}),
				},
			],
		};
	}

	async _generate(messages: BaseMessage[]): Promise<ChatResult> {
		return this.generateFromCli(messages);
	}

	// Live progress + stream-json text deltas so the chat loop's
	// on_chat_model_stream path can update the UI before the spawn ends.
	async *_streamResponseChunks(messages: BaseMessage[]): AsyncGenerator<ChatGenerationChunk> {
		const pending: LocalCliProgressEvent[] = [];
		let wake: (() => void) | null = null;
		let done = false;
		let finalResult: ChatResult | undefined;
		let runError: unknown;
		let streamedReplyText = "";

		const push = (event: LocalCliProgressEvent) => {
			pending.push(event);
			wake?.();
		};

		const run = this.generateFromCli(messages, push).then(
			(value) => {
				finalResult = value;
				done = true;
				wake?.();
			},
			(err) => {
				runError = err;
				done = true;
				wake?.();
			},
		);

		while (!done || pending.length > 0) {
			while (pending.length > 0) {
				const event = pending.shift()!;
				// Progress / heartbeats / CLI tool names → thinking strip.
				// Conversational text → live reply bubble. Raw JSON replies stay in
				// thinking so the chat never fills with tool_calls payloads.
				if (event.kind === "text") {
					const trimmed = event.delta.trim();
					if (
						trimmed.startsWith("{") ||
						/"tool_calls"\s*:/.test(trimmed) ||
						/"message"\s*:/.test(trimmed)
					) {
						yield thinkingChunk("Preparing OpenScreen edits…\n");
					} else if (event.delta) {
						streamedReplyText += event.delta;
						yield textChunk(event.delta);
					}
				} else if (event.delta) {
					yield thinkingChunk(event.delta);
				}
			}
			if (done) break;
			await new Promise<void>((resolve) => {
				wake = resolve;
			});
			wake = null;
		}

		await run;
		if (runError) throw runError;
		const generation = finalResult?.generations[0];
		if (!generation) return;
		const message = generation.message as AIMessage;
		// Parsed CLI final (from JSON `message` or raw text) is the source of truth.
		// Streamed plain-text deltas are live UX only — never wipe the parsed final
		// off message.content, or on_chat_model_end cannot recover and the chat
		// bubble stays empty after tools ran.
		const parsedFinal = typeof generation.text === "string" ? generation.text : "";
		// LangChain concatenates chunk contents. When the reply was already
		// streamed as plain text, only add what is still missing so the final
		// message is not "streamed text + the same text again".
		const remainder =
			streamedReplyText && parsedFinal.startsWith(streamedReplyText)
				? parsedFinal.slice(streamedReplyText.length)
				: streamedReplyText && streamedReplyText.trim() === parsedFinal.trim()
					? ""
					: parsedFinal;
		yield new ChatGenerationChunk({
			text: streamedReplyText ? remainder : parsedFinal,
			message: new AIMessageChunk({
				content: remainder,
				tool_call_chunks: (message.tool_calls ?? []).map((call, index) => ({
					id: call.id,
					name: call.name,
					args: JSON.stringify(call.args ?? {}),
					index,
					type: "tool_call_chunk" as const,
				})),
			}),
		});
	}
}

export { buildPrompt, framePathSection, parseModelJson };
