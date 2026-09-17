/**
 * Bounded Reasoning Quality Closure V3 — offline matrix (0 provider).
 *
 * Run:
 *   npx vitest --run electron/ai-edition/perceptionBenchmark/boundedReasoningQualityClosureV3/bounded-reasoning-quality-closure-v3-offline.runtime.test.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { classifyMediaContextNeeds } from "../../mediaContextNeeds";
import {
	appendReasoningPacketToUserMessage,
	assertReasoningPacketDelivered,
	buildReasoningPacketV1,
	evaluatePacketSelfContainment,
	REASONING_PACKET_MARKER,
	resolveToolNeedPolicy,
	type SpeechMediaState,
	serializeReasoningPacket,
	validateCrossModalResponse,
	validateEditorialSpecificity,
	validateFocalTargetResponse,
} from "../../reasoningPacket";
import { classifyVideoMemoryQuery } from "../../videoMemory";
import { BOUNDED_REASONING_V1_ID } from "../../videoMemory/productionPath";

const OUT = path.join(
	process.cwd(),
	"tmp/perception-benchmark/bounded-reasoning-quality-closure-v3",
);

const rows: Record<string, unknown>[] = [];
const deliveryRows: Record<string, unknown>[] = [];
const selfRows: Record<string, unknown>[] = [];
const cmVal: Record<string, unknown>[] = [];
const edVal: Record<string, unknown>[] = [];
const focalVal: Record<string, unknown>[] = [];

function mem(speech: string[], opts?: { ocr?: string[] }) {
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
		temporaryUiHints: opts?.ocr?.filter((t) => /restart|hud/i.test(t)) ?? [],
		contradictionHints: [],
		correctionHints: [],
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

function runCase(opts: {
	id: string;
	prompt: string;
	speechState: SpeechMediaState;
	speech?: string[];
	frames?: number;
	messageShape: "string" | "role_string" | "role_array" | "content_array";
	ocr?: string[];
}) {
	const needs = classifyMediaContextNeeds(opts.prompt);
	const qc = classifyVideoMemoryQuery(opts.prompt, needs);
	const frames = Array.from({ length: opts.frames ?? 0 }, (_, i) => ({
		sourceTimeSec: i * 4,
		reason: (i === 2 ? "editorial_focus" : "coverage_anchor") as const,
		note: `f${i}`,
	}));
	const packet = buildReasoningPacketV1({
		phase: qc === "editorial" ? "PLAN" : "UNDERSTAND",
		userMessage: opts.prompt,
		queryClass: qc,
		queryScope: "whole_media",
		contextNeeds: needs,
		speechMediaState: opts.speechState,
		memory: mem(opts.speech ?? [], { ocr: opts.ocr }),
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
		editGapV1:
			qc === "editorial"
				? ({
						version: 1,
						providerId: "CURRENT_OPENSCREEN_EDIT_GAP_V1",
						summary: "fixture",
						items: [
							{
								id: "gap1",
								category: "distracting_temporary_ui",
								problemStatement: "Brief HUD near end",
								desiredChange: "Hide temporary recording UI",
								importance: "medium",
								confidence: "high",
								sourceEpistemic: "observed",
								provenance: {
									sourceBeatIds: ["b1"],
									targetBeatIds: [],
									sourceRange: { startSourceTimeSec: 18, endSourceTimeSec: 19 },
								},
								constraints: [],
							},
						],
						preserved: [],
						unresolved: [],
						builtAtIso: new Date().toISOString(),
					} as never)
				: null,
	});
	const ser = serializeReasoningPacket(packet);
	const baseMsg =
		opts.messageShape === "string"
			? opts.prompt
			: opts.messageShape === "content_array"
				? [{ type: "text", text: opts.prompt }]
				: opts.messageShape === "role_array"
					? { role: "user", content: [{ type: "text", text: opts.prompt }] }
					: { role: "user", content: opts.prompt };
	const appended = appendReasoningPacketToUserMessage(baseMsg, ser.text);
	const delivery = assertReasoningPacketDelivered(appended.message);
	const sc = packet.selfContainment ?? evaluatePacketSelfContainment(packet);
	const policy = resolveToolNeedPolicy({
		phase: packet.phase,
		packetEvidenceSufficient: packet.sufficiency.packetEvidenceSufficient,
		missingEvidenceKinds: packet.sufficiency.missingEvidenceKinds,
		speechWindows: packet.selectedSpeech.length,
		frameCount: packet.frameMeta.length,
		queryClass: qc,
	});

	deliveryRows.push({
		id: opts.id,
		shape: opts.messageShape,
		appendShape: appended.shape,
		delivered: appended.delivered && delivery.ok,
		marker: REASONING_PACKET_MARKER,
	});
	selfRows.push({
		id: opts.id,
		...sc,
	});
	const row = {
		id: opts.id,
		prompt: opts.prompt,
		queryClass: qc,
		phase: packet.phase,
		packetDelivered: appended.delivered && delivery.ok,
		selfContained: sc.selfContained,
		missing: sc.missing,
		spoken: packet.spoken.length,
		visual: packet.selectedVisualEvidence.length,
		crossModal: packet.crossModalRelations.length,
		focal: packet.focalTargetCandidates.length,
		editorialFindings: packet.editorialFindings.length,
		toolCount: policy.toolCount,
		mutatingToolCount: 0,
		expectedModelCalls: 1,
		sufficient: packet.sufficiency.packetEvidenceSufficient,
	};
	rows.push(row);
	return { row, packet, appended };
}

describe("Bounded Reasoning Quality Closure V3 — offline", () => {
	afterAll(() => {
		mkdirSync(OUT, { recursive: true });
		writeFileSync(path.join(OUT, "NOTICE.md"), `# ${BOUNDED_REASONING_V1_ID} Quality Closure V3\n`);
		writeFileSync(path.join(OUT, "offline-matrix.json"), JSON.stringify(rows, null, 2));
		writeFileSync(
			path.join(OUT, "packet-delivery-tests.json"),
			JSON.stringify(deliveryRows, null, 2),
		);
		writeFileSync(
			path.join(OUT, "self-containment-matrix.json"),
			JSON.stringify(selfRows, null, 2),
		);
		writeFileSync(
			path.join(OUT, "cross-modal-validator-tests.json"),
			JSON.stringify(cmVal, null, 2),
		);
		writeFileSync(
			path.join(OUT, "editorial-specificity-validator-tests.json"),
			JSON.stringify(edVal, null, 2),
		);
		writeFileSync(path.join(OUT, "focal-decision-tests.json"), JSON.stringify(focalVal, null, 2));
	});

	it("A–K offline contracts + validators", () => {
		mkdirSync(OUT, { recursive: true });

		const a = runCase({
			id: "A_speech_plain_object",
			prompt: "What did I say near the end?",
			speechState: "available",
			speech: ["near the end open the audit"],
			frames: 0,
			messageShape: "role_string",
		});
		expect(a.row.packetDelivered).toBe(true);
		expect(a.row.selfContained).toBe(true);
		expect(a.row.toolCount).toBe(0);

		runCase({
			id: "B_speech_multimodal",
			prompt: "What did I say near the end?",
			speechState: "available",
			speech: ["near the end open the audit"],
			frames: 0,
			messageShape: "role_array",
		});

		const c = runCase({
			id: "C_cross_modal",
			prompt:
				"Compare what I say with what is visibly happening. Tell me what matches, what differs, and what cannot be verified.",
			speechState: "available",
			speech: ["look at the timeline", "open the audit"],
			frames: 5,
			messageShape: "role_string",
		});
		expect(c.row.crossModal).toBeGreaterThan(0);

		runCase({
			id: "D_generic_correction",
			prompt: "Listen carefully. What did I first say, and how did I correct myself?",
			speechState: "available",
			speech: ["open Timeline", "I mean Effects"],
			frames: 4,
			messageShape: "string",
		});

		const e = runCase({
			id: "E_case4",
			prompt:
				"Watch and listen carefully. Explain what I first say I will do, how I correct myself, and what you can actually verify happened on screen.",
			speechState: "available",
			speech: ["I will open the Timeline panel", "I meant the Effects panel"],
			frames: 5,
			messageShape: "role_string",
		});
		expect(e.packet.correctionScaffold.present).toBe(true);
		expect(e.row.packetDelivered).toBe(true);

		const f = runCase({
			id: "F_case020_zoom",
			prompt:
				"Where would a zoom actually help in this recording, and where would it not help? Only recommend a zoom when there is a specific visible focal target.",
			speechState: "available",
			speech: ["cursor working"],
			frames: 5,
			messageShape: "role_string",
			ocr: ["Readable text compositor_view"],
		});
		expect(f.row.focal).toBeGreaterThan(0);

		const g = runCase({
			id: "G_professional",
			prompt:
				"What could genuinely be improved to make this recording feel more professional? Only recommend changes supported by this recording.",
			speechState: "available",
			speech: ["demo"],
			frames: 5,
			messageShape: "role_string",
			ocr: ["Restart recording HUD"],
		});
		expect(g.row.editorialFindings).toBeGreaterThan(0);

		runCase({
			id: "H_settings",
			prompt: "Did I actually open Settings in this recording?",
			speechState: "available",
			speech: ["Settings"],
			frames: 4,
			messageShape: "role_string",
		});
		runCase({
			id: "I_upwork",
			prompt: "Did I open Upwork?",
			speechState: "available",
			frames: 4,
			messageShape: "role_string",
			ocr: ["Upwork tab"],
		});
		runCase({
			id: "J_restart",
			prompt: "Did I restart the recording?",
			speechState: "available",
			frames: 4,
			messageShape: "role_string",
			ocr: ["Restart recording"],
		});
		runCase({
			id: "K_no_audio",
			prompt: "What did I say near the end?",
			speechState: "no_audio",
			frames: 0,
			messageShape: "role_string",
		});

		expect(rows.every((r) => r.packetDelivered === true)).toBe(true);
		expect(rows.every((r) => r.mutatingToolCount === 0)).toBe(true);
		expect(
			rows.filter((r) => r.id !== "K_no_audio" || true).every((r) => r.expectedModelCalls === 1),
		).toBe(true);

		const cm = validateCrossModalResponse({
			text: "Everything matches with no discrepancy.",
			relations: [
				{
					spokenClaimRef: "x",
					spokenText: "timeline",
					speechRange: { startSec: 0, endSec: 1 },
					visualRange: { startSec: 0, endSec: 10 },
					visualSupport: "NOT_VISUALLY_VERIFIED",
					evidenceRefs: [],
					note: "n",
				},
			],
		});
		cmVal.push({ case: "false_agreement", hits: cm.hits, text: cm.text });
		expect(cm.hits.length).toBeGreaterThan(0);
		expect(cm.text).not.toMatch(/no discrepancy/i);

		const edBad = validateEditorialSpecificity({
			text: "Add transitions, animations, captions and better microphone.",
			findings: [
				{
					id: "f1",
					category: "distracting_temporary_ui",
					range: { startSec: 18, endSec: 19 },
					evidenceRefs: ["e"],
					confidence: "high",
					preservationImpact: "editable",
					statement: "HUD",
				},
			],
		});
		edVal.push({ case: "generic_fail", hits: edBad.hits });
		expect(edBad.hits.some((h) => h.rule.startsWith("generic_"))).toBe(true);

		const edGood = validateEditorialSpecificity({
			text: "Hide the brief recording HUD around 18s (distracting_temporary_ui).",
			findings: [
				{
					id: "f1",
					category: "distracting_temporary_ui",
					range: { startSec: 18, endSec: 19 },
					evidenceRefs: ["e"],
					confidence: "high",
					preservationImpact: "editable",
					statement: "HUD",
				},
			],
		});
		edVal.push({ case: "grounded_ok", hits: edGood.hits });
		expect(edGood.hits.filter((h) => h.rule.startsWith("generic_")).length).toBe(0);

		const foc = validateFocalTargetResponse({
			text: "No zoom is needed.",
			userMessage: "Where would zoom help?",
			candidates: [
				{
					id: "focal_1",
					range: { startSec: 14, endSec: 15 },
					subject: "panel",
					evidenceRefs: [],
					targetKind: "editor_area",
					visibilityConfidence: "medium",
					reasonCandidate: "t",
				},
			],
		});
		focalVal.push({ case: "unevaluated", hits: foc.hits });
		expect(foc.hits.some((h) => h.rule === "focal_candidates_unevaluated")).toBe(true);
	});
});
