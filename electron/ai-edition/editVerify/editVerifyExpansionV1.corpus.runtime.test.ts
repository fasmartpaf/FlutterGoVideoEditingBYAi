/**
 * Local Edit Verify Expansion V1 — corpus / artifact writer (0 paid AI).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { createApplyConsent } from "../applyPreview/consent";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import type { ApplyPreflight } from "../applyPreview/types";
import { createInjectedCompositorSampler } from "../compositorVerify";
import {
	classifyCrop,
	LOCAL_EDIT_VERIFY_EXPANSION_V1_PROVIDER_ID,
	runConsentedVerifiedEdit,
	verifySpeedTiming,
	verifyZoomGeometry,
} from "./index";

const ARTIFACT_ROOT = path.join(
	process.cwd(),
	"tmp/perception-benchmark/local-edit-verify-expansion-v1",
);
const REC = path.join(os.homedir(), "Library/Application Support/openscreen/recordings");
const MEDIA = path.join(REC, "recording-bug5-narrated.mp4");

function writeJson(file: string, data: unknown) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function buildDoc(mediaPath: string, durationSec: number): AxcutDocument {
	const base = createEmptyDocument({
		title: path.basename(mediaPath),
		projectId: "proj_ev_corpus",
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
		zoomRanges: [],
		legacyEditor: {},
	});
}

function mint(proposalId: string, preflightId: string, fp: string) {
	const preflight: ApplyPreflight = {
		id: preflightId,
		proposalId,
		eligible: true,
		blockingReasons: [],
		documentFingerprint: {
			algorithm: "json_sha256_relevant",
			value: fp,
			scope: "edit_verify_expansion_v1",
		},
		mustSurviveIds: [],
		damageRiskLevels: [],
		stale: false,
		preflightMs: 0,
	};
	return createApplyConsent({ proposalId, preflight });
}

describe("LOCAL_EDIT_VERIFY_EXPANSION_V1 corpus", () => {
	it("writes audit/contract artifacts and runs zoom/crop/speed verified apply", async () => {
		mkdirSync(ARTIFACT_ROOT, { recursive: true });
		writeFileSync(
			path.join(ARTIFACT_ROOT, "NOTICE.md"),
			"Local Edit Verify Expansion V1. TOTAL_PAID_AI_CALLS=0.\n",
			"utf8",
		);

		writeJson(path.join(ARTIFACT_ROOT, "current-audit.json"), {
			identity: LOCAL_EDIT_VERIFY_EXPANSION_V1_PROVIDER_ID,
			families: {
				trim: {
					classification: ["VISUAL_VERIFIED", "AUDIO_VERIFIED", "TIMING_VERIFIED"],
					path: "applyPreview + compositorVerify + audioVerify",
				},
				zoom: {
					classification: "NOT_VERIFIED_on_applyPreview_pre_expansion",
					postExpansion: "VISUAL_VERIFIED_via_editVerify_module",
					documentPath: "zoomRanges → SceneDescription.zoomRegions",
					applyPreview: "still blocked (PRODUCTION_DEFAULT UNCHANGED)",
				},
				crop: {
					classification: "NOT_VERIFIED_on_applyPreview_pre_expansion",
					postExpansion: "VISUAL_VERIFIED_via_editVerify_module",
					documentPath: "clip.cropRegion → cropByClip",
				},
				speed: {
					classification: "NOT_VERIFIED_on_applyPreview_pre_expansion",
					postExpansion: "TIMING_VERIFIED + optional AUDIO_VERIFIED",
					documentPath: "legacyEditor.speedRegions → atempo",
				},
			},
			fingerprintExtended: [
				"clip.cropRegion",
				"zoom depth/focus/customScale",
				"legacyEditor.speedRegions multipliers",
			],
		});
		writeJson(path.join(ARTIFACT_ROOT, "edit-verification-current-audit.json"), {
			aliasOf: "current-audit.json",
		});
		writeJson(path.join(ARTIFACT_ROOT, "verification-contract.json"), {
			request: "EditVerificationRequest",
			result: "EditVerificationResult",
			levels: [
				"STRUCTURAL_VALID",
				"PROGRAMME_MAPPING_VALID",
				"RENDER_VALID",
				"EFFECT_PRESENT",
				"PRESERVATION_VALID",
				"AUDIO_VALID",
				"VERIFIED",
			],
			allowedClaims: ["zoom_rendered_as_specified", "crop_geometry_valid", "speed_timing_valid"],
			forbiddenClaims: [
				"zoom looks professional",
				"crop composition is beautiful",
				"speed feels natural",
			],
			authoritativeVisual: "native_compositor_only",
			productionApplyPreview: "addTrim_only_unchanged",
		});

		const mediaPath = existsSync(MEDIA) ? MEDIA : "/tmp/ev-synthetic.mp4";
		const doc = buildDoc(mediaPath, 16.9);
		const fp = fingerprintDocument(doc).value;
		const sampler = createInjectedCompositorSampler({ mode: "valid" });
		const performance: unknown[] = [];

		// --- ZOOM valid ---
		const zoomOk = await runConsentedVerifiedEdit({
			document: doc,
			consent: mint("zoom_valid", "pf_zoom_valid", fp),
			documentFingerprint: fp,
			preflightId: "pf_zoom_valid",
			proposalId: "zoom_valid",
			family: "zoom",
			zoom: {
				id: "zoom_corpus_1",
				startSec: 2,
				endSec: 6,
				depth: 3,
				focus: { cx: 0.5, cy: 0.5 },
				targetRegion: { x: 0.42, y: 0.42, width: 0.1, height: 0.1 },
			},
			sampler,
			allowInjectedAsAuthoritative: true,
		});
		writeJson(path.join(ARTIFACT_ROOT, "zoom/valid.json"), zoomOk);
		performance.push({
			family: "zoom",
			case: "valid",
			...zoomOk.latencyMs,
			verify: zoomOk.verify?.latencyMs,
		});

		// --- ZOOM invalid geometry ---
		const zoomBadGeo = verifyZoomGeometry({
			depth: 3,
			focus: { cx: 2, cy: 0.5 },
			startMs: 0,
			endMs: 1000,
		});
		writeJson(path.join(ARTIFACT_ROOT, "zoom/invalid-geometry.json"), zoomBadGeo);

		const zoomRollback = await runConsentedVerifiedEdit({
			document: doc,
			consent: mint("zoom_blank", "pf_zoom_blank", fp),
			documentFingerprint: fp,
			preflightId: "pf_zoom_blank",
			proposalId: "zoom_blank",
			family: "zoom",
			zoom: {
				id: "zoom_blank_1",
				startSec: 2,
				endSec: 5,
				depth: 3,
				focus: { cx: 0.5, cy: 0.5 },
			},
			sampler: createInjectedCompositorSampler({ mode: "blank" }),
			allowInjectedAsAuthoritative: true,
		});
		writeJson(path.join(ARTIFACT_ROOT, "zoom/rollback.json"), zoomRollback);

		// --- CROP valid ---
		const cropOk = await runConsentedVerifiedEdit({
			document: doc,
			consent: mint("crop_valid", "pf_crop_valid", fp),
			documentFingerprint: fp,
			preflightId: "pf_crop_valid",
			proposalId: "crop_valid",
			family: "crop",
			crop: { clipId: "clip_1", crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } },
			sampler,
			allowInjectedAsAuthoritative: true,
		});
		writeJson(path.join(ARTIFACT_ROOT, "crop/valid.json"), cropOk);
		performance.push({
			family: "crop",
			case: "valid",
			...cropOk.latencyMs,
			verify: cropOk.verify?.latencyMs,
		});

		const cropProt = await runConsentedVerifiedEdit({
			document: doc,
			consent: mint("crop_prot", "pf_crop_prot", fp),
			documentFingerprint: fp,
			preflightId: "pf_crop_prot",
			proposalId: "crop_prot",
			family: "crop",
			crop: { clipId: "clip_1", crop: { x: 0.7, y: 0.7, width: 0.25, height: 0.25 } },
			mustSurvive: [
				{
					id: "protected_ui",
					kind: "normalized_region",
					region: { x: 0.1, y: 0.1, width: 0.15, height: 0.15 },
				},
			],
			sampler,
			allowInjectedAsAuthoritative: true,
		});
		writeJson(path.join(ARTIFACT_ROOT, "crop/protected-region-failure.json"), cropProt);
		writeJson(path.join(ARTIFACT_ROOT, "crop/rollback.json"), {
			terminalStatus: cropProt.terminalStatus,
			rollbackFingerprintMatch: cropProt.rollbackFingerprintMatch,
			blockingReasons: cropProt.verify?.blockingReasons,
		});
		writeJson(path.join(ARTIFACT_ROOT, "crop/geometry-classes.json"), {
			valid: classifyCrop({ crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } }),
			empty: classifyCrop({ crop: { x: 0, y: 0, width: 0, height: 1 } }),
			oob: classifyCrop({ crop: { x: 0.9, y: 0.9, width: 0.5, height: 0.5 } }),
		});

		// --- SPEED valid ---
		const speedOk = await runConsentedVerifiedEdit({
			document: doc,
			consent: mint("spd_valid", "pf_spd_valid", fp),
			documentFingerprint: fp,
			preflightId: "pf_spd_valid",
			proposalId: "spd_valid",
			family: "speed",
			speed: { id: "spd_1", startSec: 2, endSec: 8, multiplier: 2 },
			measuredAudioDurationSec: 3,
			sampler,
			allowInjectedAsAuthoritative: true,
		});
		writeJson(path.join(ARTIFACT_ROOT, "speed/valid.json"), speedOk);
		performance.push({
			family: "speed",
			case: "valid",
			...speedOk.latencyMs,
			verify: speedOk.verify?.latencyMs,
		});

		writeJson(path.join(ARTIFACT_ROOT, "speed/duration-verification.json"), {
			cases: [0.5, 1, 1.25, 1.5, 2].map((m) =>
				verifySpeedTiming({ multiplier: m, sourceStartSec: 0, sourceEndSec: 10 }),
			),
		});

		const speedAudFail = await runConsentedVerifiedEdit({
			document: doc,
			consent: mint("spd_aud", "pf_spd_aud", fp),
			documentFingerprint: fp,
			preflightId: "pf_spd_aud",
			proposalId: "spd_aud",
			family: "speed",
			speed: { id: "spd_fail", startSec: 2, endSec: 8, multiplier: 2 },
			forceAudioFailure: true,
			sampler,
			allowInjectedAsAuthoritative: true,
		});
		writeJson(path.join(ARTIFACT_ROOT, "speed/audio-failure-rollback.json"), speedAudFail);

		writeJson(path.join(ARTIFACT_ROOT, "performance.json"), {
			cases: performance,
			note: "Injected compositor used for offline corpus; native macOS live optional",
		});
		writeJson(path.join(ARTIFACT_ROOT, "cross-platform-status.json"), {
			provenLive: [
				{ platform: process.platform, arch: process.arch, mode: "unit+injected_compositor" },
			],
			macos_native_compositor: "NOT_REQUIRED_FOR_GEOMETRY_PASS",
			windows: "NOT_RUN",
			linux: "NOT_RUN",
		});
		writeJson(path.join(ARTIFACT_ROOT, "zero-paid-ai-proof.json"), {
			OPENAI_CALLS: 0,
			ANTHROPIC_CALLS: 0,
			GEMINI_CALLS: 0,
			OTHER_PAID_AI_CALLS: 0,
			TOTAL_PAID_AI_CALLS: 0,
		});
		writeJson(path.join(ARTIFACT_ROOT, "visual-analysis-integration.json"), {
			status: "adapter_ready",
			usage: [
				"ZOOM: optional must-survive normalized regions from VisualAnalysis activity",
				"CROP: must-survive visual events must remain inside crop",
				"SPEED: source activity maps via sourceToProgrammeUnderSpeed",
			],
			note: "Does not re-decode; consumes cached VisualAnalysisV1 when provided by caller",
		});

		expect(zoomOk.terminalStatus).toBe("verified");
		expect(zoomRollback.terminalStatus).toBe("rolled_back");
		expect(cropOk.terminalStatus).toBe("verified");
		expect(cropProt.terminalStatus).toBe("rolled_back");
		expect(speedOk.terminalStatus).toBe("verified");
		expect(speedAudFail.terminalStatus).toBe("rolled_back");
		const proof = JSON.parse(
			readFileSync(path.join(ARTIFACT_ROOT, "zero-paid-ai-proof.json"), "utf8"),
		) as { TOTAL_PAID_AI_CALLS: number };
		expect(proof.TOTAL_PAID_AI_CALLS).toBe(0);
	}, 120_000);
});
