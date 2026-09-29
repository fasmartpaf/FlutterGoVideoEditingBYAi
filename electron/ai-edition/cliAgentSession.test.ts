import { describe, expect, it, beforeEach } from "vitest";
import {
	clearCliAgentSession,
	getOrCreateCliAgentSession,
	markCliAgentSessionStarted,
	resetCliAgentSessionsForTests,
	resolveCliWorkspaceRoot,
} from "./cliAgentSession";

describe("cliAgentSession", () => {
	beforeEach(() => {
		resetCliAgentSessionsForTests();
	});

	it("reuses the same cliSessionId across getOrCreate calls", () => {
		const a = getOrCreateCliAgentSession("proj_1", "sess_1", "/tmp/ws");
		const b = getOrCreateCliAgentSession("proj_1", "sess_1");
		expect(a.cliSessionId).toBe(b.cliSessionId);
		expect(a.started).toBe(false);
		markCliAgentSessionStarted("proj_1", "sess_1");
		const c = getOrCreateCliAgentSession("proj_1", "sess_1");
		expect(c.started).toBe(true);
		expect(c.turnCount).toBe(1);
	});

	it("isolates sessions by project and chat id", () => {
		const a = getOrCreateCliAgentSession("proj_1", "sess_1");
		const b = getOrCreateCliAgentSession("proj_1", "sess_2");
		expect(a.cliSessionId).not.toBe(b.cliSessionId);
		clearCliAgentSession("proj_1", "sess_1");
		const c = getOrCreateCliAgentSession("proj_1", "sess_1");
		expect(c.cliSessionId).not.toBe(a.cliSessionId);
	});

	it("resolveCliWorkspaceRoot prefers openscreen root above recordings/", () => {
		expect(
			resolveCliWorkspaceRoot([
				"/Users/me/Library/Application Support/openscreen/recordings",
			]),
		).toBe("/Users/me/Library/Application Support/openscreen");
		expect(resolveCliWorkspaceRoot(["/tmp/only"])).toBe("/tmp/only");
		expect(resolveCliWorkspaceRoot([])).toBeNull();
	});
});
