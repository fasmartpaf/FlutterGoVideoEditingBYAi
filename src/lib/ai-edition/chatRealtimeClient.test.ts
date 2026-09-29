import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { connectChatRealtimeSocket } from "./chatRealtimeClient";

const servers: WebSocketServer[] = [];
afterEach(async () => {
	await Promise.all(
		servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
	);
});

/** Minimal hub: accepts only `?token=<good>`, then sends one event. */
async function startHub(good: string): Promise<string> {
	const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
	servers.push(server);
	await new Promise<void>((resolve) => server.once("listening", () => resolve()));
	server.on("connection", (socket, request) => {
		const token = new URL(request.url ?? "/", "http://x").searchParams.get("token");
		if (token !== good) {
			socket.close(4401, "bad token");
			return;
		}
		socket.send(JSON.stringify({ kind: "text", sessionId: "s1", delta: "hello" }));
	});
	return `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe.skipIf(typeof WebSocket === "undefined")("connectChatRealtimeSocket", () => {
	it("re-reads the endpoint on reconnect so a new hub token is picked up", async () => {
		const url = await startHub("fresh-token");
		const events: unknown[] = [];
		let refreshed = 0;
		const states: string[] = [];
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("never connected with the new token")), 5_000);
			const stop = connectChatRealtimeSocket({
				endpoint: { url, token: "stale-token" } as never,
				refreshEndpoint: async () => {
					refreshed += 1;
					return { url, token: "fresh-token" } as never;
				},
				onState: (state) => states.push(state),
				onEvent: (event) => {
					events.push(event);
					clearTimeout(timer);
					stop();
					resolve();
				},
			});
		});
		expect(refreshed).toBeGreaterThanOrEqual(1);
		expect(states).toContain("fallback");
		expect(events).toEqual([{ kind: "text", sessionId: "s1", delta: "hello" }]);
	});

	it("does not reconnect after it was closed", async () => {
		const url = await startHub("t");
		let refreshed = 0;
		const stop = connectChatRealtimeSocket({
			endpoint: { url, token: "wrong" } as never,
			refreshEndpoint: async () => {
				refreshed += 1;
				return null;
			},
			onEvent: () => {},
		});
		stop();
		await new Promise((resolve) => setTimeout(resolve, 1_000));
		expect(refreshed).toBe(0);
	});
});
