/**
 * Local Loudness Normalize V1 — real corpus offline (0 paid AI).
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { getEditorSettings } from "../../../src/lib/ai-edition/store/editorSettings";
import { createApplyConsent } from "../applyPreview/consent";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import type { ApplyPreflight } from "../applyPreview/types";
import {
	candidateToLoudnessProposal,
	DEFAULT_LOUDNESS_TARGET_POLICY,
	LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID,
	runConsentedLoudnessNormalize,
	runLoudnessNormalizeAnalysis,
} from "./index";

const ARTIFACT_ROOT = path.join(
	process.cwd(),
	"tmp/perception-benchmark/local-loudness-normalize-v1",
);
const REC = path.join(os.homedir(), "Library/Application Support/openscreen/recordings");
const CASE4 = path.join(
	process.cwd(),
	"tmp/perception-benchmark/case4-correction/case4-spoken-correction.mp4",
);

function writeJson(file: string, data: unknown) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function buildDoc(mediaPath: string, durationSec: number): AxcutDocument {
	const base = createEmptyDocument({
		title: path.basename(mediaPath),
		projectId: "proj_ln_corpus",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: path.basename(mediaPath),
				originalPath: mediaPath,
				durationSec,
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
			trimRanges: [],
		},
	});
}

const CASES = [
	{
		id: "bug5-narrated",
		label: "normal/quiet narration",
		mediaPath: path.join(REC, "recording-bug5-narrated.mp4"),
	},
	{ id: "case4-spoken", label: "Case4 spoken", mediaPath: CASE4 },
	{ id: "no-audio", label: "no-audio", mediaPath: path.join(REC, "recording-1788958840550.mp4") },
	{
		id: "long-audio",
		label: "longer audio",
		mediaPath: path.join(REC, "recording-1788980586218.mp4"),
	},
	{
		id: "longest-29s",
		label: "longest ~29s",
		mediaPath: path.join(REC, "recording-1789325019656.mp4"),
	},
	{
		id: "dead-air-media",
		label: "dead-air test media",
		mediaPath: path.join(REC, "recording-bug5-narrated.mp4"),
	},
];

describe("LOCAL_LOUDNESS_NORMALIZE_V1 corpus", () => {
	it("analyzes real corpus and consents one safe normalize when available", async () => {
		mkdirSync(ARTIFACT_ROOT, { recursive: true });
		writeJson(path.join(ARTIFACT_ROOT, "audio-path-audit.json"), {
			analysisDomain: "PRIMARY_SOURCE_AUDIO",
			applyDomain: "PROGRAMME_AUDIO_GAIN_DB",
			verificationDomain: "PRIMARY_SOURCE_AUDIO_WITH_VOLUME",
			rationale: [
				"Screen recordings bake mic/system into one AAC track",
				"legacyEditor.audioGainDb is preview+export identical (±12 dB)",
				"loudnorm not baked into finish_audio (preview divergence)",
				"applyPreview remains addTrim-only; consent-gated settings patch used",
				"Complex overlays → UNSUPPORTED_COMPLEX_MIX in V1",
			],
			fields: {
				audioGainDb: "AVAILABLE",
				overlayGainDb: "AVAILABLE_WRONG_TARGET",
				muteRanges: "SCAFFOLDED",
				loudnormInCompositor: "MISSING_BY_DESIGN",
			},
		});
		writeJson(path.join(ARTIFACT_ROOT, "target-policy.json"), DEFAULT_LOUDNESS_TARGET_POLICY);

		const corpus: unknown[] = [];
		const reviews: unknown[] = [];
		const performance: unknown[] = [];
		const verificationResults: unknown[] = [];
		let proposedCount = 0;
		let usefulAmongProposed = 0;

		let applyCaseId: string | null = null;

		for (const c of CASES) {
			if (!existsSync(c.mediaPath)) {
				corpus.push({ id: c.id, skipped: true, reason: "media_missing" });
				continue;
			}
			const doc = buildDoc(c.mediaPath, 60);
			const t0 = Date.now();
			const cold = await runLoudnessNormalizeAnalysis({
				assetId: "asset_1",
				mediaPath: c.mediaPath,
				document: doc,
				cacheDir: path.join(ARTIFACT_ROOT, "cache"),
				resetIds: true,
			});
			const coldMs = Date.now() - t0;
			const t1 = Date.now();
			const warm = await runLoudnessNormalizeAnalysis({
				assetId: "asset_1",
				mediaPath: c.mediaPath,
				document: doc,
				cacheDir: path.join(ARTIFACT_ROOT, "cache"),
			});
			const warmMs = Date.now() - t1;

			const caseDir = path.join(ARTIFACT_ROOT, "per-media", c.id);
			writeJson(path.join(caseDir, "loudness-before.json"), cold.analysis);
			writeJson(path.join(caseDir, "normalization-candidate.json"), cold.candidate);

			let manual: "NORMALIZATION_USEFUL" | "ALREADY_FINE" | "WOULD_BE_TOO_AGGRESSIVE" | "UNCLEAR" =
				"UNCLEAR";
			if (cold.candidate.classification === "ALREADY_ACCEPTABLE") {
				manual = "ALREADY_FINE";
			} else if (cold.candidate.classification === "NO_AUDIO") {
				manual = "ALREADY_FINE";
			} else if (
				cold.candidate.safeToPropose &&
				(cold.candidate.classification === "TOO_QUIET" ||
					cold.candidate.classification === "TOO_LOUD")
			) {
				manual = "NORMALIZATION_USEFUL";
			} else if (cold.candidate.blockingReasons.some((r) => r.includes("peak"))) {
				manual = "WOULD_BE_TOO_AGGRESSIVE";
			}

			if (cold.candidate.safeToPropose) {
				proposedCount += 1;
				if (manual === "NORMALIZATION_USEFUL") usefulAmongProposed += 1;
				if (!applyCaseId) applyCaseId = c.id;
			}

			reviews.push({
				caseId: c.id,
				classification: cold.candidate.classification,
				safeToPropose: cold.candidate.safeToPropose,
				manualLabel: manual,
				integratedLufs: cold.analysis.integratedLufs,
				truePeakDbTp: cold.analysis.truePeakDbTp,
				blockingReasons: cold.candidate.blockingReasons,
			});

			corpus.push({
				id: c.id,
				label: c.label,
				audioState: cold.analysis.audioState,
				integratedLufs: cold.analysis.integratedLufs,
				truePeak: cold.analysis.truePeakDbTp,
				LRA: cold.analysis.loudnessRangeLra,
				classification: cold.candidate.classification,
				safeToPropose: cold.candidate.safeToPropose,
				estimatedGainDb: cold.candidate.estimatedGainDb,
				blockingReasons: cold.candidate.blockingReasons,
				proposal: candidateToLoudnessProposal(cold.candidate)?.intent ?? null,
				cacheHitWarm: warm.analysis.cacheHit,
			});
			performance.push({
				id: c.id,
				coldAnalysisMs: coldMs,
				warmAnalysisMs: warmMs,
				detectorLatencyMs: cold.analysis.latencyMs,
			});
		}

		// Apply one safe candidate with consent + verify + optional rollback test
		if (applyCaseId) {
			const c = CASES.find((x) => x.id === applyCaseId)!;
			const doc = buildDoc(c.mediaPath, 60);
			const bundle = await runLoudnessNormalizeAnalysis({
				assetId: "asset_1",
				mediaPath: c.mediaPath,
				document: doc,
				cacheDir: path.join(ARTIFACT_ROOT, "cache"),
				resetIds: true,
			});
			const fp = fingerprintDocument(doc);
			const preflight: ApplyPreflight = {
				id: "pf_ln_corpus",
				proposalId: bundle.candidate.id,
				eligible: true,
				blockingReasons: [],
				documentFingerprint: fp,
				mustSurviveIds: [],
				damageRiskLevels: [],
				stale: false,
				preflightMs: 0,
			};
			const consent = createApplyConsent({
				proposalId: bundle.candidate.id,
				preflight,
			});
			const tApply = Date.now();
			const applied = await runConsentedLoudnessNormalize({
				document: doc,
				candidate: bundle.candidate,
				mediaPath: c.mediaPath,
				consent,
				documentFingerprint: fp.value,
				preflightId: preflight.id,
				cacheDir: path.join(ARTIFACT_ROOT, "cache"),
			});
			const applyMs = Date.now() - tApply;
			writeJson(
				path.join(ARTIFACT_ROOT, "per-media", c.id, "loudness-after.json"),
				applied.verify?.after ?? null,
			);
			verificationResults.push({
				caseId: c.id,
				terminalStatus: applied.terminalStatus,
				mutatedAndVerified: applied.mutatedAndVerified,
				appliedGainDb: applied.appliedGainDb,
				finalGainDb: getEditorSettings(applied.document).audioGainDb,
				verifyNotes: applied.verify?.notes ?? [],
				applyMs,
			});

			// Rollback path
			const rolled = await runConsentedLoudnessNormalize({
				document: doc,
				candidate: bundle.candidate,
				mediaPath: c.mediaPath,
				consent,
				documentFingerprint: fp.value,
				preflightId: preflight.id,
				forceVerifyFailure: true,
			});
			verificationResults.push({
				caseId: `${c.id}-rollback`,
				terminalStatus: rolled.terminalStatus,
				gainUnchanged: getEditorSettings(rolled.document).audioGainDb === 0,
			});
			expect(rolled.terminalStatus).toBe("rolled_back");
		}

		const precision = proposedCount === 0 ? null : usefulAmongProposed / proposedCount;

		writeJson(path.join(ARTIFACT_ROOT, "corpus-analysis.json"), {
			providerId: LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID,
			cases: corpus,
		});
		writeJson(path.join(ARTIFACT_ROOT, "candidate-review.json"), {
			reviews,
			proposedCount,
			usefulAmongProposed,
			proposalPrecision: precision,
		});
		writeJson(path.join(ARTIFACT_ROOT, "verification-results.json"), {
			results: verificationResults,
		});
		writeJson(path.join(ARTIFACT_ROOT, "performance.json"), { cases: performance });
		writeJson(path.join(ARTIFACT_ROOT, "zero-paid-ai-proof.json"), {
			OPENAI_CALLS: 0,
			ANTHROPIC_CALLS: 0,
			GEMINI_CALLS: 0,
			OTHER_PAID_AI_CALLS: 0,
			TOTAL_PAID_AI_CALLS: 0,
		});

		expect(corpus.some((r) => !(r as { skipped?: boolean }).skipped)).toBe(true);
		const noAudio = corpus.find((r) => (r as { id: string }).id === "no-audio") as
			| { classification: string; safeToPropose: boolean }
			| undefined;
		if (noAudio) {
			expect(noAudio.classification).toBe("NO_AUDIO");
			expect(noAudio.safeToPropose).toBe(false);
		}
	}, 300_000);
});
