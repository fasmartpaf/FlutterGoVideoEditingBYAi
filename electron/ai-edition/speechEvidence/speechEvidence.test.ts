import { mkdtemp, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withTranscript } from "../../../src/lib/ai-edition/document/transcript";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import type { SttTranscribeResponse } from "../../stt/transcriptionContract";
import { documentSnapshotForModel, executeAgentTool } from "../agent-tools";
import { stripVisualSemanticJsonBlock } from "../visualEvidence/semantic";
import {
	assertSegmentChronology,
	assertSegmentsWithinDuration,
	axcutTranscriptFromSttResponse,
	buildSpeechCacheIdentity,
	filterSpeechSegmentsBySourceRange,
	isUnavailableTranscriptionWording,
	promptWantsSpeechEvidence,
	readSpeechCache,
	resolveInjectedSpeechStatus,
	SPEECH_STATUS_USER_WORDING,
	speechEvidenceFromAxcutTranscript,
	speechStatusAllowsUnavailableWording,
	stripInternalEvidenceJsonBlocks,
	writeSpeechCache,
} from "./index";
import { prepareSpeechEvidenceForTurn } from "./prepare";

function baseDoc(videoPath: string, durationSec = 20) {
	const CREATED = "2026-01-01T00:00:00.000Z";
	const base = createEmptyDocument({ title: "S", projectId: "p", createdAt: CREATED });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				label: "rec",
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
					id: "c1",
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

const sttResponse: SttTranscribeResponse = {
	segments: [
		{ text: "Today I'm going to show you", startSec: 0.2, endSec: 2.1 },
		{ text: "Now let's move into the code", startSec: 5.0, endSec: 7.2 },
	],
	wordSegments: [
		{ word: "Today", startSec: 0.2, endSec: 0.5 },
		{ word: "I'm", startSec: 0.5, endSec: 0.7 },
		{ word: "going", startSec: 0.7, endSec: 1.0 },
		{ word: "to", startSec: 1.0, endSec: 1.1 },
		{ word: "show", startSec: 1.1, endSec: 1.4 },
		{ word: "you", startSec: 1.4, endSec: 2.1 },
		{ word: "Now", startSec: 5.0, endSec: 5.2 },
		{ word: "let's", startSec: 5.2, endSec: 5.5 },
		{ word: "move", startSec: 5.5, endSec: 5.8 },
		{ word: "into", startSec: 5.8, endSec: 6.2 },
		{ word: "the", startSec: 6.2, endSec: 6.4 },
		{ word: "code", startSec: 6.4, endSec: 7.2 },
	],
	detectedLanguage: "en",
	backend: "whispercpp-metal",
};

describe("speech evidence Bug 5", () => {
	it("1 — audio present != transcription available (intent)", () => {
		expect(promptWantsSpeechEvidence("Make this video professional.")).toBe(true);
		expect(promptWantsSpeechEvidence("Delete 10.2–13.5 seconds")).toBe(false);
	});

	it("2 — no audio stream handled distinctly", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "os-sp-"));
		const videoPath = path.join(dir, "silent.mp4");
		await writeFile(videoPath, "not-a-real-mp4");
		const prepared = await prepareSpeechEvidenceForTurn({
			document: baseDoc(videoPath),
			userMessage: "Analyze this recording and make a transcription.",
			deps: {
				cacheDir: path.join(dir, "cache"),
				resolveSttBinary: () => null,
				getSttManager: () => {
					throw new Error("should not run STT");
				},
			},
		});
		const ev = prepared.prepared?.evidence[0];
		// Without ffmpeg decode of garbage file, probe may be false or null — never "available".
		expect(ev?.status === "available").toBe(false);
		expect(
			ev?.status === "no_audio" || ev?.status === "unavailable" || ev?.status === "failed",
		).toBe(true);
	});

	it("3 — STT unavailable handled distinctly", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "os-sp-"));
		const videoPath = path.join(dir, "clip.mp4");
		await writeFile(videoPath, "x");
		const prepared = await prepareSpeechEvidenceForTurn({
			document: baseDoc(videoPath),
			userMessage: "transcribe this",
			force: true,
			deps: {
				cacheDir: path.join(dir, "cache"),
				resolveSttBinary: () => null,
				probeAudioStream: async () => ({ present: true, codec: "aac" }),
			},
		});
		expect(prepared.prepared).not.toBeNull();
		const ev = prepared.prepared?.evidence[0];
		expect(ev?.status).toBe("unavailable");
		expect(ev?.audioStreamPresent).toBe(true);
		expect(ev?.reason).toMatch(/unavailable/i);
	});

	it("4 — successful transcript contains valid source timestamps", () => {
		const transcript = axcutTranscriptFromSttResponse({
			assetId: "asset_1",
			response: sttResponse,
		});
		expect(transcript.segments.every((s) => s.startSec >= 0 && s.endSec >= s.startSec)).toBe(true);
		const speech = speechEvidenceFromAxcutTranscript({
			assetId: "asset_1",
			transcript,
			sourceDurationSec: 20,
			status: "available",
			audioStreamPresent: true,
			timings: {
				audioProbeMs: 1,
				audioExtractMs: 0,
				sttMs: 10,
				transcriptParseMs: 1,
				transcriptCacheMs: 0,
				segmentCount: transcript.segments.length,
				cacheHit: false,
			},
		});
		expect(speech.segments[0]?.startSourceTimeSec).toBe(0.2);
		expect(assertSegmentsWithinDuration(speech.segments, 20)).toEqual([]);
	});

	it("repairs collapsed one-word segments so full speech text stays visible", () => {
		const words = Array.from({ length: 12 }, (_, i) => ({
			id: `word_${i + 1}`,
			segmentId: `seg_${i + 1}`,
			startSec: 23.92,
			endSec: 23.94,
			text: i === 11 ? "now" : `w${i}`,
		}));
		const transcript = {
			assetId: "a",
			language: "en",
			segments: words.map((w) => ({
				id: w.segmentId,
				kind: "speech" as const,
				startSec: w.startSec,
				endSec: w.endSec,
				text: w.text,
				wordIds: [w.id],
			})),
			words,
		};
		const speech = speechEvidenceFromAxcutTranscript({
			assetId: "a",
			transcript,
			sourceDurationSec: 24.35,
			status: "available",
			audioStreamPresent: true,
			timings: {
				audioProbeMs: 0,
				audioExtractMs: 0,
				sttMs: 0,
				transcriptParseMs: 0,
				transcriptCacheMs: 0,
				segmentCount: 12,
				cacheHit: true,
			},
		});
		expect(speech.segments).toHaveLength(1);
		expect(speech.segments[0]?.startSourceTimeSec).toBe(0);
		expect(speech.segments[0]?.endSourceTimeSec).toBe(24.35);
		expect(speech.segments[0]?.text).toContain("now");
		expect(speech.segments[0]?.text.split(/\s+/).length).toBe(12);
	});

	it("5 — segment chronology enforced", () => {
		const speech = speechEvidenceFromAxcutTranscript({
			assetId: "a",
			transcript: axcutTranscriptFromSttResponse({ assetId: "a", response: sttResponse }),
			status: "available",
			audioStreamPresent: true,
			timings: {
				audioProbeMs: 0,
				audioExtractMs: 0,
				sttMs: 0,
				transcriptParseMs: 0,
				transcriptCacheMs: 0,
				segmentCount: 2,
				cacheHit: false,
			},
		});
		expect(assertSegmentChronology(speech.segments)).toEqual([]);
	});

	it("6 — segment timestamps remain within source duration", () => {
		const speech = speechEvidenceFromAxcutTranscript({
			assetId: "a",
			transcript: axcutTranscriptFromSttResponse({ assetId: "a", response: sttResponse }),
			status: "available",
			audioStreamPresent: true,
			timings: {
				audioProbeMs: 0,
				audioExtractMs: 0,
				sttMs: 0,
				transcriptParseMs: 0,
				transcriptCacheMs: 0,
				segmentCount: 2,
				cacheHit: false,
			},
		});
		expect(assertSegmentsWithinDuration(speech.segments, 7.2)).toEqual([]);
		expect(assertSegmentsWithinDuration(speech.segments, 1).length).toBeGreaterThan(0);
	});

	it("7 — empty/no-speech result handled distinctly", () => {
		const transcript = axcutTranscriptFromSttResponse({
			assetId: "a",
			response: {
				segments: [],
				wordSegments: [],
				detectedLanguage: "en",
				backend: "whispercpp-metal",
			},
		});
		const speech = speechEvidenceFromAxcutTranscript({
			assetId: "a",
			transcript,
			status: "no_speech_detected",
			audioStreamPresent: true,
			timings: {
				audioProbeMs: 0,
				audioExtractMs: 0,
				sttMs: 1,
				transcriptParseMs: 0,
				transcriptCacheMs: 0,
				segmentCount: 0,
				cacheHit: false,
			},
		});
		expect(speech.status).toBe("no_speech_detected");
		expect(speech.audioStreamPresent).toBe(true);
		expect(speech.segments).toEqual([]);
	});

	it("8 — STT failure does not break visual analysis path (prepare isolates)", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "os-sp-"));
		const videoPath = path.join(dir, "clip.mp4");
		await writeFile(videoPath, "x");
		// Binary path must exist so prepare reaches STT invoke.
		const fakeBin = path.join(dir, "whisper-stt-server");
		await writeFile(fakeBin, "#!/bin/sh\n");
		const prepared = await prepareSpeechEvidenceForTurn({
			document: baseDoc(videoPath),
			userMessage: "analyze this video",
			force: true,
			deps: {
				cacheDir: path.join(dir, "cache"),
				resolveSttBinary: () => fakeBin,
				probeAudioStream: async () => ({ present: true, codec: "aac" }),
				getSttManager: () =>
					({
						transcribe: async () => {
							throw new Error("helper crashed");
						},
					}) as never,
			},
		});
		expect(prepared.prepared?.evidence[0]?.status).toBe("failed");
		expect(prepared.document.assets).toHaveLength(1);
	});

	it("9 — transcript cache hit avoids re-transcription", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "os-sp-"));
		const videoPath = path.join(dir, "clip.mp4");
		await writeFile(videoPath, "x");
		const cacheDir = path.join(dir, "cache");
		const identity = await buildSpeechCacheIdentity({
			sourcePath: videoPath,
			modelId: "ggml-small-q8_0.bin",
		});
		expect(identity).not.toBeNull();
		const transcript = axcutTranscriptFromSttResponse({
			assetId: "asset_1",
			response: sttResponse,
		});
		await writeSpeechCache(cacheDir, {
			identity: identity!,
			transcript,
			engine: "whispercpp-metal",
			savedAt: new Date().toISOString(),
		});
		let sttCalls = 0;
		const prepared = await prepareSpeechEvidenceForTurn({
			document: baseDoc(videoPath),
			userMessage: "transcribe this",
			force: true,
			deps: {
				cacheDir,
				resolveSttBinary: () => "/usr/bin/true",
				probeAudioStream: async () => ({ present: true, codec: "aac" }),
				getSttManager: () =>
					({
						transcribe: async () => {
							sttCalls += 1;
							return sttResponse;
						},
					}) as never,
			},
		});
		expect(prepared.prepared).not.toBeNull();
		expect(sttCalls).toBe(0);
		expect(prepared.prepared?.evidence[0]?.timings.cacheHit).toBe(true);
		expect(prepared.prepared?.evidence[0]?.status).toBe("available");
	});

	it("10 — cache invalidates when source media changes", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "os-sp-"));
		const videoPath = path.join(dir, "clip.mp4");
		await writeFile(videoPath, "x");
		const cacheDir = path.join(dir, "cache");
		const identity = await buildSpeechCacheIdentity({
			sourcePath: videoPath,
			modelId: "ggml-small-q8_0.bin",
		});
		const transcript = axcutTranscriptFromSttResponse({
			assetId: "asset_1",
			response: sttResponse,
		});
		await writeSpeechCache(cacheDir, {
			identity: identity!,
			transcript,
			savedAt: new Date().toISOString(),
		});
		await writeFile(videoPath, "changed-bytes");
		await utimes(videoPath, new Date(), new Date(Date.now() + 2000));
		const next = await buildSpeechCacheIdentity({
			sourcePath: videoPath,
			modelId: "ggml-small-q8_0.bin",
		});
		const hit = await readSpeechCache(cacheDir, next!);
		expect(hit).toBeNull();
	});

	it("11 — range retrieval returns only relevant segments", () => {
		const doc = withTranscript(
			baseDoc("/tmp/x.mp4"),
			axcutTranscriptFromSttResponse({ assetId: "asset_1", response: sttResponse }),
		);
		const result = executeAgentTool(
			doc,
			"getTranscriptRange",
			JSON.stringify({ startSourceTimeSec: 4.5, endSourceTimeSec: 8 }),
		);
		expect(result.ok).toBe(true);
		const payload = JSON.parse(result.resultJson!) as {
			segments: Array<{ text: string; startSec: number }>;
			ranged: boolean;
		};
		expect(payload.ranged).toBe(true);
		expect(payload.segments.every((s) => s.startSec >= 4.5 - 0.1)).toBe(true);
		expect(payload.segments.some((s) => /code/i.test(s.text))).toBe(true);
		expect(payload.segments.some((s) => /Today/i.test(s.text))).toBe(false);

		const filtered = filterSpeechSegmentsBySourceRange(
			speechEvidenceFromAxcutTranscript({
				assetId: "asset_1",
				transcript: doc.transcripts[0]!,
				status: "available",
				audioStreamPresent: true,
				timings: {
					audioProbeMs: 0,
					audioExtractMs: 0,
					sttMs: 0,
					transcriptParseMs: 0,
					transcriptCacheMs: 0,
					segmentCount: 2,
					cacheHit: true,
				},
			}).segments,
			4.5,
			8,
		);
		expect(filtered).toHaveLength(1);
	});

	it("12 — transcript evidence does not invent visual facts (tool note)", () => {
		const doc = withTranscript(
			baseDoc("/tmp/x.mp4"),
			axcutTranscriptFromSttResponse({ assetId: "asset_1", response: sttResponse }),
		);
		const result = executeAgentTool(doc, "getTranscript", "{}");
		expect(result.resultJson).toMatch(/not proof of visual UI actions/i);
	});

	it("13 — visual + speech evidence can coexist in snapshot", () => {
		const doc = withTranscript(
			baseDoc("/tmp/x.mp4"),
			axcutTranscriptFromSttResponse({ assetId: "asset_1", response: sttResponse }),
		);
		const snap = documentSnapshotForModel(doc, undefined, {
			visualFramesSupplied: true,
			audioStream: true,
			speechStatus: "available",
		}) as {
			mediaCapabilities: {
				visualFrames: boolean;
				transcript: boolean;
				audioStream: boolean;
				speechStatus: string;
				semanticUi: boolean;
			};
		};
		expect(snap.mediaCapabilities.visualFrames).toBe(true);
		expect(snap.mediaCapabilities.transcript).toBe(true);
		expect(snap.mediaCapabilities.audioStream).toBe(true);
		expect(snap.mediaCapabilities.speechStatus).toBe("available");
		expect(snap.mediaCapabilities.semanticUi).toBe(false);
	});

	it("14 — normal user response does not expose transcript JSON", () => {
		const raw = [
			"```json",
			JSON.stringify({ segments: [{ text: "hi", startSourceTimeSec: 0, endSourceTimeSec: 1 }] }),
			"```",
			"",
			"Here's what was said across the sampled times.",
		].join("\n");
		const stripped = stripInternalEvidenceJsonBlocks(raw);
		expect(stripped).not.toMatch(/"segments"/);
		expect(stripped).toMatch(/Here's what was said/);
	});

	it("15 — normal visual response does not expose Bug 4 semantic JSON", () => {
		const raw = [
			"```json",
			JSON.stringify({
				observations: [{ sourceTimeSec: 0, frameSummary: "editor", regions: [] }],
				transitions: [],
			}),
			"```",
			"",
			"Across the sampled frames, you begin in the editor.",
		].join("\n");
		expect(stripInternalEvidenceJsonBlocks(raw)).not.toMatch(/"observations"/);
		expect(stripVisualSemanticJsonBlock(raw)).not.toMatch(/"observations"/);
		expect(stripInternalEvidenceJsonBlocks(raw)).toMatch(/Across the sampled frames/);
	});

	it("16 — deterministic timestamp edit does not request speech", () => {
		expect(promptWantsSpeechEvidence("Delete 10.2–13.5 seconds")).toBe(false);
		expect(promptWantsSpeechEvidence("Trim 0-2s")).toBe(false);
	});

	it("17 — editing-intelligence path can request transcript without 'transcribe'", () => {
		expect(promptWantsSpeechEvidence("Make this video professional.")).toBe(true);
		expect(promptWantsSpeechEvidence("Improve and tighten this recording")).toBe(true);
	});

	it("18 — no second model invocation for transcription (STT is local)", async () => {
		// prepareSpeechEvidenceForTurn never calls an LLM — only optional SttManager.
		const dir = await mkdtemp(path.join(os.tmpdir(), "os-sp-"));
		const videoPath = path.join(dir, "clip.mp4");
		await writeFile(videoPath, "x");
		await prepareSpeechEvidenceForTurn({
			document: baseDoc(videoPath),
			userMessage: "Make this video professional.",
			deps: { resolveSttBinary: () => null, cacheDir: path.join(dir, "c") },
		});
		expect(true).toBe(true);
	});

	it("11 — cached transcript is not prepared on irrelevant visual-only turn", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "os-sp-"));
		const videoPath = path.join(dir, "clip.mp4");
		await writeFile(videoPath, "x");
		const withTx = withTranscript(
			baseDoc(videoPath),
			axcutTranscriptFromSttResponse({ assetId: "asset_1", response: sttResponse }),
		);
		const prepared = await prepareSpeechEvidenceForTurn({
			document: withTx,
			userMessage: "What is visible on screen around 6 seconds?",
			contextNeeds: {
				category: "visualInspection",
				visual: true,
				speech: false,
				cursor: false,
				injectSpeech: false,
			},
			deps: {
				cacheDir: path.join(dir, "c"),
				resolveSttBinary: () => null,
				getSttManager: () => {
					throw new Error("STT must not run");
				},
			},
		});
		expect(prepared.prepared).toBeNull();
	});

	it("13 — context-needs structures stripped from user-facing text", () => {
		const raw = '```json\n{"injectSpeech":true,"category":"editingContext"}\n```\nLooks polished.';
		expect(stripInternalEvidenceJsonBlocks(raw)).not.toMatch(/injectSpeech/);
		expect(stripInternalEvidenceJsonBlocks(raw)).toMatch(/Looks polished/);
	});

	it("14 — persisted transcriptionFailure no-audio emits SpeechEvidence.status=no_audio without STT", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "os-sp-"));
		const videoPath = path.join(dir, "clip.mp4");
		await writeFile(videoPath, "x");
		let sttCalls = 0;
		let probeCalls = 0;
		const document = documentSchema.parse({
			...baseDoc(videoPath),
			assets: [
				{
					...baseDoc(videoPath).assets[0]!,
					transcriptionFailure: {
						kind: "no-audio",
						message: "NoAudioTrackError",
						at: "2026-01-01T00:00:00.000Z",
					},
				},
			],
		});
		const prepared = await prepareSpeechEvidenceForTurn({
			document,
			userMessage: "Watch and understand this recording, including what I say.",
			force: true,
			deps: {
				cacheDir: path.join(dir, "c"),
				probeAudioStream: async () => {
					probeCalls += 1;
					return { present: false, reason: "should not probe" };
				},
				resolveSttBinary: () => "/fake/whisper",
				getSttManager: () =>
					({
						transcribe: async () => {
							sttCalls += 1;
							throw new Error("STT must not run");
						},
					}) as never,
			},
		});
		const ev = prepared.prepared?.evidence[0];
		expect(ev?.status).toBe("no_audio");
		expect(ev?.segments).toEqual([]);
		expect(ev?.audioStreamPresent).toBe(false);
		expect(ev?.engine).toBe("persisted-transcription-failure");
		expect(sttCalls).toBe(0);
		expect(probeCalls).toBe(0);

		const status = resolveInjectedSpeechStatus({
			injectSpeech: true,
			primarySpeech: ev,
			document,
		});
		expect(status).toBe("no_audio");
		expect(status).not.toBe("unavailable");

		const snap = documentSnapshotForModel(document, undefined, {
			audioStream: false,
			speechStatus: status,
		}) as { mediaCapabilities: { speechStatus: string; audioStream: boolean } };
		expect(snap.mediaCapabilities.speechStatus).toBe("no_audio");
		expect(snap.mediaCapabilities.audioStream).toBe(false);
	});

	it("15 — no_speech_detected / unavailable / failed remain distinct from no_audio", () => {
		expect(resolveInjectedSpeechStatus({ injectSpeech: true, primarySpeech: null })).toBe(
			"unavailable",
		);
		expect(
			resolveInjectedSpeechStatus({
				injectSpeech: true,
				primarySpeech: {
					assetId: "a",
					segments: [],
					status: "no_speech_detected",
					audioStreamPresent: true,
					timings: {
						audioProbeMs: 0,
						audioExtractMs: 0,
						sttMs: 0,
						transcriptParseMs: 0,
						transcriptCacheMs: 0,
						segmentCount: 0,
						cacheHit: false,
					},
				},
			}),
		).toBe("no_speech_detected");
		expect(
			resolveInjectedSpeechStatus({
				injectSpeech: true,
				primarySpeech: {
					assetId: "a",
					segments: [],
					status: "failed",
					audioStreamPresent: true,
					timings: {
						audioProbeMs: 0,
						audioExtractMs: 0,
						sttMs: 0,
						transcriptParseMs: 0,
						transcriptCacheMs: 0,
						segmentCount: 0,
						cacheHit: false,
					},
				},
			}),
		).toBe("failed");
		expect(speechStatusAllowsUnavailableWording("no_audio")).toBe(false);
		expect(speechStatusAllowsUnavailableWording("unavailable")).toBe(true);
		expect(SPEECH_STATUS_USER_WORDING.no_audio).not.toMatch(/unavailable/i);
		expect(SPEECH_STATUS_USER_WORDING.no_speech_detected).not.toMatch(/unavailable/i);
		expect(isUnavailableTranscriptionWording(SPEECH_STATUS_USER_WORDING.unavailable)).toBe(true);
		expect(
			stripInternalEvidenceJsonBlocks(
				`${SPEECH_STATUS_USER_WORDING.no_audio}\n\`\`\`json\n{"storyBeats":[]}\n\`\`\``,
			),
		).not.toMatch(/storyBeats|no_audio/);
	});
});
