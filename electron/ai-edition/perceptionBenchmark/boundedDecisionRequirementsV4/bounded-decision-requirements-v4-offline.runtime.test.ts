/**
 * Bounded Decision Requirements V4 — offline matrix (0 provider).
 *
 * Run:
 *   npx vitest --run electron/ai-edition/perceptionBenchmark/boundedDecisionRequirementsV4/bounded-decision-requirements-v4-offline.runtime.test.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { classifyMediaContextNeeds } from "../../mediaContextNeeds";
import {
	appendReasoningPacketToUserMessage,
	assertReasoningPacketDelivered,
	auditEditorialFindings,
	buildEditorialFindings,
	buildReasoningPacketV1,
	evaluatePacketSelfContainment,
	REASONING_PACKET_MARKER,
	type ReasoningPacketV1,
	resolveToolNeedPolicy,
	type SpeechMediaState,
	serializeReasoningPacket,
	validateEditorialSpecificity,
	validateFocalTargetResponse,
} from "../../reasoningPacket";
import { classifyVideoMemoryQuery } from "../../videoMemory";
import { BOUNDED_REASONING_V1_ID } from "../../videoMemory/productionPath";

const OUT = path.join(process.cwd(), "tmp/perception-benchmark/bounded-decision-requirements-v4");

const matrix: Record<string, unknown>[] = [];
const negatives: Record<string, unknown>[] = [];
const focalRows: Record<string, unknown>[] = [];
const decisionContract: Record<string, unknown>[] = [];

function writeJson(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2));
}

function mem(speech: string[], opts?: { ocr?: string[]; hud?: boolean }) {
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
		temporaryUiHints: opts?.hud ? ["temporary recording HUD around 12s"] : [],
		contradictionHints: [],
		correctionHints: speech.length > 1 ? ["corrected myself"] : [],
		passiveChromeHints: opts?.ocr?.filter((t) => /upwork/i.test(t)) ?? [],
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

function editGapFixture() {
	return {
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
			{
				id: "gap_focus",
				category: "unclear_focus",
				problemStatement: "Editor panel text is small at 8s",
				desiredChange: "Consider zoom on panel if readable target exists",
				importance: "low",
				confidence: "medium",
				sourceEpistemic: "observed",
				provenance: {
					sourceBeatIds: ["b2"],
					targetBeatIds: [],
					sourceRange: { startSourceTimeSec: 7, endSourceTimeSec: 9 },
				},
				constraints: [],
			},
		],
		preserved: [],
		unresolved: [],
	} as never;
}

function runCase(opts: {
	id: string;
	prompt: string;
	speechState: SpeechMediaState;
	speech?: string[];
	frames?: number;
	hud?: boolean;
	ocr?: string[];
	withGap?: boolean;
	expectSelfContained?: boolean;
	expectDecision?: string;
	mustNotRequire?: string[];
	mustRequire?: string[];
}) {
	const needs = classifyMediaContextNeeds(opts.prompt);
	const qc = classifyVideoMemoryQuery(opts.prompt, needs);
	const frames = Array.from({ length: opts.frames ?? 0 }, (_, i) => ({
		sourceTimeSec: i * 4,
		reason: (i === 1 ? "editorial_focus" : "coverage_anchor") as const,
		note: `editor panel @ ${i * 4}s`,
	}));
	const phase = qc === "editorial" ? ("PLAN" as const) : ("UNDERSTAND" as const);
	const packet = buildReasoningPacketV1({
		phase,
		userMessage: opts.prompt,
		queryClass: qc,
		queryScope: "whole_media",
		contextNeeds: needs,
		speechMediaState: opts.speechState,
		memory: mem(opts.speech ?? [], { ocr: opts.ocr, hud: opts.hud }),
		claims: null,
		frameMeta: frames,
		visualCoverage:
			frames.length > 0
				? ({ coverageSufficient: true, coveredBuckets: [0, 1, 2, 3, 4], bucketCount: 5 } as never)
				: null,
		projectProjection: {
			primaryAssetId: "a",
			durationSec: 17,
			clipCount: 1,
			hasTranscript: opts.speechState === "available",
			visualFramesSupplied: frames.length > 0,
			speechStatus: opts.speechState,
			programmeNote: "n",
		},
		historyConstraints: [],
		imagesAttached: frames.length,
		editGapV1: opts.withGap ? editGapFixture() : null,
	});

	const policy = resolveToolNeedPolicy({
		phase,
		packetEvidenceSufficient: packet.sufficiency.packetEvidenceSufficient,
		missingEvidenceKinds: packet.sufficiency.missingEvidenceKinds,
		speechWindows: packet.selectedSpeech.length,
		frameCount: frames.length,
		queryClass: qc,
	});
	const ser = serializeReasoningPacket(packet);
	const appended = appendReasoningPacketToUserMessage(
		{ role: "user", content: opts.prompt },
		ser.text,
	);
	const delivery = assertReasoningPacketDelivered(appended.message);
	const sc = packet.selfContainment!;

	const row = {
		id: opts.id,
		prompt: opts.prompt.slice(0, 120),
		queryClass: qc,
		phase,
		requiredModalities: packet.requiredModalities,
		decisionKind: packet.decisionKind,
		requiredSections: sc.requiredSections,
		optionalSections: sc.optionalSections,
		presentSections: sc.presentSections,
		missingSections: sc.missingSections,
		selfContained: sc.selfContained,
		missing: sc.missing,
		editorialFindings: packet.editorialFindings.length,
		focalCandidates: packet.focalTargetCandidates.length,
		crossModalRelations: packet.crossModalRelations.length,
		toolCount: policy.exposeTools ? policy.toolCount : 0,
		mutatingToolCount: 0,
		modelCallBudget: policy.expectedModelCallBudget,
		packetChars: ser.chars,
		packetDelivered: delivery.ok && appended.delivered,
		identity: BOUNDED_REASONING_V1_ID,
	};
	matrix.push(row);
	decisionContract.push({
		id: opts.id,
		decisionKind: packet.decisionKind,
		required: packet.decisionRequirements.requiredSections,
		optional: packet.decisionRequirements.optionalSections,
		notes: packet.decisionRequirements.notes,
	});

	if (opts.expectDecision) {
		expect(packet.decisionKind).toBe(opts.expectDecision);
	}
	if (opts.expectSelfContained != null) {
		expect(sc.selfContained).toBe(opts.expectSelfContained);
	}
	for (const m of opts.mustNotRequire ?? []) {
		expect(sc.requiredSections).not.toContain(m);
		expect(sc.missing).not.toContain(m);
	}
	for (const m of opts.mustRequire ?? []) {
		expect(sc.requiredSections).toContain(m);
	}
	expect(delivery.ok).toBe(true);
	expect(appended.message).toBeTruthy();
	void REASONING_PACKET_MARKER;
	return packet;
}

describe("Bounded Decision Requirements V4 — offline", () => {
	afterAll(() => {
		writeJson("offline-matrix.json", matrix);
		writeJson("decision-contract.json", decisionContract);
		writeJson("self-containment-tests.json", { matrix, negatives });
		writeJson("focal-target-tests.json", focalRows);
		writeFileSync(
			path.join(OUT, "NOTICE.md"),
			"# Bounded Decision Requirements V4\nOffline + optional paid smoke ≤2.\nDO_NOT_PROMOTE.\n",
		);
	});

	it("A–L offline matrix", () => {
		runCase({
			id: "A_speech",
			prompt: "What did I say near the end?",
			speechState: "available",
			speech: ["open the technical audit document"],
			frames: 0,
			expectDecision: "FACTUAL_SPEECH",
			expectSelfContained: true,
			mustNotRequire: ["crossModalRelations"],
		});
		runCase({
			id: "B_visual_summary",
			prompt: "What do you see happening visually in this recording?",
			speechState: "available",
			speech: ["demo"],
			frames: 4,
			expectDecision: "VISUAL_SUMMARY",
			expectSelfContained: true,
			mustNotRequire: ["crossModalRelations"],
		});
		runCase({
			id: "C_cross_modal",
			prompt:
				"Compare what I say with what is visibly happening. Tell me what matches, what differs, and what cannot be verified.",
			speechState: "available",
			speech: ["show the editor", "look at the timeline"],
			frames: 5,
			expectDecision: "CROSS_MODAL_COMPARE",
			expectSelfContained: true,
			mustRequire: ["crossModalRelations"],
		});
		runCase({
			id: "D_action_verify",
			prompt: "Did I actually open Settings in this recording?",
			speechState: "available",
			speech: ["maybe settings"],
			frames: 4,
			expectDecision: "ACTION_VERIFY",
			expectSelfContained: true,
			mustNotRequire: ["crossModalRelations"],
		});
		runCase({
			id: "E_generic_correction",
			prompt: "Listen carefully. What did I first say, and how did I correct myself?",
			speechState: "available",
			speech: ["open Settings", "actually open the timeline"],
			frames: 3,
			expectDecision: "CORRECTION_UNDERSTANDING",
			expectSelfContained: true,
		});
		runCase({
			id: "F_case4",
			prompt:
				"Watch and listen carefully. Explain what I first say I will do, how I correct myself, and what you can actually verify happened on screen.",
			speechState: "available",
			speech: ["open Settings", "I meant the timeline"],
			frames: 5,
			expectDecision: "CORRECTION_UNDERSTANDING",
			expectSelfContained: true,
		});
		const professional = runCase({
			id: "G_professional",
			prompt:
				"What could genuinely be improved to make this recording feel more professional? Only recommend changes supported by this recording.",
			speechState: "available",
			speech: ["demo of the open screen editor"],
			frames: 5,
			hud: true,
			withGap: true,
			expectDecision: "EDITORIAL_DIAGNOSIS",
			expectSelfContained: true,
			mustNotRequire: ["crossModalRelations"],
			mustRequire: ["editorialFindings"],
		});
		expect(professional.editorialFindings.length).toBeGreaterThan(0);
		expect(professional.crossModalRelations.length).toBe(0);

		const zoom = runCase({
			id: "H_case020_zoom",
			prompt:
				"Where would a zoom actually help in this recording, and where would it not help? Only recommend a zoom when there is a specific visible focal target.",
			speechState: "available",
			speech: ["look at this panel"],
			frames: 5,
			withGap: true,
			expectDecision: "FOCAL_EDIT_JUDGMENT",
			expectSelfContained: true,
			mustNotRequire: ["crossModalRelations"],
			mustRequire: ["focalTargetCandidates"],
		});
		expect(zoom.focalTargetCandidates.length).toBeGreaterThan(0);

		runCase({
			id: "I_settings",
			prompt: "Did I actually open Settings in this recording?",
			speechState: "available",
			speech: ["settings maybe"],
			frames: 4,
			expectDecision: "ACTION_VERIFY",
			expectSelfContained: true,
			mustNotRequire: ["crossModalRelations"],
		});
		runCase({
			id: "J_upwork",
			prompt: "Did I open Upwork?",
			speechState: "not_requested",
			speech: [],
			frames: 4,
			ocr: ["Upwork badge"],
			expectDecision: "ACTION_VERIFY",
		});
		runCase({
			id: "K_restart",
			prompt: "Did I restart the recording?",
			speechState: "not_requested",
			speech: [],
			frames: 4,
			hud: true,
		});
		runCase({
			id: "L_no_audio",
			prompt: "What did I say near the end?",
			speechState: "no_audio",
			speech: [],
			frames: 0,
			expectDecision: "FACTUAL_SPEECH",
			expectSelfContained: true,
		});

		// Context estimates from matrix
		writeJson(
			"context-estimates.json",
			matrix.map((r) => ({
				id: (r as { id: string }).id,
				packetChars: (r as { packetChars: number }).packetChars,
				toolCount: (r as { toolCount: number }).toolCount,
				decisionKind: (r as { decisionKind: string }).decisionKind,
			})),
		);
	});

	it("negative self-containment tests", () => {
		const noFindings = buildReasoningPacketV1({
			phase: "PLAN",
			userMessage:
				"What could genuinely be improved to make this recording feel more professional?",
			queryClass: "editorial",
			queryScope: "whole_media",
			contextNeeds: classifyMediaContextNeeds(
				"What could genuinely be improved to make this recording feel more professional?",
			),
			speechMediaState: "available",
			memory: mem([]),
			claims: null,
			frameMeta: [],
			visualCoverage: null,
			projectProjection: {
				primaryAssetId: "a",
				durationSec: 17,
				clipCount: 1,
				hasTranscript: false,
				visualFramesSupplied: false,
				speechStatus: "available",
				programmeNote: "n",
			},
			historyConstraints: [],
			imagesAttached: 0,
			editGapV1: null,
			editPlanV1: null,
		});
		negatives.push({
			id: "professional_no_findings_no_media",
			selfContained: noFindings.selfContainment?.selfContained,
			missing: noFindings.selfContainment?.missing,
			decisionKind: noFindings.decisionKind,
		});
		expect(noFindings.selfContainment?.selfContained).toBe(false);

		const cm = buildReasoningPacketV1({
			phase: "UNDERSTAND",
			userMessage: "Compare what I say with what is visibly happening.",
			queryClass: "cross_modal",
			queryScope: "whole_media",
			contextNeeds: classifyMediaContextNeeds("Compare what I say with what is visibly happening."),
			speechMediaState: "available",
			memory: mem(["hello timeline"]),
			claims: null,
			frameMeta: [
				{ sourceTimeSec: 0, reason: "coverage_anchor", note: "f0" },
				{ sourceTimeSec: 4, reason: "coverage_anchor", note: "f1" },
			],
			visualCoverage: {
				coverageSufficient: true,
				coveredBuckets: [0, 1],
				bucketCount: 5,
			} as never,
			projectProjection: {
				primaryAssetId: "a",
				durationSec: 17,
				clipCount: 1,
				hasTranscript: true,
				visualFramesSupplied: true,
				speechStatus: "available",
				programmeNote: "n",
			},
			historyConstraints: [],
			imagesAttached: 2,
		});
		const stripped: ReasoningPacketV1 = {
			...cm,
			crossModalRelations: [],
			sufficiency: {
				...cm.sufficiency,
				packetEvidenceSufficient: true,
				missingEvidenceKinds: [],
			},
		};
		const sc = evaluatePacketSelfContainment(stripped);
		negatives.push({
			id: "cross_modal_no_relations",
			selfContained: sc.selfContained,
			missingSections: sc.missingSections,
		});
		expect(sc.selfContained).toBe(false);
		expect(sc.missingSections).toContain("crossModalRelations");
	});

	it("editorial findings audit artifact from V3-style junk", () => {
		const raw = buildEditorialFindings({
			userMessage: "make this more professional",
			editGapV1: editGapFixture(),
			editPlanV1: {
				version: 1,
				providerId: "CURRENT_OPENSCREEN_EDIT_PLAN_V1",
				summary: "s",
				items: [
					{
						id: "plan_1",
						editorialIntent: "Preserve this meaning while pursuing the target viewer experience.",
						preferredStrategy: "preserve",
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
					text: "temporary recording HUD around 12s",
					status: "known",
					sourceTimeSec: 12,
					claimId: "hud1",
				},
			],
			spoken: [],
			focalTargets: [],
			preservationConstraints: ["Spoken: demo intro"],
		});
		const audit = auditEditorialFindings([
			...raw,
			{
				id: "junk_plan",
				category: "preserve",
				range: { startSec: null, endSec: null },
				evidenceRefs: ["plan"],
				confidence: "medium",
				preservationImpact: "soft",
				statement: "Preserve this meaning while pursuing the target viewer experience.",
				epistemicState: "inferred",
				sourceLayer: "edit_plan",
			},
		]);
		writeJson("editorial-findings-audit.json", {
			kept: audit.kept,
			rejected: audit.rejected.map((r) => ({
				id: r.id,
				note: r.auditNote,
				statement: r.statement,
			})),
			downgraded: audit.downgraded.map((r) => ({ id: r.id, note: r.auditNote })),
			keptCount: audit.kept.length,
			rejectedCount: audit.rejected.length,
		});
		expect(audit.kept.some((k) => /hud|temporary/i.test(k.statement + k.category))).toBe(true);
		expect(audit.rejected.some((r) => r.auditNote === "generic_plan_boilerplate")).toBe(true);
	});

	it("validator synthetic cases", () => {
		const ed = validateEditorialSpecificity({
			text: "Add transitions, animations, captions and better microphone.",
			findings: [
				{
					id: "f1",
					category: "distracting_temporary_ui",
					range: { startSec: 12, endSec: 13 },
					evidenceRefs: ["e"],
					confidence: "high",
					preservationImpact: "editable",
					statement: "HUD",
					epistemicState: "observed",
					sourceLayer: "edit_gap",
				},
			],
		});
		expect(ed.hits.some((h) => h.rule.startsWith("generic_"))).toBe(true);

		const focal = validateFocalTargetResponse({
			text: "No zoom is needed.",
			userMessage: "Where would a zoom help?",
			candidates: [
				{
					id: "focal_1",
					range: { startSec: 8, endSec: 9 },
					subject: "editor panel",
					evidenceRefs: ["f"],
					targetKind: "editor_area",
					visibilityConfidence: "medium",
					reasonCandidate: "t",
				},
			],
		});
		focalRows.push({ case: "no_zoom_unevaluated", hits: focal.hits });
		expect(focal.hits.some((h) => h.rule === "focal_candidates_unevaluated")).toBe(true);

		const focalOk = validateFocalTargetResponse({
			text: "FOCAL_TARGET_DECISIONS: focal_1=NOT_HELPFUL. No zoom is needed for the coverage sample.",
			userMessage: "Where would a zoom help?",
			candidates: [
				{
					id: "focal_1",
					range: { startSec: 8, endSec: 9 },
					subject: "editor panel",
					evidenceRefs: ["f"],
					targetKind: "editor_area",
					visibilityConfidence: "medium",
					reasonCandidate: "t",
				},
			],
		});
		focalRows.push({ case: "no_zoom_evaluated", hits: focalOk.hits, ok: focalOk.ok });
		expect(focalOk.hits.filter((h) => h.rule === "focal_candidates_unevaluated").length).toBe(0);
	});
});
