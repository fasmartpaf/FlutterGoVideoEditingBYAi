/**
 * Experimental GEMINI_NATIVE_VIDEO benchmark adapter.
 * Does NOT modify CURRENT_OPENSCREEN / production routing / JPEG sampling.
 */

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { observationsFromEvidence } from "../evaluate";
import { buildResultSkeleton, scoreEvent, scoreHallucinations, summarizeRecall } from "../score";
import type {
	BenchmarkObservation,
	PerceptionBenchmarkResult,
	PerceptionRunEvidence,
	PerceptionRunLatency,
} from "../types";
import {
	CASE2_FAIR_USER_PROMPT,
	CASE2_LOCKED_DURATION_SEC,
	CASE2_LOCKED_GROUND_TRUTH,
	CASE2_LOCKED_MEDIA,
} from "./case02LockedGroundTruth";
import { loadGeminiApiKey, runGeminiNativeVideo } from "./geminiNativeClient";

export const GEMINI_NATIVE_VIDEO_PROVIDER = "GEMINI_NATIVE_VIDEO";

/** Prefer a current video-capable Gemini model; override via env. */
export const DEFAULT_GEMINI_NATIVE_VIDEO_MODEL =
	process.env.OPENSCREEN_GEMINI_NATIVE_VIDEO_MODEL?.trim() || "gemini-3.6-flash";

const DEFAULT_OUT = path.join(process.cwd(), "tmp/perception-benchmark/runs/case02_fast_ui_event");

/**
 * Parse chronological prose into coarse timed observations for scoring.
 * Heuristic only — does not invent GT. Timestamps taken when the model states them.
 */
export function observationsFromNativeVideoProse(text: string): BenchmarkObservation[] {
	const out: BenchmarkObservation[] = [];
	const lines = text
		.split(/\n+/)
		.map((l) => l.trim())
		.filter(Boolean);

	const timeRe =
		/(?:^|[\s(])(?:(?:at\s+)?(?:~?\s*)?(?:00:)?(\d{1,2}):(\d{2})(?:\.(\d+))?|(?:around|at|near)\s+(?:~?\s*)?(\d+(?:\.\d+)?)\s*(?:s|sec|seconds?)?)/i;

	for (const line of lines) {
		const m = timeRe.exec(line);
		let timeSec: number | undefined;
		if (m) {
			if (m[1] != null && m[2] != null) {
				timeSec = Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0);
			} else if (m[4] != null) {
				timeSec = Number(m[4]);
			}
		}
		out.push({
			timeSec,
			startSec: timeSec,
			endSec: timeSec != null ? timeSec + 1 : undefined,
			modality: "visual",
			description: line,
			source: "user_text",
		});
	}

	// Whole-reply bag for broad hint matching when lines lack timestamps.
	out.push({
		modality: "visual",
		description: text,
		source: "user_text",
	});
	return out;
}

export interface RunGeminiNativeVideoCaseOptions {
	apiKey?: string;
	model?: string;
	outRoot?: string;
	prompt?: string;
}

export async function runGeminiNativeVideoCase(
	options: RunGeminiNativeVideoCaseOptions = {},
): Promise<PerceptionBenchmarkResult> {
	const gt = CASE2_LOCKED_GROUND_TRUTH;
	const videoPath = gt.mediaPath ?? CASE2_LOCKED_MEDIA;
	if (!existsSync(videoPath)) {
		throw new Error(`Case 2 media missing: ${videoPath}`);
	}
	const apiKey = options.apiKey?.trim() || loadGeminiApiKey();
	if (!apiKey) {
		throw new Error(
			"Gemini API key missing. Set GEMINI_API_KEY / GOOGLE_API_KEY or tmp/perception-benchmark/.env.gemini",
		);
	}
	const model = options.model ?? DEFAULT_GEMINI_NATIVE_VIDEO_MODEL;
	const prompt = options.prompt ?? CASE2_FAIR_USER_PROMPT;
	const providerRunId = `${GEMINI_NATIVE_VIDEO_PROVIDER}_${new Date()
		.toISOString()
		.replace(/[:.]/g, "-")}`;

	const mediaBytes = statSync(videoPath).size;
	const mediaProbeMs = 0;
	const tTurn = Date.now();

	const gemini = await runGeminiNativeVideo({
		apiKey,
		model,
		videoPath,
		prompt,
		mimeType: "video/mp4",
	});

	const totalTurnMs = Date.now() - tTurn;
	const evidence: PerceptionRunEvidence = {
		selectedFrameTimestamps: [],
		changeScores: [],
		attachedFrameCount: 0,
		speechSegments: [],
		speechStatus: "no_audio",
		cursorEventCount: 0,
		cursorNonMoveCount: 0,
		rawSemanticText: gemini.rawText,
		finalUserText: gemini.rawText,
	};

	const observations = observationsFromNativeVideoProse(gemini.rawText);
	const eventScores = gt.events.map((e) => scoreEvent(e, observations));
	const hallucinations = scoreHallucinations(gt.mustNotClaim, [gemini.rawText]);
	const importantEventRecall = summarizeRecall(eventScores, gt);

	const latency: PerceptionRunLatency = {
		mediaProbeMs,
		visualPreparationMs: gemini.uploadMs + gemini.processingMs,
		speechPreparationMs: 0,
		cursorPreparationMs: 0,
		modelLatencyMs: gemini.modelLatencyMs,
		totalTurnMs,
		cacheState: "cold",
		model,
		provider: GEMINI_NATIVE_VIDEO_PROVIDER,
	};

	const result: PerceptionBenchmarkResult = {
		...buildResultSkeleton({
			gt,
			providerRunId,
			provider: GEMINI_NATIVE_VIDEO_PROVIDER,
		}),
		mediaReady: true,
		groundTruthReady: true,
		evidence,
		observations,
		eventScores,
		importantEventRecall,
		hallucinations,
		visualEval: {
			notes: "GEMINI_NATIVE_VIDEO experimental arm — original mp4 via Files API",
			appStateChange: eventScores.find((s) => s.eventId === "app_transition")?.verdict ?? "N/A",
			briefUiEvent: eventScores.find((s) => s.eventId === "restart_tooltip")?.verdict ?? "N/A",
			smallText: "N/A",
		},
		latency,
		providerRaw: {
			uploadMethod: gemini.uploadMethod,
			requestMode: gemini.requestMode,
			fileName: gemini.fileName,
			fileUri: gemini.fileUri,
			fileState: gemini.fileState,
			videoBytes: gemini.videoBytes,
			mediaBytes,
			durationSec: CASE2_LOCKED_DURATION_SEC,
			uploadMs: gemini.uploadMs,
			processingMs: gemini.processingMs,
			modelLatencyMs: gemini.modelLatencyMs,
			totalMs: gemini.totalMs,
			usageMetadata: gemini.usageMetadata,
			// Omit full rawResponse candidates if huge; keep usage + truncated text mirror
			responsePreview: gemini.rawText.slice(0, 4000),
		},
	};

	const outDir = path.join(options.outRoot ?? DEFAULT_OUT, providerRunId);
	mkdirSync(outDir, { recursive: true });
	writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, null, 2));
	writeFileSync(path.join(outDir, "raw-model.txt"), gemini.rawText);
	writeFileSync(path.join(outDir, "user-facing.txt"), gemini.rawText);
	writeFileSync(
		path.join(outDir, "ground-truth.json"),
		JSON.stringify(
			{
				note: "GT used for post-hoc scoring only; not sent to the provider",
				gt,
			},
			null,
			2,
		),
	);
	writeFileSync(
		path.join(outDir, "evidence.json"),
		JSON.stringify(
			{
				mode: "native_video",
				videoPath,
				...gemini,
				// strip nested rawResponse to keep artifact smaller / safer
				rawResponse: undefined,
			},
			null,
			2,
		),
	);
	writeFileSync(
		path.join(outDir, "PROVIDER.md"),
		[
			"# GEMINI_NATIVE_VIDEO",
			"",
			"Experimental architecture arm. Not production routing.",
			"",
			`- model: ${model}`,
			`- upload: Files API resumable`,
			`- request: generateContent file_data (video/mp4)`,
			`- video bytes: ${mediaBytes}`,
			`- durationSec: ${CASE2_LOCKED_DURATION_SEC}`,
			`- uploadMs: ${gemini.uploadMs}`,
			`- processingMs: ${gemini.processingMs}`,
			`- modelLatencyMs: ${gemini.modelLatencyMs}`,
			`- totalMs: ${gemini.totalMs}`,
			"",
		].join("\n"),
	);

	return result;
}

/** Score an already-produced CURRENT_OPENSCREEN user-facing text against locked GT. */
export function scoreCurrentOpenscreenCase2Text(userFacing: string): PerceptionBenchmarkResult {
	const gt = CASE2_LOCKED_GROUND_TRUTH;
	const observations = [
		...observationsFromEvidence({
			selectedFrameTimestamps: [0, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18],
			changeScores: [],
			attachedFrameCount: 12,
			speechSegments: [],
			speechStatus: "no_audio",
			cursorEventCount: 0,
			cursorNonMoveCount: 0,
			finalUserText: userFacing,
		}),
		...observationsFromNativeVideoProse(userFacing),
	];
	const eventScores = gt.events.map((e) => scoreEvent(e, observations));
	return {
		...buildResultSkeleton({
			gt,
			providerRunId: "CURRENT_OPENSCREEN_LOCKED_BASELINE",
			provider: "CURRENT_OPENSCREEN",
		}),
		mediaReady: true,
		groundTruthReady: true,
		evidence: {
			selectedFrameTimestamps: [0, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18],
			changeScores: [],
			attachedFrameCount: 12,
			speechSegments: [],
			speechStatus: "no_audio",
			cursorEventCount: 0,
			cursorNonMoveCount: 0,
			finalUserText: userFacing,
		},
		observations,
		eventScores,
		importantEventRecall: summarizeRecall(eventScores, gt),
		hallucinations: scoreHallucinations(gt.mustNotClaim, [userFacing]),
		latency: {
			mediaProbeMs: 0,
			visualPreparationMs: 0,
			speechPreparationMs: 0,
			cursorPreparationMs: 0,
			modelLatencyMs: null,
			totalTurnMs: 0,
			cacheState: "unknown",
			model: "gpt-4o",
			provider: "CURRENT_OPENSCREEN",
		},
	};
}
