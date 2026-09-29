// LangChain chat model that shells out to a local coding-agent CLI
// (claude / codex / cursor-agent / gemini). HTTP local servers (Ollama,
// LM Studio) stay on the OpenAI-compatible ChatOpenAI path.

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
import {
	consumeClaudeStreamJsonLine,
	killProcessTree,
	LOCAL_CLI_HARD_TIMEOUT_MS,
	LOCAL_CLI_IDLE_TIMEOUT_MS,
	type LocalCliProgressEvent,
	MAX_STDOUT_CHARS,
	HEARTBEAT_MS,
} from "./claudeStream";
import { acquireLiveSession, closeLiveSession } from "./claudeLiveSession";
import { ReplyStreamer } from "./replyStreamer";

export interface PlanItem {
	text: string;
	status: "pending" | "in_progress" | "done" | "skipped";
}

/** Validate a model-supplied plan: 1–8 steps of short text with a known status. */
export function normalizePlan(value: unknown): PlanItem[] | null {
	if (!Array.isArray(value)) return null;
	const statuses = new Set(["pending", "in_progress", "done", "skipped"]);
	const items: PlanItem[] = [];
	for (const raw of value.slice(0, 8)) {
		if (!raw || typeof raw !== "object") continue;
		const text = String((raw as { text?: unknown }).text ?? "").trim().slice(0, 120);
		if (!text) continue;
		const status = String((raw as { status?: unknown }).status ?? "pending");
		items.push({ text, status: (statuses.has(status) ? status : "pending") as PlanItem["status"] });
	}
	return items.length ? items : null;
}

interface BoundTool {
	name: string;
	description?: string;
	schema?: unknown;
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
	/** The reply carried a `plan` checklist — publish it to the chat. */
	onPlan?: (items: PlanItem[]) => void;
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
		"Motion graphics: createMotionClip renders a full-frame animated MP4 at the project size — use a template (listMotionTemplates: titleCard, sectionCard, outroCta, kineticText, statHighlight, bulletList, logoReveal) or write your own HTML composition (CSS/Web Animations, rAF, or window.render(t)). It uses the project brand kit, which starts as the recording's own colours (listMotionTemplates shows it) — use those colours in custom HTML too; call setBrandKit only when the user names brand colours/fonts. Look at the returned previewFrames and fix any reported problems before placing; place with {atSec} so the cut lands in a pause in the speech.",
		"Animated overlays on top of the recording (lower thirds, callouts, badges, keyword pops): addMotionOverlay with a box in % of the recording and startSec — templates are listed under overlays in listMotionTemplates, or pass your own transparent-background HTML.",
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
		'Live checklist: for asks that need 2+ steps, add "plan":[{"text":"Cut dead air","status":"in_progress"},{"text":"Add intro title","status":"pending"}] to your FIRST reply, and re-send it with updated statuses (pending|in_progress|done|skipped) whenever a step changes. 2–6 short plain-language steps; no tool names, ids or paths. It can ride along with tool_calls or message.',
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

/** Stable identity of one conversation message (role + content + tool call id). */
export function messageFingerprint(message: BaseMessage): string {
	const role = ToolMessage.isInstance(message) ? "tool" : message.getType();
	const callId = ToolMessage.isInstance(message) ? message.tool_call_id : "";
	return `${role}:${callId}:${createHash("sha1").update(messageText(message)).digest("hex").slice(0, 16)}`;
}

function isSystem(message: BaseMessage): boolean {
	return message.getType() === "system";
}

export type IncrementalPrompt =
	| { kind: "full"; text: string; fingerprints: string[] }
	| { kind: "delta"; text: string; fingerprints: string[] }
	| { kind: "diverged" };

/**
 * What to send to a live Claude process that already saw `sentFingerprints`.
 *  - nothing sent yet            → the full prompt
 *  - same history + new messages → only the new messages (tool results, the
 *                                  next user message) and, when it changed,
 *                                  the refreshed project state (SYSTEM)
 *  - history rewritten (rewind / compaction) → "diverged": start over
 * Claude's own replies are never re-sent — they are already in its context.
 */
export function buildIncrementalPrompt(
	messages: BaseMessage[],
	tools: BoundTool[],
	sent: { fingerprints: string[]; frameKey: string; toolsKey: string },
	options?: { framePaths?: string[] },
): IncrementalPrompt {
	const fingerprints = messages.map(messageFingerprint);
	if (sent.fingerprints.length === 0) {
		return { kind: "full", text: buildPrompt(messages, tools, options), fingerprints };
	}
	const sentSet = new Set(sent.fingerprints);
	const sentHistory = sent.fingerprints.filter((fp) => !fp.startsWith("system:"));
	const nowHistory = messages
		.map((m, i) => ({ m, fp: fingerprints[i]! }))
		.filter(({ m }) => !isSystem(m));
	// Every non-system message Claude saw must still be there, in order.
	for (let i = 0; i < sentHistory.length; i++) {
		if (nowHistory[i]?.fp !== sentHistory[i]) return { kind: "diverged" };
	}
	const lines: string[] = [];
	const changedSystem = messages.filter((m, i) => isSystem(m) && !sentSet.has(fingerprints[i]!));
	for (const m of changedSystem) {
		lines.push(`UPDATED OPENSCREEN PROJECT STATE (replaces the earlier SYSTEM message):\n${messageText(m)}`);
	}
	const toolsKey = JSON.stringify(tools.map((t) => t.name));
	if (tools.length > 0 && toolsKey !== sent.toolsKey) {
		lines.push("Available OpenScreen tools (updated):");
		lines.push(JSON.stringify(tools, null, 2));
	}
	const frameKey = (options?.framePaths ?? []).join("\n");
	if (frameKey && frameKey !== sent.frameKey) {
		lines.push(framePathSection(options?.framePaths ?? []).trimEnd());
	}
	let sawToolResult = false;
	for (const { m } of nowHistory.slice(sentHistory.length)) {
		if (ToolMessage.isInstance(m) || m.getType() === "tool") {
			sawToolResult = true;
			lines.push(`TOOL RESULT: ${messageText(m)}`);
		} else if (m.getType() === "human") {
			const t = messageText(m);
			if (t) lines.push(`USER: ${t}`);
		}
		// AI messages are Claude's own earlier replies — already in its context.
	}
	if (sawToolResult) {
		lines.push(
			'Continue the loop if the user objective is not yet verified. When it is met, reply ONLY with {"message":"…"}. Do NOT retry a failing tool with the same args.',
		);
	}
	lines.push(
		'Reply with ONE JSON object and nothing else: {"tool_calls":[…]} or {"message":"…"}.',
	);
	return { kind: "delta", text: lines.join("\n"), fingerprints };
}

let liveDisabledReason: string | null = null;

/** Turn live sessions off for the rest of this app session (after a failure). */
export function disableLiveClaudeSessions(reason: string): void {
	liveDisabledReason = reason;
}

/** Why live sessions were turned off this app session, if they were. */
export function liveClaudeSessionsDisabledReason(): string | null {
	return liveDisabledReason;
}

/** Test helper. */
export function resetLiveClaudeSessionsForTests(): void {
	liveDisabledReason = null;
}

/** Live (long-lived) Claude sessions are on unless OPENSCREEN_CLI_PERSISTENT=0 or one failed. */
export function liveClaudeSessionsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.OPENSCREEN_CLI_PERSISTENT !== "0" && liveDisabledReason === null;
}

function parseModelJson(raw: string): {
	message?: string;
	tool_calls?: Array<{ name: string; args: unknown }>;
	plan?: unknown;
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
		// Latency marks for this spawn (logged on exit): process start → first
		// byte of output → first reply token.
		let firstOutputAt: number | null = null;
		let firstTextAt: number | null = null;
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
			if (firstOutputAt === null && chunk) firstOutputAt = Date.now();
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
					if (ev.kind === "text" && firstTextAt === null) firstTextAt = Date.now();
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
			const since = (t: number | null) => (t === null ? "—" : `${t - startedAt}ms`);
			console.info(
				`[local-cli] ${pathName(binPath)} exit ${code}: first output ${since(firstOutputAt)} · ` +
					`first text ${since(firstTextAt)} · total ${Date.now() - startedAt}ms`,
			);
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
	readonly onPlan?: (items: PlanItem[]) => void;
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
		this.onPlan = fields.onPlan;
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
			onPlan: this.onPlan,
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
		const deliver = (event: LocalCliProgressEvent) => {
			onEvent?.(event);
			// When LangChain is streaming (`onEvent` set), text/thinking chunks are
			// yielded once via `_streamResponseChunks`. Only fan progress/heartbeats
			// through onProgress there — otherwise the chat bubble doubles every line.
			if (!onEvent || event.kind === "progress") {
				this.onProgress?.(event);
			}
		};
		// Raw assistant tokens → only what the user should read (the decoded
		// `message` of a JSON reply, or prose). JSON syntax never reaches the chat.
		const reply = new ReplyStreamer();
		const forward = (event: LocalCliProgressEvent) => {
			if (event.kind === "boundary") {
				reply.reset();
				return;
			}
			if (event.kind !== "text") {
				deliver(event);
				return;
			}
			for (const out of reply.push(event.delta)) {
				deliver(
					out.kind === "text"
						? { kind: "text", delta: out.delta }
						: { kind: "progress", delta: out.delta },
				);
			}
		};
		const cwd = workDir && workDir.length > 0 ? workDir : os.tmpdir();
		let raw: string | null = null;
		if (this.agentId === "claude" && this.cliSessionId && liveClaudeSessionsEnabled()) {
			try {
				raw = await this.runLiveTurn(messages, { addDirs, resumeCliSession, cwd, forward });
			} catch (err) {
				if ((err as Error)?.name === "AbortError" || this.abortSignal?.aborted) throw err;
				// The long-lived process failed: keep the chat working on the proven
				// one-spawn-per-step path for the rest of this app session, and say why.
				disableLiveClaudeSessions(err instanceof Error ? err.message : String(err));
				closeLiveSession(this.cliSessionId);
				console.warn(`[local-cli] live session disabled, falling back: ${(err as Error)?.message}`);
				forward({ kind: "progress", delta: "Live session failed — continuing in one-shot mode…\n" });
				raw = null;
			}
		}
		if (raw === null)
			raw = await runCliStreaming(
			this.binPath,
			printArgvForAgent(this.agentId, prompt, {
				addDirs,
				outputFormat: streamJson ? "stream-json" : undefined,
				model: this.cliModel,
				// After a live-session failure the Claude session on disk may be in an
				// unknown state ("session id already in use"); run without session
				// flags — the prompt carries the whole conversation anyway.
				cliSessionId: liveClaudeSessionsDisabledReason() ? undefined : this.cliSessionId,
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
		const plan = normalizePlan(parsed.plan);
		if (plan) this.onPlan?.(plan);
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

	/**
	 * One model step on the chat's long-lived Claude process: send only what it
	 * has not seen yet, read the stream until this step's `result`.
	 */
	private async runLiveTurn(
		messages: BaseMessage[],
		ctx: {
			addDirs: string[];
			resumeCliSession: boolean | undefined;
			cwd: string;
			forward: (event: LocalCliProgressEvent) => void;
		},
	): Promise<string> {
		const key = this.cliSessionId!;
		const argvFor = (sessionId: string, resume: boolean) =>
			printArgvForAgent("claude", "", {
				addDirs: ctx.addDirs,
				inputFormat: "stream-json",
				model: this.cliModel,
				cliSessionId: sessionId,
				resumeCliSession: resume,
			});
		let live = acquireLiveSession(key, this.binPath, argvFor(key, Boolean(ctx.resumeCliSession)), ctx.cwd);
		let prompt = buildIncrementalPrompt(
			messages,
			this.boundTools,
			{ fingerprints: live.sentFingerprints, frameKey: live.sentFrameKey, toolsKey: live.sentToolsKey },
			{ framePaths: this.framePaths },
		);
		if (prompt.kind === "diverged") {
			// History was rewritten (rewind / compaction): Claude's memory no longer
			// matches the chat. Start a clean process on a fresh session and send
			// the whole conversation again.
			live.close(new Error("Conversation history changed."));
			live = acquireLiveSession(key, this.binPath, argvFor(randomUUID(), false), ctx.cwd);
			prompt = {
				kind: "full",
				text: buildPrompt(messages, this.boundTools, { framePaths: this.framePaths }),
				fingerprints: messages.map(messageFingerprint),
			};
		}
		const raw = await live.runTurn(prompt.text, {
			onEvent: ctx.forward,
			signal: this.abortSignal,
			agentId: this.agentId,
		});
		live.sentFingerprints = prompt.fingerprints;
		live.sentFrameKey = this.framePaths.join("\n");
		live.sentToolsKey = JSON.stringify(this.boundTools.map((t) => t.name));
		return raw;
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
				// Text is already filtered by ReplyStreamer (decoded reply only).
				if (event.kind === "text") {
					if (event.delta) {
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
export {
	consumeClaudeStreamJsonLine,
	killProcessTree,
	LOCAL_CLI_HARD_TIMEOUT_MS,
	LOCAL_CLI_IDLE_TIMEOUT_MS,
	type LocalCliProgressEvent,
	type LocalCliStreamEvent,
} from "./claudeStream";
