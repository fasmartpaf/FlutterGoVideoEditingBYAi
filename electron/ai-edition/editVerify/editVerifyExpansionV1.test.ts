/**
 * Local Edit Verification Expansion V1 — unit tests (0 paid AI).
 */

import { beforeEach, describe, expect, it } from "vitest";
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
	clearEditVerifyFrameCache,
	cropExcludesRegion,
	editVerifyFrameCacheKey,
	expectedProgrammeDurationForSpeed,
	getCachedEditVerifyFrame,
	LOCAL_EDIT_VERIFY_EXPANSION_V1_PROVIDER_ID,
	planProgrammeSamples,
	runConsentedVerifiedEdit,
	setCachedEditVerifyFrame,
	verifySpeedTiming,
	verifyZoomGeometry,
} from "./index";

const FIXTURE_CREATED_AT = "2026-01-01T00:00:00.000Z";

beforeEach(() => {
	clearEditVerifyFrameCache();
});

function makePreflight(proposalId: string, preflightId: string, fp: string): ApplyPreflight {
	return {
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
}

function mintConsent(proposalId: string, preflightId: string, fp: string) {
	return createApplyConsent({
		proposalId,
		preflight: makePreflight(proposalId, preflightId, fp),
	});
}

function fixtureDoc(durationSec = 20): AxcutDocument {
	const base = createEmptyDocument({
		title: "EditVerify",
		projectId: "proj_ev",
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
				originalPath: "/tmp/ev.mp4",
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

describe("LOCAL_EDIT_VERIFY_EXPANSION_V1", () => {
	it("zoom geometry: valid focus/scale and target visibility", () => {
		const ok = verifyZoomGeometry({
			depth: 3,
			focus: { cx: 0.5, cy: 0.5 },
			startMs: 1000,
			endMs: 4000,
			targetRegion: { x: 0.4, y: 0.4, width: 0.1, height: 0.1 },
		});
		expect(ok.status).toBe("OK");
		expect(ok.targetFullyVisible).toBe(true);
		expect(ok.scale).toBeCloseTo(1.8, 5);
	});

	it("zoom geometry: invalid focus and out-of-bounds target fail", () => {
		const badFocus = verifyZoomGeometry({
			depth: 3,
			focus: { cx: 1.5, cy: 0.5 },
			startMs: 0,
			endMs: 1000,
		});
		expect(badFocus.status).toBe("INVALID_FOCUS");

		const clipped = verifyZoomGeometry({
			depth: 6,
			focus: { cx: 0.5, cy: 0.5 },
			startMs: 0,
			endMs: 1000,
			targetRegion: { x: 0.0, y: 0.0, width: 0.05, height: 0.05 },
		});
		expect(clipped.status).toBe("TARGET_CLIPPED");
	});

	it("crop geometry: empty / oob / valid / protected exclusion", () => {
		expect(classifyCrop({ crop: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 } }).classification).toBe(
			"VALID_CROP",
		);
		expect(classifyCrop({ crop: { x: 0, y: 0, width: 0, height: 0.5 } }).classification).toBe(
			"EMPTY_CROP",
		);
		expect(classifyCrop({ crop: { x: 0.8, y: 0.8, width: 0.5, height: 0.5 } }).classification).toBe(
			"OUT_OF_BOUNDS",
		);
		expect(
			cropExcludesRegion(
				{ x: 0.6, y: 0.6, width: 0.3, height: 0.3 },
				{ x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
			),
		).toBe(true);
	});

	it("speed timing: 0.5x / 1x / 2x programme duration", () => {
		expect(expectedProgrammeDurationForSpeed(10, 2)).toBe(5);
		expect(expectedProgrammeDurationForSpeed(10, 0.5)).toBe(20);
		expect(verifySpeedTiming({ multiplier: 1.25, sourceStartSec: 0, sourceEndSec: 10 }).ok).toBe(
			true,
		);
		expect(verifySpeedTiming({ multiplier: 0.01, sourceStartSec: 0, sourceEndSec: 10 }).ok).toBe(
			false,
		);
	});

	it("bounded samples + frame cache keyed by fingerprint", () => {
		const plan = planProgrammeSamples({
			rangeStartSec: 2,
			rangeEndSec: 5,
			programmeDurationSec: 20,
		});
		expect(plan.mid).toBe(3.5);
		expect(plan.all.length).toBeGreaterThanOrEqual(3);

		const key = editVerifyFrameCacheKey({
			documentFingerprint: "abc",
			programmeTimeSec: 1.5,
			width: 64,
			height: 36,
		});
		expect(getCachedEditVerifyFrame(key)).toBeNull();
		setCachedEditVerifyFrame(key, {
			evidenceId: "e1",
			requestedProgrammeTimeSec: 1.5,
			status: "ok",
			frameProvider: "injected_test",
			width: 64,
			height: 36,
			pixelFormat: "rgba8",
			byteLength: 1,
			compositorBackend: "injected",
			capturePath: "injected",
			latencyMs: {
				sceneBuildMs: 0,
				compositorSetupMs: 0,
				presentMs: 0,
				readFrameMs: 0,
				exportMs: 0,
				decodeMs: 0,
				perFrameMs: 0,
			},
		});
		expect(getCachedEditVerifyFrame(key)?.evidenceId).toBe("e1");
		clearEditVerifyFrameCache();
		expect(getCachedEditVerifyFrame(key)).toBeNull();
	});

	it("fingerprint changes when crop/zoom/speed mutate", () => {
		const doc = fixtureDoc();
		const a = fingerprintDocument(doc).value;
		const withZoom = {
			...doc,
			zoomRanges: [
				{
					id: "z1",
					startMs: 1000,
					endMs: 3000,
					depth: 3 as const,
					focus: { cx: 0.5, cy: 0.5 },
				},
			],
		};
		expect(fingerprintDocument(withZoom).value).not.toBe(a);
		const withCrop = {
			...doc,
			timeline: {
				...doc.timeline,
				clips: doc.timeline.clips.map((c) =>
					c.id === "clip_1" ? { ...c, cropRegion: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } } : c,
				),
			},
		};
		expect(fingerprintDocument(withCrop).value).not.toBe(a);
		const withSpeed = {
			...doc,
			legacyEditor: { speedRegions: [{ id: "s1", startMs: 0, endMs: 2000, speed: 2 }] },
		};
		expect(fingerprintDocument(withSpeed).value).not.toBe(a);
	});

	it("consented valid zoom verifies; blank compositor rolls back", async () => {
		const doc = fixtureDoc();
		const fp = fingerprintDocument(doc).value;
		const consent = mintConsent("prop_zoom_ok", "pf_zoom_ok", fp);
		const ok = await runConsentedVerifiedEdit({
			document: doc,
			consent,
			documentFingerprint: fp,
			preflightId: "pf_zoom_ok",
			proposalId: "prop_zoom_ok",
			family: "zoom",
			zoom: {
				id: "zoom_1",
				startSec: 2,
				endSec: 6,
				depth: 3,
				focus: { cx: 0.5, cy: 0.5 },
				targetRegion: { x: 0.42, y: 0.42, width: 0.1, height: 0.1 },
			},
			sampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedAsAuthoritative: true,
		});
		expect(ok.terminalStatus).toBe("verified");
		expect(ok.mutatedAndVerified).toBe(true);
		expect(ok.document.zoomRanges.some((z) => z.id === "zoom_1")).toBe(true);
		expect(ok.verify?.claims).toContain("zoom_rendered_as_specified");

		const consent2 = mintConsent("prop_zoom_blank", "pf_zoom_blank", fp);
		const fail = await runConsentedVerifiedEdit({
			document: doc,
			consent: consent2,
			documentFingerprint: fp,
			preflightId: "pf_zoom_blank",
			proposalId: "prop_zoom_blank",
			family: "zoom",
			zoom: {
				id: "zoom_2",
				startSec: 2,
				endSec: 6,
				depth: 3,
				focus: { cx: 0.5, cy: 0.5 },
			},
			sampler: createInjectedCompositorSampler({ mode: "blank" }),
			allowInjectedAsAuthoritative: true,
		});
		expect(fail.terminalStatus).toBe("rolled_back");
		expect(fail.rollbackFingerprintMatch).toBe(true);
		expect(fail.document.zoomRanges).toHaveLength(0);
	});

	it("invalid focus / unavailable compositor / no consent fail closed", async () => {
		const doc = fixtureDoc();
		const fp = fingerprintDocument(doc).value;

		const noConsent = await runConsentedVerifiedEdit({
			document: doc,
			consent: null,
			documentFingerprint: fp,
			preflightId: "pf_nc",
			proposalId: "prop_nc",
			family: "zoom",
			zoom: {
				id: "z",
				startSec: 1,
				endSec: 2,
				depth: 3,
				focus: { cx: 0.5, cy: 0.5 },
			},
			sampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedAsAuthoritative: true,
		});
		expect(noConsent.terminalStatus).toBe("blocked_no_consent");
		expect(noConsent.mutationAttempted).toBe(false);

		const consent = mintConsent("prop_bad_focus", "pf_bad_focus", fp);
		const bad = await runConsentedVerifiedEdit({
			document: doc,
			consent,
			documentFingerprint: fp,
			preflightId: "pf_bad_focus",
			proposalId: "prop_bad_focus",
			family: "zoom",
			zoom: {
				id: "z_bad",
				startSec: 1,
				endSec: 3,
				depth: 3,
				focus: { cx: -0.2, cy: 0.5 },
			},
			sampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedAsAuthoritative: true,
		});
		expect(bad.terminalStatus).toBe("rolled_back");
		expect(bad.verify?.blockingReasons.some((b) => b.includes("focus"))).toBe(true);

		const consentU = mintConsent("prop_unavail", "pf_unavail", fp);
		const unavail = await runConsentedVerifiedEdit({
			document: doc,
			consent: consentU,
			documentFingerprint: fp,
			preflightId: "pf_unavail",
			proposalId: "prop_unavail",
			family: "zoom",
			zoom: {
				id: "z_u",
				startSec: 1,
				endSec: 3,
				depth: 3,
				focus: { cx: 0.5, cy: 0.5 },
			},
			sampler: createInjectedCompositorSampler({ mode: "unavailable" }),
			allowInjectedAsAuthoritative: true,
		});
		expect(unavail.terminalStatus).toBe("rolled_back");
	});

	it("valid crop verifies; protected region exclusion rolls back", async () => {
		const doc = fixtureDoc();
		const fp = fingerprintDocument(doc).value;
		const consent = mintConsent("prop_crop_ok", "pf_crop_ok", fp);
		const ok = await runConsentedVerifiedEdit({
			document: doc,
			consent,
			documentFingerprint: fp,
			preflightId: "pf_crop_ok",
			proposalId: "prop_crop_ok",
			family: "crop",
			crop: { clipId: "clip_1", crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } },
			mustSurvive: [
				{
					id: "ui_btn",
					kind: "normalized_region",
					region: { x: 0.4, y: 0.4, width: 0.1, height: 0.1 },
				},
			],
			sampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedAsAuthoritative: true,
		});
		expect(ok.terminalStatus).toBe("verified");
		expect(ok.verify?.claims).toContain("crop_geometry_valid");

		const consent2 = mintConsent("prop_crop_prot", "pf_crop_prot", fp);
		const fail = await runConsentedVerifiedEdit({
			document: doc,
			consent: consent2,
			documentFingerprint: fp,
			preflightId: "pf_crop_prot",
			proposalId: "prop_crop_prot",
			family: "crop",
			crop: { clipId: "clip_1", crop: { x: 0.7, y: 0.7, width: 0.2, height: 0.2 } },
			mustSurvive: [
				{
					id: "protected",
					kind: "normalized_region",
					region: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
				},
			],
			sampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedAsAuthoritative: true,
		});
		expect(fail.terminalStatus).toBe("rolled_back");
		expect(fail.rollbackFingerprintMatch).toBe(true);
		expect(fail.document.timeline.clips[0]?.cropRegion).toBeUndefined();
	});

	it("valid speed verifies; audio failure rolls back", async () => {
		const doc = fixtureDoc();
		const fp = fingerprintDocument(doc).value;
		const consent = mintConsent("prop_spd_ok", "pf_spd_ok", fp);
		const ok = await runConsentedVerifiedEdit({
			document: doc,
			consent,
			documentFingerprint: fp,
			preflightId: "pf_spd_ok",
			proposalId: "prop_spd_ok",
			family: "speed",
			speed: { id: "spd_1", startSec: 2, endSec: 8, multiplier: 2 },
			measuredAudioDurationSec: 3, // (8-2)/2 = 3
			sampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedAsAuthoritative: true,
		});
		expect(ok.terminalStatus).toBe("verified");
		expect(ok.verify?.claims).toContain("speed_timing_valid");

		const consent2 = mintConsent("prop_spd_aud", "pf_spd_aud", fp);
		const fail = await runConsentedVerifiedEdit({
			document: doc,
			consent: consent2,
			documentFingerprint: fp,
			preflightId: "pf_spd_aud",
			proposalId: "prop_spd_aud",
			family: "speed",
			speed: { id: "spd_2", startSec: 2, endSec: 8, multiplier: 2 },
			forceAudioFailure: true,
			sampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedAsAuthoritative: true,
		});
		expect(fail.terminalStatus).toBe("rolled_back");
		expect(fail.rollbackFingerprintMatch).toBe(true);
		const speeds =
			((fail.document.legacyEditor as Record<string, unknown>).speedRegions as unknown[]) ?? [];
		expect(speeds).toHaveLength(0);
	});

	it("stale fingerprint blocked; paid AI = 0", async () => {
		const doc = fixtureDoc();
		const realFp = fingerprintDocument(doc).value;
		const consent = mintConsent("prop_stale", "pf_stale", "not_the_real_fp");
		const stale = await runConsentedVerifiedEdit({
			document: doc,
			consent,
			documentFingerprint: "not_the_real_fp",
			preflightId: "pf_stale",
			proposalId: "prop_stale",
			family: "zoom",
			zoom: {
				id: "z",
				startSec: 1,
				endSec: 2,
				depth: 3,
				focus: { cx: 0.5, cy: 0.5 },
			},
			sampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedAsAuthoritative: true,
		});
		expect(stale.terminalStatus).toBe("blocked_fingerprint_mismatch");
		expect(stale.mutationAttempted).toBe(false);
		expect(LOCAL_EDIT_VERIFY_EXPANSION_V1_PROVIDER_ID).toContain("EDIT_VERIFY");
		expect(realFp).not.toBe("not_the_real_fp");
	});
});
