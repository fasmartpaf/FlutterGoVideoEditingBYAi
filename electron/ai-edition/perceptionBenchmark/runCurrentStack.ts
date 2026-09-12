/**
 * Run CURRENT OpenScreen perception stack against a ground-truth case.
 * No sampling changes. No provider swaps. No Target Story.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { candidateBinaryPaths } from "../../stt/gpuDetector";
import { SttManager } from "../../stt/index";
import { invokeOpenScreenAgent, type OpenScreenAgentSink } from "../deep-agent/service";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import {
	extractSourceStoryJson,
	parseAndValidateSourceStory,
	prepareSourceStoryForTurn,
	wantsSourceStory,
} from "../sourceStory";
import { probeSourceDurations, resolveFfprobe } from "../sourceTiming";
import { stripInternalEvidenceJsonBlocks } from "../speechEvidence/format";
import { prepareSpeechEvidenceForTurn } from "../speechEvidence/prepare";
import {
	buildLedgerFromPreparedEvidence,
	writeLedgerDiagnosticArtifact,
} from "../temporalEventLedger";
import { prepareVisualEvidenceForTurn } from "../visualEvidence/prepare";
import { resolveCorpusMedia } from "./corpus";
import {
	evaluateMultimodal,
	evaluateSpeech,
	evaluateVisual,
	observationsFromEvidence,
} from "./evaluate";
import { buildResultSkeleton, scoreEvent, scoreHallucinations, summarizeRecall } from "./score";
import type {
	PerceptionBenchmarkResult,
	PerceptionGroundTruth,
	PerceptionRunEvidence,
	PerceptionRunLatency,
} from "./types";

const FFMPEG = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");
const DEFAULT_OUT = path.join(process.cwd(), "tmp/perception-benchmark/runs");

const DEFAULT_PROMPT =
	"Watch and understand this complete recording, including what I say and what is happening visually. Tell me what the recording is actually about and how it progresses from beginning to end. I want the main stages of the story, not a frame-by-frame dump or transcript copy.";

const SILENT_PROMPT =
	"Understand what is happening in this recording from beginning to end. Include cursor/interaction if relevant.";

const CONTRADICTION_PROMPT =
	"Tell me what is happening in this recording, including what I'm explaining.";

export function loadOpenAiKey(): string {
	const fromEnv = process.env.OPENAI_API_KEY?.trim();
	if (fromEnv) return fromEnv;
	const candidates = [
		path.join(process.cwd(), "tmp/bug6-live-validation/.env.openai"),
		path.join(process.cwd(), "tmp/perception-benchmark/.env.openai"),
	];
	for (const p of candidates) {
		if (!existsSync(p)) continue;
		const raw = readFileSync(p, "utf8");
		const m = raw.match(/^\s*OPENAI_API_KEY\s*=\s*(.+)\s*$/m);
		if (m?.[1]) return m[1]!.trim().replace(/^["']|["']$/g, "");
	}
	return "";
}

function whisperBinary(): string | null {
	return (
		process.env.OPENSCREEN_WHISPER_SERVER_EXE?.trim() ||
		candidateBinaryPaths().find((p) => p && existsSync(p)) ||
		path.join(process.cwd(), "electron/native/bin/darwin-arm64/whisper-stt-server")
	);
}

function buildDoc(
	videoPath: string,
	durationSec: number,
	title: string,
	opts?: { webcamPath?: string | null },
) {
	const CREATED = "2026-01-01T00:00:00.000Z";
	const base = createEmptyDocument({ title, projectId: `proj_${title}`, createdAt: CREATED });
	const assets: Array<Record<string, unknown>> = [
		{
			id: "asset_1",
			label: title,
			kind: "video",
			originalPath: videoPath,
			durationSec,
			width: 1920,
			height: 1080,
		},
	];
	if (opts?.webcamPath && existsSync(opts.webcamPath)) {
		assets.push({
			id: "asset_webcam",
			label: `${title}-webcam`,
			kind: "video",
			originalPath: opts.webcamPath,
			durationSec,
			width: 1280,
			height: 720,
		});
	}
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets,
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId: "asset_1",
					sourceStartSec: 0,
					sourceEndSec: durationSec,
					timelineStartSec: 0,
					timelineEndSec: durationSec,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
			trimRanges: [],
		},
	});
}

function makeSink() {
	let raw = "";
	const sink: OpenScreenAgentSink = {
		text: (delta) => {
			raw += delta;
		},
		thinking: () => undefined,
		toolStart: () => undefined,
		toolEnd: () => undefined,
		error: () => undefined,
	};
	return { sink, getRaw: () => raw };
}

function sttDeps(cacheDir: string) {
	const BIN = whisperBinary();
	return {
		cacheDir,
		ffmpegPath: FFMPEG,
		ffprobePath: resolveFfprobe(),
		getSttManager: () => {
			const mgr = new SttManager();
			void mgr.init({
				modelsBaseDir: path.join(os.homedir(), "Library/Application Support/openscreen/stt-models"),
			});
			return mgr;
		},
		resolveSttBinary: () => BIN,
	};
}

function readCursorStats(cursorPath: string | null | undefined): {
	cursorEventCount: number;
	cursorNonMoveCount: number;
	cursorPreparationMs: number;
} {
	const t0 = Date.now();
	if (!cursorPath || !existsSync(cursorPath)) {
		return { cursorEventCount: 0, cursorNonMoveCount: 0, cursorPreparationMs: Date.now() - t0 };
	}
	try {
		const raw = JSON.parse(readFileSync(cursorPath, "utf8")) as {
			samples?: Array<{ interactionType?: string }>;
		};
		const samples = raw.samples ?? [];
		const nonMove = samples.filter((s) => s.interactionType && s.interactionType !== "move").length;
		return {
			cursorEventCount: samples.length,
			cursorNonMoveCount: nonMove,
			cursorPreparationMs: Date.now() - t0,
		};
	} catch {
		return { cursorEventCount: 0, cursorNonMoveCount: 0, cursorPreparationMs: Date.now() - t0 };
	}
}

function promptForCase(gt: PerceptionGroundTruth): string {
	if (gt.caseId.includes("contradiction")) return CONTRADICTION_PROMPT;
	if (gt.caseId.includes("silent")) return SILENT_PROMPT;
	return DEFAULT_PROMPT;
}

function injectContradictionTranscript(
	document: ReturnType<typeof documentSchema.parse>,
	gt: PerceptionGroundTruth,
) {
	if (!gt.caseId.includes("contradiction")) return document;
	const line = gt.referenceSpeech?.[0];
	if (!line) return document;
	return documentSchema.parse({
		...document,
		transcripts: [
			{
				assetId: "asset_1",
				language: "en",
				segments: [
					{
						id: "seg_1",
						kind: "speech",
						startSec: line.startSec,
						endSec: line.endSec,
						text: line.text,
						wordIds: [],
					},
				],
				words: [],
			},
		],
	});
}

export interface RunCaseOptions {
	providerRunId?: string;
	outRoot?: string;
	apiKey?: string;
	model?: string;
	/** Force warm by reusing prior speech/visual cache dirs when set. */
	cacheDir?: string;
	skipModel?: boolean;
	/**
	 * Provider identity for this run. Default CURRENT_OPENSCREEN.
	 * Use CURRENT_OPENSCREEN_INVESTIGATOR_V1 for separate diagnostic runs —
	 * never overwrite locked CURRENT_OPENSCREEN baseline artifacts.
	 */
	provider?: string;
}

export async function runCurrentStackCase(
	gt: PerceptionGroundTruth,
	options: RunCaseOptions = {},
): Promise<PerceptionBenchmarkResult> {
	const provider = options.provider ?? "CURRENT_OPENSCREEN";
	const modelName = options.model ?? "gpt-4o";
	const providerRunId =
		options.providerRunId ??
		`${gt.caseId}_${provider}_${modelName}_${new Date().toISOString().replace(/[:.]/g, "-")}`;
	const outRoot = options.outRoot ?? DEFAULT_OUT;
	const caseOut = path.join(outRoot, gt.caseId, providerRunId);
	mkdirSync(caseOut, { recursive: true });

	const skeleton = buildResultSkeleton({ gt, providerRunId, provider });
	const media = resolveCorpusMedia(gt);

	if (gt.status === "RECORDING_REQUIRED" || !media.mediaReady || !gt.mediaPath) {
		const emptyEvidence: PerceptionRunEvidence = {
			selectedFrameTimestamps: [],
			changeScores: [],
			attachedFrameCount: 0,
			speechSegments: [],
			cursorEventCount: 0,
			cursorNonMoveCount: 0,
		};
		const result: PerceptionBenchmarkResult = {
			...skeleton,
			mediaReady: false,
			groundTruthReady: false,
			evidence: emptyEvidence,
			observations: [],
			eventScores: [],
			importantEventRecall: {
				criticalImportantTotal: 0,
				detected: 0,
				partial: 0,
				missed: 0,
				incorrect: 0,
				recall: null,
			},
			hallucinations: [],
			latency: {
				mediaProbeMs: 0,
				visualPreparationMs: 0,
				speechPreparationMs: 0,
				cursorPreparationMs: 0,
				modelLatencyMs: null,
				totalTurnMs: 0,
				cacheState: "unknown",
				model: null,
				provider,
			},
			providerRaw: {
				skipped: true,
				reason: gt.status === "RECORDING_REQUIRED" ? "RECORDING_REQUIRED" : media.missing,
				recordingScript: gt.recordingScript ?? null,
			},
		};
		writeFileSync(path.join(caseOut, "result.json"), JSON.stringify(result, null, 2));
		return result;
	}

	const apiKey = options.apiKey ?? loadOpenAiKey();
	if (!apiKey && !options.skipModel) {
		throw new Error("OPENAI_API_KEY missing — cannot run CURRENT_OPENSCREEN baseline");
	}

	const turnStarted = Date.now();
	const cacheDir =
		options.cacheDir ?? (await mkdtemp(path.join(os.tmpdir(), `os-pbench-${gt.caseId}-`)));

	const tProbe = Date.now();
	const probe = await probeSourceDurations(gt.mediaPath, {
		ffmpegPath: FFMPEG,
		ffprobePath: resolveFfprobe(),
	});
	const mediaProbeMs = Date.now() - tProbe;
	const durationSec = gt.durationSec ?? probe.containerDurationSec ?? 0;

	let document = buildDoc(gt.mediaPath, durationSec, gt.caseId, {
		webcamPath: gt.webcamPath,
	});
	document = injectContradictionTranscript(document, gt);

	const userMessage = promptForCase(gt);
	const needs = classifyMediaContextNeeds(userMessage);

	const tSpeech = Date.now();
	const speechPrep = await prepareSpeechEvidenceForTurn({
		document,
		userMessage,
		contextNeeds: needs,
		deps: sttDeps(path.join(cacheDir, "speech")),
	});
	const speechPreparationMs = Date.now() - tSpeech;
	document = speechPrep.document;

	const tVisual = Date.now();
	const visualPrep = await prepareVisualEvidenceForTurn({
		document,
		userMessage,
		provider: "openai",
		contextNeeds: needs,
		extractDeps: { cacheDir: path.join(cacheDir, "visual"), ffmpegPath: FFMPEG },
		changeDeps: { ffmpegPath: FFMPEG },
	});
	const visualPreparationMs = Date.now() - tVisual;

	const cursorStats = readCursorStats(gt.cursorPath);

	const storyPrep = wantsSourceStory(needs)
		? prepareSourceStoryForTurn({
				contextNeeds: needs,
				sourceDurationSec: durationSec,
				speechEvidence: speechPrep.prepared?.evidence[0],
				frames: visualPrep.prepared?.frames,
				changes: visualPrep.prepared?.changes,
			})
		: null;

	const holder = makeSink();
	let modelLatencyMs: number | null = null;
	let resultText = "";
	let sourceStory: Awaited<ReturnType<typeof invokeOpenScreenAgent>>["sourceStory"];
	let temporalEventLedger: Awaited<ReturnType<typeof invokeOpenScreenAgent>>["temporalEventLedger"];
	let investigationEvidence: Awaited<
		ReturnType<typeof invokeOpenScreenAgent>
	>["investigationEvidence"];
	let rawModelText = "";

	if (!options.skipModel) {
		const modelStarted = Date.now();
		const result = await invokeOpenScreenAgent({
			document: speechPrep.document,
			userMessage,
			history: [],
			editsAllowed: false,
			speechCacheDir: path.join(cacheDir, "speech-agent"),
			model: {
				provider: "openai",
				model: modelName,
				apiKey,
				baseUrl: "https://api.openai.com/v1",
			},
			sink: holder.sink,
		});
		modelLatencyMs = Date.now() - modelStarted;
		rawModelText = holder.getRaw() || result.text;
		resultText = stripInternalEvidenceJsonBlocks(result.text) || result.text;
		sourceStory = result.sourceStory;
		temporalEventLedger = result.temporalEventLedger;
		investigationEvidence = result.investigationEvidence;
	}

	const totalTurnMs = Date.now() - turnStarted;

	const speechEv = speechPrep.prepared?.evidence[0];
	const frames = visualPrep.prepared?.frames ?? [];
	const changes = visualPrep.prepared?.changes ?? [];

	const validatedFromRaw = storyPrep
		? parseAndValidateSourceStory(rawModelText, storyPrep.scaffold)
		: { ok: false, story: null, errors: ["no scaffold"], warnings: [] };
	const validatedStory = sourceStory ?? validatedFromRaw.story ?? undefined;

	const evidence: PerceptionRunEvidence = {
		selectedFrameTimestamps: frames.map((f) => f.sourceTimeSec),
		changeScores: changes.map((c) => ({
			fromSec: c.fromSourceTimeSec,
			toSec: c.toSourceTimeSec,
			score: c.score,
			classification: c.classification,
		})),
		attachedFrameCount: frames.length,
		speechSegments: (speechEv?.segments ?? []).map((s) => ({
			startSec: s.startSourceTimeSec,
			endSec: s.endSourceTimeSec,
			text: s.text,
		})),
		speechStatus: speechEv?.status,
		cursorEventCount: cursorStats.cursorEventCount,
		cursorNonMoveCount: cursorStats.cursorNonMoveCount,
		rawSemanticText: rawModelText.slice(0, 100_000) || undefined,
		validatedSemanticSummary: validatedStory?.overallSummary,
		sourceStorySummary: validatedStory?.overallSummary,
		sourceStoryBeats: validatedStory?.storyBeats.map((b) => ({
			id: b.id,
			startSec: b.startSourceTimeSec,
			endSec: b.endSourceTimeSec,
			purpose: b.purpose,
			summary: b.summary,
		})),
		finalUserText: resultText || undefined,
	};

	const observations = observationsFromEvidence(evidence);
	const eventScores = gt.events.map((e) => scoreEvent(e, observations));
	const allTexts = [
		resultText,
		validatedStory?.overallSummary ?? "",
		...(validatedStory?.storyBeats.map(
			(b) => `${b.summary} ${b.spokenMeaning ?? ""} ${b.visualMeaning ?? ""}`,
		) ?? []),
		...evidence.speechSegments.map((s) => s.text),
		rawModelText.slice(0, 50_000),
	];
	const hallucinations = scoreHallucinations(gt.mustNotClaim, allTexts);
	const importantEventRecall = summarizeRecall(eventScores, gt);

	const cacheState: PerceptionRunLatency["cacheState"] =
		speechEv?.timings?.cacheHit === true ? "warm" : "cold";

	const latency: PerceptionRunLatency = {
		mediaProbeMs,
		visualPreparationMs,
		speechPreparationMs,
		cursorPreparationMs: cursorStats.cursorPreparationMs,
		modelLatencyMs,
		totalTurnMs,
		cacheState,
		model: options.skipModel ? null : modelName,
		provider,
	};

	const benchmarkResult: PerceptionBenchmarkResult = {
		...skeleton,
		mediaReady: true,
		groundTruthReady: gt.events.length > 0,
		evidence,
		observations,
		eventScores,
		importantEventRecall,
		hallucinations,
		speechEval: evaluateSpeech(gt, eventScores, evidence, allTexts.join("\n")),
		visualEval: evaluateVisual(gt, eventScores),
		multimodalEval: evaluateMultimodal(gt, eventScores, allTexts.join("\n")),
		latency,
		providerRaw: {
			provider,
			model: modelName,
			contextNeeds: needs,
			sourceStoryRequested: wantsSourceStory(needs),
			rawSourceStoryJson: extractSourceStoryJson(rawModelText),
			validatedSourceStory: validatedStory,
			validationErrors: validatedFromRaw.errors,
			validationWarnings: validatedFromRaw.warnings,
			userFacingText: resultText,
			prompt: userMessage,
			cacheDir,
			frameCount: frames.length,
			speechEngine: speechEv?.engine,
			notes: gt.notes,
			status: gt.status,
			investigation: investigationEvidence
				? {
						stopReason: investigationEvidence.stopReason,
						metrics: investigationEvidence.metrics,
						claimVerdicts: investigationEvidence.claims.map((c) => ({
							verdict: c.verdict,
							hypothesis: c.hypothesis,
						})),
						rangesInspected: investigationEvidence.coverage.rangesInspected,
						frameTimesSec: investigationEvidence.coverage.frameTimesSec,
						roiCount: investigationEvidence.coverage.roiCount,
						toolNames: investigationEvidence.toolTrace.map((t) => t.tool),
						investigatorModelCalls: investigationEvidence.metrics.investigatorModelCalls,
					}
				: null,
		},
	};

	writeFileSync(path.join(caseOut, "result.json"), JSON.stringify(benchmarkResult, null, 2));
	writeFileSync(path.join(caseOut, "evidence.json"), JSON.stringify(evidence, null, 2));
	writeFileSync(path.join(caseOut, "ground-truth.json"), JSON.stringify(gt, null, 2));
	if (rawModelText) {
		writeFileSync(path.join(caseOut, "raw-model.txt"), rawModelText.slice(0, 200_000));
	}
	if (resultText) {
		writeFileSync(path.join(caseOut, "user-facing.txt"), resultText);
	}
	if (investigationEvidence) {
		writeFileSync(
			path.join(caseOut, `${gt.caseId}.investigation-v1.json`),
			JSON.stringify(
				{
					stopReason: investigationEvidence.stopReason,
					metrics: investigationEvidence.metrics,
					focusRange: investigationEvidence.focusRange,
					coverage: investigationEvidence.coverage,
					claims: investigationEvidence.claims,
					observations: investigationEvidence.observations.map((o) => ({
						kind: o.kind,
						text: o.text,
						startSourceTimeSec: o.startSourceTimeSec,
						endSourceTimeSec: o.endSourceTimeSec,
					})),
					toolTrace: investigationEvidence.toolTrace,
					additionalFrameCount: investigationEvidence.additionalFrames.length,
					// Briefing kept for diagnostics only — not user-facing.
					internalBriefingChars: investigationEvidence.internalBriefing.length,
				},
				null,
				2,
			),
			"utf8",
		);
	}

	// Separate ledger diagnostic — never feeds GT into production evidence.
	const primaryAsset = document.assets.find((a) => a.kind === "video") ?? document.assets[0];
	const ledger =
		temporalEventLedger ??
		(primaryAsset
			? buildLedgerFromPreparedEvidence({
					assetId: primaryAsset.id,
					sourceDurationSec: durationSec,
					speechEvidence: speechEv,
					frames,
					changes,
				})
			: null);
	if (ledger) {
		writeLedgerDiagnosticArtifact(caseOut, gt.caseId, ledger);
	}

	return benchmarkResult;
}
