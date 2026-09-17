/**
 * Video Memory Retrieval Production V1 — real A/B + follow-up probes.
 * Identity: CURRENT_OPENSCREEN_VIDEO_MEMORY_RETRIEVAL_PRODUCTION_V1
 *
 * Run:
 *   npx vitest --run electron/ai-edition/perceptionBenchmark/videoMemoryRetrievalProduction/video-memory-retrieval-production.runtime.test.ts
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../../src/lib/ai-edition/schema";
import { readCursorSidecar } from "../../../media/cursorSidecar";
import { _resetSttManagerForTests, shutdownStt } from "../../../stt/index";
import { invokeOpenScreenAgent, type OpenScreenAgentSink } from "../../deep-agent/service";
import { VIDEO_MEMORY_RETRIEVAL_PRODUCTION_V1_ID } from "../../videoMemory/productionPath";
import {
	_resetVideoMemorySessionStoreForTests,
	createVideoMemorySessionStore,
} from "../../videoMemory/sessionStore";
import { REAL_CORPUS_CASES } from "../realCorpusBaseline/cases";
import { loadOpenAiKey } from "../runCurrentStack";

const IDENTITY = VIDEO_MEMORY_RETRIEVAL_PRODUCTION_V1_ID;
const OUT = path.join(
	process.cwd(),
	"tmp/perception-benchmark/video-memory-retrieval-production-v1",
);

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

function buildDoc(mediaPath: string, projectId: string) {
	const base = createEmptyDocument({ title: "vm-retrieval", projectId });
	const durationSec = 30;
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				label: "audit",
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

describe("Video Memory Retrieval Production V1 (runtime A/B)", () => {
	afterAll(async () => {
		mkdirSync(OUT, { recursive: true });
		writeFileSync(
			path.join(OUT, "summary.json"),
			JSON.stringify({ identity: IDENTITY, rows }, null, 2),
		);
		await shutdownStt().catch(() => {});
		_resetSttManagerForTests();
	});

	const key = loadOpenAiKey();
	const c001 = corpus("case-001");
	const c002 = corpus("case-002");
	const c004 = corpus("case-004");
	const c005 = corpus("case-005");
	const c003 = corpus("case-003");

	it("A/B + follow-up series on real recordings", async () => {
		mkdirSync(OUT, { recursive: true });
		if (!key) {
			rows.push({ status: "skipped", reason: "no API key" });
			expect(true).toBe(true);
			return;
		}

		const media = c001?.mediaPath ?? "";
		if (!media || !existsSync(media)) {
			rows.push({ status: "skipped", reason: "case-001 media missing" });
			expect(true).toBe(true);
			return;
		}

		_resetVideoMemorySessionStoreForTests();
		const session = createVideoMemorySessionStore();

		const abPrompts: Array<{ id: string; prompt: string; mustNot?: string[] }> = [
			{ id: "speech", prompt: "What did I say near the end?" },
			{ id: "visual", prompt: "What is visibly happening in this recording?" },
			{
				id: "editorial",
				prompt:
					"Make this video feel more professional. Only suggest changes supported by the recording.",
			},
			{
				id: "shorter",
				prompt: "Make this shorter and clearer while keeping the important explanation.",
			},
		];

		for (const p of abPrompts) {
			for (const mode of ["CURRENT_FULL_CONTEXT", "VIDEO_MEMORY_RETRIEVAL"] as const) {
				const document = buildDoc(media, `ab_${p.id}_${mode}`);
				const result = await invokeOpenScreenAgent({
					model: {
						provider: "openai",
						model: "gpt-4o",
						apiKey: key,
						baseUrl: "https://api.openai.com/v1",
					},
					document,
					history: [],
					userMessage: p.prompt,
					sink: quietSink(),
					editsAllowed: true,
					contextPacking: mode,
					videoMemorySessionStore: createVideoMemorySessionStore(),
					videoMemoryDocumentId: `ab_${p.id}_${mode}`,
					speechCacheDir: path.join(OUT, "speech", `${p.id}_${mode}`),
					cursor: cursorFor(media),
				});
				const ct = result.contextTelemetry;
				rows.push({
					kind: "ab",
					id: p.id,
					mode,
					status: result.status,
					inputTokens: ct?.providerUsage.inputTokens,
					outputTokens: ct?.providerUsage.outputTokens,
					cachedInputTokens: ct?.providerUsage.cachedInputTokens,
					imageCount: ct?.images.imageCount,
					estimatedImageTokens: ct?.images.estimatedImageTokens,
					estimatedUSD: ct?.estimatedCostUsd,
					totalMs: ct?.latency.totalMs,
					providerMs: ct?.latency.providerMs,
					retrievalPath: result.retrievalPath,
					preview: (result.text || "").slice(0, 400),
				});
				writeFileSync(
					path.join(OUT, `ab-${p.id}-${mode}.json`),
					JSON.stringify(rows[rows.length - 1], null, 2),
				);
			}
		}

		// Follow-up F1–F4 same video, retrieval path, shared session
		_resetVideoMemorySessionStoreForTests();
		const followPrompts = [
			{ id: "F1", prompt: "Watch this recording and tell me what is happening." },
			{ id: "F2", prompt: "What did I say near the end?" },
			{ id: "F3", prompt: "Did I actually open Settings?" },
			{
				id: "F4",
				prompt:
					"How would you make this more professional without removing the important explanation?",
			},
		];
		const followDocId = "followup_series_v1";
		const history: Array<{ role: "user" | "assistant"; content: string }> = [];
		for (const fp of followPrompts) {
			const document = buildDoc(media, followDocId);
			const result = await invokeOpenScreenAgent({
				model: {
					provider: "openai",
					model: "gpt-4o",
					apiKey: key,
					baseUrl: "https://api.openai.com/v1",
				},
				document,
				history,
				userMessage: fp.prompt,
				sink: quietSink(),
				editsAllowed: true,
				contextPacking: "VIDEO_MEMORY_RETRIEVAL",
				videoMemorySessionStore: session,
				videoMemoryDocumentId: followDocId,
				speechCacheDir: path.join(OUT, "speech", "follow"),
				cursor: cursorFor(media),
			});
			history.push({ role: "user", content: fp.prompt });
			history.push({
				role: "assistant",
				content: (result.text || "").slice(0, 800) || "(empty)",
			});
			const ct = result.contextTelemetry;
			rows.push({
				kind: "followup",
				id: fp.id,
				status: result.status,
				inputTokens: ct?.providerUsage.inputTokens,
				outputTokens: ct?.providerUsage.outputTokens,
				cachedInputTokens: ct?.providerUsage.cachedInputTokens,
				imageCount: ct?.images.imageCount,
				estimatedUSD: ct?.estimatedCostUsd,
				totalMs: ct?.latency.totalMs,
				retrievalPath: result.retrievalPath,
				preview: (result.text || "").slice(0, 500),
			});
			writeFileSync(
				path.join(OUT, `follow-${fp.id}.json`),
				JSON.stringify(rows[rows.length - 1], null, 2),
			);
		}

		// Invariants on retrieval path
		const invCases = [
			{
				id: "INV_RESTART",
				media: c002?.mediaPath,
				prompt: "What temporary UI appears near the end? Did I restart the recording?",
				mustNot: ["restarted recording", "I restarted", "user restarted"],
			},
			{
				id: "INV_UPWORK",
				media: c005?.mediaPath,
				prompt:
					"If you see browser tabs or app names like Upwork, did I actually open or work in that app?",
				mustNot: ["opened Upwork", "worked on Upwork"],
			},
			{
				id: "INV_SETTINGS",
				media: c004?.mediaPath,
				prompt:
					"I mentioned Settings. Was Settings actually opened on screen, or do you only see related text/labels?",
				mustNot: ["opened Settings", "Settings panel opened", "navigated to Settings"],
			},
			{
				id: "INV_CASE4",
				media: c003?.mediaPath,
				prompt: "What did I say, and did I correct myself? What is my final intended meaning?",
				mustNot: ["opened Timeline", "opened Effects"],
			},
		];

		for (const inv of invCases) {
			if (!inv.media || !existsSync(inv.media)) {
				rows.push({ kind: "invariant", id: inv.id, status: "skipped", reason: "media missing" });
				continue;
			}
			const result = await invokeOpenScreenAgent({
				model: {
					provider: "openai",
					model: "gpt-4o",
					apiKey: key,
					baseUrl: "https://api.openai.com/v1",
				},
				document: buildDoc(inv.media, `inv_${inv.id}`),
				history: [],
				userMessage: inv.prompt,
				sink: quietSink(),
				editsAllowed: true,
				contextPacking: "VIDEO_MEMORY_RETRIEVAL",
				videoMemorySessionStore: createVideoMemorySessionStore(),
				videoMemoryDocumentId: `inv_${inv.id}`,
				speechCacheDir: path.join(OUT, "speech", inv.id),
				cursor: cursorFor(inv.media),
			});
			const text = result.text || "";
			const hits = inv.mustNot.filter((p) =>
				new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text),
			);
			rows.push({
				kind: "invariant",
				id: inv.id,
				status: result.status,
				invariantOk: hits.length === 0,
				hits,
				inputTokens: result.contextTelemetry?.providerUsage.inputTokens,
				imageCount: result.contextTelemetry?.images.imageCount,
				retrievalPath: result.retrievalPath,
				preview: text.slice(0, 500),
			});
		}

		writeFileSync(
			path.join(OUT, "summary.json"),
			JSON.stringify({ identity: IDENTITY, rows }, null, 2),
		);
		expect(rows.length).toBeGreaterThan(0);
	}, 2_400_000);
});
