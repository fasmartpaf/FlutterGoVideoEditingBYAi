/**
 * Editorial Evidence Synthesis V1 — unit tests (0 paid).
 */

import { describe, expect, it } from "vitest";
import {
	buildCorrectionScaffold,
	type EditorialFinding,
	synthesizeEditorialFindings,
	validateEditorialDecisions,
	validateEditorialSpecificity,
	validateFocalTargetDecisions,
} from "./index";

const PROFESSIONAL =
	"What could genuinely be improved to make this recording feel more professional? Only recommend changes supported by this recording.";

function gapHud() {
	return {
		version: 1 as const,
		providerId: "CURRENT_OPENSCREEN_EDIT_GAP_V1" as const,
		assetId: "a",
		summary: "fixture",
		gaps: [
			{
				id: "gap_hud",
				category: "distracting_temporary_ui" as const,
				problemStatement: "Temporary recording HUD visible near end",
				desiredChange: "Hide HUD flash",
				importance: "medium" as const,
				confidence: "high" as const,
				sourceEpistemic: "observed",
				provenance: {
					sourceBeatIds: ["b1"],
					targetBeatIds: [],
					sourceRange: { startSourceTimeSec: 17.8, endSourceTimeSec: 18.3 },
				},
				constraints: [],
			},
		],
		preserved: [
			{
				id: "pres_1",
				text: "Corrected Effects explanation should survive",
				sourceBeatIds: ["b2"],
				targetBeatIds: ["t1"],
				reason: "corrected meaning",
			},
		],
		unresolved: [],
		hardConstraints: [],
		metrics: {
			sourceBeatsConsumed: 1,
			targetBeatsConsumed: 1,
			gapsCreated: 1,
			preservationConstraints: 1,
			missingSupportGaps: 0,
			serializedBytesApprox: 100,
			buildMs: 1,
			additionalModelCalls: 0 as const,
			providerId: "CURRENT_OPENSCREEN_EDIT_GAP_V1" as const,
		},
	};
}

describe("Editorial Evidence Synthesis V1", () => {
	it("projects EditGap.gaps (not .items) into improve candidates", () => {
		const r = synthesizeEditorialFindings({
			userMessage: PROFESSIONAL,
			editGapV1: gapHud() as never,
			known: [],
			spoken: [],
			focalTargets: [],
			preservationConstraints: [],
		});
		expect(r.findings.some((f) => f.id === "gap_hud")).toBe(true);
		expect(r.findings.some((f) => f.disposition === "IMPROVE_CANDIDATE")).toBe(true);
		expect(r.coverage.gapGapsProjected).toBeGreaterThan(0);
		expect(r.coverage.status).not.toBe("INSUFFICIENT");
	});

	it("preserve-only packet can be THIN_BUT_VALID", () => {
		const r = synthesizeEditorialFindings({
			userMessage: PROFESSIONAL,
			editGapV1: null,
			known: [],
			spoken: [
				{ text: "Today I show the editor demo", status: "spoken", sourceTimeSec: 0 },
				{ text: "Now we review architecture notes", status: "spoken", sourceTimeSec: 10 },
			],
			focalTargets: [],
			preservationConstraints: ["Spoken: demo intro must survive"],
			selectedSpeechCount: 2,
		});
		expect(
			r.findings.some((f) => f.disposition === "PRESERVE" || f.disposition === "LEAVE_AS_IS"),
		).toBe(true);
		expect(r.coverage.improveCandidateCount).toBe(0);
		expect(["THIN_BUT_VALID", "SUFFICIENT"]).toContain(r.coverage.status);
	});

	it("temporary UI finding does not authorize restart action in validator", () => {
		const findings: EditorialFinding[] = [
			{
				id: "mem_temp_ui_0",
				kind: "distracting_temporary_ui",
				category: "distracting_temporary_ui",
				range: { startSec: 18, endSec: 19 },
				evidenceRefs: ["hud"],
				confidence: "high",
				preservationImpact: "editable",
				statement: "Restart recording HUD visible",
				epistemicState: "observed",
				sourceLayer: "memory_hint",
				disposition: "IMPROVE_CANDIDATE",
				linkedClaimIds: [],
				linkedBeatIds: [],
				actionClaimForbidden: true,
			},
		];
		const bad = validateEditorialSpecificity({
			text: "The user restarted the recording when the HUD appeared.",
			findings,
			requireSidecar: false,
		});
		expect(bad.hits.some((h) => h.rule === "visibility_to_action")).toBe(true);

		const ok = validateEditorialSpecificity({
			text: "A temporary Restart recording HUD is visible near the end; whether any restart action occurred remains unknown.",
			findings,
			requireSidecar: false,
		});
		expect(ok.hits.some((h) => h.rule === "visibility_to_action")).toBe(false);
	});

	it("correction scaffold yields improve + preserve", () => {
		const scaffold = buildCorrectionScaffold({
			userMessage: "Listen carefully. What did I first say, and how did I correct myself?",
			spoken: [
				{ text: "Open the Timeline panel", status: "spoken", claimId: "c1", sourceTimeSec: 1 },
				{ text: "I meant the Effects panel", status: "spoken", claimId: "c2", sourceTimeSec: 4 },
			],
			claims: null,
		});
		expect(scaffold.present).toBe(true);
		const r = synthesizeEditorialFindings({
			userMessage: PROFESSIONAL,
			editGapV1: null,
			known: [],
			spoken: [
				{ text: "Open the Timeline panel", status: "spoken", claimId: "c1", sourceTimeSec: 1 },
				{ text: "I meant the Effects panel", status: "spoken", claimId: "c2", sourceTimeSec: 4 },
			],
			focalTargets: [],
			preservationConstraints: [],
			correctionScaffold: scaffold,
		});
		expect(r.findings.some((f) => f.kind === "hesitation_or_correction_friction")).toBe(true);
		expect(
			r.findings.some(
				(f) => f.disposition === "PRESERVE" && /Effects|corrected/i.test(f.statement),
			),
		).toBe(true);
		expect(r.findings.every((f) => !/opened the (Timeline|Effects) panel/i.test(f.statement))).toBe(
			true,
		);
	});

	it("rejects unsupported generic findings / advice without grounding", () => {
		const r = validateEditorialSpecificity({
			text: "Add transitions and improve microphone quality.",
			findings: [
				{
					id: "p1",
					kind: "preservation_requirement",
					category: "preservation_requirement",
					range: { startSec: null, endSec: null },
					evidenceRefs: ["preserve"],
					confidence: "high",
					preservationImpact: "preserve",
					statement: "Keep the demo narration",
					epistemicState: "preserve",
					sourceLayer: "preserve",
					disposition: "PRESERVE",
					linkedClaimIds: [],
					linkedBeatIds: [],
				},
			],
			requireSidecar: false,
		});
		expect(r.hits.some((h) => h.rule.startsWith("generic_"))).toBe(true);
	});

	it("dedupes identical findings", () => {
		const r = synthesizeEditorialFindings({
			userMessage: PROFESSIONAL,
			editGapV1: {
				...gapHud(),
				gaps: [gapHud().gaps[0]!, gapHud().gaps[0]!],
			} as never,
			known: [],
			spoken: [],
			focalTargets: [],
			preservationConstraints: [],
		});
		expect(r.findings.filter((f) => f.id === "gap_hud").length).toBe(1);
	});

	it("editorial sidecar validates finding ids", () => {
		const findings: EditorialFinding[] = [
			{
				id: "gap_hud",
				kind: "distracting_temporary_ui",
				category: "distracting_temporary_ui",
				range: { startSec: 18, endSec: 19 },
				evidenceRefs: ["e"],
				confidence: "high",
				preservationImpact: "editable",
				statement: "HUD",
				epistemicState: "observed",
				sourceLayer: "edit_gap",
				disposition: "IMPROVE_CANDIDATE",
				linkedClaimIds: [],
				linkedBeatIds: [],
			},
		];
		const missing = validateEditorialDecisions({
			text: "Looks fine overall.",
			findings,
		});
		expect(missing.incomplete).toBe(true);

		const invented = validateEditorialDecisions({
			text: `EDITORIAL_DECISIONS: [{"findingId":"not_real","disposition":"IMPROVE","rationale":"x"}]`,
			findings,
		});
		expect(invented.hits.some((h) => h.rule === "invented_finding_id")).toBe(true);

		const ok = validateEditorialDecisions({
			text: `EDITORIAL_DECISIONS: [{"findingId":"gap_hud","disposition":"IMPROVE","rationale":"hide HUD"}]`,
			findings,
		});
		expect(ok.ok).toBe(true);
		expect(ok.incomplete).toBe(false);
	});

	it("focal sidecar validates candidate ids", () => {
		const candidates = [
			{
				id: "focal_frame_1",
				range: { startSec: 12, endSec: 13 },
				subject: "panel",
				evidenceRefs: ["f"],
				targetKind: "editor_area" as const,
				visibilityConfidence: "medium" as const,
				reasonCandidate: "t",
			},
		];
		const missing = validateFocalTargetDecisions({
			text: "No zoom is needed.",
			candidates,
		});
		expect(missing.incomplete).toBe(true);

		const ok = validateFocalTargetDecisions({
			text: `FOCAL_TARGET_DECISIONS: [{"candidateId":"focal_frame_1","decision":"NOT_HELPFUL","reason":"already readable"}]\nNo zoom needed.`,
			candidates,
		});
		expect(ok.incomplete).toBe(false);
		expect(ok.ok).toBe(true);
	});

	it("memory temporary UI becomes improve candidate with actionClaimForbidden", () => {
		const r = synthesizeEditorialFindings({
			userMessage: PROFESSIONAL,
			editGapV1: null,
			known: [],
			spoken: [],
			focalTargets: [],
			preservationConstraints: ["Keep demo meaning"],
			memory: {
				providerId: "CURRENT_OPENSCREEN_VIDEO_MEMORY_V1",
				assetId: "a",
				sourceFingerprint: "s".repeat(16),
				programmeFingerprint: "p".repeat(16),
				sourceDurationSec: 20,
				ledgerEventCount: 1,
				claimCount: 0,
				sourceStoryBeatCount: 0,
				sourceStorySummary: "",
				speechWindows: [],
				visualTransitionCount: 0,
				temporaryUiHints: ["Restart recording control visible near end"],
				contradictionHints: [],
				correctionHints: [],
				passiveChromeHints: ["Upwork tab in chrome"],
				uncertainties: [],
				analysisCoverage: { speech: false, visual: true, cursor: false, investigator: false },
				createdAtIso: new Date().toISOString(),
				evidenceVersion: 1,
			},
		});
		const temp = r.findings.find((f) => f.kind === "distracting_temporary_ui");
		expect(temp?.actionClaimForbidden).toBe(true);
		expect(temp?.disposition).toBe("IMPROVE_CANDIDATE");
		expect(r.findings.some((f) => f.disposition === "LEAVE_AS_IS")).toBe(true);
	});
});
