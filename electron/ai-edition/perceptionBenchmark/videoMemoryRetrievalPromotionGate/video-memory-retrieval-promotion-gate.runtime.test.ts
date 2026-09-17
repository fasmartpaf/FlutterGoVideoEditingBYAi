/**
 * Video Memory Retrieval Promotion Gate V1 — live validation.
 * Identity: CURRENT_OPENSCREEN_VIDEO_MEMORY_RETRIEVAL_PROMOTION_GATE_V1
 *
 * Persists the SAME AxcutDocument across turns (result.document).
 * Does not overwrite prior benchmark artifact directories.
 *
 * Run:
 *   npx vitest --run electron/ai-edition/perceptionBenchmark/videoMemoryRetrievalPromotionGate/video-memory-retrieval-promotion-gate.runtime.test.ts
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
import { invokeOpenScreenAgent, type OpenScreenAgentSink } from "../../deep-agent/service";
import { classifyMediaContextNeeds } from "../../mediaContextNeeds";
import {
	classifyVideoMemoryQuery,
	fingerprintProgramme,
	fingerprintSourceAsset,
} from "../../videoMemory";
import { SYSTEM_PROMPT_SECTION_AUDIT } from "../../videoMemory/compactSystem";
import {
	type ContextPackingMode,
	VIDEO_MEMORY_RETRIEVAL_PROMOTION_GATE_V1_ID,
} from "../../videoMemory/productionPath";
import {
	_resetVideoMemorySessionStoreForTests,
	createVideoMemorySessionStore,
} from "../../videoMemory/sessionStore";
import { auditToolRelevance } from "../../videoMemory/toolGate";
import { REAL_CORPUS_CASES } from "../realCorpusBaseline/cases";
import { loadOpenAiKey } from "../runCurrentStack";

const IDENTITY = VIDEO_MEMORY_RETRIEVAL_PROMOTION_GATE_V1_ID;
const OUT = path.join(
	process.cwd(),
	"tmp/perception-benchmark/video-memory-retrieval-promotion-gate-v1",
	"run-3-story-merge",
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

function buildDoc(mediaPath: string, projectId: string, durationSec = 30): AxcutDocument {
	const base = createEmptyDocument({ title: "promotion-gate", projectId });
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

function trimProgramme(doc: AxcutDocument): AxcutDocument {
	const clip = doc.timeline.clips[0]!;
	const end = clip.sourceEndSec ?? doc.assets[0]?.durationSec ?? 20;
	return documentSchema.parse({
		...doc,
		timeline: {
			...doc.timeline,
			clips: [
				{
					...clip,
					sourceStartSec: Math.min(2, end / 4),
					sourceEndSec: Math.max(end * 0.75, 4),
					timelineEndSec: Math.max(end * 0.75 - 2, 3),
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

function temporalCoverage(
	times: number[],
	durationSec: number | null,
): {
	frameCount: number;
	minSec: number | null;
	maxSec: number | null;
	spanSec: number | null;
	coverageFrac: number | null;
	clustered: boolean;
	inadequateForWholeVideo: boolean;
} {
	if (!times.length) {
		return {
			frameCount: 0,
			minSec: null,
			maxSec: null,
			spanSec: null,
			coverageFrac: null,
			clustered: false,
			inadequateForWholeVideo: true,
		};
	}
	const minSec = Math.min(...times);
	const maxSec = Math.max(...times);
	const spanSec = maxSec - minSec;
	const dur = durationSec && durationSec > 0 ? durationSec : null;
	const coverageFrac = dur ? spanSec / dur : null;
	const clustered = spanSec < 3 && (dur ?? 0) > 10;
	const inadequateForWholeVideo =
		times.length === 0 || clustered || (coverageFrac != null && coverageFrac < 0.4);
	return {
		frameCount: times.length,
		minSec,
		maxSec,
		spanSec,
		coverageFrac,
		clustered,
		inadequateForWholeVideo,
	};
}

type Row = Record<string, unknown>;
const rows: Row[] = [];
let abortRemaining = false;
let abortReason: string | null = null;

function push(row: Row) {
	rows.push(row);
	const safe = String(row.id ?? row.kind ?? "row")
		.replace(/[^\w.-]+/g, "_")
		.slice(0, 80);
	writeFileSync(path.join(OUT, `${safe}-${rows.length}.json`), JSON.stringify(row, null, 2));
}

describe("Video Memory Retrieval Promotion Gate V1", () => {
	afterAll(async () => {
		mkdirSync(OUT, { recursive: true });
		writeFileSync(
			path.join(OUT, "summary.json"),
			JSON.stringify(
				{
					identity: IDENTITY,
					abortRemaining,
					abortReason,
					toolAudit: {
						speech: {
							...auditToolRelevance("speech"),
							allowedNames: [...auditToolRelevance("speech").allowedNames],
						},
						visual: {
							...auditToolRelevance("visual"),
							allowedNames: [...auditToolRelevance("visual").allowedNames],
						},
						cross_modal: {
							...auditToolRelevance("cross_modal"),
							allowedNames: [...auditToolRelevance("cross_modal").allowedNames],
						},
						action_verify: {
							...auditToolRelevance("action_verify"),
							allowedNames: [...auditToolRelevance("action_verify").allowedNames],
						},
						editorial: {
							...auditToolRelevance("editorial"),
							allowedNames: [...auditToolRelevance("editorial").allowedNames],
						},
						direct_edit: {
							...auditToolRelevance("direct_edit"),
							allowedNames: [...auditToolRelevance("direct_edit").allowedNames],
						},
						general: {
							...auditToolRelevance("general"),
							allowedNames: [...auditToolRelevance("general").allowedNames],
						},
					},
					systemPromptAudit: SYSTEM_PROMPT_SECTION_AUDIT,
					rows,
				},
				null,
				2,
			),
		);
		await shutdownStt().catch(() => {});
		_resetSttManagerForTests();
	});

	const apiKey = loadOpenAiKey();

	it("promotion gate matrix", async () => {
		mkdirSync(OUT, { recursive: true });
		writeFileSync(
			path.join(OUT, "NOTICE.md"),
			`# ${IDENTITY}\nDo not overwrite prior video-memory-* artifact directories.\n`,
		);

		if (!apiKey) {
			push({ kind: "setup", id: "no-key", status: "skipped" });
			expect(true).toBe(true);
			return;
		}

		const c001 = corpus("case-001");
		const c002 = corpus("case-002");
		const c003 = corpus("case-003");
		const c004 = corpus("case-004");
		const c005 = corpus("case-005");
		const c020 = corpus("case-020");
		const mediaShort = c001?.mediaPath ?? "";
		if (!mediaShort || !existsSync(mediaShort)) {
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
			persist?: boolean;
		}): Promise<{
			row: Row;
			document: AxcutDocument;
			text: string;
			result: Awaited<ReturnType<typeof invokeOpenScreenAgent>>;
		}> {
			const needs = classifyMediaContextNeeds(opts.prompt);
			const queryClass = classifyVideoMemoryQuery(opts.prompt, needs);
			const srcBefore = fingerprintSourceAsset(opts.document, "asset_1");
			const progBefore = fingerprintProgramme(opts.document);
			const durationBefore = opts.document.assets[0]?.durationSec ?? null;

			const result = await invokeOpenScreenAgent({
				model: {
					provider: "openai",
					model: "gpt-4o",
					apiKey,
					baseUrl: "https://api.openai.com/v1",
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

			const nextDoc = result.document ?? opts.document;
			const text = result.text || "";
			const hits =
				opts.mustNot?.filter((p) =>
					new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text),
				) ?? [];
			const ct = result.contextTelemetry;
			const rp = result.retrievalPath;
			const frameTimes = (rp?.frameMeta ?? []).map((m) => m.sourceTimeSec);
			const durationAfter = nextDoc.assets[0]?.durationSec ?? null;
			const coverage = temporalCoverage(frameTimes, durationAfter);

			if (
				result.status === "provider_error" &&
				(result.failureReason === "provider_quota_exhausted" ||
					result.failureReason === "provider_rate_limited")
			) {
				abortRemaining = true;
				abortReason = String(result.failureReason);
			}

			const row: Row = {
				identity: IDENTITY,
				kind: opts.kind,
				id: opts.id,
				mode: opts.mode,
				prompt: opts.prompt,
				mediaPath: opts.mediaPath,
				provider: "openai",
				model: "gpt-4o",
				status: result.status,
				failureReason: result.failureReason ?? null,
				needsCategory: needs.category,
				needsVisual: needs.visual,
				needsSpeech: needs.speech,
				classifiedQueryClass: queryClass,
				retrievalQueryClass: rp?.queryClass ?? null,
				inputTokens: ct?.providerUsage.inputTokens,
				outputTokens: ct?.providerUsage.outputTokens,
				cachedInputTokens: ct?.providerUsage.cachedInputTokens,
				imageCount: ct?.images.imageCount,
				estimatedImageTokens: ct?.images.estimatedImageTokens,
				estimatedUSD: ct?.estimatedCostUsd,
				totalMs: ct?.latency.totalMs,
				providerMs: ct?.latency.providerMs,
				sttMs: ct?.latency.sttMs,
				visualMs: ct?.latency.visualEvidenceMs,
				investigatorMs: ct?.latency.investigatorMs,
				providerCalls: ct?.providerUsage.modelCalls ?? null,
				components: ct?.components
					? {
							system: ct.components.systemInstruction,
							tools: ct.components.toolSchemas,
							history: ct.components.conversationHistory,
							userText: ct.components.userMessageMultimodalText,
							images: ct.components.imageDataUrls,
							sourceStory: ct.components.sourceStory,
							targetStory: ct.components.targetStory,
							trusted: ct.components.trustedEditorialBriefing,
							transcript: ct.components.transcript,
						}
					: null,
				retrievalPath: rp ?? null,
				sourceFpBefore: srcBefore,
				programmeFpBefore: progBefore,
				sourceFpAfter: fingerprintSourceAsset(nextDoc, "asset_1"),
				programmeFpAfter: fingerprintProgramme(nextDoc),
				durationBefore,
				durationAfter,
				clipSourceEndBefore: opts.document.timeline.clips[0]?.sourceEndSec ?? null,
				clipSourceEndAfter: nextDoc.timeline.clips[0]?.sourceEndSec ?? null,
				temporalCoverage: coverage,
				frameMeta: rp?.frameMeta ?? [],
				invariantOk: opts.mustNot ? hits.length === 0 : undefined,
				invariantHits: hits,
				preview: text.slice(0, 900),
				finalText: text,
			};
			push(row);
			return { row, document: opts.persist === false ? opts.document : nextDoc, text, result };
		}

		// --- A. Programme-memory live proof (same document + same session) ---
		_resetVideoMemorySessionStoreForTests();
		const progSession = createVideoMemorySessionStore();
		const progId = "gate_programme_v1";
		let progDoc = buildDoc(mediaShort, progId);
		const progHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
		const pPrompts = [
			{
				id: "P1",
				prompt: "Watch this recording carefully and tell me what is happening over time.",
			},
			{ id: "P2", prompt: "What did I say near the end?" },
			{ id: "P3", prompt: "Summarize the important explanation that should be preserved." },
		];
		for (const p of pPrompts) {
			const { document, text } = await invoke({
				id: p.id,
				kind: "programme_reuse",
				mediaPath: mediaShort,
				prompt: p.prompt,
				mode: "VIDEO_MEMORY_RETRIEVAL",
				document: progDoc,
				history: progHistory,
				session: progSession,
				docId: progId,
				speechCacheKey: "prog_narrated",
			});
			progDoc = document;
			progHistory.push({ role: "user", content: p.prompt });
			progHistory.push({ role: "assistant", content: text.slice(0, 900) || "(empty)" });
		}

		const srcBeforeTrim = fingerprintSourceAsset(progDoc, "asset_1");
		const progBeforeTrim = fingerprintProgramme(progDoc);
		progDoc = trimProgramme(progDoc);
		const srcAfterTrim = fingerprintSourceAsset(progDoc, "asset_1");
		const progAfterTrim = fingerprintProgramme(progDoc);
		push({
			kind: "programme_mutation_meta",
			id: "P4_FINGERPRINTS",
			srcBeforeTrim,
			srcAfterTrim,
			srcUnchanged: srcBeforeTrim === srcAfterTrim,
			progBeforeTrim,
			progAfterTrim,
			progChanged: progBeforeTrim !== progAfterTrim,
		});

		const p4 = await invoke({
			id: "P4",
			kind: "programme_invalidation",
			mediaPath: mediaShort,
			prompt: "After this timeline trim, what should still be preserved from the source recording?",
			mode: "VIDEO_MEMORY_RETRIEVAL",
			document: progDoc,
			session: progSession,
			docId: progId,
			speechCacheKey: "prog_narrated",
			history: [],
		});
		progDoc = p4.document;

		await invoke({
			id: "P5",
			kind: "programme_reuse_after_mutation",
			mediaPath: mediaShort,
			prompt: "What is the current programme, and what must still survive from the source?",
			mode: "VIDEO_MEMORY_RETRIEVAL",
			document: progDoc,
			session: progSession,
			docId: progId,
			speechCacheKey: "prog_narrated",
			history: [
				{
					role: "user",
					content:
						"After this timeline trim, what should still be preserved from the source recording?",
				},
				{ role: "assistant", content: p4.text.slice(0, 900) || "(empty)" },
			],
		});

		// --- B. Case 020 live visual editorial ---
		if (c020?.mediaPath && existsSync(c020.mediaPath)) {
			_resetVideoMemorySessionStoreForTests();
			const c020Session = createVideoMemorySessionStore();
			const c020Id = "gate_case020";
			let c020Doc = buildDoc(c020.mediaPath, c020Id);
			const c020Hist: Array<{ role: "user" | "assistant"; content: string }> = [];
			for (const p of [
				{
					id: "C1",
					prompt:
						"Where would a zoom actually help in this recording, and where would it not help? Only recommend zooms when the visible evidence supports a specific focal target.",
				},
				{
					id: "C2",
					prompt: "What would you NOT edit in this recording, and why?",
				},
				{
					id: "C3",
					prompt:
						"Make this feel more professional, but preserve anything that is already clear and useful.",
				},
			]) {
				const { document, text } = await invoke({
					id: p.id,
					kind: "case020",
					mediaPath: c020.mediaPath,
					prompt: p.prompt,
					mode: "VIDEO_MEMORY_RETRIEVAL",
					document: c020Doc,
					session: c020Session,
					docId: c020Id,
					speechCacheKey: "case020",
					history: c020Hist,
				});
				c020Doc = document;
				c020Hist.push({ role: "user", content: p.prompt });
				c020Hist.push({ role: "assistant", content: text.slice(0, 900) || "(empty)" });
			}
		} else {
			push({ kind: "case020", id: "C020", status: "skipped", reason: "media missing" });
		}

		// --- C. FULL vs RETRIEVAL vs COMPACT (fresh session per cell; persist doc within cell) ---
		const abcPrompts = [
			{ id: "Q1_SPEECH", prompt: "What did I say near the end?" },
			{ id: "Q2_VISUAL", prompt: "What is visibly happening in this recording over time?" },
			{
				id: "Q3_EDITORIAL",
				prompt: "What could genuinely be improved to make this recording feel more professional?",
			},
			{ id: "Q4_NEG", prompt: "What would you NOT edit, and why?" },
			{
				id: "Q5_CROSS",
				prompt:
					"Compare what I say with what is visibly happening. Tell me what matches, what differs, and what cannot be verified.",
			},
		] as const;
		const modes: ContextPackingMode[] = [
			"CURRENT_FULL_CONTEXT",
			"VIDEO_MEMORY_RETRIEVAL",
			"VIDEO_MEMORY_RETRIEVAL_COMPACT",
		];
		for (const p of abcPrompts) {
			for (const mode of modes) {
				_resetVideoMemorySessionStoreForTests();
				const session = createVideoMemorySessionStore();
				const docId = `abc_${p.id}_${mode}`;
				await invoke({
					id: `${p.id}_${mode}`,
					kind: "abc",
					mediaPath: mediaShort,
					prompt: p.prompt,
					mode,
					document: buildDoc(mediaShort, docId),
					session,
					docId,
					speechCacheKey: "abc_narrated",
				});
			}
		}

		// --- D. Invariants on Retrieval ---
		for (const spec of [
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
		]) {
			if (!spec.case?.mediaPath || !existsSync(spec.case.mediaPath)) {
				push({ kind: "invariant", id: spec.id, status: "skipped" });
				continue;
			}
			_resetVideoMemorySessionStoreForTests();
			await invoke({
				id: spec.id,
				kind: "invariant",
				mediaPath: spec.case.mediaPath,
				prompt: spec.prompt,
				mode: "VIDEO_MEMORY_RETRIEVAL",
				document: buildDoc(spec.case.mediaPath, spec.id),
				session: createVideoMemorySessionStore(),
				docId: spec.id,
				speechCacheKey: spec.id,
				mustNot: spec.mustNot,
			});
		}

		// --- F. Longest local recording (28.9s found; still not 1–5 min) ---
		const longest = path.join(
			os.homedir(),
			"Library/Application Support/openscreen/recordings/recording-1789325019656.mp4",
		);
		if (existsSync(longest)) {
			_resetVideoMemorySessionStoreForTests();
			await invoke({
				id: "LONG_VISUAL",
				kind: "long_form",
				mediaPath: longest,
				prompt:
					"What is visibly happening in this recording over time? Be specific to sampled evidence.",
				mode: "VIDEO_MEMORY_RETRIEVAL",
				document: buildDoc(longest, "gate_long"),
				session: createVideoMemorySessionStore(),
				docId: "gate_long",
				speechCacheKey: "long_289",
			});
		} else {
			push({ kind: "long_form", id: "LONG_VISUAL", status: "skipped", reason: "file missing" });
		}

		expect(rows.length).toBeGreaterThan(3);
	}, 3_600_000);
});
