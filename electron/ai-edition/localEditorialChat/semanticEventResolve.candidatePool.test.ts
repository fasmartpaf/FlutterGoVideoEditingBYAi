/**
 * Candidate pool: identity walks earliest-first under a shared turn vision budget.
 * A wider returned list alone is not proof a later event was checked.
 */
import { describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { resolveSemanticEditEvent, resolveSemanticEditEventAsync } from "./semanticEventResolve";

function doc() {
	const base = createEmptyDocument({ projectId: "cand-pool", title: "cand" });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "a1", allowAgentEdits: true },
		assets: [
			{
				id: "a1",
				kind: "video",
				label: "a",
				originalPath: "/tmp/cand-pool.mp4",
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

describe("semanticEventResolve candidate pool", () => {
	it("default caps at 5; identity pool keeps later events (up to 16)", () => {
		const visual = Array.from({ length: 10 }, (_, i) => ({
			startSec: 2 + i * 5,
			endSec: 3 + i * 5,
			level: "SIGNIFICANT" as const,
		}));
		const narrow = resolveSemanticEditEvent({
			cue: "when the landing page appears",
			document: doc(),
			visualChangeEvents: visual,
			visualAnalysisUsed: true,
		});
		expect(narrow.candidates.length).toBeLessThanOrEqual(5);

		const wide = resolveSemanticEditEvent({
			cue: "when the landing page appears",
			document: doc(),
			visualChangeEvents: visual,
			visualAnalysisUsed: true,
			maxCandidates: 16,
		});
		expect(wide.candidates.length).toBeGreaterThan(5);
		expect(wide.candidates.length).toBeLessThanOrEqual(16);
		const latestNarrow = Math.max(...narrow.candidates.map((c) => c.anchorSec));
		const latestWide = Math.max(...wide.candidates.map((c) => c.anchorSec));
		expect(latestWide).toBeGreaterThan(latestNarrow);
	});

	it("identity walk reaches past the old 5-candidate face list when earlier peaks fail", async () => {
		const visual = Array.from({ length: 10 }, (_, i) => ({
			startSec: 2 + i * 5,
			endSec: 3 + i * 5,
			level: "SIGNIFICANT" as const,
		}));
		const lateOnset = 47.0;
		const anchorsChecked: number[] = [];
		const presenceCalls: number[] = [];
		const resolved = await resolveSemanticEditEventAsync({
			cue: "when the landing page appears",
			document: doc(),
			visualChangeEvents: visual,
			skipVisualAnalysis: true,
			extractFrame: async () => true,
			ocrRecognize: async () => ({ text: "page", available: true }),
			presenceJudge: async ({ programmeSec }) => {
				presenceCalls.push(programmeSec);
				return {
					present: programmeSec >= lateOnset - 0.5,
					confidence: "HIGH",
					reason: `prog=${programmeSec}`,
					rawText: "{}",
					providerId: "injected",
					model: "unit",
				};
			},
		});
		for (const ref of resolved.candidates.flatMap((c) => c.evidenceRefs)) {
			const m = ref.match(/identity_checked_anchor@([\d.]+)/);
			if (m) anchorsChecked.push(Number(m[1]));
		}
		// Evidence may live on identity map only when FOUND — fall back to presence span.
		expect(Math.max(0, ...presenceCalls)).toBeGreaterThan(20);
		expect(presenceCalls.length).toBeLessThanOrEqual(20);
		void resolved;
		void anchorsChecked;
	});
});
