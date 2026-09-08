import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	cliPathFromBaseUrl,
	formatLocalCliError,
	isHttpLocalCli,
	localCliPromptOnStdin,
	localCliSpawnEnv,
	loginCommandForAgent,
	mediaDirsFromDocument,
	printArgvForAgent,
	selectionForAgent,
	shouldGrantLocalWatch,
	whichOnPath,
} from "./local-agents";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("whichOnPath", () => {
	it("finds an executable on a fake PATH", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "os-local-cli-"));
		tempDirs.push(dir);
		const bin = path.join(dir, "claude");
		fs.writeFileSync(bin, "#!/bin/sh\necho ok\n", { mode: 0o755 });
		expect(whichOnPath("claude", dir)).toBe(bin);
		expect(whichOnPath("missing-agent-xyz", dir)).toBeNull();
	});
});

describe("selectionForAgent", () => {
	it("stores an HTTP server as an OpenAI-compatible base URL", () => {
		expect(
			selectionForAgent({
				id: "ollama",
				name: "Ollama",
				kind: "http",
				baseUrl: "http://127.0.0.1:11434/v1",
				models: ["llama3.2"],
				ready: true,
			}),
		).toEqual({
			provider: "local-cli",
			model: "llama3.2",
			baseUrl: "http://127.0.0.1:11434/v1",
		});
	});

	it("stores a CLI binary as cli:<path>", () => {
		expect(
			selectionForAgent({
				id: "claude",
				name: "Claude Code",
				kind: "cli",
				path: "/opt/homebrew/bin/claude",
				ready: true,
			}),
		).toEqual({
			provider: "local-cli",
			model: "claude",
			baseUrl: "cli:/opt/homebrew/bin/claude",
		});
	});
});

describe("local CLI helpers", () => {
	it("prints agent-specific argv", () => {
		expect(printArgvForAgent("codex", "hi")).toEqual(["exec", "--skip-git-repo-check", "hi"]);
		expect(printArgvForAgent("cursor", "hi")).toEqual(["-p", "--trust", "hi"]);
		expect(localCliPromptOnStdin("claude")).toBe(true);
		expect(printArgvForAgent("claude", "hi")).toEqual([
			"-p",
			"--output-format",
			"text",
			"--no-session-persistence",
			"--setting-sources",
			"user",
			"--permission-mode",
			"dontAsk",
			"--tools",
			"",
		]);
		expect(printArgvForAgent("claude", "hi", { addDirs: ["/Users/me/Movies/V Recorder"] })).toEqual(
			[
				"-p",
				"--output-format",
				"text",
				"--no-session-persistence",
				"--setting-sources",
				"user",
				"--permission-mode",
				"bypassPermissions",
				"--tools",
				"Read",
				"Bash",
				"--allowedTools",
				"Read",
				"Bash",
				"--add-dir",
				"/Users/me/Movies/V Recorder",
				"--add-dir",
				os.tmpdir(),
			],
		);
	});

	it("grants watch access only when the user asked or always-allowed", () => {
		expect(shouldGrantLocalWatch("ask", false)).toBe(false);
		expect(shouldGrantLocalWatch("ask", true)).toBe(true);
		expect(shouldGrantLocalWatch("always", false)).toBe(true);
		expect(shouldGrantLocalWatch("never", true)).toBe(false);
		expect(shouldGrantLocalWatch(undefined, false)).toBe(false);
	});

	it("puts Homebrew bins on PATH so Claude can find ffmpeg", () => {
		const env = localCliSpawnEnv({ PATH: "/usr/bin" });
		expect(env.PATH).toContain("/usr/bin");
		expect(env.PATH).toMatch(/homebrew\/bin/);
	});

	it("collects parent folders of recordings so the local agent can watch them", () => {
		expect(
			mediaDirsFromDocument({
				assets: [
					{ kind: "video", originalPath: "/Users/me/Movies/V Recorder/clip.mp4" },
					{ kind: "audio", originalPath: "/Users/me/Music/bed.mp3" },
					{ kind: "video", originalPath: "https://cdn.example/clip.mp4" },
				],
			}),
		).toEqual(["/Users/me/Movies/V Recorder"]);
	});

	it("recognizes stored CLI and HTTP base URLs", () => {
		expect(isHttpLocalCli("http://127.0.0.1:11434/v1")).toBe(true);
		expect(isHttpLocalCli("cli:/usr/bin/claude")).toBe(false);
		expect(cliPathFromBaseUrl("cli:/usr/bin/claude")).toBe("/usr/bin/claude");
	});

	it("turns a Claude login failure into a short instruction", () => {
		expect(loginCommandForAgent("claude")).toBe("claude auth login");
		expect(
			formatLocalCliError("Local CLI exited 1 (claude). Not logged in · Please run /login"),
		).toMatch(/claude auth login/);
		expect(formatLocalCliError("needs-login")).toMatch(/claude auth login/);
	});

	it("turns a Local CLI timeout into a retry hint", () => {
		expect(formatLocalCliError("Local CLI timed out (/Users/me/.local/bin/claude)")).toMatch(
			/watching to Never/i,
		);
	});
});
