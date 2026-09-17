/**
 * Live Real Corpus Recovery 2 — multimodal routing.
 * Identity: CURRENT_OPENSCREEN_REAL_CORPUS_RECOVERY_ROUTING_V1
 *
 * Validates classification + evidence preparation (frames/speech).
 * Does not require LLM finals (provider 429 separated).
 *
 * Run:
 *   npx vitest --run electron/ai-edition/mediaContextNeeds/routing-recovery-live.runtime.test.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { candidateBinaryPaths } from "../../stt/gpuDetector";
import { _resetSttManagerForTests, getSttManager, shutdownStt } from "../../stt/index";
import { prepareSpeechEvidenceForTurn } from "../speechEvidence/prepare";
import { runMasterVideoInvestigatorV1_1 } from "../videoInvestigator";
import { shouldRunInvestigator } from "../videoInvestigator/plan";
import { prepareVisualEvidenceForTurn } from "../visualEvidence/prepare";
import { classifyMediaContextNeeds } from "./classify";

const IDENTITY = "CURRENT_OPENSCREEN_REAL_CORPUS_RECOVERY_ROUTING_V1";
const OUT = path.join(process.cwd(), "tmp/perception-benchmark/real-corpus-recovery-2-routing");
const BASELINE = path.join(process.cwd(), "tmp/perception-benchmark/real-corpus-baseline-v1");
const REC = path.join(os.homedir(), "Library/Application Support/openscreen/recordings");
const FFMPEG = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");

type CaseKind =
	| "starvation"
	| "understanding"
	| "visual"
	| "speech"
	| "cross_modal"
	| "editorial"
	| "deterministic"
	| "general"
	| "unsupported"
	| "typo"
	| "stt_regression";

interface RoutingCase {
	id: string;
	baselineCaseId?: string;
	prompt: string;
	mediaPath: string;
	kind: CaseKind;
	expectVisual: boolean;
	expectSpeech: boolean;
	expectCheap?: boolean;
}

function loadBaselinePrompt(caseId: string): { prompt: string; mediaPath: string } | null {
	const corpusPath = path.join(BASELINE, "corpus.json");
	if (!existsSync(corpusPath)) return null;
	const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as {
		cases: Array<{ caseId: string; prompt: string; mediaPath: string }>;
	};
	const hit = corpus.cases.find((c) => c.caseId === caseId);
	return hit ? { prompt: hit.prompt, mediaPath: hit.mediaPath } : null;
}

function baselineInvestigator(caseId?: string) {
	if (!caseId) return null;
	const p = path.join(BASELINE, "cases", caseId, "investigator.json");
	if (!existsSync(p)) return null;
	try {
		const inv = JSON.parse(readFileSync(p, "utf8")) as {
			stopReason?: string;
			toolTrace?: unknown[];
		};
		return {
			stopReason: inv.stopReason ?? null,
			toolCount: inv.toolTrace?.length ?? 0,
		};
	} catch {
		return null;
	}
}

const SELECTED: RoutingCase[] = (() => {
	const b015 = loadBaselinePrompt("case-015");
	const b020 = loadBaselinePrompt("case-020");
	const b022 = loadBaselinePrompt("case-022");
	const b025 = loadBaselinePrompt("case-025");
	const narrated = path.join(REC, "recording-bug5-narrated.mp4");
	const c4 = path.join(
		process.cwd(),
		"tmp/perception-benchmark/case4-correction/case4-spoken-correction.mp4",
	);
	const latest = path.join(REC, "recording-1789234858783.mp4");
	const noAudio = path.join(REC, "recording-1788958840550.mp4");
	const media015 = b015?.mediaPath ?? path.join(REC, "recording-1789238202864.mp4");
	const media020 = b020?.mediaPath ?? path.join(REC, "recording-1788978271417.mp4");
	const media022 = b022?.mediaPath ?? path.join(REC, "recording-1788895487347.mp4");
	const media025 = b025?.mediaPath ?? path.join(REC, "recording-1788895767287.mp4");

	return [
		{
			id: "case-015",
			baselineCaseId: "case-015",
			prompt: b015?.prompt ?? "Was the screen mostly stable, or were there major visual changes?",
			mediaPath: media015,
			kind: "starvation",
			expectVisual: true,
			expectSpeech: false,
		},
		{
			id: "case-020",
			baselineCaseId: "case-020",
			prompt:
				b020?.prompt ??
				"What safe edits would you propose, if any? If none are safe, say so clearly.",
			mediaPath: media020,
			kind: "starvation",
			expectVisual: true,
			expectSpeech: true,
		},
		{
			id: "case-022",
			baselineCaseId: "case-022",
			prompt: b022?.prompt ?? "What applications or screens are visible? Is there a webcam?",
			mediaPath: media022,
			kind: "starvation",
			expectVisual: true,
			expectSpeech: false,
		},
		{
			id: "case-025",
			baselineCaseId: "case-025",
			prompt:
				b025?.prompt ?? "Make this suitable for a product demo. What would you change and why?",
			mediaPath: media025,
			kind: "starvation",
			expectVisual: true,
			expectSpeech: true,
		},
		{
			id: "visual-stable-paraphrase",
			prompt: "Did the screen change much?",
			mediaPath: media015,
			kind: "visual",
			expectVisual: true,
			expectSpeech: false,
		},
		{
			id: "visual-popup",
			prompt: "What popup appears at the end?",
			mediaPath: media015,
			kind: "visual",
			expectVisual: true,
			expectSpeech: false,
		},
		{
			id: "speech-only",
			prompt: "What did I say?",
			mediaPath: narrated,
			kind: "speech",
			expectVisual: false,
			expectSpeech: true,
		},
		{
			id: "cross-modal",
			prompt: "Did what I said actually happen on screen?",
			mediaPath: narrated,
			kind: "cross_modal",
			expectVisual: true,
			expectSpeech: true,
		},
		{
			id: "editorial-shorter",
			prompt: "Make this shorter and clearer",
			mediaPath: latest,
			kind: "editorial",
			expectVisual: true,
			expectSpeech: true,
		},
		{
			id: "editorial-pacing",
			prompt: "Improve the pacing",
			mediaPath: latest,
			kind: "editorial",
			expectVisual: true,
			expectSpeech: true,
		},
		{
			id: "det-trim",
			prompt: "Trim 5–8s.",
			mediaPath: narrated,
			kind: "deterministic",
			expectVisual: false,
			expectSpeech: false,
			expectCheap: true,
		},
		{
			id: "det-aspect",
			prompt: "Set aspect ratio to 16:9",
			mediaPath: narrated,
			kind: "deterministic",
			expectVisual: false,
			expectSpeech: false,
			expectCheap: true,
		},
		{
			id: "general-crop",
			prompt: "What does cropping do?",
			mediaPath: narrated,
			kind: "general",
			expectVisual: false,
			expectSpeech: false,
			expectCheap: true,
		},
		{
			id: "unsupported-stabilize",
			prompt: "Can OpenScreen stabilize video?",
			mediaPath: narrated,
			kind: "unsupported",
			expectVisual: false,
			expectSpeech: false,
			expectCheap: true,
		},
		{
			id: "typo-pro",
			prompt: "make this pro",
			mediaPath: media025,
			kind: "typo",
			expectVisual: true,
			expectSpeech: true,
		},
		{
			id: "stt-narrated",
			prompt: "What did I say in this recording?",
			mediaPath: narrated,
			kind: "stt_regression",
			expectVisual: false,
			expectSpeech: true,
		},
		{
			id: "stt-case4",
			prompt: "What did I say, and did I correct myself?",
			mediaPath: c4,
			kind: "stt_regression",
			expectVisual: false,
			expectSpeech: true,
		},
		{
			id: "stt-latest",
			prompt: "Summarize the narration.",
			mediaPath: latest,
			kind: "stt_regression",
			expectVisual: false,
			expectSpeech: true,
		},
		{
			id: "stt-no-audio",
			prompt: "What did I say?",
			mediaPath: noAudio,
			kind: "stt_regression",
			expectVisual: false,
			expectSpeech: true,
		},
	];
})();

function buildDoc(videoPath: string, durationSec: number, title: string) {
	const base = createEmptyDocument({
		title,
		projectId: `proj_${title}`,
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				label: title,
				kind: "video",
				originalPath: videoPath,
				durationSec,
				width: 1920,
				height: 1080,
			},
		],
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

const canRun = existsSync(FFMPEG) && SELECTED.every((c) => existsSync(c.mediaPath));

describe.runIf(canRun)("routing recovery live real media", () => {
	afterAll(async () => {
		await shutdownStt().catch(() => undefined);
		_resetSttManagerForTests();
	});

	it("classifies + prepares evidence for routing subset", async () => {
		mkdirSync(path.join(OUT, "cases"), { recursive: true });
		writeFileSync(
			path.join(OUT, "selected-cases.json"),
			JSON.stringify({ identity: IDENTITY, cases: SELECTED }, null, 2),
		);

		_resetSttManagerForTests();
		const mgr = getSttManager();
		await mgr.init({});
		const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "os-routing-rec-"));

		const beforeAfter: Array<Record<string, unknown>> = [];
		const latencyRows: Array<Record<string, unknown>> = [];
		const realMedia: Array<Record<string, unknown>> = [];

		for (const c of SELECTED) {
			const needs = classifyMediaContextNeeds(c.prompt);
			const baseInv = baselineInvestigator(c.baselineCaseId);
			const t0 = Date.now();
			const doc = buildDoc(c.mediaPath, 30, c.id);

			let frameCount = 0;
			let speechStatus: string | null = null;
			let speechSegs = 0;
			let invStop: string | null = null;
			let invTools = 0;

			if (needs.visual) {
				const vis = await prepareVisualEvidenceForTurn({
					document: doc,
					userMessage: c.prompt,
					provider: "openai",
					contextNeeds: needs,
					extractDeps: {
						cacheDir: path.join(cacheRoot, c.id, "visual"),
						ffmpegPath: FFMPEG,
					},
				});
				frameCount = vis.prepared?.frames?.length ?? 0;
			}

			if (needs.speech) {
				const speech = await prepareSpeechEvidenceForTurn({
					document: doc,
					userMessage: c.prompt,
					contextNeeds: needs,
					deps: {
						getSttManager: () => mgr,
						resolveSttBinary: () => candidateBinaryPaths().find((p) => p && existsSync(p)) ?? null,
						cacheDir: path.join(cacheRoot, c.id, "speech"),
					},
				});
				const ev = speech.prepared?.evidence[0];
				speechStatus = ev?.status ?? null;
				speechSegs = ev?.segments?.length ?? 0;
			}

			if (shouldRunInvestigator(needs)) {
				const inv = await runMasterVideoInvestigatorV1_1({
					userMessage: c.prompt,
					needs,
					assetId: "asset_1",
					sourceDurationSec: 30,
					videoPath: c.mediaPath,
					ffmpegPath: FFMPEG,
					extractDeps: { cacheDir: path.join(cacheRoot, c.id, "inv"), ffmpegPath: FFMPEG },
				});
				invStop = inv?.stopReason ?? null;
				invTools = inv?.toolTrace?.length ?? 0;
			} else {
				const inv = await runMasterVideoInvestigatorV1_1({
					userMessage: c.prompt,
					needs,
					assetId: "asset_1",
					sourceDurationSec: 30,
					videoPath: null,
					ffmpegPath: null,
				});
				invStop = inv?.stopReason ?? null;
				invTools = inv?.toolTrace?.length ?? 0;
			}

			const totalMs = Date.now() - t0;
			const row = {
				id: c.id,
				baselineCaseId: c.baselineCaseId ?? null,
				kind: c.kind,
				prompt: c.prompt,
				recoveryCategory: needs.category,
				visual: needs.visual,
				speech: needs.speech,
				cursor: needs.cursor,
				baselineInvestigatorStop: baseInv?.stopReason ?? null,
				recoveryInvestigatorStop: invStop,
				baselineToolCount: baseInv?.toolCount ?? null,
				recoveryToolCount: invTools,
				visualFrames: frameCount,
				speechStatus,
				speechSegments: speechSegs,
				expectVisual: c.expectVisual,
				expectSpeech: c.expectSpeech,
				visualOk: c.expectVisual ? frameCount > 0 : frameCount === 0 || !needs.visual,
				speechOk: !c.expectSpeech
					? true
					: c.id === "stt-no-audio"
						? speechStatus === "no_audio"
						: speechStatus === "available" && speechSegs > 0,
				totalPrepMs: totalMs,
				providerFinal: "NOT_RUN_SEPARATED_FROM_ROUTING",
			};

			const caseDir = path.join(OUT, "cases", c.id);
			mkdirSync(caseDir, { recursive: true });
			writeFileSync(path.join(caseDir, "result.json"), JSON.stringify(row, null, 2));

			beforeAfter.push({
				case: c.id,
				baselineCategory: c.baselineCaseId ? "fallback_starved" : "n/a",
				recoveryCategory: needs.category,
				visualFrames: `0→${frameCount}`,
				speech: `${c.baselineCaseId ? "null/failed" : "n/a"}→${speechStatus}`,
				investigator: `${baseInv?.stopReason ?? "n/a"}→${invStop}`,
				final: "NOT_VERIFIED_PROVIDER",
			});
			latencyRows.push({ id: c.id, totalPrepMs: totalMs, frames: frameCount });
			realMedia.push(row);

			expect(needs.visual).toBe(c.expectVisual);
			expect(needs.speech).toBe(c.expectSpeech);
			if (c.expectCheap) {
				expect(needs.visual).toBe(false);
				expect(invStop === "deterministic_edit_skip" || invStop === "media_not_required").toBe(
					true,
				);
			}
			if (c.expectVisual) expect(frameCount).toBeGreaterThan(0);
			if (c.expectSpeech && c.id !== "stt-no-audio") {
				expect(speechStatus).toBe("available");
				expect(speechSegs).toBeGreaterThan(0);
			}
			if (c.id === "stt-no-audio") expect(speechStatus).toBe("no_audio");
			if (c.baselineCaseId) {
				expect(invStop).not.toBe("deterministic_edit_skip");
			}
		}

		writeFileSync(
			path.join(OUT, "routing-before-after.json"),
			JSON.stringify(beforeAfter, null, 2),
		);
		writeFileSync(path.join(OUT, "latency.json"), JSON.stringify({ rows: latencyRows }, null, 2));
		writeFileSync(
			path.join(OUT, "real-media-results.json"),
			JSON.stringify({ identity: IDENTITY, results: realMedia }, null, 2),
		);
	}, 600_000);
});
