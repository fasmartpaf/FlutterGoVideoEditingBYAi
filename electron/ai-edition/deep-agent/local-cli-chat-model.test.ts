import { HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { buildPrompt, parseModelJson } from "./local-cli-chat-model";

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
	it("lists tools and the user turn", () => {
		const prompt = buildPrompt(
			[new HumanMessage("List windows I can record")],
			[{ name: "listSources", description: "List capture sources" }],
		);
		expect(prompt).toContain("listSources");
		expect(prompt).toContain("USER: List windows I can record");
		expect(prompt).toContain('"tool_calls"');
		expect(prompt).toContain("You can SEE it");
		expect(prompt).toContain("mediaContext");
		expect(prompt).toContain("visibleMedia");
		expect(prompt).toContain("ffmpeg");
		expect(prompt).toContain("addGraphic");
	});
});
