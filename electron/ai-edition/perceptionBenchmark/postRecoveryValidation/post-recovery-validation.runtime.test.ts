/**
 * Post-Recovery Validation V1 — measurement only.
 * Identity: CURRENT_OPENSCREEN_POST_RECOVERY_VALIDATION_V1
 *
 * Does NOT modify production cognition. Runs real invokeOpenScreenAgent turns
 * and writes diagnostic traces for CTO review.
 *
 * Run:
 *   npx vitest --run electron/ai-edition/perceptionBenchmark/postRecoveryValidation/post-recovery-validation.runtime.test.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../../src/lib/ai-edition/schema";
import { readCursorSidecar } from "../../../media/cursorSidecar";
import { candidateBinaryPaths } from "../../../stt/gpuDetector";
import { _resetSttManagerForTests, getSttManager, shutdownStt } from "../../../stt/index";
import { invokeOpenScreenAgent, type OpenScreenAgentSink } from "../../deep-agent/service";
import { classifyMediaContextNeeds } from "../../mediaContextNeeds/classify";
import { probeSourceDurations } from "../../sourceTiming/probe";
import { stripInternalEvidenceJsonBlocks } from "../../speechEvidence/format";
import { prepareSpeechEvidenceForTurn } from "../../speechEvidence/prepare";
import { prepareVisualEvidenceForTurn } from "../../visualEvidence/prepare";
import { REAL_CORPUS_CASES } from "../realCorpusBaseline/cases";
import { loadOpenAiKey } from "../runCurrentStack";

const IDENTITY = "CURRENT_OPENSCREEN_POST_RECOVERY_VALIDATION_V1";
const OUT = path.join(process.cwd(), "tmp/perception-benchmark/post-recovery-validation-v1");
const FFMPEG = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");
const FFPROBE = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffprobe");

type Letter = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L";

interface ValCase {
	id: string;
	letter: Letter;
	title: string;
	baselineCaseId?: string;
	mediaPath: string;
	prompt: string;
	focus: string;
	mustNotClaim?: string[];
}

function corpus(id: string) {
	return REAL_CORPUS_CASES.find((c) => c.caseId === id);
}

function buildManifest(): ValCase[] {
	const c001 = corpus("case-001")!;
	const c003 = corpus("case-003")!;
	const c020 = corpus("case-020")!;
	const c008 = corpus("case-008")!;
	const c002 = corpus("case-002")!;
	const c005 = corpus("case-005")!;
	const c004 = corpus("case-004")!;
	const c016 = corpus("case-016")!;
	const c007 = corpus("case-007")!;
	const c013 = corpus("case-013")!;
	const c021 = corpus("case-021")!;
	const c023 = corpus("case-023")!;

	return [
		{
			id: "val-A-speech-understanding",
			letter: "A",
			title: "Speech understanding (narrated)",
			baselineCaseId: "case-001",
			mediaPath: c001.mediaPath,
			prompt:
				"Watch and listen to this recording. Explain what I am doing and what I am saying over time.",
			focus: "transcript + chronology + visual/speech agreement",
		},
		{
			id: "val-B-case4-correction",
			letter: "B",
			title: "Case 4 spoken correction",
			baselineCaseId: "case-003",
			mediaPath: c003.mediaPath,
			prompt: c003.prompt,
			focus: "Timeline→Effects correction; no false open claims",
			mustNotClaim: [
				"opened Timeline",
				"opened Effects",
				"opened the timeline",
				"opened the effects",
			],
		},
		{
			id: "val-C-case020-zoom",
			letter: "C",
			title: "Case 020 editorial zoom grounding",
			baselineCaseId: "case-020",
			mediaPath: c020.mediaPath,
			prompt: c020.prompt,
			focus: "zoom recommendations must be evidence-backed",
		},
		{
			id: "val-D-visual-only",
			letter: "D",
			title: "Visual-only / silent understanding",
			baselineCaseId: "case-008",
			mediaPath: c008.mediaPath,
			prompt: c008.prompt,
			focus: "no invented speech; visible chronology",
		},
		{
			id: "val-E-restart",
			letter: "E",
			title: "Restart recording temporary UI",
			baselineCaseId: "case-002",
			mediaPath: c002.mediaPath,
			prompt: c002.prompt,
			focus: "Restart UI ≠ restarted recording",
			mustNotClaim: c002.mustNotClaim,
		},
		{
			id: "val-F-upwork",
			letter: "F",
			title: "Passive Upwork chrome",
			baselineCaseId: "case-005",
			mediaPath: c005.mediaPath,
			prompt: c005.prompt,
			focus: "visible ≠ opened/worked",
			mustNotClaim: c005.mustNotClaim,
		},
		{
			id: "val-G-settings",
			letter: "G",
			title: "Settings contradiction",
			baselineCaseId: "case-004",
			mediaPath: c004.mediaPath,
			prompt: c004.prompt,
			focus: "speech/OCR Settings ≠ opened Settings",
			mustNotClaim: c004.mustNotClaim,
		},
		{
			id: "val-H-professional",
			letter: "H",
			title: "Make professional",
			baselineCaseId: "case-007",
			mediaPath: c007.mediaPath,
			prompt: "Make this video look more professional.",
			focus: "recording-specific vs generic advice",
		},
		{
			id: "val-I-shorter-clearer",
			letter: "I",
			title: "Shorter and clearer with preservation",
			baselineCaseId: "case-016",
			mediaPath: c016.mediaPath,
			prompt: "Make this video shorter and clearer without removing the important explanation.",
			focus: "preservation + evidence-backed removals",
		},
		{
			id: "val-J-cross-modal",
			letter: "J",
			title: "Cross-modal speech vs screen",
			baselineCaseId: "case-013",
			mediaPath: c013.mediaPath,
			prompt: c013.prompt,
			focus: "combine speech + visual; not either alone",
		},
		{
			id: "val-K-unsupported",
			letter: "K",
			title: "Unsupported capability",
			baselineCaseId: "case-021",
			mediaPath: c021.mediaPath,
			prompt: c021.prompt,
			focus: "refuse stabilize/denoise/upscale",
			mustNotClaim: c021.mustNotClaim,
		},
		{
			id: "val-L-no-audio",
			letter: "L",
			title: "No-audio honesty",
			baselineCaseId: "case-023",
			mediaPath: c023.mediaPath,
			prompt: c023.prompt,
			focus: "no_audio ≠ STT failure",
		},
	];
}

function buildDoc(mediaPath: string, durationSec: number, title: string) {
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
				originalPath: mediaPath,
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
		},
	});
}

function silentSink(): { sink: OpenScreenAgentSink; raw: string[]; tools: unknown[] } {
	const raw: string[] = [];
	const tools: unknown[] = [];
	return {
		raw,
		tools,
		sink: {
			text: (d) => {
				raw.push(d);
			},
			thinking: () => {},
			toolStart: (name, args) => {
				tools.push({ event: "start", name, args });
			},
			toolEnd: (name, ok, summary) => {
				tools.push({ event: "end", name, ok, summary });
			},
			error: () => {},
		},
	};
}

function writeJson(p: string, v: unknown) {
	writeFileSync(p, JSON.stringify(v, null, 2), "utf8");
}

function autoInfraScore(row: Record<string, unknown>): {
	mark: "PASS" | "PARTIAL" | "FAIL" | "NOT_VERIFIED";
	notes: string[];
} {
	const notes: string[] = [];
	const status = String(row.deliveryStatus ?? "");
	const finalLen = Number(row.finalLen ?? 0);
	if (status === "completed" && finalLen > 0) notes.push("non-empty final");
	else if (status === "provider_error") {
		return { mark: "NOT_VERIFIED", notes: ["provider error — intelligence not judged"] };
	} else if (finalLen === 0) {
		return { mark: "FAIL", notes: ["empty final without typed provider separation"] };
	}
	if (row.speechOk === false) notes.push("speech unexpected");
	if (row.visualExpected && Number(row.frameCount) === 0) notes.push("visual starved");
	// Infrastructure-only: never PASS for intelligence
	return {
		mark: "PARTIAL",
		notes: [...notes, "automated=infra only; manual review authoritative"],
	};
}

describe("Post-Recovery Validation V1 (live, measurement-only)", () => {
	afterAll(async () => {
		try {
			await shutdownStt();
		} catch {
			/* */
		}
		_resetSttManagerForTests();
	});

	it("runs focused A–L real-media validation corpus", async () => {
		mkdirSync(path.join(OUT, "cases"), { recursive: true });
		const apiKey = loadOpenAiKey();
		expect(apiKey.length).toBeGreaterThan(0);

		const health = JSON.parse(readFileSync(path.join(OUT, "provider-health.json"), "utf8")) as {
			simpleRequestOk?: boolean;
		};
		expect(health.simpleRequestOk).toBe(true);

		const only = (process.env.OPENSCREEN_PRV_ONLY || "").split(",").filter(Boolean);
		const cases = buildManifest()
			.filter((c) => existsSync(c.mediaPath))
			.filter((c) => only.length === 0 || only.includes(c.letter));
		writeJson(path.join(OUT, "case-manifest.json"), {
			identity: IDENTITY,
			count: cases.length,
			cases: cases.map((c) => ({
				id: c.id,
				letter: c.letter,
				title: c.title,
				baselineCaseId: c.baselineCaseId,
				mediaPath: c.mediaPath,
				prompt: c.prompt,
				focus: c.focus,
			})),
		});
		expect(cases.length).toBeGreaterThanOrEqual(only.length > 0 ? 1 : 10);

		getSttManager();
		const results: Record<string, unknown>[] = [];
		const latencies: number[] = [];

		for (const c of cases) {
			const caseDir = path.join(OUT, "cases", c.id);
			mkdirSync(caseDir, { recursive: true });
			const cacheDir = await mkdtemp(path.join(os.tmpdir(), `os-prv-${c.id}-`));

			let durationSec = 20;
			try {
				const probe = await probeSourceDurations(c.mediaPath, {
					ffmpegPath: FFMPEG,
					ffprobePath: existsSync(FFPROBE) ? FFPROBE : FFMPEG,
				});
				durationSec = probe.containerDurationSec || durationSec;
			} catch {
				/* keep default */
			}

			const document = buildDoc(c.mediaPath, durationSec, c.id);
			const needs = classifyMediaContextNeeds(c.prompt);

			const tPrep0 = Date.now();
			const visualPrep = await prepareVisualEvidenceForTurn({
				document,
				userMessage: c.prompt,
				provider: "openai",
				contextNeeds: needs,
			});
			const speechPrep = await prepareSpeechEvidenceForTurn({
				document,
				userMessage: c.prompt,
				contextNeeds: needs,
				deps: {
					getSttManager: () => getSttManager(),
					resolveSttBinary: () => candidateBinaryPaths().find((p) => p && existsSync(p)) || null,
					cacheDir: path.join(cacheDir, "speech-diag"),
				},
			}).catch(() => ({ prepared: null as null }));
			const prepMs = Date.now() - tPrep0;

			const holder = silentSink();
			const t0 = Date.now();
			let result: Awaited<ReturnType<typeof invokeOpenScreenAgent>> | null = null;
			let thrown: string | null = null;
			try {
				result = await invokeOpenScreenAgent({
					document,
					userMessage: c.prompt,
					history: [],
					editsAllowed: true,
					speechCacheDir: path.join(cacheDir, "speech-agent"),
					model: {
						provider: "openai",
						model: "gpt-4o",
						apiKey,
						baseUrl: "https://api.openai.com/v1",
					},
					cursor: {
						async probe({ originalPath }) {
							if (!originalPath) return false;
							return (await readCursorSidecar(originalPath, {})).found;
						},
						async read({ assetId, originalPath }) {
							if (!originalPath) {
								return { status: "unavailable" as const, assetId, note: "no path" };
							}
							try {
								const sidecar = await readCursorSidecar(originalPath, {});
								if (!sidecar.found) return { status: "no-sidecar" as const, assetId };
								return {
									status: "ok" as const,
									assetId,
									samples: sidecar.data.samples,
								};
							} catch (e) {
								return {
									status: "unavailable" as const,
									assetId,
									note: e instanceof Error ? e.message : String(e),
								};
							}
						},
					},
					sink: holder.sink,
				});
			} catch (e) {
				thrown = e instanceof Error ? e.message : String(e);
			}
			const agentMs = Date.now() - t0;
			latencies.push(agentMs);

			const rawText = holder.raw.join("") || "";
			const finalText = (result?.text ?? "").trim();
			const sanitized = stripInternalEvidenceJsonBlocks(finalText).trim() || finalText;
			const speech = result?.speechEvidence?.[0] ?? speechPrep.prepared?.evidence?.[0];
			const frames = visualPrep.prepared?.frames ?? [];
			const inv = result?.investigationEvidence;
			const claims = result?.claimPromotion;

			const zoomMentions = (sanitized.match(/\bzooms?\b/gi) ?? []).length;
			const mustNotHits = (c.mustNotClaim ?? []).filter((p) =>
				new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(sanitized),
			);

			const trace = {
				identity: IDENTITY,
				id: c.id,
				letter: c.letter,
				title: c.title,
				prompt: c.prompt,
				mediaPath: c.mediaPath,
				durationSec,
				routing: needs,
				frameCount: frames.length,
				frameTimesSec: frames.map((f) => f.sourceTimeSec).slice(0, 40),
				speechStatus: speech?.status ?? null,
				speechSegmentCount: speech?.segments?.length ?? 0,
				transcriptPreview: (speech?.segments ?? []).slice(0, 12).map((s) => ({
					start: s.startSourceTimeSec,
					end: s.endSourceTimeSec,
					text: s.text,
				})),
				ocrSample: (result?.visualSpecialist?.observations ?? [])
					.filter((o) => /ocr|text/i.test(String(o.kind ?? o.type ?? "")))
					.slice(0, 20),
				visualSpecialistStop: result?.visualSpecialist
					? {
							observationCount: result.visualSpecialist.observations?.length ?? 0,
						}
					: null,
				ledgerEventCount: result?.temporalEventLedger?.events?.length ?? 0,
				ledgerSignificant: (result?.temporalEventLedger?.events ?? []).slice(0, 30).map((e) => ({
					t: e.sourceTimeSec ?? (e as { startSourceTimeSec?: number }).startSourceTimeSec,
					type: e.type ?? (e as { kind?: string }).kind,
					summary: String(
						(e as { summary?: string }).summary ?? (e as { label?: string }).label ?? "",
					).slice(0, 120),
				})),
				investigator: inv
					? {
							stopReason: inv.stopReason,
							toolCount: inv.toolTrace?.length ?? 0,
							focusRange: inv.focusRange,
							claimCount: inv.claims?.length ?? 0,
							observationCount: inv.observations?.length ?? 0,
							additionalFrames: inv.additionalFrames?.length ?? 0,
						}
					: null,
				claims: claims
					? {
							promoted: (claims.claims ?? [])
								.filter(
									(x) => x.status === "spoken" || x.status === "visible" || x.status === "promoted",
								)
								.slice(0, 40)
								.map((x) => ({
									id: x.id,
									status: x.status,
									text: String(x.text ?? x.claim ?? "").slice(0, 160),
								})),
							unresolved: (claims.claims ?? [])
								.filter((x) => /unresolved|uncertain|insufficient/i.test(String(x.status)))
								.slice(0, 20)
								.map((x) => ({
									id: x.id,
									status: x.status,
									text: String(x.text ?? x.claim ?? "").slice(0, 160),
								})),
							allCount: claims.claims?.length ?? 0,
						}
					: null,
				sourceStoryV2: result?.sourceStoryV2
					? {
							beatCount: result.sourceStoryV2.beats?.length ?? 0,
							overallSummary: String(result.sourceStoryV2.overallSummary ?? "").slice(0, 400),
						}
					: null,
				targetStoryV1: result?.targetStoryV1
					? {
							objective: String(result.targetStoryV1.objective ?? "").slice(0, 300),
							changeCount: result.targetStoryV1.desiredChanges?.length ?? 0,
						}
					: null,
				editGap: result?.editGapV1
					? {
							itemCount: result.editGapV1.items?.length ?? 0,
							summary: String(result.editGapV1.summary ?? "").slice(0, 300),
						}
					: null,
				editPlan: result?.editPlanV1
					? {
							strategyCount: result.editPlanV1.strategies?.length ?? 0,
							summary: String(result.editPlanV1.summary ?? "").slice(0, 300),
						}
					: null,
				closure: result?.planningClosureV1
					? {
							status: result.planningClosureV1.status ?? null,
							rounds: result.planningClosureV1.rounds?.length ?? 0,
						}
					: null,
				proposal: result?.editProposalV1
					? {
							count: result.editProposalV1.proposals?.length ?? 0,
							readiness: result.editProposalV1.proposals?.map((p) => p.readiness) ?? [],
						}
					: null,
				rawModelLen: rawText.length,
				finalLen: sanitized.length,
				finalText: sanitized,
				deliveryStatus: result?.status ?? (thrown ? "provider_error" : "unknown"),
				failureReason: result?.failureReason ?? null,
				userMessage: result?.userMessage ?? null,
				diagnostic: result?.reason?.slice(0, 600) ?? thrown,
				zoomMentions,
				mustNotHits,
				latency: { prepMs, agentMs, totalMs: prepMs + agentMs },
				sinkToolEvents: holder.tools.length,
				modelCallsEstimate: 1,
			};

			writeJson(path.join(caseDir, "trace.json"), trace);
			writeFileSync(path.join(caseDir, "final-response.txt"), sanitized, "utf8");
			writeFileSync(path.join(caseDir, "raw-model.txt"), rawText.slice(0, 200_000), "utf8");
			writeJson(path.join(caseDir, "routing.json"), needs);
			writeJson(path.join(caseDir, "speech.json"), {
				status: speech?.status ?? null,
				segments: speech?.segments?.slice(0, 40) ?? [],
				failureReason: speech?.failureReason ?? null,
			});
			writeJson(path.join(caseDir, "visual.json"), {
				frameCount: frames.length,
				times: frames.map((f) => f.sourceTimeSec),
			});
			writeJson(path.join(caseDir, "investigator.json"), inv ?? { present: false });
			writeJson(path.join(caseDir, "claims.json"), claims ?? { present: false });
			writeJson(path.join(caseDir, "source-story.json"), {
				v2: result?.sourceStoryV2 ?? null,
				v1: result?.sourceStory ?? null,
			});
			writeJson(path.join(caseDir, "target-story.json"), {
				v1: result?.targetStoryV1 ?? null,
				legacy: result?.targetStory ?? null,
			});
			writeJson(path.join(caseDir, "edit-gap.json"), result?.editGapV1 ?? { present: false });
			writeJson(path.join(caseDir, "edit-plan.json"), result?.editPlanV1 ?? { present: false });
			writeJson(
				path.join(caseDir, "closure.json"),
				result?.planningClosureV1 ?? {
					present: false,
				},
			);
			writeJson(
				path.join(caseDir, "proposal.json"),
				result?.editProposalV1 ?? {
					present: false,
				},
			);
			writeJson(path.join(caseDir, "delivery.json"), {
				status: result?.status,
				failureReason: result?.failureReason,
				userMessage: result?.userMessage,
				finalLen: sanitized.length,
			});

			const row = {
				id: c.id,
				letter: c.letter,
				title: c.title,
				deliveryStatus: trace.deliveryStatus,
				finalLen: sanitized.length,
				speechStatus: speech?.status ?? null,
				frameCount: frames.length,
				visualExpected: needs.visual,
				speechOk: !needs.speech || speech?.status === "available" || speech?.status === "no_audio",
				investigatorStop: inv?.stopReason ?? null,
				investigatorTools: inv?.toolTrace?.length ?? 0,
				zoomMentions,
				mustNotHits,
				sourceStoryV2Beats: result?.sourceStoryV2?.beats?.length ?? 0,
				targetStoryPresent: Boolean(result?.targetStoryV1),
				editGapItems: result?.editGapV1?.items?.length ?? 0,
				editPlanStrategies: result?.editPlanV1?.strategies?.length ?? 0,
				proposalCount: result?.editProposalV1?.proposals?.length ?? 0,
				agentMs,
				finalPreview: sanitized.slice(0, 280),
			};
			const auto = autoInfraScore(row);
			results.push({ ...row, automatedScore: auto });
		}

		const sorted = [...latencies].sort((a, b) => a - b);
		const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
		const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1] ?? 0;

		writeJson(path.join(OUT, "case-results.json"), {
			identity: IDENTITY,
			results,
		});
		writeJson(path.join(OUT, "latency-summary.json"), {
			identity: IDENTITY,
			count: latencies.length,
			p50,
			p95,
			mean: Math.round(latencies.reduce((a, b) => a + b, 0) / Math.max(1, latencies.length)),
			rows: results.map((r) => ({ id: r.id, agentMs: r.agentMs })),
		});

		// Placeholder manual review skeleton — filled by post-run report authoring
		writeJson(path.join(OUT, "manual-review.json"), {
			identity: IDENTITY,
			note: "Authoritative scores live in AI_POST_RECOVERY_VALIDATION_V1_REPORT.md; this file mirrors case finals for review.",
			cases: results.map((r) => ({
				id: r.id,
				letter: r.letter,
				automatedScore: r.automatedScore,
				manualMark: "PENDING_REPORT",
				finalPreview: r.finalPreview,
				mustNotHits: r.mustNotHits,
				zoomMentions: r.zoomMentions,
			})),
		});

		const completed = results.filter((r) => r.deliveryStatus === "completed").length;
		expect(completed).toBeGreaterThan(0);
	}, 1_200_000);
});
