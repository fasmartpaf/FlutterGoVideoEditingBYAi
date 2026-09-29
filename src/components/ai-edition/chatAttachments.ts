/**
 * Files attached to a chat message: logos, screenshots, images, clips, music.
 *
 * The agent works with file paths, so every attachment ends up as an absolute
 * path on disk: a file picked or dropped from disk keeps its own path; a
 * pasted image (no file behind it) is saved by the main process first. On
 * send, the paths ride along at the end of the message in a small block the
 * agent reads and the chat renders back as chips.
 */

export type ChatAttachmentKind = "image" | "video" | "audio" | "file";

export interface ChatAttachment {
	id: string;
	name: string;
	path: string;
	kind: ChatAttachmentKind;
}

const IMAGE = /\.(png|jpe?g|webp|gif|svg|bmp|heic|avif)$/i;
const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i;

export function attachmentKind(name: string, mimeType = ""): ChatAttachmentKind {
	if (mimeType.startsWith("image/") || IMAGE.test(name)) return "image";
	if (mimeType.startsWith("video/") || VIDEO.test(name)) return "video";
	if (mimeType.startsWith("audio/") || AUDIO.test(name)) return "audio";
	return "file";
}

/** Marks the block so it can be found again when the message is shown. */
export const ATTACHMENT_HEADER = "Attached files (absolute paths — use these):";

/** The message as sent: the user's words, then one line per attachment. */
export function composeMessageWithAttachments(text: string, attachments: readonly ChatAttachment[]): string {
	const body = text.trim();
	if (attachments.length === 0) return body;
	const lines = attachments.map((a) => `- ${a.kind}: ${a.path}`);
	const words = body || "Here are the files I attached.";
	return `${words}\n\n${ATTACHMENT_HEADER}\n${lines.join("\n")}`;
}

/** Split a sent message back into the words and the attachments, for display. */
export function parseMessageAttachments(content: string): { text: string; attachments: ChatAttachment[] } {
	const at = content.lastIndexOf(ATTACHMENT_HEADER);
	if (at < 0) return { text: content, attachments: [] };
	const text = content.slice(0, at).trimEnd();
	const attachments: ChatAttachment[] = [];
	for (const line of content.slice(at + ATTACHMENT_HEADER.length).split("\n")) {
		const m = /^-\s*(image|video|audio|file):\s*(.+)$/.exec(line.trim());
		if (!m) continue;
		const path = m[2]!.trim();
		attachments.push({
			id: `att_${attachments.length}`,
			kind: m[1] as ChatAttachmentKind,
			path,
			name: path.split(/[/\\]/).pop() || path,
		});
	}
	return { text, attachments };
}

let seq = 0;

/**
 * Turn a File (picked, dropped or pasted) into an attachment with a real path.
 * Throws with a readable message when it cannot be saved.
 */
export async function resolveAttachment(file: File): Promise<ChatAttachment> {
	const api = typeof window !== "undefined" ? window.electronAPI : undefined;
	let path = "";
	try {
		path = api?.getPathForFile?.(file) ?? "";
	} catch {
		path = "";
	}
	const kind = attachmentKind(file.name, file.type);
	let name = file.name;
	if (!path) {
		if (!api?.saveChatAttachment) throw new Error("Attachments need the desktop app.");
		if (!name) {
			const ext = (file.type.split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "bin";
			name = `pasted-${kind === "file" ? "file" : kind}.${ext === "jpeg" ? "jpg" : ext}`;
		}
		const saved = await api.saveChatAttachment(await file.arrayBuffer(), name);
		if (!saved?.success || !saved.path) throw new Error(saved?.message || "Could not save the file.");
		path = saved.path;
	}
	seq += 1;
	return { id: `att_${Date.now().toString(36)}_${seq}`, name: name || path.split(/[/\\]/).pop() || "file", path, kind };
}
