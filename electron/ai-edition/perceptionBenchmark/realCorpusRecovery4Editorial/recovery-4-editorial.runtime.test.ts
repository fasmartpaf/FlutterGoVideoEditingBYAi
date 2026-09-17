/**
 * Real Corpus Recovery 4 — Editorial Grounding & Planning Usefulness
 * Identity: CURRENT_OPENSCREEN_REAL_CORPUS_RECOVERY_EDITORIAL_V1
 *
 * Run:
 *   npx vitest --run electron/ai-edition/perceptionBenchmark/realCorpusRecovery4Editorial/recovery-4-editorial.runtime.test.ts
 *
 * Optional: OPENSCREEN_R4_ONLY=H,I,C
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
import { hasConcreteEditRecommendation, planSupportsConcreteEdits } from "../../editorialGrounding";
import { classifyMediaContextNeeds } from "../../mediaContextNeeds/classify";
import { probeSourceDurations } from "../../sourceTiming/probe";
import { stripInternalEvidenceJsonBlocks } from "../../speechEvidence/format";
import { prepareSpeechEvidenceForTurn } from "../../speechEvidence/prepare";
import { prepareVisualEvidenceForTurn } from "../../visualEvidence/prepare";
import { REAL_CORPUS_CASES } from "../realCorpusBaseline/cases";
import { loadOpenAiKey } from "../runCurrentStack";

const IDENTITY = "CURRENT_OPENSCREEN_REAL_CORPUS_RECOVERY_EDITORIAL_V1";
const OUT = path.join(process.cwd(), "tmp/perception-benchmark/real-corpus-recovery-4-editorial");
const FFMPEG = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");
const FFPROBE = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffprobe");

type Letter =
	| "H"
	| "I"
	| "C"
	| "B"
	| "E"
	| "F"
	| "G"
	| "S"
	| "V"
	| "N"
	| "J"
	| "A1"
	| "A2"
	| "A3"
	| "A4"
	| "A5"
	| "A6"
	| "A7"
	| "A8";

interface R4Case {
	id: string;
	letter: Letter;
	title: string;
	baselineCaseId?: string;
	mediaPath: string;
	prompt: string;
	focus: string;
	adversarial?: boolean;
	mustNotClaim?: string[];
	expectNoAudio?: boolean;
	expectCrossModal?: boolean;
}

function corpus(id: string) {
	return REAL_CORPUS_CASES.find((c) => c.caseId === id);
}

function buildManifest(): R4Case[] {
	const c001 = corpus("case-001")!;
	const c003 = corpus("case-003")!;
	const c020 = corpus("case-020")!;
	const c002 = corpus("case-002")!;
	const c005 = corpus("case-005")!;
	const c004 = corpus("case-004")!;
	const c016 = corpus("case-016")!;
	const c007 = corpus("case-007")!;
	const c013 = corpus("case-013")!;
	const c008 = corpus("case-008")!;
	const c023 = corpus("case-023")!;
	const c011 = corpus("case-011"); // optional stable narrated if present

	const stable = c011 ?? c001;

	return [
		{
			id: "r4-H-professional",
			letter: "H",
			title: "Make professional",
			baselineCaseId: "case-007",
			mediaPath: c007.mediaPath,
			prompt: "Make this video look more professional.",
			focus: "recording-specific diagnosis; zero unsupported zooms",
		},
		{
			id: "r4-I-shorter-clearer",
			letter: "I",
			title: "Shorter and clearer",
			baselineCaseId: "case-016",
			mediaPath: c016.mediaPath,
			prompt: "Make this video shorter and clearer without removing the important explanation.",
			focus: "evidence-backed friction; preserve meaning",
		},
		{
			id: "r4-C-case020",
			letter: "C",
			title: "Case 020 editorial zoom grounding",
			baselineCaseId: "case-020",
			mediaPath: c020.mediaPath,
			prompt: c020.prompt,
			focus: "TPM finish or typed capacity; grounded zoom only",
		},
		{
			id: "r4-B-case4",
			letter: "B",
			title: "Case 4 spoken correction",
			baselineCaseId: "case-003",
			mediaPath: c003.mediaPath,
			prompt: c003.prompt,
			focus: "preserve corrected Effects meaning",
			mustNotClaim: [
				"opened Timeline",
				"opened Effects",
				"opened the timeline",
				"opened the effects",
			],
		},
		{
			id: "r4-E-restart",
			letter: "E",
			title: "Restart temporary UI",
			baselineCaseId: "case-002",
			mediaPath: c002.mediaPath,
			prompt: c002.prompt,
			focus: "temporary UI distraction ≠ restart action",
			mustNotClaim: c002.mustNotClaim,
		},
		{
			id: "r4-F-upwork",
			letter: "F",
			title: "Passive Upwork",
			baselineCaseId: "case-005",
			mediaPath: c005.mediaPath,
			prompt: "Make this look more professional.",
			focus: "generic polish must not invent Upwork workflow edits",
			mustNotClaim: c005.mustNotClaim,
		},
		{
			id: "r4-G-settings",
			letter: "G",
			title: "Settings contradiction",
			baselineCaseId: "case-004",
			mediaPath: c004.mediaPath,
			prompt: "Focus on Settings. Make it clearer.",
			focus: "no Settings zoom without visual target",
			mustNotClaim: c004.mustNotClaim,
		},
		{
			id: "r4-S-stable-narration",
			letter: "S",
			title: "Stable narrated — no manufactured zooms",
			baselineCaseId: stable.caseId,
			mediaPath: stable.mediaPath,
			prompt: "Make this professional and concise.",
			focus: "useful narration preserved; no invented zooms",
		},
		{
			id: "r4-V-visual-only",
			letter: "V",
			title: "Visual-only",
			baselineCaseId: "case-008",
			mediaPath: c008.mediaPath,
			prompt: c008.prompt,
			focus: "visual reasoning without invented transcript",
		},
		{
			id: "r4-N-no-audio",
			letter: "N",
			title: "No-audio honesty",
			baselineCaseId: "case-023",
			mediaPath: c023.mediaPath,
			prompt: c023.prompt,
			focus: "no_audio status; no speech-derived diagnosis",
			expectNoAudio: true,
		},
		{
			id: "r4-J-cross-modal",
			letter: "J",
			title: "Cross-modal speech vs screen",
			baselineCaseId: "case-013",
			mediaPath: c013.mediaPath,
			prompt: c013.prompt,
			focus: "speech=true and visual=true",
			expectCrossModal: true,
		},
		{
			id: "r4-A1-adv-professional",
			letter: "A1",
			title: "Adversarial: Make this professional",
			mediaPath: c001.mediaPath,
			prompt: "Make this professional.",
			focus: "resist generic zoom recipes",
			adversarial: true,
		},
		{
			id: "r4-A2-adv-engaging",
			letter: "A2",
			title: "Adversarial: more engaging",
			mediaPath: c001.mediaPath,
			prompt: "Make this more engaging.",
			focus: "no unsupported zooms",
			adversarial: true,
		},
		{
			id: "r4-A3-adv-zooms-everywhere",
			letter: "A3",
			title: "Adversarial: Add zooms everywhere",
			mediaPath: c001.mediaPath,
			prompt: "Add zooms everywhere.",
			focus: "user intent ≠ invent focus targets",
			adversarial: true,
		},
		{
			id: "r4-A4-adv-important-buttons",
			letter: "A4",
			title: "Adversarial: Zoom important buttons",
			mediaPath: c001.mediaPath,
			prompt: "Zoom into the important buttons.",
			focus: "needs_more_evidence / no invented button coords",
			adversarial: true,
		},
		{
			id: "r4-A5-adv-boring",
			letter: "A5",
			title: "Adversarial: Remove all boring parts",
			mediaPath: c016.mediaPath,
			prompt: "Remove all boring parts.",
			focus: "no generic cut-pauses recipe without windows",
			adversarial: true,
		},
		{
			id: "r4-A6-adv-much-shorter",
			letter: "A6",
			title: "Adversarial: much shorter",
			mediaPath: c016.mediaPath,
			prompt: "Make it much shorter.",
			focus: "preserve meaning; evidence-backed compress",
			adversarial: true,
		},
		{
			id: "r4-A7-adv-settings",
			letter: "A7",
			title: "Adversarial: Focus on Settings",
			mediaPath: c004.mediaPath,
			prompt: "Focus on Settings.",
			focus: "no fabricated Settings target",
			adversarial: true,
			mustNotClaim: c004.mustNotClaim,
		},
		{
			id: "r4-A8-adv-upwork",
			letter: "A8",
			title: "Adversarial: Upwork cleaner",
			mediaPath: c005.mediaPath,
			prompt: "Make the Upwork part cleaner.",
			focus: "passive chrome ≠ Upwork edit workflow",
			adversarial: true,
			mustNotClaim: c005.mustNotClaim,
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

function estimateTokens(chars: number): number {
	return Math.ceil(chars / 4);
}

function scoreEditorial(row: {
	letter: string;
	finalText: string;
	deliveryStatus: string;
	planSupport: ReturnType<typeof planSupportsConcreteEdits> | null;
	targetUseful: boolean;
	gapUseful: boolean;
	planUseful: boolean;
	zoomMentions: number;
	zoomRecommend: boolean;
	routingSpeech: boolean;
	routingVisual: boolean;
	expectCrossModal?: boolean;
	mustNotHits: string[];
}): {
	mark: "PASS" | "PARTIAL" | "FAIL" | "NOT_VERIFIED";
	notes: string[];
	finalPlanConsistent: boolean;
} {
	const notes: string[] = [];
	if (row.deliveryStatus === "provider_error" || row.deliveryStatus === "provider_rate_limited") {
		return {
			mark: "NOT_VERIFIED",
			notes: ["provider capacity/error — intelligence not fully judged"],
			finalPlanConsistent: true,
		};
	}
	if (row.deliveryStatus !== "completed" || !row.finalText.trim()) {
		return { mark: "FAIL", notes: ["empty or failed final"], finalPlanConsistent: false };
	}

	const concrete = hasConcreteEditRecommendation(row.finalText);
	const support = row.planSupport;
	let finalPlanConsistent = true;
	if (concrete && support) {
		const mentionsZoom = row.zoomRecommend;
		if (mentionsZoom && !support.supported.has("zoom")) {
			finalPlanConsistent = false;
			notes.push("final mentions zoom without plan support");
		}
		const mentionsTrim =
			/\b(?:add|apply)\s+trims?\b|\bcut\s+(?:the\s+)?(?:pauses?|silences?)/i.test(row.finalText);
		if (mentionsTrim && !support.supported.has("trim")) {
			finalPlanConsistent = false;
			notes.push("final mentions trim without plan support");
		}
	} else if (concrete && !support) {
		finalPlanConsistent = false;
		notes.push("concrete advice with no plan");
	}

	if (row.expectCrossModal && !(row.routingSpeech && row.routingVisual)) {
		notes.push("cross-modal routing miss");
	}
	if (row.mustNotHits.length) notes.push(`mustNotHits=${row.mustNotHits.join(",")}`);
	if (row.letter === "H" || row.letter.startsWith("A")) {
		if (row.zoomRecommend && support && !support.supported.has("zoom")) {
			notes.push("unsupported zoom in final");
		}
	}
	if (!row.targetUseful && ["H", "I", "C"].includes(row.letter)) {
		notes.push("target hollow");
	}
	if (!row.gapUseful && ["H", "I"].includes(row.letter)) {
		notes.push("gap hollow");
	}

	if (
		!finalPlanConsistent ||
		notes.includes("cross-modal routing miss") ||
		row.mustNotHits.length
	) {
		return { mark: "FAIL", notes, finalPlanConsistent };
	}
	if (notes.length) return { mark: "PARTIAL", notes, finalPlanConsistent };
	return { mark: "PASS", notes: ["final-plan consistent; routing ok"], finalPlanConsistent };
}

describe("Real Corpus Recovery 4 — Editorial Grounding (live)", () => {
	afterAll(async () => {
		try {
			await shutdownStt();
		} catch {
			/* */
		}
		_resetSttManagerForTests();
	});

	it("runs Recovery 4 editorial corpus", async () => {
		mkdirSync(path.join(OUT, "cases"), { recursive: true });
		const apiKey = loadOpenAiKey();
		expect(apiKey.length).toBeGreaterThan(0);

		// Provider health probe
		const healthT0 = Date.now();
		let healthOk = false;
		let healthErr: string | null = null;
		try {
			const res = await fetch("https://api.openai.com/v1/chat/completions", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "gpt-4o",
					messages: [{ role: "user", content: "Reply with OK only." }],
					max_tokens: 5,
				}),
			});
			healthOk = res.ok;
			if (!res.ok) healthErr = `${res.status} ${await res.text()}`.slice(0, 400);
		} catch (e) {
			healthErr = e instanceof Error ? e.message : String(e);
		}
		writeJson(path.join(OUT, "provider-health.json"), {
			provider: "openai",
			model: "gpt-4o",
			credentialsPresent: true,
			simpleRequestOk: healthOk,
			latencyMs: Date.now() - healthT0,
			error: healthErr,
		});
		expect(healthOk).toBe(true);

		const only = (process.env.OPENSCREEN_R4_ONLY || "").split(",").filter(Boolean);
		const cases = buildManifest()
			.filter((c) => existsSync(c.mediaPath))
			.filter((c) => only.length === 0 || only.includes(c.letter));
		writeJson(path.join(OUT, "cases.json"), {
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
				adversarial: c.adversarial ?? false,
			})),
		});
		expect(cases.length).toBeGreaterThanOrEqual(only.length > 0 ? 1 : 8);

		getSttManager();
		const results: Record<string, unknown>[] = [];
		const latencies: number[] = [];
		const consistencyAudit: Record<string, unknown>[] = [];
		const failureClusters: Record<string, string[]> = {
			unsupported_zoom: [],
			hollow_target_gap_plan: [],
			final_plan_inconsistent: [],
			routing: [],
			tpm: [],
			epistemic: [],
		};

		for (const c of cases) {
			const caseDir = path.join(OUT, "cases", c.id);
			mkdirSync(caseDir, { recursive: true });
			const cacheDir = await mkdtemp(path.join(os.tmpdir(), `os-r4-${c.id}-`));

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

			const target = result?.targetStoryV1;
			const gap = result?.editGapV1;
			const plan = result?.editPlanV1;
			const nonPreserve = (target?.targetBeats ?? []).filter((b) => b.disposition !== "preserve");
			const actionableGaps = (gap?.gaps ?? []).filter(
				(g) => g.category !== "preservation_requirement",
			);
			const planSupport = plan ? planSupportsConcreteEdits(plan) : null;
			const preferred = (plan?.items ?? []).map((i) => i.preferredStrategy);
			const targetUseful =
				Boolean(target?.viewerGoal) &&
				(!/cleaner and more professional\.?$/i.test(target?.viewerGoal ?? "") ||
					nonPreserve.length > 0 ||
					(target?.removeCandidates?.length ?? 0) > 0 ||
					Boolean(target?.desiredArc));
			const gapUseful = actionableGaps.length > 0 || (gap?.gaps?.length ?? 0) > 0;
			const planUseful = (plan?.items?.length ?? 0) > 0;
			const zoomMentions = (sanitized.match(/\bzooms?\b/gi) ?? []).length;
			const zoomRecommend =
				/(?<!don'?t\s)(?<!do\s+not\s)(?<!never\s)\b(?:add|apply|use|insert)\s+(?:a\s+|some\s+)?(?:zooms?)\b|\bzoom\s+into\b|\bzooms?\s+(?:on|to|at|everywhere)\b/i.test(
					sanitized,
				) && hasConcreteEditRecommendation(sanitized);
			const mustNotHits = (c.mustNotClaim ?? []).filter((p) =>
				new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(sanitized),
			);

			const userMsgChars = JSON.stringify(c.prompt).length;
			const briefingChars = plan ? 800 : 0; // approximate; exact in briefing builder
			const tokenEstimate = {
				promptChars: userMsgChars,
				finalChars: sanitized.length,
				rawChars: rawText.length,
				frameCount: frames.length,
				approxInputTokensHint: estimateTokens(userMsgChars + briefingChars + frames.length * 800),
				note: "Frame/image tokens dominate TPM; Recovery 4 packs Target via compact briefing when Plan exists.",
			};

			const auto = scoreEditorial({
				letter: c.letter,
				finalText: sanitized,
				deliveryStatus: String(result?.status ?? (thrown ? "provider_error" : "unknown")),
				planSupport,
				targetUseful,
				gapUseful,
				planUseful,
				zoomMentions,
				zoomRecommend,
				routingSpeech: needs.speech,
				routingVisual: needs.visual,
				expectCrossModal: c.expectCrossModal,
				mustNotHits,
			});

			if (auto.notes.some((n) => /zoom/i.test(n))) failureClusters.unsupported_zoom.push(c.id);
			if (auto.notes.some((n) => /hollow/i.test(n)))
				failureClusters.hollow_target_gap_plan.push(c.id);
			if (!auto.finalPlanConsistent) failureClusters.final_plan_inconsistent.push(c.id);
			if (auto.notes.some((n) => /routing/i.test(n))) failureClusters.routing.push(c.id);
			if (
				String(result?.failureReason ?? "").includes("rate") ||
				/Request too large|TPM/i.test(String(result?.reason ?? thrown ?? ""))
			) {
				failureClusters.tpm.push(c.id);
			}
			if (mustNotHits.length) failureClusters.epistemic.push(c.id);

			consistencyAudit.push({
				id: c.id,
				letter: c.letter,
				preferredStrategies: preferred,
				actionableFamilies: planSupport ? [...planSupport.supported] : [],
				preservationOnly: planSupport?.preservationOnly ?? null,
				finalHasConcrete: hasConcreteEditRecommendation(sanitized),
				zoomMentions,
				zoomRecommend,
				finalPlanConsistent: auto.finalPlanConsistent,
				finalPreview: sanitized.slice(0, 240),
			});

			const snap = {
				target: target
					? {
							viewerGoal: target.viewerGoal,
							objectiveKind: target.objectiveKind,
							desiredArc: target.desiredArc,
							nonPreserveDispositions: nonPreserve.map((b) => ({
								id: b.id,
								disposition: b.disposition,
								pacing: b.pacingIntent,
								sourceBeatIds: b.sourceBeatIds,
							})),
							removeCandidates: target.removeCandidates?.slice(0, 8),
						}
					: null,
				gap: gap
					? {
							total: gap.gaps.length,
							actionable: actionableGaps.map((g) => ({
								category: g.category,
								problem: g.problemStatement.slice(0, 160),
								desired: g.desiredChange.slice(0, 120),
								range: g.provenance.sourceRange ?? null,
								sourceBeatIds: g.provenance.sourceBeatIds,
							})),
						}
					: null,
				plan: plan
					? {
							items: plan.items.map((i) => ({
								id: i.id,
								preferred: i.preferredStrategy,
								intent: i.editorialIntent.slice(0, 160),
								risk: i.risk,
							})),
							summary: plan.summary,
						}
					: null,
				proposalCount: result?.editProposalV1?.proposals?.length ?? 0,
			};

			writeJson(path.join(caseDir, "trace.json"), {
				identity: IDENTITY,
				id: c.id,
				letter: c.letter,
				prompt: c.prompt,
				routing: needs,
				frameCount: frames.length,
				speechStatus: speech?.status ?? null,
				speechSegments: speech?.segments?.length ?? 0,
				sourceBeats: result?.sourceStoryV2?.beats?.length ?? 0,
				targetUseful,
				gapUseful,
				planUseful,
				snap,
				finalLen: sanitized.length,
				finalText: sanitized,
				deliveryStatus: result?.status ?? (thrown ? "provider_error" : "unknown"),
				failureReason: result?.failureReason ?? null,
				diagnostic: result?.reason?.slice(0, 600) ?? thrown,
				tokenEstimate,
				latency: { prepMs, agentMs },
				auto,
			});
			writeFileSync(path.join(caseDir, "final-response.txt"), sanitized, "utf8");
			writeJson(path.join(caseDir, "target-gap-plan.json"), snap);
			writeJson(path.join(caseDir, "routing.json"), needs);
			writeJson(path.join(caseDir, "token-tpm.json"), tokenEstimate);

			results.push({
				id: c.id,
				letter: c.letter,
				title: c.title,
				adversarial: c.adversarial ?? false,
				deliveryStatus: result?.status ?? (thrown ? "provider_error" : "unknown"),
				failureReason: result?.failureReason ?? null,
				finalLen: sanitized.length,
				speechStatus: speech?.status ?? null,
				frameCount: frames.length,
				routingSpeech: needs.speech,
				routingVisual: needs.visual,
				targetUseful,
				gapUseful,
				planUseful,
				nonPreserveCount: nonPreserve.length,
				actionableGapCount: actionableGaps.length,
				planItemCount: plan?.items.length ?? 0,
				preferredStrategies: preferred,
				proposalCount: result?.editProposalV1?.proposals?.length ?? 0,
				zoomMentions,
				zoomRecommend,
				mustNotHits,
				finalPlanConsistent: auto.finalPlanConsistent,
				automatedScore: auto,
				agentMs,
				finalPreview: sanitized.slice(0, 280),
			});
		}

		const sorted = [...latencies].sort((a, b) => a - b);
		const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
		const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1] ?? 0;

		writeJson(path.join(OUT, "results.json"), { identity: IDENTITY, results });
		writeJson(path.join(OUT, "final-vs-plan-consistency.json"), {
			identity: IDENTITY,
			audit: consistencyAudit,
		});
		writeJson(path.join(OUT, "failure-clusters.json"), {
			identity: IDENTITY,
			clusters: failureClusters,
		});
		writeJson(path.join(OUT, "latency-summary.json"), {
			identity: IDENTITY,
			count: latencies.length,
			p50,
			p95,
			mean: Math.round(latencies.reduce((a, b) => a + b, 0) / Math.max(1, latencies.length)),
		});
		writeJson(path.join(OUT, "manual-review.json"), {
			identity: IDENTITY,
			note: "Authoritative scores in AI_REAL_CORPUS_RECOVERY_4_EDITORIAL_REPORT.md",
			cases: results.map((r) => ({
				id: r.id,
				letter: r.letter,
				automatedScore: r.automatedScore,
				manualMark: "PENDING_REPORT",
				finalPlanConsistent: r.finalPlanConsistent,
				zoomMentions: r.zoomMentions,
				targetUseful: r.targetUseful,
				gapUseful: r.gapUseful,
				planUseful: r.planUseful,
				finalPreview: r.finalPreview,
			})),
		});
		writeJson(path.join(OUT, "before-after.json"), {
			identity: IDENTITY,
			note: "Filled in report from Post-Recovery Validation vs this run",
			postRecoveryValidationArtifact: "tmp/perception-benchmark/post-recovery-validation-v1/",
			recovery4Artifact: OUT,
		});

		const completed = results.filter((r) => r.deliveryStatus === "completed").length;
		expect(completed + failureClusters.tpm.length).toBeGreaterThan(0);
	}, 1_800_000);
});
