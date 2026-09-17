/**
 * Provider Stability + Matrix Resume V1 — forensic / resume harness.
 * Does NOT change cognition packing. Captures raw provider diagnostics.
 *
 * Run:
 *   OPENSCREEN_PROVIDER_STABILITY_OUT=... npx vitest --run \
 *     electron/ai-edition/perceptionBenchmark/providerStabilityMatrixResume/provider-stability-matrix-resume-v1.runtime.test.ts
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../../src/lib/ai-edition/schema";
import { readCursorSidecar } from "../../../media/cursorSidecar";
import { _resetSttManagerForTests, shutdownStt } from "../../../stt/index";
import { probeConfiguredProviderHealth } from "../../deep-agent/providerHealth";
import { invokeOpenScreenAgent, type OpenScreenAgentSink } from "../../deep-agent/service";
import { classifyMediaContextNeeds } from "../../mediaContextNeeds";
import { classifyVideoMemoryQuery } from "../../videoMemory";
import type { ContextPackingMode } from "../../videoMemory/productionPath";
import {
	_resetVideoMemorySessionStoreForTests,
	createVideoMemorySessionStore,
} from "../../videoMemory/sessionStore";
import { REAL_CORPUS_CASES } from "../realCorpusBaseline/cases";
import { loadOpenAiKey } from "../runCurrentStack";

const OUT =
	process.env.OPENSCREEN_PROVIDER_STABILITY_OUT?.trim() ||
	path.join(process.cwd(), "tmp/perception-benchmark/provider-stability-matrix-resume-v1");

const PROVIDER = "openai";
const MODEL = "gpt-4o";
const BASE_URL = "https://api.openai.com/v1";
const Q7 =
	"Where would a zoom actually help in this recording, and where would it not help? Only recommend zooms when there is a specific visible focal target.";
const PROMPTS = {
	Q4: "What could genuinely be improved to make this recording feel more professional? Only recommend changes that are supported by the recording.",
	Q5: "What would you NOT edit in this recording, and why?",
	Q7,
} as const;

type Row = Record<string, unknown>;
const rows: Row[] = [];
let abortRemaining = false;
let abortReason: string | null = null;

function mem(phase: string) {
	const m = process.memoryUsage();
	const snap = {
		phase,
		at: new Date().toISOString(),
		rss: m.rss,
		heapUsed: m.heapUsed,
		external: m.external,
	};
	writeFileSync(path.join(OUT, `memory-${phase}.json`), JSON.stringify(snap, null, 2));
	return snap;
}

function push(row: Row) {
	rows.push(row);
	mkdirSync(OUT, { recursive: true });
	const safe = String(row.id ?? row.kind ?? "row")
		.replace(/[^\w.-]+/g, "_")
		.slice(0, 90);
	writeFileSync(path.join(OUT, `${safe}-${rows.length}.json`), JSON.stringify(row, null, 2));
}

function corpus(id: string) {
	return REAL_CORPUS_CASES.find((c) => c.caseId === id);
}

function quietSink(): OpenScreenAgentSink {
	return {
		text: () => {},
		thinking: () => {},
		toolStart: () => {},
		toolEnd: () => {},
		error: () => {},
	};
}

function buildDoc(mediaPath: string, projectId: string, durationSec = 30): AxcutDocument {
	const base = createEmptyDocument({ title: "stability-resume-v1", projectId });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				label: "gate",
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

function cursorFor(mediaPath: string) {
	return {
		async probe({ originalPath }: { originalPath: string | null }) {
			if (!originalPath) return false;
			return (await readCursorSidecar(originalPath, {})).found;
		},
		async read({ assetId, originalPath }: { assetId: string; originalPath: string | null }) {
			if (!originalPath) return { status: "unavailable" as const, assetId, note: "no path" };
			try {
				const sidecar = await readCursorSidecar(originalPath, {});
				if (!sidecar.found) return { status: "no-sidecar" as const, assetId };
				return { status: "ok" as const, assetId, samples: sidecar.data.samples };
			} catch (e) {
				return {
					status: "unavailable" as const,
					assetId,
					note: e instanceof Error ? e.message : String(e),
				};
			}
		},
	};
}

describe("Provider Stability + Matrix Resume V1", () => {
	afterAll(async () => {
		mkdirSync(OUT, { recursive: true });
		writeFileSync(
			path.join(OUT, "summary.json"),
			JSON.stringify({ abortRemaining, abortReason, rowCount: rows.length, rows }, null, 2),
		);
		writeFileSync(path.join(OUT, "matrix.json"), JSON.stringify(rows, null, 2));
		mem("end");
		await shutdownStt().catch(() => {});
		_resetSttManagerForTests();
	});

	const apiKey = loadOpenAiKey();

	it("forensic controls then resume missing rows", async () => {
		mkdirSync(OUT, { recursive: true });
		writeFileSync(
			path.join(OUT, "NOTICE.md"),
			"# Provider Stability + Matrix Resume V1\nDoes not overwrite Gate V2 historical artifacts.\n",
		);
		mem("start");
		if (!apiKey) {
			push({ id: "NO_KEY", status: "skipped" });
			expect(true).toBe(true);
			return;
		}

		const health = await probeConfiguredProviderHealth({
			provider: PROVIDER,
			model: MODEL,
			apiKey,
			baseUrl: BASE_URL,
		});
		writeFileSync(path.join(OUT, "provider-health.json"), JSON.stringify(health, null, 2));
		push({ kind: "health", id: "PROVIDER_HEALTH", ...health });
		if (health.quotaBlocked || !health.simpleRequestOk) {
			abortRemaining = true;
			abortReason = "BLOCKED_PROVIDER";
			push({ kind: "abort", id: "BLOCKED_PROVIDER", health });
			expect(health.quotaBlocked).toBe(false);
			return;
		}

		const c001 = corpus("case-001");
		const c002 = corpus("case-002");
		const c003 = corpus("case-003");
		const c004 = corpus("case-004");
		const c005 = corpus("case-005");
		const c020 = corpus("case-020") ?? corpus("case-009");
		const mediaNarrated = c001?.mediaPath ?? "";
		const longest = path.join(
			os.homedir(),
			"Library/Application Support/openscreen/recordings/recording-1789325019656.mp4",
		);
		if (!mediaNarrated || !existsSync(mediaNarrated)) {
			push({ id: "NO_MEDIA", status: "skipped" });
			expect(true).toBe(true);
			return;
		}

		async function invoke(opts: {
			id: string;
			kind: string;
			mediaPath: string;
			prompt: string;
			mode: ContextPackingMode;
			document: AxcutDocument;
			history?: Array<{ role: "user" | "assistant"; content: string }>;
			session: ReturnType<typeof createVideoMemorySessionStore>;
			docId: string;
			speechCacheKey: string;
			mustNot?: string[];
		}) {
			if (abortRemaining) {
				const row: Row = {
					kind: opts.kind,
					id: opts.id,
					mode: opts.mode,
					status: "skipped",
					reason: abortReason,
				};
				push(row);
				return { row, document: opts.document, text: "" };
			}
			const needs = classifyMediaContextNeeds(opts.prompt);
			const queryClass = classifyVideoMemoryQuery(opts.prompt, needs);
			const t0 = Date.now();
			const memBefore = process.memoryUsage();
			const result = await invokeOpenScreenAgent({
				model: { provider: PROVIDER, model: MODEL, apiKey, baseUrl: BASE_URL },
				document: opts.document,
				history: opts.history ?? [],
				userMessage: opts.prompt,
				sink: quietSink(),
				editsAllowed: true,
				contextPacking: opts.mode,
				videoMemorySessionStore: opts.session,
				videoMemoryDocumentId: opts.docId,
				speechCacheDir: path.join(OUT, "speech", opts.speechCacheKey),
				cursor: cursorFor(opts.mediaPath),
			});
			const latencyMs = Date.now() - t0;
			const memAfter = process.memoryUsage();
			const text = result.text || "";
			const ct = result.contextTelemetry;
			const rp = result.retrievalPath;
			const inTok = ct?.providerUsage.inputTokens;
			const outTok = ct?.providerUsage.outputTokens;
			const cached = ct?.providerUsage.cachedInputTokens;
			const estCostUsd =
				typeof inTok === "number" && typeof outTok === "number"
					? (inTok / 1_000_000) * 2.5 + (outTok / 1_000_000) * 10
					: null;

			if (
				result.status === "provider_error" &&
				(result.failureReason === "provider_quota_exhausted" ||
					result.failureReason === "provider_rate_limited")
			) {
				// rate_limited: do not abort entire matrix — resume harness may pace
				if (result.failureReason === "provider_quota_exhausted") {
					abortRemaining = true;
					abortReason = "BLOCKED_PROVIDER";
				}
			}

			const row: Row = {
				kind: opts.kind,
				id: opts.id,
				mode: opts.mode,
				prompt: opts.prompt,
				mediaPath: opts.mediaPath,
				provider: PROVIDER,
				model: MODEL,
				status: result.status,
				failureReason: result.failureReason ?? null,
				providerHttpStatus: result.providerHttpStatus ?? null,
				diagnosticReason: result.reason ?? null,
				providerDiagnostics: result.providerDiagnostics ?? null,
				userMessage: result.userMessage ?? null,
				startedAtMs: t0,
				finishedAtMs: t0 + latencyMs,
				latencyMs,
				needsCategory: needs.category,
				needsVisual: needs.visual,
				needsSpeech: needs.speech,
				classifiedQueryClass: queryClass,
				retrievalQueryClass: rp?.queryClass ?? null,
				queryScope: rp?.queryScope ?? null,
				inputTokens: inTok ?? null,
				outputTokens: outTok ?? null,
				cachedInputTokens: cached ?? null,
				images: rp?.frameMeta?.length ?? null,
				frameMeta: rp?.frameMeta ?? null,
				packedContextChars: rp?.packedContextChars ?? null,
				toolsExposed: rp?.toolsExposed ?? null,
				sourceMemoryHit: rp?.sourceMemoryHit ?? null,
				programmeMemoryHit: rp?.programmeMemoryHit ?? null,
				sourceStoryReused: rp?.sourceStoryReused ?? null,
				ledgerReused: rp?.ledgerReused ?? null,
				ranInvestigator: rp?.ranInvestigator ?? null,
				sufficiencyReason: rp?.sufficiencyReason ?? null,
				visualCoverage: rp?.visualCoverage ?? null,
				estimatedCostUsd: estCostUsd,
				mustNotHits:
					opts.mustNot?.filter((p) =>
						new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text),
					) ?? [],
				finalText: text,
				rssBefore: memBefore.rss,
				rssAfter: memAfter.rss,
				heapBefore: memBefore.heapUsed,
				heapAfter: memAfter.heapUsed,
			};
			push(row);
			return { row, document: result.document ?? opts.document, text };
		}

		async function pacedInvoke(opts: Parameters<typeof invoke>[0], cooldownMs = 0) {
			const out = await invoke(opts);
			if (cooldownMs > 0) await new Promise((r) => setTimeout(r, cooldownMs));
			return out;
		}

		// --- 9. Tiny stability control (10 sequential) ---
		{
			const { ChatOpenAI } = await import("@langchain/openai");
			const { HumanMessage } = await import("@langchain/core/messages");
			for (let i = 1; i <= 10; i++) {
				const t0 = Date.now();
				try {
					const model = new ChatOpenAI({
						apiKey,
						model: MODEL,
						maxRetries: 0,
						timeout: 30_000,
						configuration: { baseURL: BASE_URL },
					});
					const res = await model.invoke([new HumanMessage(`Reply with exactly: ok${i}`)]);
					const text =
						typeof res.content === "string"
							? res.content
							: JSON.stringify(res.content).slice(0, 80);
					push({
						kind: "tiny_control",
						id: `TINY_${i}`,
						status: "completed",
						latencyMs: Date.now() - t0,
						text,
					});
				} catch (err) {
					const e = err instanceof Error ? err : new Error(String(err));
					push({
						kind: "tiny_control",
						id: `TINY_${i}`,
						status: "provider_error",
						latencyMs: Date.now() - t0,
						errorName: e.name,
						errorMessage: e.message,
						errorStackHead: (e.stack ?? "").split("\n").slice(0, 4),
					});
					abortRemaining = true;
					abortReason = "TINY_CONTROL_FAILED";
					break;
				}
			}
		}
		if (abortRemaining) {
			expect(abortRemaining).toBe(false);
			return;
		}

		// --- 5 realistic representative calls ---
		const realistic: Array<{ id: string; mode: ContextPackingMode; prompt: string }> = [
			{
				id: "REAL_RET_SPEECH",
				mode: "VIDEO_MEMORY_RETRIEVAL",
				prompt: "What did I say near the end?",
			},
			{
				id: "REAL_RET_VISUAL",
				mode: "VIDEO_MEMORY_RETRIEVAL",
				prompt:
					"Watch the complete recording and explain what visibly happens from beginning to end. Only describe what you can actually verify from the screen.",
			},
			{ id: "REAL_RET_EDITORIAL", mode: "VIDEO_MEMORY_RETRIEVAL", prompt: PROMPTS.Q4 },
			{
				id: "REAL_FULL_VISUAL",
				mode: "CURRENT_FULL_CONTEXT",
				prompt:
					"Watch the complete recording and explain what visibly happens from beginning to end. Only describe what you can actually verify from the screen.",
			},
			{
				id: "REAL_COMPACT_SPEECH",
				mode: "VIDEO_MEMORY_RETRIEVAL_COMPACT",
				prompt: "What did I say near the end?",
			},
		];
		for (const r of realistic) {
			_resetVideoMemorySessionStoreForTests();
			const session = createVideoMemorySessionStore();
			await pacedInvoke(
				{
					id: r.id,
					kind: "realistic_control",
					mediaPath: mediaNarrated,
					prompt: r.prompt,
					mode: r.mode,
					document: buildDoc(mediaNarrated, r.id),
					session,
					docId: r.id,
					speechCacheKey: "realistic",
				},
				1_500,
			);
		}
		mem("after_realistic");

		const realisticFails = rows.filter(
			(r) => r.kind === "realistic_control" && r.status !== "completed",
		);
		if (realisticFails.length > 0) {
			push({
				kind: "abort",
				id: "REALISTIC_CONTROL_FAILED",
				fails: realisticFails.map((f) => ({
					id: f.id,
					failureReason: f.failureReason,
					diagnosticReason: f.diagnosticReason,
					providerHttpStatus: f.providerHttpStatus,
				})),
			});
			// continue to isolated Q7 anyway for forensic A/B — still mandatory
		}

		// --- 8. Isolated Q7 FULL in fresh session ---
		{
			_resetVideoMemorySessionStoreForTests();
			const session = createVideoMemorySessionStore();
			await pacedInvoke(
				{
					id: "ISOLATED_Q7_FULL",
					kind: "isolated_q7",
					mediaPath: mediaNarrated,
					prompt: Q7,
					mode: "CURRENT_FULL_CONTEXT",
					document: buildDoc(mediaNarrated, "isolated_q7_full"),
					session,
					docId: "isolated_q7_full",
					speechCacheKey: "isolated_q7",
				},
				2_000,
			);
		}
		mem("after_isolated_q7");

		const isolated = rows.find((r) => r.id === "ISOLATED_Q7_FULL");
		push({
			kind: "forensic",
			id: "ISOLATED_Q7_OUTCOME",
			outcome:
				isolated?.status === "completed"
					? "A_isolated_Q7_succeeds_long_run_or_window_problem"
					: "B_isolated_Q7_fails_request_specific_or_still_unstable",
			status: isolated?.status,
			failureReason: isolated?.failureReason,
			diagnosticReason: isolated?.diagnosticReason,
			providerHttpStatus: isolated?.providerHttpStatus,
			latencyMs: isolated?.latencyMs,
			inputTokens: isolated?.inputTokens,
			images: isolated?.images,
		});

		if (health.quotaBlocked) return;

		// Only resume if tiny+realistic mostly ok OR isolated succeeded
		const tinyOk = rows.filter((r) => r.kind === "tiny_control" && r.status === "completed").length;
		if (tinyOk < 10) {
			expect(tinyOk).toBe(10);
			return;
		}

		const cooldownMs = 2_000; // benchmark pacing only

		// --- Resume missing: Q7 × 3 ---
		for (const mode of [
			"CURRENT_FULL_CONTEXT",
			"VIDEO_MEMORY_RETRIEVAL",
			"VIDEO_MEMORY_RETRIEVAL_COMPACT",
		] as const) {
			_resetVideoMemorySessionStoreForTests();
			const session = createVideoMemorySessionStore();
			await pacedInvoke(
				{
					id: `RESUME_Q7_${mode}`,
					kind: "resume_q7",
					mediaPath: mediaNarrated,
					prompt: Q7,
					mode,
					document: buildDoc(mediaNarrated, `resume_q7_${mode}`),
					session,
					docId: `resume_q7_${mode}`,
					speechCacheKey: "resume_narrated",
				},
				cooldownMs,
			);
		}

		// Case 020
		if (c020?.mediaPath && existsSync(c020.mediaPath)) {
			for (const qid of ["Q4", "Q5", "Q7"] as const) {
				for (const mode of [
					"CURRENT_FULL_CONTEXT",
					"VIDEO_MEMORY_RETRIEVAL",
					"VIDEO_MEMORY_RETRIEVAL_COMPACT",
				] as const) {
					_resetVideoMemorySessionStoreForTests();
					const session = createVideoMemorySessionStore();
					await pacedInvoke(
						{
							id: `RESUME_C020_${qid}_${mode}`,
							kind: "resume_case020",
							mediaPath: c020.mediaPath,
							prompt: PROMPTS[qid],
							mode,
							document: buildDoc(c020.mediaPath, `resume_c020_${qid}_${mode}`),
							session,
							docId: `resume_c020_${qid}_${mode}`,
							speechCacheKey: "resume_c020",
						},
						cooldownMs,
					);
				}
			}
		}

		const invSpecs = [
			{
				id: "RESUME_INV_RESTART",
				case: c002,
				prompt: "What temporary UI appears near the end? Did I restart the recording?",
				mustNot: ["restarted recording", "I restarted", "user restarted"],
			},
			{
				id: "RESUME_INV_UPWORK",
				case: c005,
				prompt:
					"If you see browser tabs or app names like Upwork, did I actually open or work in that app?",
				mustNot: ["opened Upwork", "worked on Upwork", "navigated to Upwork"],
			},
			{
				id: "RESUME_INV_SETTINGS",
				case: c004,
				prompt:
					"I mentioned Settings. Was Settings actually opened on screen, or do you only see related text/labels?",
				mustNot: ["opened Settings", "Settings panel opened", "navigated to Settings"],
			},
			{
				id: "RESUME_INV_CASE4",
				case: c003,
				prompt:
					"What did I say, and did I correct myself? What is my final intended meaning? Fix mistakes but preserve the corrected explanation.",
				mustNot: ["opened Timeline", "opened Effects"],
			},
		] as const;

		for (const spec of invSpecs) {
			if (!spec.case?.mediaPath || !existsSync(spec.case.mediaPath)) {
				push({ kind: "resume_invariant", id: spec.id, status: "skipped" });
				continue;
			}
			_resetVideoMemorySessionStoreForTests();
			const session = createVideoMemorySessionStore();
			await pacedInvoke(
				{
					id: spec.id,
					kind: "resume_invariant",
					mediaPath: spec.case.mediaPath,
					prompt: spec.prompt,
					mode: "VIDEO_MEMORY_RETRIEVAL",
					document: buildDoc(spec.case.mediaPath, spec.id),
					session,
					docId: spec.id,
					speechCacheKey: spec.id,
					mustNot: [...spec.mustNot],
				},
				cooldownMs,
			);
		}

		if (existsSync(longest)) {
			_resetVideoMemorySessionStoreForTests();
			const session = createVideoMemorySessionStore();
			await pacedInvoke(
				{
					id: "RESUME_LONG_Q2_RETRIEVAL",
					kind: "resume_longest",
					mediaPath: longest,
					prompt:
						"Watch the complete recording and explain what visibly happens from beginning to end. Only describe what you can actually verify from the screen.",
					mode: "VIDEO_MEMORY_RETRIEVAL",
					document: buildDoc(longest, "resume_longest"),
					session,
					docId: "resume_longest",
					speechCacheKey: "resume_longest",
				},
				cooldownMs,
			);
		}

		// Follow-up F1–F5
		{
			_resetVideoMemorySessionStoreForTests();
			const session = createVideoMemorySessionStore();
			const docId = "resume_followup";
			let document = buildDoc(mediaNarrated, docId);
			const hist: Array<{ role: "user" | "assistant"; content: string }> = [];
			const followups = [
				{ id: "RESUME_F1", prompt: "Explain what happens in this recording." },
				{ id: "RESUME_F2", prompt: "What did I say near the end?" },
				{ id: "RESUME_F3", prompt: "Did I actually open Settings?" },
				{ id: "RESUME_F4", prompt: "What would you not edit?" },
				{ id: "RESUME_F5", prompt: "How would you make this more professional?" },
			];
			for (const f of followups) {
				const { document: next, text } = await pacedInvoke(
					{
						id: f.id,
						kind: "resume_followup",
						mediaPath: mediaNarrated,
						prompt: f.prompt,
						mode: "VIDEO_MEMORY_RETRIEVAL",
						document,
						history: hist,
						session,
						docId,
						speechCacheKey: "resume_followup",
					},
					cooldownMs,
				);
				document = next;
				hist.push({ role: "user", content: f.prompt });
				hist.push({ role: "assistant", content: text.slice(0, 1200) || "(empty)" });
			}
		}

		expect(rows.some((r) => r.id === "PROVIDER_HEALTH")).toBe(true);
	}, 2_400_000);
});
