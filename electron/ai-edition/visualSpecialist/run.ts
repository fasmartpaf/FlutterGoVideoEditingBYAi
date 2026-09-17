/**
 * Visual Evidence Specialist V1 — bounded perception over acquired evidence.
 * 0 extra LLM calls. OCR via platform adapter when available.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveFfmpeg } from "../../media/audioPeaks";
import type { InvestigationEvidenceSet } from "../videoInvestigator/types";
import {
	classifyChangeScore,
	decodeGrayThumbnail,
	scoreGrayThumbnails,
} from "../visualEvidence/change";
import { hottestChangeBlock } from "./changeHeat";
import { type OcrEngine, resolveOcrEngine } from "./ocr/engine";
import { type CropPreset, extractSourceResolutionCrop, probeVideoSize } from "./sourceCrop";
import {
	DEFAULT_VISUAL_SPECIALIST_BUDGETS,
	type OcrResult,
	type SourceResCrop,
	type VisualObservation,
	type VisualSpecialistBudgets,
	type VisualSpecialistMetrics,
	type VisualSpecialistResult,
} from "./types";

export interface RunVisualSpecialistInput {
	videoPath: string | null;
	investigation: InvestigationEvidenceSet;
	cacheDir?: string;
	ffmpegPath?: string | null;
	ocrEngine?: OcrEngine;
	budgets?: Partial<VisualSpecialistBudgets>;
}

let obsSeq = 0;
function nextObsId(): string {
	obsSeq += 1;
	return `vo_${obsSeq}`;
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
	};
}

function joinedOcrText(ocr: OcrResult): string {
	return ocr.lines
		.map((l) => l.text)
		.filter(Boolean)
		.join(" · ");
}

/**
 * Passive-chrome / navigation keywords — OCR of these must stay visibility-only.
 */
const PASSIVE_APP_RE = /\b(upwork|twitter|chatgpt|gmail|youtube)\b/i;

export async function runVisualSpecialistV1(
	input: RunVisualSpecialistInput,
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

	if (!input.videoPath) {
		metrics.totalMs = Date.now() - tAll;
		internalNotes.push("Visual specialist skipped: no videoPath");
		return { version: 1, observations, crops, ocrResults, metrics, internalNotes };
	}

	const ffmpeg = input.ffmpegPath === null ? null : (input.ffmpegPath ?? resolveFfmpeg());
	const cacheDir =
		input.cacheDir ??
		path.join((await import("node:os")).tmpdir(), `openscreen-visual-specialist-${Date.now()}`);
	await fs.mkdir(cacheDir, { recursive: true });

	const sourceSize = await probeVideoSize(input.videoPath, ffmpeg);
	const inv = input.investigation;

	// Candidate inspection times: ROI observations + late frame samples + focus end.
	const candidateTimes = new Set<number>();
	for (const o of inv.observations) {
		if (o.kind === "roi" || o.kind === "frame" || o.kind === "range_frames") {
			if (typeof o.startSourceTimeSec === "number") {
				candidateTimes.add(Math.round(o.startSourceTimeSec * 1000) / 1000);
			}
			if (typeof o.endSourceTimeSec === "number") {
				candidateTimes.add(Math.round(o.endSourceTimeSec * 1000) / 1000);
			}
		}
	}
	for (const f of inv.additionalFrames) {
		candidateTimes.add(Math.round(f.sourceTimeSec * 1000) / 1000);
	}
	if (candidateTimes.size === 0 && inv.focusRange.endSourceTimeSec > 0) {
		candidateTimes.add(
			Math.round(Math.max(0, inv.focusRange.endSourceTimeSec - 0.5) * 1000) / 1000,
		);
	}

	const sortedTimes = [...candidateTimes].sort((a, b) => a - b).slice(0, 8);

	// Prefer presets already used by investigator ROI notes; always include bottom+top once.
	const presets: CropPreset[] = [];
	const roiNotes = inv.additionalFrames.map((f) => f.note).join(" ");
	if (/bottom_center/i.test(roiNotes)) presets.push("bottom_center");
	if (/top_chrome/i.test(roiNotes)) presets.push("top_chrome");
	if (presets.length === 0) {
		presets.push("bottom_center", "top_chrome");
	}

	// Multiple late-window sample times — temporary UI may exist only in a
	// narrow interval (sparse samples). Do not hard-code case timestamps.
	const dur = inv.coverage.sourceDurationSec || inv.focusRange.endSourceTimeSec;
	const lateStart = Math.max(0, dur - Math.min(6, Math.max(2.5, dur * 0.3)));
	const span = Math.max(0.1, dur - lateStart);
	const lateSeed = [
		...sortedTimes.filter((t) => t >= lateStart),
		// Dense fractional samples — temporary HUD tooltips are brief.
		...[0.2, 0.4, 0.55, 0.7, 0.85, 0.95].map((f) => lateStart + span * f),
	]
		.map((t) => Math.round(Math.min(dur - 0.05, Math.max(0, t)) * 1000) / 1000)
		.filter((t, i, arr) => arr.indexOf(t) === i)
		.sort((a, b) => a - b);

	// Prefer the middle/late portion of the late window (tooltips often mid-HUD dwell).
	const midLate = lateSeed.filter((t) => t >= lateStart + span * 0.35 && t <= dur - 0.25);
	const timesForBottom = (midLate.length > 0 ? midLate : lateSeed).slice(-4);
	const earlyTimes = sortedTimes.filter((t) => t <= Math.min(4, dur * 0.25));
	const timeForChrome =
		earlyTimes[0] ??
		lateSeed.find((t) => t <= lateStart + (dur - lateStart) * 0.5) ??
		lateSeed[0] ??
		Math.max(0, dur - 0.5);

	let inspections = 0;

	const inspectOne = async (preset: CropPreset, inspectTime: number): Promise<void> => {
		if (metrics.imageBytes >= budgets.maxImageBytesTotal) return;
		if (crops.length >= budgets.maxSourceResCrops) return;
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
					presetOrReason: preset,
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
						note: `source_res_crop ${preset}`,
					},
				],
			});

			if (ocrResults.length < budgets.maxOcrCalls) {
				const ocr = await engine.recognize(crop.imagePath);
				metrics.ocrMs += ocr.ms;
				metrics.ocrCalls += 1;
				ocrResults.push(ocr);
				const joined = joinedOcrText(ocr);
				if (joined) {
					observations.push({
						id: nextObsId(),
						kind: "visible_text",
						epistemic: "observed",
						text: `Readable text in ${preset} region at ${crop.sourceTimeSec.toFixed(2)}s: "${joined}". Visible text ≠ user action.`,
						sourceTimeSec: crop.sourceTimeSec,
						temporallyUncertain: true,
						region: {
							presetOrReason: preset,
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
								note: `engine=${ocr.engine}`,
							},
						],
					});
					internalNotes.push(
						`OCR(${preset}@${crop.sourceTimeSec.toFixed(2)}s, ${crop.width}×${crop.height}, source-res): ${joined}`,
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
						`OCR(${preset}@${crop.sourceTimeSec.toFixed(2)}s): no readable lines (engine=${ocr.engine}${ocr.error ? `; ${ocr.error}` : ""})`,
					);
				}
			}
		} catch (err) {
			internalNotes.push(
				`crop/ocr failed ${preset}@${inspectTime}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	// Bottom / HUD first — temporary tooltips are brief; spend OCR budget here.
	for (const t of timesForBottom) {
		if (inspections >= budgets.maxInspections) break;
		if (crops.length >= budgets.maxSourceResCrops) break;
		inspections += 1;
		await inspectOne("bottom_center", t);
	}

	// Top chrome after — menus/titles when OCR budget remains.
	if (presets.includes("top_chrome") && inspections < budgets.maxInspections) {
		inspections += 1;
		await inspectOne("top_chrome", timeForChrome);
	}

	// Before/after pair near focus end when we have two sample times ≥1s apart.
	if (ffmpeg && metrics.beforeAfterPairs < budgets.maxBeforeAfterPairs && sortedTimes.length >= 2) {
		const t2 = sortedTimes[sortedTimes.length - 1]!;
		const earlier = sortedTimes.filter((t) => t2 - t >= 1.0);
		const t1 = earlier[earlier.length - 1] ?? sortedTimes[sortedTimes.length - 2]!;
		if (t2 - t1 >= 0.8) {
			const tDiff = Date.now();
			try {
				const before = await extractSourceResolutionCrop({
					videoPath: input.videoPath,
					sourceTimeSec: t1,
					preset: "bottom_center",
					cacheDir,
					ffmpegPath: ffmpeg,
					sourceSize,
				});
				const after = await extractSourceResolutionCrop({
					videoPath: input.videoPath,
					sourceTimeSec: t2,
					preset: "bottom_center",
					cacheDir,
					ffmpegPath: ffmpeg,
					sourceSize,
				});
				if (before && after) {
					metrics.sourceCropMs += before.ms + after.ms;
					metrics.sourceCrops += 2;
					metrics.imageBytes += before.byteLength + after.byteLength;
					crops.push(before, after);
					const ga = await decodeGrayThumbnail(before.imagePath, ffmpeg);
					const gb = await decodeGrayThumbnail(after.imagePath, ffmpeg);
					const score = scoreGrayThumbnails(ga, gb);
					const classification = classifyChangeScore(score);
					const hot = hottestChangeBlock(ga, gb);
					metrics.beforeAfterPairs += 1;

					observations.push({
						id: nextObsId(),
						kind: "visual_diff",
						epistemic: "observed",
						text: `Bottom-region pixel difference ${t1.toFixed(2)}s→${t2.toFixed(2)}s score=${score.toFixed(3)} (${classification}). Exact onset uncertain within this interval. Not an action label.`,
						sourceTimeSec: t1,
						endSourceTimeSec: t2,
						temporallyUncertain: true,
						diff: {
							fromSourceTimeSec: t1,
							toSourceTimeSec: t2,
							score,
							classification,
						},
						provenance: [
							{
								modality: "visual",
								sourceTimeSec: t1,
								frameImagePath: before.imagePath,
							},
							{
								modality: "visual",
								sourceTimeSec: t2,
								frameImagePath: after.imagePath,
							},
						],
					});

					if (classification !== "minimal" && crops.length < budgets.maxSourceResCrops) {
						const hotCrop = await extractSourceResolutionCrop({
							videoPath: input.videoPath,
							sourceTimeSec: t2,
							preset: "change_hotspot",
							cacheDir,
							ffmpegPath: ffmpeg,
							sourceSize,
							hotspot: { xFrac: hot.xFrac, yFrac: hot.yFrac },
						});
						if (hotCrop && ocrResults.length < budgets.maxOcrCalls) {
							metrics.sourceCrops += 1;
							metrics.sourceCropMs += hotCrop.ms;
							metrics.imageBytes += hotCrop.byteLength;
							crops.push(hotCrop);
							const ocr = await engine.recognize(hotCrop.imagePath);
							metrics.ocrCalls += 1;
							metrics.ocrMs += ocr.ms;
							ocrResults.push(ocr);
							const joined = joinedOcrText(ocr);
							if (joined) {
								observations.push({
									id: nextObsId(),
									kind: "temporary_ui_interval",
									epistemic: "observed",
									text: `Temporary UI text appears in supported interval ${t1.toFixed(2)}–${t2.toFixed(2)}s (change-localized source crop). Readable: "${joined}". Onset not exact; visibility only.`,
									sourceTimeSec: t1,
									endSourceTimeSec: t2,
									temporallyUncertain: true,
									ocr: { engine: ocr.engine, lines: ocr.lines, joinedText: joined },
									region: {
										presetOrReason: "change_hotspot",
										crop: hotCrop.crop,
										fromSourceMedia: true,
										imagePath: hotCrop.imagePath,
										width: hotCrop.width,
										height: hotCrop.height,
									},
									provenance: [
										{
											modality: "ocr",
											sourceTimeSec: t2,
											frameImagePath: hotCrop.imagePath,
											note: "before_after_hotspot",
										},
									],
								});
								internalNotes.push(
									`before/after OCR(${t1.toFixed(2)}→${t2.toFixed(2)}): ${joined}`,
								);
							}
						}
					}
				}
			} catch (err) {
				internalNotes.push(
					`before/after failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
			metrics.diffMs += Date.now() - tDiff;
		}
	}

	metrics.totalMs = Date.now() - tAll;
	metrics.extraModelCalls = 0;
	return { version: 1, observations, crops, ocrResults, metrics, internalNotes };
}

/**
 * Merge specialist results into InvestigationEvidenceSet (additive).
 */
export function mergeSpecialistIntoInvestigation(
	investigation: InvestigationEvidenceSet,
	specialist: VisualSpecialistResult,
): InvestigationEvidenceSet {
	const observations = [
		...investigation.observations,
		...specialist.observations.map((o) => ({
			id: o.id,
			kind: "note" as const,
			startSourceTimeSec: o.sourceTimeSec,
			endSourceTimeSec: o.endSourceTimeSec,
			text: o.text,
			evidence: o.provenance.map((p) => ({
				modality:
					p.modality === "ocr"
						? ("visual" as const)
						: p.modality === "model_semantic"
							? ("model_semantic" as const)
							: ("visual" as const),
				sourceTimeSec: p.sourceTimeSec,
				frameImagePath: p.frameImagePath,
				note: p.note,
			})),
			imagePath: o.region?.imagePath,
		})),
	];

	const additionalFrames = [
		...investigation.additionalFrames,
		...specialist.crops.map((c) => ({
			sourceTimeSec: c.sourceTimeSec,
			imagePath: c.imagePath,
			width: c.width,
			height: c.height,
			byteLength: c.byteLength,
			note: `visual-specialist source-res ${c.presetOrReason}`,
		})),
	];

	const notes = specialist.internalNotes;
	const heading =
		specialist.metrics.providerId === "CURRENT_OPENSCREEN_REUSE_VISUAL_V1"
			? "REUSE_VISUAL_V1 (internal — do not dump OCR JSON to the user)"
			: "VISUAL_SPECIALIST_V1 (internal — do not dump OCR JSON to the user)";
	const briefingExtra =
		specialist.observations.length > 0 || notes.length > 0
			? [
					"",
					heading,
					"OCR/visible text is OBSERVED visibility only — never an automatic user action.",
					...notes.map((n) => `- ${n}`),
				].join("\n")
			: "";

	return {
		...investigation,
		observations,
		additionalFrames,
		internalBriefing: briefingExtra
			? `${investigation.internalBriefing}\n${briefingExtra}`
			: investigation.internalBriefing,
		metrics: {
			...investigation.metrics,
			newlyExtractedFrames:
				investigation.metrics.newlyExtractedFrames + specialist.metrics.sourceCrops,
			totalInvestigationMs: investigation.metrics.totalInvestigationMs + specialist.metrics.totalMs,
		},
	};
}
