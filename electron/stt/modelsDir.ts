/**
 * Resolve where STT GGML models live.
 * Safe outside Electron (Vitest / early boot) — never throws on missing `app`.
 */

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MODEL_FILE_NAME, modelPaths } from "./modelManager";

function electronUserDataSttModels(): string | null {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const electron = require("electron") as { app?: { getPath?: (name: string) => string } };
		const getPath = electron.app?.getPath;
		if (typeof getPath !== "function") return null;
		return path.join(getPath.call(electron.app, "userData"), "stt-models");
	} catch {
		return null;
	}
}

function platformProductCandidates(): string[] {
	const home = os.homedir();
	const out: string[] = [];
	if (process.platform === "darwin") {
		out.push(path.join(home, "Library/Application Support/openscreen/stt-models"));
		// Dev Electron may use the Electron.app bundle name while product data lives under openscreen.
		out.push(path.join(home, "Library/Application Support/Electron/stt-models"));
	} else if (process.platform === "win32") {
		const appData = process.env.APPDATA?.trim();
		if (appData) {
			out.push(path.join(appData, "openscreen", "stt-models"));
			out.push(path.join(appData, "Electron", "stt-models"));
		}
	} else {
		out.push(path.join(home, ".config/openscreen/stt-models"));
		out.push(path.join(home, ".config/Electron/stt-models"));
	}
	return out;
}

function modelFilePresent(baseDir: string): boolean {
	const whisper = modelPaths(baseDir).whisper;
	return existsSync(whisper);
}

/**
 * Resolve models base directory (parent of `whisper-ggml/`).
 * Preference:
 * 1. OPENSCREEN_STT_MODELS_DIR
 * 2. Electron userData/stt-models when app is available
 * 3. Existing product/dev caches that already contain the GGML file
 * 4. Writable fallback under the home directory (download target)
 */
export function resolveSttModelsBaseDir(opts?: { preferExisting?: boolean }): string {
	const env = process.env.OPENSCREEN_STT_MODELS_DIR?.trim();
	if (env) return env;

	const fromElectron = electronUserDataSttModels();
	const preferExisting = opts?.preferExisting !== false;

	if (preferExisting) {
		if (fromElectron && modelFilePresent(fromElectron)) return fromElectron;
		for (const c of platformProductCandidates()) {
			if (modelFilePresent(c)) return c;
		}
	}

	if (fromElectron) return fromElectron;

	for (const c of platformProductCandidates()) {
		if (modelFilePresent(c)) return c;
	}

	return path.join(os.homedir(), ".openscreen-stt-models");
}

export function resolveWhisperModelPath(modelsBaseDir?: string): string {
	const base = modelsBaseDir ?? resolveSttModelsBaseDir();
	return modelPaths(base).whisper;
}

export { MODEL_FILE_NAME };
