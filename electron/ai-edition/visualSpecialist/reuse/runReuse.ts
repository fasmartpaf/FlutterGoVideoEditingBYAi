/**
 * CURRENT_OPENSCREEN_REUSE_VISUAL_V1 — specialist path with watch-video algorithm ports.
 * Does not replace visualEvidence prepare sampling. Bounded Investigator windows only.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveFfmpeg } from "../../../media/audioPeaks";
import type { InvestigationEvidenceSet } from "../../videoInvestigator/types";
import type { OcrEngine } from "../ocr/engine";
import { resolveOcrEngine } from "../ocr/engine";
import { type CropPreset, extractSourceResolutionCrop, probeVideoSize } from "../sourceCrop";
import {
	DEFAULT_VISUAL_SPECIALIST_BUDGETS,
	type OcrResult,
	type SourceResCrop,
	type VisualObservation,
	type VisualSpecialistBudgets,
	type VisualSpecialistMetrics,
	type VisualSpecialistResult,
} from "../types";
import { buildBoundedSampleCandidates } from "./boundedSampling";
import { OCR_PREPROCESS_VERSION, REUSE_VISUAL_PROVIDER_ID } from "./constants";
import { type DedupeCandidate, dedupeByDhash } from "./dedupe";
import { dhashImage } from "./dhash";
import { buildOcrCacheKey, OcrResultCache } from "./ocrCache";
import { preprocessForOcr } from "./ocrPreprocess";
import { probeSceneTimesInRange } from "./sceneDetect";

export interface RunReuseVisualInput {
	videoPath: string | null;
	investigation: InvestigationEvidenceSet;
	cacheDir?: string;
	ffmpegPath?: string | null;
	ocrEngine?: OcrEngine;
	budgets?: Partial<VisualSpecialistBudgets>;
	/** Change transition times from visualEvidence Bug-3 (optional). */
	changeTimesSec?: number[];
}

let obsSeq = 0;
function nextObsId(): string {
	obsSeq += 1;
	return `vo_reuse_${obsSeq}`;
}

const PASSIVE_APP_RE = /\b(upwork|twitter|chatgpt|gmail|youtube)\b/i;

function joinedOcrText(ocr: OcrResult): string {
	return ocr.lines
		.map((l) => l.text)
		.filter(Boolean)
		.join(" · ");
}

function emptyMetrics(engine: string): VisualSpecialistMetrics {
	return {
		sourceCropMs: 0,
		ocrMs: 0,
		diffMs: 0,
		totalMs: 0,
		sourceCrops: 0,
		ocrCalls: 0,
		beforeAfterPairs: 0,
		imageBytes: 0,
		extraModelCalls: 0,
		engine,
		dhashMs: 0,
		sceneProbeMs: 0,
		preprocessMs: 0,
		candidatesBeforeDedupe: 0,
		candidatesAfterDedupe: 0,
		ocrCacheHits: 0,
		ocrCacheMisses: 0,
		providerId: REUSE_VISUAL_PROVIDER_ID,
	};
}

/**
 * Reuse Visual V1 specialist: bounded scene+periodic → dHash → source-res ROI → OCR prep → OCR.
 */
export async function runReuseVisualV1(
	input: RunReuseVisualInput,
): Promise<VisualSpecialistResult> {
	const tAll = Date.now();
	const budgets: VisualSpecialistBudgets = {
		...DEFAULT_VISUAL_SPECIALIST_BUDGETS,
		...input.budgets,
	};
	const engine = input.ocrEngine ?? (await resolveOcrEngine());
	const metrics = emptyMetrics(engine.id);
	const observations: VisualObservation[] = [];
	const crops: SourceResCrop[] = [];
	const ocrResults: OcrResult[] = [];
	const internalNotes: string[] = [];
	const ocrKeysSeen = new Set<string>();

	if (!input.videoPath) {
		metrics.totalMs = Date.now() - tAll;
		internalNotes.push("Reuse visual specialist skipped: no videoPath");
		return { version: 1, observations, crops, ocrResults, metrics, internalNotes };
	}

	const ffmpeg = input.ffmpegPath === null ? null : (input.ffmpegPath ?? resolveFfmpeg());
	const cacheDir =
		input.cacheDir ??
		path.join((await import("node:os")).tmpdir(), `openscreen-reuse-visual-${Date.now()}`);
	await fs.mkdir(cacheDir, { recursive: true });
	const ocrCache = new OcrResultCache(path.join(cacheDir, "ocr-cache"));

	const inv = input.investigation;
	const sourceSize = await probeVideoSize(input.videoPath, ffmpeg);
	let videoMtimeMs = 0;
	try {
		videoMtimeMs = (await fs.stat(input.videoPath)).mtimeMs;
	} catch {
		videoMtimeMs = 0;
	}

	// Focus window from investigator coverage / focus — never full-video OCR.
	const ranges = inv.coverage.rangesInspected;
	const rangeStart =
		ranges.length > 0
			? Math.min(...ranges.map((r) => r.startSourceTimeSec))
			: Math.max(0, inv.focusRange.endSourceTimeSec - 6);
	const rangeEnd =
		ranges.length > 0
			? Math.max(...ranges.map((r) => r.endSourceTimeSec))
			: inv.focusRange.endSourceTimeSec;

	const interactionTimes: number[] = [];
	for (const o of inv.observations) {
		if (o.kind === "roi" || o.kind === "frame" || o.kind === "range_frames") {
			if (typeof o.startSourceTimeSec === "number") interactionTimes.push(o.startSourceTimeSec);
			if (typeof o.endSourceTimeSec === "number") interactionTimes.push(o.endSourceTimeSec);
		}
	}
	for (const f of inv.additionalFrames) interactionTimes.push(f.sourceTimeSec);

	let sceneTimes: number[] = [];
	if (ffmpeg) {
		const tScene = Date.now();
		try {
			sceneTimes = await probeSceneTimesInRange({
				videoPath: input.videoPath,
				ffmpegPath: ffmpeg,
				startSourceTimeSec: rangeStart,
				endSourceTimeSec: rangeEnd,
			});
		} catch (err) {
			internalNotes.push(`scene probe failed: ${err instanceof Error ? err.message : String(err)}`);
		}
		metrics.sceneProbeMs = (metrics.sceneProbeMs ?? 0) + (Date.now() - tScene);
	}

	const samples = buildBoundedSampleCandidates({
		startSourceTimeSec: rangeStart,
		endSourceTimeSec: rangeEnd,
		changeTimesSec: input.changeTimesSec,
		interactionTimesSec: interactionTimes,
		sceneTimesSec: sceneTimes,
		maxCandidates: budgets.maxSpecialistFrames * 3,
	});

	// Prefer bottom HUD for temporary UI; top chrome once.
	const presets: CropPreset[] = ["bottom_center"];
	const notesBlob = inv.additionalFrames.map((f) => f.note).join(" ");
	if (/top_chrome/i.test(notesBlob) || samples.some((s) => s.sourceTimeSec <= rangeStart + 2)) {
		presets.push("top_chrome");
	}

	// Extract lightweight stills for dHash (full-frame mid-res) then crop OCR targets.
	const hashCandidates: DedupeCandidate[] = [];
	if (ffmpeg) {
		const tHash = Date.now();
		for (const s of samples.slice(0, budgets.maxSpecialistFrames * 2)) {
			if (metrics.imageBytes >= budgets.maxImageBytesTotal) break;
			try {
				const still = await extractSourceResolutionCrop({
					videoPath: input.videoPath,
					sourceTimeSec: s.sourceTimeSec,
					preset: "center",
					cacheDir,
					ffmpegPath: ffmpeg,
					sourceSize,
				});
				if (!still) continue;
				metrics.sourceCropMs += still.ms;
				metrics.imageBytes += still.byteLength;
				const hash = await dhashImage(still.imagePath, ffmpeg);
				hashCandidates.push({
					id: `cand_${s.sourceTimeSec}_${s.reason}`,
					sourceTimeSec: s.sourceTimeSec,
					imagePath: still.imagePath,
					hash,
					protected: s.protected || s.reason === "interaction",
					reason: s.reason,
				});
			} catch {
				hashCandidates.push({
					id: `cand_${s.sourceTimeSec}_${s.reason}`,
					sourceTimeSec: s.sourceTimeSec,
					protected: s.protected || s.reason === "interaction",
					reason: s.reason,
				});
			}
		}
		metrics.dhashMs = (metrics.dhashMs ?? 0) + (Date.now() - tHash);
	} else {
		for (const s of samples) {
			hashCandidates.push({
				id: `cand_${s.sourceTimeSec}_${s.reason}`,
				sourceTimeSec: s.sourceTimeSec,
				protected: s.protected || s.reason === "interaction",
				reason: s.reason,
			});
		}
	}

	metrics.candidatesBeforeDedupe = hashCandidates.length;
	const deduped = dedupeByDhash(hashCandidates, {
		maxKeep: budgets.maxSpecialistFrames,
	});
	metrics.candidatesAfterDedupe = deduped.afterCount;
	internalNotes.push(
		`reuse sampling: ${samples.length} signals → ${deduped.beforeCount} hashed → ${deduped.afterCount} after dHash (dropped ${deduped.dropped.length})`,
	);

	// Prefer protected/interaction times first (temporary HUD text), then later times.
	const timesForInspect = [...deduped.kept]
		.sort((a, b) => {
			const ap = a.protected ? 1 : 0;
			const bp = b.protected ? 1 : 0;
			if (bp !== ap) return bp - ap;
			return b.sourceTimeSec - a.sourceTimeSec;
		})
		.map((c) => c.sourceTimeSec);
	let inspections = 0;

	const runOcr = async (crop: SourceResCrop): Promise<OcrResult | null> => {
		if (ocrResults.length >= budgets.maxOcrCalls) return null;
		if (crops.filter((c) => c.fromSourceMedia).length > budgets.maxHighResRoiExtracted) {
			/* still allow OCR on already extracted */
		}
		const key = buildOcrCacheKey({
			videoPath: input.videoPath!,
			videoMtimeMs,
			sourceTimeSec: crop.sourceTimeSec,
			roi: crop.crop,
			engineId: engine.id,
		});
		if (ocrKeysSeen.has(key) && budgets.maxRepeatedOcrForSameEvidence <= 1) {
			internalNotes.push(`OCR skip repeat key @${crop.sourceTimeSec.toFixed(2)}s`);
			return null;
		}
		const cached = await ocrCache.get(key);
		if (cached) {
			metrics.ocrCacheHits = (metrics.ocrCacheHits ?? 0) + 1;
			metrics.ocrCalls += 1;
			metrics.ocrMs += cached.ms;
			ocrResults.push({ ...cached, cacheHit: true });
			ocrKeysSeen.add(key);
			return { ...cached, cacheHit: true };
		}
		metrics.ocrCacheMisses = (metrics.ocrCacheMisses ?? 0) + 1;

		let ocrPath = crop.imagePath;
		let prepMeta: OcrResult["preprocess"];
		if (ffmpeg && engine.id === "tesseract") {
			const prep = await preprocessForOcr({
				imagePath: crop.imagePath,
				cacheDir,
				ffmpegPath: ffmpeg,
			});
			metrics.preprocessMs = (metrics.preprocessMs ?? 0) + prep.ms;
			if (prep.applied) ocrPath = prep.imagePath;
			prepMeta = {
				version: prep.version,
				applied: prep.applied,
				inputWidth: prep.inputWidth || crop.width,
				inputHeight: prep.inputHeight || crop.height,
				outputWidth: prep.outputWidth || crop.width,
				outputHeight: prep.outputHeight || crop.height,
			};
		} else if (ffmpeg) {
			// Vision OCR: measure dims only; binary threshold hurts Apple Vision on HUD text.
			prepMeta = {
				version: OCR_PREPROCESS_VERSION,
				applied: false,
				inputWidth: crop.width,
				inputHeight: crop.height,
				outputWidth: crop.width,
				outputHeight: crop.height,
			};
		}
		const ocr = await engine.recognize(ocrPath);
		const enriched: OcrResult = {
			...ocr,
			preprocess: prepMeta,
		};
		metrics.ocrCalls += 1;
		metrics.ocrMs += enriched.ms;
		ocrResults.push(enriched);
		ocrKeysSeen.add(key);
		await ocrCache.set(key, enriched);
		return enriched;
	};

	const inspectOne = async (preset: CropPreset, inspectTime: number): Promise<void> => {
		if (inspections >= budgets.maxInspections) return;
		if (metrics.imageBytes >= budgets.maxImageBytesTotal) return;
		if (crops.length >= budgets.maxSourceResCrops) return;
		if (crops.length >= budgets.maxHighResRoiExtracted) return;
		inspections += 1;
		try {
			const crop = await extractSourceResolutionCrop({
				videoPath: input.videoPath!,
				sourceTimeSec: inspectTime,
				preset,
				cacheDir,
				ffmpegPath: ffmpeg,
				sourceSize,
			});
			if (!crop) return;
			metrics.sourceCropMs += crop.ms;
			metrics.sourceCrops += 1;
			metrics.imageBytes += crop.byteLength;
			crops.push(crop);

			observations.push({
				id: nextObsId(),
				kind: "ui_state",
				epistemic: "observed",
				text: `Source-resolution ${preset} crop at ${crop.sourceTimeSec.toFixed(2)}s (${crop.width}×${crop.height} from ${crop.sourceWidth}×${crop.sourceHeight} media). Pixels acquired — labels require OCR/recognition.`,
				sourceTimeSec: crop.sourceTimeSec,
				temporallyUncertain: true,
				region: {
					presetOrReason: `reuse:${preset}`,
					crop: crop.crop,
					fromSourceMedia: true,
					imagePath: crop.imagePath,
					width: crop.width,
					height: crop.height,
				},
				provenance: [
					{
						modality: "visual",
						sourceTimeSec: crop.sourceTimeSec,
						frameImagePath: crop.imagePath,
						note: `reuse_source_res_crop ${preset}`,
					},
				],
			});

			const ocr = await runOcr(crop);
			if (!ocr) return;
			const joined = joinedOcrText(ocr);
			const status = ocr.status ?? (joined ? "available" : ocr.error ? "failed" : "no_text");
			if (joined && status === "available") {
				observations.push({
					id: nextObsId(),
					kind: "visible_text",
					epistemic: "observed",
					text: `Readable text in ${preset} region at ${crop.sourceTimeSec.toFixed(2)}s: "${joined}". Visible text ≠ user action.`,
					sourceTimeSec: crop.sourceTimeSec,
					temporallyUncertain: true,
					region: {
						presetOrReason: `reuse:${preset}`,
						crop: crop.crop,
						fromSourceMedia: true,
						imagePath: crop.imagePath,
						width: crop.width,
						height: crop.height,
					},
					ocr: {
						engine: ocr.engine,
						lines: ocr.lines,
						joinedText: joined,
					},
					provenance: [
						{
							modality: "ocr",
							sourceTimeSec: crop.sourceTimeSec,
							frameImagePath: crop.imagePath,
							note: `engine=${ocr.engine};status=${status};cache=${ocr.cacheHit ? "hit" : "miss"}`,
						},
					],
				});
				internalNotes.push(
					`OCR(${preset}@${crop.sourceTimeSec.toFixed(2)}s, ${crop.width}×${crop.height}, source-res, ${status}): ${joined}`,
				);
				if (PASSIVE_APP_RE.test(joined)) {
					observations.push({
						id: nextObsId(),
						kind: "readability_note",
						epistemic: "observed",
						text: `OCR read an app/site name in chrome text — treat as passive visibility only; do NOT claim opened/navigated/worked-in without interaction/transition evidence.`,
						sourceTimeSec: crop.sourceTimeSec,
						provenance: [
							{
								modality: "ocr",
								sourceTimeSec: crop.sourceTimeSec,
								note: "passive_chrome_guard",
							},
						],
					});
				}
			} else {
				internalNotes.push(
					`OCR(${preset}@${crop.sourceTimeSec.toFixed(2)}s): status=${status} engine=${ocr.engine}${ocr.error ? `; ${ocr.error}` : ""}`,
				);
			}
		} catch (err) {
			internalNotes.push(
				`reuse crop/ocr failed ${preset}@${inspectTime}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	// Inspect protected/late times first (already sorted).
	const bottomTimes = timesForInspect.slice(0, Math.min(4, timesForInspect.length));
	// Always include explicit investigator ROI times for bottom HUD (temporary tooltips).
	const forcedRoiTimes = interactionTimes
		.filter((t) => t >= rangeStart && t <= rangeEnd)
		.map((t) => Math.round(t * 1000) / 1000);
	const orderedBottom = [...new Set([...forcedRoiTimes, ...bottomTimes])].slice(
		0,
		Math.min(4, budgets.maxOcrCalls),
	);
	for (const t of orderedBottom) {
		await inspectOne("bottom_center", t);
	}
	if (presets.includes("top_chrome") && inspections < budgets.maxInspections) {
		const early = timesForInspect.find((t) => t <= rangeStart + (rangeEnd - rangeStart) * 0.35);
		await inspectOne("top_chrome", early ?? timesForInspect[0] ?? rangeStart);
	}

	metrics.ocrCacheHits = ocrCache.hits;
	metrics.ocrCacheMisses = ocrCache.misses;
	metrics.totalMs = Date.now() - tAll;
	metrics.extraModelCalls = 0;
	return { version: 1, observations, crops, ocrResults, metrics, internalNotes };
}
