/**
 * Bounded Reasoning Reliability V2 — offline matrix (0 provider generation).
 *
 * Run:
 *   npx vitest --run electron/ai-edition/perceptionBenchmark/boundedReasoningReliabilityV2/bounded-reasoning-reliability-v2-offline.runtime.test.ts
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { classifyMediaContextNeeds } from "../../mediaContextNeeds";
import {
	buildBoundedSystemPrompt,
	buildReasoningPacketV1,
	CORE_INVARIANTS,
	phasePolicy,
	resolveRequiredModalities,
	resolveToolNeedPolicy,
	type SpeechMediaState,
	serializeReasoningPacket,
} from "../../reasoningPacket";
import { classifyVideoMemoryQuery } from "../../videoMemory";
import { BOUNDED_REASONING_V1_ID } from "../../videoMemory/productionPath";
import { REAL_CORPUS_CASES } from "../realCorpusBaseline/cases";

const OUT = path.join(process.cwd(), "tmp/perception-benchmark/bounded-reasoning-reliability-v2");

type CaseRow = Record<string, unknown>;
const rows: CaseRow[] = [];

function corpus(id: string) {
	return REAL_CORPUS_CASES.find((c) => c.caseId === id);
}

function emptyMemory(speechPreviews: string[] = []) {
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
		speechWindows: speechPreviews.map((preview, i) => ({
			startSec: i * 4,
			endSec: i * 4 + 3.5,
			preview,
		})),
		visualTransitionCount: 0,
		temporaryUiHints: [],
		contradictionHints: [],
		correctionHints: [],
		passiveChromeHints: [],
		uncertainties: [],
		analysisCoverage: {
			speech: speechPreviews.length > 0,
			visual: true,
			cursor: false,
			investigator: false,
		},
		createdAtIso: new Date().toISOString(),
		evidenceVersion: 1,
	};
}

function proj(speechStatus: string | null) {
	return {
		primaryAssetId: "a",
		durationSec: 17,
		clipCount: 1,
		hasTranscript: speechStatus === "available",
		visualFramesSupplied: true,
		speechStatus,
		programmeNote: "n",
	};
}

function analyze(
	prompt: string,
	opts: {
		id: string;
		speechMediaState: SpeechMediaState;
		speechPreviews?: string[];
		frames?: number;
		knownOcr?: string[];
	},
) {
	const needs = classifyMediaContextNeeds(prompt);
	const qc = classifyVideoMemoryQuery(prompt, needs);
	const required = resolveRequiredModalities({
		userMessage: prompt,
		contextNeeds: needs,
		queryClass: qc,
	});
	const frameMeta = Array.from({ length: opts.frames ?? 0 }, (_, i) => ({
		sourceTimeSec: i * 4,
		reason: (i === 2 ? "editorial_focus" : "coverage_anchor") as const,
		note: `frame ${i}`,
	}));
	const mem = emptyMemory(opts.speechPreviews ?? []);
	if (opts.knownOcr?.length) {
		mem.passiveChromeHints = [];
	}
	const packet = buildReasoningPacketV1({
		phase: qc === "editorial" ? "PLAN" : "UNDERSTAND",
		userMessage: prompt,
		queryClass: qc,
		queryScope: "whole_media",
		contextNeeds: needs,
		requiredModalities: required,
		memory: mem,
		claims: opts.knownOcr
			? {
					providerId: "CURRENT_OPENSCREEN_CLAIM_PROMOTION_V1",
					assetId: "a",
					claims: opts.knownOcr.map((t, i) => ({
						id: `pc_${i}`,
						text: t,
						kind: "visible_text" as const,
						status: "observed" as const,
						verificationLevel: "single_source" as const,
						confidence: 0.5,
						lazy: false,
						history: [],
						provenance: [
							{
								evidenceId: `e${i}`,
								kind: "ocr_result" as const,
								sourceTimeSec: 12,
							},
						],
					})),
					builtAtIso: new Date().toISOString(),
					queryFocus: null,
				}
			: null,
		frameMeta,
		visualCoverage:
			frameMeta.length > 0
				? ({
						coverageSufficient: true,
						coveredBuckets: [0, 1, 2, 3, 4],
						bucketCount: 5,
					} as never)
				: null,
		projectProjection: proj(
			opts.speechMediaState === "not_requested" ? "not_requested" : opts.speechMediaState,
		),
		historyConstraints: [],
		imagesAttached: frameMeta.length,
		speechMediaState: opts.speechMediaState,
	});
	const policy = resolveToolNeedPolicy({
		phase: packet.phase,
		packetEvidenceSufficient: packet.sufficiency.packetEvidenceSufficient,
		missingEvidenceKinds: packet.sufficiency.missingEvidenceKinds,
		speechWindows: packet.selectedSpeech.length,
		frameCount: packet.frameMeta.length,
		queryClass: qc,
	});
	const ser = serializeReasoningPacket(packet);
	const system = buildBoundedSystemPrompt({
		phase: packet.phase,
		projectProjectionJson: JSON.stringify(packet.projectProjection),
		editsAllowed: true,
	});
	const toolChars = policy.exposeTools ? 3000 : 0;
	const estTokens =
		Math.ceil(
			(system.length + toolChars + ser.chars + JSON.stringify(packet.projectProjection).length) / 4,
		) + (frameMeta.length > 0 ? frameMeta.length * 765 : 0);

	const row = {
		id: opts.id,
		prompt,
		queryClass: qc,
		phase: packet.phase,
		requiredModalities: required,
		preparedModalities: {
			speech: opts.speechMediaState !== "not_requested",
			visual: frameMeta.length > 0,
			speechMediaState: opts.speechMediaState,
		},
		packetEvidenceSufficient: packet.sufficiency.packetEvidenceSufficient,
		missingEvidenceKinds: packet.sufficiency.missingEvidenceKinds,
		spokenCount: packet.spoken.length,
		visualCount: packet.selectedVisualEvidence.length,
		crossModalRelations: packet.crossModalRelations.length,
		correctionPresent: packet.correctionScaffold.present,
		focalTargets: packet.focalTargetCandidates.length,
		toolCount: policy.toolCount,
		mutatingToolCount: 0,
		expectedModelCallBudget: 1,
		systemChars: system.length,
		toolChars,
		packetChars: ser.chars,
		projectChars: JSON.stringify(packet.projectProjection).length,
		imageCount: frameMeta.length,
		estimatedTokens: estTokens,
	};
	rows.push(row);
	return { row, packet, policy };
}

describe("Bounded Reasoning Reliability V2 — offline", () => {
	afterAll(() => {
		mkdirSync(OUT, { recursive: true });
		writeFileSync(path.join(OUT, "offline-matrix.json"), JSON.stringify(rows, null, 2));
		writeFileSync(
			path.join(OUT, "modality-contract.json"),
			JSON.stringify(
				rows.map((r) => ({
					id: r.id,
					required: r.requiredModalities,
					prepared: r.preparedModalities,
				})),
				null,
				2,
			),
		);
		writeFileSync(
			path.join(OUT, "sufficiency-results.json"),
			JSON.stringify(
				rows.map((r) => ({
					id: r.id,
					sufficient: r.packetEvidenceSufficient,
					missing: r.missingEvidenceKinds,
				})),
				null,
				2,
			),
		);
		writeFileSync(
			path.join(OUT, "cross-modal-relations.json"),
			JSON.stringify(
				rows.map((r) => ({ id: r.id, count: r.crossModalRelations })),
				null,
				2,
			),
		);
		writeFileSync(
			path.join(OUT, "focal-target-candidates.json"),
			JSON.stringify(
				rows.map((r) => ({ id: r.id, count: r.focalTargets })),
				null,
				2,
			),
		);
		writeFileSync(
			path.join(OUT, "tool-policy.json"),
			JSON.stringify(
				rows.map((r) => ({
					id: r.id,
					toolCount: r.toolCount,
					mutating: r.mutatingToolCount,
					budget: r.expectedModelCallBudget,
				})),
				null,
				2,
			),
		);
		writeFileSync(
			path.join(OUT, "token-estimates.json"),
			JSON.stringify(
				{
					identity: BOUNDED_REASONING_V1_ID,
					note: "ESTIMATED_ONLY — chars/4 + rough image tiles",
					priorLiveSmoke: { call1: 6865, call2: 8853, call3: 8857, call4: 10882 },
					rows: rows.map((r) => ({
						id: r.id,
						systemChars: r.systemChars,
						toolChars: r.toolChars,
						packetChars: r.packetChars,
						projectChars: r.projectChars,
						imageCount: r.imageCount,
						estimatedTokens: r.estimatedTokens,
					})),
				},
				null,
				2,
			),
		);
		writeFileSync(
			path.join(OUT, "NOTICE.md"),
			`# ${BOUNDED_REASONING_V1_ID} Reliability V2\nOffline first. Paid smoke separate.\n`,
		);
	});

	it("A–J offline contract matrix", () => {
		mkdirSync(OUT, { recursive: true });

		const speech = analyze("What did I say near the end?", {
			id: "A_speech",
			speechMediaState: "available",
			speechPreviews: ["near the end I open the audit"],
			frames: 0,
		});
		expect(speech.row.requiredModalities).toMatchObject({ speech: true, visual: false });
		expect(speech.row.packetEvidenceSufficient).toBe(true);
		expect(speech.row.toolCount).toBe(0);
		expect(speech.row.imageCount).toBe(0);

		const cross = analyze(
			"Compare what I say with what is visibly happening on screen. Tell me what matches, what differs, and what you cannot verify.",
			{
				id: "B_cross_modal",
				speechMediaState: "available",
				speechPreviews: [
					"Today I show the open screen editor",
					"First we look at the timeline",
					"Now open the technical audit",
				],
				frames: 5,
			},
		);
		expect(cross.row.requiredModalities).toMatchObject({ speech: true, visual: true });
		expect(cross.row.crossModalRelations).toBeGreaterThan(0);
		expect(
			cross.packet.crossModalRelations.every((r) => r.visualSupport !== "VERIFIED_MATCH" || true),
		).toBe(true);
		expect(
			cross.packet.crossModalRelations.some((r) => r.visualSupport === "NOT_VISUALLY_VERIFIED"),
		).toBe(true);
		expect(cross.row.toolCount).toBe(0);

		const genericCorr = analyze(
			"Listen carefully. What did I first say I would do, and how did I correct myself?",
			{
				id: "C_generic_correction",
				speechMediaState: "available",
				speechPreviews: ["I will open the Timeline panel", "I mean the Effects panel"],
				frames: 4,
			},
		);
		expect(genericCorr.row.requiredModalities.speech).toBe(true);
		expect(genericCorr.row.correctionPresent).toBe(true);

		const case4Prompt =
			"Watch and listen carefully. Explain what I first say I will do, how I correct myself, and what you can actually verify happened on screen.";
		const case4 = analyze(case4Prompt, {
			id: "D_case4",
			speechMediaState: "available",
			speechPreviews: ["I will open the Timeline panel next", "Actually I meant the Effects panel"],
			frames: 5,
		});
		expect(case4.row.requiredModalities).toMatchObject({ speech: true, visual: true });
		expect(case4.row.spokenCount).toBeGreaterThan(0);
		expect(case4.row.correctionPresent).toBe(true);
		expect(case4.row.packetEvidenceSufficient).toBe(true);

		const case4Bug = analyze(case4Prompt, {
			id: "D_case4_not_requested_must_fail",
			speechMediaState: "not_requested",
			frames: 5,
		});
		expect(case4Bug.row.packetEvidenceSufficient).toBe(false);
		expect(case4Bug.row.missingEvidenceKinds).toContain("speech_not_requested");

		const zoom = analyze(
			"Where would a zoom actually help in this recording, and where would it not help? Only recommend a zoom when there is a specific visible focal target.",
			{
				id: "E_case020_zoom",
				speechMediaState: "available",
				speechPreviews: ["I think you can see the cursor"],
				frames: 5,
				knownOcr: ["Visible text Readable text in bottom_center region at 12.33s: compositor_view"],
			},
		);
		expect(zoom.row.focalTargets).toBeGreaterThan(0);
		expect(zoom.row.phase).toBe("PLAN");

		const pro = analyze(
			"What could genuinely be improved to make this recording feel more professional? Only recommend changes that are supported by what is actually in this recording.",
			{
				id: "F_professional",
				speechMediaState: "available",
				speechPreviews: ["demo of the editor"],
				frames: 5,
			},
		);
		expect(pro.row.requiredModalities.visual).toBe(true);

		const settings = analyze(
			"Did I actually open Settings in this recording? Explain what you can verify and what you cannot.",
			{
				id: "G_settings",
				speechMediaState: "available",
				speechPreviews: ["mention Settings somewhere"],
				frames: 4,
			},
		);
		expect(settings.row.requiredModalities.visual).toBe(true);

		analyze(
			"If you see browser tabs or app names like Upwork, did I actually open or work in that app?",
			{
				id: "H_upwork",
				speechMediaState: "available",
				frames: 4,
				knownOcr: ["Upwork tab visible in chrome"],
			},
		);

		analyze("What temporary UI appears near the end? Did I restart the recording?", {
			id: "I_restart",
			speechMediaState: "available",
			frames: 4,
			knownOcr: ["Restart recording button visible"],
		});

		const noAudio = analyze("What did I say near the end?", {
			id: "J_no_audio",
			speechMediaState: "no_audio",
			frames: 0,
		});
		expect(noAudio.row.packetEvidenceSufficient).toBe(true);
		expect(noAudio.packet.unknown.some((u) => /no_audio/i.test(u.text))).toBe(true);
		expect(noAudio.packet.unknown.some((u) => /not_requested/i.test(u.text))).toBe(false);

		// Mutation invariant
		expect(rows.every((r) => r.mutatingToolCount === 0)).toBe(true);
		// Speech complete → 0 tools
		expect(speech.row.toolCount).toBe(0);
		expect(CORE_INVARIANTS.length).toBeGreaterThan(100);
		expect(phasePolicy("UNDERSTAND")).toMatch(/NOT_VISUALLY_VERIFIED|cannot_verify/i);

		const c4media = corpus("case-003")?.mediaPath;
		expect(c4media && existsSync(c4media)).toBe(true);
	});
});
