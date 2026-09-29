// Discover coding agents already installed on this machine (PATH + common
// local HTTP servers). FlutterGo-style: the in-app chat talks to those
// binaries / servers. No API key is stored in Settings.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type LocalAgentKind = "cli" | "http";

export interface LocalAgentInfo {
	id: string;
	name: string;
	kind: LocalAgentKind;
	/** Resolved executable, when kind is cli. */
	path?: string;
	/** OpenAI-compatible base URL, when kind is http. */
	baseUrl?: string;
	version?: string;
	/** Models the HTTP server currently exposes (Ollama / LM Studio). */
	models?: string[];
	/** Best-effort active model label (e.g. Claude Code "Fable" / "Opus 4.5"). */
	activeModel?: string;
	/** Selectable Claude CLI models (`--model`), when kind is Claude Code. */
	modelOptions?: LocalCliModelOption[];
	ready: boolean;
	/** Machine status for the picker, e.g. `needs-login`. */
	statusNote?: string;
}

export interface LocalCliModelOption {
	/** Value passed to `claude --model` (alias or full id). */
	id: string;
	label: string;
	available: boolean;
	/** Shown when unavailable, e.g. needs a Claude Code update. */
	note?: string;
}

export interface LocalAgentSelection {
	provider: "local-cli";
	model: string;
	baseUrl?: string;
	/** Claude Code `--model` when `model` is the agent id `claude`. */
	localCliModel?: string;
}

/** How OpenScreen grants the local agent access to watch recordings. */
export type LocalAgentPermission = "ask" | "always" | "never";

export function shouldGrantLocalWatch(
	permission: LocalAgentPermission | undefined,
	sessionGranted: boolean,
): boolean {
	if (permission === "never") return false;
	if (permission === "always") return true;
	return sessionGranted;
}

const EXTRA_BIN_DIRS = [
	"/usr/local/bin",
	"/opt/homebrew/bin",
	"/opt/homebrew/sbin",
	path.join(os.homedir(), ".local", "bin"),
	path.join(os.homedir(), ".cargo", "bin"),
	path.join(os.homedir(), ".claude", "bin"),
	path.join(os.homedir(), ".codex", "bin"),
	path.join(os.homedir(), "homebrew", "bin"),
];

/** Electron's PATH is often just /usr/bin. Claude's ffmpeg stills need the
 *  user's / Homebrew ffmpeg, so prepend the same dirs the scanner already uses. */
export function localCliSpawnEnv(
	base: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
	const pathKey = process.platform === "win32" && base.Path != null ? "Path" : "PATH";
	const current = base[pathKey] ?? base.PATH ?? "";
	return {
		...base,
		[pathKey]: [...EXTRA_BIN_DIRS, current].filter(Boolean).join(path.delimiter),
	};
}

interface CliSpec {
	id: string;
	name: string;
	binaries: string[];
	versionArgs: string[];
}

interface HttpSpec {
	id: string;
	name: string;
	probeUrl: string;
	baseUrl: string;
	parseModels: (body: unknown) => string[];
}

const CLI_SPECS: CliSpec[] = [
	{ id: "claude", name: "Claude Code", binaries: ["claude"], versionArgs: ["--version"] },
	{ id: "codex", name: "Codex", binaries: ["codex"], versionArgs: ["--version"] },
	{
		id: "cursor",
		name: "Cursor Agent",
		binaries: ["cursor-agent", "agent"],
		versionArgs: ["--version"],
	},
	{ id: "gemini", name: "Gemini CLI", binaries: ["gemini"], versionArgs: ["--version"] },
];

const HTTP_SPECS: HttpSpec[] = [
	{
		id: "ollama",
		name: "Ollama",
		probeUrl: "http://127.0.0.1:11434/api/tags",
		baseUrl: "http://127.0.0.1:11434/v1",
		parseModels: (body) => {
			const models = (body as { models?: Array<{ name?: string }> })?.models ?? [];
			return models.map((row) => row.name).filter((name): name is string => Boolean(name));
		},
	},
	{
		id: "lmstudio",
		name: "LM Studio",
		probeUrl: "http://127.0.0.1:1234/v1/models",
		baseUrl: "http://127.0.0.1:1234/v1",
		parseModels: (body) => {
			const models = (body as { data?: Array<{ id?: string }> })?.data ?? [];
			return models.map((row) => row.id).filter((id): id is string => Boolean(id));
		},
	},
];

let cached: LocalAgentInfo[] | null = null;

export function whichOnPath(binary: string, pathEnv = process.env.PATH ?? ""): string | null {
	const dirs = [...pathEnv.split(path.delimiter).filter(Boolean), ...EXTRA_BIN_DIRS];
	const names =
		process.platform === "win32" ? [`${binary}.cmd`, `${binary}.exe`, binary] : [binary];
	for (const dir of dirs) {
		for (const name of names) {
			const candidate = path.join(dir, name);
			try {
				if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
			} catch {
				// Permission or broken symlink — keep looking.
			}
		}
	}
	return null;
}

function readVersion(binPath: string, versionArgs: string[]): string | undefined {
	try {
		const result = spawnSync(binPath, versionArgs, {
			encoding: "utf8",
			timeout: 4_000,
			env: process.env,
		});
		const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
		const line = text.split("\n").find((row) => row.trim());
		return line?.replace(/^v/i, "").trim() || undefined;
	} catch {
		return undefined;
	}
}

async function probeHttp(spec: HttpSpec): Promise<LocalAgentInfo | null> {
	try {
		const response = await fetch(spec.probeUrl, {
			signal: AbortSignal.timeout(1_200),
		});
		if (!response.ok) return null;
		const body: unknown = await response.json();
		const models = spec.parseModels(body);
		return {
			id: spec.id,
			name: spec.name,
			kind: "http",
			baseUrl: spec.baseUrl,
			models,
			ready: true,
		};
	} catch {
		return null;
	}
}

function readClaudeActiveModelLabel(): string | undefined {
	const options = readClaudeModelOptions();
	const available = options.find((row) => row.available);
	return available?.label ?? options[0]?.label;
}

/** Aliases Claude CLI documents for `--model` (see `claude --help`). */
const CLAUDE_CLI_ALIASES: Array<{ id: string; label: string }> = [
	{ id: "fable", label: "Fable" },
	{ id: "opus", label: "Opus" },
	{ id: "sonnet", label: "Sonnet" },
];

export function humanizeClaudeModelId(id: string): string {
	const lower = id.toLowerCase();
	if (lower.includes("opus") && lower.includes("5.5")) return "Opus 5.5";
	if (lower.includes("opus") && lower.includes("4")) return "Opus 4";
	if (lower === "opus" || lower.includes("opus")) return "Opus";
	if (lower.includes("sonnet")) return "Sonnet";
	if (lower.includes("haiku")) return "Haiku";
	if (lower.includes("fable")) return "Fable";
	return id;
}

function aliasForClaudeValue(value: string, label?: string): string {
	const lower = `${value} ${label ?? ""}`.toLowerCase();
	if (lower.includes("fable")) return "fable";
	if (lower.includes("opus")) return "opus";
	if (lower.includes("sonnet")) return "sonnet";
	if (lower.includes("haiku")) return "haiku";
	return value.trim();
}

/**
 * Models the user can pick for Claude Code. Merges CLI aliases with
 * `additionalModelOptionsCache` so locked “update required” rows stay visible
 * but not selectable.
 */
export function readClaudeModelOptions(): LocalCliModelOption[] {
	const byId = new Map<string, LocalCliModelOption>();
	try {
		const home = os.homedir();
		const candidates = [
			path.join(home, ".claude.json"),
			path.join(home, ".claude", "settings.json"),
			path.join(home, ".claude", "settings.local.json"),
		];
		for (const file of candidates) {
			if (!fs.existsSync(file)) continue;
			const raw = fs.readFileSync(file, "utf8");
			const parsed = JSON.parse(raw) as {
				model?: string;
				userModel?: string;
				additionalModelOptionsCache?: Array<{
					value?: string;
					label?: string;
					disabled?: boolean;
				}>;
			};
			const options = parsed.additionalModelOptionsCache;
			if (!Array.isArray(options)) continue;
			for (const row of options) {
				if (!row || typeof row !== "object") continue;
				const value = typeof row.value === "string" ? row.value.trim() : "";
				const rawLabel = typeof row.label === "string" ? row.label.trim() : "";
				if (!value && !rawLabel) continue;
				const updateRequired =
					Boolean(row.disabled) || /^cc-update-required/i.test(value);
				const label = (rawLabel || humanizeClaudeModelId(value)).replace(
					/\s*\(disabled\)\s*$/i,
					"",
				);
				const id = updateRequired
					? `locked:${aliasForClaudeValue(value || label, label)}:${label}`
					: aliasForClaudeValue(value || label, label);
				const existing = byId.get(id);
				if (existing?.available && updateRequired) continue;
				byId.set(id, {
					id: updateRequired ? id : id,
					label,
					available: !updateRequired,
					...(updateRequired ? { note: "Update Claude Code to unlock" } : {}),
				});
			}
			// Prefer the first settings file that had options.
			if (byId.size > 0) break;
		}
	} catch {
		// Best-effort only.
	}

	for (const alias of CLAUDE_CLI_ALIASES) {
		const covered = [...byId.values()].some(
			(row) =>
				row.available &&
				(row.id === alias.id || row.label.toLowerCase().includes(alias.id)),
		);
		if (!covered && !byId.has(alias.id)) {
			byId.set(alias.id, { id: alias.id, label: alias.label, available: true });
		}
	}

	const available = [...byId.values()].filter((row) => row.available);
	const locked = [...byId.values()].filter((row) => !row.available);
	const aliasOrder = CLAUDE_CLI_ALIASES.map((a) => a.id);
	available.sort((a, b) => {
		const ai = aliasOrder.indexOf(a.id);
		const bi = aliasOrder.indexOf(b.id);
		if (ai >= 0 || bi >= 0) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
		return a.label.localeCompare(b.label);
	});
	return [...available, ...locked];
}

export async function scanLocalAgents(): Promise<LocalAgentInfo[]> {
	const found: LocalAgentInfo[] = [];
	for (const spec of CLI_SPECS) {
		let binPath: string | null = null;
		for (const binary of spec.binaries) {
			binPath = whichOnPath(binary);
			if (binPath) break;
		}
		if (!binPath) continue;
		const auth = probeCliAuth(spec.id, binPath);
		const claudeModels = spec.id === "claude" ? readClaudeModelOptions() : undefined;
		found.push({
			id: spec.id,
			name: spec.name,
			kind: "cli",
			path: binPath,
			version: readVersion(binPath, spec.versionArgs),
			...(claudeModels
				? {
						activeModel: readClaudeActiveModelLabel(),
						modelOptions: claudeModels,
						models: claudeModels.filter((m) => m.available).map((m) => m.id),
					}
				: {}),
			ready: auth.ready,
			statusNote: auth.statusNote,
		});
	}
	const http = await Promise.all(HTTP_SPECS.map((spec) => probeHttp(spec)));
	for (const agent of http) {
		if (agent) found.push(agent);
	}
	return found;
}

export async function listLocalAgents(force = false): Promise<LocalAgentInfo[]> {
	if (!force && cached) return cached;
	cached = await scanLocalAgents();
	return cached;
}

export function selectionForAgent(agent: LocalAgentInfo, model?: string): LocalAgentSelection {
	if (agent.kind === "http") {
		const chosen = model ?? agent.models?.[0] ?? agent.id;
		return {
			provider: "local-cli",
			model: chosen,
			baseUrl: agent.baseUrl,
		};
	}
	return {
		provider: "local-cli",
		model: agent.id,
		baseUrl: agent.path ? `cli:${agent.path}` : undefined,
		...(agent.id === "claude" && model && !model.startsWith("locked:")
			? { localCliModel: model }
			: {}),
	};
}

export function mediaDirsFromDocument(document: {
	assets?: Array<{ kind?: string; originalPath?: string | null }>;
}): string[] {
	const dirs = new Set<string>();
	for (const asset of document.assets ?? []) {
		if (asset.kind === "audio") continue;
		const raw = asset.originalPath?.trim();
		if (!raw || /^https?:\/\//i.test(raw)) continue;
		dirs.add(path.dirname(raw));
	}
	return [...dirs];
}

/** Claude's `--add-dir` / `--allowedTools` / `--tools` are variadic and
 *  swallow a trailing prompt. The prompt goes on stdin instead. */
export function localCliPromptOnStdin(agentId: string): boolean {
	return agentId === "claude";
}

export function printArgvForAgent(
	agentId: string,
	prompt: string,
	options?: {
		addDirs?: string[];
		outputFormat?: "text" | "stream-json";
		/** Claude `--model` alias or full id (e.g. fable, opus, sonnet). */
		model?: string;
		/**
		 * Persistent Claude Code session. When set, OpenScreen passes
		 * `--session-id` and, after the first turn, `--resume` so follow-ups
		 * keep CLI memory (files inspected, prior decisions).
		 */
		cliSessionId?: string;
		/** True when this OpenScreen chat session already spawned Claude once. */
		resumeCliSession?: boolean;
	},
): string[] {
	// Codex/Cursor/Gemini: frame + media absolute paths are inlined in `prompt`
	// (OpenScreen samples JPEGs). They have no Claude-style --add-dir; the spawn
	// cwd is set to a media/frame folder in LocalCliChatModel instead.
	if (agentId === "codex") return ["exec", "--skip-git-repo-check", prompt];
	if (agentId === "gemini") return ["-p", prompt];
	// Cursor Agent refuses a temp cwd until the workspace is trusted. This
	// spawn is headless (no TTY), so `--trust` is the non-interactive grant
	// the CLI itself tells you to pass.
	if (agentId === "cursor") return ["-p", "--trust", prompt];
	if (agentId === "claude") {
		// stream-json lets OpenScreen show live progress; final result still
		// carries the ONE JSON object OpenScreen parses for tools/message.
		const format = options?.outputFormat === "stream-json" ? "stream-json" : "text";
		const argv = ["-p", "--output-format", format, "--setting-sources", "user"];
		const model = options?.model?.trim();
		if (model && !model.startsWith("locked:")) {
			argv.push("--model", model);
		}
		const sessionId = options?.cliSessionId?.trim();
		if (sessionId) {
			// Persist under a stable UUID for this OpenScreen chat conversation.
			// Do NOT pass --no-session-persistence — that forced amnesia every spawn.
			// First spawn creates the session with `--session-id`; every later spawn
			// continues it with `--resume` alone. Passing both is rejected by the
			// CLI, and re-sending `--session-id` fails with "already in use".
			if (options?.resumeCliSession) {
				argv.push("--resume", sessionId);
			} else {
				argv.push("--session-id", sessionId);
			}
		}
		if (format === "stream-json") {
			// Needed so NDJSON includes assistant text deltas, not only the result.
			argv.push("--verbose");
		}
		const dirs = (options?.addDirs ?? []).filter(Boolean);
		if (dirs.length > 0) {
			// dontAsk auto-denies Bash unless the command is exactly `ffmpeg …`.
			// Claude often wraps that (`mkdir` then ffmpeg, or `cd && ffmpeg`) and
			// then reports it cannot watch. bypassPermissions + Read/Bash, scoped
			// to the recording folders + temp dir, is what actually lets it see.
			argv.push("--permission-mode", "bypassPermissions");
			argv.push("--tools", "Read", "Bash", "Edit", "Write", "Glob", "Grep");
			argv.push("--allowedTools", "Read", "Bash", "Edit", "Write", "Glob", "Grep");
			for (const dir of [...new Set([...dirs, os.tmpdir()])]) {
				argv.push("--add-dir", dir);
			}
		} else {
			argv.push("--permission-mode", "dontAsk");
			argv.push("--tools", "");
		}
		return argv;
	}
	return ["-p", prompt];
}

export function isLocalCliConfig(provider: string | undefined): boolean {
	return provider === "local-cli";
}

export function isHttpLocalCli(baseUrl: string | undefined): boolean {
	return Boolean(baseUrl && /^https?:\/\//i.test(baseUrl));
}

export function cliPathFromBaseUrl(baseUrl: string | undefined): string | undefined {
	if (!baseUrl?.startsWith("cli:")) return undefined;
	return baseUrl.slice("cli:".length);
}

export function loginCommandForAgent(agentId: string): string | null {
	if (agentId === "claude") return "claude auth login";
	if (agentId === "codex") return "codex login";
	if (agentId === "gemini") return "gemini auth login";
	if (agentId === "cursor") return "agent login";
	return null;
}

export function localAgentDisplayName(agentId?: string | null): string {
	const id = (agentId ?? "").trim().toLowerCase();
	if (id === "cursor" || id === "cursor-agent" || id === "agent") return "Cursor Agent";
	if (id === "codex") return "Codex";
	if (id === "gemini") return "Gemini CLI";
	if (id === "claude" || id.includes("claude")) return "Claude Code";
	if (id === "ollama") return "Ollama";
	if (id === "lmstudio" || id === "lm-studio") return "LM Studio";
	return "Local CLI";
}

/** Infer agent id from a timeout/exit string that embeds the binary path or name. */
function agentIdFromErrorText(text: string): string | undefined {
	const lower = text.toLowerCase();
	if (/\bcursor-agent\b|\bagent\b/.test(lower) && !/\bclaude\b/.test(lower)) return "cursor";
	if (/\bcodex\b/.test(lower)) return "codex";
	if (/\bgemini\b/.test(lower)) return "gemini";
	if (/\bclaude\b/.test(lower)) return "claude";
	return undefined;
}

export function formatLocalCliError(raw: string, agentId?: string): string {
	const text = raw.replace(/\s+/g, " ").trim();
	const label = localAgentDisplayName(agentId ?? agentIdFromErrorText(text));
	if (
		text === "needs-login" ||
		/not logged in|please run \/login|loggedIn["']?\s*:\s*false/i.test(text)
	) {
		if (label === "Cursor Agent") {
			return "Cursor Agent is not signed in. Run `agent login` in Terminal, then Rescan PATH.";
		}
		return "Claude Code is not signed in. Run `claude auth login` in Terminal, then Rescan PATH.";
	}
	if (/Workspace Trust Required|trust the contents of this directory|Pass `--trust`/i.test(text)) {
		return (
			"Cursor Agent refused the workspace (needs --trust). " +
			"Restart OpenScreen after the latest update and send again."
		);
	}
	if (/timed out/i.test(text)) {
		return (
			`${label} timed out while answering. Watching the recording (ffmpeg stills) ` +
			"plus the first reply can take several minutes. Retry the send, or set watching to " +
			"Never for a faster metadata-only reply."
		);
	}
	// Claude CLI often dumps a whole result JSON on weekly/rate limits (HTTP 429).
	const weekly =
		text.match(/You've hit your weekly limit[^"\\]*/i)?.[0] ??
		(/weekly limit|api_error_status["']?\s*:\s*429|\b429\b.*rate|rate limit/i.test(text)
			? "You've hit your Claude Code weekly usage limit."
			: null);
	if (weekly) {
		const reset = text.match(/resets\s+[^"'\\]+/i)?.[0];
		return (
			`${weekly.replace(/\s+/g, " ").trim()}` +
			(reset ? ` (${reset.trim()})` : "") +
			" Switch Local CLI model (e.g. Sonnet) or use another provider until the quota resets."
		);
	}
	const stripped = text.replace(/^Local CLI exited [^.]+\.\s*/i, "").trim();
	// Prefer a short human sentence over a multi-KB stream-json dump in the toast.
	if (stripped.length > 280 && /"type"\s*:\s*"result"|api_error_status/i.test(stripped)) {
		return `${label} failed (API error). Check your plan / usage, or switch model in Local CLI.`;
	}
	return stripped || text;
}

function probeCliAuth(agentId: string, binPath: string): { ready: boolean; statusNote?: string } {
	if (agentId !== "claude") return { ready: true };
	try {
		const result = spawnSync(binPath, ["auth", "status", "--json"], {
			encoding: "utf8",
			timeout: 5_000,
			env: process.env,
		});
		const payload = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
		const start = payload.indexOf("{");
		const end = payload.lastIndexOf("}");
		if (start >= 0 && end > start) {
			const parsed = JSON.parse(payload.slice(start, end + 1)) as { loggedIn?: boolean };
			if (parsed.loggedIn === true) return { ready: true };
		}
	} catch {
		// Treat a broken status probe as "needs login" rather than pretending it is ready.
	}
	return { ready: false, statusNote: "needs-login" };
}

export function openLocalAgentLogin(agentId: string): void {
	const command = loginCommandForAgent(agentId);
	if (!command) {
		throw new Error(`No sign-in command for ${agentId}`);
	}
	if (process.platform === "darwin") {
		spawn(
			"osascript",
			["-e", `tell application "Terminal" to do script ${JSON.stringify(command)}`],
			{
				detached: true,
				stdio: "ignore",
			},
		).unref();
		return;
	}
	throw new Error(`Run this in a terminal: ${command}`);
}
