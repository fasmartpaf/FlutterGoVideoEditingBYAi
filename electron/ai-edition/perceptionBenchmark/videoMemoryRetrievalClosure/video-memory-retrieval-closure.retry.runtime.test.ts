/**
 * Closure V1 retry — programme-hit proof + quota-failed compact/editorial rows.
 * Writes RETRY_* artifacts into the same closure directory (does not overwrite).
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../../src/lib/ai-edition/schema";
import { readCursorSidecar } from "../../../media/cursorSidecar";
import { _resetSttManagerForTests, shutdownStt } from "../../../stt/index";
import { invokeOpenScreenAgent, type OpenScreenAgentSink } from "../../deep-agent/service";
import { probeSourceDurations, resolveFfprobe } from "../../sourceTiming";
import { fingerprintProgramme, fingerprintSourceAsset } from "../../videoMemory";
import {
	type ContextPackingMode,
	VIDEO_MEMORY_RETRIEVAL_CLOSURE_V1_ID,
} from "../../videoMemory/productionPath";
import {
	_resetVideoMemorySessionStoreForTests,
	createVideoMemorySessionStore,
} from "../../videoMemory/sessionStore";
import { REAL_CORPUS_CASES } from "../realCorpusBaseline/cases";
import { loadOpenAiKey } from "../runCurrentStack";

const IDENTITY = VIDEO_MEMORY_RETRIEVAL_CLOSURE_V1_ID;
const OUT = path.join(process.cwd(), "tmp/perception-benchmark/video-memory-retrieval-closure-v1");

function corpus(id: string) {
	return REAL_CORPUS_CASES.find((c) => c.caseId === id);
}

function quietSink() {
	return {
		text: () => {},
		thinking: () => {},
		toolStart: () => {},
		toolEnd: () => {},
		error: () => {},
	} satisfies OpenScreenAgentSink;
}

function buildDoc(mediaPath: string, projectId: string, durationSec = 30) {
	const base = createEmptyDocument({ title: "closure-retry", projectId });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				label: "retry",
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

const rows: Record<string, unknown>[] = [];

function push(row: Record<string, unknown>) {
	rows.push(row);
	const safe = String(row.id ?? "row")
		.replace(/[^\w.-]+/g, "_")
		.slice(0, 80);
	writeFileSync(path.join(OUT, `${safe}.json`), JSON.stringify(row, null, 2));
}

describe("Video Memory Retrieval Closure V1 retry", () => {
	afterAll(async () => {
		writeFileSync(
			path.join(OUT, "retry-summary.json"),
			JSON.stringify({ identity: IDENTITY, rows }, null, 2),
		);
		await shutdownStt().catch(() => {});
		_resetSttManagerForTests();
	});

	it("programme hit + compact/editorial retries", async () => {
		mkdirSync(OUT, { recursive: true });
		const apiKey = loadOpenAiKey();
		if (!apiKey) {
			push({ id: "RETRY_NO_KEY", status: "skipped" });
			expect(true).toBe(true);
			return;
		}

		const c001 = corpus("case-001");
		const c002 = corpus("case-002");
		const c003 = corpus("case-003");
		const c004 = corpus("case-004");
		const c005 = corpus("case-005");
		const c008 = corpus("case-008");
		const c010 = corpus("case-010");
		const c012 = corpus("case-012");
		const c020 = corpus("case-020");
		const paths = [c001, c002, c003, c004, c005, c008, c010, c012, c020]
			.map((c) => c?.mediaPath)
			.filter((p): p is string => Boolean(p && existsSync(p)));
		const unique = [...new Set(paths)];
		const durations: Record<string, unknown> = {
			ffprobe: resolveFfprobe() ?? "missing",
		};
		for (const p of unique) {
			try {
				const probed = await probeSourceDurations(p);
				durations[path.basename(p)] = probed;
			} catch (e) {
				durations[path.basename(p)] = e instanceof Error ? e.message : String(e);
			}
		}
		writeFileSync(path.join(OUT, "DURATIONS.json"), JSON.stringify(durations, null, 2));
		push({ id: "RETRY_DURATIONS", durations });

		const mediaShort = c001?.mediaPath ?? "";
		if (!mediaShort || !existsSync(mediaShort)) {
			push({ id: "RETRY_NO_MEDIA", status: "skipped" });
			expect(true).toBe(true);
			return;
		}

		async function invoke(opts: {
			id: string;
			mediaPath: string;
			prompt: string;
			mode: ContextPackingMode;
			document?: ReturnType<typeof buildDoc>;
			session?: ReturnType<typeof createVideoMemorySessionStore>;
			docId?: string;
			history?: Array<{ role: "user" | "assistant"; content: string }>;
		}) {
			const document = opts.document ?? buildDoc(opts.mediaPath, opts.docId ?? opts.id);
			const result = await invokeOpenScreenAgent({
				model: {
					provider: "openai",
					model: "gpt-4o",
					apiKey,
					baseUrl: "https://api.openai.com/v1",
				},
				document,
				history: opts.history ?? [],
				userMessage: opts.prompt,
				sink: quietSink(),
				editsAllowed: true,
				contextPacking: opts.mode,
				videoMemorySessionStore: opts.session ?? createVideoMemorySessionStore(),
				videoMemoryDocumentId: opts.docId ?? opts.id,
				speechCacheDir: path.join(OUT, "speech", opts.id),
				cursor: cursorFor(opts.mediaPath),
			});
			const rp = result.retrievalPath;
			const ct = result.contextTelemetry;
			const row = {
				identity: IDENTITY,
				id: opts.id,
				mode: opts.mode,
				prompt: opts.prompt,
				status: result.status,
				failureReason: result.failureReason ?? null,
				inputTokens: ct?.providerUsage.inputTokens,
				outputTokens: ct?.providerUsage.outputTokens,
				cachedInputTokens: ct?.providerUsage.cachedInputTokens,
				imageCount: ct?.images.imageCount,
				estimatedUSD: ct?.estimatedCostUsd,
				totalMs: ct?.latency.totalMs,
				providerMs: ct?.latency.providerMs,
				sttMs: ct?.latency.sttMs,
				components: ct?.components
					? {
							system: ct.components.systemInstruction,
							tools: ct.components.toolSchemas,
							userText: ct.components.userMessageMultimodalText,
							images: ct.components.imageDataUrls,
						}
					: null,
				sourceMemoryHit: rp?.sourceMemoryHit,
				programmeMemoryHit: rp?.programmeMemoryHit,
				ledgerReused: rp?.ledgerReused,
				claimsReused: rp?.claimsReused,
				sourceStoryReused: rp?.sourceStoryReused,
				sessionReuse: rp?.sessionReuse,
				ranInvestigator: rp?.ranInvestigator,
				queryClass: rp?.queryClass,
				toolsExposed: rp?.toolsExposed,
				toolGateNotes: rp?.toolGateNotes,
				sourceFp: fingerprintSourceAsset(document, "asset_1"),
				programmeFp: fingerprintProgramme(document),
				preview: (result.text || "").slice(0, 900),
				finalText: result.text || "",
			};
			push(row);
			return { result, row, document };
		}

		_resetVideoMemorySessionStoreForTests();
		const session = createVideoMemorySessionStore();
		const shared = buildDoc(mediaShort, "closure_prog_hit_v2");
		const t1 = await invoke({
			id: "RETRY_PROG_T1",
			mediaPath: mediaShort,
			prompt: "Watch this recording carefully and tell me what is happening over time.",
			mode: "VIDEO_MEMORY_RETRIEVAL",
			document: shared,
			session,
			docId: "closure_prog_hit_v2",
		});
		if (t1.row.status !== "completed") {
			push({
				id: "RETRY_ABORTED",
				reason: t1.row.failureReason,
				note: "provider failed; remaining retries skipped to avoid quota burn",
			});
			expect(true).toBe(true);
			return;
		}
		await invoke({
			id: "RETRY_PROG_T2",
			mediaPath: mediaShort,
			prompt: "What did I say near the end?",
			mode: "VIDEO_MEMORY_RETRIEVAL",
			document: shared,
			session,
			docId: "closure_prog_hit_v2",
			history: [
				{
					role: "user",
					content: "Watch this recording carefully and tell me what is happening over time.",
				},
				{ role: "assistant", content: String(t1.row.preview) },
			],
		});

		if (c020?.mediaPath && existsSync(c020.mediaPath)) {
			await invoke({
				id: "RETRY_C020_C",
				mediaPath: c020.mediaPath,
				prompt: "Where would zoom actually help, if anywhere?",
				mode: "VIDEO_MEMORY_RETRIEVAL",
			});
		}

		await invoke({
			id: "RETRY_ABC_SPEECH_COMPACT",
			mediaPath: mediaShort,
			prompt: "What did I say near the end?",
			mode: "VIDEO_MEMORY_RETRIEVAL_COMPACT",
		});
		await invoke({
			id: "RETRY_ED_NOT",
			mediaPath: mediaShort,
			prompt: "What edits would you NOT make here?",
			mode: "VIDEO_MEMORY_RETRIEVAL",
		});
		await invoke({
			id: "RETRY_ABC_EDIT_RETRIEVAL",
			mediaPath: mediaShort,
			prompt:
				"Make this more professional. Only suggest changes supported by the recording. What edits would you NOT make here?",
			mode: "VIDEO_MEMORY_RETRIEVAL",
		});
		await invoke({
			id: "RETRY_ABC_EDIT_COMPACT",
			mediaPath: mediaShort,
			prompt:
				"Make this more professional. Only suggest changes supported by the recording. What edits would you NOT make here?",
			mode: "VIDEO_MEMORY_RETRIEVAL_COMPACT",
		});

		expect(rows.length).toBeGreaterThan(1);
	}, 900_000);
});
