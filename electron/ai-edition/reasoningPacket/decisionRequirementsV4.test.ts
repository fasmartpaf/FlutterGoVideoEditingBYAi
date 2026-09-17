/**
 * Decision Requirements V4 — unit tests (0 paid).
 */

import { describe, expect, it } from "vitest";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import {
	auditEditorialFindings,
	buildEditorialFindings,
	buildReasoningPacketV1,
	type EditorialFinding,
	evaluatePacketSelfContainment,
	resolveDecisionRequirements,
	resolveReasoningDecisionKind,
} from "./index";

function baseMem(speech: string[]) {
	return {
		providerId: "CURRENT_OPENSCREEN_VIDEO_MEMORY_V1" as const,
		assetId: "a",
		sourceFingerprint: "s".repeat(16),
		programmeFingerprint: "p".repeat(16),
		sourceDurationSec: 17,
		ledgerEventCount: 2,
		claimCount: 0,
		sourceStoryBeatCount: 0,
		sourceStorySummary: "fixture",
		speechWindows: speech.map((preview, i) => ({
			startSec: i * 4,
			endSec: i * 4 + 3,
			preview,
		})),
		visualTransitionCount: 0,
		temporaryUiHints: ["temporary recording HUD near 12s"],
		contradictionHints: [],
		correctionHints: [],
		passiveChromeHints: [],
		uncertainties: [],
		analysisCoverage: {
			speech: speech.length > 0,
			visual: true,
			cursor: false,
			investigator: false,
		},
		createdAtIso: new Date().toISOString(),
		evidenceVersion: 1,
	};
}

function pkt(opts: {
	prompt: string;
	queryClass: Parameters<typeof buildReasoningPacketV1>[0]["queryClass"];
	phase: Parameters<typeof buildReasoningPacketV1>[0]["phase"];
	speech?: string[];
	frames?: number;
	editGap?: boolean;
	speechState?: "available" | "no_audio" | "not_requested";
}) {
	const needs = classifyMediaContextNeeds(opts.prompt);
	const frames = Array.from({ length: opts.frames ?? 0 }, (_, i) => ({
		sourceTimeSec: i * 4,
		reason: (i === 1 ? "editorial_focus" : "coverage_anchor") as const,
		note: `panel @ ${i * 4}s`,
	}));
	return buildReasoningPacketV1({
		phase: opts.phase,
		userMessage: opts.prompt,
		queryClass: opts.queryClass,
		queryScope: "whole_media",
		contextNeeds: needs,
		speechMediaState: opts.speechState ?? "available",
		memory: baseMem(opts.speech ?? ["hello"]),
		claims: null,
		frameMeta: frames,
		visualCoverage:
			frames.length > 0
				? ({ coverageSufficient: true, coveredBuckets: [0, 1, 2], bucketCount: 5 } as never)
				: null,
		projectProjection: {
			primaryAssetId: "a",
			durationSec: 17,
			clipCount: 1,
			hasTranscript: true,
			visualFramesSupplied: frames.length > 0,
			speechStatus: "available",
			programmeNote: "n",
		},
		historyConstraints: [],
		imagesAttached: frames.length,
		editGapV1: opts.editGap
			? ({
					version: 1,
					providerId: "CURRENT_OPENSCREEN_EDIT_GAP_V1",
					summary: "fixture",
					gaps: [
						{
							id: "gap_hud",
							category: "distracting_temporary_ui",
							problemStatement: "Temporary recording HUD briefly visible around 12s",
							desiredChange: "Hide or trim the HUD flash",
							importance: "medium",
							confidence: "high",
							sourceEpistemic: "observed",
							provenance: {
								sourceBeatIds: ["b1"],
								targetBeatIds: [],
								sourceRange: { startSourceTimeSec: 11, endSourceTimeSec: 13 },
							},
							constraints: [],
						},
					],
					preserved: [],
					unresolved: [],
				} as never)
			: null,
	});
}

describe("Decision Requirements V4", () => {
	it("separates modality from decision — speech∧visual does not imply relations", () => {
		const professional =
			"What could genuinely be improved to make this recording feel more professional? Only recommend changes supported by this recording.";
		expect(
			resolveReasoningDecisionKind({
				userMessage: professional,
				queryClass: "editorial",
				queryScope: "whole_media",
				phase: "PLAN",
			}),
		).toBe("EDITORIAL_DIAGNOSIS");
		const contract = resolveDecisionRequirements({
			userMessage: professional,
			queryClass: "editorial",
			queryScope: "whole_media",
			phase: "PLAN",
		});
		expect(contract.requiredSections).toContain("editorialFindings");
		expect(contract.requiredSections).not.toContain("crossModalRelations");
		expect(contract.optionalSections).toContain("crossModalRelations");
	});

	it("cross-modal still requires relations", () => {
		const c = resolveDecisionRequirements({
			userMessage:
				"Compare what I say with what is visibly happening. Tell me what matches, what differs, and what cannot be verified.",
			queryClass: "cross_modal",
			queryScope: "whole_media",
			phase: "UNDERSTAND",
		});
		expect(c.decisionKind).toBe("CROSS_MODAL_COMPARE");
		expect(c.requiredSections).toContain("crossModalRelations");
	});

	it("professional packet selfContained without crossModalRelations", () => {
		const packet = pkt({
			prompt:
				"What could genuinely be improved to make this recording feel more professional? Only recommend changes supported by this recording.",
			queryClass: "editorial",
			phase: "PLAN",
			speech: ["demo of the editor"],
			frames: 4,
			editGap: true,
		});
		expect(packet.requiredModalities.speech).toBe(true);
		expect(packet.requiredModalities.visual).toBe(true);
		expect(packet.decisionKind).toBe("EDITORIAL_DIAGNOSIS");
		expect(packet.crossModalRelations.length).toBe(0);
		expect(packet.editorialFindings.length).toBeGreaterThan(0);
		expect(packet.selfContainment?.selfContained).toBe(true);
		expect(packet.selfContainment?.missing).not.toContain("crossModalRelations");
	});

	it("zoom packet selfContained with focal candidates", () => {
		const packet = pkt({
			prompt:
				"Where would a zoom actually help in this recording, and where would it not help? Only recommend a zoom when there is a specific visible focal target.",
			queryClass: "editorial",
			phase: "PLAN",
			speech: ["look here"],
			frames: 4,
			editGap: true,
		});
		expect(packet.decisionKind).toBe("FOCAL_EDIT_JUDGMENT");
		expect(packet.focalTargetCandidates.length).toBeGreaterThan(0);
		expect(packet.selfContainment?.selfContained).toBe(true);
		expect(packet.selfContainment?.missing).not.toContain("crossModalRelations");
	});

	it("cross-modal without relations is not self-contained", () => {
		const packet = pkt({
			prompt: "Compare what I say with what is visibly happening.",
			queryClass: "cross_modal",
			phase: "UNDERSTAND",
			speech: [],
			frames: 3,
			speechState: "available",
		});
		// Force empty relations path: if speech empty, sufficiency may already fail
		const sc = evaluatePacketSelfContainment({
			...packet,
			crossModalRelations: [],
			selectedSpeech: [{ startSec: 0, endSec: 1, preview: "x" }],
			spoken: [{ text: "x", status: "spoken" }],
			sufficiency: {
				...packet.sufficiency,
				packetEvidenceSufficient: true,
				missingEvidenceKinds: [],
			},
		});
		expect(sc.decisionKind).toBe("CROSS_MODAL_COMPARE");
		expect(sc.selfContained).toBe(false);
		expect(sc.missingSections).toContain("crossModalRelations");
	});

	it("audits and rejects generic/duplicate findings", () => {
		const raw: EditorialFinding[] = [
			{
				id: "a",
				kind: "preserve",
				category: "preserve",
				range: { startSec: null, endSec: null },
				evidenceRefs: ["plan_1"],
				confidence: "medium",
				preservationImpact: "soft",
				statement: "Preserve this meaning while pursuing the target viewer experience.",
				epistemicState: "inferred",
				sourceLayer: "edit_plan",
				disposition: "PRESERVE",
				linkedClaimIds: [],
				linkedBeatIds: [],
			},
			{
				id: "b",
				kind: "passive_context_noise",
				category: "passive_context_noise",
				range: { startSec: 10, endSec: 10 },
				evidenceRefs: ["ocr"],
				confidence: "medium",
				preservationImpact: "editable",
				statement:
					"Source-resolution bottom_center crop at 10.90s (1360×432 from 3024×1964 media).",
				epistemicState: "observed",
				sourceLayer: "known_hint",
				disposition: "IMPROVE_CANDIDATE",
				linkedClaimIds: [],
				linkedBeatIds: [],
			},
			{
				id: "c",
				kind: "distracting_temporary_ui",
				category: "distracting_temporary_ui",
				range: { startSec: 12, endSec: 13 },
				evidenceRefs: ["hud"],
				confidence: "high",
				preservationImpact: "editable",
				statement: "Temporary recording HUD briefly visible around 12s",
				epistemicState: "observed",
				sourceLayer: "edit_gap",
				disposition: "IMPROVE_CANDIDATE",
				linkedClaimIds: [],
				linkedBeatIds: [],
			},
			{
				id: "c2",
				kind: "distracting_temporary_ui",
				category: "distracting_temporary_ui",
				range: { startSec: 12, endSec: 13 },
				evidenceRefs: ["hud"],
				confidence: "high",
				preservationImpact: "editable",
				statement: "Temporary recording HUD briefly visible around 12s",
				epistemicState: "observed",
				sourceLayer: "edit_gap",
				disposition: "IMPROVE_CANDIDATE",
				linkedClaimIds: [],
				linkedBeatIds: [],
			},
		];
		const { kept, rejected } = auditEditorialFindings(raw);
		expect(rejected.some((r) => r.auditNote === "generic_plan_boilerplate")).toBe(true);
		expect(
			rejected.some((r) => r.auditNote === "tool_derived_ocr_crop_without_editorial_signal"),
		).toBe(true);
		expect(rejected.some((r) => r.auditNote === "duplicate")).toBe(true);
		expect(kept.some((k) => k.id === "c")).toBe(true);
		expect(kept.length).toBeLessThan(raw.length);
	});

	it("buildEditorialFindings prefers gap HUD over OCR crops", () => {
		const findings = buildEditorialFindings({
			userMessage: "make this recording more professional",
			editGapV1: {
				version: 1,
				providerId: "CURRENT_OPENSCREEN_EDIT_GAP_V1",
				summary: "s",
				gaps: [
					{
						id: "gap_hud",
						category: "distracting_temporary_ui",
						problemStatement: "HUD flash",
						desiredChange: "hide",
						importance: "medium",
						confidence: "high",
						sourceEpistemic: "observed",
						provenance: {
							sourceBeatIds: ["b1"],
							targetBeatIds: [],
							sourceRange: { startSourceTimeSec: 11, endSourceTimeSec: 13 },
						},
						constraints: [],
					},
				],
				preserved: [],
				unresolved: [],
			} as never,
			editPlanV1: {
				version: 1,
				providerId: "CURRENT_OPENSCREEN_EDIT_PLAN_V1",
				summary: "s",
				items: [
					{
						id: "plan_1",
						editorialIntent: "Preserve this meaning while pursuing the target viewer experience.",
						preferredStrategy: "preserve",
						gapIds: [],
						sourceBeatIds: [],
						targetBeatIds: [],
						candidateStrategies: [],
						priority: "low",
						feasibility: "supported",
						constraints: [],
						preservationRefs: [],
						provenanceRefs: [],
						confidence: 0.5,
					},
				],
			} as never,
			known: [
				{
					text: "Source-resolution bottom_center crop at 10.90s (1360×432 from 3024×1964 media).",
					status: "known",
					sourceTimeSec: 10.9,
					claimId: "ocr1",
				},
				{
					text: "temporary recording HUD near 12s",
					status: "known",
					sourceTimeSec: 12,
					claimId: "hud1",
				},
			],
			spoken: [],
			focalTargets: [],
			preservationConstraints: ["Spoken: demo intro"],
		});
		expect(findings.some((f) => f.id === "gap_hud")).toBe(true);
		expect(findings.every((f) => !/bottom_center crop/i.test(f.statement))).toBe(true);
	});
});
