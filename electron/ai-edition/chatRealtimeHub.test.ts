import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
	broadcastChatRealtimeEvent,
	getChatRealtimeEndpoint,
	startChatRealtimeHub,
	stopChatRealtimeHub,
} from "./chatRealtimeHub";

describe("chatRealtimeHub", () => {
	afterEach(async () => {
		await stopChatRealtimeHub();
	});

	it("accepts an authorized client and broadcasts chat events", async () => {
		const endpoint = await startChatRealtimeHub();
		expect(endpoint.port).toBeGreaterThan(0);
		expect(getChatRealtimeEndpoint()?.token).toBe(endpoint.token);

		const messages: unknown[] = [];
		await new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(`${endpoint.url}?token=${endpoint.token}`);
			const timer = setTimeout(() => {
				ws.close();
				reject(new Error("timed out waiting for broadcast"));
			}, 5_000);
			ws.on("message", (data) => {
				messages.push(JSON.parse(String(data)));
				if (messages.length >= 2) {
					clearTimeout(timer);
					ws.close();
					resolve();
				}
			});
			ws.on("open", () => {
				broadcastChatRealtimeEvent({
					kind: "thinking",
					sessionId: "s1",
					delta: "Working…\n",
				});
			});
			ws.on("error", reject);
		});

		expect(messages[0]).toMatchObject({ kind: "status", phase: "connected" });
		expect(messages[1]).toMatchObject({
			kind: "thinking",
			sessionId: "s1",
			delta: "Working…\n",
		});
	});

	it("rejects clients without the token and never sends them chat events", async () => {
		const endpoint = await startChatRealtimeHub();
		const received: string[] = [];
		const outcome = await new Promise<{ code: number | null }>((resolve, reject) => {
			const ws = new WebSocket(`${endpoint.url}?token=wrong`);
			const timer = setTimeout(() => reject(new Error("expected unauthorized close")), 5_000);
			ws.on("message", (data) => received.push(String(data)));
			ws.on("open", () => {
				// Try to leak a chat event to the unauthorized socket.
				broadcastChatRealtimeEvent({ kind: "thinking", sessionId: "s1", delta: "secret" });
			});
			ws.on("close", (code) => {
				clearTimeout(timer);
				resolve({ code });
			});
			// An error before close still ends in `close`; the assertions below decide.
			ws.on("error", () => {});
		});
		// Assert outside the event handlers so a failure fails THIS test cleanly.
		expect(outcome.code).toBe(4001);
		expect(received.join("")).not.toContain("secret");
	});
});
