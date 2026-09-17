/**
 * Thin OCR engine interface — platform adapters behind this boundary.
 */

import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isTesseractAvailable, TesseractOcrEngine } from "../reuse/tesseractEngine";
import type { OcrResult, OcrStatus } from "../types";

export interface OcrEngine {
	readonly id: "macos_vision" | "tesseract" | "unavailable";
	recognize(imagePath: string): Promise<OcrResult>;
}

function withStatus(result: OcrResult): OcrResult {
	if (result.status) return result;
	let status: OcrStatus;
	if (result.engine === "unavailable" || result.error?.includes("unavailable")) {
		status = "unavailable";
	} else if (result.error) {
		status = "failed";
	} else if (result.lines.length === 0) {
		status = "no_text";
	} else {
		status = "available";
	}
	return { ...result, status };
}

function unavailable(imagePath: string, error?: string): OcrResult {
	return {
		engine: "unavailable",
		status: "unavailable",
		imagePath,
		width: 0,
		height: 0,
		lines: [],
		ms: 0,
		error: error ?? "No OCR engine available on this platform",
	};
}

export class UnavailableOcrEngine implements OcrEngine {
	readonly id = "unavailable" as const;
	async recognize(imagePath: string): Promise<OcrResult> {
		return unavailable(imagePath);
	}
}

function candidateOcrBinaries(): string[] {
	const out: string[] = [];
	const env = process.env.OPENSCREEN_VISION_OCR_EXE?.trim();
	if (env) out.push(env);
	out.push(
		path.join(process.cwd(), "electron/native/bin/darwin-arm64/openscreen-vision-ocr"),
		path.join(process.cwd(), "electron/native/bin/darwin-x64/openscreen-vision-ocr"),
		path.join(os.homedir(), "Library/Application Support/openscreen/bin/openscreen-vision-ocr"),
		path.join(os.tmpdir(), "openscreen-vision-ocr"),
	);
	return out;
}

function swiftSourcePath(): string {
	// Prefer repo path relative to this file.
	try {
		const here = path.dirname(fileURLToPath(import.meta.url));
		return path.join(here, "native", "macosVisionOcr.swift");
	} catch {
		return path.join(
			process.cwd(),
			"electron/ai-edition/visualSpecialist/native/macosVisionOcr.swift",
		);
	}
}

async function ensureMacosVisionBinary(): Promise<string | null> {
	for (const p of candidateOcrBinaries()) {
		if (existsSync(p)) return p;
	}
	if (process.platform !== "darwin") return null;
	const src = swiftSourcePath();
	if (!existsSync(src)) {
		const alt = path.join(
			process.cwd(),
			"electron/ai-edition/visualSpecialist/native/macosVisionOcr.swift",
		);
		if (!existsSync(alt)) return null;
		return compileSwift(alt, path.join(os.tmpdir(), "openscreen-vision-ocr"));
	}
	return compileSwift(src, path.join(os.tmpdir(), "openscreen-vision-ocr"));
}

async function compileSwift(src: string, out: string): Promise<string | null> {
	await fs.mkdir(path.dirname(out), { recursive: true });
	const lock = `${out}.lock`;
	const start = Date.now();
	while (existsSync(lock) && Date.now() - start < 30_000) {
		if (existsSync(out)) return out;
		await new Promise((r) => setTimeout(r, 100));
	}
	try {
		await fs.writeFile(lock, String(process.pid), { flag: "wx" });
	} catch {
		// Another process is compiling — wait for binary.
		while (!existsSync(out) && Date.now() - start < 30_000) {
			await new Promise((r) => setTimeout(r, 100));
		}
		return existsSync(out) ? out : null;
	}
	try {
		if (existsSync(out)) return out;
		const code = await new Promise<number>((resolve, reject) => {
			const child = spawn("swiftc", ["-O", "-o", out, src], {
				stdio: ["ignore", "ignore", "pipe"],
			});
			let err = "";
			child.stderr?.on("data", (d) => {
				err += String(d);
			});
			child.on("error", reject);
			child.on("close", (c) => {
				if (c !== 0) console.warn("[visual-specialist] swiftc failed", err.trim());
				resolve(c ?? 1);
			});
		});
		return code === 0 && existsSync(out) ? out : null;
	} finally {
		await fs.unlink(lock).catch(() => undefined);
	}
}

export class MacosVisionOcrEngine implements OcrEngine {
	readonly id = "macos_vision" as const;
	private binary: string | null | undefined;

	async recognize(imagePath: string): Promise<OcrResult> {
		const t0 = Date.now();
		if (this.binary === undefined) {
			this.binary = await ensureMacosVisionBinary();
		}
		if (!this.binary) {
			return unavailable(imagePath, "macos Vision OCR binary unavailable");
		}
		try {
			const raw = await new Promise<string>((resolve, reject) => {
				const child = spawn(this.binary!, [imagePath], {
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
					else reject(new Error(stderr.trim() || `ocr exit ${code}`));
				});
			});
			const parsed = JSON.parse(raw) as {
				engine?: string;
				width?: number;
				height?: number;
				lines?: Array<{
					text?: string;
					confidence?: number;
					x?: number;
					y?: number;
					w?: number;
					h?: number;
				}>;
			};
			const lines = (parsed.lines ?? [])
				.filter((l) => typeof l.text === "string" && l.text.trim())
				.map((l) => ({
					text: String(l.text).trim(),
					confidence: typeof l.confidence === "number" ? l.confidence : 0,
					box:
						typeof l.x === "number"
							? {
									x: l.x ?? 0,
									y: l.y ?? 0,
									w: l.w ?? 0,
									h: l.h ?? 0,
								}
							: undefined,
				}));
			return withStatus({
				engine: "macos_vision",
				imagePath,
				width: parsed.width ?? 0,
				height: parsed.height ?? 0,
				lines,
				ms: Date.now() - t0,
			});
		} catch (err) {
			return withStatus({
				...unavailable(imagePath, err instanceof Error ? err.message : String(err)),
				status: "failed",
				ms: Date.now() - t0,
			});
		}
	}
}

export async function resolveOcrEngine(): Promise<OcrEngine> {
	if (process.platform === "darwin") {
		const eng = new MacosVisionOcrEngine();
		const bin = await ensureMacosVisionBinary();
		if (bin) return eng;
	}
	if (isTesseractAvailable()) return new TesseractOcrEngine();
	return new UnavailableOcrEngine();
}
