/**
 * Editorial Evidence Synthesis V1 — offline corpus matrix (0 provider).
 *
 * Run:
 *   npx vitest --run electron/ai-edition/perceptionBenchmark/editorialEvidenceSynthesisV1/editorial-evidence-synthesis-v1-offline.runtime.test.ts
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { classifyMediaContextNeeds } from "../../mediaContextNeeds";
import {
	buildCorrectionScaffold,
	buildFocalTargetCandidates,
	buildReasoningPacketV1,
	serializeReasoningPacket,
	synthesizeEditorialFindings,
	validateEditorialDecisions,
	validateFocalTargetDecisions,
} from "../../reasoningPacket";
import { classifyVideoMemoryQuery } from "../../videoMemory";
import { REAL_CORPUS_CASES } from "../realCorpusBaseline/cases";

const OUT = path.join(process.cwd(), "tmp/perception-benchmark/editorial-evidence-synthesis-v1");
const PROFESSIONAL =
	"What could genuinely be improved to make this recording feel more professional? Only recommend changes supported by this recording.";
const ZOOM =
	"Where would a zoom actually help in this recording, and where would it not help? Only recommend a zoom when there is a specific visible focal target.";

const matrix: Record<string, unknown>[] = [];
let offlinePass = true;

function writeJson(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2));
}

function mem(opts: {
	speech?: string[];
	tempUi?: string[];
	passive?: string[];
	corrections?: string[];
	duration?: number;
}) {
	return {
		providerId: "CURRENT_OPENSCREEN_VIDEO_MEMORY_V1" as const,
		assetId: "a",
		sourceFingerprint: "s".repeat(16),
		programmeFingerprint: "p".repeat(16),
		sourceDurationSec: opts.duration ?? 17,
		ledgerEventCount: 2,
		claimCount: 0,
		sourceStoryBeatCount: 3,
		sourceStorySummary: "fixture story",
		speechWindows: (opts.speech ?? []).map((preview, i) => ({
			startSec: i * 4,
			endSec: i * 4 + 3,
			preview,
		})),
		visualTransitionCount: opts.duration && opts.duration > 20 ? 2 : 0,
		temporaryUiHints: opts.tempUi ?? [],
		contradictionHints: [],
		correctionHints: opts.corrections ?? [],
		passiveChromeHints: opts.passive ?? [],
		uncertainties: [],
		analysisCoverage: {
			speech: (opts.speech?.length ?? 0) > 0,
			visual: true,
			cursor: false,
			investigator: false,
		},
		createdAtIso: new Date().toISOString(),
		evidenceVersion: 1,
	};
}

function gap(opts: {
	hud?: boolean;
	correction?: boolean;
	pacing?: boolean;
	preserveText?: string;
}) {
	const gaps = [];
	if (opts.hud) {
		gaps.push({
			id: "gap_hud",
			category: "distracting_temporary_ui",
			problemStatement: "Temporary Restart recording HUD visible near end",
			desiredChange: "Hide or trim HUD flash",
			importance: "medium",
			confidence: "high",
			sourceEpistemic: "observed",
			provenance: {
				sourceBeatIds: ["b_end"],
				targetBeatIds: [],
				sourceRange: { startSourceTimeSec: 17.5, endSourceTimeSec: 18.5 },
			},
			constraints: [],
		});
	}
	if (opts.correction) {
		gaps.push({
			id: "gap_corr",
			category: "hesitation_or_correction_friction",
			problemStatement: "Speaker corrected Timeline intention to Effects",
			desiredChange: "Clarify superseded wording",
			importance: "high",
			confidence: "high",
			sourceEpistemic: "spoken",
			provenance: {
				sourceBeatIds: ["b_corr"],
				targetBeatIds: [],
				correctionIds: ["corr_1"],
				sourceRange: { startSourceTimeSec: 2, endSourceTimeSec: 6 },
			},
			constraints: [],
		});
	}
	if (opts.pacing) {
		gaps.push({
			id: "gap_pace",
			category: "pacing_excess",
			problemStatement: "Measured silence gap >2s between speech windows",
			desiredChange: "Consider trimming dead air if not intentional",
			importance: "low",
			confidence: "medium",
			sourceEpistemic: "supported",
			provenance: {
				sourceBeatIds: ["b_silence"],
				targetBeatIds: [],
				sourceRange: { startSourceTimeSec: 8, endSourceTimeSec: 11 },
			},
			constraints: [],
		});
	}
	return {
		version: 1,
		providerId: "CURRENT_OPENSCREEN_EDIT_GAP_V1",
		assetId: "a",
		summary: "fixture",
		gaps,
		preserved: opts.preserveText
			? [
					{
						id: "pres_fx",
						text: opts.preserveText,
						sourceBeatIds: ["b_corr"],
						targetBeatIds: ["t1"],
						reason: "corrected meaning",
					},
				]
			: [],
		unresolved: [],
		hardConstraints: [],
		metrics: {
			sourceBeatsConsumed: 1,
			targetBeatsConsumed: 1,
			gapsCreated: gaps.length,
			preservationConstraints: opts.preserveText ? 1 : 0,
			missingSupportGaps: 0,
			serializedBytesApprox: 200,
			buildMs: 1,
			additionalModelCalls: 0,
			providerId: "CURRENT_OPENSCREEN_EDIT_GAP_V1",
		},
	} as never;
}

function runCase(opts: {
	id: string;
	prompt: string;
	duration: number;
	speech?: string[];
	tempUi?: string[];
	passive?: string[];
	corrections?: string[];
	gap?: Parameters<typeof gap>[0];
	frames?: number;
	expectImproveMin?: number;
	expectPreserveMin?: number;
	expectLeaveMin?: number;
	forbidPanelOpen?: boolean;
	coverageNot?: "INSUFFICIENT";
	mediaPath?: string;
}) {
	const needs = classifyMediaContextNeeds(opts.prompt);
	const qc = classifyVideoMemoryQuery(opts.prompt, needs);
	const memory = mem({
		speech: opts.speech,
		tempUi: opts.tempUi,
		passive: opts.passive,
		corrections: opts.corrections,
		duration: opts.duration,
	});
	const frames = Array.from({ length: opts.frames ?? 4 }, (_, i) => ({
		sourceTimeSec: (opts.duration / Math.max(1, opts.frames ?? 4)) * i,
		reason: (i === 1 ? "editorial_focus" : "coverage_anchor") as const,
		note: `sample @ ${i}`,
	}));
	const spoken = (opts.speech ?? []).map((t, i) => ({
		text: t,
		status: "spoken" as const,
		sourceTimeSec: i * 4,
		claimId: `pc_${i}`,
	}));
	const scaffold = buildCorrectionScaffold({
		userMessage: opts.prompt,
		spoken,
		claims: null,
	});
	const focal = buildFocalTargetCandidates({
		userMessage: opts.prompt,
		queryClass: qc,
		frameMeta: frames,
		known: (opts.tempUi ?? []).map((t) => ({
			text: t,
			status: "known" as const,
			provenanceNote: "temporary_ui≠action",
		})),
		spoken,
	});
	const editGapV1 = opts.gap ? gap(opts.gap) : null;
	const syn = synthesizeEditorialFindings({
		userMessage: opts.prompt,
		editGapV1,
		known: (opts.tempUi ?? []).map((t, i) => ({
			text: t,
			status: "known" as const,
			sourceTimeSec: opts.duration - 1,
			claimId: `hud_${i}`,
			provenanceNote: "temporary_ui≠action",
		})),
		spoken,
		focalTargets: focal,
		preservationConstraints: opts.gap?.preserveText
			? [opts.gap.preserveText]
			: ["Keep core demo meaning"],
		correctionScaffold: scaffold,
		memory,
		selectedSpeechCount: memory.speechWindows.length,
	});

	const packet = buildReasoningPacketV1({
		phase: qc === "editorial" ? "PLAN" : "UNDERSTAND",
		userMessage: opts.prompt,
		queryClass: qc,
		queryScope: "whole_media",
		contextNeeds: needs,
		speechMediaState: (opts.speech?.length ?? 0) > 0 ? "available" : "no_audio",
		memory,
		claims: null,
		frameMeta: frames,
		visualCoverage: {
			coverageSufficient: true,
			coveredBuckets: [0, 1, 2, 3],
			bucketCount: 5,
		} as never,
		projectProjection: {
			primaryAssetId: "a",
			durationSec: opts.duration,
			clipCount: 1,
			hasTranscript: (opts.speech?.length ?? 0) > 0,
			visualFramesSupplied: true,
			speechStatus: "available",
			programmeNote: "n",
		},
		historyConstraints: [],
		imagesAttached: frames.length,
		editGapV1,
	});
	const ser = serializeReasoningPacket(packet);

	const row = {
		id: opts.id,
		duration: opts.duration,
		mediaExists: opts.mediaPath ? existsSync(opts.mediaPath) : null,
		queryClass: qc,
		decisionKind: packet.decisionKind,
		storyBeats: memory.sourceStoryBeatCount,
		sourceFindings: syn.findings.length,
		gapFindings: syn.findings.filter((f) => f.sourceLayer === "edit_gap").length,
		visualFindings: syn.findings.filter((f) => /focus|transition|temporary|passive/i.test(f.kind))
			.length,
		speechFindings: syn.findings.filter(
			(f) => f.sourceLayer === "speech" || f.sourceLayer === "correction",
		).length,
		temporaryUiFindings: syn.findings.filter((f) => f.kind === "distracting_temporary_ui").length,
		preserveFindings: syn.coverage.preserveCount,
		leaveAsIsFindings: syn.coverage.leaveAsIsCount,
		improveCandidates: syn.coverage.improveCandidateCount,
		unknownFindings: syn.coverage.unknownCount,
		dedupedFindings: syn.findings.map((f) => ({
			id: f.id,
			kind: f.kind,
			disposition: f.disposition,
			sourceLayer: f.sourceLayer,
			actionClaimForbidden: f.actionClaimForbidden ?? false,
		})),
		coverageStatus: syn.coverage.status,
		coverageNotes: syn.coverage.notes,
		packetChars: ser.chars,
		focalCandidates: packet.focalTargetCandidates.length,
	};
	matrix.push(row);

	if (opts.expectImproveMin != null) {
		expect(syn.coverage.improveCandidateCount).toBeGreaterThanOrEqual(opts.expectImproveMin);
	}
	if (opts.expectPreserveMin != null) {
		expect(syn.coverage.preserveCount).toBeGreaterThanOrEqual(opts.expectPreserveMin);
	}
	if (opts.expectLeaveMin != null) {
		expect(syn.coverage.leaveAsIsCount).toBeGreaterThanOrEqual(opts.expectLeaveMin);
	}
	if (opts.forbidPanelOpen) {
		expect(
			syn.findings.every(
				(f) => !/\bopened\s+(?:the\s+)?(?:Timeline|Effects)\s+panel\b/i.test(f.statement),
			),
		).toBe(true);
	}
	if (opts.coverageNot) {
		expect(syn.coverage.status).not.toBe(opts.coverageNot);
	}
	return { syn, packet, row };
}

describe("Editorial Evidence Synthesis V1 — offline", () => {
	afterAll(() => {
		writeJson("offline-matrix.json", matrix);
		writeJson("offline-gate.json", {
			offlinePass,
			rule: "PAID_SMOKE only if offlinePass and at least one case with improve+preserve",
		});
		writeFileSync(
			path.join(OUT, "NOTICE.md"),
			"# Editorial Evidence Synthesis V1\nOffline first. DO_NOT_PROMOTE.\n",
		);
	});

	it("writes editorial-finding-source-map.json", () => {
		writeJson("editorial-finding-source-map.json", {
			criticalBugFixed: {
				id: "edit_gap_field_mismatch",
				was: "editGapV1.items",
				now: "editGapV1.gaps (with items fixture fallback)",
			},
			sources: [
				{ id: "edit_gap_v1", canCreate: "yes", field: "gaps[] + preserved[]" },
				{ id: "edit_plan_v1", canCreate: "partial", note: "skips generic preserve boilerplate" },
				{
					id: "correction_scaffold",
					canCreate: "yes",
					kinds: ["hesitation_or_correction_friction", "preservation_requirement"],
				},
				{
					id: "memory_temporary_ui",
					canCreate: "yes",
					kind: "distracting_temporary_ui",
					actionClaimForbidden: true,
				},
				{ id: "memory_passive_chrome", canCreate: "yes", disposition: "LEAVE_AS_IS" },
				{ id: "known_hint", canCreate: "partial", filters: ["WEAK_OCR_CROP", "MENU_CHROME"] },
				{ id: "focal_candidates", canCreate: "partial", gate: "zoom/focus ask only" },
				{ id: "preservation_constraints", canCreate: "yes", disposition: "PRESERVE" },
				{ id: "synthesis_leave_as_is", canCreate: "yes", when: "no improve + stable narration" },
				{ id: "source_story_v2", canCreate: "no_direct", note: "via gap/preserve upstream" },
				{ id: "claim_promotion", canCreate: "partial", via: "known/spoken buckets" },
				{ id: "temporal_ledger", canCreate: "no_direct" },
				{ id: "investigator", canCreate: "no_direct" },
				{
					id: "silence_pacing",
					canCreate: "partial",
					via: "edit_gap pacing_excess only when evidenced",
				},
			],
		});
	});

	it("A–J offline professional finding synthesis", () => {
		const c001 = REAL_CORPUS_CASES.find((c) => c.caseId === "case-001");
		const c002 = REAL_CORPUS_CASES.find((c) => c.caseId === "case-002");
		const c020 = REAL_CORPUS_CASES.find((c) => c.caseId === "case-020");

		runCase({
			id: "A_narrated_stable",
			prompt: PROFESSIONAL,
			duration: 17,
			speech: [
				"Today I show the open screen editor demo",
				"First we look at the timeline",
				"Now open the technical audit document",
			],
			gap: {},
			expectPreserveMin: 1,
			expectLeaveMin: 1,
			expectImproveMin: 0,
			coverageNot: "INSUFFICIENT",
			mediaPath: c001?.mediaPath,
		});

		const case4 = runCase({
			id: "B_case4_correction",
			prompt: PROFESSIONAL,
			duration: 12,
			speech: ["Open the Timeline panel", "I meant the Effects panel"],
			corrections: ["I meant the Effects panel"],
			gap: {
				correction: true,
				preserveText: "Preserve corrected Effects meaning",
			},
			expectImproveMin: 1,
			expectPreserveMin: 1,
			forbidPanelOpen: true,
			coverageNot: "INSUFFICIENT",
		});
		expect(case4.syn.findings.some((f) => f.kind === "hesitation_or_correction_friction")).toBe(
			true,
		);

		runCase({
			id: "C_case020",
			prompt: ZOOM,
			duration: 30,
			speech: ["I think you can see that this is a cursor"],
			frames: 6,
			gap: { hud: false },
			passive: ["Upwork tab visible"],
			mediaPath: c020?.mediaPath,
		});

		const case2 = runCase({
			id: "D_case2_temporary_ui",
			prompt: PROFESSIONAL,
			duration: 22,
			speech: ["checking the recording controls"],
			tempUi: ["Restart recording control visible near end"],
			gap: { hud: true },
			mediaPath: c002?.mediaPath,
			expectImproveMin: 1,
		});
		expect(case2.syn.findings.some((f) => f.kind === "distracting_temporary_ui")).toBe(true);
		expect(
			case2.syn.findings
				.filter((f) => f.kind === "distracting_temporary_ui")
				.every((f) => f.actionClaimForbidden),
		).toBe(true);

		runCase({
			id: "E_settings",
			prompt: "Did I actually open Settings in this recording?",
			duration: 15,
			speech: ["maybe settings"],
			frames: 4,
		});

		runCase({
			id: "F_upwork",
			prompt: PROFESSIONAL,
			duration: 18,
			speech: [],
			passive: ["Upwork chrome badge"],
			expectLeaveMin: 1,
		});

		runCase({
			id: "G_restart",
			prompt: PROFESSIONAL,
			duration: 20,
			tempUi: ["Restart recording HUD"],
			gap: { hud: true },
			expectImproveMin: 1,
		});

		runCase({
			id: "H_no_audio",
			prompt: PROFESSIONAL,
			duration: 10,
			speech: [],
			frames: 3,
		});

		runCase({
			id: "I_visually_changing",
			prompt: PROFESSIONAL,
			duration: 24,
			speech: ["walking through the editor"],
			frames: 6,
			gap: { pacing: true },
			expectImproveMin: 1,
		});

		runCase({
			id: "J_longest_29s",
			prompt: PROFESSIONAL,
			duration: 29,
			speech: ["intro", "middle explanation", "closing notes"],
			frames: 7,
			gap: {},
			expectPreserveMin: 1,
		});

		const withBoth = matrix.some(
			(r) =>
				(r as { improveCandidates: number }).improveCandidates > 0 &&
				(r as { preserveFindings: number }).preserveFindings > 0,
		);
		const insufficient = matrix.filter(
			(r) => (r as { coverageStatus: string }).coverageStatus === "INSUFFICIENT",
		);
		offlinePass = withBoth && insufficient.length === 0;
		writeJson("finding-completeness.json", {
			withImproveAndPreserve: withBoth,
			insufficientCases: insufficient.map((r) => (r as { id: string }).id),
			offlinePass,
		});
		expect(withBoth).toBe(true);
		expect(insufficient.length).toBe(0);
	});

	it("sidecar validators", () => {
		const sideEd = validateEditorialDecisions({
			text: 'EDITORIAL_DECISIONS: [{"findingId":"gap_hud","disposition":"IMPROVE","rationale":"hide"}]',
			findings: [
				{
					id: "gap_hud",
					kind: "distracting_temporary_ui",
					category: "distracting_temporary_ui",
					range: { startSec: 18, endSec: 19 },
					evidenceRefs: [],
					confidence: "high",
					preservationImpact: "editable",
					statement: "HUD",
					epistemicState: "observed",
					sourceLayer: "edit_gap",
					disposition: "IMPROVE_CANDIDATE",
					linkedClaimIds: [],
					linkedBeatIds: [],
				},
			],
		});
		expect(sideEd.ok).toBe(true);
		const sideFocal = validateFocalTargetDecisions({
			text: 'FOCAL_TARGET_DECISIONS: [{"candidateId":"focal_1","decision":"NOT_HELPFUL","reason":"n"}]',
			candidates: [
				{
					id: "focal_1",
					range: { startSec: 1, endSec: 2 },
					subject: "x",
					evidenceRefs: [],
					targetKind: "editor_area",
					visibilityConfidence: "medium",
					reasonCandidate: "t",
				},
			],
		});
		expect(sideFocal.incomplete).toBe(false);
		writeJson("sidecar-validator-tests.json", { editorial: sideEd, focal: sideFocal });
	});
});
