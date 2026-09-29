import { afterEach, describe, expect, it } from "vitest";
import {
	AGENT_STOPPED_MESSAGE,
	beginChatRun,
	cancelChatRun,
	endChatRun,
	isAbortError,
	isChatRunActive,
	resetChatAbortRegistry,
} from "./chatAbortRegistry";

afterEach(() => {
	resetChatAbortRegistry();
});

describe("chatAbortRegistry", () => {
	it("begin + cancel aborts the signal", () => {
		const signal = beginChatRun("p1", "s1");
		expect(signal.aborted).toBe(false);
		expect(isChatRunActive("p1", "s1")).toBe(true);
		expect(cancelChatRun("p1", "s1")).toBe(true);
		expect(signal.aborted).toBe(true);
		expect(isChatRunActive("p1", "s1")).toBe(false);
		expect(cancelChatRun("p1", "s1")).toBe(false);
	});

	it("endChatRun clears only the matching signal", () => {
		const a = beginChatRun("p1", "s1");
		endChatRun("p1", "s1", a);
		expect(isChatRunActive("p1", "s1")).toBe(false);
		const b = beginChatRun("p1", "s1");
		endChatRun("p1", "s1", a);
		expect(isChatRunActive("p1", "s1")).toBe(true);
		endChatRun("p1", "s1", b);
		expect(isChatRunActive("p1", "s1")).toBe(false);
	});

	it("recognises abort-shaped errors", () => {
		expect(isAbortError(Object.assign(new Error("x"), { name: "AbortError" }))).toBe(true);
		expect(isAbortError(new Error(AGENT_STOPPED_MESSAGE))).toBe(true);
		expect(isAbortError(new Error("network down"))).toBe(false);
	});
});
