/**
 * Unit tests — Bounded Reasoning Packet + Phase Tools V1
 */

import { describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { MUTATING_TOOL_NAMES } from "../agent-tools";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import { classifyVideoMemoryQuery } from "../videoMemory";
import { buildReasoningPacketV1 } from "./buildPacket";
import {
	assertPhaseMutationInvariant,
	buildBoundedSystemPrompt,
	resolveCognitionPhase,
	resolveDeterministicFastPath,
	resolveToolNeedPolicy,
	selectBoundedHistoryConstraints,
	serializeReasoningPacket,
	toolGateForPhase,
} from "./index";
import { buildBoundedProjectProjection } from "./projectProjection";
import { CORE_INVARIANTS } from "./systemPolicy";

describe("Bounded Reasoning V1", () => {
	it("UNDERSTAND/PLAN phases never expose mutating tools", () => {
		for (const phase of ["UNDERSTAND", "PLAN", "APPLY", "VERIFY"] as const) {
			const gate = toolGateForPhase(phase);
			const check = assertPhaseMutationInvariant(phase, [...gate.allowedNames]);
			expect(check.ok).toBe(true);
			expect(check.violations).toEqual([]);
			for (const n of gate.allowedNames) {
				expect(MUTATING_TOOL_NAMES.has(n) && n !== "generateCaptions").toBe(false);
			}
		}
	});

	it("PROPOSE may expose mutate schemas but APPLY/VERIFY expose none", () => {
		expect(toolGateForPhase("PROPOSE").allowedNames.has("addTrim")).toBe(true);
		expect(toolGateForPhase("APPLY").allowedNames.size).toBe(0);
		expect(toolGateForPhase("VERIFY").allowedNames.size).toBe(0);
	});

	it("resolves phases from query classes", () => {
		const speech = "What did I say near the end?";
		const needs = classifyMediaContextNeeds(speech);
		const qc = classifyVideoMemoryQuery(speech, needs);
		expect(
			resolveCognitionPhase({ userMessage: speech, contextNeeds: needs, queryClass: qc }).phase,
		).toBe("UNDERSTAND");

		const editorial = "What could genuinely be improved to make this professional?";
		const en = classifyMediaContextNeeds(editorial);
		const eq = classifyVideoMemoryQuery(editorial, en);
		expect(
			resolveCognitionPhase({ userMessage: editorial, contextNeeds: en, queryClass: eq }).phase,
		).toBe("PLAN");

		const apply = "Please apply the edit now";
		const an = classifyMediaContextNeeds(apply);
		const aq = classifyVideoMemoryQuery(apply, an);
		expect(
			resolveCognitionPhase({ userMessage: apply, contextNeeds: an, queryClass: aq }).phase,
		).toBe("APPLY");
	});

	it("APPLY fast path skips provider", () => {
		const needs = classifyMediaContextNeeds("apply the edit");
		const fp = resolveDeterministicFastPath({
			phase: "APPLY",
			contextNeeds: needs,
			userMessage: "apply the edit",
		});
		expect(fp.kind).toBe("skip_provider");
	});

	it("core invariants retain epistemic rules", () => {
		expect(CORE_INVARIANTS).toMatch(/Restart recording/);
		expect(CORE_INVARIANTS).toMatch(/Upwork/);
		expect(CORE_INVARIANTS).toMatch(/Settings/);
		expect(CORE_INVARIANTS).toMatch(/speech→visual|speech->visual|No speech/i);
	});

	it("bounded system prompt is far smaller than 23k-char FULL essay", () => {
		const prompt = buildBoundedSystemPrompt({
			phase: "UNDERSTAND",
			projectProjectionJson: JSON.stringify({ primaryAssetId: "a", durationSec: 17 }),
			editsAllowed: false,
		});
		expect(prompt.length).toBeLessThan(4_000);
		expect(prompt).toMatch(/PHASE=UNDERSTAND/);
	});

	it("project projection shrinks vs full snapshot", () => {
		const base = createEmptyDocument({ title: "t", projectId: "p" });
		const doc = documentSchema.parse({
			...base,
			project: { ...base.project, primaryAssetId: "asset_1" },
			assets: [
				{
					id: "asset_1",
					label: "x",
					kind: "video",
					originalPath: "/tmp/x.mp4",
					durationSec: 20,
					width: 1920,
					height: 1080,
				},
			],
		});
		const full = JSON.stringify(doc).length;
		const proj = buildBoundedProjectProjection({
			document: doc,
			visualFramesSupplied: false,
			fullSnapshotChars: full,
		});
		expect(proj.boundedSnapshotChars).toBeLessThan(proj.fullSnapshotChars);
		expect(proj.projection.durationSec).toBe(20);
	});

	it("history policy keeps preserve constraints without LLM", () => {
		const c = selectBoundedHistoryConstraints([
			{ role: "user", content: "Make this professional." },
			{ role: "assistant", content: "I would…" },
			{ role: "user", content: "Don't change the intro." },
		]);
		expect(c.some((x) => /intro/i.test(x))).toBe(true);
	});

	it("packet speech turn can be 0 images; epistemic lists stay typed", () => {
		const packet = buildReasoningPacketV1({
			phase: "UNDERSTAND",
			userMessage: "What did I say near the end?",
			queryClass: "speech",
			queryScope: "local",
			contextNeeds: {
				category: "speechInspection",
				visual: false,
				speech: true,
				cursor: false,
				injectSpeech: true,
			},
			speechMediaState: "available",
			memory: {
				providerId: "CURRENT_OPENSCREEN_VIDEO_MEMORY_V1",
				assetId: "a",
				sourceFingerprint: "s".repeat(16),
				programmeFingerprint: "p".repeat(16),
				sourceDurationSec: 17,
				ledgerEventCount: 1,
				claimCount: 0,
				sourceStoryBeatCount: 0,
				sourceStorySummary: "",
				speechWindows: [{ startSec: 10, endSec: 16, preview: "open the technical audit" }],
				visualTransitionCount: 0,
				temporaryUiHints: [],
				contradictionHints: [],
				correctionHints: [],
				passiveChromeHints: ["Upwork tab visible"],
				uncertainties: [],
				analysisCoverage: { speech: true, visual: false, cursor: false, investigator: false },
				createdAtIso: new Date().toISOString(),
				evidenceVersion: 1,
			},
			claims: null,
			frameMeta: [],
			visualCoverage: null,
			projectProjection: {
				primaryAssetId: "a",
				durationSec: 17,
				clipCount: 1,
				hasTranscript: true,
				visualFramesSupplied: false,
				speechStatus: "ok",
				programmeNote: "n",
			},
			historyConstraints: [],
			imagesAttached: 0,
		});
		expect(packet.selectedSpeech.length).toBe(1);
		expect(packet.selectedVisualEvidence.length).toBe(0);
		expect(packet.known.some((k) => /Upwork/i.test(k.text))).toBe(true);
		const ser = serializeReasoningPacket(packet);
		expect(ser.chars).toBeGreaterThan(100);
		expect(ser.text).toMatch(/REASONING_PACKET_V1/);
		expect(ser.text).toMatch(/canonical projections/);
		expect(packet.sufficiency.packetEvidenceSufficient).toBe(true);
		expect(packet.sufficiency.speechMediaState).toBe("available");
	});

	it("Reliability V2 — speech not_requested cannot be sufficient when speech required", () => {
		const packet = buildReasoningPacketV1({
			phase: "UNDERSTAND",
			userMessage:
				"Watch and listen carefully. Explain what I first say I will do, how I correct myself, and what you can actually verify happened on screen.",
			queryClass: "visual",
			queryScope: "unknown",
			contextNeeds: {
				category: "visualInspection",
				visual: true,
				speech: false,
				cursor: false,
				injectSpeech: false,
			},
			speechMediaState: "not_requested",
			memory: null,
			claims: null,
			frameMeta: [
				{ sourceTimeSec: 0, reason: "coverage_anchor", note: "t0" },
				{ sourceTimeSec: 6, reason: "coverage_anchor", note: "t6" },
			],
			visualCoverage: {
				coverageSufficient: true,
				coveredBuckets: [0, 1, 2, 3, 4],
				bucketCount: 5,
			} as never,
			projectProjection: {
				primaryAssetId: "a",
				durationSec: 17,
				clipCount: 1,
				hasTranscript: false,
				visualFramesSupplied: true,
				speechStatus: "not_requested",
				programmeNote: "n",
			},
			historyConstraints: [],
			imagesAttached: 2,
		});
		expect(packet.requiredModalities.speech).toBe(true);
		expect(packet.requiredModalities.visual).toBe(true);
		expect(packet.sufficiency.packetEvidenceSufficient).toBe(false);
		expect(packet.sufficiency.missingEvidenceKinds).toContain("speech_not_requested");
	});

	it("Reliability V2 — sufficient speech packet → 0 tools", () => {
		const policy = resolveToolNeedPolicy({
			phase: "UNDERSTAND",
			packetEvidenceSufficient: true,
			missingEvidenceKinds: [],
			speechWindows: 3,
			frameCount: 0,
			queryClass: "speech",
		});
		expect(policy.exposeTools).toBe(false);
		expect(policy.toolCount).toBe(0);
		expect(policy.packetCanAnswerWithoutTools).toBe(true);
	});

	it("Case4-style prompt requires speech+visual modalities", () => {
		const p =
			"Watch and listen carefully. Explain what I first say I will do, how I correct myself, and what you can actually verify happened on screen.";
		const needs = classifyMediaContextNeeds(p);
		expect(needs.speech).toBe(true);
		expect(needs.visual).toBe(true);
	});
});
