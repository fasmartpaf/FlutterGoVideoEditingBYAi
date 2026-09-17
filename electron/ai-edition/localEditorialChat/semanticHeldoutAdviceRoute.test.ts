/**
 * Advisory natural language must call selected AI for WHAT (not parse→Zoom bypass).
 * WHERE uses evidence; WHICH uses registry; HOW stays frozen.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import {
	applyLocalEditorialControlWithBrain,
	clearLocalEditorialSessionsForTests,
	getLocalEditorialPendingProposal,
	isAdviceOnlyEditQuestion,
	parseLocalEditorialRequest,
	setSemanticBrainForTests,
} from "./index";
import type { SemanticSkillRequestV1 } from "./semanticContract";

const HELDOUT_FOCUS = "Would it help to focus the viewer when the site first appears?";
const HELDOUT_CALLOUT = "Would a short on-screen label help when the results show up?";
const PRIOR_STOOD_OUT = "Would it help viewers if the landing page appearance stood out more?";

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
				originalPath: "/tmp/heldout-what.mp4",
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

function brainZoomAdvisory(msg: string): SemanticSkillRequestV1 {
	return {
		version: 1,
		rawText: msg,
		parseStatus: "REASONED",
		goal: "RECOMMEND",
		authority: "ADVISORY",
		skills: ["zoom"],
		operation: "add",
		target: {
			type: "SEMANTIC_EVENT",
			range: null,
			semanticEvent: "when the site first appears",
			editRef: null,
		},
		modification: null,
		confidence: "HIGH",
		unresolvedReason: null,
		providerId: "openai/gpt-4o",
		providerCalls: 1,
		cloudCalls: 1,
		latencyMs: 40,
	};
}

function brainCalloutAdvisory(msg: string): SemanticSkillRequestV1 {
	return {
		version: 1,
		rawText: msg,
		parseStatus: "REASONED",
		goal: "RECOMMEND",
		authority: "ADVISORY",
		skills: ["callout"],
		operation: "add",
		target: {
			type: "SEMANTIC_EVENT",
			range: null,
			semanticEvent: "when the results appear",
			editRef: null,
		},
		modification: null,
		confidence: "HIGH",
		unresolvedReason: null,
		providerId: "openai/gpt-4o",
		providerCalls: 1,
		cloudCalls: 1,
		latencyMs: 35,
	};
}

describe("advisory AI WHAT routing (held-out)", () => {
	beforeEach(() => {
		clearLocalEditorialSessionsForTests();
		setSemanticBrainForTests(null);
	});
	afterEach(() => {
		clearLocalEditorialSessionsForTests();
		setSemanticBrainForTests(null);
	});

	it("parse: advice regex still tags ADVICE_ONLY but requires semantic brain WHAT", () => {
		const held = parseLocalEditorialRequest(HELDOUT_FOCUS);
		expect(isAdviceOnlyEditQuestion(HELDOUT_FOCUS)).toBe(true);
		expect(held.constraints).toContain("ADVICE_ONLY");
		expect(held.executionKind).toBe("semantic_understanding");
		expect(held.requiresSemanticReasoning).toBe(true);
		expect(held.intent).not.toBe("ADD_ZOOM");

		const prior = parseLocalEditorialRequest(PRIOR_STOOD_OUT);
		expect(prior.executionKind).toBe("semantic_understanding");
	});

	it("held-out focus advisory calls AI WHAT (providerCalls≥1) then evidence WHERE; no mutation", async () => {
		setSemanticBrainForTests(async (ctx) => brainZoomAdvisory(ctx.userMessage));
		const d = doc("heldout-what-zoom");
		const before = fingerprintDocument(d).value;
		const r = await applyLocalEditorialControlWithBrain({
			projectId: "heldout-what-zoom",
			document: d,
			userMessage: HELDOUT_FOCUS,
			visualChangeEvents: [{ startSec: 8.5, endSec: 10.5, level: "SIGNIFICANT" }],
			skipVisualAnalysis: true,
			presenceJudge: async ({ programmeSec }) => ({
				present: programmeSec >= 8.9,
				confidence: "HIGH",
				reason: `p=${programmeSec}`,
				rawText: "{}",
				providerId: "injected",
				model: "unit",
			}),
			ocrRecognize: async () => ({ text: "page", available: true }),
		});
		expect(r.providerCalls).toBeGreaterThanOrEqual(1);
		expect(r.understandingProviderId).toMatch(/gpt-4o|openai/i);
		expect(r.request.semanticSkillRequest?.authority).toBe("ADVISORY");
		expect(r.request.semanticSkillRequest?.target.type).toBe("SEMANTIC_EVENT");
		expect(r.request.semanticSkillRequest?.target.range).toBeNull();
		expect(r.mutated).toBe(false);
		expect(fingerprintDocument(r.document).value).toBe(before);
		expect(r.userFacingText.toLowerCase()).not.toMatch(
			/evidence status: unavailable \(visual analysis and presence were not searched\)/,
		);
		expect(
			r.outcomeKind === "ADVISORY" ||
				r.outcomeKind === "AMBIGUOUS" ||
				r.outcomeKind === "NOT_FOUND",
		).toBe(true);
	});

	it("alternative-skill advisory (callout) grounds WHERE, stores typed pending, does not force Zoom", async () => {
		setSemanticBrainForTests(async (ctx) => brainCalloutAdvisory(ctx.userMessage));
		const d = doc("heldout-what-callout");
		const r = await applyLocalEditorialControlWithBrain({
			projectId: "heldout-what-callout",
			document: d,
			userMessage: HELDOUT_CALLOUT,
			visualChangeEvents: [{ startSec: 8.5, endSec: 10.5, level: "SIGNIFICANT" }],
			skipVisualAnalysis: true,
			presenceJudge: async ({ programmeSec }) => ({
				present: programmeSec >= 8.9,
				confidence: "HIGH",
				reason: `p=${programmeSec}`,
				rawText: "{}",
				providerId: "injected",
				model: "unit",
			}),
			ocrRecognize: async () => ({ text: "results", available: true }),
		});
		expect(r.providerCalls).toBeGreaterThanOrEqual(1);
		expect(r.request.semanticSkillRequest?.skills).toContain("callout");
		expect(r.request.authority).toBe("ADVISORY");
		expect(r.mutated).toBe(false);
		expect(r.document.zoomRanges.length).toBe(0);
		expect(r.userFacingText.toLowerCase()).toMatch(/callout/);
		expect(r.userFacingText.toLowerCase()).not.toMatch(/i'd zoom in/);
		expect(r.userFacingText.toLowerCase()).toMatch(/\d+(\.\d+)?s/);
		expect(r.outcomeKind).toBe("ADVISORY");
		const pending = getLocalEditorialPendingProposal("heldout-what-callout");
		expect(pending?.kind).toBe("advice_callout");
		expect(pending?.families).toEqual(["callout"]);
		expect(pending?.parameters?.executeIntent).toBe("CALLOUT");
		expect(pending?.parameters?.rangeClock).toBe("programme");
		expect(pending?.range).toBeTruthy();
	});

	it("distinguishes evidence status: unavailable vs absent", async () => {
		setSemanticBrainForTests(async (ctx) => brainZoomAdvisory(ctx.userMessage));
		const d = doc("heldout-evidence");

		const unavailable = await applyLocalEditorialControlWithBrain({
			projectId: "heldout-evidence-unavail",
			document: d,
			userMessage: HELDOUT_FOCUS,
			visualChangeEvents: [],
			skipVisualAnalysis: true,
			skipIdentity: true,
		});
		expect(unavailable.mutated).toBe(false);
		expect(unavailable.providerCalls).toBeGreaterThanOrEqual(1);
		// skipIdentity → identity not searched after analysis empty
		expect(unavailable.userFacingText.toLowerCase()).toMatch(
			/unavailable|unsearched|not available|couldn't identify|spoken evidence/,
		);

		const absent = await applyLocalEditorialControlWithBrain({
			projectId: "heldout-evidence-absent",
			document: d,
			userMessage: HELDOUT_FOCUS,
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
		expect(absent.mutated).toBe(false);
		expect(absent.providerCalls).toBeGreaterThanOrEqual(1);
		expect(absent.userFacingText.toLowerCase()).toMatch(/absent|couldn't identify|not identified/);
	});
});
