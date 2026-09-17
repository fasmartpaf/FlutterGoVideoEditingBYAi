/**
 * Compositor frame cache keyed by document fingerprint + programme time + resolution.
 */

import { createHash } from "node:crypto";
import type { CompositedFrameResult } from "../compositorVerify/types";

export const EDIT_VERIFY_FRAME_CACHE_VERSION = "v1";

const store = new Map<string, CompositedFrameResult>();

export function editVerifyFrameCacheKey(args: {
	documentFingerprint: string;
	programmeTimeSec: number;
	width: number;
	height: number;
}): string {
	const raw = [
		EDIT_VERIFY_FRAME_CACHE_VERSION,
		args.documentFingerprint,
		args.programmeTimeSec.toFixed(3),
		String(args.width),
		String(args.height),
	].join("|");
	return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

export function getCachedEditVerifyFrame(key: string): CompositedFrameResult | null {
	return store.get(key) ?? null;
}

export function setCachedEditVerifyFrame(key: string, frame: CompositedFrameResult): void {
	store.set(key, frame);
}

export function clearEditVerifyFrameCache(): void {
	store.clear();
}
