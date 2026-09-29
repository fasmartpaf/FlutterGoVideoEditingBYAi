import { afterEach, describe, expect, it, vi } from "vitest";
import { executeAgentTool } from "../../../electron/ai-edition/agent-tools";
import { createEmptyDocument } from "@/lib/ai-edition/schema";
import {
	ATTACHMENT_HEADER,
	attachmentKind,
	composeMessageWithAttachments,
	parseMessageAttachments,
	resolveAttachment,
} from "./chatAttachments";

describe("chat attachments", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("knows images, clips, audio and other files", () => {
		expect(attachmentKind("logo.PNG")).toBe("image");
		expect(attachmentKind("", "image/png")).toBe("image");
		expect(attachmentKind("take.mov")).toBe("video");
		expect(attachmentKind("music.mp3")).toBe("audio");
		expect(attachmentKind("brief.pdf")).toBe("file");
	});

	it("sends the paths after the words and reads them back for display", () => {
		const atts = [
			{ id: "a", name: "logo.png", path: "/Users/me/logo.png", kind: "image" as const },
			{ id: "b", name: "song.mp3", path: "/Users/me/My Music/song.mp3", kind: "audio" as const },
		];
		const msg = composeMessageWithAttachments("  use my logo  ", atts);
		expect(msg).toBe(`use my logo\n\n${ATTACHMENT_HEADER}\n- image: /Users/me/logo.png\n- audio: /Users/me/My Music/song.mp3`);
		const back = parseMessageAttachments(msg);
		expect(back.text).toBe("use my logo");
		expect(back.attachments.map((a) => [a.kind, a.name, a.path])).toEqual([
			["image", "logo.png", "/Users/me/logo.png"],
			["audio", "song.mp3", "/Users/me/My Music/song.mp3"],
		]);
		expect(composeMessageWithAttachments("hi", [])).toBe("hi");
		expect(composeMessageWithAttachments("", atts.slice(0, 1))).toContain("Here are the files I attached.");
		expect(parseMessageAttachments("plain words")).toEqual({ text: "plain words", attachments: [] });
	});

	it("uses a dropped file's own path, and saves a pasted image first", async () => {
		const saveChatAttachment = vi.fn(async () => ({ success: true, path: "/tmp/chat-attachments/pasted.png" }));
		vi.stubGlobal("window", {
			electronAPI: {
				getPathForFile: (f: File) => (f.name === "logo.png" ? "/Users/me/logo.png" : ""),
				saveChatAttachment,
			},
		});
		const dropped = await resolveAttachment(new File(["x"], "logo.png", { type: "image/png" }));
		expect(dropped).toMatchObject({ path: "/Users/me/logo.png", kind: "image", name: "logo.png" });
		expect(saveChatAttachment).not.toHaveBeenCalled();
		const pasted = await resolveAttachment(new File(["x"], "", { type: "image/png" }));
		expect(pasted).toMatchObject({ path: "/tmp/chat-attachments/pasted.png", kind: "image", name: "pasted-image.png" });
		expect(saveChatAttachment).toHaveBeenCalledWith(expect.any(ArrayBuffer), "pasted-image.png");
	});

	it("explains when a pasted file cannot be saved", async () => {
		vi.stubGlobal("window", { electronAPI: { getPathForFile: () => "", saveChatAttachment: async () => ({ success: false, message: "File too large" }) } });
		await expect(resolveAttachment(new File(["x"], "big.mov"))).rejects.toThrow("File too large");
	});
});

describe("exporting is the user's call", () => {
	it("the agent's exportProject only returns a reminder to press Export", () => {
		const doc = createEmptyDocument({ title: "t", projectId: "p", createdAt: "2026-01-01T00:00:00.000Z" });
		const r = executeAgentTool(doc, "exportProject", JSON.stringify({}));
		expect(r.ok).toBe(false);
		expect(r.resultJson).toContain("Export button");
	});
});
