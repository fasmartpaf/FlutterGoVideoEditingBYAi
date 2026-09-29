// Contract tests for how LocalCliChatModel spawns a CLI: which flags it passes
// (permissions, session create vs resume) and that Stop kills the whole
// process tree. A tiny shell script stands in for `claude`.
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { HumanMessage } from "@langchain/core/messages";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalCliChatModel, TURN_BUDGET } from "./local-cli-chat-model";

const posix = process.platform !== "win32";

const FAKE_CLI = `#!/bin/sh
{ printf '%s\\n' "$@"; echo "---END---"; } >> "$FAKE_CLI_ARGV"
cat > /dev/null
if [ -n "$FAKE_CLI_STREAM" ]; then
  cat "$FAKE_CLI_STREAM"
  exit 0
fi
if [ -n "$FAKE_CLI_CHILD_PID" ]; then
  sleep 30 &
  echo $! > "$FAKE_CLI_CHILD_PID"
  wait
fi
echo '{"type":"result","subtype":"success","result":"{\\"message\\":\\"ok\\"}"}'
`;

function spawnArgv(file: string): string[][] {
	if (!existsSync(file)) return [];
	return readFileSync(file, "utf8")
		.split("---END---\n")
		.filter((chunk) => chunk.trim())
		.map((chunk) => chunk.split("\n").filter((line) => line.length > 0));
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

describe.skipIf(!posix)("LocalCliChatModel spawn contract", () => {
	let dir: string;
	let bin: string;
	let argvFile: string;

	beforeEach(() => {
		dir = mkdtempSync(path.join(os.tmpdir(), "fake-cli-"));
		bin = path.join(dir, "claude");
		argvFile = path.join(dir, "argv.txt");
		writeFileSync(bin, FAKE_CLI);
		chmodSync(bin, 0o755);
		process.env.FAKE_CLI_ARGV = argvFile;
		delete process.env.FAKE_CLI_CHILD_PID;
	});

	afterEach(() => {
		delete process.env.FAKE_CLI_ARGV;
		delete process.env.FAKE_CLI_CHILD_PID;
		delete process.env.FAKE_CLI_STREAM;
		rmSync(dir, { recursive: true, force: true });
	});

	it("gives the CLI no tools or folders when watch access was not granted", async () => {
		const model = new LocalCliChatModel({
			agentId: "claude",
			binPath: bin,
			mediaDirs: ["/Users/me/Movies"],
			workspaceRoot: dir,
			watchGranted: false,
		});
		await model.invoke([new HumanMessage("hi")]);
		const [argv] = spawnArgv(argvFile);
		expect(argv).toEqual(expect.arrayContaining(["--permission-mode", "dontAsk"]));
		expect(argv).not.toContain("bypassPermissions");
		expect(argv).not.toContain("--add-dir");
		expect(argv).not.toContain("Bash");
	});

	it("scopes tools to the granted folders when watch access was granted", async () => {
		const model = new LocalCliChatModel({
			agentId: "claude",
			binPath: bin,
			mediaDirs: ["/Users/me/Movies"],
			workspaceRoot: dir,
			watchGranted: true,
		});
		await model.invoke([new HumanMessage("hi")]);
		const [argv] = spawnArgv(argvFile);
		expect(argv).toEqual(expect.arrayContaining(["--add-dir", "/Users/me/Movies"]));
		expect(argv).toEqual(expect.arrayContaining(["--add-dir", dir]));
	});

	it("creates the session on the first spawn and resumes it on every later spawn", async () => {
		// Spawn-per-call path (the long-lived path has its own tests).
		process.env.OPENSCREEN_CLI_PERSISTENT = "0";
		const sid = "22222222-2222-2222-2222-222222222222";
		let started = false;
		const model = new LocalCliChatModel({
			agentId: "claude",
			binPath: bin,
			cliSessionId: sid,
			// Same wiring as service.ts: resume flag read per spawn.
			resumeCliSession: false,
			isCliSessionStarted: () => started,
			onCliSpawnComplete: () => {
				started = true;
			},
		});
		await model.invoke([new HumanMessage("first round")]);
		await model.invoke([new HumanMessage("second round, same turn")]);
		const [first, second] = spawnArgv(argvFile);
		expect(first).toEqual(expect.arrayContaining(["--session-id", sid]));
		expect(first).not.toContain("--resume");
		expect(second).toEqual(expect.arrayContaining(["--resume", sid]));
		expect(second).not.toContain("--session-id");
		delete process.env.OPENSCREEN_CLI_PERSISTENT;
	});

	it("streams the reply token by token without leaking JSON", async () => {
		const reply = JSON.stringify({ message: "Cut 2 pauses — done ✂️" });
		const lines: string[] = [
			JSON.stringify({ type: "system", subtype: "init", model: "fake" }),
			JSON.stringify({ type: "stream_event", event: { type: "message_start" } }),
		];
		for (let i = 0; i < reply.length; i += 4) {
			lines.push(
				JSON.stringify({
					type: "stream_event",
					event: { type: "content_block_delta", delta: { type: "text_delta", text: reply.slice(i, i + 4) } },
				}),
			);
		}
		lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: reply }] } }));
		lines.push(JSON.stringify({ type: "result", subtype: "success", result: reply }));
		const streamFile = path.join(dir, "stream.ndjson");
		writeFileSync(streamFile, `${lines.join("\n")}\n`);
		process.env.FAKE_CLI_STREAM = streamFile;

		const texts: string[] = [];
		const model = new LocalCliChatModel({
			agentId: "claude",
			binPath: bin,
			onProgress: (event) => {
				if (event.kind === "text") texts.push(event.delta);
			},
		});
		const result = await model.invoke([new HumanMessage("tighten it")]);
		expect(texts.length).toBeGreaterThan(3); // arrived in pieces, not one block
		expect(texts.join("")).toBe("Cut 2 pauses — done ✂️");
		expect(texts.join("")).not.toContain("{");
		expect(result.content).toBe("Cut 2 pauses — done ✂️");
	});

	it("past the hard budget, a reply that still calls tools ends the turn instead", async () => {
		const reply = JSON.stringify({ tool_calls: [{ name: "addZoom", args: { startSec: 1, endSec: 2 } }] });
		const streamFile = path.join(dir, "stream.ndjson");
		writeFileSync(streamFile, `${JSON.stringify({ type: "result", subtype: "success", result: reply })}\n`);
		process.env.FAKE_CLI_STREAM = streamFile;
		const model = new LocalCliChatModel({
			agentId: "claude",
			binPath: bin,
			turnBudget: { steps: TURN_BUDGET.hardSteps - 1, startedAt: Date.now() },
		});
		const result = await model.invoke([new HumanMessage("make it perfect")]);
		expect(result.tool_calls ?? []).toHaveLength(0);
		expect(String(result.content)).toMatch(/continue/);
		// Within budget the same reply's tool call goes through.
		const fresh = new LocalCliChatModel({ agentId: "claude", binPath: bin });
		const ok = await fresh.invoke([new HumanMessage("zoom in")]);
		expect(ok.tool_calls?.[0]?.name).toBe("addZoom");
	});

	it("Stop kills the CLI and the processes it started", async () => {
		const childPidFile = path.join(dir, "child.pid");
		process.env.FAKE_CLI_CHILD_PID = childPidFile;
		const controller = new AbortController();
		const model = new LocalCliChatModel({
			agentId: "claude",
			binPath: bin,
			abortSignal: controller.signal,
		});
		const run = model.invoke([new HumanMessage("render something long")]);
		// Wait for the fake CLI to start its long-running grandchild.
		const deadline = Date.now() + 5_000;
		while (!existsSync(childPidFile) && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		const grandchild = Number(readFileSync(childPidFile, "utf8").trim());
		expect(isAlive(grandchild)).toBe(true);

		controller.abort();
		await expect(run).rejects.toThrow(/Agent stopped/);

		const killDeadline = Date.now() + 3_000;
		while (isAlive(grandchild) && Date.now() < killDeadline) {
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		expect(isAlive(grandchild)).toBe(false);
	});
});
