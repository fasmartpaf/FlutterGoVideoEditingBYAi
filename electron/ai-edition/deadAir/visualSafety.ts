/**
 * Visual activity assessment for Dead-Air V1.1.
 *
 * Order: prepared changes → Temporal Event Ledger → cursor → (optional) FFmpeg fallback.
 * Black/freeze are observations only — never unlock safeToPropose alone.
 */

import { readCursorSidecar } from "../../media/cursorSidecar";
import { createVideoEvidenceStore } from "../temporalEventLedger/store";
import type { TemporalEventLedger } from "../temporalEventLedger/types";
import type { VisualAnalysisV1 } from "../visualAnalysis/types";
import type { VisualChange } from "../visualEvidence/types";
import {
	probeBlackInRange,
	probeFreezeInRange,
	probeSceneChangesInRange,
} from "./ffmpegVisualProbes";
import type {
	VisualActivityAssessment,
	VisualActivityEvidence,
	VisualActivityKind,
	VisualActivityState,
	VisualActivityStrength,
} from "./visualActivityTypes";
import { LOCAL_DEAD_AIR_VISUAL_SAFETY_V1_1, VISUAL_SAFETY_VERSION } from "./visualActivityTypes";
import { DEFAULT_VISUAL_SAFETY_POLICY, type VisualSafetyPolicy } from "./visualPolicy";

/** Legacy hit shape retained for V1 test injection compatibility. */
export interface VisualActivityHit {
	kind: "cursor_interaction" | "ledger_event" | "marked_story_event";
	sourceTimeSec: number;
	note: string;
}

export interface CachedOcrObservation {
	sourceTimeSec: number;
	endSourceTimeSec?: number;
	id?: string;
	note?: string;
}

export interface AssessVisualActivityArgs {
	mediaPath: string;
	silenceStartSec: number;
	silenceEndSec: number;
	/** When set, assess primarily against proposed removal (keep-pause remainder excluded). */
	proposedTrimStartSec?: number | null;
	proposedTrimEndSec?: number | null;
	preparedChanges?: VisualChange[] | null;
	ledger?: TemporalEventLedger | null;
	ocrObservations?: CachedOcrObservation[] | null;
	policy?: VisualSafetyPolicy;
	/** Skip FFmpeg even if policy enables it (unit tests / known-sufficient evidence). */
	forceSkipFfmpegFallback?: boolean;
	/** Injected hits (tests) — treated as existing evidence. */
	injectedHits?: VisualActivityHit[] | null;
	/**
	 * When true, run FFmpeg fallback even if we already have uncertain/empty and
	 * caller intends a would-be-safe speech candidate.
	 */
	candidateWouldBeSpeechSafe?: boolean;
	/**
	 * Canonical VisualAnalysisV1 — when present and covering the silence window,
	 * scene/black/freeze are taken from analysis instead of re-decoding.
	 */
	visualAnalysis?: VisualAnalysisV1 | null;
}

let evSeq = 0;
function nextEvId(prefix: string): string {
	evSeq += 1;
	return `${prefix}_${evSeq}`;
}

export function resetVisualActivitySeqForTests(): void {
	evSeq = 0;
}

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
	return a0 < b1 - 1e-6 && a1 > b0 + 1e-6;
}

function inWindow(t: number, start: number, end: number, pad = 0): boolean {
	return t >= start - pad - 1e-6 && t <= end + pad + 1e-6;
}

function mkEvidence(args: {
	kind: VisualActivityKind;
	strength: VisualActivityStrength;
	source: VisualActivityEvidence["source"];
	startSec: number;
	endSec: number;
	note: string;
	refKind?: string;
	refId?: string;
}): VisualActivityEvidence {
	return {
		id: nextEvId("vae"),
		range: {
			timebase: "SOURCE_MEDIA_TIME",
			startSec: args.startSec,
			endSec: args.endSec,
		},
		source: args.source,
		kind: args.kind,
		strength: args.strength,
		evidenceRefs: [
			{
				kind: args.refKind ?? args.kind.toLowerCase(),
				id: args.refId ?? `${args.startSec.toFixed(3)}`,
				note: args.note,
			},
		],
		note: args.note,
	};
}

function assessNearEdge(
	eventStart: number,
	eventEnd: number,
	trimStart: number,
	trimEnd: number,
	pad: number,
): boolean {
	const nearStart =
		Math.abs(eventStart - trimStart) <= pad || Math.abs(eventEnd - trimStart) <= pad;
	const nearEnd = Math.abs(eventStart - trimEnd) <= pad || Math.abs(eventEnd - trimEnd) <= pad;
	const inside = overlaps(eventStart, eventEnd, trimStart, trimEnd);
	return inside || nearStart || nearEnd;
}

export async function collectCursorHits(args: {
	mediaPath: string;
	startSec: number;
	endSec: number;
	ignoreMove: boolean;
}): Promise<VisualActivityHit[]> {
	const hits: VisualActivityHit[] = [];
	try {
		const sidecar = await readCursorSidecar(args.mediaPath, {});
		if (!sidecar.found) return hits;
		for (const sample of sidecar.data.samples) {
			if (args.ignoreMove && sample.interactionType === "move") continue;
			const t = sample.timeMs / 1000;
			if (t >= args.startSec - 1e-3 && t <= args.endSec + 1e-3) {
				hits.push({
					kind: "cursor_interaction",
					sourceTimeSec: t,
					note: `cursor_${sample.interactionType}@${t.toFixed(3)}`,
				});
			}
		}
	} catch {
		/* missing sidecar ok */
	}
	return hits;
}

/** @deprecated Prefer assessVisualActivity — kept for V1 API. */
export async function collectVisualActivityInRange(args: {
	mediaPath: string;
	startSec: number;
	endSec: number;
}): Promise<VisualActivityHit[]> {
	return collectCursorHits({
		mediaPath: args.mediaPath,
		startSec: args.startSec,
		endSec: args.endSec,
		ignoreMove: true,
	});
}

/** @deprecated Prefer assessVisualActivity.state. */
export function hasBlockingVisualActivity(hits: VisualActivityHit[]): boolean {
	return hits.some((h) => h.kind === "cursor_interaction" || h.kind === "marked_story_event");
}

function deriveState(events: VisualActivityEvidence[]): {
	state: VisualActivityState;
	blockingReasons: string[];
} {
	const blocking = events.filter((e) => e.strength === "blocking");
	const uncertain = events.filter((e) => e.strength === "uncertain");
	const reasons: string[] = [];
	if (blocking.length > 0) {
		for (const e of blocking) {
			reasons.push(`visual_${e.kind.toLowerCase()}`);
		}
		return { state: "MATERIAL_VISUAL_ACTIVITY", blockingReasons: [...new Set(reasons)] };
	}
	if (uncertain.length > 0) {
		for (const e of uncertain) {
			reasons.push(`visual_uncertain_${e.kind.toLowerCase()}`);
		}
		return { state: "UNCERTAIN_VISUAL_ACTIVITY", blockingReasons: [...new Set(reasons)] };
	}
	return { state: "NO_MATERIAL_VISUAL_ACTIVITY", blockingReasons: [] };
}

export async function assessVisualActivity(
	args: AssessVisualActivityArgs,
): Promise<VisualActivityAssessment> {
	const policy = args.policy ?? DEFAULT_VISUAL_SAFETY_POLICY;
	const t0 = Date.now();
	const silenceStart = args.silenceStartSec;
	const silenceEnd = args.silenceEndSec;
	const trimStart = args.proposedTrimStartSec ?? silenceStart;
	const trimEnd = args.proposedTrimEndSec ?? silenceEnd;
	const edgePad = policy.visualEdgePaddingSec;

	const events: VisualActivityEvidence[] = [];
	const blackFreezeObservations: VisualActivityEvidence[] = [];
	let cursorHitCount = 0;
	let changeHitCount = 0;
	let ledgerHitCount = 0;
	let ocrHitCount = 0;
	let sceneHitCount = 0;

	const tExisting0 = Date.now();

	// --- A. Prepared Bug-3 changes ---
	for (const ch of args.preparedChanges ?? []) {
		if (!assessNearEdge(ch.fromSourceTimeSec, ch.toSourceTimeSec, trimStart, trimEnd, edgePad)) {
			continue;
		}
		if (ch.classification === "minimal") continue;
		changeHitCount += 1;
		if (ch.classification === "significant" && policy.blockSignificantChange) {
			events.push(
				mkEvidence({
					kind: "SIGNIFICANT_VISUAL_CHANGE",
					strength: "blocking",
					source: "prepared_visual_change",
					startSec: ch.fromSourceTimeSec,
					endSec: ch.toSourceTimeSec,
					note: `significant change score=${ch.score.toFixed(3)}`,
					refId: `chg_${ch.fromSourceTimeSec}_${ch.toSourceTimeSec}`,
				}),
			);
		} else if (ch.classification === "moderate") {
			events.push(
				mkEvidence({
					kind: "MODERATE_VISUAL_CHANGE",
					strength: "uncertain",
					source: "prepared_visual_change",
					startSec: ch.fromSourceTimeSec,
					endSec: ch.toSourceTimeSec,
					note: `moderate change score=${ch.score.toFixed(3)}`,
					refId: `chg_${ch.fromSourceTimeSec}_${ch.toSourceTimeSec}`,
				}),
			);
		}
	}

	const moderateCount = events.filter((e) => e.kind === "MODERATE_VISUAL_CHANGE").length;
	if (moderateCount >= policy.moderateDensityBlockCount) {
		for (const e of events) {
			if (e.kind === "MODERATE_VISUAL_CHANGE") e.strength = "blocking";
		}
	}

	// --- B. Temporal Event Ledger ---
	if (args.ledger) {
		const store = createVideoEvidenceStore(args.ledger);
		const visual = store.visualInRange(silenceStart, silenceEnd);
		const cursor = store.cursorInRange(silenceStart, silenceEnd);
		for (const ev of [...visual, ...cursor]) {
			if (
				!assessNearEdge(ev.startSourceTimeSec, ev.endSourceTimeSec, trimStart, trimEnd, edgePad) &&
				ev.type !== "cursor_interaction"
			) {
				continue;
			}
			ledgerHitCount += 1;
			if (ev.type === "cursor_interaction" && policy.blockCursorInteraction) {
				events.push(
					mkEvidence({
						kind: "CURSOR_INTERACTION",
						strength: "blocking",
						source: "temporal_event_ledger",
						startSec: ev.startSourceTimeSec,
						endSec: ev.endSourceTimeSec,
						note: ev.summary,
						refId: ev.id,
					}),
				);
			} else if (ev.type === "visual_transition") {
				const sig = /significant/i.test(ev.summary);
				events.push(
					mkEvidence({
						kind: sig ? "SIGNIFICANT_VISUAL_CHANGE" : "LEDGER_VISUAL_EVENT",
						strength: sig ? "blocking" : "uncertain",
						source: "temporal_event_ledger",
						startSec: ev.startSourceTimeSec,
						endSec: ev.endSourceTimeSec,
						note: ev.summary,
						refId: ev.id,
					}),
				);
			} else if (
				ev.type === "observed_visible_text" &&
				policy.blockVisibleTextChange &&
				assessNearEdge(ev.startSourceTimeSec, ev.endSourceTimeSec, trimStart, trimEnd, edgePad)
			) {
				ocrHitCount += 1;
				events.push(
					mkEvidence({
						kind: "VISIBLE_TEXT_CHANGE",
						strength: "blocking",
						source: "temporal_event_ledger",
						startSec: ev.startSourceTimeSec,
						endSec: ev.endSourceTimeSec,
						note: ev.summary,
						refId: ev.id,
					}),
				);
			} else if (
				(ev.type === "observed_ui_state" || ev.type === "observed_visual_diff") &&
				assessNearEdge(ev.startSourceTimeSec, ev.endSourceTimeSec, trimStart, trimEnd, edgePad)
			) {
				events.push(
					mkEvidence({
						kind: "LEDGER_VISUAL_EVENT",
						strength: "uncertain",
						source: "temporal_event_ledger",
						startSec: ev.startSourceTimeSec,
						endSec: ev.endSourceTimeSec,
						note: ev.summary,
						refId: ev.id,
					}),
				);
			}
		}
	}

	// --- C. Cached OCR observations (no new OCR run) ---
	for (const o of args.ocrObservations ?? []) {
		const end = o.endSourceTimeSec ?? o.sourceTimeSec;
		if (!assessNearEdge(o.sourceTimeSec, end, trimStart, trimEnd, edgePad)) continue;
		if (!policy.blockVisibleTextChange) continue;
		ocrHitCount += 1;
		events.push(
			mkEvidence({
				kind: "VISIBLE_TEXT_CHANGE",
				strength: "blocking",
				source: "cached_ocr",
				startSec: o.sourceTimeSec,
				endSec: end,
				note: o.note ?? "cached OCR text change in proposed removal",
				refId: o.id ?? `ocr_${o.sourceTimeSec}`,
			}),
		);
	}

	// --- D. Cursor sidecar (+ injected) ---
	const cursorHits =
		args.injectedHits ??
		(await collectCursorHits({
			mediaPath: args.mediaPath,
			startSec: silenceStart,
			endSec: silenceEnd,
			ignoreMove: policy.ignoreCursorMove,
		}));
	for (const hit of cursorHits) {
		if (!inWindow(hit.sourceTimeSec, silenceStart, silenceEnd)) continue;
		cursorHitCount += 1;
		if (hit.kind === "marked_story_event") {
			events.push(
				mkEvidence({
					kind: "MARKED_STORY_EVENT",
					strength: "blocking",
					source: "injected_test",
					startSec: hit.sourceTimeSec,
					endSec: hit.sourceTimeSec,
					note: hit.note,
				}),
			);
		} else if (policy.blockCursorInteraction) {
			events.push(
				mkEvidence({
					kind: "CURSOR_INTERACTION",
					strength: "blocking",
					source: hit.kind === "cursor_interaction" ? "cursor_sidecar" : "injected_test",
					startSec: hit.sourceTimeSec,
					endSec: hit.sourceTimeSec,
					note: hit.note,
				}),
			);
		}
	}

	const existingEvidenceMs = Date.now() - tExisting0;
	let usedFfmpegFallback = false;
	let ffmpegFallbackMs = 0;

	const analysis = args.visualAnalysis ?? null;
	const analysisCovers =
		analysis != null &&
		analysis.analysisCoverage.startSec <= silenceStart + 1e-3 &&
		analysis.analysisCoverage.endSec >= silenceEnd - 1e-3;

	/** Prefer canonical analysis scene/black/freeze over per-silence decode. */
	if (analysis && analysisCovers) {
		const pad = policy.ffmpegProbePaddingSec;
		const probeStart = Math.max(0, silenceStart - pad);
		const probeEnd = silenceEnd + pad;
		for (const s of analysis.sceneEvents) {
			if (s.timeSec < probeStart - 1e-6 || s.timeSec > probeEnd + 1e-6) continue;
			if (!assessNearEdge(s.timeSec, s.timeSec, trimStart, trimEnd, edgePad)) continue;
			sceneHitCount += 1;
			events.push(
				mkEvidence({
					kind: "SCENE_CHANGE",
					strength: "blocking",
					source: "ffmpeg_scene_select",
					startSec: s.timeSec,
					endSec: s.timeSec,
					note: `visual_analysis_v1 scene @ ${s.timeSec.toFixed(3)}`,
				}),
			);
		}
		if (policy.enableBlackFreezeProbe) {
			for (const iv of analysis.blackIntervals) {
				if (!overlaps(iv.startSec, iv.endSec, probeStart, probeEnd)) continue;
				blackFreezeObservations.push(
					mkEvidence({
						kind: "BLACK_FRAME",
						strength: "observational",
						source: "ffmpeg_blackdetect",
						startSec: iv.startSec,
						endSec: iv.endSec,
						note: `visual_analysis_v1 black ${iv.durationSec.toFixed(3)}s`,
					}),
				);
			}
			for (const iv of analysis.freezeIntervals) {
				if (!overlaps(iv.startSec, iv.endSec, probeStart, probeEnd)) continue;
				blackFreezeObservations.push(
					mkEvidence({
						kind: "FREEZE",
						strength: "observational",
						source: "ffmpeg_freezedetect",
						startSec: iv.startSec,
						endSec: iv.endSec,
						note: `visual_analysis_v1 freeze ${iv.durationSec.toFixed(3)}s`,
					}),
				);
			}
		}
	}

	const preliminary = deriveState(events);
	const needFallback =
		policy.enableScdetFallback &&
		!args.forceSkipFfmpegFallback &&
		!analysisCovers &&
		args.candidateWouldBeSpeechSafe !== false &&
		preliminary.state === "NO_MATERIAL_VISUAL_ACTIVITY" &&
		(args.preparedChanges == null || args.preparedChanges.length === 0);

	// Also run fallback when we have no prepared evidence and policy prefers confirming stability
	const runFallback =
		needFallback ||
		(policy.enableScdetFallback &&
			!args.forceSkipFfmpegFallback &&
			!analysisCovers &&
			preliminary.state === "NO_MATERIAL_VISUAL_ACTIVITY" &&
			args.candidateWouldBeSpeechSafe === true);

	if (runFallback) {
		usedFfmpegFallback = true;
		const tFf0 = Date.now();
		const pad = policy.ffmpegProbePaddingSec;
		const probeStart = Math.max(0, silenceStart - pad);
		const probeEnd = silenceEnd + pad;

		const scene = await probeSceneChangesInRange({
			mediaPath: args.mediaPath,
			startSec: probeStart,
			endSec: probeEnd,
			sceneThreshold: policy.sceneThreshold,
			timeoutMs: policy.ffmpegTimeoutMs,
		});
		for (const t of scene.times) {
			if (!assessNearEdge(t, t, trimStart, trimEnd, edgePad)) continue;
			sceneHitCount += 1;
			events.push(
				mkEvidence({
					kind: "SCENE_CHANGE",
					strength: "blocking",
					source: "ffmpeg_scene_select",
					startSec: t,
					endSec: t,
					note: `scene score > ${policy.sceneThreshold} @ ${t.toFixed(3)}`,
				}),
			);
		}

		if (policy.enableBlackFreezeProbe) {
			const black = await probeBlackInRange({
				mediaPath: args.mediaPath,
				startSec: probeStart,
				endSec: probeEnd,
				timeoutMs: policy.ffmpegTimeoutMs,
			});
			for (const iv of black.intervals) {
				const obs = mkEvidence({
					kind: "BLACK_FRAME",
					strength: "observational",
					source: "ffmpeg_blackdetect",
					startSec: iv.startSec,
					endSec: iv.endSec,
					note: `blackdetect ${iv.durationSec.toFixed(3)}s`,
				});
				blackFreezeObservations.push(obs);
			}
			const freeze = await probeFreezeInRange({
				mediaPath: args.mediaPath,
				startSec: probeStart,
				endSec: probeEnd,
				timeoutMs: policy.ffmpegTimeoutMs,
			});
			for (const iv of freeze.intervals) {
				const obs = mkEvidence({
					kind: "FREEZE",
					strength: "observational",
					source: "ffmpeg_freezedetect",
					startSec: iv.startSec,
					endSec: iv.endSec,
					note: `freezedetect ${iv.durationSec.toFixed(3)}s`,
				});
				blackFreezeObservations.push(obs);
			}
		}
		ffmpegFallbackMs = Date.now() - tFf0;
	}

	const final = deriveState(events);
	return {
		version: VISUAL_SAFETY_VERSION,
		providerId: LOCAL_DEAD_AIR_VISUAL_SAFETY_V1_1,
		state: final.state,
		events,
		blockingReasons: final.blockingReasons,
		usedFfmpegFallback,
		blackFreezeObservations,
		latencyMs: Date.now() - t0,
		diagnostics: {
			existingEvidenceMs,
			ffmpegFallbackMs,
			cursorHitCount,
			changeHitCount,
			ledgerHitCount,
			ocrHitCount,
			sceneHitCount,
		},
	};
}

export function visualAssessmentBlocksSafePropose(assessment: VisualActivityAssessment): boolean {
	return (
		assessment.state === "MATERIAL_VISUAL_ACTIVITY" ||
		assessment.state === "UNCERTAIN_VISUAL_ACTIVITY"
	);
}
