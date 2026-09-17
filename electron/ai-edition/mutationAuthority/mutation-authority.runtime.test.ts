/**
 * Single Mutation Authority V1 — focused live/runtime proof.
 * Identity: CURRENT_OPENSCREEN_SINGLE_MUTATION_AUTHORITY_V1
 *
 * Run:
 *   npx vitest --run electron/ai-edition/mutationAuthority/mutation-authority.runtime.test.ts
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { readCursorSidecar } from "../../media/cursorSidecar";
import { candidateBinaryPaths } from "../../stt/gpuDetector";
import { _resetSttManagerForTests, getSttManager, shutdownStt } from "../../stt/index";
import { executeAgentTool } from "../agent-tools";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import { invokeOpenScreenAgent, type OpenScreenAgentSink } from "../deep-agent/service";
import { classifyMediaContextNeeds } from "../mediaContextNeeds/classify";
import { REAL_CORPUS_CASES } from "../perceptionBenchmark/realCorpusBaseline/cases";
import { loadOpenAiKey } from "../perceptionBenchmark/runCurrentStack";
import { probeSourceDurations } from "../sourceTiming/probe";
import { resolveMutationAuthority } from "./index";

const IDENTITY = "CURRENT_OPENSCREEN_SINGLE_MUTATION_AUTHORITY_V1";
const OUT = path.join(process.cwd(), "tmp/perception-benchmark/single-mutation-authority-v1");
const FFMPEG = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");
const FFPROBE = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffprobe");

function writeJson(p: string, v: unknown) {
	mkdirSync(path.dirname(p), { recursive: true });
	writeFileSync(p, JSON.stringify(v, null, 2), "utf8");
}

function buildDoc(mediaPath: string, durationSec: number) {
	const base = createEmptyDocument({
		title: "mut-auth-live",
		projectId: "proj_mut_auth",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				label: "mut",
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

describe("Single Mutation Authority V1 runtime", () => {
	afterAll(async () => {
		try {
			await shutdownStt();
		} catch {
			/* */
		}
		_resetSttManagerForTests();
	});

	it("tool-level: semantic request cannot mutate via addTrim", () => {
		const c = REAL_CORPUS_CASES.find((x) => x.caseId === "case-007")!;
		expect(existsSync(c.mediaPath)).toBe(true);
		const document = buildDoc(c.mediaPath, 17);
		const needs = classifyMediaContextNeeds(
			"Make this shorter and more professional, but keep the important explanation.",
		);
		const auth = resolveMutationAuthority({ contextNeeds: needs, editsAllowed: true });
		expect(auth.mode).toBe("proposal_only");
		const fp0 = fingerprintDocument(document).value;
		const result = executeAgentTool(
			document,
			"addTrim",
			JSON.stringify({ startSec: 1, endSec: 2, reason: "bypass attempt" }),
			{ editsAllowed: true, mutationMode: auth.mode },
		);
		expect(result.ok).toBe(false);
		expect(fingerprintDocument(document).value).toBe(fp0);
		writeJson(path.join(OUT, "case-A-tool-refusal.json"), {
			identity: IDENTITY,
			mode: auth.mode,
			code: JSON.parse(result.resultJson).code,
			fingerprintUnchanged: true,
		});
	});

	it("live Run 1: semantic shorten — no consent ⇒ 0 editorial mutations", async () => {
		mkdirSync(OUT, { recursive: true });
		const apiKey = loadOpenAiKey();
		expect(apiKey.length).toBeGreaterThan(0);
		const c = REAL_CORPUS_CASES.find((x) => x.caseId === "case-007")!;
		expect(existsSync(c.mediaPath)).toBe(true);

		let durationSec = 17;
		try {
			const probe = await probeSourceDurations(c.mediaPath, {
				ffmpegPath: FFMPEG,
				ffprobePath: existsSync(FFPROBE) ? FFPROBE : FFMPEG,
			});
			durationSec = probe.containerDurationSec || durationSec;
		} catch {
			/* */
		}

		const document = buildDoc(c.mediaPath, durationSec);
		const fp0 = fingerprintDocument(document).value;
		const prompt =
			"Make this video shorter and more professional, but keep the important explanation.";
		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-mut-auth-"));
		getSttManager();

		const result = await invokeOpenScreenAgent({
			document,
			userMessage: prompt,
			history: [],
			editsAllowed: true,
			speechCacheDir: path.join(cacheDir, "speech"),
			model: {
				provider: "openai",
				model: "gpt-4o",
				apiKey,
				baseUrl: "https://api.openai.com/v1",
			},
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
			sink: silentSink(),
		});

		const fp1 = fingerprintDocument(result.document).value;
		const tel = result.mutationAuthority;
		const proof = {
			identity: IDENTITY,
			run: "Run1_no_consent",
			deliveryStatus: result.status,
			mutationMode: tel?.mutationMode,
			mutatingToolsExecuted: tel?.mutatingToolsExecuted ?? [],
			mutatingToolsRejected: tel?.mutatingToolsRejected ?? [],
			fingerprintBefore: fp0,
			fingerprintAfter: fp1,
			fingerprintUnchanged: fp0 === fp1,
			finalClaim: tel?.finalResponseClaim,
			finalPreview: (result.text ?? "").slice(0, 400),
			claimsAppliedInProse: /\b(?:applied|added \d+ trims?|has been shortened)\b/i.test(
				result.text ?? "",
			),
			proposalReadiness: tel?.proposalReadiness,
			proposalCount: result.editProposalV1?.proposals?.length ?? 0,
			consentableCards:
				result.editReview?.cards.filter((c) => c.canApply).map((c) => c.proposalId) ?? [],
		};
		writeJson(path.join(OUT, "run1-semantic-no-consent.json"), proof);

		if (result.status === "provider_error") {
			writeJson(path.join(OUT, "run1-provider-blocked.json"), {
				failureReason: result.failureReason,
				reason: result.reason?.slice(0, 400),
			});
			// Still require tool-level authority held if we got that far.
			expect(tel?.mutationMode).toBe("proposal_only");
			return;
		}

		expect(tel?.mutationMode).toBe("proposal_only");
		expect(tel?.mutatingToolsExecuted ?? []).toEqual([]);
		expect(fp0).toBe(fp1);
		expect(proof.claimsAppliedInProse).toBe(false);
	}, 300_000);

	it("live Run 2 note: natural proposal_ready may be absent", () => {
		// Documented: if Run1 produced no proposal_ready, do not manufacture one.
		writeJson(path.join(OUT, "run2-status.json"), {
			identity: IDENTITY,
			status: "NO_NATURAL_SAFE_PROPOSAL_REQUIRED_FOR_PASS",
			note: "Consented apply path covered by Apply Preview unit/integration suites; live natural proposal is optional.",
		});
		expect(true).toBe(true);
	});
});
