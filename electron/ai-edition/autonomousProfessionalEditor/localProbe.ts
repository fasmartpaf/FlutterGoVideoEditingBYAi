/**
 * Probe for already-available local reasoning endpoints (no download).
 */

import type { LocalReasoningProbeResult } from "./provider";

async function probe(url: string, timeoutMs = 400): Promise<boolean> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(url, { signal: ctrl.signal });
		return res.ok || res.status === 404 || res.status === 405;
	} catch {
		return false;
	} finally {
		clearTimeout(t);
	}
}

export async function probeLocalReasoningAvailability(): Promise<LocalReasoningProbeResult> {
	const ollama = await probe("http://127.0.0.1:11434/api/tags");
	if (ollama) {
		return {
			available: true,
			kind: "LOCAL_MODEL",
			endpoint: "http://127.0.0.1:11434",
			modelId: "unknown_until_listed",
			note: "Ollama endpoint reachable — V1 uses deterministic director; local provider boundary ready",
		};
	}
	const lmstudio = await probe("http://127.0.0.1:1234/v1/models");
	if (lmstudio) {
		return {
			available: true,
			kind: "USER_SERVER_MODEL",
			endpoint: "http://127.0.0.1:1234/v1",
			note: "LM Studio-compatible endpoint reachable — not auto-wired for V1 without approval",
		};
	}
	return {
		available: false,
		kind: null,
		note: "No local model endpoint detected; deterministic fixture provider used",
	};
}
