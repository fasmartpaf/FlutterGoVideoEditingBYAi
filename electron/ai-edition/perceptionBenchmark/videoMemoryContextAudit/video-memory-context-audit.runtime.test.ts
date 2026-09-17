/**
 * Video Memory & Context Cost Audit V1 — real-turn probes.
 * Identity: CURRENT_OPENSCREEN_VIDEO_MEMORY_CONTEXT_AUDIT_V1
 *
 * Measurement only. Does NOT switch production cognition to Video Memory retrieval.
 * Does NOT overwrite baseline / Recovery 1–4 / post-recovery artifacts.
 *
 * Run:
 *   npx vitest --run electron/ai-edition/perceptionBenchmark/videoMemoryContextAudit/video-memory-context-audit.runtime.test.ts
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../../src/lib/ai-edition/schema";
import { readCursorSidecar } from "../../../media/cursorSidecar";
import { _resetSttManagerForTests, shutdownStt } from "../../../stt/index";
import { CONTEXT_TELEMETRY_V1_ID, estimateTokensFromChars } from "../../contextTelemetry";
import { invokeOpenScreenAgent, type OpenScreenAgentSink } from "../../deep-agent/service";
import { VIDEO_MEMORY_V1_PROVIDER_ID } from "../../videoMemory";
import { REAL_CORPUS_CASES } from "../realCorpusBaseline/cases";
import { loadOpenAiKey } from "../runCurrentStack";

const IDENTITY = "CURRENT_OPENSCREEN_VIDEO_MEMORY_CONTEXT_AUDIT_V1";
const OUT = path.join(process.cwd(), "tmp/perception-benchmark/video-memory-context-audit-v1");

type ProbeId =
	| "A"
	| "B"
	| "C"
	| "D"
	| "E"
	| "F1"
	| "F2"
	| "FU1"
	| "FU2"
	| "FU3"
	| "FU4"
	| "INV_RESTART"
	| "INV_UPWORK";

interface Probe {
	id: ProbeId;
	title: string;
	mediaPath: string;
	prompt: string;
	history?: Array<{ role: "user" | "assistant"; content: string }>;
	mustNotClaim?: string[];
}

function corpus(id: string) {
	return REAL_CORPUS_CASES.find((c) => c.caseId === id);
}

function resolveProbes(): Probe[] {
	const c001 = corpus("case-001");
	const c002 = corpus("case-002");
	const c004 = corpus("case-004");
	const c005 = corpus("case-005");
	const mediaShort = c001?.mediaPath ?? "";
	const mediaCase2 = c002?.mediaPath ?? mediaShort;
	const mediaSettings = c004?.mediaPath ?? mediaShort;
	const mediaUpwork = c005?.mediaPath ?? mediaShort;

	return [
		{
			id: "A",
			title: "Transcript question",
			mediaPath: mediaShort,
			prompt: "What did I say near the end?",
		},
		{
			id: "B",
			title: "Visual understanding",
			mediaPath: mediaShort,
			prompt: "What is visibly happening in this recording?",
		},
		{
			id: "C",
			title: "Cross-modal understanding",
			mediaPath: mediaShort,
			prompt: "Compare what I am saying with what is happening on screen.",
		},
		{
			id: "D",
			title: "Editorial reasoning",
			mediaPath: mediaShort,
			prompt: "Make this shorter and clearer while keeping the important explanation.",
		},
		{
			id: "E",
			title: "Professional improvement",
			mediaPath: mediaShort,
			prompt:
				"Make this video feel more professional. Only suggest changes supported by the recording.",
		},
		{
			id: "F1",
			title: "Initial turn (same video)",
			mediaPath: mediaShort,
			prompt: "Understand this recording and tell me what you would improve.",
		},
		{
			id: "F2",
			title: "Follow-up on SAME video",
			mediaPath: mediaShort,
			prompt: "What else would you improve?",
			history: [
				{
					role: "user",
					content: "Understand this recording and tell me what you would improve.",
				},
				{
					role: "assistant",
					content:
						"(prior turn) I reviewed the recording and noted pacing, temporary UI, and clarity opportunities.",
				},
			],
		},
		{
			id: "FU1",
			title: "Follow-up series T1",
			mediaPath: mediaShort,
			prompt: "Understand this recording and tell me what you would improve.",
		},
		{
			id: "FU2",
			title: "Follow-up series T2",
			mediaPath: mediaShort,
			prompt: "Make it shorter but keep the important explanation.",
			history: [
				{ role: "user", content: "Understand this recording and tell me what you would improve." },
				{ role: "assistant", content: "Prior understanding noted." },
			],
		},
		{
			id: "FU3",
			title: "Follow-up series T3",
			mediaPath: mediaShort,
			prompt: "What else is distracting?",
			history: [
				{ role: "user", content: "Understand this recording and tell me what you would improve." },
				{ role: "assistant", content: "Prior understanding noted." },
				{ role: "user", content: "Make it shorter but keep the important explanation." },
				{ role: "assistant", content: "Prior shorten advice noted." },
			],
		},
		{
			id: "FU4",
			title: "Follow-up series T4 action verify",
			mediaPath: mediaSettings,
			prompt: "Did I actually open the panel I mentioned?",
			mustNotClaim: ["opened Settings", "Settings panel opened"],
		},
		{
			id: "INV_RESTART",
			title: "Case2 Restart invariant",
			mediaPath: mediaCase2,
			prompt: "What temporary UI appears near the end? Did I restart the recording?",
			mustNotClaim: ["restarted recording", "I restarted", "user restarted"],
		},
		{
			id: "INV_UPWORK",
			title: "Upwork passive chrome invariant",
			mediaPath: mediaUpwork,
			prompt:
				"If you see browser tabs or app names like Upwork, did I actually open or work in that app?",
			mustNotClaim: ["opened Upwork", "worked on Upwork"],
		},
	];
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

function buildDoc(mediaPath: string) {
	const base = createEmptyDocument({
		title: "video-memory-audit",
		projectId: `vm_audit_${path.basename(mediaPath, path.extname(mediaPath)).slice(0, 40)}`,
	});
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

type ProbeResult = {
	id: string;
	title: string;
	mediaPath: string;
	prompt: string;
	status: string;
	skipped?: string;
	contextTelemetry?: unknown;
	videoMemory?: unknown;
	abComparison?: {
		currentUserMessageTextChars: number;
		currentEstimatedImageTokens: number;
		retrievalBriefingChars: number;
		retrievalEstimatedTokens: number;
		attachVisualFramesSuggested: boolean;
		note: string;
	};
	responsePreview?: string;
	invariantOk?: boolean;
	invariantHits?: string[];
};

const results: ProbeResult[] = [];

describe("Video Memory Context Audit V1 (runtime)", () => {
	afterAll(async () => {
		mkdirSync(OUT, { recursive: true });
		writeFileSync(path.join(OUT, "probes.json"), JSON.stringify(results, null, 2));
		const summary = {
			identity: IDENTITY,
			telemetryIdentity: CONTEXT_TELEMETRY_V1_ID,
			videoMemoryIdentity: VIDEO_MEMORY_V1_PROVIDER_ID,
			probeCount: results.length,
			completed: results.filter((r) => r.status === "completed").length,
			skipped: results.filter((r) => r.skipped).length,
			results: results.map((r) => ({
				id: r.id,
				title: r.title,
				status: r.status,
				skipped: r.skipped,
				providerUsage: (r.contextTelemetry as { providerUsage?: unknown } | undefined)
					?.providerUsage,
				images: (r.contextTelemetry as { images?: unknown } | undefined)?.images,
				estimatedCostUsd: (r.contextTelemetry as { estimatedCostUsd?: unknown } | undefined)
					?.estimatedCostUsd,
				latency: (r.contextTelemetry as { latency?: unknown } | undefined)?.latency,
				components: (r.contextTelemetry as { components?: unknown } | undefined)?.components,
				abComparison: r.abComparison,
				invariantOk: r.invariantOk,
			})),
		};
		writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
		await shutdownStt().catch(() => {});
		_resetSttManagerForTests();
	});

	const key = loadOpenAiKey();
	const allProbes = resolveProbes();
	const quick = process.env.OPENSCREEN_VM_AUDIT_QUICK !== "0";
	const uniqueProbes = quick
		? allProbes.filter((p) =>
				["A", "B", "D", "E", "F1", "F2", "FU4", "INV_RESTART", "INV_UPWORK"].includes(p.id),
			)
		: allProbes;

	it("writes artifact directory and runs available real probes", async () => {
		mkdirSync(OUT, { recursive: true });
		expect(existsSync(OUT)).toBe(true);

		if (!key) {
			results.push({
				id: "setup",
				title: "API key",
				mediaPath: "",
				prompt: "",
				status: "skipped",
				skipped: "OPENAI_API_KEY / stored key not available — unit foundation still valid",
			});
			expect(true).toBe(true);
			return;
		}

		for (const probe of uniqueProbes) {
			if (!probe.mediaPath || !existsSync(probe.mediaPath)) {
				results.push({
					id: probe.id,
					title: probe.title,
					mediaPath: probe.mediaPath,
					prompt: probe.prompt,
					status: "skipped",
					skipped: "media missing",
				});
				continue;
			}

			const document = buildDoc(probe.mediaPath);
			const history = (probe.history ?? []).map((h) => ({
				role: h.role as "user" | "assistant",
				content: h.content,
			}));

			const result = await invokeOpenScreenAgent({
				model: {
					provider: "openai",
					model: "gpt-4o",
					apiKey: key,
					baseUrl: "https://api.openai.com/v1",
				},
				document,
				history,
				userMessage: probe.prompt,
				sink: quietSink(),
				editsAllowed: true,
				speechCacheDir: path.join(OUT, "speech-cache", probe.id),
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
			});

			const ct = result.contextTelemetry;
			const vm = result.videoMemoryV1;
			const retrievalChars = ct?.components?.videoMemoryRetrieval?.chars ?? 0;
			const ab = {
				currentUserMessageTextChars: ct?.components?.userMessageMultimodalText?.chars ?? 0,
				currentEstimatedImageTokens: ct?.images?.estimatedImageTokens ?? 0,
				retrievalBriefingChars: retrievalChars,
				retrievalEstimatedTokens: estimateTokensFromChars(retrievalChars),
				attachVisualFramesSuggested: false,
				note: "A/B is diagnostic only: retrieval briefing is NOT substituted into the live provider prompt this milestone",
			};

			const text = result.text || "";
			const hits =
				probe.mustNotClaim?.filter((p) =>
					new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text),
				) ?? [];

			results.push({
				id: probe.id,
				title: probe.title,
				mediaPath: probe.mediaPath,
				prompt: probe.prompt,
				status: String(result.status ?? "unknown"),
				contextTelemetry: ct,
				videoMemory: vm
					? {
							providerId: vm.providerId,
							sourceFingerprint: vm.sourceFingerprint.slice(0, 16),
							programmeFingerprint: vm.programmeFingerprint.slice(0, 16),
							speechWindows: vm.speechWindows.length,
							ledgerEventCount: vm.ledgerEventCount,
						}
					: undefined,
				abComparison: ab,
				responsePreview: text.slice(0, 600),
				invariantOk: probe.mustNotClaim ? hits.length === 0 : undefined,
				invariantHits: hits,
			});

			writeFileSync(
				path.join(OUT, `probe-${probe.id}.json`),
				JSON.stringify(results[results.length - 1], null, 2),
			);

			expect(ct?.identity).toBe(CONTEXT_TELEMETRY_V1_ID);
			if (ct?.components?.videoMemoryRetrieval) {
				expect(ct.components.videoMemoryRetrieval.notes).toMatch(/NOT substituted/);
			}
		}

		expect(results.length).toBeGreaterThan(0);
	}, 1_800_000);
});
