/**
 * Bounded Reasoning Reliability V2 — paid smoke ≤6 model invocations.
 * Only run after offline matrix passes.
 *
 * Run:
 *   npx vitest --run electron/ai-edition/perceptionBenchmark/boundedReasoningReliabilityV2/bounded-reasoning-reliability-v2-live.runtime.test.ts
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../../src/lib/ai-edition/schema";
import { readCursorSidecar } from "../../../media/cursorSidecar";
import { _resetSttManagerForTests, shutdownStt } from "../../../stt/index";
import { isMutatingTool } from "../../agent-tools";
import { probeConfiguredProviderHealth } from "../../deep-agent/providerHealth";
import { invokeOpenScreenAgent, type OpenScreenAgentSink } from "../../deep-agent/service";
import { classifyMediaContextNeeds } from "../../mediaContextNeeds";
import { BOUNDED_REASONING_V1_ID } from "../../videoMemory/productionPath";
import {
	_resetVideoMemorySessionStoreForTests,
	createVideoMemorySessionStore,
} from "../../videoMemory/sessionStore";
import { REAL_CORPUS_CASES } from "../realCorpusBaseline/cases";
import { loadOpenAiKey } from "../runCurrentStack";

const OUT =
	process.env.OPENSCREEN_BOUNDED_RELIABILITY_V2_OUT?.trim() ||
	path.join(process.cwd(), "tmp/perception-benchmark/bounded-reasoning-reliability-v2");
const PROVIDER = "openai";
const MODEL = "gpt-4o";
const BASE_URL = "https://api.openai.com/v1";
const PRICE_IN = 2.5;
const PRICE_OUT = 10;
const PRICE_CACHED = 1.25;
const GLOBAL_MAX_MODEL_CALLS = 6;

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

function buildDoc(mediaPath: string, projectId: string, durationSec: number): AxcutDocument {
	const base = createEmptyDocument({ title: "bounded-rel-v2", projectId });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				label: "smoke",
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

function estCost(
	inTok: number | null,
	cached: number | null,
	outTok: number | null,
): number | null {
	if (typeof inTok !== "number" || typeof outTok !== "number") return null;
	const c = typeof cached === "number" ? cached : 0;
	const billableIn = Math.max(0, inTok - c);
	return (billableIn / 1e6) * PRICE_IN + (c / 1e6) * PRICE_CACHED + (outTok / 1e6) * PRICE_OUT;
}

function writeJson(rel: string, data: unknown) {
	const full = path.join(OUT, rel);
	mkdirSync(path.dirname(full), { recursive: true });
	writeFileSync(full, JSON.stringify(data, null, 2));
}

function writeText(rel: string, text: string) {
	const full = path.join(OUT, rel);
	mkdirSync(path.dirname(full), { recursive: true });
	writeFileSync(full, text);
}

const matrixRows: Record<string, unknown>[] = [];
let paidModelCalls = 0;
let abortRemaining = false;
let abortReason: string | null = null;

describe("Bounded Reasoning Reliability V2 — live smoke", () => {
	afterAll(async () => {
		writeJson("live-matrix.json", matrixRows);
		writeJson("live-failure-summary.json", {
			identity: BOUNDED_REASONING_V1_ID,
			paidModelCalls,
			abortRemaining,
			abortReason,
			rows: matrixRows,
		});
		await shutdownStt().catch(() => {});
		_resetSttManagerForTests();
	});

	const apiKey = loadOpenAiKey();

	it("health + ≤6 model calls (1 per case)", async () => {
		mkdirSync(OUT, { recursive: true });
		if (!apiKey) {
			writeJson("provider-health.json", { credentialsPresent: false });
			expect(true).toBe(true);
			return;
		}

		const health = await probeConfiguredProviderHealth({
			provider: PROVIDER,
			model: MODEL,
			apiKey,
			baseUrl: BASE_URL,
		});
		writeJson("provider-health.json", health);
		if (health.quotaBlocked || !health.simpleRequestOk) {
			abortRemaining = true;
			abortReason = health.quotaBlocked ? "BLOCKED_PROVIDER" : health.summary;
			matrixRows.push({ id: "ABORT", reason: abortReason });
			expect(health.simpleRequestOk || health.quotaBlocked).toBe(true);
			return;
		}

		const narrated = corpus("case-001")?.mediaPath ?? "";
		const case4 = corpus("case-003")?.mediaPath ?? "";
		const settings = corpus("case-004")?.mediaPath ?? "";
		const c020 = (corpus("case-020") ?? corpus("case-009"))?.mediaPath ?? "";
		for (const p of [narrated, case4, settings, c020]) {
			if (!p || !existsSync(p)) {
				matrixRows.push({ id: "setup", status: "skipped", reason: "missing_media" });
				expect(true).toBe(true);
				return;
			}
		}

		const calls = [
			{
				id: "call-1-speech",
				media: narrated,
				dur: 17,
				cache: "narrated",
				prompt: "What did I say near the end?",
			},
			{
				id: "call-2-cross-modal",
				media: narrated,
				dur: 17,
				cache: "narrated",
				prompt:
					"Compare what I say with what is visibly happening on screen. Tell me what matches, what differs, and what you cannot verify.",
			},
			{
				id: "call-3-case4",
				media: case4,
				dur: 17,
				cache: "case4",
				prompt:
					"Watch and listen carefully. Explain what I first say I will do, how I correct myself, and what you can actually verify happened on screen.",
			},
			{
				id: "call-4-case020-zoom",
				media: c020,
				dur: 22,
				cache: "c020",
				prompt:
					"Where would a zoom actually help in this recording, and where would it not help? Only recommend a zoom when there is a specific visible focal target.",
			},
			{
				id: "call-5-professional",
				media: narrated,
				dur: 17,
				cache: "narrated",
				prompt:
					"What could genuinely be improved to make this recording feel more professional? Only recommend changes that are supported by what is actually in this recording.",
			},
			{
				id: "call-6-settings",
				media: settings,
				dur: 30,
				cache: "settings",
				prompt:
					"Did I actually open Settings in this recording? Explain what you can verify and what you cannot.",
			},
		] as const;

		for (const call of calls) {
			if (abortRemaining || paidModelCalls >= GLOBAL_MAX_MODEL_CALLS) {
				matrixRows.push({
					id: call.id,
					status: "skipped",
					reason: abortReason ?? "max_model_calls",
				});
				continue;
			}

			_resetVideoMemorySessionStoreForTests();
			const session = createVideoMemorySessionStore();
			const needs = classifyMediaContextNeeds(call.prompt);
			const t0 = Date.now();
			const result = await invokeOpenScreenAgent({
				model: { provider: PROVIDER, model: MODEL, apiKey, baseUrl: BASE_URL },
				document: buildDoc(call.media, call.id, call.dur),
				history: [],
				userMessage: call.prompt,
				sink: quietSink(),
				editsAllowed: true,
				contextPacking: "BOUNDED_REASONING_V1",
				videoMemorySessionStore: session,
				videoMemoryDocumentId: call.id,
				speechCacheDir: path.join(OUT, "speech-live", call.cache),
				cursor: cursorFor(call.media),
				maxProviderModelCalls: 1,
			});
			const latencyMs = Date.now() - t0;
			const ct = result.contextTelemetry;
			const bd = result.boundedDiagnostics;
			const rp = result.retrievalPath;
			const modelCalls = ct?.providerUsage.modelCalls ?? 0;
			paidModelCalls += typeof modelCalls === "number" ? modelCalls : 0;
			const toolLoopPrevented =
				result.reason?.includes("model_call_budget_exceeded") === true ||
				(typeof modelCalls === "number" && modelCalls <= 1 && (ct?.toolLoopCount ?? 0) === 0);

			if (
				result.status === "provider_error" &&
				(result.failureReason === "provider_quota_exhausted" ||
					result.failureReason === "provider_rate_limited" ||
					result.failureReason === "provider_payload_too_large")
			) {
				abortRemaining = true;
				abortReason = String(result.failureReason);
			}

			const inTok =
				typeof ct?.providerUsage.inputTokens === "number" ? ct.providerUsage.inputTokens : null;
			const outTok =
				typeof ct?.providerUsage.outputTokens === "number" ? ct.providerUsage.outputTokens : null;
			const cached =
				typeof ct?.providerUsage.cachedInputTokens === "number"
					? ct.providerUsage.cachedInputTokens
					: null;

			const toolNames = bd?.toolNames ?? rp?.toolNames ?? [];
			const mutating = toolNames.filter((n) => isMutatingTool(n)).length;
			const packet = bd?.packet ?? null;

			writeJson(`${call.id}/packet.json`, packet);
			writeText(
				`${call.id}/packet-summary.txt`,
				packet
					? [
							`phase=${packet.phase}`,
							`sufficient=${packet.sufficiency.packetEvidenceSufficient}`,
							`missing=${packet.sufficiency.missingEvidenceKinds.join(",") || "none"}`,
							`speechState=${packet.sufficiency.speechMediaState}`,
							`required=speech:${packet.requiredModalities.speech},visual:${packet.requiredModalities.visual}`,
							`spoken=${packet.spoken.length}`,
							`crossModal=${packet.crossModalRelations.length}`,
							`focal=${packet.focalTargetCandidates.length}`,
							`correction=${packet.correctionScaffold.present}`,
							`tools=${toolNames.length}`,
							"",
							bd?.packetSerializedText?.slice(0, 10000) ?? "",
						].join("\n")
					: "PACKET_MISSING\n",
			);
			writeJson(`${call.id}/provider-usage.json`, {
				inputTokens: inTok,
				cachedInputTokens: cached,
				outputTokens: outTok,
				images: ct?.images.imageCount ?? null,
				modelCalls,
				toolLoopCount: ct?.toolLoopCount ?? 0,
				toolLoopPrevented,
				latencyMs,
				estimatedCostUsd: estCost(inTok, cached, outTok),
				status: result.status,
				failureReason: result.failureReason ?? null,
				reason: result.reason ?? null,
				needs,
			});
			writeText(`${call.id}/final-response.txt`, result.text || "");
			writeJson(`${call.id}/claim-audit.json`, { status: "PENDING_MANUAL" });
			writeJson(`${call.id}/quality-review.json`, { status: "PENDING_MANUAL" });

			matrixRows.push({
				id: call.id,
				status: result.status,
				failureReason: result.failureReason ?? null,
				phase: bd?.phase ?? rp?.cognitionPhase ?? null,
				inputTokens: inTok,
				outputTokens: outTok,
				images: ct?.images.imageCount ?? null,
				modelCalls,
				toolLoopCount: ct?.toolLoopCount ?? 0,
				toolCount: toolNames.length,
				mutatingToolCount: mutating,
				toolLoopPrevented,
				packetSufficient: packet?.sufficiency.packetEvidenceSufficient ?? null,
				speechMediaState: packet?.sufficiency.speechMediaState ?? null,
				spokenCount: packet?.spoken.length ?? 0,
				crossModalRelations: packet?.crossModalRelations.length ?? 0,
				focalTargets: packet?.focalTargetCandidates.length ?? 0,
				correctionPresent: packet?.correctionScaffold.present ?? false,
				estimatedCostUsd: estCost(inTok, cached, outTok),
				latencyMs,
				finalTextPreview: (result.text || "").slice(0, 500),
			});
		}

		writeJson("live-cost-summary.json", {
			pricing: { PRICE_IN, PRICE_CACHED, PRICE_OUT, model: MODEL },
			paidModelCalls,
			completed: matrixRows.filter((r) => r.status === "completed"),
			averageCostUsd: (() => {
				const costs = matrixRows
					.map((r) => r.estimatedCostUsd)
					.filter((c): c is number => typeof c === "number");
				return costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
			})(),
		});

		expect(paidModelCalls).toBeLessThanOrEqual(GLOBAL_MAX_MODEL_CALLS);
		expect(
			matrixRows.filter((r) => r.mutatingToolCount != null).every((r) => r.mutatingToolCount === 0),
		).toBe(true);
	}, 700_000);
});
