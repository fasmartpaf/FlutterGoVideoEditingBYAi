// LangChain chat model that shells out to a local coding-agent CLI
// (claude / codex / cursor-agent / gemini). HTTP local servers (Ollama,
// LM Studio) stay on the OpenAI-compatible ChatOpenAI path.

import { spawn } from "node:child_process";
import os from "node:os";
import { BaseChatModel, type BindToolsInput } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, type BaseMessage, ToolMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import {
	formatLocalCliError,
	localCliPromptOnStdin,
	localCliSpawnEnv,
	printArgvForAgent,
} from "../local-agents";

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

function buildPrompt(messages: BaseMessage[], tools: BoundTool[]): string {
	const lines: string[] = [
		"You are the brain of OpenScreen's in-app agent.",
		"The SYSTEM message is the live project document. mediaCapabilities states your evidence channels; mediaContext is a textual/derived outline; visibleMedia[].originalPath is a file inventory — not proof you inspected pixels. visualFrames stays false unless image content was actually supplied in this turn; shelling ffmpeg later does not retroactively grant visualFrames in OpenScreen's contract. Prefer mediaContext + tools first. Read and ffmpeg may be available this session — do not say they are blocked. Extract stills only if the user asks to re-scan or textual evidence cannot answer; still do not invent named UI labels without semanticUi.",
		"The JSON tools below only EDIT the timeline. They are not visual understanding. Do not put Read or Bash in JSON tool_calls.",
		"addGraphic creates a title, CTA, lower third, badge, or image and places it on the footage. Preview and export already composite it — do not look for a merge tool.",
		"Reply with ONE JSON object and nothing else.",
		'If you need an OpenScreen edit tool: {"tool_calls":[{"name":"<tool>","args":{...}}]}',
		'If you are done talking to the user: {"message":"<plain text>"}',
	];
	if (tools.length > 0) {
		lines.push("Available tools:");
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

function runCli(binPath: string, args: string[], stdinText?: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(binPath, args, {
			cwd: os.tmpdir(),
			env: localCliSpawnEnv() as NodeJS.ProcessEnv,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		let idleTimer: ReturnType<typeof setTimeout> | undefined;
		let hardTimer: ReturnType<typeof setTimeout> | undefined;
		const finish = (error?: Error, value?: string) => {
			if (settled) return;
			settled = true;
			if (hardTimer) clearTimeout(hardTimer);
			if (idleTimer) clearTimeout(idleTimer);
			if (error) reject(error);
			else resolve(value ?? "");
		};
		const killCli = () => {
			child.kill("SIGTERM");
			setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
		};
		const bumpIdle = () => {
			if (idleTimer) clearTimeout(idleTimer);
			idleTimer = setTimeout(() => {
				killCli();
				finish(
					new Error(
						formatLocalCliError(
							`Local CLI timed out (${pathName(binPath)}). ${stderr.slice(-400) || "No output yet."}`,
						),
					),
				);
			}, LOCAL_CLI_IDLE_TIMEOUT_MS);
		};
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
			bumpIdle();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
			bumpIdle();
		});
		if (stdinText != null) child.stdin.write(stdinText);
		child.stdin.end();
		child.on("error", (error) => finish(error));
		hardTimer = setTimeout(() => {
			killCli();
			finish(
				new Error(
					formatLocalCliError(
						`Local CLI timed out (${pathName(binPath)}). ${stderr.slice(-400) || "No output yet."}`,
					),
				),
			);
		}, LOCAL_CLI_HARD_TIMEOUT_MS);
		bumpIdle();
		child.on("close", (code) => {
			if (code === 0 && stdout.trim()) {
				finish(undefined, stdout.trim());
				return;
			}
			finish(
				new Error(
					formatLocalCliError(
						`Local CLI exited ${code ?? "null"} (${pathName(binPath)}). ${stderr.slice(-400) || stdout.slice(-400)}`,
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

export class LocalCliChatModel extends BaseChatModel {
	readonly agentId: string;
	readonly binPath: string;
	readonly boundTools: BoundTool[];
	readonly mediaDirs: string[];

	constructor(fields: LocalCliChatModelFields) {
		super({});
		this.agentId = fields.agentId;
		this.binPath = fields.binPath;
		this.boundTools = fields.tools ?? [];
		this.mediaDirs = fields.mediaDirs ?? [];
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
		});
	}

	async _generate(messages: BaseMessage[]): Promise<ChatResult> {
		const prompt = buildPrompt(messages, this.boundTools);
		const raw = await runCli(
			this.binPath,
			printArgvForAgent(this.agentId, prompt, { addDirs: this.mediaDirs }),
			localCliPromptOnStdin(this.agentId) ? prompt : undefined,
		);
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

	// The chat loop reads `on_chat_model_stream`. A `_generate`-only model
	// never emits those events, so a real reply looked like an empty model.
	async *_streamResponseChunks(messages: BaseMessage[]): AsyncGenerator<ChatGenerationChunk> {
		const result = await this._generate(messages);
		const generation = result.generations[0];
		if (!generation) return;
		const message = generation.message as AIMessage;
		yield new ChatGenerationChunk({
			text: generation.text,
			message: new AIMessageChunk({
				content: message.content,
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

export { buildPrompt, parseModelJson };
