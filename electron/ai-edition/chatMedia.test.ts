import { describe, expect, it } from "vitest";
import { extractChatMediaFromText, extractChatMediaFromToolResult } from "./chatMedia";

describe("extractChatMediaFromToolResult", () => {
	it("collects exportedPaths images and videos", () => {
		const media = extractChatMediaFromToolResult(
			JSON.stringify({
				exportedPaths: ["/tmp/a.png", "/tmp/b.mp4", "/tmp/skip.txt"],
			}),
		);
		expect(media).toHaveLength(2);
		expect(media[0]?.kind).toBe("image");
		expect(media[1]?.kind).toBe("video");
	});

	it("dedupes paths across calls", () => {
		const first = extractChatMediaFromToolResult(
			JSON.stringify({ exportedPaths: ["/tmp/a.png"] }),
		);
		const second = extractChatMediaFromToolResult(
			JSON.stringify({ imagePath: "/tmp/a.png", videoPath: "/tmp/c.webm" }),
			first,
		);
		expect(second).toHaveLength(2);
		expect(second.map((m) => m.path)).toEqual(["/tmp/a.png", "/tmp/c.webm"]);
	});
});

describe("extractChatMediaFromText", () => {
	it("collects absolute media paths from free-form text", () => {
		const media = extractChatMediaFromText(
			"Rendered to /tmp/out/motion.mp4 and also /tmp/out/still.png for review.",
		);
		expect(media.map((m) => m.kind)).toEqual(["video", "image"]);
		expect(media[0]?.path).toBe("/tmp/out/motion.mp4");
	});
});
