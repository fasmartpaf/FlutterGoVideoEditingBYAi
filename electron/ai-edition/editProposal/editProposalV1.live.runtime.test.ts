/**
 * Edit Proposal V1 live/offline regressions — proposals only, no execution.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildClaimPromotionSet, resetClaimPromotionSeqForTests } from "../claimPromotion";
import { buildEditGapV1, resetEditGapSeqForTests, validateAndSanitizeEditGapV1 } from "../editGap";
import {
	buildEditPlanV1,
	resetEditPlanSeqForTests,
	validateAndSanitizeEditPlanV1,
} from "../editPlan";
import {
	buildSourceStoryEvidenceInput,
	buildSourceStoryV2,
	resetSourceStoryV2SeqForTests,
} from "../sourceStory/v2";
import type { SpeechEvidence } from "../speechEvidence/types";
import { buildTargetStoryV1, resetTargetStoryV1SeqForTests } from "../targetStory/v1";
import type { TemporalEventLedger } from "../temporalEventLedger/types";
import {
	buildEditProposalV1,
	EDIT_PROPOSAL_V1_PROVIDER_ID,
	evaluateEditProposalRubric,
	leaksExecution,
	resetEditProposalSeqForTests,
	validateAndSanitizeEditProposalV1,
} from "./index";

function led(events: TemporalEventLedger["events"]): TemporalEventLedger {
	return {
		meta: {
			assetId: "live",
			sourceDurationSec: 20,
			timebase: "SOURCE_MEDIA_TIME",
			builtAtIso: new Date().toISOString(),
			constructionMs: 1,
			additionalModelCalls: 0,
			eventCount: events.length,
			claimCount: 0,
			evidenceRefCount: 0,
		},
		events,
	};
}

function speech(segments: SpeechEvidence["segments"]): SpeechEvidence {
	return {
		assetId: "live",
		sourceDurationSec: 20,
		segments,
		status: "available",
		audioStreamPresent: true,
		timings: {
			audioProbeMs: 0,
			audioExtractMs: 0,
			sttMs: 0,
			transcriptParseMs: 0,
			transcriptCacheMs: 0,
			segmentCount: segments.length,
			cacheHit: true,
		},
	};
}

function run(intent: string, events: TemporalEventLedger["events"], sp?: SpeechEvidence) {
	const ledger = led(events);
	const claims = buildClaimPromotionSet({ ledger, lazy: false });
	const source = buildSourceStoryV2(
		buildSourceStoryEvidenceInput({
			assetId: "live",
			sourceDurationSec: 20,
			ledger,
			claimPromotion: claims,
			speechEvidence: sp,
			frames: [],
			changes: [
				{
					fromSourceTimeSec: 2,
					toSourceTimeSec: 4,
					score: 0.3,
					classification: "significant",
				},
			],
		}),
	);
	const target = buildTargetStoryV1({ sourceStoryV2: source, userIntent: intent });
	const gap = validateAndSanitizeEditGapV1(
		buildEditGapV1({ sourceStoryV2: source, targetStoryV1: target, userIntent: intent }),
	).gap;
	const plan = validateAndSanitizeEditPlanV1(
		buildEditPlanV1({ sourceStoryV2: source, targetStoryV1: target, editGapV1: gap }),
	).plan;
	const proposal = validateAndSanitizeEditProposalV1(
		buildEditProposalV1({
			sourceStoryV2: source,
			targetStoryV1: target,
			editGapV1: gap,
			editPlanV1: plan,
		}),
	).proposal;
	return { plan, proposal };
}

describe("Edit Proposal V1 live regressions", () => {
	it("Case 2 / Case 4 / Settings / narrated — proposals only", () => {
		resetClaimPromotionSeqForTests();
		resetSourceStoryV2SeqForTests();
		resetTargetStoryV1SeqForTests();
		resetEditGapSeqForTests();
		resetEditPlanSeqForTests();
		resetEditProposalSeqForTests();
		const t0 = performance.now();

		const case2 = run("Make this professional.", [
			{
				id: "e_r",
				assetId: "live",
				startSourceTimeSec: 18,
				endSourceTimeSec: 19,
				type: "observed_visible_text",
				modalities: ["visual"],
				summary: "Observed visible text: Restart recording",
				claims: [{ id: "c2", text: "Restart recording", epistemic: "observed", evidence: [] }],
				evidence: [],
				confidence: "high",
			},
			{
				id: "e_up",
				assetId: "live",
				startSourceTimeSec: 6,
				endSourceTimeSec: 6,
				type: "passive_chrome",
				modalities: ["visual"],
				summary: "Passive chrome: Upwork (tab)",
				claims: [],
				evidence: [],
				confidence: "medium",
			},
		]);

		const case4 = run(
			"Make this shorter and clearer.",
			[
				{
					id: "e_corr",
					assetId: "live",
					startSourceTimeSec: 8,
					endSourceTimeSec: 10,
					type: "spoken_correction",
					modalities: ["speech"],
					summary: "correction",
					claims: [],
					evidence: [],
					confidence: "high",
				},
			],
			speech([
				{ startSourceTimeSec: 8, endSourceTimeSec: 9, text: "open the timeline panel" },
				{ startSourceTimeSec: 9.2, endSourceTimeSec: 10, text: "I meant the effects panel" },
			]),
		);

		const settings = run(
			"Zoom into Settings when I open it.",
			[
				{
					id: "e_s",
					assetId: "live",
					startSourceTimeSec: 4,
					endSourceTimeSec: 5,
					type: "speech",
					modalities: ["speech"],
					summary: "I'm opening Settings.",
					claims: [],
					evidence: [],
					confidence: "high",
				},
			],
			speech([{ startSourceTimeSec: 4, endSourceTimeSec: 5, text: "I'm opening Settings." }]),
		);

		const narr = run(
			"Make this professional and concise.",
			[
				{
					id: "e_n",
					assetId: "live",
					startSourceTimeSec: 1,
					endSourceTimeSec: 12,
					type: "speech",
					modalities: ["speech"],
					summary: "Narration",
					claims: [],
					evidence: [],
					confidence: "high",
				},
			],
			speech([
				{
					startSourceTimeSec: 1,
					endSourceTimeSec: 12,
					text: "This recording shows the main workspace.",
				},
			]),
		);

		expect(case2.proposal.providerId).toBe(EDIT_PROPOSAL_V1_PROVIDER_ID);
		expect(leaksExecution(JSON.stringify(case2.proposal))).toBe(false);
		expect(JSON.stringify(case2.proposal)).not.toMatch(/Upwork workflow|restart recording action/i);

		expect(
			case4.proposal.proposals.some(
				(p) =>
					p.preferredStrategy === "trim" &&
					(p.mustSurvive.length > 0 || p.damageRisks.some((d) => d.kind === "corrected_intent")),
			),
		).toBe(true);

		expect(settings.proposal.proposals.every((p) => p.preferredStrategy !== "zoom")).toBe(true);
		expect(narr.proposal.proposals.every((p) => p.preferredStrategy !== "zoom")).toBe(true);

		const latencyMs = performance.now() - t0;
		const artifact = {
			providerId: EDIT_PROPOSAL_V1_PROVIDER_ID,
			latencyMs,
			case2: {
				proposals: case2.proposal.proposals.length,
				quality: case2.proposal.quality,
				statuses: case2.proposal.proposals.map((p) => p.status),
				strategies: case2.proposal.proposals.map((p) => p.preferredStrategy),
				rubric: evaluateEditProposalRubric(case2.proposal),
			},
			case4: {
				proposals: case4.proposal.proposals.length,
				quality: case4.proposal.quality,
				statuses: case4.proposal.proposals.map((p) => p.status),
				strategies: case4.proposal.proposals.map((p) => p.preferredStrategy),
				survivalNotes: case4.proposal.proposals.flatMap((p) =>
					p.mustSurvive.map((m) => m.text.slice(0, 80)),
				),
				rubric: evaluateEditProposalRubric(case4.proposal),
			},
			settings: {
				proposals: settings.proposal.proposals.length,
				strategies: settings.proposal.proposals.map((p) => p.preferredStrategy),
				noZoom: settings.proposal.proposals.every((p) => p.preferredStrategy !== "zoom"),
			},
			narrated: {
				proposals: narr.proposal.proposals.length,
				strategies: narr.proposal.proposals.map((p) => p.preferredStrategy),
			},
			modelCalls: 0,
		};

		const outDir = path.join(process.cwd(), "tmp/perception-benchmark/edit-proposal-v1");
		mkdirSync(outDir, { recursive: true });
		writeFileSync(path.join(outDir, "live-regressions.json"), JSON.stringify(artifact, null, 2));
		expect(latencyMs).toBeLessThan(30_000);
	});
});
