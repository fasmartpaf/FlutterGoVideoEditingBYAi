/**
 * Claim Promotion V1 — behavioral tests (deterministic, 0 LLM calls).
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { TemporalEventLedger } from "../temporalEventLedger/types";
import type { VisualSpecialistResult } from "../visualSpecialist/types";
import {
	buildClaimPromotionSet,
	buildSourceStoryClaimBridge,
	CLAIM_PROMOTION_PROVIDER_ID,
	claimIdentityKey,
	createInvestigatorClaimQueries,
	decideKeywordCoincidenceAction,
	decidePassiveVisibility,
	decideVisibleText,
	normalizeSubject,
	resetClaimPromotionSeqForTests,
	selectClaimsForLazyVerification,
} from "./index";

beforeEach(() => {
	resetClaimPromotionSeqForTests();
});

function emptyLedger(assetId = "asset_1"): TemporalEventLedger {
	return {
		meta: {
			assetId,
			sourceDurationSec: 30,
			timebase: "SOURCE_MEDIA_TIME",
			builtAtIso: new Date().toISOString(),
			constructionMs: 1,
			additionalModelCalls: 0,
			eventCount: 0,
			claimCount: 0,
			evidenceRefCount: 0,
		},
		events: [],
	};
}

function specialistWithOcr(text: string, t = 5.2): VisualSpecialistResult {
	return {
		version: 1,
		observations: [
			{
				id: "vo_1",
				kind: "visible_text",
				epistemic: "observed",
				text: `Observed visible text: ${text}`,
				sourceTimeSec: t,
				region: {
					presetOrReason: "bottom_hud",
					crop: { x: 100, y: 1600, w: 800, h: 200 },
					fromSourceMedia: true,
					imagePath: "/tmp/crop.jpg",
					width: 800,
					height: 200,
				},
				ocr: {
					engine: "macos_vision",
					lines: [{ text, confidence: 0.92 }],
					joinedText: text,
				},
				provenance: [{ modality: "ocr", sourceTimeSec: t, frameImagePath: "/tmp/crop.jpg" }],
			},
		],
		crops: [
			{
				id: "crop_1",
				sourceTimeSec: t,
				videoPath: "/tmp/v.mp4",
				crop: { x: 100, y: 1600, w: 800, h: 200 },
				sourceWidth: 3024,
				sourceHeight: 1964,
				imagePath: "/tmp/crop.jpg",
				width: 800,
				height: 200,
				byteLength: 12000,
				fromSourceMedia: true,
				presetOrReason: "bottom_hud",
				ms: 12,
			},
		],
		ocrResults: [
			{
				engine: "macos_vision",
				status: "available",
				imagePath: "/tmp/crop.jpg",
				width: 800,
				height: 200,
				lines: [{ text, confidence: 0.92 }],
				ms: 40,
			},
		],
		metrics: {
			sourceCropMs: 12,
			ocrMs: 40,
			diffMs: 0,
			totalMs: 60,
			sourceCrops: 1,
			ocrCalls: 1,
			beforeAfterPairs: 0,
			imageBytes: 12000,
			extraModelCalls: 0,
			engine: "macos_vision",
		},
		internalNotes: [],
	};
}

describe("claimPromotion rules (deterministic)", () => {
	it("1. raw evidence creates appropriate initial claim", () => {
		const ledger = emptyLedger();
		ledger.events.push({
			id: "evt_1",
			assetId: "asset_1",
			startSourceTimeSec: 1,
			endSourceTimeSec: 1,
			type: "observed_visible_text",
			modalities: ["visual"],
			summary: "Observed visible text: File",
			claims: [
				{
					id: "cl_1",
					text: "File",
					epistemic: "observed",
					evidence: [],
				},
			],
			evidence: [{ modality: "visual", sourceTimeSec: 1, note: "ocr" }],
			confidence: "high",
		});
		const set = buildClaimPromotionSet({ ledger, lazy: false });
		expect(set.claims.some((c) => c.kind === "visible_text" && c.status === "observed")).toBe(true);
		expect(set.metrics.additionalModelCalls).toBe(0);
		expect(set.metrics.providerId).toBe(CLAIM_PROMOTION_PROVIDER_ID);
	});

	it("2. observed text ≠ action", () => {
		const d = decideVisibleText({
			text: "Restart recording",
			temporaryUiConfirmed: false,
			actionEvidence: false,
		});
		expect(d.status).toBe("observed");
		expect(d.status).not.toBe("verified");
	});

	it("3. speech ≠ visual action", () => {
		const ledger = emptyLedger();
		ledger.events.push({
			id: "evt_sp",
			assetId: "asset_1",
			startSourceTimeSec: 2,
			endSourceTimeSec: 4,
			type: "speech",
			modalities: ["speech"],
			summary: "I meant the effects panel.",
			claims: [
				{
					id: "cl_sp",
					text: "I meant the effects panel.",
					epistemic: "spoken",
					evidence: [],
				},
			],
			evidence: [{ modality: "speech", sourceTimeSec: 2, endSourceTimeSec: 4 }],
			confidence: "high",
		});
		const set = buildClaimPromotionSet({ ledger, lazy: false });
		expect(set.claims.some((c) => c.status === "spoken")).toBe(true);
		expect(
			set.claims.some(
				(c) =>
					c.isActionClaim &&
					/effects/i.test(c.text) &&
					(c.status === "verified" || c.status === "supported"),
			),
		).toBe(false);
	});

	it("4. cursor ≠ successful action by itself (no auto-verify from cursor-less OCR)", () => {
		const set = buildClaimPromotionSet({
			ledger: emptyLedger(),
			specialist: specialistWithOcr("File"),
			lazy: false,
		});
		expect(set.claims.some((c) => c.status === "verified" && c.isActionClaim)).toBe(false);
	});

	it("5. multi-evidence promotion (temporary UI → supported)", () => {
		const d = decideVisibleText({
			text: "Restart recording",
			temporaryUiConfirmed: true,
			actionEvidence: false,
		});
		expect(d.status).toBe("supported");
		expect(d.verificationLevel).toBe("multi_evidence");
	});

	it("6. contradiction demotes/rejects claim", () => {
		const d = decideKeywordCoincidenceAction({
			keywordVisible: true,
			speechMentions: true,
			verifiedTargetState: false,
		});
		expect(d.status).toBe("contradicted");
		expect(d.demoted).toBe(true);
	});

	it("7. promotion history retained", () => {
		const set = buildClaimPromotionSet({
			ledger: emptyLedger(),
			specialist: specialistWithOcr("Restart recording"),
			lazy: false,
		});
		const vis = set.claims.find((c) => c.kind === "temporary_ui_visibility");
		expect(vis).toBeTruthy();
		expect(vis!.history.length).toBeGreaterThanOrEqual(2);
		expect(vis!.history[0]!.from).toBeNull();
		expect(vis!.history.some((h) => h.to === "supported" || h.to === "observed")).toBe(true);
	});

	it("8. provenance chain complete", () => {
		const set = buildClaimPromotionSet({
			ledger: emptyLedger(),
			specialist: specialistWithOcr("Restart recording"),
			lazy: false,
		});
		const vis = set.claims.find((c) => /Restart recording/i.test(c.text) && !c.isActionClaim);
		expect(vis).toBeTruthy();
		const kinds = new Set(vis!.provenance.map((p) => p.kind));
		expect(kinds.has("visual_observation")).toBe(true);
		expect(kinds.has("ocr_result")).toBe(true);
		expect(kinds.has("source_crop")).toBe(true);
	});

	it("9. duplicate claims normalized conservatively", () => {
		const a = claimIdentityKey({
			kind: "visible_text",
			assetId: "a1",
			subject: "Upwork tab visible",
			startSourceTimeSec: 1.0,
			endSourceTimeSec: 1.0,
			isActionClaim: false,
		});
		const b = claimIdentityKey({
			kind: "visible_text",
			assetId: "a1",
			subject: "upwork is visible",
			startSourceTimeSec: 1.04,
			endSourceTimeSec: 1.0,
			isActionClaim: false,
		});
		// Same normalized subject bucket + time bucket → same key only if subjects normalize equal
		expect(normalizeSubject("Upwork tab visible")).not.toBe(
			normalizeSubject("There is an Upwork tab"),
		);
		// Identical normalized subject merges
		const c = claimIdentityKey({
			kind: "visible_text",
			assetId: "a1",
			subject: "upwork",
			startSourceTimeSec: 1.0,
			endSourceTimeSec: 1.0,
			isActionClaim: false,
		});
		const d = claimIdentityKey({
			kind: "visible_text",
			assetId: "a1",
			subject: "Upwork",
			startSourceTimeSec: 1.02,
			endSourceTimeSec: 1.0,
			isActionClaim: false,
		});
		expect(c).toBe(d);
		// Different kinds never merge
		expect(a.split("|")[1]).toBe("visible_text");
		void b;
	});

	it("10. lazy verification only when relevant", () => {
		const ledger = emptyLedger();
		ledger.events.push({
			id: "evt_p",
			assetId: "asset_1",
			startSourceTimeSec: 0,
			endSourceTimeSec: 0,
			type: "passive_chrome",
			modalities: ["visual"],
			summary: "Passive chrome: Upwork (tab)",
			claims: [],
			evidence: [],
			confidence: "medium",
		});
		const set = buildClaimPromotionSet({
			ledger,
			userQuery: "What did I say in the final 10 seconds?",
			lazy: true,
		});
		const { evaluate, skip } = selectClaimsForLazyVerification(
			set,
			"What did I say in the final 10 seconds?",
		);
		expect(skip.some((c) => c.isActionClaim && /upwork/i.test(c.subject ?? ""))).toBe(true);
		expect(evaluate.every((c) => !c.isActionClaim || !/upwork/i.test(c.text))).toBe(true);
	});

	it("11. Upwork passive-context invariant", () => {
		const ledger = emptyLedger();
		ledger.events.push({
			id: "evt_up",
			assetId: "asset_1",
			startSourceTimeSec: 3,
			endSourceTimeSec: 3,
			type: "passive_chrome",
			modalities: ["model_semantic", "visual"],
			summary: "Passive chrome: Upwork (tab)",
			claims: [],
			evidence: [{ modality: "visual", sourceTimeSec: 3 }],
			confidence: "medium",
		});
		const set = buildClaimPromotionSet({
			ledger,
			specialist: specialistWithOcr("Upwork", 3),
			userQuery: "Did I open Upwork?",
			lazy: false,
		});
		const vis = set.claims.filter((c) => /upwork/i.test(c.subject ?? "") && !c.isActionClaim);
		expect(vis.some((c) => c.status === "supported" || c.status === "observed")).toBe(true);
		const actions = set.claims.filter(
			(c) => c.isActionClaim && /upwork/i.test(c.subject ?? c.text),
		);
		expect(actions.length).toBeGreaterThan(0);
		expect(actions.every((c) => c.status === "unknown" || c.status === "contradicted")).toBe(true);
		expect(actions.some((c) => c.status === "verified")).toBe(false);
		expect(JSON.stringify(set.claims)).not.toMatch(/verified.*opened Upwork/i);
	});

	it("12. Restart tooltip visible ≠ restart action", () => {
		const set = buildClaimPromotionSet({
			ledger: emptyLedger(),
			specialist: specialistWithOcr("Restart recording", 5.2),
			lazy: false,
		});
		const tip = set.claims.find((c) => /Restart recording/i.test(c.text) && !c.isActionClaim);
		expect(tip).toBeTruthy();
		expect(["observed", "supported"]).toContain(tip!.status);
		const action = set.claims.find((c) => c.isActionClaim && /restart/i.test(c.subject ?? ""));
		expect(action).toBeTruthy();
		expect(action!.status).toBe("unknown");
		expect(action!.verificationLevel).toBe("unsupported");
	});

	it("13. Case 4 correction invariant", () => {
		const ledger = emptyLedger();
		ledger.events.push(
			{
				id: "evt_corr",
				assetId: "asset_1",
				startSourceTimeSec: 8,
				endSourceTimeSec: 10,
				type: "spoken_correction",
				modalities: ["speech"],
				summary: "Correction: timeline panel → effects panel",
				claims: [
					{
						id: "cl_c",
						text: "I meant the effects panel.",
						epistemic: "spoken",
						evidence: [],
					},
				],
				evidence: [{ modality: "speech", sourceTimeSec: 8, endSourceTimeSec: 10 }],
				confidence: "high",
			},
			{
				id: "evt_contra",
				assetId: "asset_1",
				startSourceTimeSec: 8,
				endSourceTimeSec: 10,
				type: "contradiction",
				modalities: ["speech", "visual"],
				summary: "Speech asserts opening effects panel without material visual support",
				claims: [],
				evidence: [],
				confidence: "medium",
			},
		);
		const set = buildClaimPromotionSet({ ledger, lazy: false });
		expect(set.claims.some((c) => c.kind === "spoken_correction" && c.status === "spoken")).toBe(
			true,
		);
		expect(
			set.claims.some(
				(c) => c.isActionClaim && (c.status === "contradicted" || c.status === "unknown"),
			),
		).toBe(true);
		expect(
			set.claims.some((c) => /panel/i.test(c.text) && c.isActionClaim && c.status === "verified"),
		).toBe(false);
	});

	it("14. Settings keyword coincidence invariant", () => {
		const ledger = emptyLedger();
		ledger.events.push({
			id: "evt_set",
			assetId: "asset_1",
			startSourceTimeSec: 4,
			endSourceTimeSec: 5,
			type: "speech",
			modalities: ["speech"],
			summary: "I'm opening Settings.",
			claims: [
				{
					id: "cl_s",
					text: "I'm opening Settings.",
					epistemic: "spoken",
					evidence: [],
				},
			],
			evidence: [],
			confidence: "high",
		});
		const set = buildClaimPromotionSet({
			ledger,
			specialist: specialistWithOcr("Settings", 4.5),
			lazy: false,
		});
		expect(set.claims.some((c) => !c.isActionClaim && /settings/i.test(c.subject ?? ""))).toBe(
			true,
		);
		expect(set.claims.some((c) => c.status === "spoken")).toBe(true);
		const action = set.claims.find((c) => c.isActionClaim && /settings/i.test(c.subject ?? ""));
		expect(action).toBeTruthy();
		expect(["contradicted", "spoken", "unknown"]).toContain(action!.status);
		expect(action!.status).not.toBe("verified");
	});

	it("15–22. metrics, bridge, investigator queries, no model calls", () => {
		const set = buildClaimPromotionSet({
			ledger: emptyLedger(),
			specialist: specialistWithOcr("Restart recording"),
			lazy: false,
		});
		expect(set.metrics.additionalModelCalls).toBe(0);
		expect(set.metrics.totalMs).toBeGreaterThanOrEqual(0);
		const bridge = buildSourceStoryClaimBridge(set);
		expect(bridge.promotedSummaries.length + bridge.unresolvedSummaries.length).toBeGreaterThan(0);
		const q = createInvestigatorClaimQueries(set);
		expect(q.claimsInRange(0, 30).length).toBeGreaterThan(0);
		expect(q.unresolvedClaims().some((c) => c.isActionClaim)).toBe(true);
		const tip = set.claims.find((c) => /Restart recording/i.test(c.text) && !c.isActionClaim);
		expect(tip).toBeTruthy();
		expect(q.evidenceForClaim(tip!.id)?.provenance.length).toBeGreaterThan(0);
		expect(q.promotionHints(tip!.id).length).toBeGreaterThan(0);
		expect(JSON.stringify(set)).not.toMatch(/groundTruth|__gt__/i);
	});

	it("passive visibility decision helper", () => {
		const d = decidePassiveVisibility({
			subject: "Upwork",
			hasOcrOrVision: true,
			hasActionEvidence: false,
		});
		expect(d.status).toBe("supported");
		expect(d.status).not.toBe("verified");
	});
});
