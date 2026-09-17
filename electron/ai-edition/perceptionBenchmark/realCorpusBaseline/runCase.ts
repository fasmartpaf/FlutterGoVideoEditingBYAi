/**
 * Single-case runner for CURRENT_OPENSCREEN_REAL_CORPUS_BASELINE_V1.
 * Exercises the live invokeOpenScreenAgent product path. Benchmark-only.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createEmptyDocument, documentSchema } from "../../../../src/lib/ai-edition/schema";
import { readCursorSidecar } from "../../../media/cursorSidecar";
import { mintTestConsent, runConsentedApplyPreview } from "../../applyPreview";
import { invokeOpenScreenAgent, type OpenScreenAgentSink } from "../../deep-agent/service";
import { probeSourceDurations, resolveFfprobe } from "../../sourceTiming";
import { stripInternalEvidenceJsonBlocks } from "../../speechEvidence/format";
import { loadOpenAiKey } from "../runCurrentStack";
import type { RealCorpusCase } from "./cases";
import { REAL_CORPUS_BASELINE_V1_ID } from "./cases";
import { scoreCase } from "./score";

const FFMPEG = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");
const ARTIFACT_ROOT = path.join(process.cwd(), "tmp/perception-benchmark/real-corpus-baseline-v1");

function writeJson(file: string, data: unknown) {
	writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function sidecarPaths(mediaPath: string) {
	const cursorPath = `${mediaPath}.cursor.json`;
	const base = mediaPath.replace(/\.mp4$/i, "");
	const webcamCandidates = [`${base}-webcam.webm`, `${base}-webcam.mp4`];
	const webcamPath = webcamCandidates.find((p) => existsSync(p)) ?? null;
	return {
		cursorPath: existsSync(cursorPath) ? cursorPath : null,
		webcamPath,
	};
}

function buildDoc(
	videoPath: string,
	durationSec: number,
	title: string,
	opts: { webcamPath?: string | null; width?: number; height?: number },
) {
	const CREATED = "2026-01-01T00:00:00.000Z";
	const base = createEmptyDocument({ title, projectId: `proj_${title}`, createdAt: CREATED });
	const assets: Array<Record<string, unknown>> = [
		{
			id: "asset_1",
			label: title,
			kind: "video",
			originalPath: videoPath,
			durationSec,
			width: opts.width ?? 1920,
			height: opts.height ?? 1080,
		},
	];
	if (opts.webcamPath && existsSync(opts.webcamPath)) {
		assets.push({
			id: "asset_webcam",
			label: `${title}-webcam`,
			kind: "video",
			originalPath: opts.webcamPath,
			durationSec,
			width: 1280,
			height: 720,
		});
	}
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets,
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
			trimRanges: [],
		},
	});
}

function makeSink() {
	let raw = "";
	const toolTrace: Array<{ event: string; name?: string; at: number }> = [];
	const sink: OpenScreenAgentSink = {
		text: (delta) => {
			raw += delta;
		},
		thinking: () => undefined,
		toolStart: (name) => {
			toolTrace.push({ event: "start", name, at: Date.now() });
		},
		toolEnd: (name) => {
			toolTrace.push({ event: "end", name, at: Date.now() });
		},
		error: () => undefined,
	};
	return { sink, getRaw: () => raw, toolTrace };
}

function inventoryHasAudio(mediaPath: string): boolean | null {
	const invPath = path.join(ARTIFACT_ROOT, "inventory.json");
	if (!existsSync(invPath)) return null;
	try {
		const inv = JSON.parse(readFileSync(invPath, "utf8")) as {
			recordings?: Array<{ path: string; hasAudio?: boolean }>;
		};
		const hit = inv.recordings?.find((r) => r.path === mediaPath);
		return typeof hit?.hasAudio === "boolean" ? hit.hasAudio : null;
	} catch {
		return null;
	}
}

export interface RunRealCorpusCaseOptions {
	apiKey?: string;
	model?: string;
	outRoot?: string;
	/** Skip apply even if proposal_ready (default false). */
	skipApply?: boolean;
}

export async function runRealCorpusCase(c: RealCorpusCase, options: RunRealCorpusCaseOptions = {}) {
	const outRoot = options.outRoot ?? path.join(ARTIFACT_ROOT, "cases");
	const caseDir = path.join(outRoot, c.caseId);
	mkdirSync(caseDir, { recursive: true });

	const startedAtIso = new Date().toISOString();
	const turn0 = Date.now();
	const sidecars = sidecarPaths(c.mediaPath);
	const invAudio = inventoryHasAudio(c.mediaPath);

	const inputMeta = {
		identity: REAL_CORPUS_BASELINE_V1_ID,
		caseId: c.caseId,
		family: c.family,
		recording: c.recordingFile,
		mediaPath: c.mediaPath,
		prompt: c.prompt,
		userIntent: c.intent,
		historicalAnchor: Boolean(c.historicalAnchor),
		cursorPath: sidecars.cursorPath,
		webcamPath: sidecars.webcamPath,
		inventoryHasAudio: invAudio,
		startedAtIso,
	};
	writeJson(path.join(caseDir, "input.json"), inputMeta);

	if (!existsSync(c.mediaPath)) {
		const err = `media missing: ${c.mediaPath}`;
		writeJson(path.join(caseDir, "score.json"), {
			caseId: c.caseId,
			overall: "FAIL",
			error: err,
		});
		writeFileSync(path.join(caseDir, "final-response.txt"), "", "utf8");
		return { caseId: c.caseId, ok: false, error: err, caseDir };
	}

	const apiKey = options.apiKey ?? loadOpenAiKey();
	if (!apiKey) {
		const err = "OPENAI_API_KEY missing";
		writeJson(path.join(caseDir, "score.json"), {
			caseId: c.caseId,
			overall: "FAIL",
			error: err,
		});
		return { caseId: c.caseId, ok: false, error: err, caseDir };
	}

	const cacheDir = await mkdtemp(path.join(os.tmpdir(), `os-real-corpus-${c.caseId}-`));
	const modelName = options.model ?? "gpt-4o";

	let durationSec = 0;
	let width = 1920;
	let height = 1080;
	try {
		const probe = await probeSourceDurations(c.mediaPath, {
			ffmpegPath: FFMPEG,
			ffprobePath: resolveFfprobe(),
		});
		durationSec = probe.containerDurationSec ?? 0;
	} catch (e) {
		const err = `probe failed: ${e instanceof Error ? e.message : String(e)}`;
		writeJson(path.join(caseDir, "score.json"), {
			caseId: c.caseId,
			overall: "FAIL",
			error: err,
		});
		return { caseId: c.caseId, ok: false, error: err, caseDir };
	}

	// Prefer inventory dimensions when present
	try {
		const inv = JSON.parse(readFileSync(path.join(ARTIFACT_ROOT, "inventory.json"), "utf8")) as {
			recordings?: Array<{ path: string; width?: number; height?: number; durationSec?: number }>;
		};
		const hit = inv.recordings?.find((r) => r.path === c.mediaPath);
		if (hit?.width) width = hit.width;
		if (hit?.height) height = hit.height;
		if (hit?.durationSec && durationSec <= 0) durationSec = hit.durationSec;
	} catch {
		/* optional */
	}

	const document = buildDoc(c.mediaPath, durationSec, c.caseId, {
		webcamPath: sidecars.webcamPath,
		width,
		height,
	});

	const holder = makeSink();
	let error: string | null = null;
	let result: Awaited<ReturnType<typeof invokeOpenScreenAgent>> | null = null;
	const agent0 = Date.now();
	try {
		result = await invokeOpenScreenAgent({
			document,
			userMessage: c.prompt,
			history: [],
			editsAllowed: true,
			speechCacheDir: path.join(cacheDir, "speech-agent"),
			model: {
				provider: "openai",
				model: modelName,
				apiKey,
				baseUrl: "https://api.openai.com/v1",
			},
			cursor: {
				async probe({ originalPath }) {
					if (!originalPath) return false;
					const sidecar = await readCursorSidecar(originalPath, {});
					return sidecar.found;
				},
				async read({ assetId, originalPath }) {
					if (!originalPath) {
						return { status: "unavailable" as const, assetId, note: "no originalPath" };
					}
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
			},
			sink: holder.sink,
		});
	} catch (e) {
		error = e instanceof Error ? e.message : String(e);
	}
	const agentInvokeMs = Date.now() - agent0;

	const rawText = holder.getRaw() || result?.text || "";
	const finalResponse =
		stripInternalEvidenceJsonBlocks(result?.text || rawText) || result?.text || "";

	writeFileSync(path.join(caseDir, "final-response.txt"), finalResponse, "utf8");
	writeFileSync(path.join(caseDir, "raw-model.txt"), rawText.slice(0, 400_000), "utf8");

	const speechEv = result?.speechEvidence?.[0];
	const frames =
		(result as { visualFrames?: Array<{ sourceTimeSec?: number }> } | null)?.visualFrames ?? [];

	// Perception / evidence bundle (best-effort from return + speech)
	writeJson(path.join(caseDir, "perception.json"), {
		durationSec,
		hasAudioInventory: invAudio,
		speechStatus: speechEv?.status ?? null,
		speechEngine: speechEv?.engine ?? null,
		audioStreamPresent: speechEv?.audioStreamPresent ?? null,
		segmentCount: speechEv?.segments?.length ?? 0,
		segments: (speechEv?.segments ?? []).slice(0, 80).map((s) => ({
			startSec: s.startSourceTimeSec,
			endSec: s.endSourceTimeSec,
			text: s.text,
		})),
		cursorSidecarPresent: Boolean(sidecars.cursorPath),
		webcamPresent: Boolean(sidecars.webcamPath),
		agentToolSinkTrace: holder.toolTrace,
		note: "Frame timestamps live inside agent visual prep; not always returned on InvokeResult.",
		framesReturnedOnResult: frames.length,
	});

	if (result?.investigationEvidence) {
		const inv = result.investigationEvidence;
		writeJson(path.join(caseDir, "investigator.json"), {
			stopReason: inv.stopReason,
			metrics: inv.metrics,
			focusRange: inv.focusRange,
			coverage: inv.coverage,
			claims: inv.claims,
			toolTrace: inv.toolTrace,
			observations: inv.observations?.slice(0, 100),
			additionalFrameCount: inv.additionalFrames?.length ?? 0,
		});
	} else {
		writeJson(path.join(caseDir, "investigator.json"), { present: false });
	}

	if (result?.temporalEventLedger) {
		writeJson(path.join(caseDir, "ledger.json"), result.temporalEventLedger);
	} else {
		writeJson(path.join(caseDir, "ledger.json"), { present: false });
	}

	if (result?.claimPromotion) {
		writeJson(path.join(caseDir, "claims.json"), result.claimPromotion);
	} else {
		writeJson(path.join(caseDir, "claims.json"), { present: false });
	}

	writeJson(path.join(caseDir, "source-story.json"), {
		v1: result?.sourceStory ?? null,
		v2: result?.sourceStoryV2 ?? null,
	});
	writeJson(path.join(caseDir, "target-story.json"), {
		legacy: result?.targetStory ?? null,
		v1: result?.targetStoryV1 ?? null,
	});
	writeJson(path.join(caseDir, "edit-gap.json"), result?.editGapV1 ?? { present: false });
	writeJson(path.join(caseDir, "edit-plan.json"), result?.editPlanV1 ?? { present: false });
	writeJson(path.join(caseDir, "closure.json"), result?.planningClosureV1 ?? { present: false });
	writeJson(path.join(caseDir, "proposal.json"), {
		editProposalV1: result?.editProposalV1 ?? null,
		applyPreviewDiagnostics: result?.applyPreviewV1 ?? null,
		editReview: result?.editReview ?? null,
	});

	if (result?.visualSpecialist) {
		writeJson(path.join(caseDir, "visual-specialist.json"), {
			stopReason: result.visualSpecialist.stopReason,
			metrics: result.visualSpecialist.metrics,
			observationCount: result.visualSpecialist.observations?.length ?? 0,
		});
	}

	// Optional Apply Preview only when naturally proposal_ready + eligible
	let applyReceipt: unknown = { skipped: true, reason: "no_eligible_proposal_ready" };
	let applyMs: number | undefined;
	if (!options.skipApply && result?.editProposalV1 && result.document) {
		const ready = (result.editProposalV1.proposals ?? []).find(
			(p) => p.status === "proposal_ready",
		);
		if (ready) {
			const tApply = Date.now();
			try {
				const applied = await runConsentedApplyPreview({
					document: result.document,
					editProposalV1: result.editProposalV1,
					selectedProposalId: ready.id,
					consent: null,
				});
				// First call without consent builds/checks preflight; if eligible, mint and apply.
				if (applied.preflight.eligible) {
					const consent = mintTestConsent(applied.preflight, ready.id);
					const consented = await runConsentedApplyPreview({
						document: result.document,
						editProposalV1: result.editProposalV1,
						selectedProposalId: ready.id,
						preflight: applied.preflight,
						consent,
					});
					applyReceipt = {
						attempted: true,
						proposalId: ready.id,
						preflightEligible: true,
						consentAccepted: consented.consentAccepted,
						mutatedAndVerified: consented.mutatedAndVerified,
						receipt: consented.receipt,
					};
				} else {
					applyReceipt = {
						attempted: true,
						proposalId: ready.id,
						preflightEligible: false,
						blockingReasons: applied.preflight.blockingReasons,
						receipt: applied.receipt,
					};
				}
			} catch (e) {
				applyReceipt = {
					attempted: true,
					error: e instanceof Error ? e.message : String(e),
				};
			}
			applyMs = Date.now() - tApply;
		}
	}
	writeJson(path.join(caseDir, "apply-receipt.json"), applyReceipt);

	const totalTurnMs = Date.now() - turn0;
	const latency = {
		totalTurnMs,
		agentInvokeMs,
		applyMs: applyMs ?? null,
		model: modelName,
		provider: REAL_CORPUS_BASELINE_V1_ID,
		finishedAtIso: new Date().toISOString(),
	};
	writeJson(path.join(caseDir, "latency.json"), latency);

	const targetV1 = result?.targetStoryV1 as
		| {
				viewerGoal?: string;
				desiredArc?: string;
				clarityIntent?: string;
				preserve?: unknown[];
				removeCandidates?: unknown[];
				unsupportedRequests?: unknown[];
				targetBeats?: unknown[];
		  }
		| undefined;

	const score = scoreCase({
		c,
		finalResponse,
		rawText,
		hasAudio: invAudio !== false,
		speechStatus: speechEv?.status,
		speechSegmentCount: speechEv?.segments?.length ?? 0,
		sourceStoryV2: result?.sourceStoryV2 as { beats?: unknown[]; facts?: unknown[] } | null,
		targetStoryV1: targetV1 ?? null,
		editGapV1: result?.editGapV1 as { gaps?: unknown[] } | null,
		editPlanV1: result?.editPlanV1 as {
			candidates?: unknown[];
			strategies?: unknown[];
			needsMoreEvidence?: boolean;
		} | null,
		planningClosureV1: result?.planningClosureV1 as {
			rounds?: unknown[];
			materialChange?: boolean;
		} | null,
		editProposalV1: result?.editProposalV1 as {
			proposals?: Array<{ status?: string }>;
			summary?: { proposalReadyCount?: number; noSafeCount?: number };
		} | null,
		claimPromotion: result?.claimPromotion as {
			claims?: Array<{ status?: string; kind?: string }>;
		} | null,
		investigation: result?.investigationEvidence
			? {
					stopReason: result.investigationEvidence.stopReason,
					metrics: result.investigationEvidence.metrics,
					toolTrace: result.investigationEvidence.toolTrace,
				}
			: null,
		applyReceipt: applyReceipt as { terminalStatus?: string; mutationsApplied?: number } | null,
		totalTurnMs,
		error,
	});
	writeJson(path.join(caseDir, "score.json"), score);

	writeJson(path.join(caseDir, "model-calls.json"), {
		mainAgentModelCallsEstimate: 1,
		investigatorModelCalls: result?.investigationEvidence?.metrics?.investigatorModelCalls ?? 0,
		investigatorToolCalls: result?.investigationEvidence?.toolTrace?.length ?? 0,
		sinkToolEvents: holder.toolTrace.length,
		notes: [
			"Main agent turn is one invokeOpenScreenAgent; LangGraph may issue multiple model steps internally.",
			"Investigator V1.1 is designed for 0 investigator model calls.",
		],
	});

	return {
		caseId: c.caseId,
		ok: !error,
		error,
		caseDir,
		overall: score.overall,
		latency,
		score,
	};
}
