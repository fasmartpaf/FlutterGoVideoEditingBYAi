/**
 * Deterministic caption layout cache.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaptionLayoutResult } from "./types";
import { CAPTION_LAYOUT_VERSION, LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID } from "./types";

export function buildCaptionLayoutCacheKey(parts: {
	transcriptFingerprint: string;
	programmeFingerprint: string;
	aspectValue: number;
	policyVersion: string;
	protectedRegionFingerprint: string;
	outputWidth?: number;
	outputHeight?: number;
}): string {
	const h = createHash("sha256");
	h.update(LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID);
	h.update(CAPTION_LAYOUT_VERSION);
	h.update(parts.transcriptFingerprint);
	h.update(parts.programmeFingerprint);
	h.update(String(parts.aspectValue));
	h.update(parts.policyVersion);
	h.update(parts.protectedRegionFingerprint);
	h.update(String(parts.outputWidth ?? 0));
	h.update(String(parts.outputHeight ?? 0));
	return h.digest("hex");
}

function cachePath(key: string): string {
	const dir = join(tmpdir(), "openscreen-caption-layout-v1");
	mkdirSync(dir, { recursive: true });
	return join(dir, `${key}.json`);
}

export function readCaptionLayoutCache(key: string): CaptionLayoutResult | null {
	const p = cachePath(key);
	if (!existsSync(p)) return null;
	try {
		const raw = JSON.parse(readFileSync(p, "utf8")) as CaptionLayoutResult;
		if (raw.providerId !== LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID) return null;
		return { ...raw, cacheHit: true };
	} catch {
		return null;
	}
}

export function writeCaptionLayoutCache(key: string, result: CaptionLayoutResult): void {
	writeFileSync(cachePath(key), JSON.stringify(result), "utf8");
}

export function fingerprintProtectedRegions(
	regions: Array<{ id: string; rect: { x: number; y: number; width: number; height: number } }>,
): string {
	const h = createHash("sha256");
	for (const r of regions) {
		h.update(`${r.id}:${r.rect.x},${r.rect.y},${r.rect.width},${r.rect.height};`);
	}
	return h.digest("hex").slice(0, 16);
}
