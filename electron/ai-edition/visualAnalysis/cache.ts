/**
 * SOURCE_VISUAL_ANALYSIS cache — survives programme trim mutations.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { VisualAnalysisParameters, VisualAnalysisV1 } from "./types";

export interface VisualAnalysisCacheKeyParts {
	mediaPath: string;
	parameters: VisualAnalysisParameters;
	detectorSuiteVersion: string;
}

interface Payload {
	version: 1;
	key: string;
	size: number;
	mtimeMs: number;
	result: VisualAnalysisV1;
}

function defaultCacheDir(): string {
	return path.join(process.cwd(), "tmp/perception-benchmark/local-visual-analysis-v1/cache");
}

export async function buildVisualAnalysisCacheKey(
	parts: VisualAnalysisCacheKeyParts,
): Promise<{ key: string; size: number; mtimeMs: number } | null> {
	try {
		const st = await stat(parts.mediaPath);
		const raw = [
			path.resolve(parts.mediaPath),
			String(st.size),
			String(Math.trunc(st.mtimeMs)),
			parts.detectorSuiteVersion,
			JSON.stringify(parts.parameters),
		].join("|");
		return {
			key: createHash("sha256").update(raw).digest("hex").slice(0, 32),
			size: st.size,
			mtimeMs: st.mtimeMs,
		};
	} catch {
		return null;
	}
}

export async function readVisualAnalysisCache(
	parts: VisualAnalysisCacheKeyParts,
	cacheDir?: string,
): Promise<VisualAnalysisV1 | null> {
	const built = await buildVisualAnalysisCacheKey(parts);
	if (!built) return null;
	try {
		const file = path.join(cacheDir ?? defaultCacheDir(), `${built.key}.json`);
		const parsed = JSON.parse(await readFile(file, "utf8")) as Payload;
		if (
			parsed.version !== 1 ||
			parsed.key !== built.key ||
			parsed.size !== built.size ||
			Math.trunc(parsed.mtimeMs) !== Math.trunc(built.mtimeMs)
		) {
			return null;
		}
		return parsed.result;
	} catch {
		return null;
	}
}

export async function writeVisualAnalysisCache(
	parts: VisualAnalysisCacheKeyParts,
	result: VisualAnalysisV1,
	cacheDir?: string,
): Promise<void> {
	const built = await buildVisualAnalysisCacheKey(parts);
	if (!built) return;
	const dir = cacheDir ?? defaultCacheDir();
	await mkdir(dir, { recursive: true });
	const payload: Payload = {
		version: 1,
		key: built.key,
		size: built.size,
		mtimeMs: built.mtimeMs,
		result: { ...result, cacheHit: false },
	};
	await writeFile(path.join(dir, `${built.key}.json`), JSON.stringify(payload), "utf8");
}
