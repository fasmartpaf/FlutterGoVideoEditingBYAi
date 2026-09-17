/**
 * Bounded Reasoning Live Quality Smoke V1 — ≤6 paid generation calls.
 * Identity: CURRENT_OPENSCREEN_BOUNDED_REASONING_V1
 *
 * Real media → STT → visual → Ledger → Investigator → Claims → Story → packet → provider.
 * Health probe first. Hard STOP on quota / request-too-large. No FULL/RET/COMPACT matrix.
 *
 * Run:
 *   npx vitest --run electron/ai-edition/perceptionBenchmark/boundedReasoningLiveSmoke/bounded-reasoning-live-smoke.runtime.test.ts
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
import { CORE_INVARIANTS, phasePolicy, resolveCognitionPhase } from "../../reasoningPacket";
import { classifyVideoMemoryQuery } from "../../videoMemory";
import { BOUNDED_REASONING_V1_ID } from "../../videoMemory/productionPath";
import {
	_resetVideoMemorySessionStoreForTests,
	createVideoMemorySessionStore,
} from "../../videoMemory/sessionStore";
import { REAL_CORPUS_CASES } from "../realCorpusBaseline/cases";
import { loadOpenAiKey } from "../runCurrentStack";

const IDENTITY = BOUNDED_REASONING_V1_ID;
const OUT =
	process.env.OPENSCREEN_BOUNDED_LIVE_SMOKE_OUT?.trim() ||
	path.join(process.cwd(), "tmp/perception-benchmark/bounded-reasoning-live-smoke-v1");
const PROVIDER = "openai";
const MODEL = "gpt-4o";
const BASE_URL = "https://api.openai.com/v1";
/** gpt-4o list pricing used in prior audits — ESTIMATED when usage present. */
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
	const base = createEmptyDocument({ title: "bounded-live-smoke", projectId });
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

type CallSpec = {
	id: string;
	label: string;
	mediaPath: string;
	durationSec: number;
	prompt: string;
	speechCacheKey: string;
};

const matrixRows: Record<string, unknown>[] = [];
let abortRemaining = false;
let abortReason: string | null = null;
let paidGenerationCalls = 0;

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

describe("Bounded Reasoning Live Quality Smoke V1", () => {
	afterAll(async () => {
		writeJson("matrix.json", matrixRows);
		writeJson("failure-summary.json", {
			identity: IDENTITY,
			abortRemaining,
			abortReason,
			paidGenerationCalls,
			rows: matrixRows.map((r) => ({
				id: r.id,
				status: r.status,
				failureReason: r.failureReason,
				primaryFailureLayer: r.primaryFailureLayer ?? null,
			})),
		});
		await shutdownStt().catch(() => {});
		_resetSttManagerForTests();
	});

	const apiKey = loadOpenAiKey();

	it("health + ≤6 BOUNDED_REASONING_V1 paid calls on real memory", async () => {
		mkdirSync(OUT, { recursive: true });
		writeText(
			"NOTICE.md",
			`# ${IDENTITY}\nLive quality smoke — max 6 paid generation calls. Do not overwrite prior runs without renaming.\n`,
		);

		if (!apiKey) {
			writeJson("provider-health.json", { credentialsPresent: false, requestOk: false });
			matrixRows.push({ id: "setup", status: "skipped", reason: "no_api_key" });
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
		matrixRows.push({ id: "PROVIDER_HEALTH", kind: "health", ...health });

		if (health.quotaBlocked || !health.simpleRequestOk) {
			abortRemaining = true;
			abortReason = health.quotaBlocked
				? "BLOCKED_PROVIDER"
				: (health.failureReason ?? health.summary);
			matrixRows.push({ id: "ABORT", status: "blocked", reason: abortReason });
			expect(health.simpleRequestOk || health.quotaBlocked).toBe(true);
			return;
		}

		const c001 = corpus("case-001");
		const c003 = corpus("case-003");
		const c004 = corpus("case-004");
		const c020 = corpus("case-020") ?? corpus("case-009");

		const narrated = c001?.mediaPath ?? "";
		const case4 = c003?.mediaPath ?? "";
		const settings = c004?.mediaPath ?? "";
		const zoomMedia = c020?.mediaPath ?? "";

		for (const [label, p] of [
			["narrated", narrated],
			["case4", case4],
			["settings", settings],
			["case020", zoomMedia],
		] as const) {
			if (!p || !existsSync(p)) {
				matrixRows.push({
					id: "setup",
					status: "skipped",
					reason: `missing_media_${label}`,
					path: p,
				});
				expect(true).toBe(true);
				return;
			}
		}

		const calls: CallSpec[] = [
			{
				id: "call-1-speech",
				label: "SPEECH",
				mediaPath: narrated,
				durationSec: 17,
				prompt: "What did I say near the end?",
				speechCacheKey: "narrated",
			},
			{
				id: "call-2-cross-modal",
				label: "CROSS_MODAL",
				mediaPath: narrated,
				durationSec: 17,
				prompt:
					"Compare what I say with what is visibly happening on screen. Tell me what matches, what differs, and what you cannot verify.",
				speechCacheKey: "narrated",
			},
			{
				id: "call-3-case4",
				label: "CASE4_CORRECTION",
				mediaPath: case4,
				durationSec: 25,
				prompt:
					"Watch and listen carefully. Explain what I first say I will do, how I correct myself, and what you can actually verify happened on screen.",
				speechCacheKey: "case4",
			},
			{
				id: "call-4-case020-zoom",
				label: "CASE020_ZOOM",
				mediaPath: zoomMedia,
				durationSec: 22,
				prompt:
					"Where would a zoom actually help in this recording, and where would it not help? Only recommend a zoom when there is a specific visible focal target.",
				speechCacheKey: "c020",
			},
			{
				id: "call-5-professional",
				label: "PROFESSIONAL_EDITORIAL",
				mediaPath: narrated,
				durationSec: 17,
				prompt:
					"What could genuinely be improved to make this recording feel more professional? Only recommend changes that are supported by what is actually in this recording.",
				speechCacheKey: "narrated",
			},
			{
				id: "call-6-settings",
				label: "SETTINGS_NEGATIVE",
				mediaPath: settings,
				durationSec: 30,
				prompt:
					"Did I actually open Settings in this recording? Explain what you can verify and what you cannot.",
				speechCacheKey: "settings",
			},
		];

		for (const call of calls) {
			if (abortRemaining) {
				matrixRows.push({
					id: call.id,
					status: "skipped",
					reason: abortReason,
				});
				continue;
			}
			if (paidGenerationCalls >= 6) {
				matrixRows.push({ id: call.id, status: "skipped", reason: "max_paid_calls" });
				continue;
			}

			_resetVideoMemorySessionStoreForTests();
			const session = createVideoMemorySessionStore();
			const needs = classifyMediaContextNeeds(call.prompt);
			const queryClass = classifyVideoMemoryQuery(call.prompt, needs);
			const phase = resolveCognitionPhase({
				userMessage: call.prompt,
				contextNeeds: needs,
				queryClass,
			});
			const callDir = call.id;
			const t0 = Date.now();

			const result = await invokeOpenScreenAgent({
				model: {
					provider: PROVIDER,
					model: MODEL,
					apiKey,
					baseUrl: BASE_URL,
				},
				document: buildDoc(call.mediaPath, call.id, call.durationSec),
				history: [],
				userMessage: call.prompt,
				sink: quietSink(),
				editsAllowed: true,
				contextPacking: "BOUNDED_REASONING_V1",
				videoMemorySessionStore: session,
				videoMemoryDocumentId: call.id,
				speechCacheDir: path.join(OUT, "speech", call.speechCacheKey),
				cursor: cursorFor(call.mediaPath),
			});

			const latencyMs = Date.now() - t0;
			const ct = result.contextTelemetry;
			const rp = result.retrievalPath;
			const bd = result.boundedDiagnostics;
			const inTok =
				typeof ct?.providerUsage.inputTokens === "number" ? ct.providerUsage.inputTokens : null;
			const outTok =
				typeof ct?.providerUsage.outputTokens === "number" ? ct.providerUsage.outputTokens : null;
			const cached =
				typeof ct?.providerUsage.cachedInputTokens === "number"
					? ct.providerUsage.cachedInputTokens
					: null;
			const reasoningTok =
				typeof ct?.providerUsage.reasoningTokens === "number"
					? ct.providerUsage.reasoningTokens
					: null;
			const modelCalls = ct?.providerUsage.modelCalls ?? 0;
			paidGenerationCalls +=
				typeof modelCalls === "number" ? modelCalls : result.status === "completed" ? 1 : 0;

			const toolNames = bd?.toolNames ?? rp?.toolNames ?? [];
			const mutatingToolCount =
				bd?.mutatingToolCount ?? toolNames.filter((n) => isMutatingTool(n)).length;
			const phaseActual = bd?.phase ?? rp?.cognitionPhase ?? phase.phase;

			if (mutatingToolCount > 0 && (phaseActual === "UNDERSTAND" || phaseActual === "PLAN")) {
				abortRemaining = true;
				abortReason = "MUTATION_TOOL_SURFACE_FAIL";
			}

			const hardInfra =
				result.failureReason === "provider_quota_exhausted" ||
				result.failureReason === "provider_rate_limited" ||
				/request too large|tpm|tokens per min|insufficient_quota|429/i.test(
					`${result.failureReason ?? ""} ${result.reason ?? ""} ${JSON.stringify(result.providerDiagnostics ?? {})}`,
				);
			if (result.status === "provider_error" && hardInfra) {
				abortRemaining = true;
				abortReason =
					result.failureReason === "provider_quota_exhausted"
						? "BLOCKED_PROVIDER"
						: String(result.failureReason ?? "provider_infra");
			}

			const packet = bd?.packet ?? null;
			if (packet) {
				writeJson(`${callDir}/packet.json`, packet);
				writeText(
					`${callDir}/packet-summary.txt`,
					[
						`phase=${packet.phase}`,
						`queryClass=${packet.queryClass}`,
						`queryScope=${packet.queryScope}`,
						`sufficient=${packet.sufficiency.packetEvidenceSufficient}`,
						`missing=${packet.sufficiency.missingEvidenceKinds.join(",") || "none"}`,
						`known=${packet.known.length}`,
						`spoken=${packet.spoken.length}`,
						`supported=${packet.supported.length}`,
						`contradicted=${packet.contradicted.length}`,
						`unknown=${packet.unknown.length}`,
						`speechWindows=${packet.selectedSpeech.length}`,
						`visualRefs=${packet.selectedVisualEvidence.length}`,
						`imagesAttached=${packet.frameMeta.length}`,
						`mediaSummary=${packet.mediaSummary}`,
						"",
						bd?.packetSerializedText?.slice(0, 8000) ?? "",
					].join("\n"),
				);
			} else {
				writeText(`${callDir}/packet-summary.txt`, "PACKET_MISSING — boundedDiagnostics absent\n");
			}

			writeJson(`${callDir}/frame-manifest.json`, {
				frameMeta: rp?.frameMeta ?? packet?.frameMeta ?? [],
				visualCoverage: rp?.visualCoverage ?? null,
				selectedVisualEvidence: packet?.selectedVisualEvidence ?? [],
				imageCount: ct?.images.imageCount ?? bd?.imagesAttached ?? 0,
				totalJpegBytes: ct?.images.totalJpegBytes ?? null,
			});

			writeJson(`${callDir}/provider-usage.json`, {
				inputTokens: inTok,
				cachedInputTokens: cached,
				outputTokens: outTok,
				reasoningTokens: reasoningTok,
				imageCount: ct?.images.imageCount ?? null,
				imageBytes: ct?.images.totalJpegBytes ?? null,
				modelCalls,
				toolLoopCount: ct?.toolLoopCount ?? null,
				providerLatencyMs: ct?.latency.providerMs ?? null,
				totalLatencyMs: latencyMs,
				estimatedCostUsd: estCost(inTok, cached, outTok),
				pricing: {
					inputPerMTok: PRICE_IN,
					cachedInputPerMTok: PRICE_CACHED,
					outputPerMTok: PRICE_OUT,
					model: MODEL,
					note: "ESTIMATED from list pricing × usage metadata when present",
				},
				contextDecomposition: {
					coreInvariantsChars: CORE_INVARIANTS.length,
					phasePolicyChars: phasePolicy(phaseActual).length,
					systemPolicyChars:
						bd?.systemPolicyChars ?? ct?.components.systemInstruction?.chars ?? null,
					toolSchemaChars: bd?.toolSchemaChars ?? ct?.components.toolSchemas?.chars ?? null,
					projectProjectionChars: bd?.projectProjectionChars ?? null,
					reasoningPacketChars: bd?.packetChars ?? rp?.packedContextChars ?? null,
					historyChars: ct?.components.conversationHistory?.chars ?? 0,
					images: ct?.images.imageCount ?? 0,
				},
				status: result.status,
				failureReason: result.failureReason ?? null,
				providerDiagnostics: result.providerDiagnostics ?? null,
			});

			writeText(`${callDir}/final-response.txt`, result.text || "");

			writeJson(`${callDir}/tool-surface.json`, {
				phase: phaseActual,
				phaseResolveReason: phase.reason,
				toolCount: toolNames.length,
				toolNames,
				schemaChars: bd?.toolSchemaChars ?? null,
				mutatingToolCount,
				mutationInvariantOk: !(
					mutatingToolCount > 0 &&
					(phaseActual === "UNDERSTAND" || phaseActual === "PLAN")
				),
			});

			writeJson(`${callDir}/run-meta.json`, {
				identity: IDENTITY,
				sourceAsset: call.mediaPath,
				userRequest: call.prompt,
				queryClass: rp?.queryClass ?? queryClass,
				queryScope: rp?.queryScope ?? null,
				cognitionPhase: phaseActual,
				sourceMemoryHit: rp?.sourceMemoryHit ?? null,
				programmeMemoryHit: rp?.programmeMemoryHit ?? null,
				selectedSpeech: packet?.selectedSpeech ?? [],
				selectedFrameTimestamps: (rp?.frameMeta ?? []).map((f) => f.sourceTimeSec),
				selectedFrameReasons: (rp?.frameMeta ?? []).map((f) => f.reason),
				evidenceCoverage: packet?.evidenceCoverage ?? rp?.visualCoverage ?? null,
				known: packet?.known ?? [],
				spoken: packet?.spoken ?? [],
				supported: packet?.supported ?? [],
				contradicted: packet?.contradicted ?? [],
				unknown: packet?.unknown ?? [],
				preservationConstraints: packet?.preservationConstraints ?? [],
				projectProjection: packet?.projectProjection ?? null,
				toolsExposed: toolNames,
				systemPolicyChars: bd?.systemPolicyChars ?? null,
				packetSize: bd?.packetChars ?? null,
				sufficiency: packet?.sufficiency ?? null,
				ranInvestigator: rp?.ranInvestigator ?? null,
				ledgerReused: rp?.ledgerReused ?? null,
				sourceStoryReused: rp?.sourceStoryReused ?? null,
				providerCalls: modelCalls,
				toolLoopCalls: ct?.toolLoopCount ?? 0,
			});

			// Placeholder claim/quality files — filled after manual review in report pass.
			writeJson(`${callDir}/claim-audit.json`, {
				status: "PENDING_MANUAL",
				finalTextChars: (result.text || "").length,
				note: "Filled in AI_BOUNDED_REASONING_LIVE_SMOKE_V1_REPORT.md after review",
			});
			writeJson(`${callDir}/quality-review.json`, {
				status: "PENDING_MANUAL",
				overall: null,
			});

			const row = {
				id: call.id,
				label: call.label,
				mediaPath: call.mediaPath,
				prompt: call.prompt,
				status: result.status,
				failureReason: result.failureReason ?? null,
				phase: phaseActual,
				queryClass: rp?.queryClass ?? queryClass,
				queryScope: rp?.queryScope ?? null,
				inputTokens: inTok,
				outputTokens: outTok,
				cachedInputTokens: cached,
				images: ct?.images.imageCount ?? null,
				packetChars: bd?.packetChars ?? null,
				systemChars: bd?.systemPolicyChars ?? null,
				toolChars: bd?.toolSchemaChars ?? null,
				toolCount: toolNames.length,
				mutatingToolCount,
				modelCalls,
				toolLoopCount: ct?.toolLoopCount ?? 0,
				estimatedCostUsd: estCost(inTok, cached, outTok),
				latencyMs,
				packetPresent: Boolean(packet),
				packetSufficient: packet?.sufficiency.packetEvidenceSufficient ?? null,
				sourceMemoryHit: rp?.sourceMemoryHit ?? null,
				finalTextPreview: (result.text || "").slice(0, 400),
				primaryFailureLayer: null as string | null,
			};

			if (!packet && result.status === "completed") {
				row.primaryFailureLayer = "PACKET_CONSTRUCTION";
			} else if (
				mutatingToolCount > 0 &&
				(phaseActual === "UNDERSTAND" || phaseActual === "PLAN")
			) {
				row.primaryFailureLayer = "PHASE_TOOL_SURFACE";
			} else if (result.status === "provider_error") {
				row.primaryFailureLayer = "PROVIDER_INFRASTRUCTURE";
			}

			matrixRows.push(row);
			writeJson(`${callDir}/matrix-row.json`, row);
		}

		const completed = matrixRows.filter((r) => r.kind !== "health" && r.status === "completed");
		const costs = completed
			.map((r) => r.estimatedCostUsd)
			.filter((c): c is number => typeof c === "number");
		writeJson("cost-summary.json", {
			identity: IDENTITY,
			pricingAssumptions: {
				model: MODEL,
				inputPerMTokUsd: PRICE_IN,
				cachedInputPerMTokUsd: PRICE_CACHED,
				outputPerMTokUsd: PRICE_OUT,
				accounting: "ESTIMATED_ONLY when usage metadata present",
			},
			paidGenerationCalls,
			completedCalls: completed.length,
			perCall: completed.map((r) => ({
				id: r.id,
				inputTokens: r.inputTokens,
				outputTokens: r.outputTokens,
				cachedInputTokens: r.cachedInputTokens,
				images: r.images,
				estimatedCostUsd: r.estimatedCostUsd,
				latencyMs: r.latencyMs,
			})),
			averageCostUsd: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
			totalEstimatedCostUsd: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null,
			abortRemaining,
			abortReason,
		});

		expect(paidGenerationCalls).toBeLessThanOrEqual(6);
		expect(
			matrixRows
				.filter((r) => r.mutatingToolCount != null)
				.every(
					(r) =>
						!(
							(r.phase === "UNDERSTAND" || r.phase === "PLAN") &&
							typeof r.mutatingToolCount === "number" &&
							r.mutatingToolCount > 0
						),
				),
		).toBe(true);
	}, 600_000);
});
