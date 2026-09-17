/**
 * Live Real Corpus Recovery 1 — STT reliability on real media.
 * Identity: CURRENT_OPENSCREEN_REAL_CORPUS_RECOVERY_STT_V1
 *
 * Does NOT overwrite real-corpus-baseline-v1.
 *
 * Run:
 *   npx vitest --run electron/ai-edition/speechEvidence/stt-recovery-live.runtime.test.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { candidateBinaryPaths } from "../../stt/gpuDetector";
import { probeSttRuntimeHealth } from "../../stt/health";
import { _resetSttManagerForTests, getSttManager, shutdownStt } from "../../stt/index";
import { resolveSttModelsBaseDir } from "../../stt/modelsDir";
import { buildClaimPromotionSet } from "../claimPromotion";
import { invokeOpenScreenAgent, type OpenScreenAgentSink } from "../deep-agent/service";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import { loadOpenAiKey } from "../perceptionBenchmark/runCurrentStack";
import { prepareSourceStoryForTurn, wantsSourceStory } from "../sourceStory";
import { buildLedgerFromPreparedEvidence } from "../temporalEventLedger";
import { stripInternalEvidenceJsonBlocks } from "./format";
import { prepareSpeechEvidenceForTurn } from "./prepare";
import { probeAudioStream } from "./probe";

const IDENTITY = "CURRENT_OPENSCREEN_REAL_CORPUS_RECOVERY_STT_V1";
const OUT = path.join(process.cwd(), "tmp/perception-benchmark/real-corpus-recovery-1-stt");
const BASELINE = path.join(process.cwd(), "tmp/perception-benchmark/real-corpus-baseline-v1");
const REC = path.join(os.homedir(), "Library/Application Support/openscreen/recordings");

const SELECTED = [
	{
		id: "rec-narrated-bug5",
		baselineCaseId: "case-001",
		mediaPath: path.join(REC, "recording-bug5-narrated.mp4"),
		prompt: "What did I say in this recording? Summarize the narration.",
		kind: "audio_speech" as const,
	},
	{
		id: "rec-case4-correction",
		baselineCaseId: "case-003",
		mediaPath: path.join(
			process.cwd(),
			"tmp/perception-benchmark/case4-correction/case4-spoken-correction.mp4",
		),
		prompt: "What did I say, and did I correct myself? What is my final intended meaning?",
		kind: "audio_speech_correction" as const,
	},
	{
		id: "rec-latest-narrated",
		baselineCaseId: "case-010",
		mediaPath: path.join(REC, "recording-1789234858783.mp4"),
		prompt: "What did I say near the end? Summarize the narration.",
		kind: "audio_speech" as const,
	},
	{
		id: "rec-longer-narrated",
		baselineCaseId: "case-012",
		mediaPath: path.join(REC, "recording-1789233035387.mp4"),
		prompt: "Transcribe or summarize my speech. Note any pauses.",
		kind: "audio_speech" as const,
	},
	{
		id: "rec-pauses-editorial",
		baselineCaseId: "case-016",
		mediaPath: path.join(REC, "recording-1789234858783.mp4"),
		prompt: "Summarize what I said. Which parts are silence or dead air?",
		kind: "audio_speech" as const,
	},
	{
		id: "rec-short-speech",
		baselineCaseId: "case-018",
		mediaPath: path.join(REC, "recording-1788980586218.mp4"),
		prompt: "What did I say?",
		kind: "audio_speech" as const,
	},
	{
		id: "rec-no-audio",
		baselineCaseId: "case-008",
		mediaPath: path.join(REC, "recording-1788958840550.mp4"),
		prompt: "What did I say in this recording?",
		kind: "no_audio" as const,
	},
	{
		id: "rec-ui-plus-narration",
		baselineCaseId: "case-011",
		mediaPath: path.join(REC, "recording-1789234858783.mp4"),
		prompt: "What did I say, and what is visible on screen?",
		kind: "audio_speech" as const,
	},
];

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

function baselineSpeech(caseId: string | null) {
	if (!caseId) return null;
	const p = path.join(BASELINE, "cases", caseId, "perception.json");
	if (!existsSync(p)) return null;
	try {
		const perc = JSON.parse(readFileSync(p, "utf8")) as {
			speechStatus?: string | null;
			segmentCount?: number;
		};
		return { speechStatus: perc.speechStatus ?? null, segmentCount: perc.segmentCount ?? 0 };
	} catch {
		return null;
	}
}

function humanSanity(
	kind: string,
	status: string | undefined,
	segments: Array<{ text: string }>,
): string {
	if (kind === "no_audio") return status === "no_audio" ? "NO_SPEECH" : "FAILED";
	if (status === "failed" || status === "unavailable") return "FAILED";
	if (status === "no_speech_detected") return "NO_SPEECH";
	const text = segments
		.map((s) => s.text)
		.join(" ")
		.toLowerCase();
	if (!text.trim()) return "FAILED";
	if (kind === "audio_speech_correction") {
		const hasTimeline = /timeline/i.test(text);
		const hasEffects = /effects/i.test(text);
		const hasCorrection = /actually|meant|mean|go back|correction/i.test(text);
		if (hasTimeline && hasEffects && hasCorrection) return "GOOD";
		if (hasEffects || hasTimeline) return "USABLE_WITH_ERRORS";
		return "BAD";
	}
	if (text.length > 40) return "GOOD";
	if (text.length > 10) return "USABLE_WITH_ERRORS";
	return "BAD";
}

const canRun =
	existsSync(path.join(REC, "recording-bug5-narrated.mp4")) &&
	candidateBinaryPaths().some((p) => p && existsSync(p));

describe.runIf(canRun)("STT recovery live real corpus", () => {
	afterAll(async () => {
		await shutdownStt().catch(() => undefined);
		_resetSttManagerForTests();
	});

	it("health + sequential cold/warm speech recovery subset", async () => {
		mkdirSync(path.join(OUT, "cases"), { recursive: true });
		mkdirSync(path.join(OUT, "transcripts"), { recursive: true });

		writeFileSync(
			path.join(OUT, "selected-cases.json"),
			JSON.stringify({ identity: IDENTITY, cases: SELECTED }, null, 2),
		);

		const health = await probeSttRuntimeHealth({ force: true });
		writeFileSync(path.join(OUT, "runtime-health.json"), JSON.stringify(health, null, 2));
		expect(health.runtimePresent).toBe(true);
		expect(health.modelPresent).toBe(true);

		_resetSttManagerForTests();
		const mgr = getSttManager();
		// Product path: no explicit modelsBaseDir — resolveSttModelsBaseDir must work.
		await mgr.init({});

		const sharedCache = await mkdtemp(path.join(os.tmpdir(), "os-stt-recovery-"));
		const beforeAfter: Array<Record<string, unknown>> = [];
		const latencyRows: Array<Record<string, unknown>> = [];
		let firstPid: number | null = null;

		for (let i = 0; i < SELECTED.length; i++) {
			const c = SELECTED[i]!;
			expect(existsSync(c.mediaPath)).toBe(true);
			const caseDir = path.join(OUT, "cases", c.id);
			mkdirSync(caseDir, { recursive: true });

			const probe = await probeAudioStream(c.mediaPath);
			const base = baselineSpeech(c.baselineCaseId);
			const needs = classifyMediaContextNeeds(c.prompt);
			const doc = buildDoc(c.mediaPath, 60, c.id);

			const t0 = Date.now();
			// Recovery 1 isolates STT: force prepare so mediaContextNeeds gaps
			// (Recovery 2) do not starve speech acquisition measurements.
			const prep = await prepareSpeechEvidenceForTurn({
				document: doc,
				userMessage: c.prompt,
				force: true,
				contextNeeds: needs,
				deps: {
					getSttManager: () => mgr,
					resolveSttBinary: () => candidateBinaryPaths().find((p) => p && existsSync(p)) ?? null,
					cacheDir: sharedCache,
				},
			});
			const totalMs = Date.now() - t0;
			const ev = prep.prepared?.evidence[0];
			const segs = ev?.segments ?? [];
			const sanity = humanSanity(c.kind, ev?.status, segs);

			// Downstream observation only (no policy changes)
			const ledger =
				ev && ev.sourceDurationSec
					? buildLedgerFromPreparedEvidence({
							assetId: "asset_1",
							sourceDurationSec: ev.sourceDurationSec,
							speechEvidence: ev,
						})
					: null;
			const claims = ledger
				? buildClaimPromotionSet({
						ledger,
						investigation: null,
						specialist: null,
					})
				: null;
			const spokenClaims =
				claims?.claims?.filter((x) => x.status === "spoken" || x.kind === "speech") ?? [];

			const storyPrep =
				ev && wantsSourceStory({ ...needs, speech: true, injectSpeech: true })
					? prepareSourceStoryForTurn({
							contextNeeds: { ...needs, speech: true, injectSpeech: true },
							sourceDurationSec: ev.sourceDurationSec ?? 0,
							speechEvidence: ev,
						})
					: null;

			const row = {
				id: c.id,
				baselineCaseId: c.baselineCaseId,
				kind: c.kind,
				hasAudioProbe: probe.present,
				routingWouldRequestSpeech: needs.speech === true,
				baselineSpeechStatus: base?.speechStatus ?? null,
				baselineSegments: base?.segmentCount ?? null,
				recoverySpeechStatus: ev?.status ?? null,
				failureReason: ev?.failureReason ?? null,
				sttInvoked:
					(ev?.timings.sttMs ?? 0) > 0 ||
					(ev?.status === "available" && ev.timings.cacheHit === false),
				extractionImpliedOk: ev?.status === "available" || ev?.status === "no_speech_detected",
				segmentCount: segs.length,
				wordCount: segs.reduce((n, s) => n + (s.words?.length ?? 0), 0),
				firstSegSec: segs[0]?.startSourceTimeSec ?? null,
				lastSegSec: segs[segs.length - 1]?.endSourceTimeSec ?? null,
				cacheHit: ev?.timings.cacheHit ?? false,
				timings: ev?.timings ?? null,
				totalSpeechPrepMs: totalMs,
				engine: ev?.engine ?? null,
				modelsBaseDir: resolveSttModelsBaseDir(),
				humanTranscriptSanity: sanity,
				spokenClaimCount: spokenClaims.length,
				sourceStoryRequested: storyPrep?.requested === true,
				order: i + 1,
			};

			writeFileSync(path.join(caseDir, "speech.json"), JSON.stringify(row, null, 2));
			writeFileSync(path.join(caseDir, "evidence.json"), JSON.stringify(ev ?? null, null, 2));
			const transcriptText = segs
				.map(
					(s) => `[${s.startSourceTimeSec.toFixed(2)}-${s.endSourceTimeSec.toFixed(2)}] ${s.text}`,
				)
				.join("\n");
			writeFileSync(path.join(OUT, "transcripts", `${c.id}.txt`), transcriptText);
			writeFileSync(path.join(caseDir, "transcript.txt"), transcriptText);

			beforeAfter.push(row);
			latencyRows.push({
				id: c.id,
				order: i + 1,
				totalSpeechPrepMs: totalMs,
				sttMs: ev?.timings.sttMs ?? 0,
				audioProbeMs: ev?.timings.audioProbeMs ?? 0,
				cacheHit: ev?.timings.cacheHit ?? false,
			});

			if (c.kind === "no_audio") {
				expect(ev?.status).toBe("no_audio");
				expect(ev?.timings.sttMs ?? 0).toBe(0);
			} else {
				expect(ev?.status).toBe("available");
				expect(segs.length).toBeGreaterThan(0);
			}
		}

		// Warm pass: re-run first narrated case — expect cache hit
		const warm = SELECTED[0]!;
		const tWarm = Date.now();
		const warmPrep = await prepareSpeechEvidenceForTurn({
			document: buildDoc(warm.mediaPath, 60, "warm"),
			userMessage: warm.prompt,
			contextNeeds: classifyMediaContextNeeds(warm.prompt),
			deps: {
				getSttManager: () => mgr,
				resolveSttBinary: () => candidateBinaryPaths().find((p) => p && existsSync(p)) ?? null,
				cacheDir: sharedCache,
			},
		});
		const warmMs = Date.now() - tWarm;
		const warmEv = warmPrep.prepared?.evidence[0];
		writeFileSync(
			path.join(OUT, "warm-cache.json"),
			JSON.stringify(
				{
					status: warmEv?.status,
					cacheHit: warmEv?.timings.cacheHit,
					totalMs: warmMs,
					segmentCount: warmEv?.segments.length,
				},
				null,
				2,
			),
		);
		expect(warmEv?.status).toBe("available");
		expect(warmEv?.timings.cacheHit).toBe(true);

		writeFileSync(path.join(OUT, "before-after.json"), JSON.stringify(beforeAfter, null, 2));
		writeFileSync(
			path.join(OUT, "latency.json"),
			JSON.stringify({ rows: latencyRows, warmMs }, null, 2),
		);

		// Optional agent finals for Case1 + Case4 speech prompts (observe only)
		const apiKey = loadOpenAiKey();
		if (apiKey) {
			for (const c of [SELECTED[0]!, SELECTED[1]!]) {
				const cacheDir = await mkdtemp(path.join(os.tmpdir(), `os-stt-agent-${c.id}-`));
				let raw = "";
				const sink: OpenScreenAgentSink = {
					text: (d) => {
						raw += d;
					},
					thinking: () => undefined,
					toolStart: () => undefined,
					toolEnd: () => undefined,
					error: () => undefined,
				};
				const result = await invokeOpenScreenAgent({
					document: buildDoc(c.mediaPath, 60, `agent_${c.id}`),
					userMessage: c.prompt,
					history: [],
					editsAllowed: false,
					speechCacheDir: path.join(cacheDir, "speech"),
					model: {
						provider: "openai",
						model: "gpt-4o",
						apiKey,
						baseUrl: "https://api.openai.com/v1",
					},
					sink,
				});
				const facing = stripInternalEvidenceJsonBlocks(result.text || raw);
				const speech = result.speechEvidence?.[0];
				writeFileSync(path.join(OUT, "cases", c.id, "final-response.txt"), facing, "utf8");
				writeFileSync(
					path.join(OUT, "cases", c.id, "agent-speech.json"),
					JSON.stringify(
						{
							status: speech?.status ?? null,
							segmentCount: speech?.segments?.length ?? 0,
							failureReason: speech?.failureReason ?? null,
							reason: speech?.reason ?? null,
							sourceStoryV2Beats: result.sourceStoryV2?.beats?.length ?? 0,
							claimSpoken:
								result.claimPromotion?.claims?.filter((x) => x.status === "spoken").length ?? 0,
							facingLen: facing.length,
							agentReason: result.reason ?? null,
						},
						null,
						2,
					),
				);
				expect(facing).not.toMatch(/getPath|whisper-stt-server|ggml-small/i);
				if (speech) {
					expect(speech.status).toBe(c.kind === "no_audio" ? "no_audio" : "available");
				} else {
					writeFileSync(
						path.join(OUT, "cases", c.id, "agent-speech-missing.json"),
						JSON.stringify(
							{
								note: "invokeOpenScreenAgent returned no speechEvidence",
								facingPreview: facing.slice(0, 400),
							},
							null,
							2,
						),
					);
				}
				// Final prose may be empty when the LLM provider is quota-exhausted;
				// that is Recovery 3 / provider — not an STT failure.
				if (facing.length === 0) {
					expect(result.reason ?? result.failureReason ?? "").toMatch(
						/429|Empty response|quota|RateLimit|provider_error|provider_rate|provider_quota|empty_completion|agent_tool_loop|stream_ended/i,
					);
					expect(result.status === "completed").toBe(false);
				}
			}
		}

		void firstPid;
	}, 900_000);
});
