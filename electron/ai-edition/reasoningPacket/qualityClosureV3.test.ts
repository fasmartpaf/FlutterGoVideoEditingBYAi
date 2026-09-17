/**
 * Quality Closure V3 — packet delivery, validators, self-containment unit tests.
 */

import { describe, expect, it } from "vitest";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import {
	appendReasoningPacketToUserMessage,
	assertReasoningPacketDelivered,
	buildReasoningPacketV1,
	evaluatePacketSelfContainment,
	REASONING_PACKET_MARKER,
	serializeReasoningPacket,
	validateCrossModalResponse,
	validateEditorialSpecificity,
	validateFocalTargetResponse,
} from "./index";

const SPEECH = "What did I say near the end?";

function speechPacket() {
	const needs = classifyMediaContextNeeds(SPEECH);
	return buildReasoningPacketV1({
		phase: "UNDERSTAND",
		userMessage: SPEECH,
		queryClass: "speech",
		queryScope: "bounded_range",
		contextNeeds: needs,
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
			speechWindows: [{ startSec: 10.9, endSec: 17, preview: "open the technical audit document" }],
			visualTransitionCount: 0,
			temporaryUiHints: [],
			contradictionHints: [],
			correctionHints: [],
			passiveChromeHints: [],
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
			speechStatus: "available",
			programmeNote: "n",
		},
		historyConstraints: [],
		imagesAttached: 0,
	});
}

describe("Quality Closure V3 — packet delivery", () => {
	it("appends into plain {role, content:string} — the V2 live failure shape", () => {
		const packet = speechPacket();
		const ser = serializeReasoningPacket(packet);
		const msg = { role: "user" as const, content: SPEECH };
		const out = appendReasoningPacketToUserMessage(msg, ser.text);
		expect(out.delivered).toBe(true);
		expect(out.shape).toBe("role_content_string");
		expect(assertReasoningPacketDelivered(out.message).ok).toBe(true);
		const content = (out.message as { content: string }).content;
		expect(content).toContain(REASONING_PACKET_MARKER);
		expect(content).toContain("open the technical audit");
		expect(msg.content).toBe(SPEECH); // no in-place mutate
	});

	it("appends into string and content array and role+array", () => {
		const ser = serializeReasoningPacket(speechPacket());
		expect(appendReasoningPacketToUserMessage(SPEECH, ser.text).delivered).toBe(true);
		expect(
			appendReasoningPacketToUserMessage([{ type: "text", text: SPEECH }], ser.text).delivered,
		).toBe(true);
		expect(
			appendReasoningPacketToUserMessage(
				{ role: "user", content: [{ type: "text", text: SPEECH }] },
				ser.text,
			).delivered,
		).toBe(true);
	});

	it("speech packet is self-contained with tools budget 1", () => {
		const packet = speechPacket();
		expect(packet.sufficiency.packetEvidenceSufficient).toBe(true);
		expect(packet.selectedSpeech.length).toBeGreaterThan(0);
		const sc = evaluatePacketSelfContainment(packet);
		expect(sc.selfContained).toBe(true);
	});
});

describe("Quality Closure V3 — validators", () => {
	it("downgrades false cross-modal agreement", () => {
		const r = validateCrossModalResponse({
			text: "Everything matches with no discrepancy between speech and screen.",
			relations: [
				{
					spokenClaimRef: "a",
					spokenText: "look at the timeline",
					speechRange: { startSec: 4, endSec: 8 },
					visualRange: { startSec: 0, endSec: 16 },
					visualSupport: "NOT_VISUALLY_VERIFIED",
					evidenceRefs: ["a"],
					note: "unverified",
				},
			],
		});
		expect(r.hits.some((h) => h.rule === "cross_modal_false_agreement")).toBe(true);
		expect(r.text).not.toMatch(/no discrepancy/i);
	});

	it("flags generic professional advice without findings", () => {
		const r = validateEditorialSpecificity({
			text: "Add transitions, animations, captions and better microphone.",
			findings: [
				{
					id: "f1",
					kind: "distracting_temporary_ui",
					category: "distracting_temporary_ui",
					range: { startSec: 18, endSec: 19 },
					evidenceRefs: ["e1"],
					confidence: "high",
					preservationImpact: "editable",
					statement: "HUD at 18s",
					epistemicState: "observed",
					sourceLayer: "known_hint",
					disposition: "IMPROVE_CANDIDATE",
					linkedClaimIds: [],
					linkedBeatIds: [],
				},
			],
			requireSidecar: false,
		});
		expect(r.hits.some((h) => h.rule.startsWith("generic_"))).toBe(true);
	});

	it("allows grounded temporary-UI advice", () => {
		const r = validateEditorialSpecificity({
			text: "Remove or hide the brief recording HUD around 18s (distracting_temporary_ui).",
			findings: [
				{
					id: "f1",
					kind: "distracting_temporary_ui",
					category: "distracting_temporary_ui",
					range: { startSec: 18, endSec: 19 },
					evidenceRefs: ["e1"],
					confidence: "high",
					preservationImpact: "editable",
					statement: "HUD at 18s",
					epistemicState: "observed",
					sourceLayer: "known_hint",
					disposition: "IMPROVE_CANDIDATE",
					linkedClaimIds: [],
					linkedBeatIds: [],
				},
			],
			requireSidecar: false,
		});
		expect(r.hits.filter((h) => h.rule.startsWith("generic_")).length).toBe(0);
	});

	it("flags no-zoom without candidate decisions", () => {
		const r = validateFocalTargetResponse({
			text: "No zoom is needed.",
			userMessage: "Where would a zoom help?",
			candidates: [
				{
					id: "focal_1",
					range: { startSec: 14, endSec: 15 },
					subject: "editor panel",
					evidenceRefs: ["f"],
					targetKind: "editor_area",
					visibilityConfidence: "medium",
					reasonCandidate: "test",
				},
			],
		});
		expect(
			r.hits.some((h) => h.rule === "focal_sidecar_missing" || h.rule === "candidate_unevaluated"),
		).toBe(true);
	});
});
