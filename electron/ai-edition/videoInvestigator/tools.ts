/**
 * Deterministic investigation tools — evidence returns, never semantic conclusions.
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveFfmpeg } from "../../media/audioPeaks";
import { SOURCE_TIMESTAMP_TOLERANCE_SEC } from "../sourceTiming";
import { filterSpeechSegmentsBySourceRange } from "../speechEvidence/map";
import type { SpeechEvidence } from "../speechEvidence/types";
import type { VideoEvidenceStore } from "../temporalEventLedger/store";
import type { EvidenceProvenanceRef, TemporalEvent } from "../temporalEventLedger/types";
import {
	classifyChangeScore,
	decodeGrayThumbnail,
	scoreGrayThumbnails,
} from "../visualEvidence/change";
import { type ExtractFrameDeps, extractVisualEvidenceFrames } from "../visualEvidence/extract";
import type { VisualEvidenceFrame } from "../visualEvidence/types";

export interface InvestigatorToolContext {
	store: VideoEvidenceStore;
	assetId: string;
	sourceDurationSec: number;
	videoPath: string | null;
	speechEvidence?: SpeechEvidence | null;
	existingFrames: VisualEvidenceFrame[];
	cursorInteractions: Array<{ sourceTimeSec: number; interactionType?: string }>;
	extractDeps: ExtractFrameDeps;
	ffmpegPath?: string | null;
}

function clamp(t: number, durationSec: number): number {
	const lo = -SOURCE_TIMESTAMP_TOLERANCE_SEC;
	const hi = durationSec + SOURCE_TIMESTAMP_TOLERANCE_SEC;
	return Math.min(hi, Math.max(lo, t));
}

function frameNear(
	frames: VisualEvidenceFrame[],
	t: number,
	eps = 0.05,
): VisualEvidenceFrame | undefined {
	return frames.find((f) => Math.abs(f.sourceTimeSec - t) <= eps);
}

export function toolGetEventsInRange(
	ctx: InvestigatorToolContext,
	startSourceSec: number,
	endSourceSec: number,
): { events: TemporalEvent[]; summary: string } {
	const start = clamp(startSourceSec, ctx.sourceDurationSec);
	const end = clamp(endSourceSec, ctx.sourceDurationSec);
	const events = ctx.store.eventsInRange(start, end);
	return {
		events,
		summary: `${events.length} ledger event(s) in ${start.toFixed(2)}–${end.toFixed(2)}s`,
	};
}

export function toolGetTranscriptRange(
	ctx: InvestigatorToolContext,
	startSourceSec: number,
	endSourceSec: number,
): {
	status: string;
	segments: Array<{ startSourceTimeSec: number; endSourceTimeSec: number; text: string }>;
	summary: string;
} {
	const speech = ctx.speechEvidence;
	if (!speech) {
		return { status: "none", segments: [], summary: "No speech evidence prepared for this turn" };
	}
	const segments = filterSpeechSegmentsBySourceRange(
		speech.segments,
		startSourceSec,
		endSourceSec,
	).map((s) => ({
		startSourceTimeSec: s.startSourceTimeSec,
		endSourceTimeSec: s.endSourceTimeSec,
		text: s.text,
	}));
	return {
		status: speech.status,
		segments,
		summary: `speechStatus=${speech.status}; ${segments.length} segment(s) in range`,
	};
}

export function toolGetCursorEvents(
	ctx: InvestigatorToolContext,
	startSourceSec: number,
	endSourceSec: number,
): {
	events: Array<{ sourceTimeSec: number; interactionType?: string }>;
	summary: string;
} {
	const lo = Math.min(startSourceSec, endSourceSec);
	const hi = Math.max(startSourceSec, endSourceSec);
	const events = ctx.cursorInteractions.filter(
		(c) => c.sourceTimeSec >= lo - 0.001 && c.sourceTimeSec <= hi + 0.001,
	);
	return {
		events,
		summary: `${events.length} non-move cursor event(s) in ${lo.toFixed(2)}–${hi.toFixed(2)}s`,
	};
}

export function toolGetEvidenceForEvent(
	ctx: InvestigatorToolContext,
	eventId: string,
): { refs: EvidenceProvenanceRef[]; summary: string } {
	const refs = ctx.store.evidenceForEvent(eventId);
	const ev = ctx.store.getEvent(eventId);
	return {
		refs,
		summary: ev
			? `Provenance for ${eventId} (${ev.type}): ${refs.length} ref(s)`
			: `Event ${eventId} not found`,
	};
}

export async function toolInspectFrame(
	ctx: InvestigatorToolContext,
	sourceTimeSec: number,
): Promise<{
	frame: VisualEvidenceFrame | null;
	cacheHit: boolean;
	summary: string;
}> {
	const t = clamp(sourceTimeSec, ctx.sourceDurationSec);
	const existing = frameNear(ctx.existingFrames, t);
	if (existing) {
		return {
			frame: existing,
			cacheHit: true,
			summary: `Reused existing frame at ${existing.sourceTimeSec.toFixed(2)}s (not a semantic conclusion)`,
		};
	}
	if (!ctx.videoPath) {
		return { frame: null, cacheHit: false, summary: "No video path available for frame extract" };
	}
	const batch = await extractVisualEvidenceFrames(
		[
			{
				assetId: ctx.assetId,
				sourceTimeSec: t,
				virtualTimeSec: null,
				reason: "change_refinement",
				priority: 40,
			},
		],
		ctx.videoPath,
		ctx.extractDeps,
	);
	const frame = batch.frames[0] ?? null;
	return {
		frame,
		cacheHit: batch.cacheHits > 0 && batch.cacheMisses === 0,
		summary: frame
			? `Extracted/cached frame at ${frame.sourceTimeSec.toFixed(2)}s — pixels only, no action inferred`
			: `Frame extract failed at ${t.toFixed(2)}s`,
	};
}

export async function toolInspectVideoRange(
	ctx: InvestigatorToolContext,
	startSourceSec: number,
	endSourceSec: number,
	detailLevel: "coarse" | "normal" = "normal",
): Promise<{
	frames: VisualEvidenceFrame[];
	cacheHits: number;
	cacheMisses: number;
	summary: string;
}> {
	const start = clamp(Math.min(startSourceSec, endSourceSec), ctx.sourceDurationSec);
	const end = clamp(Math.max(startSourceSec, endSourceSec), ctx.sourceDurationSec);
	const span = Math.max(0, end - start);
	const times: number[] = [];
	if (detailLevel === "coarse") {
		times.push(start, (start + end) / 2, end);
	} else {
		const step = span <= 2 ? span / 2 : Math.min(2, span / 3);
		for (let t = start; t <= end + 1e-9; t += Math.max(step, 0.5)) {
			times.push(clamp(t, ctx.sourceDurationSec));
		}
		if (times[times.length - 1] !== end) times.push(end);
	}
	const uniq = [...new Set(times.map((t) => Math.round(t * 1000) / 1000))].slice(0, 5);
	const frames: VisualEvidenceFrame[] = [];
	let cacheHits = 0;
	let cacheMisses = 0;
	for (const t of uniq) {
		const r = await toolInspectFrame(ctx, t);
		if (r.cacheHit) cacheHits += 1;
		else cacheMisses += 1;
		if (r.frame) {
			frames.push(r.frame);
			if (!frameNear(ctx.existingFrames, r.frame.sourceTimeSec)) {
				ctx.existingFrames.push(r.frame);
			}
		}
	}
	return {
		frames,
		cacheHits,
		cacheMisses,
		summary: `Range ${start.toFixed(2)}–${end.toFixed(2)}s: ${frames.length} frame(s) sampled (${detailLevel}). Material presence only — no invented UI labels.`,
	};
}

export async function toolCompareVisualStates(
	ctx: InvestigatorToolContext,
	t1: number,
	t2: number,
): Promise<{
	fromSourceTimeSec: number;
	toSourceTimeSec: number;
	score: number | null;
	classification: ReturnType<typeof classifyChangeScore> | null;
	summary: string;
}> {
	const a = await toolInspectFrame(ctx, t1);
	const b = await toolInspectFrame(ctx, t2);
	if (!a.frame || !b.frame) {
		return {
			fromSourceTimeSec: t1,
			toSourceTimeSec: t2,
			score: null,
			classification: null,
			summary: "Compare failed: missing frame(s)",
		};
	}
	const ffmpeg = ctx.ffmpegPath === null ? null : (ctx.ffmpegPath ?? resolveFfmpeg());
	if (!ffmpeg) {
		return {
			fromSourceTimeSec: a.frame.sourceTimeSec,
			toSourceTimeSec: b.frame.sourceTimeSec,
			score: null,
			classification: null,
			summary: "Compare skipped: ffmpeg unavailable",
		};
	}
	try {
		const ga = await decodeGrayThumbnail(a.frame.imagePath, ffmpeg);
		const gb = await decodeGrayThumbnail(b.frame.imagePath, ffmpeg);
		const score = scoreGrayThumbnails(ga, gb);
		const classification = classifyChangeScore(score);
		return {
			fromSourceTimeSec: a.frame.sourceTimeSec,
			toSourceTimeSec: b.frame.sourceTimeSec,
			score,
			classification,
			summary: `Pixel difference ${a.frame.sourceTimeSec.toFixed(2)}→${b.frame.sourceTimeSec.toFixed(2)}s score=${score.toFixed(3)} (${classification}). This is NOT a semantic label (e.g. not "tooltip appeared").`,
		};
	} catch (err) {
		return {
			fromSourceTimeSec: a.frame.sourceTimeSec,
			toSourceTimeSec: b.frame.sourceTimeSec,
			score: null,
			classification: null,
			summary: `Compare error: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

/**
 * Bounded ROI crop from an existing/extracted frame.
 * Regions are generic presets — never hard-coded to a benchmark case string.
 */
export type RoiPreset = "bottom_center" | "top_chrome" | "center";

export async function toolInspectRegion(
	ctx: InvestigatorToolContext,
	sourceTimeSec: number,
	preset: RoiPreset,
): Promise<{
	imagePath: string | null;
	width: number;
	height: number;
	byteLength: number;
	summary: string;
	ms: number;
}> {
	const t0 = Date.now();
	const frameResult = await toolInspectFrame(ctx, sourceTimeSec);
	if (!frameResult.frame) {
		return {
			imagePath: null,
			width: 0,
			height: 0,
			byteLength: 0,
			summary: "ROI skipped: no source frame",
			ms: Date.now() - t0,
		};
	}
	const ffmpeg = ctx.ffmpegPath === null ? null : (ctx.ffmpegPath ?? resolveFfmpeg());
	if (!ffmpeg) {
		return {
			imagePath: null,
			width: 0,
			height: 0,
			byteLength: 0,
			summary: "ROI skipped: ffmpeg unavailable",
			ms: Date.now() - t0,
		};
	}
	const { width: W, height: H, imagePath: src } = frameResult.frame;
	let crop: { x: number; y: number; w: number; h: number };
	if (preset === "bottom_center") {
		const w = Math.max(64, Math.floor(W * 0.45));
		const h = Math.max(48, Math.floor(H * 0.22));
		crop = { x: Math.floor((W - w) / 2), y: Math.max(0, H - h - Math.floor(H * 0.02)), w, h };
	} else if (preset === "top_chrome") {
		const w = W;
		const h = Math.max(40, Math.floor(H * 0.12));
		crop = { x: 0, y: 0, w, h };
	} else {
		const w = Math.max(64, Math.floor(W * 0.4));
		const h = Math.max(64, Math.floor(H * 0.4));
		crop = { x: Math.floor((W - w) / 2), y: Math.floor((H - h) / 2), w, h };
	}
	const outPath = path.join(
		ctx.extractDeps.cacheDir,
		`roi_${preset}_${Math.round(sourceTimeSec * 1000)}_${crop.w}x${crop.h}.jpg`,
	);
	await fs.mkdir(path.dirname(outPath), { recursive: true });
	await new Promise<void>((resolve, reject) => {
		const args = [
			"-hide_banner",
			"-loglevel",
			"error",
			"-i",
			src,
			"-vf",
			`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`,
			"-q:v",
			"3",
			"-y",
			outPath,
		];
		const child = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
		let err = "";
		child.stderr?.on("data", (d) => {
			err += String(d);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(err.trim() || `ffmpeg crop exit ${code}`));
		});
	});
	const st = await fs.stat(outPath);
	return {
		imagePath: outPath,
		width: crop.w,
		height: crop.h,
		byteLength: st.size,
		summary: `ROI ${preset} at ${sourceTimeSec.toFixed(2)}s (${crop.w}×${crop.h}). Cropped pixels only — labels require semantic recognition.`,
		ms: Date.now() - t0,
	};
}
