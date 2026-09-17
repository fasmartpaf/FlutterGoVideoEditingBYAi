/**
 * Cache key for editorial orchestration sets.
 * Invalidated when any fingerprint input changes.
 */

import { createHash } from "node:crypto";
import type { EditorialOrchestrationPolicy, EditorialSignalBundle } from "./types";
import { EDITORIAL_ORCHESTRATION_POLICY_VERSION } from "./types";

export interface OrchestrationCacheKeyParts {
	mediaFingerprint: string;
	programmeFingerprint: string;
	transcriptFingerprint: string;
	visualAnalysisFingerprint: string;
	deadAirFingerprint: string;
	loudnessFingerprint: string;
	captionLayoutFingerprint: string;
	policyVersion: string;
	intentFingerprint: string;
}

export function fingerprintObject(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

export function buildOrchestrationCacheKeyParts(
	bundle: EditorialSignalBundle,
	policy: EditorialOrchestrationPolicy,
): OrchestrationCacheKeyParts {
	return {
		mediaFingerprint: bundle.mediaFingerprint,
		programmeFingerprint: bundle.programmeFingerprint,
		transcriptFingerprint: fingerprintObject(bundle.captions ?? null),
		visualAnalysisFingerprint: fingerprintObject(bundle.visual ?? null),
		deadAirFingerprint: fingerprintObject(bundle.deadAir ?? null),
		loudnessFingerprint: fingerprintObject(bundle.loudness ?? null),
		captionLayoutFingerprint: fingerprintObject({
			layout: bundle.captions?.layoutStatus,
			cues: bundle.captions?.cueCount,
			enabled: bundle.captions?.alreadyEnabled,
		}),
		policyVersion: policy.version ?? EDITORIAL_ORCHESTRATION_POLICY_VERSION,
		intentFingerprint: fingerprintObject(bundle.intents ?? null),
	};
}

export function buildOrchestrationCacheKey(parts: OrchestrationCacheKeyParts): string {
	return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

const mem = new Map<string, unknown>();

export function readOrchestrationCache<T>(key: string): T | undefined {
	return mem.get(key) as T | undefined;
}

export function writeOrchestrationCache(key: string, value: unknown): void {
	mem.set(key, value);
}

export function clearOrchestrationCacheForTests(): void {
	mem.clear();
}
