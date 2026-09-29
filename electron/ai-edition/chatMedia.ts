/**
 * Pull generated image/video paths out of agent tool result JSON so the chat
 * board can show a preview gallery (create → show → place on ask).
 */

import { basename, extname } from "node:path";
import type { AiEditionChatMedia } from "../../src/native/contracts";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".mov", ".m4v"]);

function kindForPath(filePath: string): "image" | "video" | null {
	const ext = extname(filePath).toLowerCase();
	if (IMAGE_EXT.has(ext)) return "image";
	if (VIDEO_EXT.has(ext)) return "video";
	return null;
}

function pushPath(out: AiEditionChatMedia[], filePath: string, label?: string): void {
	const trimmed = filePath.trim();
	if (!trimmed) return;
	const kind = kindForPath(trimmed);
	if (!kind) return;
	if (out.some((m) => m.path === trimmed)) return;
	out.push({
		id: `media_${out.length + 1}_${basename(trimmed)}`,
		kind,
		path: trimmed,
		label: label?.trim() || basename(trimmed),
	});
}

/** Collect media paths from a single tool's resultJson payload. */
export function extractChatMediaFromToolResult(
	resultJson: string | undefined,
	existing: AiEditionChatMedia[] = [],
): AiEditionChatMedia[] {
	if (!resultJson?.trim()) return existing;
	const out = [...existing];
	try {
		const parsed = JSON.parse(resultJson) as Record<string, unknown>;
		if (Array.isArray(parsed.exportedPaths)) {
			for (const p of parsed.exportedPaths) {
				if (typeof p === "string") pushPath(out, p);
			}
		}
		if (typeof parsed.exportPath === "string") pushPath(out, parsed.exportPath);
		if (typeof parsed.imagePath === "string") pushPath(out, parsed.imagePath);
		if (typeof parsed.videoPath === "string") pushPath(out, parsed.videoPath);
		if (typeof parsed.path === "string") pushPath(out, parsed.path);
		if (Array.isArray(parsed.media)) {
			for (const item of parsed.media) {
				if (typeof item === "string") pushPath(out, item);
				else if (item && typeof item === "object") {
					const row = item as { path?: string; label?: string };
					if (typeof row.path === "string") pushPath(out, row.path, row.label);
				}
			}
		}
	} catch {
		/* ignore non-JSON tool results */
	}
	return out;
}

/** Also pull absolute media paths mentioned in free-form assistant text. */
export function extractChatMediaFromText(
	text: string | undefined,
	existing: AiEditionChatMedia[] = [],
): AiEditionChatMedia[] {
	if (!text?.trim()) return existing;
	const out = [...existing];
	const re =
		/(?:^|[\s"'`(])((?:\/|[A-Za-z]:\\)[^\s"'`)\]]+\.(?:png|jpe?g|webp|gif|mp4|webm|mov|m4v))\b/gi;
	let match: RegExpExecArray | null = re.exec(text);
	while (match) {
		pushPath(out, match[1]!);
		match = re.exec(text);
	}
	return out;
}
