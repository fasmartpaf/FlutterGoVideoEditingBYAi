import { describe, expect, it } from "vitest";
import { decodePartialJsonString, PREPARING_EDITS_LINE, ReplyStreamer } from "./replyStreamer";

function feed(streamer: ReplyStreamer, chunks: string[]) {
	const text: string[] = [];
	const thinking: string[] = [];
	for (const chunk of chunks) {
		for (const out of streamer.push(chunk)) {
			(out.kind === "text" ? text : thinking).push(out.delta);
		}
	}
	return { text: text.join(""), thinking: thinking.join("") };
}

/** Split a string into tiny chunks the way token streaming delivers it. */
function tokens(s: string, size = 3): string[] {
	const out: string[] = [];
	for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
	return out;
}

describe("decodePartialJsonString", () => {
	it("decodes escapes and stops at the closing quote", () => {
		expect(decodePartialJsonString('a\\nb \\"q\\" \\u00e9"rest')).toEqual({
			text: 'a\nb "q" é',
			closed: true,
		});
	});

	it("waits on an escape that is cut off", () => {
		expect(decodePartialJsonString("abc\\")).toEqual({ text: "abc", closed: false });
		expect(decodePartialJsonString("abc\\u00")).toEqual({ text: "abc", closed: false });
	});

	it("joins surrogate pairs (emoji) only once both halves arrived", () => {
		expect(decodePartialJsonString("hi \\ud83c").text).toBe("hi ");
		expect(decodePartialJsonString("hi \\ud83c\\udfac").text).toBe("hi 🎬");
	});
});

describe("ReplyStreamer", () => {
	it("types out only the message of a JSON reply, token by token", () => {
		const s = new ReplyStreamer();
		const reply = JSON.stringify({ message: 'Trimmed 3 pauses and added a "Welcome" title.' });
		const { text, thinking } = feed(s, tokens(reply));
		expect(text).toBe('Trimmed 3 pauses and added a "Welcome" title.');
		expect(thinking).toBe("");
		expect(text).not.toContain("{");
	});

	it("never shows tool_calls JSON, and announces edits once", () => {
		const s = new ReplyStreamer();
		const reply = JSON.stringify({
			tool_calls: [{ name: "addGraphic", args: { kind: "title", message: "inside args" } }],
		});
		const { text, thinking } = feed(s, tokens(reply, 2));
		expect(text).toBe("");
		expect(thinking).toBe(PREPARING_EDITS_LINE);
	});

	it("passes prose through unchanged", () => {
		const s = new ReplyStreamer();
		expect(feed(s, ["Hi! ", "I can cut, ", "zoom and caption."]).text).toBe(
			"Hi! I can cut, zoom and caption.",
		);
	});

	it("starts fresh on each new assistant message", () => {
		const s = new ReplyStreamer();
		feed(s, tokens(JSON.stringify({ tool_calls: [{ name: "getTranscript", args: {} }] })));
		s.reset();
		expect(feed(s, tokens(JSON.stringify({ message: "Done." }))).text).toBe("Done.");
	});

	it("handles a fenced ```json reply", () => {
		const s = new ReplyStreamer();
		const out = feed(s, tokens('```json\n{"message":"Fenced ok"}\n```'));
		expect(out.text).toBe("Fenced ok");
	});
});
