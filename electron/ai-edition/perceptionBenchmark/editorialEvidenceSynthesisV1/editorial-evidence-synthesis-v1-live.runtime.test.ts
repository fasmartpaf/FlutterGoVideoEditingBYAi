/**
 * Editorial Evidence Synthesis V1 — paid smoke ≤2 (only after offlinePass).
 *
 * Run:
 *   npx vitest --run electron/ai-edition/perceptionBenchmark/editorialEvidenceSynthesisV1/editorial-evidence-synthesis-v1-live.runtime.test.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
import { REASONING_PACKET_MARKER } from "../../reasoningPacket";
import {
	_resetVideoMemorySessionStoreForTests,
	createVideoMemorySessionStore,
} from "../../videoMemory/sessionStore";
import { REAL_CORPUS_CASES } from "../realCorpusBaseline/cases";
import { loadOpenAiKey } from "../runCurrentStack";

const OUT =
	process.env.OPENSCREEN_EES_V1_OUT?.trim() ||
	path.join(process.cwd(), "tmp/perception-benchmark/editorial-evidence-synthesis-v1");
const PROVIDER = "openai";
const MODEL = "gpt-4o";
const BASE_URL = "https://api.openai.com/v1";
const PRICE_IN = 2.5;
const PRICE_OUT = 10;
const PRICE_CACHED = 1.25;

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
	const base = createEmptyDocument({ title: "ees-v1", projectId });
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
function estCost(inTok: number | null, cached: number | null, outTok: number | null) {
	if (typeof inTok !== "number" || typeof outTok !== "number") return null;
	const c = typeof cached === "number" ? cached : 0;
	return (
		(Math.max(0, inTok - c) / 1e6) * PRICE_IN +
		(c / 1e6) * PRICE_CACHED +
		(outTok / 1e6) * PRICE_OUT
	);
}

const matrix: Record<string, unknown>[] = [];
let paidCalls = 0;

describe("Editorial Evidence Synthesis V1 — live", () => {
	afterAll(async () => {
		writeJson("live-matrix.json", matrix);
		await shutdownStt().catch(() => {});
		_resetSttManagerForTests();
	});

	const apiKey = loadOpenAiKey();

	it("≤2 paid calls after offlinePass", async () => {
		mkdirSync(OUT, { recursive: true });
		const gatePath = path.join(OUT, "offline-gate.json");
		if (!existsSync(gatePath)) {
			writeJson("paid-smoke-status.json", { status: "NOT_RUN", reason: "offline_gate_missing" });
			expect(true).toBe(true);
			return;
		}
		const gate = JSON.parse(readFileSync(gatePath, "utf8")) as { offlinePass?: boolean };
		if (!gate.offlinePass) {
			writeJson("paid-smoke-status.json", { status: "NOT_RUN", reason: "offline_failed" });
			expect(true).toBe(true);
			return;
		}
		if (!apiKey) {
			writeJson("paid-smoke-status.json", { status: "BLOCKED", reason: "no_api_key" });
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
		if (!health.simpleRequestOk || health.quotaBlocked) {
			writeJson("paid-smoke-status.json", { status: "BLOCKED", health });
			expect(health.simpleRequestOk || health.quotaBlocked).toBe(true);
			return;
		}

		const case2 = corpus("case-002");
		const case020 = corpus("case-020");
		const media2 = case2?.mediaPath ?? "";
		const media20 = case020?.mediaPath ?? "";
		if (!existsSync(media2) || !existsSync(media20)) {
			writeJson("paid-smoke-status.json", { status: "BLOCKED", reason: "media_missing" });
			expect(true).toBe(true);
			return;
		}

		const calls = [
			{
				id: "professional",
				label: "case2_professional",
				media: media2,
				durationSec: 25,
				prompt:
					"What could genuinely be improved to make this recording feel more professional? Only recommend changes supported by this recording.",
			},
			{
				id: "case020-zoom",
				label: "case020_zoom",
				media: media20,
				durationSec: 30,
				prompt:
					"Where would a zoom actually help in this recording, and where would it not help? Only recommend a zoom when there is a specific visible focal target.",
			},
		] as const;

		for (const call of calls) {
			if (paidCalls >= 2) {
				matrix.push({ id: call.id, status: "skipped", reason: "max_2" });
				continue;
			}
			_resetVideoMemorySessionStoreForTests();
			const session = createVideoMemorySessionStore();
			const t0 = Date.now();
			const result = await invokeOpenScreenAgent({
				model: { provider: PROVIDER, model: MODEL, apiKey, baseUrl: BASE_URL },
				document: buildDoc(call.media, call.id, call.durationSec),
				history: [],
				userMessage: call.prompt,
				sink: quietSink(),
				editsAllowed: true,
				contextPacking: "BOUNDED_REASONING_V1",
				videoMemorySessionStore: session,
				videoMemoryDocumentId: call.id,
				speechCacheDir: path.join(OUT, "speech-live", call.id),
				cursor: cursorFor(call.media),
				maxProviderModelCalls: 1,
			});
			const latencyMs = Date.now() - t0;
			const ct = result.contextTelemetry;
			const bd = result.boundedDiagnostics;
			const modelCalls = ct?.providerUsage.modelCalls ?? 0;
			paidCalls += typeof modelCalls === "number" ? modelCalls : 0;

			const packet = bd?.packet ?? null;
			const providerBoundText = bd?.providerBoundUserTextPreview ?? "";
			const inTok =
				typeof ct?.providerUsage.inputTokens === "number" ? ct.providerUsage.inputTokens : null;
			const outTok =
				typeof ct?.providerUsage.outputTokens === "number" ? ct.providerUsage.outputTokens : null;
			const cached =
				typeof ct?.providerUsage.cachedInputTokens === "number"
					? ct.providerUsage.cachedInputTokens
					: null;

			writeJson(`${call.id}/packet.json`, packet);
			writeJson(`${call.id}/findings.json`, {
				coverage: packet?.editorialFindingCoverage ?? null,
				findings: packet?.editorialFindings ?? [],
				focal: packet?.focalTargetCandidates ?? [],
			});
			writeJson(`${call.id}/provider-bound-message.json`, {
				marker: REASONING_PACKET_MARKER,
				packetDelivered: bd?.packetDelivered === true,
				containsMarker: providerBoundText.includes(REASONING_PACKET_MARKER),
				inputTokens: inTok,
				textPreview: providerBoundText.slice(0, 3500),
			});
			writeJson(`${call.id}/provider-usage.json`, {
				inputTokens: inTok,
				cachedInputTokens: cached,
				outputTokens: outTok,
				images: ct?.images.imageCount ?? null,
				modelCalls,
				toolCount: bd?.toolNames?.length ?? 0,
				latencyMs,
				estimatedCostUsd: estCost(inTok, cached, outTok),
				status: result.status,
				reason: result.reason ?? null,
			});
			writeText(`${call.id}/final-response.txt`, result.text || "");
			writeJson(`${call.id}/validation.json`, {
				status: "PENDING_MANUAL",
				decisionKind: packet?.decisionKind ?? null,
				selfContained: packet?.selfContainment?.selfContained ?? null,
				improve: packet?.editorialFindingCoverage?.improveCandidateCount ?? 0,
				preserve: packet?.editorialFindingCoverage?.preserveCount ?? 0,
				tools: bd?.toolNames?.length ?? 0,
				modelCalls,
				hasEditorialSidecar: /EDITORIAL_DECISIONS/i.test(result.text || ""),
				hasFocalSidecar: /FOCAL_TARGET_DECISIONS/i.test(result.text || ""),
			});
			writeJson(`${call.id}/quality-review.json`, { status: "PENDING_MANUAL" });

			matrix.push({
				id: call.id,
				status: result.status,
				inputTokens: inTok,
				outputTokens: outTok,
				images: ct?.images.imageCount ?? null,
				modelCalls,
				toolCount: bd?.toolNames?.length ?? 0,
				decisionKind: packet?.decisionKind ?? null,
				coverage: packet?.editorialFindingCoverage?.status ?? null,
				improve: packet?.editorialFindingCoverage?.improveCandidateCount ?? 0,
				preserve: packet?.editorialFindingCoverage?.preserveCount ?? 0,
				focal: packet?.focalTargetCandidates?.length ?? 0,
				finalPreview: (result.text || "").slice(0, 500),
				estimatedCostUsd: estCost(inTok, cached, outTok),
				latencyMs,
			});
		}

		writeJson("live-cost-summary.json", { paidCalls, rows: matrix });
		writeJson("paid-smoke-status.json", { status: "RAN", paidCalls });
		expect(paidCalls).toBeLessThanOrEqual(2);
	}, 500_000);
});
