/**
 * Video Memory Retrieval Closure V1 — live validation.
 * Identity: CURRENT_OPENSCREEN_VIDEO_MEMORY_RETRIEVAL_CLOSURE_V1
 *
 * Run:
 *   npx vitest --run electron/ai-edition/perceptionBenchmark/videoMemoryRetrievalClosure/video-memory-retrieval-closure.runtime.test.ts
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../../src/lib/ai-edition/schema";
import { readCursorSidecar } from "../../../media/cursorSidecar";
import { _resetSttManagerForTests, shutdownStt } from "../../../stt/index";
import { fingerprintDocument } from "../../applyPreview/fingerprint";
import { invokeOpenScreenAgent, type OpenScreenAgentSink } from "../../deep-agent/service";
import { fingerprintProgramme, fingerprintSourceAsset } from "../../videoMemory";
import { SYSTEM_PROMPT_SECTION_AUDIT } from "../../videoMemory/compactSystem";
import {
	type ContextPackingMode,
	VIDEO_MEMORY_RETRIEVAL_CLOSURE_V1_ID,
} from "../../videoMemory/productionPath";
import {
	_resetVideoMemorySessionStoreForTests,
	createVideoMemorySessionStore,
} from "../../videoMemory/sessionStore";
import { auditToolRelevance } from "../../videoMemory/toolGate";
import { REAL_CORPUS_CASES } from "../realCorpusBaseline/cases";
import { loadOpenAiKey } from "../runCurrentStack";

const IDENTITY = VIDEO_MEMORY_RETRIEVAL_CLOSURE_V1_ID;
const OUT = path.join(process.cwd(), "tmp/perception-benchmark/video-memory-retrieval-closure-v1");

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

function buildDoc(mediaPath: string, projectId: string, durationSec = 30) {
	const base = createEmptyDocument({ title: "closure", projectId });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				label: "closure",
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

function trimDoc(doc: ReturnType<typeof buildDoc>) {
	const clip = doc.timeline.clips[0]!;
	const end = clip.sourceEndSec ?? 20;
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

type Row = Record<string, unknown>;
const rows: Row[] = [];

function push(row: Row) {
	rows.push(row);
	const safe = String(row.id ?? row.kind ?? "row")
		.replace(/[^\w.-]+/g, "_")
		.slice(0, 80);
	writeFileSync(path.join(OUT, `${safe}-${rows.length}.json`), JSON.stringify(row, null, 2));
}

async function invoke(opts: {
	id: string;
	kind: string;
	mediaPath: string;
	prompt: string;
	mode: ContextPackingMode;
	document?: ReturnType<typeof buildDoc>;
	history?: Array<{ role: "user" | "assistant"; content: string }>;
	session?: ReturnType<typeof createVideoMemorySessionStore>;
	docId?: string;
	mustNot?: string[];
	apiKey: string;
}) {
	const document = opts.document ?? buildDoc(opts.mediaPath, opts.docId ?? opts.id);
	const result = await invokeOpenScreenAgent({
		model: {
			provider: "openai",
			model: "gpt-4o",
			apiKey: opts.apiKey,
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
	const text = result.text || "";
	const hits =
		opts.mustNot?.filter((p) =>
			new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text),
		) ?? [];
	const ct = result.contextTelemetry;
	const row: Row = {
		identity: IDENTITY,
		kind: opts.kind,
		id: opts.id,
		mode: opts.mode,
		prompt: opts.prompt,
		mediaPath: opts.mediaPath,
		status: result.status,
		failureReason: result.failureReason ?? null,
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
		components: ct?.components
			? {
					system: ct.components.systemInstruction,
					tools: ct.components.toolSchemas,
					history: ct.components.conversationHistory,
					userText: ct.components.userMessageMultimodalText,
					images: ct.components.imageDataUrls,
					sourceStory: ct.components.sourceStory,
					trusted: ct.components.trustedEditorialBriefing,
				}
			: null,
		retrievalPath: result.retrievalPath,
		sourceFp: fingerprintSourceAsset(document, "asset_1"),
		programmeFp: fingerprintProgramme(document),
		docFp: fingerprintDocument(document).value,
		durationSecHint: document.assets[0]?.durationSec,
		speechSegments: result.speechEvidence?.[0]?.segments?.length ?? null,
		invariantOk: opts.mustNot ? hits.length === 0 : undefined,
		invariantHits: hits,
		preview: text.slice(0, 700),
		finalText: text,
	};
	push(row);
	return { result, row, document, text };
}

describe("Video Memory Retrieval Closure V1", () => {
	afterAll(async () => {
		mkdirSync(OUT, { recursive: true });
		writeFileSync(
			path.join(OUT, "summary.json"),
			JSON.stringify(
				{
					identity: IDENTITY,
					toolAudit: {
						speech: auditToolRelevance("speech"),
						visual: auditToolRelevance("visual"),
						editorial: auditToolRelevance("editorial"),
						action_verify: auditToolRelevance("action_verify"),
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

	it("closure matrix", async () => {
		mkdirSync(OUT, { recursive: true });
		writeFileSync(path.join(OUT, "NOTICE.md"), `# ${IDENTITY}\n`);

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
		const longish = corpus("case-010") ?? corpus("case-011");
		const mediaShort = c001?.mediaPath ?? "";
		if (!mediaShort || !existsSync(mediaShort)) {
			push({ kind: "setup", id: "no-media", status: "skipped" });
			expect(true).toBe(true);
			return;
		}

		// --- 1. Live fingerprint / session reuse F1–F5 ---
		_resetVideoMemorySessionStoreForTests();
		const session = createVideoMemorySessionStore();
		const followId = "closure_follow_v1";
		const history: Array<{ role: "user" | "assistant"; content: string }> = [];
		const followPrompts = [
			{
				id: "F1",
				prompt: "Watch this recording carefully and tell me what is happening over time.",
			},
			{ id: "F2", prompt: "What did I say near the end?" },
			{ id: "F3", prompt: "Did I actually open Settings?" },
			{ id: "F4", prompt: "What visibly changed when I moved into the code editor?" },
			{
				id: "F5",
				prompt:
					"How would you make this recording more professional while keeping the important explanation?",
			},
		];
		for (const fp of followPrompts) {
			const { text } = await invoke({
				id: fp.id,
				kind: "followup",
				mediaPath: mediaShort,
				prompt: fp.prompt,
				mode: "VIDEO_MEMORY_RETRIEVAL",
				history,
				session,
				docId: followId,
				apiKey,
				mustNot:
					fp.id === "F3"
						? ["opened Settings", "Settings panel opened", "navigated to Settings"]
						: undefined,
			});
			history.push({ role: "user", content: fp.prompt });
			history.push({ role: "assistant", content: text.slice(0, 900) || "(empty)" });
		}

		// --- 2. Programme invalidation ---
		const beforeDoc = buildDoc(mediaShort, "closure_prog_inv");
		const srcBefore = fingerprintSourceAsset(beforeDoc, "asset_1");
		const progBefore = fingerprintProgramme(beforeDoc);
		_resetVideoMemorySessionStoreForTests();
		const invSession = createVideoMemorySessionStore();
		await invoke({
			id: "PROG_BEFORE",
			kind: "programme_invalidation",
			mediaPath: mediaShort,
			prompt: "Summarize what this recording is about.",
			mode: "VIDEO_MEMORY_RETRIEVAL",
			document: beforeDoc,
			session: invSession,
			docId: "closure_prog_inv",
			apiKey,
		});
		const afterDoc = trimDoc(beforeDoc);
		const srcAfter = fingerprintSourceAsset(afterDoc, "asset_1");
		const progAfter = fingerprintProgramme(afterDoc);
		await invoke({
			id: "PROG_AFTER",
			kind: "programme_invalidation",
			mediaPath: mediaShort,
			prompt: "After the trim, what should I still preserve from the source recording?",
			mode: "VIDEO_MEMORY_RETRIEVAL",
			document: afterDoc,
			session: invSession,
			docId: "closure_prog_inv",
			apiKey,
		});
		push({
			kind: "programme_invalidation_meta",
			id: "PROG_FINGERPRINTS",
			srcBefore,
			srcAfter,
			srcUnchanged: srcBefore === srcAfter,
			progBefore,
			progAfter,
			progChanged: progBefore !== progAfter,
		});

		// --- 3. Restart (retry) ---
		if (c002?.mediaPath && existsSync(c002.mediaPath)) {
			for (let attempt = 1; attempt <= 2; attempt++) {
				const { row } = await invoke({
					id: `INV_RESTART_a${attempt}`,
					kind: "invariant",
					mediaPath: c002.mediaPath,
					prompt: "What temporary UI appears near the end? Did I restart the recording?",
					mode: "VIDEO_MEMORY_RETRIEVAL",
					apiKey,
					mustNot: ["restarted recording", "I restarted", "user restarted"],
				});
				if (row.status === "completed") break;
			}
		} else {
			push({ kind: "invariant", id: "INV_RESTART", status: "skipped", reason: "media missing" });
		}

		// Upwork / Settings / Case4
		if (c005?.mediaPath && existsSync(c005.mediaPath)) {
			await invoke({
				id: "INV_UPWORK",
				kind: "invariant",
				mediaPath: c005.mediaPath,
				prompt:
					"If you see browser tabs or app names like Upwork, did I actually open or work in that app?",
				mode: "VIDEO_MEMORY_RETRIEVAL",
				apiKey,
				mustNot: ["opened Upwork", "worked on Upwork", "navigated to Upwork"],
			});
		}
		if (c004?.mediaPath && existsSync(c004.mediaPath)) {
			await invoke({
				id: "INV_SETTINGS",
				kind: "invariant",
				mediaPath: c004.mediaPath,
				prompt:
					"I mentioned Settings. Was Settings actually opened on screen, or do you only see related text/labels?",
				mode: "VIDEO_MEMORY_RETRIEVAL",
				apiKey,
				mustNot: ["opened Settings", "Settings panel opened", "navigated to Settings"],
			});
		}
		if (c003?.mediaPath && existsSync(c003.mediaPath)) {
			await invoke({
				id: "INV_CASE4",
				kind: "invariant",
				mediaPath: c003.mediaPath,
				prompt:
					"What did I say, and did I correct myself? What is my final intended meaning? Fix mistakes but preserve the corrected explanation.",
				mode: "VIDEO_MEMORY_RETRIEVAL",
				apiKey,
				mustNot: ["opened Timeline", "opened Effects"],
			});
		}

		// --- Case 020 ---
		if (c020?.mediaPath && existsSync(c020.mediaPath)) {
			const c020Session = createVideoMemorySessionStore();
			const c020Id = "closure_case020";
			const c020Hist: Array<{ role: "user" | "assistant"; content: string }> = [];
			for (const p of [
				{
					id: "C020_A",
					prompt: "Watch this recording and tell me what could genuinely be improved.",
				},
				{ id: "C020_B", prompt: "Make this feel more professional." },
				{ id: "C020_C", prompt: "Where would zoom actually help, if anywhere?" },
			]) {
				const { text } = await invoke({
					id: p.id,
					kind: "case020",
					mediaPath: c020.mediaPath,
					prompt: p.prompt,
					mode: "VIDEO_MEMORY_RETRIEVAL",
					session: c020Session,
					docId: c020Id,
					history: c020Hist,
					apiKey,
				});
				c020Hist.push({ role: "user", content: p.prompt });
				c020Hist.push({ role: "assistant", content: text.slice(0, 900) || "(empty)" });
			}
		} else {
			push({ kind: "case020", id: "C020", status: "skipped", reason: "media missing" });
		}

		// --- Cross-modal ---
		const crossMedia = c004?.mediaPath && existsSync(c004.mediaPath) ? c004.mediaPath : mediaShort;
		await invoke({
			id: "CROSS_MODAL",
			kind: "cross_modal",
			mediaPath: crossMedia,
			prompt:
				"Compare what I say I am doing with what is actually visible. Tell me where they match, where they differ, and what you cannot verify.",
			mode: "VIDEO_MEMORY_RETRIEVAL",
			apiKey,
		});

		// --- Multi-duration sample ---
		for (const spec of [
			{ id: "DUR_SHORT", caseId: "case-001" },
			{ id: "DUR_UI", caseId: "case-002" },
			{ id: "DUR_LONG", caseId: longish?.caseId ?? "case-010" },
		]) {
			const c = corpus(spec.caseId);
			if (!c?.mediaPath || !existsSync(c.mediaPath)) {
				push({ kind: "duration", id: spec.id, status: "skipped" });
				continue;
			}
			await invoke({
				id: spec.id,
				kind: "duration",
				mediaPath: c.mediaPath,
				prompt: "What is happening in this recording? Be specific to what you can evidence.",
				mode: "VIDEO_MEMORY_RETRIEVAL",
				apiKey,
			});
		}

		// --- A/B/C on speech + editorial ---
		for (const p of [
			{ id: "ABC_SPEECH", prompt: "What did I say near the end?" },
			{
				id: "ABC_EDIT",
				prompt:
					"Make this more professional. Only suggest changes supported by the recording. What edits would you NOT make here?",
			},
		]) {
			for (const mode of [
				"CURRENT_FULL_CONTEXT",
				"VIDEO_MEMORY_RETRIEVAL",
				"VIDEO_MEMORY_RETRIEVAL_COMPACT",
			] as const) {
				await invoke({
					id: `${p.id}_${mode}`,
					kind: "abc",
					mediaPath: mediaShort,
					prompt: p.prompt,
					mode,
					apiKey,
				});
			}
		}

		// --- Editorial challenges (retrieval) ---
		for (const p of [
			{ id: "ED_PACING", prompt: "Improve the pacing." },
			{ id: "ED_DISTRACT", prompt: "What is distracting in this recording?" },
			{ id: "ED_NOT", prompt: "What edits would you NOT make here?" },
			{
				id: "ED_ZOOM",
				prompt: "Is there anywhere a zoom would actually help?",
			},
		]) {
			await invoke({
				id: p.id,
				kind: "editorial_challenge",
				mediaPath: mediaShort,
				prompt: p.prompt,
				mode: "VIDEO_MEMORY_RETRIEVAL",
				apiKey,
			});
		}

		expect(rows.length).toBeGreaterThan(5);
	}, 3_600_000);
});
