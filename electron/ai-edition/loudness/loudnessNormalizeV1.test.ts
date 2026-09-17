/**
 * Local Loudness Normalize V1 — deterministic unit tests.
 * 0 paid AI.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
	applyNormalizeGainToDocument,
	buildNormalizeCandidate,
	candidateToLoudnessProposal,
	classifyLoudness,
	DEFAULT_LOUDNESS_TARGET_POLICY,
	formatLoudnessReviewCopy,
	hasUnsupportedComplexMix,
	LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID,
	type LoudnessAnalysisV1,
	parseLoudnormPrintJson,
	resetLoudnessCandidateSeqForTests,
	runConsentedLoudnessNormalize,
} from "./index";

const FIXTURE_CREATED_AT = "2026-01-01T00:00:00.000Z";
const CACHE_DIR = join(
	process.cwd(),
	"tmp/perception-benchmark/local-loudness-normalize-v1/test-cache",
);

beforeEach(() => {
	resetLoudnessCandidateSeqForTests();
	mkdirSync(CACHE_DIR, { recursive: true });
});

afterEach(() => {
	try {
		rmSync(CACHE_DIR, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
});

function analysis(partial: Partial<LoudnessAnalysisV1>): LoudnessAnalysisV1 {
	return {
		version: 1,
		measurementVersion: "v1",
		providerId: LOCAL_LOUDNESS_NORMALIZE_V1_PROVIDER_ID,
		assetId: "asset_1",
		mediaPath: "/tmp/rec.mp4",
		analysisDomain: "PRIMARY_SOURCE_AUDIO",
		audioState: "present",
		integratedLufs: -22,
		truePeakDbTp: -6,
		loudnessRangeLra: 4,
		thresholdLufs: -32,
		durationSec: 16,
		ffmpegVersion: "8.1.2",
		parameters: {
			targetIntegratedLufs: -16,
			maxTruePeakDbTp: -1.5,
			lra: 11,
		},
		latencyMs: 1,
		cacheHit: false,
		...partial,
	};
}

function fixtureDoc(opts?: { audioTracks?: boolean; audioGainDb?: number }): AxcutDocument {
	const base = createEmptyDocument({
		title: "Loudness",
		projectId: "proj_ln",
		createdAt: FIXTURE_CREATED_AT,
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "Recording",
				originalPath: "/tmp/rec.mp4",
				durationSec: 20,
			},
		],
		legacyEditor: {
			...(typeof opts?.audioGainDb === "number" ? { audioGainDb: opts.audioGainDb } : {}),
		},
		audioTracks: opts?.audioTracks
			? [
					{
						id: "music_1",
						assetId: "asset_audio",
						kind: "music",
						startMs: 0,
						endMs: 5000,
						durationSec: 5,
						offsetMs: 0,
						gainDb: -6,
						loop: false,
						fadeInMs: 0,
						fadeOutMs: 0,
						muted: false,
						label: "bed",
						origin: "user",
					},
				]
			: [],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId: "asset_1",
					sourceStartSec: 0,
					sourceEndSec: 20,
					timelineStartSec: 0,
					timelineEndSec: 20,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
			trimRanges: [],
		},
	});
}

describe("parseLoudnormPrintJson", () => {
	it("parses loudnorm JSON block", () => {
		const stderr = `
[Parsed_loudnorm_0 @ 0x] 
{
	"input_i" : "-20.07",
	"input_tp" : "-1.92",
	"input_lra" : "3.30",
	"input_thresh" : "-30.40",
	"output_i" : "-16.85",
	"output_tp" : "-1.50",
	"normalization_type" : "dynamic",
	"target_offset" : "0.85"
}
`;
		const p = parseLoudnormPrintJson(stderr);
		expect(p?.inputIntegratedLufs).toBeCloseTo(-20.07, 2);
		expect(p?.inputTruePeakDbTp).toBeCloseTo(-1.92, 2);
		expect(p?.inputLra).toBeCloseTo(3.3, 2);
	});
});

describe("classifyLoudness", () => {
	it("no-audio", () => {
		expect(classifyLoudness(analysis({ audioState: "absent", integratedLufs: null }))).toBe(
			"NO_AUDIO",
		);
	});

	it("quiet / loud / acceptable", () => {
		expect(classifyLoudness(analysis({ integratedLufs: -24, truePeakDbTp: -8 }))).toBe("TOO_QUIET");
		expect(classifyLoudness(analysis({ integratedLufs: -10, truePeakDbTp: -3 }))).toBe("TOO_LOUD");
		expect(classifyLoudness(analysis({ integratedLufs: -16.5, truePeakDbTp: -4 }))).toBe(
			"ALREADY_ACCEPTABLE",
		);
	});

	it("true-peak risk when already loud-ish and peak high", () => {
		expect(classifyLoudness(analysis({ integratedLufs: -15, truePeakDbTp: -0.5 }))).toBe(
			"TRUE_PEAK_RISK",
		);
	});
});

describe("buildNormalizeCandidate", () => {
	it("proposes for quiet audio", () => {
		const c = buildNormalizeCandidate({
			analysis: analysis({ integratedLufs: -24, truePeakDbTp: -10 }),
			document: fixtureDoc(),
		});
		expect(c.classification).toBe("TOO_QUIET");
		expect(c.safeToPropose).toBe(true);
		expect(c.estimatedGainDb).toBeGreaterThan(1.5);
		expect(c.resultingAudioGainDb).toBeLessThanOrEqual(
			DEFAULT_LOUDNESS_TARGET_POLICY.compositorGainLimitDb,
		);
	});

	it("refuses already acceptable", () => {
		const c = buildNormalizeCandidate({
			analysis: analysis({ integratedLufs: -16.2, truePeakDbTp: -4 }),
			document: fixtureDoc(),
		});
		expect(c.safeToPropose).toBe(false);
		expect(c.classification).toBe("ALREADY_ACCEPTABLE");
	});

	it("blocks complex mix", () => {
		expect(hasUnsupportedComplexMix(fixtureDoc({ audioTracks: true }))).toBe(true);
		const c = buildNormalizeCandidate({
			analysis: analysis({ integratedLufs: -24, truePeakDbTp: -10 }),
			document: fixtureDoc({ audioTracks: true }),
		});
		expect(c.safeToPropose).toBe(false);
		expect(c.classification).toBe("UNSUPPORTED_COMPLEX_MIX");
	});

	it("clamps / blocks unsafe true-peak raise", () => {
		const c = buildNormalizeCandidate({
			analysis: analysis({ integratedLufs: -28, truePeakDbTp: -2.0 }),
			document: fixtureDoc(),
		});
		// Ideal +12 would push TP to +10 — must not propose unsafe peak
		if (c.safeToPropose) {
			expect(c.expectedTruePeakDbTp!).toBeLessThanOrEqual(
				DEFAULT_LOUDNESS_TARGET_POLICY.maxTruePeakDbTp + 0.05,
			);
		} else {
			expect(
				c.blockingReasons.some(
					(r) => r.includes("peak") || r.includes("gain") || r.includes("compositor"),
				),
			).toBe(true);
		}
	});

	it("proposal copy has no ffmpeg stderr", () => {
		const c = buildNormalizeCandidate({
			analysis: analysis({ integratedLufs: -24, truePeakDbTp: -10 }),
			document: fixtureDoc(),
		});
		const copy = formatLoudnessReviewCopy(c);
		expect(copy.headline).toMatch(/Normalize the recording audio/);
		expect(copy.detail).not.toMatch(/Parsed_loudnorm/);
		const prop = candidateToLoudnessProposal(c);
		expect(prop?.provisionalArgs.audioGainDb).toBe(c.resultingAudioGainDb);
		expect(prop?.notExecuted).toBe(true);
	});
});

describe("apply + consent", () => {
	it("no consent = no mutation", async () => {
		const doc = fixtureDoc();
		const c = buildNormalizeCandidate({
			analysis: analysis({ integratedLufs: -24, truePeakDbTp: -10 }),
			document: doc,
		});
		const before = getEditorSettings(doc).audioGainDb;
		const result = await runConsentedLoudnessNormalize({
			document: doc,
			candidate: c,
			mediaPath: "/tmp/rec.mp4",
			consent: null,
			documentFingerprint: fingerprintDocument(doc).value,
			preflightId: "pf_ln",
		});
		expect(result.terminalStatus).toBe("blocked_no_consent");
		expect(result.mutationAttempted).toBe(false);
		expect(getEditorSettings(result.document).audioGainDb).toBe(before);
	});

	it("apply changes only audioGainDb", () => {
		const doc = fixtureDoc();
		const next = applyNormalizeGainToDocument(doc, 4.5);
		expect(getEditorSettings(next).audioGainDb).toBe(4.5);
		expect(next.timeline.trimRanges).toEqual(doc.timeline.trimRanges);
		expect(next.timeline.clips).toEqual(doc.timeline.clips);
	});

	it("minted consent shape binds proposal id", () => {
		const doc = fixtureDoc();
		const c = buildNormalizeCandidate({
			analysis: analysis({ integratedLufs: -24, truePeakDbTp: -10 }),
			document: doc,
		});
		const fp = fingerprintDocument(doc);
		const preflight: ApplyPreflight = {
			id: "pf_ln",
			proposalId: c.id,
			eligible: true,
			blockingReasons: [],
			documentFingerprint: fp,
			mustSurviveIds: [],
			damageRiskLevels: [],
			stale: false,
			preflightMs: 0,
		};
		const consent = createApplyConsent({ proposalId: c.id, preflight });
		expect(consent.proposalId).toBe(c.id);
		expect(consent.documentFingerprint).toBe(fp.value);
	});
});
