/**
 * Turns the Local CLI's raw token stream into what the chat should show.
 *
 * The CLI answers with ONE JSON object per model step:
 *   {"message":"…"}            → the reply for the user
 *   {"tool_calls":[…]}         → edits to run (never shown as text)
 * or occasionally with plain prose.
 *
 * Tokens arrive a few characters at a time, so a per-chunk "does it start
 * with {" check leaks JSON fragments into the chat. This keeps the whole
 * message buffer, decides once whether it is JSON or prose, and for JSON
 * decodes the `message` string value progressively so the reply types out
 * live while the JSON syntax never reaches the user.
 */

export type ReplyStreamOutput = { kind: "text"; delta: string } | { kind: "thinking"; delta: string };

export const PREPARING_EDITS_LINE = "Preparing OpenScreen edits…\n";

const MESSAGE_KEY = /"message"\s*:\s*"/;

/**
 * Decode a JSON string body that may be cut off mid-way. Stops before an
 * incomplete escape and at the closing quote. Returns the decoded text and
 * whether the closing quote was seen.
 */
export function decodePartialJsonString(body: string): { text: string; closed: boolean } {
	let out = "";
	let i = 0;
	while (i < body.length) {
		const ch = body[i]!;
		if (ch === '"') return { text: out, closed: true };
		if (ch !== "\\") {
			out += ch;
			i += 1;
			continue;
		}
		const next = body[i + 1];
		if (next === undefined) break; // escape cut off — wait for more
		if (next === "u") {
			const hex = body.slice(i + 2, i + 6);
			if (hex.length < 4) break;
			const code = Number.parseInt(hex, 16);
			if (Number.isNaN(code)) {
				i += 6;
				continue;
			}
			// A high surrogate needs its low half before it can be emitted.
			if (code >= 0xd800 && code <= 0xdbff) {
				const low = body.slice(i + 6, i + 12);
				if (low.length < 6) break;
				const lowCode = /^\\u[0-9a-fA-F]{4}$/.test(low) ? Number.parseInt(low.slice(2), 16) : Number.NaN;
				if (lowCode >= 0xdc00 && lowCode <= 0xdfff) {
					out += String.fromCharCode(code, lowCode);
					i += 12;
					continue;
				}
			}
			out += String.fromCharCode(code);
			i += 6;
			continue;
		}
		const simple: Record<string, string> = {
			n: "\n",
			t: "\t",
			r: "\r",
			b: "\b",
			f: "\f",
			'"': '"',
			"\\": "\\",
			"/": "/",
		};
		out += simple[next] ?? next;
		i += 2;
	}
	return { text: out, closed: false };
}

export class ReplyStreamer {
	private buffer = "";
	private mode: "unknown" | "json" | "text" = "unknown";
	private emitted = 0;
	private announcedTools = false;

	/** A new assistant message started (e.g. the next model step). */
	reset(): void {
		this.buffer = "";
		this.mode = "unknown";
		this.emitted = 0;
		this.announcedTools = false;
	}

	/** Feed raw assistant text; returns what the chat should display now. */
	push(delta: string): ReplyStreamOutput[] {
		if (!delta) return [];
		this.buffer += delta;
		if (this.mode === "unknown") {
			const head = this.buffer.trimStart();
			if (!head) return [];
			// Models sometimes wrap the object in a ```json fence.
			if (head.startsWith("{") || head.startsWith("```")) this.mode = "json";
			else this.mode = "text";
			if (this.mode === "text") {
				this.emitted = this.buffer.length;
				return [{ kind: "text", delta: this.buffer }];
			}
		}
		if (this.mode === "text") {
			this.emitted = this.buffer.length;
			return [{ kind: "text", delta }];
		}
		const out: ReplyStreamOutput[] = [];
		if (!this.announcedTools && /"tool_calls"\s*:/.test(this.buffer)) {
			this.announcedTools = true;
			out.push({ kind: "thinking", delta: PREPARING_EDITS_LINE });
		}
		const match = MESSAGE_KEY.exec(this.buffer);
		// A "message" key AFTER "tool_calls" belongs to some tool's args, not the reply.
		const toolsAt = this.buffer.search(/"tool_calls"\s*:/);
		if (match && (toolsAt < 0 || match.index < toolsAt)) {
			const { text } = decodePartialJsonString(this.buffer.slice(match.index + match[0].length));
			if (text.length > this.emitted) {
				out.push({ kind: "text", delta: text.slice(this.emitted) });
				this.emitted = text.length;
			}
		}
		return out;
	}
}
