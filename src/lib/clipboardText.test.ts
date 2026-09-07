// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeClipboardText } from "./clipboardText";

afterEach(() => {
	(window as unknown as { electronAPI?: unknown }).electronAPI = undefined;
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("writeClipboardText", () => {
	it("uses the Electron clipboard when the preload exposes it", async () => {
		const writeClipboardTextIpc = vi.fn().mockResolvedValue(undefined);
		(
			window as unknown as { electronAPI: { writeClipboardText: typeof writeClipboardTextIpc } }
		).electronAPI = { writeClipboardText: writeClipboardTextIpc };
		await writeClipboardText("hello from chat");
		expect(writeClipboardTextIpc).toHaveBeenCalledWith("hello from chat");
	});

	it("falls back to execCommand when the Clipboard API rejects", async () => {
		vi.stubGlobal("navigator", {
			clipboard: { writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")) },
		});
		const exec = vi.fn().mockReturnValue(true);
		Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
		await writeClipboardText("fallback");
		expect(exec).toHaveBeenCalledWith("copy");
	});
});
