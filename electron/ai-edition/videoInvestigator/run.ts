/**
 * Master Video Investigator V1 — bounded deterministic runner.
 * 0 investigator model calls. May extract additional frames for the existing agent turn.
 */

import type { MediaContextNeeds } from "../mediaContextNeeds";
import type { SpeechEvidence } from "../speechEvidence/types";
import {
	buildLedgerFromPreparedEvidence,
	createVideoEvidenceStore,
	type TemporalEventLedger,
} from "../temporalEventLedger";
import { defaultVisualFrameCacheDir, type ExtractFrameDeps } from "../visualEvidence/extract";
import type { VisualChange, VisualEvidenceFrame } from "../visualEvidence/types";
import { buildInvestigatorInternalBriefing, truncateBriefing } from "./briefing";
import { planInvestigation, shouldRunInvestigator } from "./plan";
import {
	type InvestigatorToolContext,
	toolCompareVisualStates,
	toolGetCursorEvents,
	toolGetEventsInRange,
	toolGetEvidenceForEvent,
	toolGetTranscriptRange,
	toolInspectFrame,
	toolInspectRegion,
	toolInspectVideoRange,
} from "./tools";
import {
	DEFAULT_INVESTIGATION_BUDGETS,
	type InvestigationBudgets,
	type InvestigationEvidenceSet,
	type InvestigationMetrics,
	type InvestigationObservation,
	type InvestigationStopReason,
	type InvestigationToolTrace,
} from "./types";
import { verifyInvestigationClaims } from "./verify";

export interface RunInvestigatorInput {
	userMessage: string;
	needs: MediaContextNeeds;
	assetId: string;
	sourceDurationSec: number;
	videoPath: string | null;
	speechEvidence?: SpeechEvidence | null;
	frames?: VisualEvidenceFrame[];
	changes?: VisualChange[];
	cursorInteractions?: Array<{ sourceTimeSec: number; interactionType?: string }>;
	/** Optional prebuilt ledger; otherwise built from prepared evidence. */
	ledger?: TemporalEventLedger;
	extractDeps?: Partial<ExtractFrameDeps>;
	ffmpegPath?: string | null;
	budgets?: Partial<InvestigationBudgets>;
}

function emptyMetrics(): InvestigationMetrics {
	return {
		memoryQueryMs: 0,
		planningMs: 0,
		toolExecutionMs: 0,
		verificationMs: 0,
		totalInvestigationMs: 0,
		frameCacheHits: 0,
		frameCacheMisses: 0,
		newlyExtractedFrames: 0,
		roiExtractMs: 0,
		transcriptRetrievalMs: 0,
		cursorRetrievalMs: 0,
		investigatorModelCalls: 0,
		stepsUsed: 0,
		toolCalls: 0,
	};
}

export async function runMasterVideoInvestigatorV1(
	input: RunInvestigatorInput,
): Promise<InvestigationEvidenceSet | null> {
	const tAll = Date.now();
	const budgets: InvestigationBudgets = {
		...DEFAULT_INVESTIGATION_BUDGETS,
		...input.budgets,
	};

	if (!shouldRunInvestigator(input.needs)) {
		return {
			version: 1,
			assetId: input.assetId,
			timebase: "SOURCE_MEDIA_TIME",
			questionSummary: "Skipped — deterministic edit / no media investigation needed",
			focusRange: { startSourceTimeSec: 0, endSourceTimeSec: input.sourceDurationSec },
			stopReason: "deterministic_edit_skip",
			coverage: {
				sourceDurationSec: input.sourceDurationSec,
				rangesInspected: [],
				frameTimesSec: [],
				roiCount: 0,
				modalitiesTouched: [],
				absenceIsStrong: false,
			},
			observations: [],
			claims: [],
			toolTrace: [],
			metrics: { ...emptyMetrics(), totalInvestigationMs: Date.now() - tAll },
			internalBriefing: "",
			additionalFrames: [],
		};
	}

	const tMem = Date.now();
	const ledger =
		input.ledger ??
		buildLedgerFromPreparedEvidence({
			assetId: input.assetId,
			sourceDurationSec: input.sourceDurationSec,
			speechEvidence: input.speechEvidence,
			frames: input.frames,
			changes: input.changes,
			cursorInteractions: input.cursorInteractions,
		});
	const store = createVideoEvidenceStore(ledger);
	const memoryQueryMs = Date.now() - tMem;

	if (!ledger.events.length && !(input.sourceDurationSec > 0)) {
		return {
			version: 1,
			assetId: input.assetId,
			timebase: "SOURCE_MEDIA_TIME",
			questionSummary: "No ledger / duration",
			focusRange: { startSourceTimeSec: 0, endSourceTimeSec: 0 },
			stopReason: "no_ledger",
			coverage: {
				sourceDurationSec: 0,
				rangesInspected: [],
				frameTimesSec: [],
				roiCount: 0,
				modalitiesTouched: [],
				absenceIsStrong: false,
			},
			observations: [],
			claims: [],
			toolTrace: [],
			metrics: {
				...emptyMetrics(),
				memoryQueryMs,
				totalInvestigationMs: Date.now() - tAll,
			},
			internalBriefing: "",
			additionalFrames: [],
		};
	}

	const tPlan = Date.now();
	const { focus, actions } = planInvestigation({
		userMessage: input.userMessage,
		store,
		sourceDurationSec: input.sourceDurationSec,
		needs: input.needs,
	});
	const planningMs = Date.now() - tPlan;

	const cacheDir = input.extractDeps?.cacheDir ?? (await defaultVisualFrameCacheDir());
	const ctx: InvestigatorToolContext = {
		store,
		assetId: input.assetId,
		sourceDurationSec: input.sourceDurationSec,
		videoPath: input.videoPath,
		speechEvidence: input.speechEvidence,
		existingFrames: [...(input.frames ?? [])],
		cursorInteractions: input.cursorInteractions ?? [],
		extractDeps: {
			cacheDir,
			ffmpegPath: input.extractDeps?.ffmpegPath ?? input.ffmpegPath,
			runExtract: input.extractDeps?.runExtract,
		},
		ffmpegPath: input.extractDeps?.ffmpegPath ?? input.ffmpegPath,
	};

	const observations: InvestigationObservation[] = [];
	const toolTrace: InvestigationToolTrace[] = [];
	const rangesInspected: Array<{ startSourceTimeSec: number; endSourceTimeSec: number }> = [];
	const frameTimesSec: number[] = [];
	const additionalFrames: InvestigationEvidenceSet["additionalFrames"] = [];
	const modalities = new Set<InvestigationEvidenceSet["coverage"]["modalitiesTouched"][number]>();
	modalities.add("ledger");

	let obsSeq = 0;
	const pushObs = (o: Omit<InvestigationObservation, "id">) => {
		obsSeq += 1;
		observations.push({ id: `obs_${obsSeq}`, ...o });
	};

	const metrics = emptyMetrics();
	metrics.memoryQueryMs = memoryQueryMs;
	metrics.planningMs = planningMs;

	const rangeKeyCounts = new Map<string, number>();
	let frameInspections = 0;
	let rangeInspections = 0;
	let roiInspections = 0;
	let compareCalls = 0;
	let stopReason: InvestigationStopReason = "sufficient_evidence";
	let stepsUsed = 0;

	const tTools = Date.now();
	for (const action of actions) {
		if (stepsUsed >= budgets.maxSteps) {
			stopReason = "budget_exhausted";
			break;
		}
		stepsUsed += 1;
		const step = stepsUsed;
		const t0 = Date.now();

		try {
			if (action.tool === "get_events_in_range") {
				const r = toolGetEventsInRange(ctx, action.startSourceSec, action.endSourceSec);
				pushObs({
					kind: "ledger_events",
					startSourceTimeSec: action.startSourceSec,
					endSourceTimeSec: action.endSourceSec,
					text: `${r.summary}. ${action.why}`,
					evidence: r.events.flatMap((e) => e.evidence).slice(0, 12),
				});
				toolTrace.push({
					step,
					tool: action.tool,
					args: {
						startSourceSec: action.startSourceSec,
						endSourceSec: action.endSourceSec,
					},
					ok: true,
					summary: r.summary,
					ms: Date.now() - t0,
				});
			} else if (action.tool === "get_transcript_range") {
				const tr0 = Date.now();
				const r = toolGetTranscriptRange(ctx, action.startSourceSec, action.endSourceSec);
				metrics.transcriptRetrievalMs += Date.now() - tr0;
				modalities.add("speech");
				modalities.add("audio_state");
				pushObs({
					kind: "transcript",
					startSourceTimeSec: action.startSourceSec,
					endSourceTimeSec: action.endSourceSec,
					text: `${r.summary}. Texts: ${r.segments
						.map((s) => `"${s.text.slice(0, 80)}"`)
						.join(" | ")
						.slice(0, 500)}`,
					evidence: [
						{
							modality: "speech",
							sourceTimeSec: action.startSourceSec,
							endSourceTimeSec: action.endSourceSec,
							note: `speechStatus=${r.status}`,
						},
					],
				});
				toolTrace.push({
					step,
					tool: action.tool,
					args: {
						startSourceSec: action.startSourceSec,
						endSourceSec: action.endSourceSec,
					},
					ok: true,
					summary: r.summary,
					ms: Date.now() - t0,
				});
			} else if (action.tool === "get_cursor_events") {
				const c0 = Date.now();
				const r = toolGetCursorEvents(ctx, action.startSourceSec, action.endSourceSec);
				metrics.cursorRetrievalMs += Date.now() - c0;
				modalities.add("cursor");
				pushObs({
					kind: "cursor",
					startSourceTimeSec: action.startSourceSec,
					endSourceTimeSec: action.endSourceSec,
					text: r.summary,
					evidence: r.events.map((e) => ({
						modality: "cursor" as const,
						sourceTimeSec: e.sourceTimeSec,
						cursorTimeSec: e.sourceTimeSec,
						cursorInteractionType: e.interactionType,
					})),
				});
				toolTrace.push({
					step,
					tool: action.tool,
					args: {
						startSourceSec: action.startSourceSec,
						endSourceSec: action.endSourceSec,
					},
					ok: true,
					summary: r.summary,
					ms: Date.now() - t0,
				});
			} else if (action.tool === "get_evidence_for_event") {
				const r = toolGetEvidenceForEvent(ctx, action.eventId);
				pushObs({
					kind: "provenance",
					text: `${r.summary}. ${action.why}`,
					evidence: r.refs,
				});
				toolTrace.push({
					step,
					tool: action.tool,
					args: { eventId: action.eventId },
					ok: r.refs.length > 0,
					summary: r.summary,
					ms: Date.now() - t0,
				});
			} else if (action.tool === "inspect_frame") {
				if (frameInspections >= budgets.maxFrameInspections) {
					stopReason = "budget_exhausted";
					toolTrace.push({
						step,
						tool: action.tool,
						args: { sourceTimeSec: action.sourceTimeSec },
						ok: false,
						summary: "Skipped — frame inspection budget",
						ms: Date.now() - t0,
					});
					continue;
				}
				frameInspections += 1;
				modalities.add("visual");
				const r = await toolInspectFrame(ctx, action.sourceTimeSec);
				if (r.cacheHit) metrics.frameCacheHits += 1;
				else {
					metrics.frameCacheMisses += 1;
					if (r.frame) metrics.newlyExtractedFrames += 1;
				}
				if (r.frame) {
					frameTimesSec.push(r.frame.sourceTimeSec);
					const known = (input.frames ?? []).some(
						(f) => Math.abs(f.sourceTimeSec - r.frame!.sourceTimeSec) < 0.05,
					);
					if (!known) {
						additionalFrames.push({
							sourceTimeSec: r.frame.sourceTimeSec,
							imagePath: r.frame.imagePath,
							width: r.frame.width,
							height: r.frame.height,
							byteLength: r.frame.byteLength,
							note: "investigator frame inspect",
						});
					}
					pushObs({
						kind: "frame",
						startSourceTimeSec: r.frame.sourceTimeSec,
						endSourceTimeSec: r.frame.sourceTimeSec,
						text: r.summary,
						imagePath: r.frame.imagePath,
						evidence: [
							{
								modality: "visual",
								sourceTimeSec: r.frame.sourceTimeSec,
								frameSourceTimeSec: r.frame.sourceTimeSec,
								frameImagePath: r.frame.imagePath,
							},
						],
					});
				} else {
					pushObs({
						kind: "note",
						text: r.summary,
						evidence: [],
					});
				}
				toolTrace.push({
					step,
					tool: action.tool,
					args: { sourceTimeSec: action.sourceTimeSec },
					ok: Boolean(r.frame),
					summary: r.summary,
					ms: Date.now() - t0,
				});
			} else if (action.tool === "inspect_video_range") {
				const key = `${action.startSourceSec.toFixed(2)}-${action.endSourceSec.toFixed(2)}`;
				const seen = rangeKeyCounts.get(key) ?? 0;
				if (seen >= budgets.maxRepeatedRangeInspections) {
					toolTrace.push({
						step,
						tool: action.tool,
						args: { start: action.startSourceSec, end: action.endSourceSec },
						ok: false,
						summary: "Skipped — repeated range budget",
						ms: Date.now() - t0,
					});
					continue;
				}
				if (rangeInspections >= budgets.maxRangeInspections) {
					stopReason = "budget_exhausted";
					toolTrace.push({
						step,
						tool: action.tool,
						args: { start: action.startSourceSec, end: action.endSourceSec },
						ok: false,
						summary: "Skipped — range inspection budget",
						ms: Date.now() - t0,
					});
					continue;
				}
				rangeKeyCounts.set(key, seen + 1);
				rangeInspections += 1;
				modalities.add("visual");
				rangesInspected.push({
					startSourceTimeSec: action.startSourceSec,
					endSourceTimeSec: action.endSourceSec,
				});
				const r = await toolInspectVideoRange(
					ctx,
					action.startSourceSec,
					action.endSourceSec,
					action.detailLevel,
				);
				metrics.frameCacheHits += r.cacheHits;
				metrics.frameCacheMisses += r.cacheMisses;
				for (const f of r.frames) {
					frameTimesSec.push(f.sourceTimeSec);
					frameInspections += 1;
					const known = (input.frames ?? []).some(
						(x) => Math.abs(x.sourceTimeSec - f.sourceTimeSec) < 0.05,
					);
					if (!known) {
						metrics.newlyExtractedFrames += 1;
						additionalFrames.push({
							sourceTimeSec: f.sourceTimeSec,
							imagePath: f.imagePath,
							width: f.width,
							height: f.height,
							byteLength: f.byteLength,
							note: "investigator range sample",
						});
					}
				}
				pushObs({
					kind: "range_frames",
					startSourceTimeSec: action.startSourceSec,
					endSourceTimeSec: action.endSourceSec,
					text: `${r.summary}. ${action.why}`,
					evidence: r.frames.map((f) => ({
						modality: "visual" as const,
						sourceTimeSec: f.sourceTimeSec,
						frameSourceTimeSec: f.sourceTimeSec,
						frameImagePath: f.imagePath,
					})),
				});
				toolTrace.push({
					step,
					tool: action.tool,
					args: {
						startSourceSec: action.startSourceSec,
						endSourceSec: action.endSourceSec,
						detailLevel: action.detailLevel,
					},
					ok: true,
					summary: r.summary,
					ms: Date.now() - t0,
				});
			} else if (action.tool === "compare_visual_states") {
				if (compareCalls >= budgets.maxCompareCalls) {
					toolTrace.push({
						step,
						tool: action.tool,
						args: { t1: action.t1, t2: action.t2 },
						ok: false,
						summary: "Skipped — compare budget",
						ms: Date.now() - t0,
					});
					continue;
				}
				compareCalls += 1;
				modalities.add("visual");
				const r = await toolCompareVisualStates(ctx, action.t1, action.t2);
				pushObs({
					kind: "visual_compare",
					startSourceTimeSec: r.fromSourceTimeSec,
					endSourceTimeSec: r.toSourceTimeSec,
					text: r.summary,
					change:
						r.score != null && r.classification
							? {
									fromSourceTimeSec: r.fromSourceTimeSec,
									toSourceTimeSec: r.toSourceTimeSec,
									score: r.score,
									classification: r.classification,
								}
							: undefined,
					evidence: [
						{
							modality: "visual",
							changeFromSourceTimeSec: r.fromSourceTimeSec,
							changeToSourceTimeSec: r.toSourceTimeSec,
							changeClassification: r.classification ?? undefined,
							note: r.score != null ? `score=${r.score.toFixed(3)}` : undefined,
						},
					],
				});
				toolTrace.push({
					step,
					tool: action.tool,
					args: { t1: action.t1, t2: action.t2 },
					ok: r.score != null,
					summary: r.summary,
					ms: Date.now() - t0,
				});
			} else if (action.tool === "inspect_region") {
				if (roiInspections >= budgets.maxRoiInspections) {
					toolTrace.push({
						step,
						tool: action.tool,
						args: { sourceTimeSec: action.sourceTimeSec, preset: action.preset },
						ok: false,
						summary: "Skipped — ROI budget",
						ms: Date.now() - t0,
					});
					continue;
				}
				roiInspections += 1;
				modalities.add("visual");
				const r = await toolInspectRegion(ctx, action.sourceTimeSec, action.preset);
				metrics.roiExtractMs += r.ms;
				if (r.imagePath) {
					metrics.newlyExtractedFrames += 1;
					additionalFrames.push({
						sourceTimeSec: action.sourceTimeSec,
						imagePath: r.imagePath,
						width: r.width,
						height: r.height,
						byteLength: r.byteLength,
						note: `investigator ROI ${action.preset}`,
					});
					pushObs({
						kind: "roi",
						startSourceTimeSec: action.sourceTimeSec,
						endSourceTimeSec: action.sourceTimeSec,
						text: r.summary,
						imagePath: r.imagePath,
						evidence: [
							{
								modality: "visual",
								sourceTimeSec: action.sourceTimeSec,
								frameSourceTimeSec: action.sourceTimeSec,
								frameImagePath: r.imagePath,
								note: `roi=${action.preset}`,
							},
						],
					});
				} else {
					pushObs({ kind: "note", text: r.summary, evidence: [] });
				}
				toolTrace.push({
					step,
					tool: action.tool,
					args: { sourceTimeSec: action.sourceTimeSec, preset: action.preset },
					ok: Boolean(r.imagePath),
					summary: r.summary,
					ms: Date.now() - t0,
				});
			}
		} catch (err) {
			toolTrace.push({
				step,
				tool: action.tool,
				args: action as unknown as Record<string, unknown>,
				ok: false,
				summary: err instanceof Error ? err.message : String(err),
				ms: Date.now() - t0,
			});
		}

		metrics.toolCalls += 1;
	}
	metrics.toolExecutionMs = Date.now() - tTools;
	metrics.stepsUsed = stepsUsed;

	if (actions.length === 0) stopReason = "no_uncertainty";
	if (
		stopReason !== "budget_exhausted" &&
		observations.every((o) => o.kind === "ledger_events" || o.kind === "provenance")
	) {
		/* still ok — memory-only investigation */
	}

	const tVer = Date.now();
	const claims = verifyInvestigationClaims({
		store,
		observations,
		focusStart: focus.startSourceTimeSec,
		focusEnd: focus.endSourceTimeSec,
	});
	metrics.verificationMs = Date.now() - tVer;
	metrics.totalInvestigationMs = Date.now() - tAll;
	metrics.investigatorModelCalls = 0;

	const coverage = {
		sourceDurationSec: input.sourceDurationSec,
		rangesInspected,
		frameTimesSec: [...new Set(frameTimesSec.map((t) => Math.round(t * 1000) / 1000))],
		roiCount: roiInspections,
		modalitiesTouched: [...modalities],
		absenceIsStrong: false,
	};

	const partial: Omit<InvestigationEvidenceSet, "internalBriefing"> = {
		version: 1,
		assetId: input.assetId,
		timebase: "SOURCE_MEDIA_TIME",
		questionSummary: focus.questionSummary,
		focusRange: {
			startSourceTimeSec: focus.startSourceTimeSec,
			endSourceTimeSec: focus.endSourceTimeSec,
		},
		stopReason,
		coverage,
		observations,
		claims,
		toolTrace,
		metrics,
		additionalFrames,
	};

	const briefing = truncateBriefing(
		buildInvestigatorInternalBriefing(partial),
		budgets.maxBriefingChars,
	);

	return { ...partial, internalBriefing: briefing };
}

export { DEFAULT_INVESTIGATION_BUDGETS, shouldRunInvestigator };
