/**
 * Optional Tesseract OCR adapter (watch-video uses pytesseract + --psm 6 when tuned).
 * Missing binary → status unavailable (honest), never silent empty-as-no-text.
 * @see reuse/NOTICE.md
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { OcrEngine } from "../ocr/engine";
import type { OcrResult } from "../types";

function resolveTesseractBin(): string | null {
	const env = process.env.OPENSCREEN_TESSERACT_EXE?.trim();
	if (env && existsSync(env)) return env;
	// Common Homebrew / system paths — no shell install tips in user-facing paths.
	for (const p of [
		"/opt/homebrew/bin/tesseract",
		"/usr/local/bin/tesseract",
		"/usr/bin/tesseract",
	]) {
		if (existsSync(p)) return p;
	}
	return null;
}

export function isTesseractAvailable(): boolean {
	return resolveTesseractBin() !== null;
}

export class TesseractOcrEngine implements OcrEngine {
	readonly id = "tesseract" as const;
	private bin: string | null | undefined;

	async recognize(imagePath: string): Promise<OcrResult> {
		const t0 = Date.now();
		if (this.bin === undefined) this.bin = resolveTesseractBin();
		if (!this.bin) {
			return {
				engine: "tesseract",
				status: "unavailable",
				imagePath,
				width: 0,
				height: 0,
				lines: [],
				ms: Date.now() - t0,
				error: "tesseract binary not found",
			};
		}
		try {
			const text = await new Promise<string>((resolve, reject) => {
				// Upstream tuned mode uses --psm 6 (assume uniform block of text).
				const child = spawn(this.bin!, [imagePath, "stdout", "--psm", "6"], {
					stdio: ["ignore", "pipe", "pipe"],
				});
				let stdout = "";
				let stderr = "";
				child.stdout?.on("data", (d) => {
					stdout += String(d);
				});
				child.stderr?.on("data", (d) => {
					stderr += String(d);
				});
				child.on("error", reject);
				child.on("close", (code) => {
					if (code === 0) resolve(stdout);
					else reject(new Error(stderr.trim() || `tesseract exit ${code}`));
				});
			});
			const cleaned = text.replace(/\s+/g, " ").trim();
			return {
				engine: "tesseract",
				status: cleaned ? "available" : "no_text",
				imagePath,
				width: 0,
				height: 0,
				lines: cleaned
					? cleaned.split(" ").length > 0
						? [{ text: cleaned, confidence: 0 }]
						: []
					: [],
				ms: Date.now() - t0,
			};
		} catch (err) {
			return {
				engine: "tesseract",
				status: "failed",
				imagePath,
				width: 0,
				height: 0,
				lines: [],
				ms: Date.now() - t0,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	}
}
