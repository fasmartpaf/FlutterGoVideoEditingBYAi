/**
 * Recovery 4 — editorial grounding unit tests (no live provider).
 */

import { describe, expect, it } from "vitest";
import type { EditPlanV1 } from "../editPlan/types";
import { inferEditingIntentHints } from "../targetStory/intent";
import {
	buildTrustedEditorialBriefing,
	enforceFinalPlanConsistency,
	hasConcreteEditRecommendation,
	planSupportsConcreteEdits,
} from "./briefing";

function emptyPlan(preferred: Array<string | undefined>): EditPlanV1 {
	return {
		items: preferred.map((p, i) => ({
			id: `item_${i}`,
			preferredStrategy: p,
			editorialIntent: "test",
			candidateStrategies: [],
			risk: "low",
		})),
		summary: "test",
	} as unknown as EditPlanV1;
}

describe("editorialGrounding Recovery 4", () => {
	it("detects concrete edit recommendations", () => {
		expect(hasConcreteEditRecommendation("Add zooms to make it engaging.")).toBe(true);
		expect(hasConcreteEditRecommendation("I don't see a safe edit yet.")).toBe(false);
	});

	it("strips unsupported zoom advice when plan is preservation-only", () => {
		const plan = emptyPlan(["preserve", "needs_more_evidence"]);
		const out = enforceFinalPlanConsistency({
			userFacingText:
				"This is a screen recording of your editor. Add zooms on important buttons to make it more professional.",
			plan,
			gap: null,
		});
		expect(out.strippedConcreteAdvice).toBe(true);
		expect(out.text.toLowerCase()).not.toMatch(/\badd zooms?\b/);
		expect(out.text).toMatch(/don't see a safe|grounded|not yet/i);
		expect(hasConcreteEditRecommendation(out.text)).toBe(false);
	});

	it("allows zoom only when plan prefers zoom", () => {
		const plan = emptyPlan(["zoom"]);
		const out = enforceFinalPlanConsistency({
			userFacingText: "Zoom into the Publish button around 4–6s where the click is evidenced.",
			plan,
			gap: null,
		});
		expect(out.strippedConcreteAdvice).toBe(false);
		expect(out.text).toMatch(/Zoom into the Publish/);
	});

	it("briefing stays compact and lists actionable families", () => {
		const plan = emptyPlan(["trim", "preserve"]);
		const briefing = buildTrustedEditorialBriefing({
			plan,
			target: {
				viewerGoal: "Tighten pacing while keeping the explanation of Effects.",
				objectiveKind: "shorten",
				desiredArc: "clearer shorter walkthrough",
				targetBeats: [],
				removeCandidates: [],
				unsupportedRequests: [],
			} as never,
			gap: {
				gaps: [
					{
						category: "pacing_excess",
						problemStatement: "Low-density hesitation before correction",
						desiredChange: "Compress hesitation",
						provenance: {
							sourceBeatIds: ["sb1"],
							targetBeatIds: ["tb1"],
							sourceRange: { startSourceTimeSec: 2, endSourceTimeSec: 4 },
						},
					},
				],
			} as never,
		});
		expect(briefing).toMatch(/TRUSTED_EDITORIAL_PLAN/);
		expect(briefing).toMatch(/actionableFamilies=\[trim\]/);
		expect(briefing.length).toBeLessThan(4000);
		const support = planSupportsConcreteEdits(plan);
		expect(support.supported.has("trim")).toBe(true);
		expect(support.preservationOnly).toBe(false);
	});
});

describe("inferEditingIntentHints Recovery 4", () => {
	it("keeps shorten when preserve-important wording is present", () => {
		const h = inferEditingIntentHints(
			"Make this video shorter and clearer without removing the important explanation.",
		);
		expect(h.objective).toBe("shorten");
		expect(h.preserveMeaning).toBe(true);
		expect(h.constraints.some((c) => /preserve|important/i.test(c))).toBe(true);
	});

	it("maps professional polish without inventing focus-only objective", () => {
		const h = inferEditingIntentHints("Make this video look more professional.");
		expect(h.objective).toBe("polish");
	});

	it("maps engaging / improve this to polish", () => {
		expect(inferEditingIntentHints("Make this more engaging.").objective).toBe("polish");
		expect(inferEditingIntentHints("Improve this.").objective).toBe("polish");
	});
});

describe("editorialGrounding crop gerund", () => {
	it("strips cropping advice when plan has no crop", () => {
		const plan = emptyPlan(["preserve"]);
		const out = enforceFinalPlanConsistency({
			userFacingText:
				"To polish this, consider cropping unnecessary UI elements and keeping focus on the main content.",
			plan,
			gap: null,
		});
		expect(out.strippedConcreteAdvice).toBe(true);
		expect(out.text.toLowerCase()).not.toMatch(/\bcropping\b/);
	});

	it("keeps caption advice when extraSupportedFamilies includes caption", () => {
		const plan = emptyPlan(["preserve"]);
		const out = enforceFinalPlanConsistency({
			userFacingText: "Add captions for the narration from your transcript.",
			plan,
			gap: null,
			extraSupportedFamilies: ["caption"],
		});
		expect(out.strippedConcreteAdvice).toBe(false);
		expect(out.text.toLowerCase()).toMatch(/\bcaptions?\b/);
	});

	it("strips unverified transition promises", () => {
		const plan = emptyPlan(["preserve"]);
		const out = enforceFinalPlanConsistency({
			userFacingText: "I'll add transitions between the cuts to make it cinematic.",
			plan,
			gap: null,
		});
		expect(out.strippedConcreteAdvice).toBe(true);
		expect(out.reason).toMatch(/transition/);
	});
});
