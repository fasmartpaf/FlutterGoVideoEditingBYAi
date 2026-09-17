/**
 * Held-out NL via the ACTUAL selected Chat provider (openai/gpt-4o).
 *
 * Credentials: ONLY process.env.OPENAI_API_KEY or OPENSCREEN_SEMANTIC_REAL_PROVIDER_KEY.
 * Never reads or writes plaintext key files under _artifacts/.
 * Enable: OPENSCREEN_SEMANTIC_REAL_PROVIDER=1 plus a key in the environment.
 * A skip is never counted as a pass.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
	setLocalEditorialPendingProposal,
	setSemanticBrainForTests,
	understandSemanticRequest,
} from "./index";

const ART = join(
	process.cwd(),
	"electron/ai-edition/localEditorialChat/_artifacts/semantic-brain-v1",
);

function loadApiKey(): string {
	return (
		process.env.OPENSCREEN_SEMANTIC_REAL_PROVIDER_KEY?.trim() ||
		process.env.OPENAI_API_KEY?.trim() ||
		""
	);
}

const apiKey = loadApiKey();
const model = process.env.OPENSCREEN_SEMANTIC_REAL_MODEL || "gpt-4o";
const provider = "openai";
const runReal = Boolean(apiKey) && process.env.OPENSCREEN_SEMANTIC_REAL_PROVIDER === "1";

const chatModelConfig = {
	provider,
	model,
	apiKey,
	baseUrl: "https://api.openai.com/v1",
};

function docWithSiteSpeech(): AxcutDocument {
	const base = createEmptyDocument({
		projectId: "sb-real-provider",
		title: "semantic-brain-real-provider",
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1", allowAgentEdits: true },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "rec",
				originalPath: "/tmp/semantic-brain-real.mp4",
				durationSec: 40,
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
					sourceEndSec: 40,
					timelineStartSec: 0,
					timelineEndSec: 40,
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
				segments: [
					{
						id: "seg_0",
						startSec: 0,
						endSec: 5,
						text: "still coding in the editor",
						kind: "speech",
					},
					{
						id: "seg_1",
						startSec: 14,
						endSec: 18,
						text: "and here is the website coming on screen",
						kind: "speech",
					},
					{
						id: "seg_2",
						startSec: 28,
						endSec: 32,
						text: "results page with the metrics",
						kind: "speech",
					},
				],
				words: [],
			},
		],
	});
}

function writeCase(name: string, payload: unknown) {
	mkdirSync(ART, { recursive: true });
	writeFileSync(join(ART, name), JSON.stringify(payload, null, 2));
}

describe.runIf(runReal)("semanticBrain held-out real provider NL (gpt-4o)", () => {
	beforeEach(() => {
		clearLocalEditorialSessionsForTests();
		setSemanticBrainForTests(null);
	});
	afterEach(() => {
		setSemanticBrainForTests(null);
		clearLocalEditorialSessionsForTests();
	});

	it("category=provider_classify advisory — REASONED ADVISORY, no mutation, no range", async () => {
		const msg =
			"Would drawing more attention to the on-screen website reveal help someone watching?";
		const doc = docWithSiteSpeech();
		const before = fingerprintDocument(doc).value;
		const r = await applyLocalEditorialControlWithBrain({
			projectId: "sb-real-adv",
			document: doc,
			userMessage: msg,
			chatModelConfig,
			visualChangeEvents: [],
			skipVisualAnalysis: true,
			skipIdentity: true,
		});
		writeCase("heldout-advisory.json", {
			category: "provider_classify",
			provider,
			model,
			understandingProviderId: r.understandingProviderId,
			providerCalls: r.providerCalls,
			cloudCalls: r.cloudCalls,
			goal: r.request.semanticGoal,
			authority: r.request.authority,
			parseStatus: r.request.parseStatus,
			target: r.request.semanticSkillRequest?.target ?? null,
			mutated: r.mutated,
			beforeFp: before,
			afterFp: r.documentFingerprintAfter,
			userFacingText: r.userFacingText,
		});
		expect(r.providerCalls).toBeGreaterThanOrEqual(1);
		expect(r.understandingProviderId).toMatch(/openai/i);
		expect(r.request.parseStatus).toBe("REASONED");
		expect(r.request.authority).toBe("ADVISORY");
		expect(["RECOMMEND", "INSPECT"]).toContain(r.request.semanticGoal);
		expect(r.mutated).toBe(false);
		expect(r.request.semanticSkillRequest?.target.range ?? null).toBeNull();
	}, 90_000);

	it("category=provider_classify emphasize — EMPHASIZE USER_EXPLICIT zoom SEMANTIC_EVENT", async () => {
		const msg = "When the website comes into view, bring the viewer's attention there.";
		const out = await understandSemanticRequest({
			ctx: {
				userMessage: msg,
				pending: null,
				lastAssistantDecision: null,
				committedFamilies: [],
				documentFingerprint: "fp",
				programmeDurationSec: 40,
				hasTranscript: true,
				hasCursor: true,
			},
			chatModelConfig,
		});
		writeCase("heldout-emphasize-understand.json", {
			category: "provider_classify",
			provider,
			model,
			providerId: out.providerId,
			goal: out.goal,
			authority: out.authority,
			skills: out.skills,
			target: out.target,
			operation: out.operation,
			providerCalls: out.providerCalls,
			cloudCalls: out.cloudCalls,
			parseStatus: out.parseStatus,
		});
		expect(out.providerCalls).toBe(1);
		expect(out.providerId).toMatch(/openai/i);
		expect(out.parseStatus).toBe("REASONED");
		expect(["EMPHASIZE", "EXPLICIT_EDIT"]).toContain(out.goal);
		expect(out.authority).toBe("USER_EXPLICIT");
		expect(out.skills).toContain("zoom");
		expect(out.target.type).toBe("SEMANTIC_EVENT");
		expect(out.target.range ?? null).toBeNull();
	}, 90_000);

	it("category=structural_confirm pending yes — USER_CONFIRMED mutate (0 provider)", async () => {
		const doc = docWithSiteSpeech();
		const beforeFp = fingerprintDocument(doc).value;
		setLocalEditorialPendingProposal("sb-real-confirm", {
			kind: "advice_zoom",
			summary: "Zoom 14–18s",
			documentFingerprint: beforeFp,
			createdAtIso: new Date().toISOString(),
			range: { startSec: 14, endSec: 18 },
			zoomDepth: 3,
			evidenceRefs: ["ocr_onset:website", "visual_change_observed"],
			planFingerprint: null,
			families: ["zoom"],
			semanticEventCue: "when the website comes into view",
			requiresConfirmation: true,
			status: "PROPOSED",
			parameters: { zoomDepth: 3 },
		});
		const yes = await applyLocalEditorialControlWithBrain({
			projectId: "sb-real-confirm",
			document: doc,
			userMessage: "yes, go ahead and do that",
			chatModelConfig,
			skipVisualAnalysis: true,
			skipIdentity: true,
		});
		writeCase("heldout-confirm.json", {
			category: "structural_confirm",
			provider,
			model,
			understandingProviderId: yes.understandingProviderId,
			providerCalls: yes.providerCalls,
			authority: yes.request.authority,
			mutated: yes.mutated,
			zoomCount: yes.document.zoomRanges.length,
			userFacingText: yes.userFacingText,
			beforeFp,
			afterFp: yes.documentFingerprintAfter,
		});
		expect(yes.mutated).toBe(true);
		expect(yes.document.zoomRanges.length).toBeGreaterThan(0);
		expect(yes.request.authority).toBe("USER_CONFIRMED");
		expect(yes.understandingProviderId).toMatch(/pending-structural|openai/i);
	}, 90_000);

	it("category=structural_confirm yes-but-stronger — depth>=4 (0 provider)", async () => {
		const doc = docWithSiteSpeech();
		const beforeFp = fingerprintDocument(doc).value;
		setLocalEditorialPendingProposal("sb-real-stronger", {
			kind: "advice_zoom",
			summary: "Zoom 14–18s",
			documentFingerprint: beforeFp,
			createdAtIso: new Date().toISOString(),
			range: { startSec: 14, endSec: 18 },
			zoomDepth: 3,
			evidenceRefs: ["ocr_onset:website"],
			planFingerprint: null,
			families: ["zoom"],
			semanticEventCue: "website reveal",
			requiresConfirmation: true,
			status: "PROPOSED",
			parameters: { zoomDepth: 3 },
		});
		const r = await applyLocalEditorialControlWithBrain({
			projectId: "sb-real-stronger",
			document: doc,
			userMessage: "yes, but make it stronger",
			chatModelConfig,
			skipVisualAnalysis: true,
			skipIdentity: true,
		});
		writeCase("heldout-stronger.json", {
			category: "structural_confirm",
			provider,
			model,
			providerCalls: r.providerCalls,
			authority: r.request.authority,
			mutated: r.mutated,
			depth: r.document.zoomRanges[0]?.depth ?? null,
			userFacingText: r.userFacingText,
		});
		expect(r.mutated).toBe(true);
		expect((r.document.zoomRanges[0]?.depth ?? 0) >= 4).toBe(true);
	}, 90_000);

	it("category=provider_classify different event — REASONED, no invented range", async () => {
		const msg = "Focus the frame once the results page with the metrics shows up.";
		const out = await understandSemanticRequest({
			ctx: {
				userMessage: msg,
				pending: null,
				lastAssistantDecision: null,
				committedFamilies: [],
				documentFingerprint: "fp",
				programmeDurationSec: 40,
				hasTranscript: true,
				hasCursor: false,
			},
			chatModelConfig,
		});
		writeCase("heldout-different-event.json", {
			category: "provider_classify",
			provider,
			model,
			providerId: out.providerId,
			goal: out.goal,
			authority: out.authority,
			skills: out.skills,
			target: out.target,
			parseStatus: out.parseStatus,
		});
		expect(out.providerCalls).toBe(1);
		expect(out.parseStatus).toBe("REASONED");
		expect(out.target.range ?? null).toBeNull();
		expect(out.skills.length).toBeGreaterThan(0);
	}, 90_000);

	it("category=provider_classify ambiguous wording — REASONED, no invented range", async () => {
		const msg = "Emphasize when I switch over — there might be a couple of those moments.";
		const out = await understandSemanticRequest({
			ctx: {
				userMessage: msg,
				pending: null,
				lastAssistantDecision: null,
				committedFamilies: [],
				documentFingerprint: "fp",
				programmeDurationSec: 40,
				hasTranscript: true,
				hasCursor: true,
			},
			chatModelConfig,
		});
		writeCase("heldout-ambiguous.json", {
			category: "provider_classify",
			provider,
			model,
			providerId: out.providerId,
			goal: out.goal,
			authority: out.authority,
			skills: out.skills,
			target: out.target,
			parseStatus: out.parseStatus,
		});
		expect(out.providerCalls).toBe(1);
		expect(out.parseStatus).toBe("REASONED");
		expect(out.target.range ?? null).toBeNull();
	}, 90_000);
});

describe("semanticBrain real provider availability (always)", () => {
	it("category=availability — records skip vs enabled without counting skip as pass", () => {
		writeCase("heldout-gate.json", {
			category: "availability",
			runReal,
			hasApiKey: Boolean(apiKey),
			apiKeyLen: apiKey.length,
			model,
			provider,
			gateEnv: process.env.OPENSCREEN_SEMANTIC_REAL_PROVIDER ?? null,
			note: runReal
				? "real-provider suite ENABLED via env key (no artifact key file)"
				: "SKIP — set OPENSCREEN_SEMANTIC_REAL_PROVIDER=1 and OPENAI_API_KEY (ephemeral); not a pass",
			noArtifactKeyFile: true,
		});
		expect(typeof runReal).toBe("boolean");
		if (!runReal) {
			expect(process.env.OPENSCREEN_SEMANTIC_REAL_PROVIDER !== "1" || !apiKey).toBe(true);
		}
	});
});
