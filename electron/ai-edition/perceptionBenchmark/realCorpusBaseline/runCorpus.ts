/**
 * Corpus runner CLI for CURRENT_OPENSCREEN_REAL_CORPUS_BASELINE_V1.
 *
 * Usage:
 *   npx tsx electron/ai-edition/perceptionBenchmark/realCorpusBaseline/runCorpus.ts
 *   npx tsx .../runCorpus.ts --only case-001,case-002
 *   npx tsx .../runCorpus.ts --from case-010
 *   npx tsx .../runCorpus.ts --skip-apply
 *
 * Resumes: skips cases that already have score.json unless --force.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { _resetSttManagerForTests, shutdownStt } from "../../../stt/index";
import { corpusStats, REAL_CORPUS_BASELINE_V1_ID, REAL_CORPUS_CASES } from "./cases";
import { runRealCorpusCase } from "./runCase";
import { primaryRootCause, worstSeverity } from "./score";
import type { CaseScore, ScoreMark } from "./types";

const ARTIFACT_ROOT = path.join(process.cwd(), "tmp/perception-benchmark/real-corpus-baseline-v1");

function parseArgs(argv: string[]) {
	const only = new Set<string>();
	let from: string | null = null;
	let force = false;
	let skipApply = false;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a === "--force") force = true;
		else if (a === "--skip-apply") skipApply = true;
		else if (a === "--only" && argv[i + 1]) {
			for (const id of argv[++i]!.split(",")) only.add(id.trim());
		} else if (a === "--from" && argv[i + 1]) {
			from = argv[++i]!;
		}
	}
	return { only, from, force, skipApply };
}

function writeJson(file: string, data: unknown) {
	writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function loadScore(caseId: string): CaseScore | null {
	const p = path.join(ARTIFACT_ROOT, "cases", caseId, "score.json");
	if (!existsSync(p)) return null;
	try {
		return JSON.parse(readFileSync(p, "utf8")) as CaseScore;
	} catch {
		return null;
	}
}

function aggregateAndWriteReport() {
	const stats = corpusStats();
	const rows: Array<Record<string, unknown>> = [];
	const failures: Array<Record<string, unknown>> = [];
	const latencySamples: number[] = [];
	let pass = 0;
	let partial = 0;
	let fail = 0;
	let notVerified = 0;
	let na = 0;
	let proposalReady = 0;
	let noSafe = 0;
	let closureCases = 0;
	let mutationsAttempted = 0;
	let mutationsAccepted = 0;
	let rollbacks = 0;
	let modelCallSum = 0;
	let invToolSum = 0;
	let scored = 0;

	const issueBuckets = new Map<string, string[]>();

	for (const c of REAL_CORPUS_CASES) {
		const score = loadScore(c.caseId);
		const caseDir = path.join(ARTIFACT_ROOT, "cases", c.caseId);
		const latPath = path.join(caseDir, "latency.json");
		const propPath = path.join(caseDir, "proposal.json");
		const applyPath = path.join(caseDir, "apply-receipt.json");
		const closurePath = path.join(caseDir, "closure.json");
		const modelPath = path.join(caseDir, "model-calls.json");
		const finalPath = path.join(caseDir, "final-response.txt");

		let latencyMs: number | null = null;
		if (existsSync(latPath)) {
			try {
				const lat = JSON.parse(readFileSync(latPath, "utf8")) as { totalTurnMs?: number };
				if (typeof lat.totalTurnMs === "number") {
					latencyMs = lat.totalTurnMs;
					latencySamples.push(lat.totalTurnMs);
				}
			} catch {
				/* */
			}
		}

		let proposalStatus = "n/a";
		if (existsSync(propPath)) {
			try {
				const prop = JSON.parse(readFileSync(propPath, "utf8")) as {
					editProposalV1?: { proposals?: Array<{ status?: string }> };
				};
				const statuses = (prop.editProposalV1?.proposals ?? []).map((p) => p.status ?? "");
				if (statuses.includes("proposal_ready")) {
					proposalStatus = "proposal_ready";
					proposalReady++;
				} else if (statuses.includes("no_safe_proposal") || statuses.length === 0) {
					proposalStatus = statuses.includes("no_safe_proposal") ? "no_safe_proposal" : "none";
					if (statuses.includes("no_safe_proposal")) noSafe++;
				} else {
					proposalStatus = statuses[0] ?? "none";
				}
			} catch {
				/* */
			}
		}

		if (existsSync(closurePath)) {
			try {
				const cl = JSON.parse(readFileSync(closurePath, "utf8")) as { present?: boolean };
				if (cl && cl.present !== false) closureCases++;
			} catch {
				/* */
			}
		}

		if (existsSync(applyPath)) {
			try {
				const ap = JSON.parse(readFileSync(applyPath, "utf8")) as {
					attempted?: boolean;
					mutatedAndVerified?: boolean;
					receipt?: { terminalStatus?: string; mutationsApplied?: number; rolledBack?: boolean };
				};
				if (ap.attempted) {
					mutationsAttempted++;
					if (ap.mutatedAndVerified) mutationsAccepted++;
					if (ap.receipt?.rolledBack || /rollback/i.test(ap.receipt?.terminalStatus ?? "")) {
						rollbacks++;
					}
				}
			} catch {
				/* */
			}
		}

		if (existsSync(modelPath)) {
			try {
				const mc = JSON.parse(readFileSync(modelPath, "utf8")) as {
					mainAgentModelCallsEstimate?: number;
					investigatorToolCalls?: number;
				};
				modelCallSum += mc.mainAgentModelCallsEstimate ?? 0;
				invToolSum += mc.investigatorToolCalls ?? 0;
			} catch {
				/* */
			}
		}

		const overall = (score?.overall ?? "NOT_VERIFIED") as ScoreMark;
		scored++;
		if (overall === "PASS") pass++;
		else if (overall === "PARTIAL") partial++;
		else if (overall === "FAIL") fail++;
		else if (overall === "NOT_APPLICABLE") na++;
		else notVerified++;

		const sev = score ? worstSeverity(score.issues) : null;
		const root = score ? primaryRootCause(score.issues) : null;
		if (root) {
			const list = issueBuckets.get(root) ?? [];
			list.push(c.caseId.replace("case-", ""));
			issueBuckets.set(root, list);
		}

		const finalPreview = existsSync(finalPath)
			? readFileSync(finalPath, "utf8").slice(0, 120).replace(/\s+/g, " ")
			: "";

		rows.push({
			caseId: c.caseId,
			recording: c.recordingFile,
			task: c.intent,
			family: c.family,
			historicalAnchor: Boolean(c.historicalAnchor),
			understanding: score?.dimensions.visualEventRecall.mark ?? "NOT_VERIFIED",
			grounding: score?.dimensions.crossModalGrounding.mark ?? "NOT_VERIFIED",
			editorial: score?.dimensions.editorialJudgment.mark ?? "NOT_APPLICABLE",
			proposal: proposalStatus,
			finalResponse: score?.dimensions.finalAnswerClarity.mark ?? "NOT_VERIFIED",
			overall,
			severity: sev,
			rootCause: root,
			latencyMs,
			finalPreview,
		});

		if (score && (overall === "FAIL" || overall === "PARTIAL" || score.issues.length)) {
			failures.push({
				caseId: c.caseId,
				overall,
				issues: score.issues,
				negativeTests: score.negativeTests.filter((n) => n.result === "FAIL"),
				userFacingAudit: score.userFacingAudit,
			});
		}
	}

	latencySamples.sort((a, b) => a - b);
	const pct = (p: number) => {
		if (!latencySamples.length) return null;
		const idx = Math.min(
			latencySamples.length - 1,
			Math.max(0, Math.floor((p / 100) * latencySamples.length)),
		);
		return latencySamples[idx]!;
	};
	const avg = latencySamples.length
		? Math.round(latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length)
		: null;

	const clusters = [...issueBuckets.entries()].map(([category, caseNums]) => ({
		category,
		cases: caseNums,
		count: caseNums.length,
	}));

	const summary = {
		identity: REAL_CORPUS_BASELINE_V1_ID,
		generatedAtIso: new Date().toISOString(),
		corpus: stats,
		counts: {
			totalCases: REAL_CORPUS_CASES.length,
			scored,
			PASS: pass,
			PARTIAL: partial,
			FAIL: fail,
			NOT_VERIFIED: notVerified,
			NOT_APPLICABLE: na,
		},
		proposals: {
			proposalReady,
			noSafeProposal: noSafe,
			closureCases,
			mutationsAttempted,
			mutationsAccepted,
			rollbacks,
		},
		latency: {
			samples: latencySamples.length,
			avgMs: avg,
			p50Ms: pct(50),
			p95Ms: pct(95),
		},
		modelCalls: {
			avgMainAgentEstimate: scored ? modelCallSum / scored : null,
			avgInvestigatorToolCalls: scored ? invToolSum / scored : null,
		},
		clusters,
		rows,
	};

	writeJson(path.join(ARTIFACT_ROOT, "summary.json"), summary);
	writeJson(path.join(ARTIFACT_ROOT, "failures.json"), failures);
	writeJson(path.join(ARTIFACT_ROOT, "latency.json"), summary.latency);

	const tableLines = [
		"| Case | Recording | Task | Understanding | Grounding | Editorial | Proposal | Final response | Severity | Root cause |",
		"| ---- | --------- | ---- | ------------- | --------- | --------- | -------- | -------------- | -------- | ---------- |",
	];
	for (const r of rows) {
		tableLines.push(
			`| ${r.caseId} | ${String(r.recording).slice(0, 28)} | ${String(r.task).slice(0, 36)} | ${r.understanding} | ${r.grounding} | ${r.editorial} | ${r.proposal} | ${r.finalResponse} | ${r.severity ?? "—"} | ${r.rootCause ?? "—"} |`,
		);
	}

	const clusterMd = clusters
		.map(
			(cl, i) =>
				`### Cluster ${String.fromCharCode(65 + i)} — ${cl.category}\nCases: ${cl.cases.join(", ")}\nCount: ${cl.count}\n`,
		)
		.join("\n");

	const md = `# AI Real Corpus Baseline V1 Report

**Identity:** \`${REAL_CORPUS_BASELINE_V1_ID}\`  
**Generated:** ${summary.generatedAtIso}  
**Scope:** Frozen measurement only — production behavior unchanged.

## Benchmark execution verdict

> Filled by final report pass after human/heuristic review of artifacts.

\`PASS_WITH_LIMITATIONS\` (provisional until full manual review of final responses)

## Product readiness assessment

> Separate from benchmark execution quality.

\`EARLY\` — architecture exercises end-to-end on real media; evidence quality and editorial specificity still incomplete for alpha claims.

## Corpus

- Total cases: **${stats.total}**
- Historical anchors: **${stats.historicalAnchors}** (${100 - stats.nonAnchorPct}% anchors / ${stats.nonAnchorPct}% non-anchor)
- Families: ${stats.families.join(", ")}
- Media inventory: \`tmp/perception-benchmark/real-corpus-baseline-v1/inventory.json\`

## Aggregate scores

| Mark | Count |
| ---- | ----- |
| PASS | ${pass} |
| PARTIAL | ${partial} |
| FAIL | ${fail} |
| NOT_VERIFIED | ${notVerified} |
| NOT_APPLICABLE | ${na} |

## Latency

- Samples: ${latencySamples.length}
- Avg: ${avg ?? "n/a"} ms
- p50: ${pct(50) ?? "n/a"} ms
- p95: ${pct(95) ?? "n/a"} ms

## Proposals / apply

- proposal_ready: ${proposalReady}
- no_safe_proposal: ${noSafe}
- closure invoked (artifact present): ${closureCases}
- mutations attempted: ${mutationsAttempted}
- mutations accepted: ${mutationsAccepted}
- rollbacks: ${rollbacks}

## Case table

${tableLines.join("\n")}

## Failure clusters

${clusterMd || "_No automated issue clusters yet._"}

## Artifact root

\`tmp/perception-benchmark/real-corpus-baseline-v1/\`

See also root report: \`AI_REAL_CORPUS_BASELINE_V1_REPORT.md\` (authoritative after run completes).
`;

	writeFileSync(path.join(ARTIFACT_ROOT, "REAL_CORPUS_BASELINE_V1_REPORT.md"), md, "utf8");
	return summary;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	mkdirSync(path.join(ARTIFACT_ROOT, "cases"), { recursive: true });

	writeJson(path.join(ARTIFACT_ROOT, "corpus.json"), {
		identity: REAL_CORPUS_BASELINE_V1_ID,
		stats: corpusStats(),
		cases: REAL_CORPUS_CASES.map((c) => ({
			caseId: c.caseId,
			family: c.family,
			recordingFile: c.recordingFile,
			mediaPath: c.mediaPath,
			historicalAnchor: Boolean(c.historicalAnchor),
			prompt: c.prompt,
			intent: c.intent,
			mustNotClaim: c.mustNotClaim ?? [],
			notes: c.notes ?? null,
		})),
	});

	let started = args.from ? false : true;
	const results: Array<{ caseId: string; ok: boolean; overall?: string; error?: string | null }> =
		[];

	for (const c of REAL_CORPUS_CASES) {
		if (args.from && !started) {
			if (c.caseId === args.from) started = true;
			else continue;
		}
		if (args.only.size && !args.only.has(c.caseId)) continue;

		const scorePath = path.join(ARTIFACT_ROOT, "cases", c.caseId, "score.json");
		if (!args.force && existsSync(scorePath)) {
			console.log(`[skip] ${c.caseId} already has score.json`);
			results.push({ caseId: c.caseId, ok: true, overall: "cached" });
			continue;
		}

		console.log(`[run] ${c.caseId} ${c.family} ${c.recordingFile}`);
		try {
			const r = await runRealCorpusCase(c, { skipApply: args.skipApply });
			console.log(
				`[done] ${c.caseId} overall=${r.overall} ms=${r.latency?.totalTurnMs ?? "?"} err=${r.error ?? ""}`,
			);
			results.push({
				caseId: c.caseId,
				ok: r.ok,
				overall: r.overall,
				error: r.error,
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error(`[fail] ${c.caseId} ${msg}`);
			results.push({ caseId: c.caseId, ok: false, error: msg });
			writeJson(path.join(ARTIFACT_ROOT, "cases", c.caseId, "score.json"), {
				caseId: c.caseId,
				overall: "FAIL",
				error: msg,
			});
		}

		// Refresh partial summary after each case
		aggregateAndWriteReport();
	}

	writeJson(path.join(ARTIFACT_ROOT, "run-log.json"), {
		finishedAtIso: new Date().toISOString(),
		results,
	});
	const summary = aggregateAndWriteReport();
	console.log(
		`[summary] PASS=${summary.counts.PASS} PARTIAL=${summary.counts.PARTIAL} FAIL=${summary.counts.FAIL} latencyAvg=${summary.latency.avgMs}`,
	);

	await shutdownStt().catch(() => undefined);
	_resetSttManagerForTests();
}

main().catch(async (e) => {
	console.error(e);
	await shutdownStt().catch(() => undefined);
	_resetSttManagerForTests();
	process.exit(1);
});
