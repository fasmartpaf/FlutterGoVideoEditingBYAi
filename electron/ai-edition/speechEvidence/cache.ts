/**
 * Disk cache for STT results keyed by immutable source-media identity.
 * Does NOT key by user prompt. Document.transcripts[] remains the project SSOT;
 * this cache avoids re-running Whisper when the document lacks a transcript but
 * the same file+mtime was already transcribed in this runtime.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AxcutTranscript } from "../../../src/lib/ai-edition/schema";

export interface SpeechCacheIdentity {
	sourcePath: string;
	modelId: string;
}

export interface SpeechCacheEntry {
	identity: {
		sourcePath: string;
		size: number;
		mtimeMs: number;
		modelId: string;
	};
	transcript: AxcutTranscript;
	engine?: string;
	savedAt: string;
}

function cacheKey(identity: SpeechCacheEntry["identity"]): string {
	return createHash("sha256")
		.update(
			[identity.sourcePath, String(identity.size), String(identity.mtimeMs), identity.modelId].join(
				"\0",
			),
		)
		.digest("hex")
		.slice(0, 40);
}

export async function speechCacheFilePath(
	cacheDir: string,
	identity: SpeechCacheEntry["identity"],
): Promise<string> {
	return path.join(cacheDir, `${cacheKey(identity)}.json`);
}

export async function buildSpeechCacheIdentity(
	input: SpeechCacheIdentity,
): Promise<SpeechCacheEntry["identity"] | null> {
	try {
		const st = await stat(input.sourcePath);
		return {
			sourcePath: path.resolve(input.sourcePath),
			size: st.size,
			mtimeMs: Math.floor(st.mtimeMs),
			modelId: input.modelId,
		};
	} catch {
		return null;
	}
}

export async function readSpeechCache(
	cacheDir: string,
	identity: SpeechCacheEntry["identity"],
): Promise<SpeechCacheEntry | null> {
	const file = await speechCacheFilePath(cacheDir, identity);
	if (!existsSync(file)) return null;
	try {
		const raw = JSON.parse(await readFile(file, "utf8")) as SpeechCacheEntry;
		if (
			raw.identity?.size !== identity.size ||
			raw.identity?.mtimeMs !== identity.mtimeMs ||
			raw.identity?.modelId !== identity.modelId
		) {
			return null;
		}
		if (!raw.transcript?.assetId || !Array.isArray(raw.transcript.segments)) return null;
		return raw;
	} catch {
		return null;
	}
}

export async function writeSpeechCache(cacheDir: string, entry: SpeechCacheEntry): Promise<void> {
	await mkdir(cacheDir, { recursive: true });
	const file = await speechCacheFilePath(cacheDir, entry.identity);
	await writeFile(file, JSON.stringify(entry), "utf8");
}
