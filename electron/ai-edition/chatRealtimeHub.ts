/**
 * Localhost WebSocket hub for Cursor-like live agent streaming.
 * Chat progress (thinking / text / tools) fans out here in parallel with IPC
 * so the renderer can render the turn as it happens.
 */

import { randomBytes } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket, type WebSocket as WsSocket } from "ws";
import type { AiEditionChatEvent } from "../../src/native/contracts";

export interface ChatRealtimeEndpoint {
	url: string;
	token: string;
	port: number;
}

let httpServer: HttpServer | null = null;
let wss: WebSocketServer | null = null;
let token = "";
let port = 0;

function clients(): Set<WsSocket> {
	return wss?.clients ?? new Set();
}

export function getChatRealtimeEndpoint(): ChatRealtimeEndpoint | null {
	if (!wss || !port || !token) return null;
	return {
		url: `ws://127.0.0.1:${port}/ai-edition/chat`,
		token,
		port,
	};
}

export async function startChatRealtimeHub(): Promise<ChatRealtimeEndpoint> {
	const existing = getChatRealtimeEndpoint();
	if (existing) return existing;

	token = randomBytes(24).toString("hex");
	httpServer = createServer((_req, res) => {
		res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
		res.end("openscreen-chat-realtime\n");
	});
	wss = new WebSocketServer({ server: httpServer, path: "/ai-edition/chat" });
	wss.on("connection", (socket, req) => {
		try {
			const host = req.headers.host ?? "127.0.0.1";
			const url = new URL(req.url ?? "/", `http://${host}`);
			if (url.searchParams.get("token") !== token) {
				socket.close(4001, "unauthorized");
				return;
			}
			socket.send(
				JSON.stringify({
					kind: "status",
					sessionId: "",
					phase: "connected",
					detail: "Live agent stream connected",
				} satisfies AiEditionChatEvent),
			);
		} catch {
			socket.close(4000, "bad request");
		}
	});

	await new Promise<void>((resolve, reject) => {
		httpServer!.once("error", reject);
		httpServer!.listen(0, "127.0.0.1", () => resolve());
	});
	const addr = httpServer.address();
	port = typeof addr === "object" && addr ? addr.port : 0;
	if (!port) throw new Error("Chat realtime hub failed to bind a port");
	return getChatRealtimeEndpoint()!;
}

export function broadcastChatRealtimeEvent(event: AiEditionChatEvent): void {
	if (!wss) return;
	const raw = JSON.stringify(event);
	for (const client of clients()) {
		if (client.readyState === WebSocket.OPEN) {
			try {
				client.send(raw);
			} catch {
				// Drop dead sockets; close will prune them.
			}
		}
	}
}

export async function stopChatRealtimeHub(): Promise<void> {
	const server = httpServer;
	const socketServer = wss;
	httpServer = null;
	wss = null;
	port = 0;
	token = "";
	if (socketServer) {
		for (const client of socketServer.clients) {
			try {
				client.close(1001, "hub stopping");
			} catch {
				// ignore
			}
		}
		await new Promise<void>((resolve) => socketServer.close(() => resolve()));
	}
	if (server) {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}
