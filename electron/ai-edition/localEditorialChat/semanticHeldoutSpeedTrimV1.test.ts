/**
 * Held-out explicit Speed / Trim — SEMANTIC_EVENT must evidence-ground WHERE
 * before frozen executors. Injected brain + presence (not live OpenAI Chat).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import { listSpeedRegions, programmeDurationWithSpeed } from "./directSpeed";
import { programmeDurationSec } from "./directTrim";
import {
	applyLocalEditorialControlWithBrain,
	clearLocalEditorialSessionsForTests,
	setSemanticBrainForTests,
} from "./index";
import type { SemanticSkillRequestV1 } from "./semanticContract";

const ART = join(
	process.cwd(),
	"electron/ai-edition/localEditorialChat/_artifacts/semantic-brain-v1/heldout-speed-trim",
);

const HELDOUT_SPEED = "Speed up when the site appears";
const HELDOUT_TRIM = "Trim when the site appears";

function doc(id: string): AxcutDocument {
	const base = createEmptyDocument({ projectId: id, title: id });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "a1", allowAgentEdits: true },
		assets: [
			{
				id: "a1",
				kind: "video",
				label: "a",
				originalPath: "/tmp/heldout-speed-trim.mp4",
				durationSec: 30,
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
					sourceEndSec: 30,
					timelineStartSec: 0,
					timelineEndSec: 30,
					origin: "system",
					reason: "primary",
				},
			],
		},
		transcripts: [
			{
				id: "tr1",
				assetId: "a1",
				language: "en",
				segments: [
					{
						id: "seg0",
						startSec: 8,
						endSec: 12,
						text: "here is the site coming into view",
						kind: "speech",
					},
				],
				words: [],
			},
		],
	});
}

function brainExplicit(msg: string, skill: "speed" | "trim"): SemanticSkillRequestV1 {
	return {
		version: 1,
		rawText: msg,
		parseStatus: "REASONED",
		goal: "EXPLICIT_EDIT",
		authority: "USER_EXPLICIT",
		skills: [skill],
		operation: skill === "trim" ? "remove" : "add",
		target: {
			type: "SEMANTIC_EVENT",
			range: null,
			semanticEvent: "when the site appears",
			editRef: null,
		},
		modification: skill === "speed" ? { multiplier: 1.5 } : null,
		confidence: "HIGH",
		unresolvedReason: null,
		providerId: "heldout-injected",
		providerCalls: 1,
		cloudCalls: 0,
		latencyMs: 1,
	};
}

const presenceFound = async ({ programmeSec }: { programmeSec: number }) => ({
	present: programmeSec >= 8.9,
	confidence: "HIGH" as const,
	reason: `present>=8.9 @${programmeSec}`,
	rawText: "{}",
	providerId: "injected",
	model: "unit",
});

const visualOk = [{ startSec: 8.5, endSec: 10.5, level: "SIGNIFICANT" as const }];

describe("held-out explicit Speed/Trim WHERE (injected — not live Chat)", () => {
	beforeEach(() => {
		clearLocalEditorialSessionsForTests();
		mkdirSync(ART, { recursive: true });
	});
	afterEach(() => {
		setSemanticBrainForTests(null);
		clearLocalEditorialSessionsForTests();
	});

	it("Speed FOUND: grounds programme range then frozen speed mutates; save/reopen keeps it", async () => {
		setSemanticBrainForTests(async (ctx) => brainExplicit(ctx.userMessage, "speed"));
		const projectId = "heldout-speed-found";
		let d = doc(projectId);
		const beforeFp = fingerprintDocument(d).value;
		const r = await applyLocalEditorialControlWithBrain({
			projectId,
			document: d,
			userMessage: HELDOUT_SPEED,
			visualChangeEvents: visualOk,
			skipVisualAnalysis: true,
			presenceJudge: presenceFound,
			ocrRecognize: async () => ({ text: "page", available: true }),
		});
		expect(r.providerCalls).toBeGreaterThanOrEqual(1);
		expect(r.mutated).toBe(true);
		expect(r.request.intent).toBe("SPEED_UP");
		expect(r.request.range).toBeTruthy();
		expect(r.request.range!.endSec).toBeGreaterThan(r.request.range!.startSec);
		expect(r.userFacingText.toLowerCase()).not.toMatch(/i need a time range/);
		expect(fingerprintDocument(r.document).value).not.toBe(beforeFp);
		expect(listSpeedRegions(r.document).length).toBeGreaterThanOrEqual(1);

		const path = join(ART, "heldout-speed-working.openscreen");
		writeFileSync(path, JSON.stringify(r.document, null, 2));
		const reopened = documentSchema.parse(JSON.parse(readFileSync(path, "utf8")));
		expect(listSpeedRegions(reopened).length).toBeGreaterThanOrEqual(1);
		expect(programmeDurationWithSpeed(reopened)).toBeLessThan(30);
	});

	it("Speed absent: no mutation, no invented range", async () => {
		setSemanticBrainForTests(async (ctx) => brainExplicit(ctx.userMessage, "speed"));
		const projectId = "heldout-speed-absent";
		const d = doc(projectId);
		const beforeFp = fingerprintDocument(d).value;
		const r = await applyLocalEditorialControlWithBrain({
			projectId,
			document: d,
			userMessage: HELDOUT_SPEED,
			visualChangeEvents: [{ startSec: 8.5, endSec: 10.5, level: "SIGNIFICANT" }],
			skipVisualAnalysis: true,
			presenceJudge: async () => ({
				present: false,
				confidence: "HIGH",
				reason: "absent",
				rawText: "{}",
				providerId: "injected",
				model: "unit",
			}),
			ocrRecognize: async () => ({ text: "", available: true }),
		});
		expect(r.mutated).toBe(false);
		expect(fingerprintDocument(r.document).value).toBe(beforeFp);
		expect(listSpeedRegions(r.document).length).toBe(0);
		expect(r.outcomeKind === "NOT_FOUND" || r.outcomeKind === "AMBIGUOUS").toBe(true);
		expect(r.userFacingText.toLowerCase()).not.toMatch(/i need a time range/);
		expect(r.userFacingText.toLowerCase()).not.toMatch(/i set .* to .*×/);
	});

	it("Speed ambiguous: no mutation", async () => {
		setSemanticBrainForTests(async (ctx) => brainExplicit(ctx.userMessage, "speed"));
		const projectId = "heldout-speed-ambiguous";
		const d = doc(projectId);
		const r = await applyLocalEditorialControlWithBrain({
			projectId,
			document: d,
			userMessage: HELDOUT_SPEED,
			visualChangeEvents: [
				{ startSec: 3, endSec: 4, level: "SIGNIFICANT" },
				{ startSec: 18, endSec: 19.5, level: "SIGNIFICANT" },
			],
			skipVisualAnalysis: true,
			presenceJudge: async () => ({
				present: true,
				confidence: "LOW",
				reason: "both peaks",
				rawText: "{}",
				providerId: "injected",
				model: "unit",
			}),
			ocrRecognize: async () => ({ text: "", available: true }),
		});
		expect(r.mutated).toBe(false);
		expect(listSpeedRegions(r.document).length).toBe(0);
		expect(r.outcomeKind === "AMBIGUOUS" || r.outcomeKind === "NOT_FOUND").toBe(true);
	});

	it("Trim FOUND: grounds then frozen trim mutates; save/reopen persists shorter programme", async () => {
		setSemanticBrainForTests(async (ctx) => brainExplicit(ctx.userMessage, "trim"));
		const projectId = "heldout-trim-found";
		const d = doc(projectId);
		const beforeDur = programmeDurationSec(d);
		const r = await applyLocalEditorialControlWithBrain({
			projectId,
			document: d,
			userMessage: HELDOUT_TRIM,
			visualChangeEvents: visualOk,
			skipVisualAnalysis: true,
			presenceJudge: presenceFound,
			ocrRecognize: async () => ({ text: "page", available: true }),
		});
		expect(r.providerCalls).toBeGreaterThanOrEqual(1);
		expect(r.mutated).toBe(true);
		expect(r.request.intent).toBe("REMOVE_RANGE");
		expect(r.request.range).toBeTruthy();
		expect(r.userFacingText.toLowerCase()).not.toMatch(/i need a time range/);
		expect(programmeDurationSec(r.document)).toBeLessThan(beforeDur);

		const path = join(ART, "heldout-trim-working.openscreen");
		writeFileSync(path, JSON.stringify(r.document, null, 2));
		const reopened = documentSchema.parse(JSON.parse(readFileSync(path, "utf8")));
		expect(programmeDurationSec(reopened)).toBeLessThan(beforeDur);
	});

	it("Trim absent: no mutation", async () => {
		setSemanticBrainForTests(async (ctx) => brainExplicit(ctx.userMessage, "trim"));
		const projectId = "heldout-trim-absent";
		const d = doc(projectId);
		const beforeDur = programmeDurationSec(d);
		const r = await applyLocalEditorialControlWithBrain({
			projectId,
			document: d,
			userMessage: HELDOUT_TRIM,
			visualChangeEvents: visualOk,
			skipVisualAnalysis: true,
			presenceJudge: async () => ({
				present: false,
				confidence: "HIGH",
				reason: "absent",
				rawText: "{}",
				providerId: "injected",
				model: "unit",
			}),
			ocrRecognize: async () => ({ text: "", available: true }),
		});
		expect(r.mutated).toBe(false);
		expect(programmeDurationSec(r.document)).toBeCloseTo(beforeDur, 2);
		expect(r.outcomeKind === "NOT_FOUND" || r.outcomeKind === "AMBIGUOUS").toBe(true);
	});

	it("Trim ambiguous: no mutation", async () => {
		setSemanticBrainForTests(async (ctx) => brainExplicit(ctx.userMessage, "trim"));
		const projectId = "heldout-trim-ambiguous";
		const d = doc(projectId);
		const beforeDur = programmeDurationSec(d);
		const r = await applyLocalEditorialControlWithBrain({
			projectId,
			document: d,
			userMessage: HELDOUT_TRIM,
			visualChangeEvents: [
				{ startSec: 3, endSec: 4, level: "SIGNIFICANT" },
				{ startSec: 18, endSec: 19.5, level: "SIGNIFICANT" },
			],
			skipVisualAnalysis: true,
			presenceJudge: async () => ({
				present: true,
				confidence: "LOW",
				reason: "both",
				rawText: "{}",
				providerId: "injected",
				model: "unit",
			}),
			ocrRecognize: async () => ({ text: "", available: true }),
		});
		expect(r.mutated).toBe(false);
		expect(programmeDurationSec(r.document)).toBeCloseTo(beforeDur, 2);
		expect(r.outcomeKind === "AMBIGUOUS" || r.outcomeKind === "NOT_FOUND").toBe(true);
	});
});
