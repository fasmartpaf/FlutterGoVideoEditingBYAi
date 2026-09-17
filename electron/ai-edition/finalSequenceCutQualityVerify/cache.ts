/**
 * Join verify cache keyed by media + programme + join set + policy.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FinalSequenceCutQualityResultV1 } from "./types";
import { FINAL_SEQUENCE_VERIFY_POLICY_VERSION } from "./types";

export interface JoinVerifyCacheKeyParts {
	mediaFingerprint: string;
	programmeFingerprint: string;
	policyVersion: string;
	joinIds: string[];
}

function keyHash(parts: JoinVerifyCacheKeyParts): string {
	const h = createHash("sha256");
	h.update(parts.mediaFingerprint);
	h.update("|");
	h.update(parts.programmeFingerprint);
	h.update("|");
	h.update(parts.policyVersion || FINAL_SEQUENCE_VERIFY_POLICY_VERSION);
	h.update("|");
	h.update([...parts.joinIds].sort().join(","));
	return h.digest("hex").slice(0, 32);
}

function defaultCacheDir(): string {
	return join(process.cwd(), "tmp/perception-benchmark/final-sequence-cut-quality-verify-v1/cache");
}

export function readJoinVerifyCache(
	parts: JoinVerifyCacheKeyParts,
	cacheDir?: string,
): FinalSequenceCutQualityResultV1 | null {
	const dir = cacheDir ?? defaultCacheDir();
	const path = join(dir, `${keyHash(parts)}.json`);
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as FinalSequenceCutQualityResultV1;
	} catch {
		return null;
	}
}

export function writeJoinVerifyCache(
	parts: JoinVerifyCacheKeyParts,
	result: FinalSequenceCutQualityResultV1,
	cacheDir?: string,
): void {
	const dir = cacheDir ?? defaultCacheDir();
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${keyHash(parts)}.json`), JSON.stringify(result));
}
