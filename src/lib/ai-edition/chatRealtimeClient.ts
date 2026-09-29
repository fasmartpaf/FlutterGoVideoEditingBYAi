import type {
	AiEditionChatEvent,
	AiEditionChatRealtimeEndpoint,
} from "@/native/contracts";

export type ChatRealtimeConnectionState = "idle" | "connecting" | "live" | "fallback";

/**
 * Connect to the main-process chat WebSocket hub for Cursor-like live streaming.
 * Returns an unsubscribe that closes the socket.
 */
export function connectChatRealtimeSocket(options: {
	endpoint: AiEditionChatRealtimeEndpoint;
	/**
	 * Re-read the endpoint before each reconnect. The hub mints a new token
	 * (and may pick a new port) when it restarts, so a cached one would be
	 * refused forever.
	 */
	refreshEndpoint?: () => Promise<AiEditionChatRealtimeEndpoint | null>;
	onEvent: (event: AiEditionChatEvent) => void;
	onState?: (state: ChatRealtimeConnectionState) => void;
}): () => void {
	let closed = false;
	let socket: WebSocket | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let attempt = 0;
	let endpoint = options.endpoint;

	const clearReconnect = () => {
		if (reconnectTimer) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
	};

	const connect = () => {
		if (closed) return;
		options.onState?.("connecting");
		const url = `${endpoint.url}?token=${encodeURIComponent(endpoint.token)}`;
		socket = new WebSocket(url);
		socket.onopen = () => {
			attempt = 0;
			options.onState?.("live");
		};
		socket.onmessage = (message) => {
			try {
				const parsed = JSON.parse(String(message.data)) as AiEditionChatEvent;
				if (parsed && typeof parsed === "object" && "kind" in parsed) {
					options.onEvent(parsed);
				}
			} catch {
				// ignore malformed frames
			}
		};
		socket.onerror = () => {
			// onclose handles fallback / reconnect
		};
		socket.onclose = () => {
			socket = null;
			if (closed) return;
			options.onState?.("fallback");
			attempt += 1;
			const delay = Math.min(8_000, 400 * 2 ** Math.min(attempt, 4));
			clearReconnect();
			reconnectTimer = setTimeout(() => {
				if (closed) return;
				if (!options.refreshEndpoint) {
					connect();
					return;
				}
				options
					.refreshEndpoint()
					.then((next) => {
						if (next) endpoint = next;
					})
					.catch(() => {
						// keep the last endpoint; the next close retries again
					})
					.finally(connect);
			}, delay);
		};
	};

	connect();

	return () => {
		closed = true;
		clearReconnect();
		options.onState?.("idle");
		try {
			socket?.close();
		} catch {
			// ignore
		}
		socket = null;
	};
}
