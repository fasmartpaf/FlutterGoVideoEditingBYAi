import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { buildPrompt, consumeClaudeStreamJsonLine, parseModelJson } from "./local-cli-chat-model";

describe("parseModelJson", () => {
	it("reads a tool call object, even with chatter around it", () => {
		const parsed = parseModelJson('Sure.\n{"tool_calls":[{"name":"listSources","args":{}}]}\n');
		expect(parsed.tool_calls?.[0]?.name).toBe("listSources");
	});

	it("reads a final message", () => {
		expect(parseModelJson('{"message":"Recorded FlutterGo.AI."}')).toEqual({
			message: "Recorded FlutterGo.AI.",
		});
	});

	it("falls back to the raw text when the model did not emit JSON", () => {
		expect(parseModelJson("hello there")).toEqual({ message: "hello there" });
	});
});

describe("buildPrompt", () => {
	it("lists tools and the user turn as an autonomous agent", () => {
		const prompt = buildPrompt(
			[new HumanMessage("List windows I can record")],
			[{ name: "listSources", description: "List capture sources" }],
		);
		expect(prompt).toContain("listSources");
		expect(prompt).toContain("USER: List windows I can record");
		expect(prompt).toContain('"tool_calls"');
		expect(prompt).toContain("mediaCapabilities");
		expect(prompt).toContain("visualFrames");
		expect(prompt).toContain("autonomous");
		expect(prompt).toContain("mediaContext");
		expect(prompt).toContain("visibleMedia");
		expect(prompt).toMatch(/UNDERSTAND → EXPLORE → PLAN → ACT/i);
		expect(prompt).toMatch(/rewind/i);
		expect(prompt).not.toContain("CRITICAL");
		expect(prompt).toMatch(/Do NOT collapse a broad ask into a fixed helper recipe/i);
		expect(prompt).toMatch(/outcome-oriented/i);
	});

	it("after tool results, continues the loop until the objective is verified", () => {
		const prompt = buildPrompt(
			[
				new HumanMessage("add thumbnail"),
				new ToolMessage({
					content: JSON.stringify({ ok: true, summary: "added intro" }),
					tool_call_id: "call_0",
				}),
			],
			[{ name: "addGraphic", description: "Add graphic" }],
		);
		expect(prompt).toMatch(/Continue the loop/i);
		expect(prompt).toMatch(/Do NOT retry the same failing tool/i);
		expect(prompt).not.toMatch(/^STOP:/m);
	});

	it("lists sampled frame paths for Local CLI", () => {
		const prompt = buildPrompt([new HumanMessage("Add a title")], [], {
			framePaths: ["/tmp/frames/f0.jpg", "/tmp/frames/f1.jpg"],
		});
		expect(prompt).toContain("OPENSCREEN SAMPLED FRAMES");
		expect(prompt).toContain("/tmp/frames/f0.jpg");
	});

	it("does not force a fixed graphics recipe for motion asks", () => {
		const prompt = buildPrompt(
			[new HumanMessage("kindly edit this video and add motion graphics into it")],
			[{ name: "addGraphic", description: "Place a graphic" }],
		);
		expect(prompt).not.toContain("CRITICAL");
		expect(prompt).not.toMatch(/MUST call createMotionGraphicPreview/i);
		expect(prompt).not.toMatch(/MUST call addBeatGraphics/i);
		expect(prompt).toMatch(/Do NOT collapse a broad ask into a fixed helper recipe/i);
	});
});

describe("consumeClaudeStreamJsonLine", () => {
	it("emits init progress and assistant text deltas", () => {
		const state = { assistantText: "", result: null as string | null };
		expect(consumeClaudeStreamJsonLine('{"type":"system","subtype":"init"}', state)).toEqual([
			{ kind: "progress", delta: "Local CLI started…\n" },
		]);
		expect(
			consumeClaudeStreamJsonLine(
				'{"type":"system","subtype":"init","model":"claude-fable-5"}',
				state,
			),
		).toEqual([{ kind: "progress", delta: "Local CLI started (claude-fable-5)…\n" }]);
		const deltas = consumeClaudeStreamJsonLine(
			JSON.stringify({
				type: "assistant",
				message: { content: [{ type: "text", text: "Hello" }] },
			}),
			state,
		);
		expect(deltas).toEqual([{ kind: "text", delta: "Hello" }]);
		expect(state.assistantText).toBe("Hello");
	});

	it("does not double text when content_block_delta and assistant snapshots both arrive", () => {
		const state = { assistantText: "", result: null as string | null };
		expect(
			consumeClaudeStreamJsonLine(
				JSON.stringify({
					type: "content_block_delta",
					delta: { type: "text_delta", text: "No text rendering" },
				}),
				state,
			),
		).toEqual([{ kind: "text", delta: "No text rendering" }]);
		expect(
			consumeClaudeStreamJsonLine(
				JSON.stringify({
					type: "assistant",
					message: { content: [{ type: "text", text: "No text rendering in ffmpeg" }] },
				}),
				state,
			),
		).toEqual([]);
		expect(state.assistantText).toBe("No text rendering in ffmpeg");
	});

	it("captures the final result string", () => {
		const state = { assistantText: "", result: null as string | null };
		consumeClaudeStreamJsonLine(
			JSON.stringify({ type: "result", subtype: "success", result: '{"message":"ok"}' }),
			state,
		);
		expect(state.result).toBe('{"message":"ok"}');
	});

	it("flags Claude API errors on result events (e.g. weekly limit 429)", () => {
		const state = { assistantText: "", result: null as string | null, apiError: null as string | null };
		consumeClaudeStreamJsonLine(
			JSON.stringify({
				type: "result",
				subtype: "success",
				api_error_status: 429,
				result: "You've hit your weekly limit · resets Sep 30 at 11pm (Asia/Karachi)",
			}),
			state,
		);
		expect(state.apiError).toMatch(/weekly limit/i);
	});
});
