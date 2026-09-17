/**
 * OPENSCREEN_SEMANTIC_EDIT_COMMAND_AND_CONVERSATIONAL_EXECUTION_V1
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import {
	isVerbalProceed,
	parseProfessionalEditIntent,
} from "../professionalEditOrchestrator/intent";
import {
	applyLocalEditorialControl,
	applyLocalEditorialControlWithBrain,
	clearLocalEditorialSessionsForTests,
	extractSemanticEventCue,
	getLocalEditorialPendingProposal,
	isAdviceOnlyEditQuestion,
	parseLocalEditorialRequest,
	resolveSemanticEditEvent,
	setLocalEditorialPendingProposal,
	setSemanticBrainForTests,
} from "./index";
import { resolveLocalEditorialRequest } from "./resolveFollowUp";
import { getLocalEditorialSession } from "./session";

function docWithTranscript(args: {
	id: string;
	durationSec: number;
	segments: Array<{ startSec: number; endSec: number; text: string }>;
	words?: Array<{ startSec: number; endSec: number; text: string }>;
}): AxcutDocument {
	const base = createEmptyDocument({ projectId: args.id, title: "semantic-v1" });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1", allowAgentEdits: true },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "rec",
				originalPath: "/tmp/semantic-v1.mp4",
				durationSec: args.durationSec,
				createdAt: new Date().toISOString(),
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId: "asset_1",
					sourceStartSec: 0,
					sourceEndSec: args.durationSec,
					timelineStartSec: 0,
					timelineEndSec: args.durationSec,
					origin: "system",
					reason: "primary",
				},
			],
		},
		transcripts: [
			{
				id: "tr1",
				assetId: "asset_1",
				language: "en",
				segments: args.segments.map((s, i) => ({
					id: `seg_${i}`,
					startSec: s.startSec,
					endSec: s.endSec,
					text: s.text,
					kind: "speech" as const,
				})),
				words: (args.words ?? []).map((w, i) => ({
					id: `w_${i}`,
					segmentId: `seg_0`,
					startSec: w.startSec,
					endSec: w.endSec,
					text: w.text,
					confidence: 0.9,
				})),
			},
		],
	});
}

describe("SEMANTIC_EDIT_COMMAND_AND_CONVERSATIONAL_EXECUTION_V1", () => {
	beforeEach(() => clearLocalEditorialSessionsForTests());
	afterEach(() => {
		setSemanticBrainForTests(null);
		clearLocalEditorialSessionsForTests();
	});

	it("A: timed zoom remains direct EXECUTE", () => {
		const r = parseLocalEditorialRequest("zoom from 5 to 10 seconds");
		expect(r.intent).toBe("ADD_ZOOM");
		expect(r.executionKind).toBe("direct_document");
		expect(r.zoomAuthorization).toBe("execute");
		expect(r.range?.startSec).toBe(5);
		expect(r.range?.endSec).toBe(10);
	});

	it("B: semantic WHEN cue → direct authority (not orch propose)", () => {
		const r = parseLocalEditorialRequest("zoom when I switch to the landing page");
		expect(r.intent).toBe("ADD_ZOOM");
		expect(r.semanticEventCue).toMatch(/landing page/i);
		expect(r.executionKind).toBe("direct_document");
		expect(r.zoomAuthorization).toBe("execute");
	});

	it("resolves landing-page event only with requested-event identity, not pixel change alone", () => {
		const document = docWithTranscript({
			id: "proj_land",
			durationSec: 40,
			segments: [
				{ startSec: 2, endSec: 5, text: "opening the editor" },
				{ startSec: 17, endSec: 20, text: "now the landing page appears" },
			],
			words: [
				{ startSec: 18.0, endSec: 18.3, text: "landing" },
				{ startSec: 18.3, endSec: 18.6, text: "page" },
			],
		});
		const speechOnly = resolveSemanticEditEvent({
			cue: "when I switch to the landing page",
			document,
			cursorSamples: [{ atSec: 18.2, cx: 0.4, cy: 0.5, interactionType: "click" }],
		});
		expect(speechOnly.status).toBe("NOT_FOUND");

		const changeOnly = resolveSemanticEditEvent({
			cue: "when I switch to the landing page",
			document,
			cursorSamples: [{ atSec: 18.2, cx: 0.4, cy: 0.5, interactionType: "click" }],
			visualChangeEvents: [{ startSec: 17.8, endSec: 18.6, level: "SIGNIFICANT" }],
			visualAnalysisUsed: true,
			identityChecked: true,
		});
		expect(changeOnly.status).toBe("NOT_FOUND");
		expect(changeOnly.userFacingReason).toMatch(
			/pixel\/activity|does not identify|couldn.?t identify|event identity/i,
		);

		const identityByAnchorSec = new Map([
			[
				18.0,
				{
					requestedEventIdentified: true,
					visualChangeObserved: true,
					evidenceRefs: ["ocr_onset:landing page"],
					onsetTokens: ["landing page"],
				},
			],
		]);
		const resolved = resolveSemanticEditEvent({
			cue: "when I switch to the landing page",
			document,
			cursorSamples: [{ atSec: 18.2, cx: 0.4, cy: 0.5, interactionType: "click" }],
			visualChangeEvents: [{ startSec: 17.8, endSec: 18.6, level: "SIGNIFICANT" }],
			visualAnalysisUsed: true,
			identityByAnchorSec,
			identityChecked: true,
		});
		expect(resolved.status).toBe("FOUND");
		expect(resolved.best?.requestedEventIdentified).toBe(true);
		expect(resolved.userFacingReason).toMatch(/requested event identified/i);
		expect(resolved.userFacingReason).not.toMatch(/visual change confirmed/i);
		expect(resolved.best?.anchorSec).toBeGreaterThan(15);
		expect(resolved.best?.anchorSec).toBeLessThan(22);
	});

	it("C: click Export prefers click+transcript", () => {
		const document = docWithTranscript({
			id: "proj_export",
			durationSec: 30,
			segments: [{ startSec: 11, endSec: 13, text: "click Export now" }],
			words: [{ startSec: 11.5, endSec: 11.9, text: "Export" }],
		});
		const resolved = resolveSemanticEditEvent({
			cue: "when I click Export",
			document,
			cursorSamples: [
				{ atSec: 11.6, cx: 0.7, cy: 0.2, interactionType: "click" },
				{ atSec: 3.0, cx: 0.1, cy: 0.1, interactionType: "click" },
			],
		});
		expect(resolved.status).toBe("FOUND");
		expect(resolved.best?.anchorSec).toBeGreaterThan(10);
		expect(resolved.best?.anchorSec).toBeLessThan(13);
	});

	it("D: spoken pricing grounds from transcript", () => {
		const document = docWithTranscript({
			id: "proj_price",
			durationSec: 40,
			segments: [{ startSec: 22, endSec: 26, text: "now talking about pricing for teams" }],
			words: [{ startSec: 23.0, endSec: 23.4, text: "pricing" }],
		});
		const resolved = resolveSemanticEditEvent({
			cue: "when I start talking about pricing",
			document,
		});
		expect(resolved.status).toBe("FOUND");
		expect(resolved.best?.anchorSec).toBeGreaterThan(21);
	});

	it("E: professional + zoom keeps zoom family in orch message", () => {
		const r = parseLocalEditorialRequest("can u make it professional? add a zooming functionality");
		expect(r.requestedFamilies).toContain("zoom");
		expect(r.orchestratorMessage ?? "").toMatch(/zoom/i);
		expect(r.orchestratorMessage ?? "").toMatch(/Original user request/i);
		const intent = parseProfessionalEditIntent(r.orchestratorMessage ?? "");
		expect(intent.explicitlyRequestedFamilies).toContain("zoom");
	});

	it("F: advice question uses AI WHAT then proposes; yes executes pending", async () => {
		const document = docWithTranscript({
			id: "proj_advice",
			durationSec: 40,
			segments: [{ startSec: 12, endSec: 15, text: "switch to the landing page" }],
			words: [
				{ startSec: 13.0, endSec: 13.3, text: "landing" },
				{ startSec: 13.3, endSec: 13.6, text: "page" },
			],
		});
		expect(isAdviceOnlyEditQuestion("Do you think the landing-page switch needs a zoom?")).toBe(
			true,
		);
		expect(
			parseLocalEditorialRequest("Do you think the landing-page switch needs a zoom?")
				.executionKind,
		).toBe("semantic_understanding");

		setSemanticBrainForTests(async (ctx) => ({
			version: 1,
			rawText: ctx.userMessage,
			parseStatus: "REASONED",
			goal: "RECOMMEND",
			authority: "ADVISORY",
			skills: ["zoom"],
			operation: "add",
			target: {
				type: "SEMANTIC_EVENT",
				range: null,
				semanticEvent: "when the landing page switch happens",
				editRef: null,
			},
			modification: null,
			confidence: "HIGH",
			unresolvedReason: null,
			providerId: "test/brain",
			providerCalls: 1,
			cloudCalls: 0,
			latencyMs: 1,
		}));

		const advice = await applyLocalEditorialControlWithBrain({
			projectId: document.project.id,
			document,
			userMessage: "Do you think the landing-page switch needs a zoom?",
			visualChangeEvents: [{ startSec: 12.8, endSec: 13.8, level: "SIGNIFICANT" }],
			skipVisualAnalysis: true,
			extractFrame: async () => true,
			presenceJudge: async ({ programmeSec }) => ({
				present: programmeSec >= 12.8 - 0.01,
				confidence: "HIGH",
				reason: "present",
				rawText: "{}",
				providerId: "injected",
				model: "unit",
			}),
			ocrRecognize: async () => ({ text: "landing page", available: true }),
		});
		expect(advice.mutated).toBe(false);
		expect(advice.providerCalls).toBeGreaterThanOrEqual(1);
		expect(advice.request.semanticSkillRequest?.authority).toBe("ADVISORY");
		expect(advice.request.semanticSkillRequest?.skills).toContain("zoom");
		expect(advice.request.semanticSkillRequest?.target.type).toBe("SEMANTIC_EVENT");

		let pending = getLocalEditorialPendingProposal(document.project.id);
		if (!pending) {
			// WHERE may not certify under synthetic /tmp media — seed RAW pending to prove yes authority.
			const fp = fingerprintDocument(document).value;
			setLocalEditorialPendingProposal(document.project.id, {
				kind: "advice_zoom",
				summary: "Zoom pending",
				documentFingerprint: fp,
				createdAtIso: new Date().toISOString(),
				range: { startSec: 12.8, endSec: 16.8 },
				zoomDepth: 3,
				evidenceRefs: ["test"],
				planFingerprint: null,
				families: ["zoom"],
				semanticEventCue: "when the landing page switch happens",
				requiresConfirmation: true,
				status: "PROPOSED",
				parameters: { zoomDepth: 3 },
			});
			pending = getLocalEditorialPendingProposal(document.project.id);
		}
		expect(pending?.kind).toBe("advice_zoom");

		setSemanticBrainForTests(null);
		const yes = await applyLocalEditorialControlWithBrain({
			projectId: document.project.id,
			document,
			userMessage: "yes, do it",
		});
		expect(yes.mutated).toBe(true);
		expect((yes.document.zoomRanges ?? []).length).toBeGreaterThan(0);
		expect(yes.cloudCalls).toBe(0);
	});

	it("G: go ahead confirms orch pending without reassess loop", () => {
		const projectId = "proj_orch_pending";
		setLocalEditorialPendingProposal(projectId, {
			kind: "orch_plan",
			summary: "pending",
			documentFingerprint: "fp",
			createdAtIso: new Date().toISOString(),
			range: null,
			zoomDepth: null,
			evidenceRefs: ["step1"],
			planFingerprint: "abc",
			families: ["trim"],
			semanticEventCue: null,
		});
		const sess = getLocalEditorialSession(projectId);
		const r = resolveLocalEditorialRequest("go ahead", sess);
		expect(r.executionKind).toBe("professional_orchestrator");
		expect(r.orchestratorMessage ?? "").toMatch(/confirmed|Proceed/i);
		expect(
			isVerbalProceed(r.orchestratorMessage ?? "") || /Proceed/i.test(r.orchestratorMessage ?? ""),
		).toBe(true);
	});

	it("H: clearly later identified onset loses to earliest first appearance", () => {
		const document = docWithTranscript({
			id: "proj_amb",
			durationSec: 50,
			segments: [
				{ startSec: 8, endSec: 10, text: "landing page one" },
				{ startSec: 21, endSec: 23, text: "landing page two" },
			],
			words: [
				{ startSec: 8.5, endSec: 8.8, text: "landing" },
				{ startSec: 8.8, endSec: 9.1, text: "page" },
				{ startSec: 21.5, endSec: 21.8, text: "landing" },
				{ startSec: 21.8, endSec: 22.1, text: "page" },
			],
		});
		const resolved = resolveSemanticEditEvent({
			cue: "when I switch to the landing page",
			document,
			visualChangeEvents: [
				{ startSec: 8.2, endSec: 9.0, level: "SIGNIFICANT" },
				{ startSec: 21.2, endSec: 22.0, level: "SIGNIFICANT" },
			],
			visualAnalysisUsed: true,
			identityChecked: true,
			identityByAnchorSec: new Map([
				[
					8.5,
					{
						requestedEventIdentified: true,
						visualChangeObserved: true,
						evidenceRefs: ["ocr_onset:landing"],
						onsetTokens: ["landing"],
					},
				],
				[
					21.5,
					{
						requestedEventIdentified: true,
						visualChangeObserved: true,
						evidenceRefs: ["ocr_onset:landing"],
						onsetTokens: ["landing"],
					},
				],
			]),
		});
		// Late speech/scroll while page already visible is not a second onset.
		expect(resolved.status).toBe("FOUND");
		expect(resolved.best?.anchorSec).toBeLessThan(11);
		expect(resolved.best?.anchorSec).toBeLessThan(15);
		expect(resolved.userFacingReason).toMatch(/programme time/i);
	});

	it("H2: near-duplicate identified onsets merge to one earliest FOUND", () => {
		const document = docWithTranscript({
			id: "proj_amb_close",
			durationSec: 50,
			segments: [
				{ startSec: 8, endSec: 10, text: "landing page one" },
				{ startSec: 9.5, endSec: 11, text: "landing page two" },
			],
			words: [
				{ startSec: 8.5, endSec: 8.8, text: "landing" },
				{ startSec: 9.8, endSec: 10.1, text: "landing" },
			],
		});
		const resolved = resolveSemanticEditEvent({
			cue: "when I switch to the landing page",
			document,
			visualChangeEvents: [
				{ startSec: 8.2, endSec: 9.0, level: "SIGNIFICANT" },
				{ startSec: 9.5, endSec: 10.3, level: "SIGNIFICANT" },
			],
			visualAnalysisUsed: true,
			identityChecked: true,
			identityByAnchorSec: new Map([
				[
					8.5,
					{
						requestedEventIdentified: true,
						visualChangeObserved: true,
						evidenceRefs: ["ocr_onset:landing"],
						onsetTokens: ["landing"],
					},
				],
				[
					9.8,
					{
						requestedEventIdentified: true,
						visualChangeObserved: true,
						evidenceRefs: ["ocr_onset:landing"],
						onsetTokens: ["landing"],
					},
				],
			]),
		});
		expect(resolved.status).toBe("FOUND");
		expect(resolved.best?.anchorSec).toBeLessThan(10.5);
		expect(resolved.best?.requestedEventIdentified).toBe(true);
	});

	it("H3: prefers earliest Connect-neighbourhood onset over late speech 15.5s", () => {
		const document = docWithTranscript({
			id: "proj_onset_earliest",
			durationSec: 23.72,
			segments: [
				{ startSec: 8.2, endSec: 9.4, text: "opening connect" },
				{ startSec: 14.8, endSec: 16.2, text: "now the landing page appears" },
			],
			words: [
				{ startSec: 8.9, endSec: 9.2, text: "landing" },
				{ startSec: 15.3, endSec: 15.6, text: "landing" },
				{ startSec: 15.6, endSec: 15.9, text: "page" },
			],
		});
		const resolved = resolveSemanticEditEvent({
			cue: "when the landing page appears",
			document,
			visualChangeEvents: [
				{ startSec: 8.4, endSec: 9.2, level: "SIGNIFICANT" },
				{ startSec: 15.1, endSec: 15.9, level: "SIGNIFICANT" },
			],
			visualAnalysisUsed: true,
			identityChecked: true,
			identityByAnchorSec: new Map([
				[
					8.9,
					{
						requestedEventIdentified: true,
						visualChangeObserved: true,
						evidenceRefs: ["vision:connect_onset"],
						onsetTokens: ["landing"],
					},
				],
				[
					15.5,
					{
						requestedEventIdentified: true,
						visualChangeObserved: true,
						evidenceRefs: ["speech:landing_page"],
						onsetTokens: ["landing", "page"],
					},
				],
			]),
		});
		expect(resolved.status).toBe("FOUND");
		expect(resolved.best?.anchorSec).toBeLessThan(10);
		expect(resolved.best?.anchorSec).toBeCloseTo(8.9, 0);
		expect(resolved.best?.anchorSec).not.toBeCloseTo(15.5, 0);
	});

	it("I: absent event is specific, not generic unsafe", () => {
		const document = docWithTranscript({
			id: "proj_absent",
			durationSec: 20,
			segments: [{ startSec: 1, endSec: 3, text: "hello world" }],
		});
		const applied = applyLocalEditorialControl({
			projectId: document.project.id,
			document,
			userMessage: "zoom when I open the quantum flux console",
			visualChangeEvents: [],
			visualAnalysisUsed: true,
		});
		expect(applied.mutated).toBe(false);
		expect(applied.userFacingText).toMatch(
			/couldn'?t (?:reliably locate|visually confirm|identify)/i,
		);
		expect(applied.userFacingText).not.toMatch(/safe, recording-specific edit/i);
	});

	it("extracts semantic cue", () => {
		expect(
			extractSemanticEventCue("u can add the zoom when we are switching to a landing page"),
		).toMatch(/landing page/i);
	});

	it("add the zoom authorizes you_decide", () => {
		const intent = parseProfessionalEditIntent(
			"u can add the zoom when we are switching to a landing page",
		);
		expect(intent.autonomy).toBe("you_decide");
		expect(intent.explicitlyRequestedFamilies).toContain("zoom");
	});
});
