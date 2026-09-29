// The long-lived Claude process: one process across model steps, only new
// messages sent after the first, Stop kills it, the next step resumes.
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeAllLiveSessions } from "./claudeLiveSession";
import { buildIncrementalPrompt, LocalCliChatModel, messageFingerprint } from "./local-cli-chat-model";

const posix = process.platform !== "win32";

// Fake `claude`: logs argv + pid, then answers each stdin user message.
// Turn 1 → a tool call; later turns → a final message. "SLOW" in a message
// makes it hang (for Stop tests).
const FAKE_LIVE_CLI = `#!/usr/bin/env node
const fs = require("fs");
const log = process.env.FAKE_LIVE_LOG;
fs.appendFileSync(log, JSON.stringify({ kind: "spawn", pid: process.pid, argv: process.argv.slice(2) }) + "\\n");
let buf = "";
let turn = 0;
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    const msg = JSON.parse(line);
    const text = msg.message.content[0].text;
    fs.appendFileSync(log, JSON.stringify({ kind: "turn", pid: process.pid, text }) + "\\n");
    if (text.includes("SLOW")) { setInterval(() => {}, 1000); return; }
    turn += 1;
    const reply = turn === 1
      ? JSON.stringify({ tool_calls: [{ name: "getCurrentDocument", args: {} }] })
      : JSON.stringify({ message: "All done." });
    out({ type: "stream_event", event: { type: "message_start" } });
    out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: reply } } });
    out({ type: "result", subtype: "success", result: reply });
  }
});
`;

function readLog(file: string): Array<{ kind: string; pid: number; argv?: string[]; text?: string }> {
	if (!existsSync(file)) return [];
	return readFileSync(file, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l));
}

describe("buildIncrementalPrompt", () => {
	const tools = [{ name: "getCurrentDocument" }];
	it("sends everything first, then only what is new", () => {
		const turn1 = [new SystemMessage("doc v1"), new HumanMessage("tighten the intro")];
		const first = buildIncrementalPrompt(turn1, tools, { fingerprints: [], frameKey: "", toolsKey: "" });
		expect(first.kind).toBe("full");
		const sent = { fingerprints: turn1.map(messageFingerprint), frameKey: "", toolsKey: JSON.stringify(["getCurrentDocument"]) };
		const turn1b = [
			...turn1,
			new AIMessage({ content: "", tool_calls: [{ id: "c0", name: "getCurrentDocument", args: {} }] }),
			new ToolMessage({ content: '{"ok":true}', tool_call_id: "c0" }),
		];
		const delta = buildIncrementalPrompt(turn1b, tools, sent);
		expect(delta.kind).toBe("delta");
		if (delta.kind !== "delta") return;
		expect(delta.text).toContain('TOOL RESULT: {"ok":true}');
		expect(delta.text).not.toContain("tighten the intro");
		expect(delta.text).not.toContain("Available OpenScreen tools");
	});

	it("re-sends the project state when it changed, and detects a rewritten history", () => {
		const a = [new SystemMessage("doc v1"), new HumanMessage("one")];
		const sent = { fingerprints: a.map(messageFingerprint), frameKey: "", toolsKey: "" };
		const next = buildIncrementalPrompt(
			[new SystemMessage("doc v2"), new HumanMessage("one"), new AIMessage("ok"), new HumanMessage("two")],
			[],
			sent,
		);
		expect(next.kind).toBe("delta");
		if (next.kind === "delta") {
			expect(next.text).toContain("UPDATED OPENSCREEN PROJECT STATE");
			expect(next.text).toContain("doc v2");
			expect(next.text).toContain("USER: two");
		}
		const rewound = buildIncrementalPrompt([new SystemMessage("doc v1"), new HumanMessage("different")], [], sent);
		expect(rewound.kind).toBe("diverged");
	});
});

describe.skipIf(!posix)("long-lived Claude session", () => {
	let dir: string;
	let bin: string;
	let logFile: string;

	beforeEach(() => {
		dir = mkdtempSync(path.join(os.tmpdir(), "fake-live-cli-"));
		bin = path.join(dir, "claude");
		logFile = path.join(dir, "log.ndjson");
		writeFileSync(bin, FAKE_LIVE_CLI);
		chmodSync(bin, 0o755);
		process.env.FAKE_LIVE_LOG = logFile;
		delete process.env.OPENSCREEN_CLI_PERSISTENT;
	});

	afterEach(() => {
		closeAllLiveSessions();
		delete process.env.FAKE_LIVE_LOG;
		rmSync(dir, { recursive: true, force: true });
	});

	function model(sid: string, extra: Partial<ConstructorParameters<typeof LocalCliChatModel>[0]> = {}) {
		let started = false;
		return new LocalCliChatModel({
			agentId: "claude",
			binPath: bin,
			cliSessionId: sid,
			tools: [{ name: "getCurrentDocument", description: "Read the project" }],
			isCliSessionStarted: () => started,
			onCliSpawnComplete: () => {
				started = true;
			},
			...extra,
		});
	}

	it("keeps one process across model steps and sends only the new messages", async () => {
		const m = model("33333333-3333-3333-3333-333333333333");
		const step1 = [new SystemMessage("doc"), new HumanMessage("add a title")];
		const r1 = await m.invoke(step1);
		expect(r1.tool_calls?.[0]?.name).toBe("getCurrentDocument");
		const step2 = [
			...step1,
			r1,
			new ToolMessage({ content: '{"clips":1}', tool_call_id: r1.tool_calls![0]!.id! }),
		];
		const r2 = await m.invoke(step2);
		expect(r2.content).toBe("All done.");

		const log = readLog(logFile);
		const spawns = log.filter((e) => e.kind === "spawn");
		const turns = log.filter((e) => e.kind === "turn");
		expect(spawns).toHaveLength(1); // one process for both steps
		expect(spawns[0]!.argv).toEqual(expect.arrayContaining(["--input-format", "stream-json"]));
		expect(spawns[0]!.argv).toEqual(expect.arrayContaining(["--session-id", "33333333-3333-3333-3333-333333333333"]));
		expect(turns).toHaveLength(2);
		expect(turns[0]!.text).toContain("Available OpenScreen tools");
		expect(turns[1]!.text).toContain('TOOL RESULT: {"clips":1}');
		expect(turns[1]!.text).not.toContain("Available OpenScreen tools");
		expect(turns[1]!.text).not.toContain("add a title");
	});

	it("Stop kills the live process; the next step resumes the same Claude session", async () => {
		const sid = "44444444-4444-4444-4444-444444444444";
		const first = model(sid);
		await first.invoke([new SystemMessage("doc"), new HumanMessage("hello")]);

		const controller = new AbortController();
		const slow = model(sid, { abortSignal: controller.signal });
		const pending = slow.invoke([new SystemMessage("doc"), new HumanMessage("hello"), new AIMessage("x"), new HumanMessage("SLOW render")]);
		const deadline = Date.now() + 5_000;
		while (!readLog(logFile).some((e) => e.kind === "turn" && e.text?.includes("SLOW")) && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 20));
		}
		const livePid = readLog(logFile).find((e) => e.kind === "spawn")!.pid;
		controller.abort();
		await expect(pending).rejects.toThrow(/Agent stopped/);
		const killDeadline = Date.now() + 3_000;
		let alive = true;
		while (alive && Date.now() < killDeadline) {
			try {
				process.kill(livePid, 0);
				await new Promise((r) => setTimeout(r, 20));
			} catch {
				alive = false;
			}
		}
		expect(alive).toBe(false);

		// Session already started → the replacement process resumes it.
		let started = true;
		const again = new LocalCliChatModel({
			agentId: "claude",
			binPath: bin,
			cliSessionId: sid,
			isCliSessionStarted: () => started,
			onCliSpawnComplete: () => {
				started = true;
			},
		});
		await again.invoke([new SystemMessage("doc"), new HumanMessage("try again")]);
		const spawns = readLog(logFile).filter((e) => e.kind === "spawn");
		expect(spawns).toHaveLength(2);
		expect(spawns[1]!.argv).toEqual(expect.arrayContaining(["--resume", sid]));
		expect(spawns[1]!.argv).not.toContain("--session-id");
	});
});
