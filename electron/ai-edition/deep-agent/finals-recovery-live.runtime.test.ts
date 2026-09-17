/**
 * Live Real Corpus Recovery 3 — final response / provider reliability.
 * Identity: CURRENT_OPENSCREEN_REAL_CORPUS_RECOVERY_FINALS_V1
 *
 * Run:
 *   npx vitest --run electron/ai-edition/deep-agent/finals-recovery-live.runtime.test.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { _resetSttManagerForTests, getSttManager, shutdownStt } from "../../stt/index";
import { classifyMediaContextNeeds } from "../mediaContextNeeds/classify";
import { REAL_CORPUS_CASES } from "../perceptionBenchmark/realCorpusBaseline/cases";
import { loadOpenAiKey } from "../perceptionBenchmark/runCurrentStack";
import { probeConfiguredProviderHealth } from "./providerHealth";
import { invokeOpenScreenAgent, type OpenScreenAgentSink } from "./service";

const IDENTITY = "CURRENT_OPENSCREEN_REAL_CORPUS_RECOVERY_FINALS_V1";
const OUT = path.join(process.cwd(), "tmp/perception-benchmark/real-corpus-recovery-3-finals");
const BASELINE = path.join(process.cwd(), "tmp/perception-benchmark/real-corpus-baseline-v1");

function corpusCase(caseId: string) {
	return REAL_CORPUS_CASES.find((c) => c.caseId === caseId) ?? null;
}

function baselineFinal(caseId: string): { len: number; empty: boolean } {
	const p = path.join(BASELINE, "cases", caseId, "final-response.txt");
	if (!existsSync(p)) return { len: 0, empty: true };
	const t = readFileSync(p, "utf8");
	return { len: t.trim().length, empty: t.trim().length === 0 };
}

function makeDoc(mediaPath: string, durationSec: number, projectId: string) {
	const base = createEmptyDocument({
		title: projectId,
		projectId,
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				label: projectId,
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

function silentSink(): OpenScreenAgentSink {
	return {
		text: () => {},
		thinking: () => {},
		toolStart: () => {},
		toolEnd: () => {},
		error: () => {},
	};
}

interface CaseSpec {
	id: string;
	baselineCaseId?: string;
	kind: string;
	prompt: string;
	mediaPath: string;
}

function buildCases(): CaseSpec[] {
	const ids = ["case-017", "case-027", "case-030", "case-020", "case-022", "case-023", "case-021"];
	const out: CaseSpec[] = [];
	for (const id of ids) {
		const c = corpusCase(id);
		if (!c || !existsSync(c.mediaPath)) continue;
		out.push({
			id,
			baselineCaseId: id,
			kind:
				id === "case-017" || id === "case-027" || id === "case-030"
					? "empty_final_baseline"
					: id === "case-020"
						? "case_020_observation"
						: id === "case-022"
							? "visual_control"
							: id === "case-023"
								? "speech_control"
								: "unsupported_control",
			prompt: c.prompt,
			mediaPath: c.mediaPath,
		});
	}
	// Extra controls if media exists
	const det = corpusCase("case-029") ?? corpusCase("case-024");
	if (det && existsSync(det.mediaPath)) {
		out.push({
			id: "control-deterministic",
			kind: "deterministic",
			prompt: "Trim 5–8s.",
			mediaPath: det.mediaPath,
		});
		out.push({
			id: "control-cross-modal",
			kind: "cross_modal",
			prompt: "Did what I said actually happen on screen?",
			mediaPath: det.mediaPath,
		});
	}
	return out;
}

describe.runIf(process.env.OPENSCREEN_SKIP_FINALS_LIVE !== "1")(
	"Real Corpus Recovery 3 — finals reliability (live)",
	() => {
		afterAll(async () => {
			try {
				await shutdownStt();
			} catch {
				/* */
			}
			_resetSttManagerForTests();
		});

		it("provider health + baseline empty cases + controls + sequential stability", async () => {
			mkdirSync(path.join(OUT, "cases"), { recursive: true });
			const apiKey = loadOpenAiKey();
			const health = await probeConfiguredProviderHealth({
				provider: "openai",
				model: "gpt-4o",
				apiKey: apiKey || undefined,
				baseUrl: "https://api.openai.com/v1",
			});
			writeFileSync(path.join(OUT, "provider-health.json"), JSON.stringify(health, null, 2));

			const cases = buildCases();
			writeFileSync(
				path.join(OUT, "selected-cases.json"),
				JSON.stringify({ identity: IDENTITY, cases }, null, 2),
			);
			expect(cases.length).toBeGreaterThanOrEqual(6);
			expect(apiKey.length, "OPENAI_API_KEY required for finals live recovery").toBeGreaterThan(0);

			const beforeAfter: unknown[] = [];
			const sequential: unknown[] = [];
			const latencyRows: unknown[] = [];
			const realResults: unknown[] = [];

			// Ensure STT manager can start (Recovery 1 regression surface)
			getSttManager();

			for (const c of cases) {
				const caseDir = path.join(OUT, "cases", c.id);
				mkdirSync(caseDir, { recursive: true });
				const cacheDir = await mkdtemp(path.join(os.tmpdir(), `os-finals-${c.id}-`));
				const needs = classifyMediaContextNeeds(c.prompt);
				const durationSec = 30;
				const document = makeDoc(c.mediaPath, durationSec, `proj_${c.id}`);

				const t0 = Date.now();
				let result: Awaited<ReturnType<typeof invokeOpenScreenAgent>> | null = null;
				let thrown: string | null = null;
				try {
					result = await invokeOpenScreenAgent({
						document,
						userMessage: c.prompt,
						history: [],
						editsAllowed: true,
						speechCacheDir: path.join(cacheDir, "speech"),
						model: {
							provider: "openai",
							model: "gpt-4o",
							apiKey,
							baseUrl: "https://api.openai.com/v1",
						},
						sink: silentSink(),
					});
				} catch (e) {
					thrown = e instanceof Error ? e.message : String(e);
				}
				const totalMs = Date.now() - t0;

				const finalText = (result?.text ?? "").trim();
				const status = result?.status ?? (thrown ? "provider_error" : "analysis_error");
				const failureReason = result?.failureReason ?? null;
				const unexplainedEmpty =
					finalText.length === 0 && status === "completed" && !failureReason && !result?.reason;

				// Hard invariant: never completed with empty text
				if (result) {
					if (finalText.length === 0) {
						expect(result.status).not.toBe("completed");
						expect(Boolean(result.failureReason || result.reason || result.userMessage)).toBe(true);
					} else {
						expect(result.status ?? "completed").toBe("completed");
					}
				}

				const base = c.baselineCaseId ? baselineFinal(c.baselineCaseId) : null;
				const row = {
					case: c.id,
					kind: c.kind,
					baselineFinal: base ? (base.empty ? "(empty)" : `${base.len} chars`) : "n/a",
					baselineCause: base?.empty ? "empty_or_near_empty_final" : "n/a",
					recoveryStatus: status,
					recoveryFinalOrError:
						finalText.length > 0
							? `${finalText.slice(0, 120)}…`
							: (result?.userMessage ?? result?.failureReason ?? thrown ?? "(none)"),
					emptyUnexplained: unexplainedEmpty,
					failureReason,
					providerHttpStatus: result?.providerHttpStatus ?? null,
					speechStatus: result?.speechEvidence?.[0]?.status ?? null,
					hasInvestigation: Boolean(result?.investigationEvidence),
					routingCategory: needs.category,
					totalMs,
				};
				beforeAfter.push(row);
				sequential.push({
					id: c.id,
					status,
					failureReason,
					finalLen: finalText.length,
					totalMs,
					providerHttpStatus: result?.providerHttpStatus ?? null,
				});
				latencyRows.push({ id: c.id, totalMs, finalLen: finalText.length });
				realResults.push({
					...row,
					diagnostic: result?.reason?.slice(0, 800) ?? thrown,
					userMessage: result?.userMessage ?? null,
					case020ZoomClass:
						c.id === "case-020"
							? finalText.length === 0
								? "not_verifiable"
								: /\bzoom/i.test(finalText)
									? "unsupported_editorial_advice_or_evidence_backed_UNKNOWN"
									: "no_zoom_mentioned"
							: undefined,
				});

				writeFileSync(
					path.join(caseDir, "result.json"),
					JSON.stringify(realResults.at(-1), null, 2),
				);
				writeFileSync(path.join(caseDir, "final-response.txt"), finalText, "utf8");
				writeFileSync(
					path.join(caseDir, "delivery.json"),
					JSON.stringify(
						{
							status,
							failureReason,
							userMessage: result?.userMessage ?? null,
							providerHttpStatus: result?.providerHttpStatus ?? null,
							diagnostic: result?.reason ?? thrown,
							speechPreserved: Boolean(result?.speechEvidence),
							investigationPreserved: Boolean(result?.investigationEvidence),
							sourceStoryV2Preserved: Boolean(result?.sourceStoryV2),
						},
						null,
						2,
					),
				);

				expect(unexplainedEmpty).toBe(false);
			}

			writeFileSync(path.join(OUT, "before-after.json"), JSON.stringify(beforeAfter, null, 2));
			writeFileSync(path.join(OUT, "sequential-run.json"), JSON.stringify(sequential, null, 2));
			writeFileSync(path.join(OUT, "latency.json"), JSON.stringify({ rows: latencyRows }, null, 2));
			writeFileSync(
				path.join(OUT, "real-media-results.json"),
				JSON.stringify({ identity: IDENTITY, health, results: realResults }, null, 2),
			);

			// Routing regression: visual control still routes visual
			const visual = cases.find((c) => c.id === "case-022");
			if (visual) {
				expect(classifyMediaContextNeeds(visual.prompt).visual).toBe(true);
			}
		}, 900_000);
	},
);
