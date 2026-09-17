/**
 * Video Memory Retrieval Provider Gate V2 — live provider quality gate.
 * Identity: CURRENT_OPENSCREEN_VIDEO_MEMORY_RETRIEVAL_PROVIDER_GATE_V2
 *
 * Health probe first. Hard STOP on quota. Do not overwrite prior artifact dirs.
 *
 * Run:
 *   npx vitest --run electron/ai-edition/perceptionBenchmark/videoMemoryRetrievalProviderGateV2/video-memory-retrieval-provider-gate-v2.runtime.test.ts
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
import {
	type ContextPackingMode,
	VIDEO_MEMORY_RETRIEVAL_PROVIDER_GATE_V2_ID,
} from "../../videoMemory/productionPath";
import {
	_resetVideoMemorySessionStoreForTests,
	createVideoMemorySessionStore,
} from "../../videoMemory/sessionStore";
import { REAL_CORPUS_CASES } from "../realCorpusBaseline/cases";
import { loadOpenAiKey } from "../runCurrentStack";

const IDENTITY = VIDEO_MEMORY_RETRIEVAL_PROVIDER_GATE_V2_ID;
/** Artifact root; set OPENSCREEN_PROVIDER_GATE_V2_OUT to a child run dir (do not overwrite blocked runs). */
const OUT =
	process.env.OPENSCREEN_PROVIDER_GATE_V2_OUT?.trim() ||
	path.join(process.cwd(), "tmp/perception-benchmark/video-memory-retrieval-provider-gate-v2");
const PROVIDER = "openai";
const MODEL = "gpt-4o";
const BASE_URL = "https://api.openai.com/v1";

const MODES: ContextPackingMode[] = [
	"CURRENT_FULL_CONTEXT",
	"VIDEO_MEMORY_RETRIEVAL",
	"VIDEO_MEMORY_RETRIEVAL_COMPACT",
];

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
	const base = createEmptyDocument({ title: "provider-gate-v2", projectId });
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

type Row = Record<string, unknown>;
const rows: Row[] = [];
let abortRemaining = false;
let abortReason: string | null = null;

function push(row: Row) {
	rows.push(row);
	mkdirSync(OUT, { recursive: true });
	const safe = String(row.id ?? row.kind ?? "row")
		.replace(/[^\w.-]+/g, "_")
		.slice(0, 90);
	writeFileSync(path.join(OUT, `${safe}-${rows.length}.json`), JSON.stringify(row, null, 2));
}

const PROMPTS = {
	Q1: "What did I say near the end?",
	Q2: "Watch the complete recording and explain what visibly happens from beginning to end. Only describe what you can actually verify from the screen.",
	Q3: "Compare what I say with what is visibly happening on screen. Tell me what matches, what differs, and what cannot be verified.",
	Q4: "What could genuinely be improved to make this recording feel more professional? Only recommend changes that are supported by the recording.",
	Q5: "What would you NOT edit in this recording, and why?",
	Q6: "Make this shorter and clearer, but preserve the important explanation.",
	Q7: "Where would a zoom actually help in this recording, and where would it not help? Only recommend zooms when there is a specific visible focal target.",
} as const;

describe("Video Memory Retrieval Provider Gate V2", () => {
	afterAll(async () => {
		mkdirSync(OUT, { recursive: true });
		writeFileSync(
			path.join(OUT, "summary.json"),
			JSON.stringify(
				{
					identity: IDENTITY,
					abortRemaining,
					abortReason,
					rowCount: rows.length,
					rows: rows.map((r) => ({
						id: r.id,
						kind: r.kind,
						mode: r.mode,
						status: r.status,
						failureReason: r.failureReason,
						images: r.images,
						inputTokens: r.inputTokens,
						finalTextChars: typeof r.finalText === "string" ? r.finalText.length : 0,
					})),
				},
				null,
				2,
			),
		);
		writeFileSync(path.join(OUT, "matrix.json"), JSON.stringify(rows, null, 2));
		await shutdownStt().catch(() => {});
		_resetSttManagerForTests();
	});

	const apiKey = loadOpenAiKey();

	it("provider-backed quality matrix", async () => {
		mkdirSync(OUT, { recursive: true });
		writeFileSync(
			path.join(OUT, "NOTICE.md"),
			`# ${IDENTITY}\nDo not overwrite prior video-memory-* or evidence-retrieval-* artifact directories.\n`,
		);

		if (!apiKey) {
			push({ kind: "setup", id: "no-key", status: "skipped" });
			writeFileSync(
				path.join(OUT, "provider-health.json"),
				JSON.stringify({ credentialsPresent: false, requestOk: false }, null, 2),
			);
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
		push({
			kind: "health",
			id: "PROVIDER_HEALTH",
			provider: PROVIDER,
			model: MODEL,
			...health,
		});

		if (health.quotaBlocked) {
			abortRemaining = true;
			abortReason = "BLOCKED_PROVIDER";
			push({
				kind: "abort",
				id: "BLOCKED_PROVIDER",
				reason: health.failureReason ?? "provider_quota_exhausted",
				summary: health.summary,
			});
			expect(health.quotaBlocked).toBe(true);
			return;
		}

		if (!health.simpleRequestOk) {
			abortRemaining = true;
			abortReason = health.failureReason ?? health.summary;
			push({ kind: "abort", id: "PROVIDER_UNHEALTHY", health });
			expect(health.simpleRequestOk).toBe(true);
			return;
		}

		const c001 = corpus("case-001");
		const c002 = corpus("case-002");
		const c003 = corpus("case-003");
		const c004 = corpus("case-004");
		const c005 = corpus("case-005");
		const c020 = corpus("case-020") ?? corpus("case-009");
		const recDir = path.join(os.homedir(), "Library/Application Support/openscreen/recordings");
		const longest = path.join(recDir, "recording-1789325019656.mp4");
		const mediaNarrated = c001?.mediaPath ?? "";
		if (!mediaNarrated || !existsSync(mediaNarrated)) {
			push({ kind: "setup", id: "no-media", status: "skipped" });
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
		}): Promise<{
			row: Row;
			document: AxcutDocument;
			text: string;
		}> {
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
			const result = await invokeOpenScreenAgent({
				model: {
					provider: PROVIDER,
					model: MODEL,
					apiKey,
					baseUrl: BASE_URL,
				},
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
			const nextDoc = result.document ?? opts.document;
			const text = result.text || "";
			const mustNotHits =
				opts.mustNot?.filter((p) =>
					new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text),
				) ?? [];
			const ct = result.contextTelemetry;
			const rp = result.retrievalPath;
			const inTok = ct?.providerUsage.inputTokens;
			const outTok = ct?.providerUsage.outputTokens;
			const cached = ct?.providerUsage.cachedInputTokens;
			const _images = rp?.frameMeta?.length ?? (text ? undefined : 0);
			const estCostUsd =
				typeof inTok === "number" && typeof outTok === "number"
					? (inTok / 1_000_000) * 2.5 + (outTok / 1_000_000) * 10
					: null;

			if (
				result.status === "provider_error" &&
				(result.failureReason === "provider_quota_exhausted" ||
					result.failureReason === "provider_rate_limited")
			) {
				abortRemaining = true;
				abortReason =
					result.failureReason === "provider_quota_exhausted"
						? "BLOCKED_PROVIDER"
						: String(result.failureReason);
			}

			const row: Row = {
				identity: IDENTITY,
				kind: opts.kind,
				id: opts.id,
				mode: opts.mode,
				prompt: opts.prompt,
				mediaPath: opts.mediaPath,
				provider: PROVIDER,
				model: MODEL,
				status: result.status,
				failureReason: result.failureReason ?? null,
				needsCategory: needs.category,
				needsVisual: needs.visual,
				needsSpeech: needs.speech,
				classifiedQueryClass: queryClass,
				retrievalQueryClass: rp?.queryClass ?? null,
				queryScope: rp?.queryScope ?? null,
				inputTokens: inTok,
				outputTokens: outTok,
				cachedInputTokens: cached,
				images: rp?.frameMeta?.length ?? null,
				frameMeta: rp?.frameMeta ?? null,
				packedContextChars: rp?.packedContextChars ?? null,
				sourceMemoryHit: rp?.sourceMemoryHit ?? null,
				programmeMemoryHit: rp?.programmeMemoryHit ?? null,
				sourceStoryReused: rp?.sourceStoryReused ?? null,
				ledgerReused: rp?.ledgerReused ?? null,
				ranInvestigator: rp?.ranInvestigator ?? null,
				sufficiencyReason: rp?.sufficiencyReason ?? null,
				visualCoverage: rp?.visualCoverage ?? null,
				toolsExposed: rp?.toolsExposed ?? null,
				latencyMs,
				providerCalls: 1,
				estimatedCostUsd: estCostUsd,
				mustNotHits,
				finalText: text,
				coverage: rp?.visualCoverage ?? null,
			};
			push(row);
			return { row, document: nextDoc, text };
		}

		// --- B. ABC matrix on narrated ---
		for (const [qid, prompt] of Object.entries(PROMPTS)) {
			for (const mode of MODES) {
				_resetVideoMemorySessionStoreForTests();
				const session = createVideoMemorySessionStore();
				const docId = `abc_${qid}_${mode}`;
				await invoke({
					id: `${qid}_${mode}`,
					kind: "abc",
					mediaPath: mediaNarrated,
					prompt,
					mode,
					document: buildDoc(mediaNarrated, docId),
					session,
					docId,
					speechCacheKey: "abc_narrated",
				});
			}
		}

		// --- C. Case 020 Q4/Q5/Q7 ---
		if (c020?.mediaPath && existsSync(c020.mediaPath)) {
			for (const qid of ["Q4", "Q5", "Q7"] as const) {
				for (const mode of MODES) {
					_resetVideoMemorySessionStoreForTests();
					const session = createVideoMemorySessionStore();
					await invoke({
						id: `C020_${qid}_${mode}`,
						kind: "case020",
						mediaPath: c020.mediaPath,
						prompt: PROMPTS[qid],
						mode,
						document: buildDoc(c020.mediaPath, `c020_${qid}_${mode}`),
						session,
						docId: `c020_${qid}_${mode}`,
						speechCacheKey: "c020",
					});
				}
			}
		} else {
			push({ kind: "case020", id: "C020", status: "skipped", reason: "media missing" });
		}

		// --- Invariants on Retrieval ---
		const invSpecs = [
			{
				id: "INV_RESTART",
				case: c002,
				prompt: "What temporary UI appears near the end? Did I restart the recording?",
				mustNot: ["restarted recording", "I restarted", "user restarted"],
			},
			{
				id: "INV_UPWORK",
				case: c005,
				prompt:
					"If you see browser tabs or app names like Upwork, did I actually open or work in that app?",
				mustNot: ["opened Upwork", "worked on Upwork", "navigated to Upwork"],
			},
			{
				id: "INV_SETTINGS",
				case: c004,
				prompt:
					"I mentioned Settings. Was Settings actually opened on screen, or do you only see related text/labels?",
				mustNot: ["opened Settings", "Settings panel opened", "navigated to Settings"],
			},
			{
				id: "INV_CASE4",
				case: c003,
				prompt:
					"What did I say, and did I correct myself? What is my final intended meaning? Fix mistakes but preserve the corrected explanation.",
				mustNot: ["opened Timeline", "opened Effects"],
			},
		] as const;

		for (const spec of invSpecs) {
			if (!spec.case?.mediaPath || !existsSync(spec.case.mediaPath)) {
				push({ kind: "invariant", id: spec.id, status: "skipped" });
				continue;
			}
			_resetVideoMemorySessionStoreForTests();
			const session = createVideoMemorySessionStore();
			await invoke({
				id: spec.id,
				kind: "invariant",
				mediaPath: spec.case.mediaPath,
				prompt: spec.prompt,
				mode: "VIDEO_MEMORY_RETRIEVAL",
				document: buildDoc(spec.case.mediaPath, spec.id),
				session,
				docId: spec.id,
				speechCacheKey: spec.id,
				mustNot: [...spec.mustNot],
			});
		}

		// --- Longest visual editorial Retrieval ---
		if (existsSync(longest)) {
			_resetVideoMemorySessionStoreForTests();
			const session = createVideoMemorySessionStore();
			await invoke({
				id: "LONG_Q2_RETRIEVAL",
				kind: "longest",
				mediaPath: longest,
				prompt: PROMPTS.Q2,
				mode: "VIDEO_MEMORY_RETRIEVAL",
				document: buildDoc(longest, "longest"),
				session,
				docId: "longest",
				speechCacheKey: "longest",
			});
		}

		// --- I. Follow-up F1–F5 same document/session Retrieval ---
		{
			_resetVideoMemorySessionStoreForTests();
			const session = createVideoMemorySessionStore();
			const docId = "followup_narrated";
			let document = buildDoc(mediaNarrated, docId);
			const hist: Array<{ role: "user" | "assistant"; content: string }> = [];
			const followups: Array<{ id: string; prompt: string }> = [
				{ id: "F1", prompt: "Explain what happens in this recording." },
				{ id: "F2", prompt: "What did I say near the end?" },
				{ id: "F3", prompt: "Did I actually open Settings?" },
				{ id: "F4", prompt: "What should I not edit?" },
				{ id: "F5", prompt: "How would you make this more professional?" },
			];
			for (const f of followups) {
				const { document: next, text } = await invoke({
					id: f.id,
					kind: "followup",
					mediaPath: mediaNarrated,
					prompt: f.prompt,
					mode: "VIDEO_MEMORY_RETRIEVAL",
					document,
					history: hist,
					session,
					docId,
					speechCacheKey: "followup_narrated",
				});
				document = next;
				hist.push({ role: "user", content: f.prompt });
				hist.push({ role: "assistant", content: text.slice(0, 1200) || "(empty)" });
			}
		}

		expect(rows.some((r) => r.id === "PROVIDER_HEALTH")).toBe(true);
	}, 1_800_000);
});
