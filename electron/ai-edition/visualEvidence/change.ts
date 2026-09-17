import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import {
	CHANGE_BLOCK_H,
	CHANGE_BLOCK_W,
	CHANGE_COMPARE_HEIGHT,
	CHANGE_COMPARE_WIDTH,
	CHANGE_MINIMAL_MAX,
	CHANGE_MODERATE_MAX,
	DEDUPE_WINDOW_SEC,
	MAX_REFINEMENT_FRAMES,
	MAX_REFINEMENT_LEVELS,
	MAX_VISUAL_FRAMES,
	REASON_PRIORITY,
	REFINE_MIN_GAP_SEC,
	type VisualChange,
	type VisualChangeClassification,
	type VisualEvidenceCandidate,
	type VisualEvidenceFrame,
} from "./types";

export interface ChangeScoreDeps {
	/** Path to ffmpeg binary; required unless decodeGray is provided. */
	ffmpegPath?: string | null;
	/** Override gray decode for unit tests (no ffmpeg). */
	decodeGray?: (imagePath: string) => Promise<Uint8Array>;
}

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

export function classifyChangeScore(score: number): VisualChangeClassification {
	if (!(score > CHANGE_MINIMAL_MAX)) return "minimal";
	if (!(score > CHANGE_MODERATE_MAX)) return "moderate";
	return "significant";
}

/**
 * Deterministic score in [0,1]: max over fixed blocks of mean |Δ|/255 on a
 * shared grayscale thumbnail. Emphasizes local UI motion over global wash.
 */
export function scoreGrayThumbnails(
	a: Uint8Array,
	b: Uint8Array,
	width = CHANGE_COMPARE_WIDTH,
	height = CHANGE_COMPARE_HEIGHT,
	blockW = CHANGE_BLOCK_W,
	blockH = CHANGE_BLOCK_H,
): number {
	const expected = width * height;
	if (a.length < expected || b.length < expected) {
		throw new Error(`gray thumb size mismatch: need ${expected}, got ${a.length}/${b.length}`);
	}
	let blockMax = 0;
	for (let by = 0; by < height; by += blockH) {
		for (let bx = 0; bx < width; bx += blockW) {
			let sum = 0;
			let n = 0;
			const yEnd = Math.min(by + blockH, height);
			const xEnd = Math.min(bx + blockW, width);
			for (let y = by; y < yEnd; y++) {
				const row = y * width;
				for (let x = bx; x < xEnd; x++) {
					sum += Math.abs(a[row + x]! - b[row + x]!);
					n += 1;
				}
			}
			if (n > 0) blockMax = Math.max(blockMax, sum / (n * 255));
		}
	}
	return blockMax;
}

/** Decode a JPEG (or any ffmpeg-readable still) to fixed gray raw bytes. */
export async function decodeGrayThumbnail(
	imagePath: string,
	ffmpegPath: string,
	width = CHANGE_COMPARE_WIDTH,
	height = CHANGE_COMPARE_HEIGHT,
): Promise<Uint8Array> {
	const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=gray`;
	const args = [
		"-hide_banner",
		"-loglevel",
		"error",
		"-i",
		imagePath,
		"-frames:v",
		"1",
		"-vf",
		vf,
		"-f",
		"rawvideo",
		"pipe:1",
	];
	const buf = await new Promise<Buffer>((resolve, reject) => {
		const child = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
		const chunks: Buffer[] = [];
		let stderr = "";
		child.stdout?.on("data", (c) => chunks.push(Buffer.from(c)));
		child.stderr?.on("data", (c) => {
			stderr += String(c);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve(Buffer.concat(chunks));
			else reject(new Error(`ffmpeg gray decode failed (${code}): ${stderr.trim()}`));
		});
	});
	const expected = width * height;
	if (buf.length < expected) {
		throw new Error(`ffmpeg gray decode short read: ${buf.length} < ${expected}`);
	}
	return new Uint8Array(buf.buffer, buf.byteOffset, expected);
}

function isInteractionReason(reason: VisualEvidenceFrame["reason"]): boolean {
	return reason.startsWith("cursor_interaction");
}

function pairIsInteractionSequence(a: VisualEvidenceFrame, b: VisualEvidenceFrame): boolean {
	return isInteractionReason(a.reason) && isInteractionReason(b.reason);
}

/**
 * Score adjacent frames in chronological order only.
 * Frames must already be sorted by sourceTimeSec.
 */
export async function scoreAdjacentVisualFrames(
	frames: VisualEvidenceFrame[],
	deps: ChangeScoreDeps,
): Promise<{ changes: VisualChange[]; changeDetectionMs: number }> {
	const started = Date.now();
	const sorted = [...frames].sort((a, b) => a.sourceTimeSec - b.sourceTimeSec);
	const changes: VisualChange[] = [];
	if (sorted.length < 2) {
		return { changes, changeDetectionMs: Date.now() - started };
	}

	const decode =
		deps.decodeGray ??
		(async (imagePath: string) => {
			if (!deps.ffmpegPath) throw new Error("ffmpegPath required for change scoring");
			return decodeGrayThumbnail(imagePath, deps.ffmpegPath);
		});

	const thumbs: Uint8Array[] = [];
	for (const f of sorted) {
		thumbs.push(await decode(f.imagePath));
	}

	for (let i = 0; i < sorted.length - 1; i++) {
		const from = sorted[i]!;
		const to = sorted[i + 1]!;
		const score = scoreGrayThumbnails(thumbs[i]!, thumbs[i + 1]!);
		changes.push({
			fromSourceTimeSec: from.sourceTimeSec,
			toSourceTimeSec: to.sourceTimeSec,
			fromVirtualTimeSec: from.virtualTimeSec,
			toVirtualTimeSec: to.virtualTimeSec,
			score: Math.round(score * 10_000) / 10_000,
			classification: classifyChangeScore(score),
			interactionSequence: pairIsInteractionSequence(from, to),
		});
	}

	return { changes, changeDetectionMs: Date.now() - started };
}

export interface RefinementPlan {
	midpoints: Array<{
		sourceTimeSec: number;
		fromSourceTimeSec: number;
		toSourceTimeSec: number;
		level: number;
	}>;
}

/**
 * Bounded midpoint plan for significant transitions with a large enough gap.
 * At most MAX_REFINEMENT_LEVELS depth and MAX_REFINEMENT_FRAMES total midpoints.
 */
export function planRefinementMidpoints(
	changes: VisualChange[],
	options?: {
		level?: number;
		alreadyPlanned?: number;
		/** When true, also refine moderate transitions with large gaps (coverage-first sparse samples). */
		includeModerateLargeGaps?: boolean;
		moderateMinGapSec?: number;
	},
): RefinementPlan {
	const level = options?.level ?? 1;
	const already = options?.alreadyPlanned ?? 0;
	const midpoints: RefinementPlan["midpoints"] = [];
	if (level > MAX_REFINEMENT_LEVELS || already >= MAX_REFINEMENT_FRAMES) {
		return { midpoints };
	}

	const moderateMinGap = options?.moderateMinGapSec ?? 3.0;
	const significant = changes
		.filter(
			(c) =>
				c.classification === "significant" &&
				c.toSourceTimeSec - c.fromSourceTimeSec >= REFINE_MIN_GAP_SEC,
		)
		.sort((a, b) => b.score - a.score);

	const moderateLarge =
		options?.includeModerateLargeGaps === true
			? changes
					.filter(
						(c) =>
							c.classification === "moderate" &&
							c.toSourceTimeSec - c.fromSourceTimeSec >= moderateMinGap,
					)
					.sort((a, b) => b.score - a.score)
			: [];

	const ordered = [...significant, ...moderateLarge];

	for (const c of ordered) {
		if (already + midpoints.length >= MAX_REFINEMENT_FRAMES) break;
		const mid = round3((c.fromSourceTimeSec + c.toSourceTimeSec) / 2);
		if (
			Math.abs(mid - c.fromSourceTimeSec) <= DEDUPE_WINDOW_SEC ||
			Math.abs(mid - c.toSourceTimeSec) <= DEDUPE_WINDOW_SEC
		) {
			continue;
		}
		if (midpoints.some((m) => Math.abs(m.sourceTimeSec - mid) <= DEDUPE_WINDOW_SEC)) continue;
		midpoints.push({
			sourceTimeSec: mid,
			fromSourceTimeSec: c.fromSourceTimeSec,
			toSourceTimeSec: c.toSourceTimeSec,
			level,
		});
	}

	return { midpoints };
}

export function refinementCandidatesFromPlan(
	plan: RefinementPlan,
	assetId: string,
	virtualTimeFor: (sourceTimeSec: number) => number | null,
): VisualEvidenceCandidate[] {
	return plan.midpoints.map((m) => ({
		assetId,
		sourceTimeSec: m.sourceTimeSec,
		virtualTimeSec: virtualTimeFor(m.sourceTimeSec),
		reason: "change_refinement" as const,
		priority: REASON_PRIORITY.change_refinement,
	}));
}

function nearTime(a: number, b: number): boolean {
	return Math.abs(a - b) <= DEDUPE_WINDOW_SEC;
}

/**
 * Drop redundant periodic frames when over budget.
 * Never drops interaction frames. Prefer dropping periodics whose adjacent
 * transitions are both minimal; never drop a frame that borders a significant
 * transition (keeps before/after evidence).
 */
export function cullFramesToBudget(
	frames: VisualEvidenceFrame[],
	changes: VisualChange[],
	maxFrames = MAX_VISUAL_FRAMES,
): VisualEvidenceFrame[] {
	const sorted = [...frames].sort((a, b) => a.sourceTimeSec - b.sourceTimeSec);
	if (sorted.length <= maxFrames) return sorted;

	const changeByPair = new Map<string, VisualChange>();
	for (const c of changes) {
		changeByPair.set(`${c.fromSourceTimeSec}|${c.toSourceTimeSec}`, c);
	}

	const classificationBetween = (i: number, j: number): VisualChangeClassification | null => {
		const a = sorted[i]!;
		const b = sorted[j]!;
		for (const c of changes) {
			if (
				nearTime(c.fromSourceTimeSec, a.sourceTimeSec) &&
				nearTime(c.toSourceTimeSec, b.sourceTimeSec)
			) {
				return c.classification;
			}
		}
		return null;
	};

	const droppable = (idx: number): boolean => {
		const f = sorted[idx]!;
		if (isInteractionReason(f.reason)) return false;
		if (f.reason === "clip_boundary") return false;
		// Keep sides of significant transitions.
		if (idx > 0 && classificationBetween(idx - 1, idx) === "significant") return false;
		if (idx < sorted.length - 1 && classificationBetween(idx, idx + 1) === "significant") {
			return false;
		}
		// Prefer dropping when both neighbors are minimal (or missing).
		const left = idx > 0 ? classificationBetween(idx - 1, idx) : "minimal";
		const right = idx < sorted.length - 1 ? classificationBetween(idx, idx + 1) : "minimal";
		return (left === "minimal" || left == null) && (right === "minimal" || right == null);
	};

	const kept = sorted.map((_, i) => i);
	while (kept.length > maxFrames) {
		let victim = -1;
		for (let k = 1; k < kept.length - 1; k++) {
			const idx = kept[k]!;
			if (!droppable(idx)) continue;
			const f = sorted[idx]!;
			if (f.reason === "periodic" || f.reason === "change_refinement") {
				victim = k;
				break;
			}
		}
		if (victim < 0) {
			// Fallback: drop lowest-priority non-interaction interior frame.
			for (let k = kept.length - 2; k >= 1; k--) {
				const f = sorted[kept[k]!]!;
				if (!isInteractionReason(f.reason)) {
					victim = k;
					break;
				}
			}
		}
		if (victim < 0) break;
		kept.splice(victim, 1);
	}

	return kept.map((i) => sorted[i]!);
}

/** Correlate cursor interaction times with nearby significant visual transitions. */
export function correlateInteractionsWithChanges(
	interactions: Array<{ sourceTimeSec: number }>,
	changes: VisualChange[],
	windowSec = 0.75,
): Array<{ interactionSourceSec: number; change: VisualChange }> {
	const out: Array<{ interactionSourceSec: number; change: VisualChange }> = [];
	for (const hit of interactions) {
		const nearby = changes
			.filter(
				(c) =>
					c.classification === "significant" &&
					hit.sourceTimeSec >= c.fromSourceTimeSec - windowSec &&
					hit.sourceTimeSec <= c.toSourceTimeSec + windowSec,
			)
			.sort((a, b) => b.score - a.score)[0];
		if (nearby) out.push({ interactionSourceSec: hit.sourceTimeSec, change: nearby });
	}
	return out;
}

/** Ensure JPEG still exists / is non-empty (cache health). */
export async function assertReadableJpeg(imagePath: string): Promise<boolean> {
	try {
		const st = await fs.stat(imagePath);
		return st.isFile() && st.size > 0;
	} catch {
		return false;
	}
}
