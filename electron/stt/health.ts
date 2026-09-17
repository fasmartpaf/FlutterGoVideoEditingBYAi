/**
 * Lightweight STT runtime health — for benchmark/debug tooling only.
 * Not invoked on every transcription request.
 */

import { accessSync, existsSync, constants as fsConstants } from "node:fs";
import { candidateBinaryPaths } from "./gpuDetector";
import { areModelsPresent } from "./modelManager";
import { resolveSttModelsBaseDir, resolveWhisperModelPath } from "./modelsDir";

export interface SttRuntimeHealth {
	checkedAtIso: string;
	runtimePresent: boolean;
	runtimeExecutable: boolean;
	runtimePath: string | null;
	modelPresent: boolean;
	modelPath: string | null;
	modelsBaseDir: string;
	/** Whether we attempted a spawn/readiness probe (expensive). */
	runtimeStartable: boolean | null;
	runtimeReady: boolean | null;
	notes: string[];
}

let cachedHealth: { atMs: number; value: SttRuntimeHealth } | null = null;
const HEALTH_TTL_MS = 60_000;

export async function probeSttRuntimeHealth(opts?: {
	force?: boolean;
	/** Expensive: try starting the server. Default false. */
	probeStart?: boolean;
}): Promise<SttRuntimeHealth> {
	const now = Date.now();
	if (!opts?.force && cachedHealth && now - cachedHealth.atMs < HEALTH_TTL_MS) {
		return cachedHealth.value;
	}

	const notes: string[] = [];
	const modelsBaseDir = resolveSttModelsBaseDir();
	const modelPath = resolveWhisperModelPath(modelsBaseDir);
	const modelPresent = await areModelsPresent(modelsBaseDir);

	let runtimePath: string | null = null;
	for (const c of candidateBinaryPaths()) {
		if (c && existsSync(c)) {
			runtimePath = c;
			break;
		}
	}
	const runtimePresent = Boolean(runtimePath);
	let runtimeExecutable = false;
	if (runtimePath) {
		try {
			accessSync(runtimePath, fsConstants.X_OK);
			runtimeExecutable = true;
		} catch {
			notes.push("runtime exists but is not executable");
		}
	} else {
		notes.push("whisper-stt-server not found on candidate paths");
	}
	if (!modelPresent) notes.push("GGML model missing under resolved modelsBaseDir");

	const health: SttRuntimeHealth = {
		checkedAtIso: new Date().toISOString(),
		runtimePresent,
		runtimeExecutable,
		runtimePath,
		modelPresent,
		modelPath: modelPresent ? modelPath : modelPath,
		modelsBaseDir,
		runtimeStartable: opts?.probeStart ? null : null,
		runtimeReady: opts?.probeStart ? null : null,
		notes,
	};

	// Optional start probe is left to live recovery harness (avoids spawning in unit tests).
	if (opts?.probeStart) {
		notes.push("start probe not inlined here — use recovery live harness");
	}

	cachedHealth = { atMs: now, value: health };
	return health;
}

export function clearSttRuntimeHealthCache(): void {
	cachedHealth = null;
}
