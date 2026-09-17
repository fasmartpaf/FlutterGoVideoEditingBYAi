/**
 * Bounded Reasoning Quality Closure V3 — paid smoke ≤3 model calls.
 *
 * Run:
 *   npx vitest --run electron/ai-edition/perceptionBenchmark/boundedReasoningQualityClosureV3/bounded-reasoning-quality-closure-v3-live.runtime.test.ts
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
	process.env.OPENSCREEN_BOUNDED_QCV3_OUT?.trim() ||
	path.join(process.cwd(), "tmp/perception-benchmark/bounded-reasoning-quality-closure-v3");
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
	const base = createEmptyDocument({ title: "bounded-qcv3", projectId });
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

describe("Bounded Reasoning Quality Closure V3 — live", () => {
	afterAll(async () => {
		writeJson("live-matrix.json", matrix);
		await shutdownStt().catch(() => {});
		_resetSttManagerForTests();
	});

	const apiKey = loadOpenAiKey();

	it("≤3 paid calls: speech, cross-modal, professional", async () => {
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
		if (!health.simpleRequestOk || health.quotaBlocked) {
			matrix.push({ id: "ABORT", health });
			expect(health.simpleRequestOk || health.quotaBlocked).toBe(true);
			return;
		}

		const narrated = corpus("case-001")?.mediaPath ?? "";
		if (!narrated || !existsSync(narrated)) {
			matrix.push({ id: "no_media" });
			expect(true).toBe(true);
			return;
		}

		const calls = [
			{
				id: "call-1",
				label: "speech",
				prompt: "What did I say near the end?",
			},
			{
				id: "call-2",
				label: "cross_modal",
				prompt:
					"Compare what I say with what is visibly happening. Tell me what matches, what differs, and what cannot be verified.",
			},
			{
				id: "call-3",
				label: "professional",
				prompt:
					"What could genuinely be improved to make this recording feel more professional? Only recommend changes that are supported by what is actually in this recording.",
			},
		] as const;

		for (const call of calls) {
			if (paidCalls >= 3) {
				matrix.push({ id: call.id, status: "skipped", reason: "max_3" });
				continue;
			}
			_resetVideoMemorySessionStoreForTests();
			const session = createVideoMemorySessionStore();
			const t0 = Date.now();
			const result = await invokeOpenScreenAgent({
				model: { provider: PROVIDER, model: MODEL, apiKey, baseUrl: BASE_URL },
				document: buildDoc(narrated, call.id, 17),
				history: [],
				userMessage: call.prompt,
				sink: quietSink(),
				editsAllowed: true,
				contextPacking: "BOUNDED_REASONING_V1",
				videoMemorySessionStore: session,
				videoMemoryDocumentId: call.id,
				speechCacheDir: path.join(OUT, "speech-live", "narrated"),
				cursor: cursorFor(narrated),
				maxProviderModelCalls: 1,
			});
			const latencyMs = Date.now() - t0;
			const ct = result.contextTelemetry;
			const bd = result.boundedDiagnostics;
			const modelCalls = ct?.providerUsage.modelCalls ?? 0;
			paidCalls += typeof modelCalls === "number" ? modelCalls : 0;

			const packet = bd?.packet ?? null;
			const providerBoundText = bd?.providerBoundUserTextPreview ?? "";
			const deliveryOk = bd?.packetDelivered === true;
			const inTok =
				typeof ct?.providerUsage.inputTokens === "number" ? ct.providerUsage.inputTokens : null;
			const outTok =
				typeof ct?.providerUsage.outputTokens === "number" ? ct.providerUsage.outputTokens : null;
			const cached =
				typeof ct?.providerUsage.cachedInputTokens === "number"
					? ct.providerUsage.cachedInputTokens
					: null;

			writeJson(`${call.id}/packet.json`, packet);
			writeJson(`${call.id}/provider-bound-message.json`, {
				marker: REASONING_PACKET_MARKER,
				packetDelivered: deliveryOk,
				packetChars: bd?.packetChars ?? null,
				inputTokens: inTok,
				textPreview: providerBoundText.slice(0, 4000),
				containsMarker: providerBoundText.includes(REASONING_PACKET_MARKER),
				containsSelectedSpeech: /SELECTED_SPEECH|SPOKEN:/i.test(providerBoundText),
			});
			writeJson(`${call.id}/provider-usage.json`, {
				inputTokens: inTok,
				cachedInputTokens: cached,
				outputTokens: outTok,
				images: ct?.images.imageCount ?? null,
				modelCalls,
				toolLoopCount: ct?.toolLoopCount ?? 0,
				toolCount: bd?.toolNames?.length ?? 0,
				latencyMs,
				estimatedCostUsd: estCost(inTok, cached, outTok),
				status: result.status,
				failureReason: result.failureReason ?? null,
				reason: result.reason ?? null,
			});
			writeText(`${call.id}/final-response.txt`, result.text || "");
			writeJson(`${call.id}/validation.json`, {
				status: "PENDING_MANUAL_PLUS_RUNTIME",
				packetSufficient: packet?.sufficiency.packetEvidenceSufficient ?? null,
				selfContained: packet?.selfContainment?.selfContained ?? null,
				crossModalRelations: packet?.crossModalRelations?.length ?? 0,
				editorialFindings: packet?.editorialFindings?.length ?? 0,
				focalTargets: packet?.focalTargetCandidates?.length ?? 0,
				tools: bd?.toolNames?.length ?? 0,
				modelCalls,
				packetDelivered: deliveryOk,
				containsMarker: providerBoundText.includes(REASONING_PACKET_MARKER),
			});
			writeJson(`${call.id}/quality-review.json`, { status: "PENDING_MANUAL" });

			matrix.push({
				id: call.id,
				label: call.label,
				status: result.status,
				inputTokens: inTok,
				outputTokens: outTok,
				images: ct?.images.imageCount ?? null,
				modelCalls,
				toolCount: bd?.toolNames?.length ?? 0,
				packetChars: bd?.packetChars ?? null,
				packetDelivered: deliveryOk,
				deliveryInvariant: result.reason?.includes("bounded_packet_delivery")
					? "FAILED_BLOCKED"
					: deliveryOk
						? "OK"
						: "UNKNOWN",
				speechState: packet?.sufficiency.speechMediaState ?? null,
				spoken: packet?.spoken?.length ?? 0,
				finalPreview: (result.text || "").slice(0, 400),
				estimatedCostUsd: estCost(inTok, cached, outTok),
				latencyMs,
			});
		}

		writeJson("live-cost-summary.json", {
			paidCalls,
			pricing: { PRICE_IN, PRICE_CACHED, PRICE_OUT, model: MODEL },
			rows: matrix,
		});
		expect(paidCalls).toBeLessThanOrEqual(3);
	}, 500_000);
});
