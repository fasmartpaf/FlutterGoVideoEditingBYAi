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
	ready: boolean;
	/** Machine status for the picker, e.g. `needs-login`. */
	statusNote?: string;
}

export interface LocalAgentSelection {
	provider: "local-cli";
	model: string;
	baseUrl?: string;
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
		found.push({
			id: spec.id,
			name: spec.name,
			kind: "cli",
			path: binPath,
			version: readVersion(binPath, spec.versionArgs),
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
	options?: { addDirs?: string[] },
): string[] {
	if (agentId === "codex") return ["exec", "--skip-git-repo-check", prompt];
	if (agentId === "gemini") return ["-p", prompt];
	// Cursor Agent refuses a temp cwd until the workspace is trusted. This
	// spawn is headless (no TTY), so `--trust` is the non-interactive grant
	// the CLI itself tells you to pass.
	if (agentId === "cursor") return ["-p", "--trust", prompt];
	if (agentId === "claude") {
		// Print mode: OpenScreen JSON tools stay in the prompt (stdin). When a
		// recording is open, grant Read on that folder so Claude can watch it.
		const argv = [
			"-p",
			"--output-format",
			"text",
			"--no-session-persistence",
			"--setting-sources",
			"user",
		];
		const dirs = (options?.addDirs ?? []).filter(Boolean);
		if (dirs.length > 0) {
			// dontAsk auto-denies Bash unless the command is exactly `ffmpeg …`.
			// Claude often wraps that (`mkdir` then ffmpeg, or `cd && ffmpeg`) and
			// then reports it cannot watch. bypassPermissions + Read/Bash, scoped
			// to the recording folders + temp dir, is what actually lets it see.
			argv.push("--permission-mode", "bypassPermissions");
			argv.push("--tools", "Read", "Bash");
			argv.push("--allowedTools", "Read", "Bash");
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
	return null;
}

export function formatLocalCliError(raw: string): string {
	const text = raw.replace(/\s+/g, " ").trim();
	if (
		text === "needs-login" ||
		/not logged in|please run \/login|loggedIn["']?\s*:\s*false/i.test(text)
	) {
		return "Claude Code is not signed in. Run `claude auth login` in Terminal, then Rescan PATH.";
	}
	if (/timed out/i.test(text)) {
		return (
			"Claude Code timed out while answering. Watching the recording (ffmpeg stills) " +
			"plus the first reply can take several minutes. Retry the send, or set watching to " +
			"Never for a faster metadata-only reply."
		);
	}
	const stripped = text.replace(/^Local CLI exited [^.]+\.\s*/i, "").trim();
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
