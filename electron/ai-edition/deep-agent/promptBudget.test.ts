import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { PROMPT_TOO_LONG, budgetMessages, clampText, compactMessages } from "./local-cli-chat-model";

describe("prompt budget", () => {
	it("clamps oversize text keeping head and tail", () => {
		const text = `${"a".repeat(5000)}MIDDLE${"z".repeat(5000)}`;
		const out = clampText(text, 1000);
		expect(out.length).toBeLessThan(1100);
		expect(out.startsWith("aaaa")).toBe(true);
		expect(out.endsWith("zzzz")).toBe(true);
		expect(out).toContain("characters omitted");
		expect(clampText("short", 1000)).toBe("short");
	});

	it("drops the oldest turns first and never the project state or the current objective", () => {
		const big = "x".repeat(20_000);
		const messages = [
			new SystemMessage("PROJECT"),
			new HumanMessage("first ask"),
			new AIMessage(big),
			new ToolMessage({ content: big, tool_call_id: "1" }),
			new HumanMessage("second ask"),
			new AIMessage(big),
			new HumanMessage("current ask"),
			new ToolMessage({ content: big, tool_call_id: "2" }),
		];
		const { messages: kept, omitted } = budgetMessages(messages, 40_000);
		expect(omitted).toBeGreaterThan(0);
		expect(kept[0]!.content).toBe("PROJECT");
		expect(kept.some((m) => m.content === "current ask")).toBe(true);
		expect(kept.at(-1)).toBe(messages.at(-1));
		expect(kept.some((m) => m.content === "first ask")).toBe(false);
		expect(budgetMessages(messages, 10_000_000).omitted).toBe(0);
	});

	it("compacts to the current state and the current turn", () => {
		const messages = [
			new SystemMessage("OLD"),
			new HumanMessage("first"),
			new SystemMessage("PROJECT"),
			new HumanMessage("current"),
			new ToolMessage({ content: "r", tool_call_id: "1" }),
		];
		expect(compactMessages(messages).map((m) => m.content)).toEqual(["PROJECT", "current", "r"]);
	});

	it("recognises the CLI's overflow reply", () => {
		expect(PROMPT_TOO_LONG.test("Prompt is too long · the request is ~1033222 tokens (limit 1000000)")).toBe(true);
		expect(PROMPT_TOO_LONG.test('{"message":"done"}')).toBe(false);
	});
});
