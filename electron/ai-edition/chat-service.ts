// In-memory chat service. ponytail: chat sessions live in a nested Map; the
// agentic loop itself lives in `deep-agent/service.ts` and is a port of
// axcut's AxcutDeepAgentService (LangGraph stateful thread via
// `createDeepAgent`). The IPC bridge streams `text` deltas + `toolStart` /
// `toolEnd` lifecycle + `error` events into the renderer through the
// ChatEventSink.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
	type AxcutTimelineOperation,
	applyTimelineOperation,
} from "../../src/lib/ai-edition/document/operations";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../src/lib/ai-edition/schema";
import type {
	AiEditionChatMedia,
	AiEditionChatMessage,
	AiEditionChatResult,
	AiEditionPlanItem,
	AiEditionToolCallSummary,
} from "../../src/native/contracts";
import {
	applyCompaction,
	budgetSnapshot,
	buildCompactionPrompt,
	COMPACTION_SYSTEM_PROMPT,
	compactionReducesHistory,
	compactionSplitIndex,
	DEFAULT_BUDGET_TOKENS,
} from "./chat-compaction";
import {
	AGENT_STOPPED_MESSAGE,
	beginChatRun,
	cancelChatRun,
	endChatRun,
	isAbortError,
} from "./chatAbortRegistry";
import { extractChatMediaFromToolResult } from "./chatMedia";
import { runStagedEdit } from "./stagedEditRunner";
import type { CliEngine, CursorTelemetryReader } from "./deep-agent/service";
import type { DocumentService } from "./document-service";
import type { LlmConfigStore } from "./llm-config-store";
import { PROVIDER_DEFINITIONS } from "./provider-registry";

/** Stop the in-flight agent turn for this session (Stop button). */
export { cancelChatRun };

const sessionsByProject = new Map<string, Map<string, ChatSession>>();
const hydratedProjects = new Set<string>();
let persistDir: string | null = null;

/** Write sessions under `dir` so a restart keeps the chat. Null = memory only (tests). */
export function configureChatPersistence(dir: string | null): void {
	persistDir = dir;
	if (dir) fs.mkdirSync(dir, { recursive: true });
}

/** Drop the in-memory maps so the next read reloads from disk (tests / simulated restart). */
export function resetChatSessionsForTests(): void {
	sessionsByProject.clear();
	hydratedProjects.clear();
	messageCheckpointsBySession.clear();
}

function persistFileFor(projectId: string): string | null {
	if (!persistDir) return null;
	const safe = projectId.replace(/[^a-zA-Z0-9._-]/g, "_");
	return path.join(persistDir, `${safe}.json`);
}

function persistProject(projectId: string): void {
	const file = persistFileFor(projectId);
	if (!file) return;
	const sessions = [...(sessionsByProject.get(projectId)?.values() ?? [])];
	const payload = {
		version: 1 as const,
		sessions: sessions.map((session) => ({
			id: session.id,
			projectId: session.projectId,
			title: session.title,
			createdAt: session.createdAt,
			messages: session.messages,
			compaction: session.compaction,
		})),
	};
	const tmp = `${file}.tmp-${process.pid}`;
	try {
		fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
		fs.renameSync(tmp, file);
	} catch (error) {
		try {
			fs.unlinkSync(tmp);
		} catch {
			// leftover temp is harmless
		}
		console.warn(
			`[ai-edition] failed to persist chat for ${projectId}:`,
			error instanceof Error ? error.message : error,
		);
	}
}

function hydrateProject(projectId: string): void {
	if (hydratedProjects.has(projectId)) return;
	hydratedProjects.add(projectId);
	const file = persistFileFor(projectId);
	if (!file) return;
	let raw: string;
	try {
		raw = fs.readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		console.warn(
			`[ai-edition] failed to read chat for ${projectId}:`,
			error instanceof Error ? error.message : error,
		);
		return;
	}
	try {
		const parsed = JSON.parse(raw) as { sessions?: ChatSession[] };
		if (!Array.isArray(parsed.sessions)) return;
		let map = sessionsByProject.get(projectId);
		if (!map) {
			map = new Map();
			sessionsByProject.set(projectId, map);
		}
		for (const row of parsed.sessions) {
			if (!row?.id || row.projectId !== projectId || !Array.isArray(row.messages)) continue;
			map.set(row.id, {
				id: row.id,
				projectId,
				title: typeof row.title === "string" ? row.title : defaultSessionTitle(map.size + 1),
				createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
				messages: row.messages,
				compaction: row.compaction,
			});
		}
	} catch (error) {
		console.warn(
			`[ai-edition] corrupt chat file for ${projectId}:`,
			error instanceof Error ? error.message : error,
		);
	}
}

// ponytail: per-message checkpoints, stored as an ordered list per session
// (insertion order == the session's message order). Each entry captures the
// document *right before* the agent runs that user message — same restore
// semantics as axcut's per-user-message checkpoint. The renderer surfaces a
// ↩ button on every user message that has a checkpoint.
interface MessageCheckpoint {
	userMessageId: string;
	document: AxcutDocument;
	createdAt: string;
}
const messageCheckpointsBySession = new Map<string, MessageCheckpoint[]>();

function sessionKey(projectId: string, sessionId: string): string {
	return `${projectId}::${sessionId}`;
}

function checkpointsForSession(projectId: string, sessionId: string): MessageCheckpoint[] {
	return messageCheckpointsBySession.get(sessionKey(projectId, sessionId)) ?? [];
}

function recordMessageCheckpoint(
	projectId: string,
	sessionId: string,
	userMessageId: string,
	document: AxcutDocument,
): void {
	const key = sessionKey(projectId, sessionId);
	const list = messageCheckpointsBySession.get(key) ?? [];
	list.push({
		userMessageId,
		document,
		createdAt: new Date().toISOString(),
	});
	messageCheckpointsBySession.set(key, list);
}

function findCheckpointForMessage(
	projectId: string,
	sessionId: string,
	userMessageId: string,
): MessageCheckpoint | null {
	return (
		checkpointsForSession(projectId, sessionId).find((c) => c.userMessageId === userMessageId) ??
		null
	);
}

// ponytail: drop every checkpoint at or after the given user message id.
// Called after a rewind truncates the message list, so future checkpoints
// stay aligned with the surviving messages. We compare against the
// session's current message order; if the target message is gone we drop
// all checkpoints created after the surviving tail.
function dropCheckpointsFrom(
	projectId: string,
	sessionId: string,
	fromUserMessageId: string,
): void {
	const key = sessionKey(projectId, sessionId);
	const list = messageCheckpointsBySession.get(key);
	if (!list) return;
	const session = sessionsByProject.get(projectId)?.get(sessionId);
	const surviving = session?.messages.find((m) => m.id === fromUserMessageId);
	const cutIndex = surviving ? list.findIndex((c) => c.userMessageId === fromUserMessageId) : -1;
	if (cutIndex === -1) {
		// ponytail: target message vanished (e.g. already rewound past it).
		// Drop the entire session's checkpoints — they all reference a
		// lineage that's no longer valid.
		messageCheckpointsBySession.delete(key);
		return;
	}
	messageCheckpointsBySession.set(
		key,
		list.filter((_c, i) => i < cutIndex),
	);
}

// ponytail: what compaction leaves behind. `coveredCount` counts the leading
// transcript messages the summary stands in for — the transcript itself is
// never rewritten, so the user keeps every message they wrote while the model
// gets the shortened list. Sessions persist to disk when configured; deleting
// the messages the renderer shows would still be unrecoverable in-session.
// nothing in the UI would say it happened.
interface SessionCompaction {
	summary: AiEditionChatMessage;
	coveredCount: number;
}

export interface ChatSession {
	id: string;
	projectId: string;
	title: string;
	createdAt: string;
	messages: AiEditionChatMessage[];
	/** Main-process bookkeeping: the compaction boundary, not part of the
	 *  transcript. See `modelMessages`. */
	compaction?: SessionCompaction;
}

/** The message list compaction hands the model: summary first, then everything
 *  after the boundary. Identical to the transcript until a compaction lands. */
function modelMessages(session: ChatSession): AiEditionChatMessage[] {
	const state = session.compaction;
	if (!state) return session.messages;
	return [state.summary, ...session.messages.slice(state.coveredCount)];
}

// The model sees a sliding window of recent turns, not the whole session.
const MODEL_HISTORY_WINDOW = 20;

/**
 * Window `modelMessages` down to what we send. The summary is pinned to the
 * front rather than left to the window: the tail after a compaction is roughly
 * half the session, so at the token counts that trip compaction in the first
 * place a plain `slice(-N)` drops the very summary we just paid to produce.
 */
function modelHistory(session: ChatSession): AiEditionChatMessage[] {
	const messages = modelMessages(session);
	if (messages.length <= MODEL_HISTORY_WINDOW) return messages;
	const summary = session.compaction?.summary;
	if (!summary) return messages.slice(-MODEL_HISTORY_WINDOW);
	return [summary, ...messages.slice(1).slice(-(MODEL_HISTORY_WINDOW - 1))];
}

export interface ChatSessionSummary {
	id: string;
	projectId: string;
	title: string;
	createdAt: string;
	messageCount: number;
}

function toSummary(s: ChatSession): ChatSessionSummary {
	return {
		id: s.id,
		projectId: s.projectId,
		title: s.title,
		createdAt: s.createdAt,
		messageCount: s.messages.length,
	};
}

function getProjectSessions(projectId: string): Map<string, ChatSession> {
	hydrateProject(projectId);
	let m = sessionsByProject.get(projectId);
	if (!m) {
		m = new Map();
		sessionsByProject.set(projectId, m);
	}
	return m;
}

function defaultSessionTitle(index: number): string {
	return `Conversation ${index}`;
}

export function listSessions(projectId: string): ChatSessionSummary[] {
	const m = getProjectSessions(projectId);
	return Array.from(m.values())
		.map(toSummary)
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function createSession(projectId: string, title?: string): ChatSessionSummary {
	const m = getProjectSessions(projectId);
	const id = `sess_${randomUUID()}`;
	const now = new Date().toISOString();
	const session: ChatSession = {
		id,
		projectId,
		title: title?.trim() || defaultSessionTitle(m.size + 1),
		createdAt: now,
		messages: [],
	};
	m.set(id, session);
	persistProject(projectId);
	return toSummary(session);
}

export function selectSession(projectId: string, sessionId: string): ChatSession | null {
	const m = getProjectSessions(projectId);
	const s = m.get(sessionId);
	if (!s) return null;
	// ponytail: shallow-copy messages so the caller can't mutate the live array.
	// The compaction boundary stays behind: it is main-process bookkeeping, and
	// every caller of this wants the transcript as the user sees it.
	return {
		id: s.id,
		projectId: s.projectId,
		title: s.title,
		createdAt: s.createdAt,
		messages: [...s.messages],
	};
}

export function renameSession(
	projectId: string,
	sessionId: string,
	title: string,
): ChatSessionSummary | null {
	const m = getProjectSessions(projectId);
	const s = m.get(sessionId);
	if (!s) return null;
	const trimmed = title.trim();
	if (trimmed) s.title = trimmed;
	persistProject(projectId);
	return toSummary(s);
}

export function deleteSession(projectId: string, sessionId: string): boolean {
	const m = getProjectSessions(projectId);
	if (!m.has(sessionId)) return false;
	m.delete(sessionId);
	persistProject(projectId);
	return true;
}

export interface ChatEventSink {
	/** Streamed text delta from the model. */
	text?: (delta: string) => void;
	/** Streamed delta from the model's reasoning block (Anthropic/MiniMax
	 * thinking). Provider-agnostic — never called for providers that don't
	 * expose thinking. The chat panel streams these into a live "Thinking…"
	 * block so the reasoning phase doesn't feel like dead air. */
	thinking?: (delta: string) => void;
	/** A tool call is about to execute. */
	toolStart?: (name: string, args: unknown) => void;
	/** A tool call has finished. `ok=false` carries the model's error message. */
	toolEnd?: (name: string, ok: boolean, summary?: string) => void;
	/** The agent loop hit a fatal error (provider 4xx, network, parse). */
	error?: (message: string) => void;
	/** Coarse phase updates for the live WebSocket / Cursor-like status strip. */
	status?: (phase: string, detail?: string) => void;
	/** The agent's step checklist changed (`updatePlan`). */
	plan?: (items: AiEditionPlanItem[]) => void;
}

export interface ChatRunEnv {
	/** Reads recorded cursor telemetry for an asset. Built in `electron/ipc/
	 *  handlers.ts`, where the path allow-list lives. */
	cursor?: CursorTelemetryReader;
	cli?: CliEngine;
}

// ponytail: zero-config noop for sink callbacks that the caller did not provide.
const noop = () => undefined;

/** ponytail: zero-config sink that swallows every event. */
const NOOP_SINK: Required<ChatEventSink> = {
	text: noop,
	thinking: noop,
	toolStart: noop,
	toolEnd: noop,
	error: noop,
	status: noop,
	plan: noop,
};

/** Reply budget for a targeted request ("make the intro amazing", "zoom at 0:12"). */
const TARGETED_TURN_BUDGET = {
	softSteps: 3,
	finishSteps: 5,
	hardSteps: 7,
	softMs: 2 * 60_000,
	finishMs: 4 * 60_000,
};

/** Add a finished turn to the project journal (best effort — never fails the turn). */
async function rememberTurn(
	document: AxcutDocument | null | undefined,
	userMessageId: string,
	request: string,
	toolCalls: AiEditionToolCallSummary[],
	outcome: string,
): Promise<void> {
	if (!document) return;
	try {
		const [{ recordTurn }, { turnReceiptItems }] = await Promise.all([import("./projectJournal"), import("./editReceipt")]);
		recordTurn(document, { userMessageId, request, changes: turnReceiptItems(toolCalls), outcome });
	} catch (err) {
		console.warn("[journal] could not record the turn:", err instanceof Error ? err.message : err);
	}
}

export async function runChat(
	projectId: string,
	sessionId: string,
	message: string,
	llmConfig: LlmConfigStore,
	documentInput?: unknown,
	sink: ChatEventSink = {},
	env: ChatRunEnv = {},
): Promise<AiEditionChatResult> {
	// Every turn is timed from Send: first status / thinking / reply word /
	// tool, and the total. Logged, and sent to the UI as a `turn_timing` status.
	const { createTurnTimer, formatTurnTiming } = await import("./turnTiming");
	const timer = createTurnTimer();
	const { liveCliStats, liveClaudeSessionsDisabledReason } = await import("./deep-agent/local-cli-chat-model");
	const cliBefore = { ...liveCliStats };
	const emit = timer.wrap({ ...NOOP_SINK, ...sink });
	try {
		return await runChatTimed(projectId, sessionId, message, llmConfig, documentInput, emit, env);
	} finally {
		const timing = timer.finish();
		const line = formatTurnTiming(timing);
		console.info(`[chat-turn] ${projectId}/${sessionId}: ${line}`);
		// Also kept beside the project's generated media, so a slow turn can be
		// diagnosed afterwards (where the minutes went: model replies vs renders).
		try {
			const { appendTurnLog } = await import("./turnTiming");
			appendTurnLog(documentInput, {
				at: new Date().toISOString(),
				sessionId,
				message: message.slice(0, 200),
				...timing,
				// How the Local CLI ran this turn: live steps reuse one Claude process;
				// one-shot steps each start a new one (slow). Restarts = fresh sessions.
				cli: {
					liveSteps: liveCliStats.liveSteps - cliBefore.liveSteps,
					oneShotSteps: liveCliStats.oneShotSteps - cliBefore.oneShotSteps,
					liveFailures: liveCliStats.liveFailures - cliBefore.liveFailures,
					freshRestarts: liveCliStats.freshRestarts - cliBefore.freshRestarts,
					lastLiveError: liveCliStats.lastLiveError,
					liveDisabled: liveClaudeSessionsDisabledReason(),
				},
			});
		} catch {
			/* logging must never fail a turn */
		}
		emit.status("turn_timing", JSON.stringify(timing));
	}
}

async function runChatTimed(
	projectId: string,
	sessionId: string,
	message: string,
	llmConfig: LlmConfigStore,
	documentInput: unknown,
	sink: ChatEventSink,
	/** Runtime capabilities the pure chat path cannot build for itself. Optional
	 *  and last so the three existing call sites are unchanged — but note that a
	 *  production caller which forgets to pass `cursor` gets an agent that answers
	 *  "I could not look" every time, which is honest and unhelpful. */
	env: ChatRunEnv = {},
): Promise<AiEditionChatResult> {
	const emit: Required<ChatEventSink> = { ...NOOP_SINK, ...sink };
	const config = llmConfig.getConfig();
	const { shouldHandleLocalEditorialWithoutCloud, classifyLocalEditorialTurn } = await import(
		"./localEditorialChat"
	);
	const localEditorialOk = shouldHandleLocalEditorialWithoutCloud(message, projectId);
	const classified = classifyLocalEditorialTurn(message, projectId);
	const needsSemanticBrain =
		classified.executionKind === "semantic_understanding" ||
		classified.parseStatus === "UNRESOLVED";

	// Semantic brain uses the Chat-selected provider — never skip credential gate for it.
	if (!localEditorialOk || needsSemanticBrain) {
		if (!config) {
			return {
				success: false,
				error: "No LLM provider configured. Open Settings → AI to configure.",
			};
		}

		const def = PROVIDER_DEFINITIONS.find((d) => d.id === config.provider);
		if (!def) {
			return { success: false, error: `Unknown provider: ${config.provider}` };
		}

		const credential = llmConfig.getCredential(def.id, def.envKeys);
		const apiKey = credential?.value ?? null;
		if (!apiKey && def.authKind === "api-key") {
			return {
				success: false,
				error: `No API key for ${def.label}. Add one in Settings → AI, or pick a local agent from the chat.`,
			};
		}
		if (def.authKind === "local-cli" && !config.model) {
			return {
				success: false,
				error: "No local agent selected. Open the Local CLI menu in the chat and pick one.",
			};
		}
		if (def.authKind === "local-cli") {
			const { formatLocalCliError, listLocalAgents } = await import("./local-agents");
			const agents = await listLocalAgents();
			const selected = agents.find(
				(agent) =>
					agent.id === config.model ||
					agent.models?.includes(config.model) ||
					(agent.path && config.baseUrl === `cli:${agent.path}`),
			);
			if (selected && !selected.ready) {
				return {
					success: false,
					error: formatLocalCliError(selected.statusNote ?? "not logged in"),
				};
			}
		}
	}

	const effectiveConfig =
		config ??
		({
			provider: "openai",
			model: "local-editorial-control",
			baseUrl: "",
			reasoningEffort: "none" as const,
			localAgentPermission: "ask" as const,
			allowAgentEdits: true,
		} as import("./llm-config-store").LlmConfig);

	const def =
		PROVIDER_DEFINITIONS.find((d) => d.id === effectiveConfig.provider) ??
		PROVIDER_DEFINITIONS.find((d) => d.id === "openai");
	if (!def) {
		return { success: false, error: `Unknown provider: ${effectiveConfig.provider}` };
	}
	const credential = llmConfig.getCredential?.(def.id, def.envKeys);
	const apiKey = credential?.value ?? null;

	const sessions = getProjectSessions(projectId);
	let session = sessions.get(sessionId);
	if (!session) {
		// ponytail: tolerate a stale/missing session id by recreating one. The
		// renderer should keep these in sync, but a missing session should
		// never break the chat run path.
		const summary = createSession(projectId, defaultSessionTitle(sessions.size + 1));
		session = sessions.get(summary.id);
	}
	if (!session) {
		return { success: false, error: "Chat session unavailable." };
	}

	// Tools only run against a valid document snapshot; a missing or invalid
	// snapshot degrades to text-only chat instead of failing the turn.
	let workingDocument: AxcutDocument | null = null;
	if (documentInput !== undefined && documentInput !== null) {
		const parsed = documentSchema.safeParse(documentInput);
		if (parsed.success) workingDocument = parsed.data;
	}

	// The recording's one-time analysis (normally started when the project was
	// opened); by the time the agent asks for it, it is usually ready.
	if (workingDocument) {
		const doc = workingDocument;
		void import("./videoSummary").then(({ warmVideoSummary }) => warmVideoSummary(doc)).catch(() => {});
	}

	const userMessage: AiEditionChatMessage = {
		id: randomUUID(),
		role: "user",
		content: message,
		createdAt: new Date().toISOString(),
	};

	// ponytail: snapshot the document *right before* this user message
	// triggers a turn — same restore semantics as axcut's per-message
	// checkpoint. We hold a stable `workingDocument` ref so this snapshot
	// reflects what the user saw when they hit Send.
	const documentForCheckpoint: AxcutDocument | null = workingDocument
		? structuredClone(workingDocument)
		: null;
	if (documentForCheckpoint) {
		recordMessageCheckpoint(projectId, sessionId, userMessage.id, documentForCheckpoint);
	}
	userMessage.checkpointId = documentForCheckpoint ? userMessage.id : null;

	session.messages.push(userMessage);
	persistProject(projectId);

	const editsAllowed = effectiveConfig.allowAgentEdits !== false;

	// ponytail: NO automatic compaction here. A turn used to first check the
	// history against a guessed 80k-token budget and, past 70% of it, block on
	// a whole extra summarizer call before the user's request was even sent.
	// The app cannot ask a provider how big its context window is, so that
	// budget was a number someone picked — wrong by an order of magnitude for a
	// 1M-token Gemini, and silently discarding context the model could have
	// held. Compaction is now only ever what the user asked for by pressing the
	// button. See chat-compaction.ts.

	const history = modelHistory(session).map((m) => ({
		role: m.role as "user" | "assistant" | "system",
		content: m.content,
	}));

	const appliedToolCalls: AiEditionToolCallSummary[] = [];
	let turnMedia: AiEditionChatMedia[] = [];
	let turnPlan: AiEditionPlanItem[] | undefined;

	const agentSink = {
		text: (delta: string) => emit.text(delta),
		thinking: (delta: string) => emit.thinking(delta),
		toolStart: (name: string, args: unknown) => {
			emit.toolStart(name, args);
		},
		toolEnd: (name: string, ok: boolean, summary?: string, resultJson?: string) => {
			emit.toolEnd(name, ok, summary);
			if (ok && summary) {
				appliedToolCalls.push({ name, summary });
			}
			if (ok && resultJson) {
				turnMedia = extractChatMediaFromToolResult(resultJson, turnMedia);
			}
		},
		error: (message: string) => emit.error(message),
		status: (phase: string, detail?: string) => emit.status(phase, detail),
		plan: (items: AiEditionPlanItem[]) => {
			turnPlan = items;
			emit.plan(items);
		},
	};

	// Register the run BEFORE anything the UI can see, so a Stop pressed right
	// after "agent started" always finds it.
	const abortSignal = beginChatRun(projectId, sessionId);
	emit.status(
		"agent_started",
		effectiveConfig.provider === "local-cli"
			? `Working with ${effectiveConfig.localCliModel ?? effectiveConfig.model}…`
			: `Working with ${effectiveConfig.model}…`,
	);

	let result: Awaited<
		ReturnType<(typeof import("./deep-agent/service"))["invokeOpenScreenAgent"]>
	>;
	// A staged whole-video edit keeps the stages it finished even when Stop is
	// pressed mid-way, so it skips the "cancelled, nothing applied" path below.
	let stagedRun = false;
	try {
		// Inside the try so a failed import still clears the run registry.
		const { invokeOpenScreenAgent } = await import("./deep-agent/service");
		const modelConfig = {
			provider: effectiveConfig.provider,
			model: effectiveConfig.model,
			apiKey: apiKey ?? undefined,
			baseUrl: effectiveConfig.baseUrl,
			reasoningEffort: effectiveConfig.reasoningEffort,
			localAgentPermission: effectiveConfig.localAgentPermission,
			localCliModel: effectiveConfig.localCliModel,
			watchGranted:
				effectiveConfig.localAgentPermission === "always" ||
				llmConfig.isSessionWatchGranted?.() === true,
		};
		// Project memory: what earlier turns did + the user's standing instructions.
		// Appended (never prepended) so the live Claude session still recognises
		// the message as the same one next turn.
		const { journalContext } = await import("./projectJournal");
		const memory = workingDocument ? journalContext(workingDocument) : "";
		const messageForAgent = memory ? `${message}\n\n${memory}` : message;
		const { isWholeVideoRequest, modelForWork } = await import("./stagedEdit");
		// Mechanical work runs on the fast model; planning and review keep the user's pick.
		const modelFor = (mechanical: boolean) => ({
			...modelConfig,
			localCliModel: modelForWork(effectiveConfig.model, modelConfig.localCliModel, mechanical),
		});
		stagedRun =
			effectiveConfig.provider === "local-cli" &&
			editsAllowed &&
			workingDocument !== null &&
			process.env.OPENSCREEN_STAGED_EDIT !== "0" &&
			isWholeVideoRequest(message);
		if (stagedRun && workingDocument) {
			const staged = await runStagedEdit({
				invoke: (stage) =>
					invokeOpenScreenAgent({
						document: stage.document,
						model: { ...modelFor(stage.stage.mechanical), turnBudgetLimits: stage.budget },
						history: [...history, ...stage.history],
						userMessage: stage.prompt,
						sink: { ...agentSink, plan: () => {} },
						editsAllowed,
						cursor: env.cursor,
						cli: env.cli,
						abortSignal,
						chatSessionId: sessionId,
						allowedToolNames: stage.toolNames,
					}),
				document: workingDocument,
				request: message,
				projectNotes: memory,
				abortSignal,
				emit,
				onPlan: (items) => {
					turnPlan = items;
				},
				onPreview: (path, label) => {
					turnMedia = extractChatMediaFromToolResult(JSON.stringify({ media: [{ path, label }] }), turnMedia);
				},
			});
			result = staged;
		} else {
			// A targeted ask ("make the intro amazing") only gets the tools for
			// what it names — no surprise cuts, captions or zooms.
			const { requestToolScope } = await import("./stagedEdit");
			const scope = effectiveConfig.provider === "local-cli" ? requestToolScope(message) : null;
			result = await invokeOpenScreenAgent({
				...(scope ? { allowedToolNames: scope } : {}),
				document: workingDocument ?? emptyDocumentForTextOnly(projectId),
				// A targeted ask is a small job: finish it in 1–3 replies.
				model: scope ? { ...modelFor(true), turnBudgetLimits: TARGETED_TURN_BUDGET } : modelConfig,
				history,
				userMessage: messageForAgent,
				sink: agentSink,
				editsAllowed,
				cursor: env.cursor,
				cli: env.cli,
				abortSignal,
				chatSessionId: sessionId,
			});
		}
	} catch (err) {
		endChatRun(projectId, sessionId, abortSignal);
		if (isAbortError(err) || abortSignal.aborted) {
			return {
				success: false,
				status: "cancelled",
				failureReason: "request_aborted",
				error: AGENT_STOPPED_MESSAGE,
			};
		}
		throw err;
	}
	endChatRun(projectId, sessionId, abortSignal);

	if (!stagedRun && (abortSignal.aborted || result.failureReason === "request_aborted")) {
		return {
			success: false,
			status: "cancelled",
			failureReason: "request_aborted",
			error: result.userMessage ?? AGENT_STOPPED_MESSAGE,
		};
	}

	if (!result.text?.trim()) {
		// Tools may have already mutated the document while the model’s final prose
		// was JSON-only / sanitizer-wiped. Prefer a short outcome (not a receipt dump).
		if (appliedToolCalls.length > 0 || result.mutated) {
			const { prepareAssistantContent, summarizeToolActivity } = await import("./editReceipt");
			const fallback =
				appliedToolCalls.length > 0
					? summarizeToolActivity(appliedToolCalls)
					: "Done — edits were applied to the timeline.";
			const content = prepareAssistantContent(fallback, appliedToolCalls);
			const assistantMessage: AiEditionChatMessage = {
				id: randomUUID(),
				role: "assistant",
				content,
				createdAt: new Date().toISOString(),
				toolCalls: appliedToolCalls.length ? appliedToolCalls : undefined,
				media: turnMedia.length ? turnMedia : undefined,
				plan: turnPlan,
			};
			session.messages.push(assistantMessage);
			persistProject(projectId);
			await rememberTurn(result.document ?? workingDocument, userMessage.id, message, appliedToolCalls, content);
			return {
				success: true,
				status: "completed",
				assistantMessage,
				document: result.document,
				toolCalls: appliedToolCalls.length ? appliedToolCalls : undefined,
			};
		}
		if (result.reason) {
			console.warn("[chat-service] agent delivery failure", {
				status: result.status,
				failureReason: result.failureReason,
				providerHttpStatus: result.providerHttpStatus,
				diagnostic: result.reason.slice(0, 500),
			});
		}
		const localCliEmpty =
			effectiveConfig.provider === "local-cli" &&
			(result.failureReason === "sanitizer_removed_all_text" ||
				result.failureReason === "missing_user_facing_response" ||
				result.failureReason === "agent_tool_loop_no_final");
		return {
			success: false,
			status: result.status ?? "analysis_error",
			failureReason: result.failureReason,
			providerHttpStatus: result.providerHttpStatus,
			error: localCliEmpty
				? "The local agent finished without applying an edit. Try again with a concrete ask (e.g. “speed up 1.25×”, “add captions”, “dissolve between clips”, “change wallpaper”)."
				: (result.userMessage ??
					"OpenScreen couldn't complete this analysis. Your project was not changed."),
		};
	}

	const { prepareAssistantContent, stripEmbeddedReceipt, summarizeToolActivity } =
		await import("./editReceipt");
	const { extractChatMediaFromText } = await import("./chatMedia");
	turnMedia = extractChatMediaFromText(result.text, turnMedia);
	let rawText =
		effectiveConfig.provider === "local-cli"
			? prepareAssistantContent(result.text, appliedToolCalls)
			: stripEmbeddedReceipt(result.text);
	// Never leave a blank bubble when tools ran — synthesize a short outcome.
	if (!rawText.trim() && appliedToolCalls.length > 0) {
		rawText = summarizeToolActivity(appliedToolCalls);
	}
	const assistantMessage: AiEditionChatMessage = {
		id: randomUUID(),
		role: "assistant",
		content: rawText,
		createdAt: new Date().toISOString(),
		toolCalls: appliedToolCalls.length ? appliedToolCalls : undefined,
		media: turnMedia.length ? turnMedia : undefined,
		plan: turnPlan,
	};
	session.messages.push(assistantMessage);
	persistProject(projectId);
	await rememberTurn(result.document ?? workingDocument, userMessage.id, message, appliedToolCalls, rawText);

	return {
		success: true,
		status: "completed",
		assistantMessage,
		// ponytail: belt and braces on `editsAllowed`. This returned document is
		// the ONLY path to disk (ChatStripPanel → applyAgentDocument → saveDocument),
		// so it is where a write that somehow escaped the executor's guard would
		// still land. Cheap, and it makes the setting's guarantee structural
		// rather than dependent on one predicate holding everywhere.
		// UI Consent: when a consentable review card is present, do NOT auto-ship
		// a mutated document — the user must Approve via applyPreview.run.
		// Single Mutation Authority: semantic/editorial and read-only turns never
		// auto-ship timeline mutations from the agent tool loop.
		document: (() => {
			const mode = result.mutationAuthority?.mutationMode;
			const fpBefore = result.mutationAuthority?.documentFingerprintBefore;
			const fpAfter = result.mutationAuthority?.documentFingerprintAfterReasoning;
			const editorialChanged =
				typeof fpBefore === "string" &&
				typeof fpAfter === "string" &&
				fpBefore.length > 0 &&
				fpAfter.length > 0 &&
				fpBefore !== fpAfter;
			const hasConsentableCard = result.editReview?.cards.some((c) => c.canApply) === true;
			/**
			 * CRITICAL PRODUCT PATH:
			 * Professional Edit Orchestrator runs verified Apply Preview commits while
			 * the agent tool loop stays proposal_only. Those commits must ship to the
			 * renderer — otherwise Chat claims success and the live timeline never updates.
			 */
			const verifiedOrchestratorShip =
				editsAllowed &&
				result.mutated &&
				!hasConsentableCard &&
				result.mutationAuthority?.finalResponseClaim === "verified_applied";
			if (verifiedOrchestratorShip) {
				return result.document;
			}
			if (mode === "proposal_only" || mode === "read_only") {
				if (editorialChanged) return undefined;
				// Transcript-only / non-editorial fingerprint changes may still ship.
				return result.mutated && editsAllowed ? result.document : undefined;
			}
			if (result.mutated && editsAllowed && !hasConsentableCard) {
				return result.document;
			}
			return undefined;
		})(),
		toolCalls: appliedToolCalls.length ? appliedToolCalls : undefined,
		userMessageCheckpointId: userMessage.checkpointId ?? undefined,
		editReview: result.editReview,
		mutationAuthority: result.mutationAuthority,
	};
}

// ponytail: port of axcut's AxcutAgentRuntime.rewindToMessage. Restores the
// document snapshot taken right before the given user message, truncates the
// session's message list (exclusive of the rewound message), drops every
// checkpoint at or after that message id, and returns the rewound message
// content so the renderer can put it back in the composer.
//
// The renderer is responsible for applying the returned document — that
// mirrors axcut's exact "the assistant rewrites itself" flow, including
// the same projectId's local files going back to that state (we hit
// DocumentService in the IPC handler).
export function rewindToMessage(
	projectId: string,
	sessionId: string,
	messageId: string,
):
	| { success: true; prompt: string; document: AxcutDocument; messages: AiEditionChatMessage[] }
	| {
			success: false;
			error: string;
	  } {
	const session = getProjectSessions(projectId).get(sessionId);
	if (!session) return { success: false, error: "Chat session not found." };
	const messageIndex = session.messages.findIndex((m) => m.id === messageId);
	if (messageIndex === -1) {
		return { success: false, error: "Message not found in this session." };
	}
	const target = session.messages[messageIndex];
	if (target.role !== "user") {
		return { success: false, error: "Rewind must target a user message." };
	}
	if (!target.checkpointId) {
		return { success: false, error: "No checkpoint stored for this message." };
	}
	const cp = findCheckpointForMessage(projectId, sessionId, target.checkpointId);
	if (!cp) {
		return {
			success: false,
			error: "Checkpoint expired — start a fresh chat to recover state.",
		};
	}

	const dropped = session.messages.slice(messageIndex);
	const survived = session.messages.slice(0, messageIndex + 1).map((m) => ({
		...m,
		toolCalls: m.toolCalls ? [...m.toolCalls] : undefined,
	}));
	session.messages = survived;
	// ponytail: a rewind that cuts back past the compaction boundary leaves a
	// summary standing for messages this lineage no longer has. Drop it and let
	// the next turn re-derive one, same reasoning as the checkpoints below.
	if (session.compaction && session.compaction.coveredCount > survived.length) {
		session.compaction = undefined;
	}
	dropCheckpointsFrom(projectId, sessionId, target.checkpointId);
	persistProject(projectId);
	// The rewound turn and everything after it no longer happened.
	const undone = new Set(
		dropped.filter((m) => m.role === "user").map((m) => m.id),
	);
	void import("./projectJournal").then(({ forgetTurns }) => forgetTurns(cp.document, undone)).catch(() => {});

	return {
		success: true,
		prompt: target.content,
		document: cp.document,
		messages: [...survived],
	};
}

// ponytail: renderer-initiated timeline operation. Reads the doc from disk,
// applies `op`, saves the result, and records a chat assistant message that
// summarises the change so the conversation history reflects the manual
// edit (axcut's `applyOperation` does the same).
//
// The renderer applies an optimistic copy to its local store before calling
// this; if the call fails we roll back to the previous document by re-reading
// the saved state, so the cache and disk stay aligned.
export interface TimelineOperationResult {
	document: AxcutDocument;
	summary: string;
}

export async function runTimelineOperation(
	projectId: string,
	sessionId: string,
	op: AxcutTimelineOperation,
	conversationMessage: string,
	documents: DocumentService,
): Promise<{ success: true; result: TimelineOperationResult } | { success: false; error: string }> {
	let session = getProjectSessions(projectId).get(sessionId);
	const created = !session;
	if (created) {
		const summary = createSession(projectId);
		session = selectSession(projectId, summary.id) ?? undefined;
		if (!session) return { success: false, error: "Could not create session." };
	}

	let current: AxcutDocument;
	try {
		current = await documents.getProject(projectId);
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	const applied = applyTimelineOperation(current, op);

	let saved: AxcutDocument;
	try {
		saved = await documents.saveProject(applied.document);
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	if (conversationMessage.trim() && session) {
		const assistantMessage: AiEditionChatMessage = {
			id: `msg_${randomUUID()}`,
			role: "assistant",
			content: conversationMessage.trim(),
			createdAt: new Date().toISOString(),
		};
		session.messages.push(assistantMessage);
		persistProject(projectId);
	}

	return {
		success: true,
		result: {
			document: saved,
			summary: applied.summary,
		},
	};
}

// ponytail: port of axcut's compactSession — manual compaction from a button
// press. Returns the latest session snapshot + the inserted summary message
// id, so the renderer can highlight it.
export async function compactSessionNow(
	projectId: string,
	sessionId: string,
	llmConfig: LlmConfigStore,
): Promise<{ summaryMessageId: string | null; summary: string; session: ChatSession } | null> {
	const session = getProjectSessions(projectId).get(sessionId);
	if (!session) return null;
	const config = llmConfig.getConfig();
	if (!config) return null;
	const def = PROVIDER_DEFINITIONS.find((d) => d.id === config.provider);
	if (!def) return null;
	const credential = llmConfig.getCredential(def.id, def.envKeys);
	const apiKey = credential?.value ?? "";

	// Pressing the button IS the decision — nothing here second-guesses it
	// against a budget. It only declines when there is genuinely nothing to
	// fold (fewer than 4 messages), which is the one refusal left.
	const plan = planCompaction(session);
	if (!plan) return null;

	const ok = await tryCompactSession({
		session,
		plan,
		apiKey,
		provider: config.provider,
		model: config.model,
		baseUrl: config.baseUrl,
		reasoningEffort: config.reasoningEffort,
	});
	if (!ok) return null;
	return {
		summaryMessageId: ok.summaryMessageId,
		summary: ok.summary,
		session: selectSession(projectId, sessionId) as ChatSession,
	};
}

// ponytail: port of axcut's getContextUsage. Returns the current session's
// token estimate + window budget so the renderer can fill the "% context"
// pill with real numbers (no probe — char-based heuristic matching the
// in-call compaction one).
export function getSessionContextUsage(
	projectId: string,
	sessionId: string,
	budgetTokens: number = DEFAULT_BUDGET_TOKENS,
): { usedTokens: number; budgetTokens: number; ratio: number; fillPercent: number } | null {
	const session = getProjectSessions(projectId).get(sessionId);
	if (!session) return null;
	// Measured on what the model is given, not on the transcript -- after a
	// compaction those differ, and the number that matters is the one that
	// fills the context window.
	//
	// `modelHistory`, NOT `modelMessages`: the model gets a 20-message window, so on
	// a 40-message session `modelMessages` reports double what is sent, and pressing
	// Compact halves the reported number while what actually reaches the provider
	// barely moves. That is the same class of wrong number this pill exists to avoid.
	const snap = budgetSnapshot(modelHistory(session), budgetTokens);
	const fillPercent = Math.min(100, Math.round(snap.ratio * 100));
	return {
		usedTokens: snap.usedTokens,
		budgetTokens: snap.budgetTokens,
		ratio: snap.ratio,
		fillPercent,
	};
}

// ponytail: when no document snapshot exists the agent has no edit surface.
// We still hand it an empty (schema-valid) document so the LangGraph thread
// can run, and the model simply won't call write tools against it.
function emptyDocumentForTextOnly(projectId: string): AxcutDocument {
	return createEmptyDocument({ title: "Untitled project", projectId });
}

// --- Compaction (P3.7) ---------------------------------------------------

export interface SessionBudgetSnapshot {
	usedTokens: number;
	budgetTokens: number;
	ratio: number;
	fillPercent: number;
}

export function getSessionBudget(
	projectId: string,
	sessionId: string,
	budgetTokens: number = DEFAULT_BUDGET_TOKENS,
): SessionBudgetSnapshot | null {
	const s = getProjectSessions(projectId).get(sessionId);
	if (!s) return null;
	// Same window the model is actually sent — see `getSessionContextUsage`.
	const snap = budgetSnapshot(modelHistory(s), budgetTokens);
	return {
		usedTokens: snap.usedTokens,
		budgetTokens: snap.budgetTokens,
		ratio: snap.ratio,
		fillPercent: Math.min(100, Math.round(snap.ratio * 100)),
	};
}

/**
 * Force a compaction on the given session. Returns the inserted "Earlier
 * context" message id, or `null` if there isn't enough history yet.
 */
export async function compactSession(
	projectId: string,
	sessionId: string,
	llmConfig: LlmConfigStore,
): Promise<{ summaryMessageId: string | null; summary: string } | null> {
	const session = getProjectSessions(projectId).get(sessionId);
	if (!session) return null;
	const config = llmConfig.getConfig();
	if (!config) return null;
	const def = PROVIDER_DEFINITIONS.find((d) => d.id === config.provider);
	const credential = def ? llmConfig.getCredential(def.id, def.envKeys) : null;
	const apiKey = credential?.value ?? "";

	const plan = planCompaction(session);
	if (!plan) return { summaryMessageId: null, summary: "" };

	const ok = await tryCompactSession({
		session,
		plan,
		apiKey,
		provider: config.provider,
		model: config.model,
		baseUrl: config.baseUrl,
		reasoningEffort: config.reasoningEffort,
	});
	return ok;
}

interface CompactionPlan {
	/** What the model currently gets — the input compaction shortens. */
	payload: AiEditionChatMessage[];
	/** Boundary inside `payload`. */
	splitIndex: number;
	/** The same boundary expressed as a count of transcript messages. */
	coveredCount: number;
}

/**
 * Where a compaction would cut, measured against the payload rather than the
 * transcript — compaction never rewrites the transcript, so the split index
 * has to be an index into the list it will actually be applied to.
 *
 * A second compaction folds the previous summary into the new one: it sits at
 * `payload[0]`, so it is part of the prefix being summarized.
 */
function planCompaction(session: ChatSession): CompactionPlan | null {
	const payload = modelMessages(session);
	const splitIndex = compactionSplitIndex(payload);
	if (splitIndex === null || splitIndex <= 0) return null;
	// Payload index → transcript index. With a summary in front, payload[i]
	// is transcript message `coveredCount + i - 1`.
	const offset = session.compaction ? session.compaction.coveredCount - 1 : 0;
	return { payload, splitIndex, coveredCount: splitIndex + offset };
}

/**
 * Summarize the older half of the model payload and record the boundary on the
 * session. The transcript is left alone — `session.messages` is what the
 * renderer shows, and compaction is a fact about the model's input.
 */
async function tryCompactSession(opts: {
	session: ChatSession;
	plan: CompactionPlan;
	apiKey: string;
	provider: string;
	model: string;
	baseUrl?: string;
	reasoningEffort?: string;
}): Promise<{ summaryMessageId: string | null; summary: string } | null> {
	const { session, plan, apiKey, provider, model, baseUrl, reasoningEffort } = opts;
	const oldMessages = plan.payload.slice(0, plan.splitIndex);
	if (oldMessages.length === 0) return null;

	const prompt = buildCompactionPrompt(oldMessages);
	let summary = "";
	try {
		const { createOpenScreenChatModel, messageContentToText } = await import(
			"./deep-agent/chat-model"
		);
		const chatModel = await createOpenScreenChatModel({
			provider,
			model,
			apiKey,
			baseUrl,
			reasoningEffort,
		});
		const result = await chatModel.invoke([
			new SystemMessage(COMPACTION_SYSTEM_PROMPT),
			new HumanMessage(prompt),
		]);
		summary = messageContentToText(result.content);
		if (!summary) {
			return null;
		}
	} catch {
		// ponytail: a failed summarize must not break the chat turn — leave
		// the session as-is and let the next turn try again.
		return null;
	}

	const compacted = applyCompaction(
		plan.payload,
		plan.splitIndex,
		summary,
		new Date().toISOString(),
	);
	const summaryMessage = compacted[0];
	if (!summaryMessage) return null;
	if (!compactionReducesHistory(plan.payload, compacted)) {
		// The model handed back a summary at least as long as the messages it
		// replaced: adopting it would grow the payload. Refuse it and leave the
		// session alone. (There is no "stop trying" flag any more — nothing
		// retries on its own, so the only next attempt is another button press,
		// which is the user asking again knowingly.)
		return null;
	}
	session.compaction = { summary: summaryMessage, coveredCount: plan.coveredCount };
	persistProject(session.projectId);
	return {
		summaryMessageId: summaryMessage.id,
		summary,
	};
}
