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
		const sent = {
			fingerprints: turn1.map(messageFingerprint),
			frameKey: "",
			toolsKey: JSON.stringify(["getCurrentDocument"]),
			humanKeys: ["tighten the intro"],
		};
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
		const sent = { fingerprints: a.map(messageFingerprint), frameKey: "", toolsKey: "", humanKeys: ["one"] };
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
		const rewound = buildIncrementalPrompt(
			[new SystemMessage("doc v1"), new HumanMessage("different")],
			[],
			sent,
		);
		expect(rewound.kind).toBe("diverged");
	});

	it("a changed project is sent as just the parts that changed", () => {
		const policy = "You are the editor. Long instructions...\nOPEN PROJECT:";
		const v1 = `${policy}\n${JSON.stringify({ clips: [{ id: "c1" }], zooms: [], mediaContext: "long outline" })}`;
		const v2 = `${policy}\n${JSON.stringify({ clips: [{ id: "c1" }], zooms: [{ id: "z1" }], mediaContext: "long outline" })}`;
		const sent = { fingerprints: [messageFingerprint(new SystemMessage(v1)), messageFingerprint(new HumanMessage("add a zoom"))], frameKey: "", toolsKey: "", humanKeys: ["add a zoom"], systemText: v1 };
		const next = buildIncrementalPrompt([new SystemMessage(v2), new HumanMessage("add a zoom"), new HumanMessage("and captions")], [], sent);
		expect(next.kind).toBe("delta");
		if (next.kind !== "delta") return;
		expect(next.text).toContain('PROJECT STATE UPDATE');
		expect(next.text).toContain('{"zooms":[{"id":"z1"}]}');
		expect(next.text).not.toContain("Long instructions");
		expect(next.text).not.toContain("long outline");
		// Without the earlier text to compare with, the whole message goes (as before).
		const full = buildIncrementalPrompt([new SystemMessage(v2), new HumanMessage("add a zoom"), new HumanMessage("x")], [], { ...sent, systemText: undefined });
		if (full.kind === "delta") expect(full.text).toContain("Long instructions");
	});

	it("keeps the same Claude across turns: last turn's replies and tool calls are not compared", () => {
		// Turn 1 as the live process saw it: the ask, its tool call, the result, its reply.
		const turn1 = [
			new SystemMessage("doc v1"),
			new HumanMessage("add a zoom at the start"),
			new AIMessage({ content: "", tool_calls: [{ id: "c0", name: "addZoom", args: {} }] }),
			new ToolMessage({ content: '{"ok":true}', tool_call_id: "c0" }),
			new AIMessage('{"message":"Added a zoom."}'),
		];
		const first = buildIncrementalPrompt(turn1, [], { fingerprints: [], frameKey: "", toolsKey: "" });
		if (first.kind === "diverged") throw new Error("unexpected");
		// Turn 2 as the chat history rebuilds it: only the final reply text survives.
		const turn2 = [
			new SystemMessage("doc v2"),
			new HumanMessage("add a zoom at the start"),
			new AIMessage("Added a zoom."),
			new HumanMessage("now make the intro amazing"),
		];
		const next = buildIncrementalPrompt(turn2, [], { fingerprints: first.fingerprints, frameKey: "", toolsKey: "", humanKeys: first.humanKeys });
		expect(next.kind).toBe("delta");
		if (next.kind !== "delta") return;
		expect(next.text).toContain("USER: now make the intro amazing");
		expect(next.text).not.toContain("USER: add a zoom");
		expect(next.text).not.toContain("TOOL RESULT");
	});

	it("a short message with project memory appended is still the same message next turn", () => {
		const sent = { fingerprints: ["x"], frameKey: "", toolsKey: "", humanKeys: ["add zoom\n\nPROJECT MEMORY — earlier turns"] };
		const next = buildIncrementalPrompt([new HumanMessage("add zoom"), new AIMessage("done"), new HumanMessage("now captions")], [], sent);
		expect(next.kind).toBe("delta");
		const other = buildIncrementalPrompt([new HumanMessage("add blur"), new HumanMessage("now captions")], [], sent);
		expect(other.kind).toBe("diverged");
	});

	it("a user message with context appended on one side still counts as the same message", () => {
		const long = "make the intro amazing and show some saas type things on it, not just a simple text card";
		const sent = { fingerprints: ["x"], frameKey: "", toolsKey: "", humanKeys: [long] };
		const next = buildIncrementalPrompt(
			[new HumanMessage(`${long}\n\n[frames attached: 4]`), new HumanMessage("thanks, now export it")],
			[],
			sent,
		);
		expect(next.kind).toBe("delta");
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

	it("the next chat turn talks to the same Claude process (no restart)", async () => {
		const sid = "66666666-6666-6666-6666-666666666666";
		let started = false;
		const shared = { isCliSessionStarted: () => started, onCliSpawnComplete: () => { started = true; } };
		const turn1 = [new SystemMessage("doc v1"), new HumanMessage("add a title")];
		const r1 = await model(sid, shared).invoke(turn1);
		const r2 = await model(sid, shared).invoke([
			...turn1,
			r1,
			new ToolMessage({ content: '{"clips":1}', tool_call_id: r1.tool_calls![0]!.id! }),
		]);
		expect(r2.content).toBe("All done.");
		// Turn 2: a new model (new chat turn); history keeps only the final reply.
		const r3 = await model(sid, shared).invoke([
			new SystemMessage("doc v2"),
			new HumanMessage("add a title"),
			new AIMessage("All done."),
			new HumanMessage("now add an outro"),
		]);
		expect(r3.content).toBe("All done.");
		const log = readLog(logFile);
		expect(log.filter((e) => e.kind === "spawn")).toHaveLength(1);
		const last = log.filter((e) => e.kind === "turn").at(-1)!;
		expect(last.text).toContain("USER: now add an outro");
		expect(last.text).not.toContain("add a title");
	});

	it("switching model for a stage resumes the same Claude session and sends only the new message", async () => {
		const sid = "88888888-8888-8888-8888-888888888888";
		let started = false;
		const shared = { isCliSessionStarted: () => started, onCliSpawnComplete: () => { started = true; } };
		const turn1 = [new SystemMessage("doc"), new HumanMessage("plan the edit")];
		const r1 = await model(sid, { ...shared, cliModel: "opus" }).invoke(turn1);
		await model(sid, { ...shared, cliModel: "opus" }).invoke([...turn1, r1, new ToolMessage({ content: "{}", tool_call_id: r1.tool_calls![0]!.id! })]);
		// Next stage on Sonnet: a new process, resuming the same session.
		await model(sid, { ...shared, cliModel: "sonnet" }).invoke([
			new SystemMessage("doc"),
			new HumanMessage("plan the edit"),
			new AIMessage("Plan ready."),
			new HumanMessage("now apply the cuts"),
		]);
		const log = readLog(logFile);
		const spawns = log.filter((e) => e.kind === "spawn");
		expect(spawns).toHaveLength(2);
		expect(spawns[1]!.argv).toContain("--resume");
		expect(spawns[1]!.argv).toContain("sonnet");
		const last = log.filter((e) => e.kind === "turn").at(-1)!;
		expect(last.text).toContain("USER: now apply the cuts");
		expect(last.text).not.toContain("plan the edit");
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

describe.skipIf(!posix)("live session failure", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(path.join(os.tmpdir(), "fake-live-fail-"));
		delete process.env.OPENSCREEN_CLI_PERSISTENT;
	});
	afterEach(async () => {
		closeAllLiveSessions();
		const { resetLiveClaudeSessionsForTests } = await import("./local-cli-chat-model");
		resetLiveClaudeSessionsForTests();
		rmSync(dir, { recursive: true, force: true });
	});

	it("one failed live step retries on a fresh process and keeps live mode on", async () => {
		// The first live process crashes on its first message; the next one works.
		const flag = path.join(dir, "crashed-once");
		const bin = path.join(dir, "claude");
		writeFileSync(
			bin,
			`#!/usr/bin/env node
const fs = require("fs");
const live = process.argv.includes("--input-format");
if (!live) { process.stdout.write(JSON.stringify({ type: "result", subtype: "success", result: JSON.stringify({ message: "one-shot" }) }) + "\\n"); process.exit(0); }
process.stdin.on("data", () => {
  if (!fs.existsSync(${JSON.stringify(flag)})) { fs.writeFileSync(${JSON.stringify(flag)}, "1"); process.exit(3); }
  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", result: JSON.stringify({ message: "live again" }) }) + "\\n");
});
`,
		);
		chmodSync(bin, 0o755);
		const warn = console.warn;
		console.warn = () => {};
		try {
			const { liveClaudeSessionsDisabledReason } = await import("./local-cli-chat-model");
			const m = new LocalCliChatModel({ agentId: "claude", binPath: bin, cliSessionId: "77777777-7777-7777-7777-777777777777" });
			const r = await m.invoke([new HumanMessage("hi")]);
			expect(r.content).toBe("live again");
			expect(liveClaudeSessionsDisabledReason()).toBeNull();
		} finally {
			console.warn = warn;
		}
	});

	it("shows the CLI's own error and falls back to one-shot spawns", async () => {
		// Live mode (stream-json input) answers with an error result; one-shot mode works.
		const bin = path.join(dir, "claude");
		writeFileSync(
			bin,
			`#!/usr/bin/env node
const live = process.argv.includes("--input-format");
if (live) {
  process.stdin.on("data", () => {
    process.stdout.write(JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["boom: bad flag"] }) + "\\n");
  });
} else {
  let buf = ""; process.stdin.on("data", (d) => (buf += d));
  process.stdin.on("end", () => {
    process.stdout.write(JSON.stringify({ type: "result", subtype: "success", result: JSON.stringify({ message: "Hi from one-shot" }) }) + "\\n");
  });
}
`,
		);
		chmodSync(bin, 0o755);
		const progress: string[] = [];
		const warn = console.warn;
		const warnings: string[] = [];
		console.warn = (...a: unknown[]) => warnings.push(a.map(String).join(" "));
		try {
			const m = new LocalCliChatModel({
				agentId: "claude",
				binPath: bin,
				cliSessionId: "55555555-5555-5555-5555-555555555555",
				onProgress: (e) => progress.push(e.delta),
			});
			const r = await m.invoke([new HumanMessage("hi")]);
			expect(r.content).toBe("Hi from one-shot");
			expect(warnings.join("\n")).toContain("boom: bad flag");
			expect(progress.join("")).toContain("one-shot mode");
		} finally {
			console.warn = warn;
		}
	});
});
