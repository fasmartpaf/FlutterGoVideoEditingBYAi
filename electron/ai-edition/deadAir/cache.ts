/**
 * SOURCE_ANALYSIS_CACHE for silence intervals.
 * Keyed by path + size + mtime + detector parameters.
 * Programme trim changes do NOT invalidate this cache.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SilenceDetectorResult } from "./types";

export interface SilenceCacheKeyParts {
	mediaPath: string;
	noiseThresholdDb: number;
	minimumSilenceDurationSec: number;
}

interface CachePayload {
	version: 1;
	key: string;
	size: number;
	mtimeMs: number;
	noiseThresholdDb: number;
	minimumSilenceDurationSec: number;
	result: SilenceDetectorResult;
}

function defaultCacheDir(): string {
	return path.join(process.cwd(), "tmp/perception-benchmark/local-dead-air-v1/cache");
}

export async function buildSilenceCacheKey(parts: SilenceCacheKeyParts): Promise<{
	key: string;
	size: number;
	mtimeMs: number;
} | null> {
	try {
		const st = await stat(parts.mediaPath);
		const raw = [
			path.resolve(parts.mediaPath),
			String(st.size),
			String(Math.trunc(st.mtimeMs)),
			String(parts.noiseThresholdDb),
			String(parts.minimumSilenceDurationSec),
		].join("|");
		const key = createHash("sha256").update(raw).digest("hex").slice(0, 32);
		return { key, size: st.size, mtimeMs: st.mtimeMs };
	} catch {
		return null;
	}
}

export async function readSilenceCache(
	parts: SilenceCacheKeyParts,
	cacheDir?: string,
): Promise<{ result: SilenceDetectorResult } | null> {
	const built = await buildSilenceCacheKey(parts);
	if (!built) return null;
	const file = path.join(cacheDir ?? defaultCacheDir(), `${built.key}.json`);
	try {
		const raw = await readFile(file, "utf8");
		const parsed = JSON.parse(raw) as CachePayload;
		if (
			parsed.version !== 1 ||
			parsed.key !== built.key ||
			parsed.size !== built.size ||
			Math.trunc(parsed.mtimeMs) !== Math.trunc(built.mtimeMs) ||
			parsed.noiseThresholdDb !== parts.noiseThresholdDb ||
			parsed.minimumSilenceDurationSec !== parts.minimumSilenceDurationSec
		) {
			return null;
		}
		return { result: parsed.result };
	} catch {
		return null;
	}
}

export async function writeSilenceCache(
	parts: SilenceCacheKeyParts,
	result: SilenceDetectorResult,
	cacheDir?: string,
): Promise<void> {
	const built = await buildSilenceCacheKey(parts);
	if (!built) return;
	const dir = cacheDir ?? defaultCacheDir();
	await mkdir(dir, { recursive: true });
	const file = path.join(dir, `${built.key}.json`);
	const payload: CachePayload = {
		version: 1,
		key: built.key,
		size: built.size,
		mtimeMs: built.mtimeMs,
		noiseThresholdDb: parts.noiseThresholdDb,
		minimumSilenceDurationSec: parts.minimumSilenceDurationSec,
		result: { ...result, cacheHit: false },
	};
	await writeFile(file, JSON.stringify(payload), "utf8");
}

/** Test helper: invalidate by writing mismatched mtime (or delete via rewrite). */
export function silenceCacheFilePath(key: string, cacheDir?: string): string {
	return path.join(cacheDir ?? defaultCacheDir(), `${key}.json`);
}
