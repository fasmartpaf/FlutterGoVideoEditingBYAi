/**
 * OCR result cache — keyed by media identity + time + ROI + preprocess + engine.
 * Never keyed by user prompt.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { OcrResult } from "../types";
import { OCR_PREPROCESS_VERSION } from "./constants";

export interface OcrCacheKeyInput {
	videoPath: string;
	videoMtimeMs: number;
	sourceTimeSec: number;
	roi: { x: number; y: number; w: number; h: number };
	engineId: string;
	preprocessVersion?: string;
}

export function buildOcrCacheKey(input: OcrCacheKeyInput): string {
	const payload = [
		input.videoPath,
		String(input.videoMtimeMs),
		input.sourceTimeSec.toFixed(3),
		`${input.roi.x},${input.roi.y},${input.roi.w},${input.roi.h}`,
		input.engineId,
		input.preprocessVersion ?? OCR_PREPROCESS_VERSION,
	].join("|");
	return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

export class OcrResultCache {
	private mem = new Map<string, OcrResult>();
	hits = 0;
	misses = 0;

	constructor(private diskDir?: string) {}

	async get(key: string): Promise<OcrResult | null> {
		const hit = this.mem.get(key);
		if (hit) {
			this.hits += 1;
			return hit;
		}
		if (this.diskDir) {
			const p = path.join(this.diskDir, `ocr_${key}.json`);
			try {
				const raw = await fs.readFile(p, "utf8");
				const parsed = JSON.parse(raw) as OcrResult;
				this.mem.set(key, parsed);
				this.hits += 1;
				return parsed;
			} catch {
				/* miss */
			}
		}
		this.misses += 1;
		return null;
	}

	async set(key: string, value: OcrResult): Promise<void> {
		this.mem.set(key, value);
		if (this.diskDir) {
			await fs.mkdir(this.diskDir, { recursive: true });
			await fs.writeFile(path.join(this.diskDir, `ocr_${key}.json`), JSON.stringify(value));
		}
	}
}
