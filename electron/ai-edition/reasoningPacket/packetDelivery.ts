/**
 * Append ReasoningPacket text to any provider-bound user message shape.
 * Identity: CURRENT_OPENSCREEN_BOUNDED_REASONING_V1 (Quality Closure V3)
 *
 * Must handle string, content arrays, and { role, content } objects.
 * Does not mutate inputs in place.
 */

export const REASONING_PACKET_MARKER = "REASONING_PACKET_V1";

export type AppendPacketResult = {
	message: unknown;
	delivered: boolean;
	shape:
		| "string"
		| "content_array"
		| "role_content_string"
		| "role_content_array"
		| "langchain_like"
		| "unknown_failed";
};

function textContainsPacket(text: string): boolean {
	return text.includes(REASONING_PACKET_MARKER);
}

function extractAllText(message: unknown): string {
	if (typeof message === "string") return message;
	if (Array.isArray(message)) {
		return message
			.map((p) => {
				if (typeof p === "string") return p;
				if (p && typeof p === "object" && "text" in p)
					return String((p as { text: unknown }).text ?? "");
				return "";
			})
			.join("\n");
	}
	if (message && typeof message === "object") {
		const m = message as Record<string, unknown>;
		if ("content" in m) return extractAllText(m.content);
		if ("kwargs" in m && m.kwargs && typeof m.kwargs === "object") {
			return extractAllText((m.kwargs as { content?: unknown }).content);
		}
	}
	return "";
}

/**
 * Append packet text to a user message without mutating the input.
 */
export function appendReasoningPacketToUserMessage(
	userMessage: unknown,
	packetText: string,
): AppendPacketResult {
	const block = `\n\n${packetText}`;

	if (typeof userMessage === "string") {
		const message = `${userMessage}${block}`;
		return { message, delivered: textContainsPacket(message), shape: "string" };
	}

	if (Array.isArray(userMessage)) {
		const message = [...userMessage, { type: "text", text: block }];
		return {
			message,
			delivered: textContainsPacket(extractAllText(message)),
			shape: "content_array",
		};
	}

	if (userMessage && typeof userMessage === "object") {
		const m = userMessage as Record<string, unknown>;

		// LangChain HumanMessage-like: { content, ... } or { kwargs: { content } }
		const content =
			"content" in m
				? m.content
				: m.kwargs && typeof m.kwargs === "object"
					? (m.kwargs as { content?: unknown }).content
					: undefined;

		if (typeof content === "string") {
			const next = { ...m, role: (m.role as string) ?? "user", content: `${content}${block}` };
			return {
				message: next,
				delivered: textContainsPacket(String(next.content)),
				shape: "role_content_string",
			};
		}

		if (Array.isArray(content)) {
			const next = {
				...m,
				role: (m.role as string) ?? "user",
				content: [...content, { type: "text", text: block }],
			};
			return {
				message: next,
				delivered: textContainsPacket(extractAllText(next.content)),
				shape: "role_content_array",
			};
		}

		// Object without usable content — wrap as new user message
		const next = {
			role: "user",
			content: [
				{ type: "text", text: String(content ?? JSON.stringify(m).slice(0, 400)) },
				{ type: "text", text: block },
			],
		};
		return {
			message: next,
			delivered: textContainsPacket(extractAllText(next.content)),
			shape: "langchain_like",
		};
	}

	return { message: userMessage, delivered: false, shape: "unknown_failed" };
}

/** Assert provider-bound message contains the serialized packet marker. */
export function assertReasoningPacketDelivered(message: unknown): {
	ok: boolean;
	markerPresent: boolean;
	textSampleChars: number;
} {
	const text = extractAllText(message);
	const markerPresent = textContainsPacket(text);
	return { ok: markerPresent, markerPresent, textSampleChars: text.length };
}

export function extractProviderBoundUserText(message: unknown): string {
	return extractAllText(message);
}
