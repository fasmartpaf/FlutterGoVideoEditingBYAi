/**
 * Event identity: visual_change_observed ≠ requested_event_identified.
 * OCR is evidence only (never exclusive veto when vision can run).
 * Presence samples bound earliest onset across programme frames.
 */

import { describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import {
	identityAnchorsFromCue,
	identityTokensFromCue,
	ONSET_MATCH_TOLERANCE_SEC,
	planAdaptiveOnsetProgrammeSamples,
	verifyRequestedEventIdentity,
} from "./semanticEventIdentity";
import type { VisualPresenceJudge } from "./semanticEventVisionIdentity";

function simpleDoc() {
	const base = createEmptyDocument({ projectId: "id-test", title: "id" });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "a1", allowAgentEdits: true },
		assets: [
			{
				id: "a1",
				kind: "video",
				label: "a",
				originalPath:
					"/Users/osama/Library/Application Support/openscreen/recordings/recording-1789422729178.mp4",
				durationSec: 60,
				createdAt: new Date().toISOString(),
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "c1",
					assetId: "a1",
					sourceStartSec: 0,
					sourceEndSec: 60,
					timelineStartSec: 0,
					timelineEndSec: 60,
					origin: "system",
					reason: "primary",
				},
			],
		},
	});
}

/** UI becomes present at/after onsetProg (inclusive). */
function presenceFromOnset(onsetProg: number): VisualPresenceJudge {
	return async ({ programmeSec }) => ({
		present: programmeSec >= onsetProg - 0.01,
		confidence: "HIGH",
		reason: `present=${programmeSec >= onsetProg - 0.01} at prog ${programmeSec}`,
		rawText: "{}",
		providerId: "injected",
		model: "unit",
	});
}

describe("semanticEventIdentity", () => {
	it("tokenizes cue without memorizing a single product phrase", () => {
		const toks = identityTokensFromCue(
			"Would it help viewers if the landing page appearance stood out more?",
		);
		expect(toks).toContain("landing page");
		const anchors = identityAnchorsFromCue(
			"Would it help viewers if the landing page appearance stood out more?",
		);
		expect(anchors).toContain("landing page");
		expect(anchors).not.toContain("page");
	});

	it("OCR alone never certifies — skipVision stays VISION_UNAVAILABLE", async () => {
		const doc = simpleDoc();
		const r = await verifyRequestedEventIdentity({
			document: doc,
			cue: "when the landing page appears",
			programmeAnchorSec: 20,
			visualChangeObserved: true,
			extractFrame: async () => true,
			ocrRecognize: async (p) =>
				p.includes("before")
					? { text: "code editor sidebar", available: true }
					: { text: "docs mention landing page in chat", available: true },
			skipVision: true,
		});
		expect(r.requestedEventIdentified).toBe(false);
		expect(r.status).toBe("VISION_UNAVAILABLE");
	});

	it("accepts presence search that bounds earliest onset at the candidate", async () => {
		const doc = simpleDoc();
		const onset = 20;
		const r = await verifyRequestedEventIdentity({
			document: doc,
			cue: "when the landing page appears",
			programmeAnchorSec: onset,
			visualChangeObserved: true,
			extractFrame: async () => true,
			ocrRecognize: async () => ({ text: "", available: false }),
			presenceJudge: presenceFromOnset(onset),
		});
		expect(r.requestedEventIdentified).toBe(true);
		expect(r.status).toBe("IDENTIFIED");
		expect(r.onsetBoundStatus).toBe("bounded");
		expect(r.earliestProgrammeSec).toBeCloseTo(onset, 0);
		expect(r.evidenceRefs.some((e) => e.startsWith("presence@"))).toBe(true);
	});

	it("rejects presence that never shows the UI at the candidate", async () => {
		const doc = simpleDoc();
		const r = await verifyRequestedEventIdentity({
			document: doc,
			cue: "when the landing page appears",
			programmeAnchorSec: 0.5,
			visualChangeObserved: true,
			extractFrame: async () => true,
			ocrRecognize: async () => ({ text: "", available: false }),
			presenceJudge: async () => ({
				present: false,
				confidence: "HIGH",
				reason: "chat/IDE only — cue words in text, not the UI",
				rawText: "{}",
				providerId: "injected",
				model: "unit",
			}),
		});
		expect(r.requestedEventIdentified).toBe(false);
		expect(r.status).toBe("NOT_IDENTIFIED");
		expect(r.onsetBoundStatus).toBe("absent_at_candidate");
	});

	it("+ generic-only OCR “page” still IDENTIFIED when vision bounds onset", async () => {
		const doc = simpleDoc();
		const onset = 18;
		let visionCalls = 0;
		const r = await verifyRequestedEventIdentity({
			document: doc,
			cue: "when the landing page appears",
			programmeAnchorSec: onset,
			visualChangeObserved: true,
			extractFrame: async () => true,
			ocrRecognize: async (p) =>
				p.includes("before")
					? { text: "editor chrome", available: true }
					: { text: "hero page footer links", available: true },
			presenceJudge: async (args) => {
				visionCalls += 1;
				return presenceFromOnset(onset)(args);
			},
		});
		expect(visionCalls).toBeGreaterThan(0);
		expect(r.onsetTokens).toContain("page");
		expect(r.evidenceRefs).toContain("ocr_evidence:generic_only_onset");
		expect(r.requestedEventIdentified).toBe(true);
		expect(r.onsetBoundStatus).toBe("bounded");
	});

	it("− generic-only OCR “page” stays NOT_IDENTIFIED when vision says UI absent", async () => {
		const doc = simpleDoc();
		const r = await verifyRequestedEventIdentity({
			document: doc,
			cue: "when the landing page appears",
			programmeAnchorSec: 0.5,
			visualChangeObserved: true,
			extractFrame: async () => true,
			ocrRecognize: async (p) =>
				p.includes("before")
					? { text: "whatsapp chat list", available: true }
					: {
							text: "when the video is recorded it's showing a black page look on it",
							available: true,
						},
			presenceJudge: async () => ({
				present: false,
				confidence: "HIGH",
				reason: "Cursor/WhatsApp — “page” is chat text, not the landing UI",
				rawText: "{}",
				providerId: "injected",
				model: "unit",
			}),
		});
		expect(r.onsetTokens).toContain("page");
		expect(r.evidenceRefs).toContain("ocr_evidence:generic_only_onset");
		expect(r.requestedEventIdentified).toBe(false);
		expect(r.onsetBoundStatus).toBe("absent_at_candidate");
	});

	it("+ earlier IDE/doc OCR “landing” does not veto when vision bounds true UI onset", async () => {
		const doc = simpleDoc();
		const onset = 14;
		const r = await verifyRequestedEventIdentity({
			document: doc,
			cue: "when the landing page appears",
			programmeAnchorSec: onset,
			visualChangeObserved: true,
			extractFrame: async () => true,
			ocrRecognize: async (p) =>
				p.includes("before")
					? {
							text: "README.md: ship the landing page next sprint",
							available: true,
						}
					: { text: "Connect pricing landing page hero", available: true },
			presenceJudge: presenceFromOnset(onset),
		});
		expect(r.matchedTokensBefore.some((t) => /landing/i.test(t))).toBe(true);
		expect(r.evidenceRefs).toContain("ocr_evidence:specific_tokens_in_before");
		expect(r.requestedEventIdentified).toBe(true);
		expect(r.onsetBoundStatus).toBe("bounded");
	});

	it("− earlier IDE OCR “landing” + vision still absent at candidate → not identified", async () => {
		const doc = simpleDoc();
		const r = await verifyRequestedEventIdentity({
			document: doc,
			cue: "when the landing page appears",
			programmeAnchorSec: 5,
			visualChangeObserved: true,
			extractFrame: async () => true,
			ocrRecognize: async () => ({
				text: "open the landing page ticket in Linear",
				available: true,
			}),
			presenceJudge: async () => ({
				present: false,
				confidence: "HIGH",
				reason: "IDE/issue tracker text mentions landing — UI object absent",
				rawText: "{}",
				providerId: "injected",
				model: "unit",
			}),
		});
		expect(r.evidenceRefs).toContain("ocr_evidence:specific_tokens_in_before");
		expect(r.requestedEventIdentified).toBe(false);
		expect(r.onsetBoundStatus).toBe("absent_at_candidate");
	});

	it("late seed with clean absent→present bracket retargets to earliest IDENTIFIED", async () => {
		const doc = simpleDoc();
		const trueOnset = 8.9;
		const late = 15.5;
		expect(late - trueOnset).toBeGreaterThan(ONSET_MATCH_TOLERANCE_SEC);
		const r = await verifyRequestedEventIdentity({
			document: doc,
			cue: "when the landing page appears",
			programmeAnchorSec: late,
			visualChangeObserved: true,
			extractFrame: async () => true,
			ocrRecognize: async () => ({
				text: "Connect landing page scrolled lower",
				available: true,
			}),
			presenceJudge: presenceFromOnset(trueOnset),
		});
		expect(r.requestedEventIdentified).toBe(true);
		expect(r.onsetBoundStatus).toBe("bounded");
		expect(r.earliestProgrammeSec).toBeCloseTo(trueOnset, 0);
		expect(r.evidenceRefs.some((e) => e.includes("retargeted_from_late_candidate"))).toBe(true);
		expect(r.reason).toMatch(/retargeted|first-onset bracket/i);
	});

	it("+ late-onset sibling: candidate near bounded earliest is IDENTIFIED", async () => {
		const doc = simpleDoc();
		const trueOnset = 8.9;
		const r = await verifyRequestedEventIdentity({
			document: doc,
			cue: "when the landing page appears",
			programmeAnchorSec: trueOnset,
			visualChangeObserved: true,
			extractFrame: async () => true,
			ocrRecognize: async (p) =>
				p.includes("before")
					? { text: "App Store listing", available: true }
					: { text: "page", available: true },
			presenceJudge: presenceFromOnset(trueOnset),
		});
		expect(r.evidenceRefs).toContain("ocr_evidence:generic_only_onset");
		expect(r.requestedEventIdentified).toBe(true);
		expect(r.earliestProgrammeSec).toBeCloseTo(trueOnset, 0);
	});

	it("returns insufficient_bracket when UI is present through entire lookback", async () => {
		const doc = simpleDoc();
		const r = await verifyRequestedEventIdentity({
			document: doc,
			cue: "when the landing page appears",
			programmeAnchorSec: 12,
			visualChangeObserved: true,
			extractFrame: async () => true,
			ocrRecognize: async () => ({ text: "", available: false }),
			presenceJudge: async () => ({
				present: true,
				confidence: "HIGH",
				reason: "UI present",
				rawText: "{}",
				providerId: "injected",
				model: "unit",
			}),
		});
		expect(r.requestedEventIdentified).toBe(false);
		expect(r.onsetBoundStatus).toBe("insufficient_bracket");
		expect(r.reason).toMatch(/insufficient|bracket/i);
	});

	it("generic site/page cue reaches vision (does not refuse before presence)", async () => {
		const doc = simpleDoc();
		const cue = "when the site/page appears";
		expect(identityAnchorsFromCue(cue)).toEqual([]);
		const calls: number[] = [];
		const r = await verifyRequestedEventIdentity({
			document: doc,
			cue,
			programmeAnchorSec: 10,
			visualChangeObserved: true,
			extractFrame: async () => true,
			ocrRecognize: async () => ({ text: "page", available: true }),
			presenceJudge: async ({ programmeSec }) => {
				calls.push(programmeSec);
				return {
					present: programmeSec >= 8.5,
					confidence: "HIGH",
					reason: `prog=${programmeSec}`,
					rawText: "{}",
					providerId: "injected",
					model: "unit",
				};
			},
		});
		expect(calls.length).toBeGreaterThan(0);
		expect(r.evidenceRefs.some((e) => e.includes("identity_mode:semantic_cue_vision"))).toBe(true);
		expect(r.evidenceRefs.some((e) => e.includes("onset_plan:adaptive"))).toBe(true);
		expect(r.requestedEventIdentified).toBe(true);
	});

	it("adaptive onset planner stays within vision budget and reaches 0", () => {
		const plan = planAdaptiveOnsetProgrammeSamples({
			anchorSec: 15,
			budget: 6,
		});
		expect(plan[0]).toBeCloseTo(15, 1);
		expect(plan[plan.length - 1]).toBe(0);
		expect(plan.length).toBeLessThanOrEqual(6);
		expect(plan.length).toBeGreaterThan(2);
	});

	it("reappearance after an absent gap is not certified as first onset", async () => {
		const doc = simpleDoc();
		// Present early (0–3), absent mid (3–9), present again from 9 — candidate at 10.
		const r = await verifyRequestedEventIdentity({
			document: doc,
			cue: "when the site/page appears",
			programmeAnchorSec: 10,
			visualChangeObserved: true,
			extractFrame: async () => true,
			ocrRecognize: async () => ({ text: "page", available: true }),
			presenceJudge: async ({ programmeSec }) => {
				const present = programmeSec < 3 || programmeSec >= 9;
				return {
					present,
					confidence: "HIGH",
					reason: `present=${present}@${programmeSec}`,
					rawText: "{}",
					providerId: "injected",
					model: "unit",
				};
			},
		});
		expect(r.requestedEventIdentified).toBe(false);
		expect(r.evidenceRefs.some((e) => e.includes("reappearance_not_first"))).toBe(true);
	});
});
