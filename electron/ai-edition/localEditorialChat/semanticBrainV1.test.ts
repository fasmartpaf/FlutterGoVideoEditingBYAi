/**
 * OPENSCREEN_AI_SKILL_ENGINE_AND_SEMANTIC_BRAIN_V1
 * Unseen paraphrase corpus — utterances must NOT appear in production regex routers.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import {
	buildEditingSkillRegistryV1,
	chatAvailableSkills,
} from "../autonomousProfessionalEditor/skillRegistry";
import {
	applyLocalEditorialControl,
	applyLocalEditorialControlWithBrain,
	applySemanticToLocalRequest,
	clearLocalEditorialSessionsForTests,
	getLocalEditorialPendingProposal,
	setLocalEditorialPendingProposal,
	setSemanticBrainForTests,
	validateSemanticSkillRequest,
} from "./index";
import { parseLocalEditorialRequest } from "./parse";
import type { SemanticSkillRequestV1 } from "./semanticContract";
import { resolveExecutableRegistrySkill, SEMANTIC_TO_REGISTRY } from "./skillRegistryGate";

/** Evaluation-only utterances — never copy into parse.ts / intent.ts keyword lists. */
export const UNSEEN_PARAPHRASE_CORPUS = {
	emphasizeWithoutZoom:
		"When I leave the code and the site comes into view, bring attention to it.",
	indirectPacing: "The beginning feels sluggish and overstays its welcome.",
	semanticWaitingRemoval:
		"That waiting stretch before the result shows up isn't important — hurry past it.",
	naturalConfirm: "that's what I meant",
	confirmStronger: "yes, but make it a little stronger",
	rejectRetarget: "No, I mean when the results page appears.",
	professionalizeWithoutWord: "Make the whole thing feel like a polished product demo for viewers.",
	advisoryNoMutate: "Would it help to emphasize the moment the site appears?",
	timedZeroProvider: "zoom from 5 to 10 seconds",
} as const;

function docWithTranscript(args: {
	id: string;
	durationSec: number;
	segments: Array<{ startSec: number; endSec: number; text: string }>;
}): AxcutDocument {
	const base = createEmptyDocument({ projectId: args.id, title: "semantic-brain-v1" });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1", allowAgentEdits: true },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "rec",
				originalPath: "/tmp/semantic-brain-v1.mp4",
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
				words: [],
			},
		],
	});
}

function mockBrainForCorpus(msg: string, pending: unknown): SemanticSkillRequestV1 {
	const base = {
		version: 1 as const,
		rawText: msg,
		parseStatus: "REASONED" as const,
		operation: "add" as const,
		modification: null,
		confidence: "HIGH" as const,
		unresolvedReason: null,
		providerId: "test-injected-brain",
		providerCalls: 1,
		cloudCalls: 0,
		latencyMs: 2,
	};
	if (msg === UNSEEN_PARAPHRASE_CORPUS.emphasizeWithoutZoom) {
		return {
			...base,
			goal: "EMPHASIZE",
			authority: "USER_EXPLICIT",
			skills: ["zoom"],
			target: {
				type: "SEMANTIC_EVENT",
				range: null,
				semanticEvent: "transition from code to the site coming into view",
				editRef: null,
			},
		};
	}
	if (msg === UNSEEN_PARAPHRASE_CORPUS.indirectPacing) {
		return {
			...base,
			goal: "IMPROVE_PACING",
			authority: "USER_EXPLICIT",
			skills: ["trim", "speed"],
			target: {
				type: "SEMANTIC_EVENT",
				range: null,
				semanticEvent: "the beginning that feels sluggish",
				editRef: null,
			},
		};
	}
	if (msg === UNSEEN_PARAPHRASE_CORPUS.semanticWaitingRemoval) {
		return {
			...base,
			goal: "SHORTEN",
			authority: "USER_EXPLICIT",
			skills: ["speed"],
			target: {
				type: "SEMANTIC_EVENT",
				range: null,
				semanticEvent: "waiting stretch before the result shows up",
				editRef: null,
			},
		};
	}
	if (msg === UNSEEN_PARAPHRASE_CORPUS.naturalConfirm && pending) {
		return {
			...base,
			goal: "CONFIRM_PENDING",
			authority: "USER_CONFIRMED",
			skills: ["zoom"],
			operation: "add",
			target: {
				type: "PENDING_PROPOSAL",
				range: null,
				semanticEvent: null,
				editRef: "pending",
			},
			providerCalls: 1,
		};
	}
	if (msg === UNSEEN_PARAPHRASE_CORPUS.confirmStronger && pending) {
		return {
			...base,
			goal: "MODIFY_PENDING",
			authority: "USER_CONFIRMED",
			skills: ["zoom"],
			operation: "adjust",
			modification: { intensity: "stronger" },
			target: {
				type: "PENDING_PROPOSAL",
				range: null,
				semanticEvent: null,
				editRef: "pending",
			},
		};
	}
	if (msg === UNSEEN_PARAPHRASE_CORPUS.rejectRetarget) {
		return {
			...base,
			goal: "EMPHASIZE",
			authority: "USER_EXPLICIT",
			skills: ["zoom"],
			target: {
				type: "SEMANTIC_EVENT",
				range: null,
				semanticEvent: "when the results page appears",
				editRef: null,
			},
		};
	}
	if (msg === UNSEEN_PARAPHRASE_CORPUS.professionalizeWithoutWord) {
		return {
			...base,
			goal: "PROFESSIONALIZE",
			authority: "AUTONOMOUS",
			skills: ["trim", "zoom", "speed", "captions", "transitions"],
			operation: null,
			target: {
				type: "WHOLE_PROGRAMME",
				range: null,
				semanticEvent: null,
				editRef: null,
			},
		};
	}
	if (msg === UNSEEN_PARAPHRASE_CORPUS.advisoryNoMutate) {
		return {
			...base,
			goal: "RECOMMEND",
			authority: "ADVISORY",
			skills: ["zoom"],
			operation: "add",
			target: {
				type: "SEMANTIC_EVENT",
				range: null,
				semanticEvent: "moment the site appears",
				editRef: null,
			},
		};
	}
	return {
		...base,
		goal: "UNKNOWN",
		authority: "ADVISORY",
		skills: [],
		operation: null,
		parseStatus: "UNRESOLVED",
		target: { type: "UNKNOWN", range: null, semanticEvent: null, editRef: null },
		confidence: "LOW",
		unresolvedReason: "test brain: no mapping",
		providerCalls: 1,
	};
}

describe("AI_SKILL_ENGINE_AND_SEMANTIC_BRAIN_V1", () => {
	beforeEach(() => {
		clearLocalEditorialSessionsForTests();
		setSemanticBrainForTests(async (ctx) => mockBrainForCorpus(ctx.userMessage, ctx.pending));
	});
	afterEach(() => {
		setSemanticBrainForTests(null);
		clearLocalEditorialSessionsForTests();
	});

	it("anti-memorization: unseen paraphrase strings absent from production routers", () => {
		const roots = [
			join(__dirname, "parse.ts"),
			join(__dirname, "../professionalEditOrchestrator/intent.ts"),
			join(__dirname, "resolveFollowUp.ts"),
		];
		const sources = roots.map((p) => readFileSync(p, "utf8")).join("\n");
		for (const phrase of Object.values(UNSEEN_PARAPHRASE_CORPUS)) {
			if (phrase === UNSEEN_PARAPHRASE_CORPUS.timedZeroProvider) continue;
			expect(sources.includes(phrase), `leaked into router: ${phrase}`).toBe(false);
		}
	});

	it("does not default to ollama — missing Chat provider is an honest failure", async () => {
		setSemanticBrainForTests(null);
		const r = await applyLocalEditorialControlWithBrain({
			projectId: "sb-no-provider",
			document: docWithTranscript({
				id: "sb-no-provider",
				durationSec: 10,
				segments: [],
			}),
			userMessage: UNSEEN_PARAPHRASE_CORPUS.emphasizeWithoutZoom,
			chatModelConfig: null,
		});
		expect(r.mutated).toBe(false);
		expect(r.userFacingText.toLowerCase()).not.toMatch(/ollama/);
		expect(r.userFacingText.toLowerCase()).toMatch(/chat ai provider|settings/);
	});

	it("rejects model-supplied SEMANTIC_EVENT timestamps without stripping first", () => {
		const bad = validateSemanticSkillRequest({
			version: 1,
			rawText: "focus the site",
			parseStatus: "REASONED",
			goal: "EMPHASIZE",
			authority: "USER_EXPLICIT",
			skills: ["zoom"],
			operation: "add",
			target: {
				type: "SEMANTIC_EVENT",
				range: { startSec: 3, endSec: 5 },
				semanticEvent: "site appears",
				editRef: null,
			},
			modification: null,
			confidence: "HIGH",
			unresolvedReason: null,
			providerId: "x",
			providerCalls: 1,
			cloudCalls: 0,
			latencyMs: 1,
		});
		expect(bad.ok).toBe(false);
		if (!bad.ok) {
			expect(bad.errors.some((e) => /timestamp|range/i.test(e))).toBe(true);
		}
	});

	it("repairs invalid target.type aliases / free-language type slips (live gpt-4o failure class)", () => {
		const advisory = validateSemanticSkillRequest({
			version: 1,
			rawText: "Would it help viewers if the landing page appearance stood out more?",
			parseStatus: "REASONED",
			goal: "RECOMMEND",
			authority: "ADVISORY",
			skills: ["zoom"],
			operation: null,
			target: {
				type: "landing page appearance",
				range: null,
				semanticEvent: null,
				editRef: null,
			},
			modification: null,
			confidence: "MEDIUM",
			unresolvedReason: null,
			providerId: "openai/gpt-4o",
			providerCalls: 1,
			cloudCalls: 1,
			latencyMs: 400,
		});
		expect(advisory.ok).toBe(true);
		if (advisory.ok) {
			expect(advisory.request.target.type).toBe("SEMANTIC_EVENT");
			expect(advisory.request.target.semanticEvent).toMatch(/landing page/i);
			expect(advisory.request.target.range).toBeNull();
			expect(advisory.request.authority).toBe("ADVISORY");
		}

		const snake = validateSemanticSkillRequest({
			version: 1,
			rawText: "stand out more",
			parseStatus: "REASONED",
			goal: "RECOMMEND",
			authority: "ADVISORY",
			skills: ["zoom"],
			operation: null,
			target: {
				type: "semantic_event",
				range: null,
				semanticEvent: "landing page appearance",
				editRef: null,
			},
			modification: null,
			confidence: "HIGH",
			unresolvedReason: null,
			providerId: "openai/gpt-4o",
			providerCalls: 1,
			cloudCalls: 1,
			latencyMs: 200,
		});
		expect(snake.ok).toBe(true);
		if (snake.ok) expect(snake.request.target.type).toBe("SEMANTIC_EVENT");
	});

	it("still rejects fabricated edit refs after repair", () => {
		const bad = validateSemanticSkillRequest({
			version: 1,
			rawText: "yes",
			parseStatus: "REASONED",
			goal: "CONFIRM_PENDING",
			authority: "USER_CONFIRMED",
			skills: ["zoom"],
			operation: "add",
			target: {
				type: "pending",
				range: null,
				semanticEvent: null,
				editRef: "fabricated_zoom_1",
			},
			modification: null,
			confidence: "HIGH",
			unresolvedReason: null,
			providerId: "x",
			providerCalls: 1,
			cloudCalls: 0,
			latencyMs: 1,
		});
		expect(bad.ok).toBe(false);
	});

	it("maps chat skill ids to registry ZOOM / SPEED_UP / TITLES_CALLOUTS", () => {
		expect(SEMANTIC_TO_REGISTRY.zoom).toContain("ZOOM");
		expect(SEMANTIC_TO_REGISTRY.speed).toContain("SPEED_UP");
		expect(SEMANTIC_TO_REGISTRY.title).toContain("TITLES_CALLOUTS");
		expect(resolveExecutableRegistrySkill("zoom")?.skill).toBe("ZOOM");
	});

	it("skill registry exposes chat routing metadata", () => {
		const chat = chatAvailableSkills(buildEditingSkillRegistryV1());
		expect(chat.some((s) => s.skill === "ZOOM" && s.acceptsSemanticTarget)).toBe(true);
		expect(chat.some((s) => s.skill === "TRIM" && s.directEntry)).toBe(true);
	});

	it("1: emphasize without zoom word → USER_EXPLICIT zoom + semantic event", async () => {
		const doc = docWithTranscript({
			id: "sb1",
			durationSec: 30,
			segments: [
				{ startSec: 0, endSec: 4, text: "still in the code editor" },
				{ startSec: 8, endSec: 14, text: "here is the site coming into view" },
			],
		});
		const before = fingerprintDocument(doc).value;
		const t0 = Date.now();
		const r = await applyLocalEditorialControlWithBrain({
			projectId: "sb1",
			document: doc,
			userMessage: UNSEEN_PARAPHRASE_CORPUS.emphasizeWithoutZoom,
			visualChangeEvents: [{ startSec: 8.5, endSec: 10.5, level: "SIGNIFICANT" }],
			skipVisualAnalysis: true,
			ocrRecognize: async (imagePath: string) => {
				if (imagePath.includes("before")) {
					return { text: "code editor", available: true };
				}
				return { text: "here is the site coming into view", available: true };
			},
		});
		const latency = Date.now() - t0;
		expect(r.request.authority).toBe("USER_EXPLICIT");
		expect(r.request.requestedFamilies).toContain("zoom");
		expect(r.request.semanticEventCue).toMatch(/site|code/i);
		expect(r.request.semanticSkillRequest?.target.range ?? null).toBeNull();
		expect(r.providerCalls).toBeGreaterThanOrEqual(1);
		expect(latency).toBeLessThan(5000);
		if (r.mutated) {
			expect(r.documentFingerprintAfter).not.toBe(before);
			expect(r.document.zoomRanges.length).toBeGreaterThan(0);
			expect(r.outcomeKind).toBe("APPLIED");
		} else {
			// Grounding may AMBIGUOUS/NOT_FOUND — must not be generic KEEP honesty.
			expect(r.userFacingText.toLowerCase()).not.toMatch(/no safe recording-specific/);
			expect(["AMBIGUOUS", "NOT_FOUND", "UNDERSTANDING_FAILED", "UNCHANGED"]).toContain(
				r.outcomeKind ?? "UNCHANGED",
			);
		}
	});

	it("speech-only visual cue must not FOUND without visual evidence", async () => {
		const doc = docWithTranscript({
			id: "sb-speech-only",
			durationSec: 20,
			segments: [{ startSec: 6, endSec: 10, text: "website appears now" }],
		});
		const r = await applyLocalEditorialControlWithBrain({
			projectId: "sb-speech-only",
			document: doc,
			userMessage: UNSEEN_PARAPHRASE_CORPUS.advisoryNoMutate,
			visualChangeEvents: [],
			skipVisualAnalysis: true,
		});
		expect(r.mutated).toBe(false);
		expect(r.document.zoomRanges.length).toBe(0);
		expect(r.userFacingText.toLowerCase()).toMatch(
			/visually confirm|spoken evidence|approximate time/,
		);
		expect(getLocalEditorialPendingProposal("sb-speech-only")).toBeNull();
	});

	it("rejects registry skill without explicit chatAvailable:true", () => {
		const fake = {
			...buildEditingSkillRegistryV1().find((s) => s.skill === "ZOOM")!,
			chatAvailable: undefined,
		};
		expect(
			resolveExecutableRegistrySkill("zoom", [{ ...fake, chatAvailable: undefined }]),
		).toBeNull();
		expect(resolveExecutableRegistrySkill("zoom")?.chatAvailable).toBe(true);
	});

	it("registry directEntry binds zoom chat skill to ADD_ZOOM intent", () => {
		const base = parseLocalEditorialRequest("x");
		const mapped = applySemanticToLocalRequest(base, {
			version: 1,
			rawText: "emphasize the moment",
			parseStatus: "REASONED",
			goal: "EMPHASIZE",
			authority: "USER_EXPLICIT",
			skills: ["zoom"],
			operation: "add",
			target: {
				type: "SEMANTIC_EVENT",
				range: null,
				semanticEvent: "when the site appears",
				editRef: null,
			},
			modification: null,
			confidence: "HIGH",
			unresolvedReason: null,
			providerId: "t",
			providerCalls: 1,
			cloudCalls: 0,
			latencyMs: 1,
		});
		expect(mapped.intent).toBe("ADD_ZOOM");
		expect(mapped.executionKind).toBe("direct_document");
	});

	it("4+5: pending confirm and yes-but-stronger (structural + brain)", async () => {
		const doc = docWithTranscript({
			id: "sb2",
			durationSec: 20,
			segments: [{ startSec: 5, endSec: 9, text: "landing page opens" }],
		});
		const beforeFp = fingerprintDocument(doc).value;
		setLocalEditorialPendingProposal("sb2", {
			kind: "semantic_edit",
			summary: "Zoom at landing",
			documentFingerprint: beforeFp,
			createdAtIso: new Date().toISOString(),
			range: { startSec: 5, endSec: 9 },
			zoomDepth: 3,
			evidenceRefs: ["transcript:landing"],
			planFingerprint: null,
			families: ["zoom"],
			semanticEventCue: "when the landing page opens",
			requiresConfirmation: true,
			status: "PROPOSED",
			parameters: { zoomDepth: 3 },
		});

		// Structural path: yes + stronger (0 provider if brain not needed after pending structural)
		setSemanticBrainForTests(null);
		const stronger = await applyLocalEditorialControlWithBrain({
			projectId: "sb2",
			document: doc,
			userMessage: UNSEEN_PARAPHRASE_CORPUS.confirmStronger,
		});
		expect(stronger.request.authority).toBe("USER_CONFIRMED");
		expect(stronger.mutated).toBe(true);
		expect(stronger.document.zoomRanges[0]!.depth).toBeGreaterThanOrEqual(4);
		expect(stronger.cloudCalls).toBe(0);
		expect(getLocalEditorialPendingProposal("sb2")).toBeNull();
	});

	it("8: advisory must not mutate", async () => {
		const doc = docWithTranscript({
			id: "sb3",
			durationSec: 20,
			segments: [{ startSec: 6, endSec: 10, text: "site appears now" }],
		});
		const r = await applyLocalEditorialControlWithBrain({
			projectId: "sb3",
			document: doc,
			userMessage: UNSEEN_PARAPHRASE_CORPUS.advisoryNoMutate,
		});
		expect(r.mutated).toBe(false);
		expect(r.request.authority).toBe("ADVISORY");
		expect(r.document.zoomRanges.length).toBe(0);
	});

	it("9: timed command remains high-confidence zero-provider", async () => {
		const doc = docWithTranscript({
			id: "sb4",
			durationSec: 20,
			segments: [],
		});
		setSemanticBrainForTests(async () => {
			throw new Error("brain must not run for timed zoom");
		});
		const r = await applyLocalEditorialControlWithBrain({
			projectId: "sb4",
			document: doc,
			userMessage: UNSEEN_PARAPHRASE_CORPUS.timedZeroProvider,
		});
		expect(r.request.parseStatus).toBe("HIGH_CONFIDENCE");
		expect(r.request.executionKind).toBe("direct_document");
		expect(r.mutated).toBe(true);
		expect(r.providerCalls ?? 0).toBe(0);
		expect(r.cloudCalls).toBe(0);
	});

	it("7: professionalize without the word professional → orch handoff AUTONOMOUS", async () => {
		const doc = docWithTranscript({
			id: "sb5",
			durationSec: 20,
			segments: [{ startSec: 0, endSec: 3, text: "hello" }],
		});
		const r = await applyLocalEditorialControlWithBrain({
			projectId: "sb5",
			document: doc,
			userMessage: UNSEEN_PARAPHRASE_CORPUS.professionalizeWithoutWord,
		});
		expect(r.request.authority).toBe("AUTONOMOUS");
		expect(r.request.intent).toBe("PROFESSIONALIZE");
		expect(r.needsProfessionalOrchestrator).toBe(true);
		expect(r.mutated).toBe(false);
	});

	it("sync apply on UNRESOLVED without brain does not emit generic KEEP", () => {
		setSemanticBrainForTests(null);
		const r = applyLocalEditorialControl({
			projectId: "sb6",
			document: docWithTranscript({
				id: "sb6",
				durationSec: 10,
				segments: [],
			}),
			userMessage: UNSEEN_PARAPHRASE_CORPUS.emphasizeWithoutZoom,
		});
		expect(r.mutated).toBe(false);
		expect(r.outcomeKind).toBe("NEEDS_UNDERSTANDING");
		expect(r.userFacingText.toLowerCase()).not.toMatch(/no safe recording-specific/);
		expect(r.userFacingText.toLowerCase()).toMatch(
			/semantic understanding|language model|timed command/,
		);
	});
});
