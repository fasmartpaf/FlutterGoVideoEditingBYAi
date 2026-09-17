/**
 * Disposable callout/title advisory→pending→yes proof.
 * **Injected brain + injected presence** — not unseeded live selected-provider Chat.
 * Distinguishes unit/injected integration from Gate 3 live product (SKIP).
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import { listCalloutAnnotations } from "./directCallout";
import { listTitleAnnotations } from "./directTitle";
import {
	applyLocalEditorialControlWithBrain,
	clearLocalEditorialSessionsForTests,
	getLocalEditorialPendingProposal,
	setLocalEditorialPendingProposal,
	setSemanticBrainForTests,
} from "./index";
import type { SemanticSkillRequestV1 } from "./semanticContract";

const ART = join(
	process.cwd(),
	"electron/ai-edition/localEditorialChat/_artifacts/semantic-brain-v1/disposable-callout-title",
);

function shaJson(doc: AxcutDocument): string {
	return createHash("sha256").update(JSON.stringify(doc)).digest("hex");
}

function disposableDoc(id: string): AxcutDocument {
	const base = createEmptyDocument({ projectId: id, title: id });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "a1", allowAgentEdits: true },
		assets: [
			{
				id: "a1",
				kind: "video",
				label: "a",
				originalPath: "/tmp/disposable-callout-title.mp4",
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

function brainFor(
	msg: string,
	pending: boolean,
	skill: "callout" | "title",
): SemanticSkillRequestV1 {
	if (/^(yes|go ahead|ok)\b/i.test(msg.trim()) && pending) {
		return {
			version: 1,
			rawText: msg,
			parseStatus: "HIGH_CONFIDENCE",
			goal: "CONFIRM_PENDING",
			authority: "USER_CONFIRMED",
			skills: [skill],
			operation: "add",
			target: {
				type: "PENDING_PROPOSAL",
				range: null,
				semanticEvent: null,
				editRef: "pending",
			},
			modification: null,
			confidence: "HIGH",
			unresolvedReason: null,
			providerId: "disposable-injected",
			providerCalls: 0,
			cloudCalls: 0,
			latencyMs: 0,
		};
	}
	return {
		version: 1,
		rawText: msg,
		parseStatus: "REASONED",
		goal: "RECOMMEND",
		authority: "ADVISORY",
		skills: [skill],
		operation: "add",
		target: {
			type: "SEMANTIC_EVENT",
			range: null,
			semanticEvent: "when the results appear",
			editRef: null,
		},
		modification: { text: skill === "callout" ? "Results" : "Results appear" },
		confidence: "HIGH",
		unresolvedReason: null,
		providerId: "disposable-injected",
		providerCalls: 1,
		cloudCalls: 0,
		latencyMs: 1,
	};
}

const presenceJudge = async ({ programmeSec }: { programmeSec: number }) => ({
	present: programmeSec >= 8.9,
	confidence: "HIGH" as const,
	reason: `present>=8.9 @${programmeSec}`,
	rawText: "{}",
	providerId: "injected",
	model: "unit",
});

describe("disposable callout/title (injected brain — not live Chat)", () => {
	beforeEach(() => {
		clearLocalEditorialSessionsForTests();
		mkdirSync(ART, { recursive: true });
	});
	afterEach(() => {
		setSemanticBrainForTests(null);
		clearLocalEditorialSessionsForTests();
	});

	it("callout: advisory stores typed pending → yes applies frozen callout → save/reopen → stale", async () => {
		const projectId = "disp-callout-v1";
		let doc = disposableDoc(projectId);
		const beforeAdvisorySha = shaJson(doc);
		setSemanticBrainForTests(async (ctx) =>
			brainFor(ctx.userMessage, Boolean(ctx.pending), "callout"),
		);

		const beforeFp = fingerprintDocument(doc).value;
		const advisory = await applyLocalEditorialControlWithBrain({
			projectId,
			document: doc,
			userMessage: "Would a short on-screen label help when the results show up?",
			visualChangeEvents: [{ startSec: 8.5, endSec: 10.5, level: "SIGNIFICANT" }],
			skipVisualAnalysis: true,
			presenceJudge,
			ocrRecognize: async () => ({ text: "results", available: true }),
		});
		expect(advisory.mutated).toBe(false);
		expect(shaJson(advisory.document)).toBe(beforeAdvisorySha);
		expect(advisory.request.authority).toBe("ADVISORY");
		expect(advisory.userFacingText.toLowerCase()).toMatch(/callout/);
		expect(advisory.userFacingText.toLowerCase()).not.toMatch(/i'd zoom in/);
		const pending = getLocalEditorialPendingProposal(projectId);
		expect(pending?.kind).toBe("advice_callout");
		expect(pending?.parameters?.executeIntent).toBe("CALLOUT");
		expect(pending?.parameters?.calloutText).toBe("Results");
		expect(pending?.parameters?.rangeClock).toBe("programme");
		expect(pending?.documentFingerprint).toBe(beforeFp);
		expect(pending?.range?.startSec).toBeGreaterThan(7);

		doc = advisory.document;
		const yes = await applyLocalEditorialControlWithBrain({
			projectId,
			document: doc,
			userMessage: "yes",
			skipVisualAnalysis: true,
		});
		expect(yes.mutated).toBe(true);
		expect(yes.request.intent).toBe("CALLOUT");
		expect(yes.document.zoomRanges.length).toBe(0);
		const callouts = listCalloutAnnotations(yes.document);
		expect(callouts.length).toBe(1);
		expect(String(callouts[0]!.content || callouts[0]!.textContent || "").toLowerCase()).toMatch(
			/results/,
		);

		const savedPath = join(ART, "disposable-callout-working.openscreen");
		writeFileSync(savedPath, JSON.stringify(yes.document, null, 2));
		const reopened = documentSchema.parse(JSON.parse(readFileSync(savedPath, "utf8")));
		expect(listCalloutAnnotations(reopened).length).toBe(1);

		setLocalEditorialPendingProposal(projectId, {
			kind: "advice_callout",
			summary: "stale callout",
			documentFingerprint: "stale-fingerprint-not-matching",
			createdAtIso: new Date().toISOString(),
			range: pending!.range,
			zoomDepth: null,
			evidenceRefs: ["stale"],
			planFingerprint: null,
			families: ["callout"],
			semanticEventCue: "when the results appear",
			requiresConfirmation: true,
			status: "PROPOSED",
			parameters: {
				executeIntent: "CALLOUT",
				calloutText: "Results",
				rangeClock: "programme",
			},
		});
		// Structural pending path (no injected brain) — registry gate would
		// reject stale fingerprints before index can emit STALE_PENDING.
		setSemanticBrainForTests(null);
		const stale = await applyLocalEditorialControlWithBrain({
			projectId,
			document: reopened,
			userMessage: "yes",
			skipVisualAnalysis: true,
		});
		expect(stale.mutated).toBe(false);
		expect(stale.outcomeKind).toBe("STALE_PENDING");
		expect(stale.userFacingText.toLowerCase()).toMatch(/stale|changed|ask me again/);
		expect(listCalloutAnnotations(reopened).length).toBe(1);
		expect(stale.document.zoomRanges.length).toBe(0);

		writeFileSync(
			join(ART, "disposable-callout-proof.json"),
			JSON.stringify(
				{
					proofKind: "injected_brain_presence",
					notLiveSelectedProviderChat: true,
					advisoryMutated: advisory.mutated,
					pendingKind: pending?.kind,
					yesMutated: yes.mutated,
					calloutCount: callouts.length,
					staleMutated: stale.mutated,
					staleOutcome: stale.outcomeKind,
				},
				null,
				2,
			),
		);
	});

	it("title: advisory → typed pending → yes applies frozen title (not Zoom)", async () => {
		const projectId = "disp-title-v1";
		let doc = disposableDoc(projectId);
		setSemanticBrainForTests(async (ctx) =>
			brainFor(ctx.userMessage, Boolean(ctx.pending), "title"),
		);

		const advisory = await applyLocalEditorialControlWithBrain({
			projectId,
			document: doc,
			userMessage: "Would a title help when the results show up?",
			visualChangeEvents: [{ startSec: 8.5, endSec: 10.5, level: "SIGNIFICANT" }],
			skipVisualAnalysis: true,
			presenceJudge,
			ocrRecognize: async () => ({ text: "results", available: true }),
		});
		expect(advisory.mutated).toBe(false);
		const pending = getLocalEditorialPendingProposal(projectId);
		expect(pending?.kind).toBe("advice_title");
		expect(pending?.parameters?.executeIntent).toBe("TITLE");
		expect(pending?.families).toEqual(["title"]);

		doc = advisory.document;
		const yes = await applyLocalEditorialControlWithBrain({
			projectId,
			document: doc,
			userMessage: "go ahead",
			skipVisualAnalysis: true,
		});
		expect(yes.mutated).toBe(true);
		expect(yes.request.intent).toBe("TITLE");
		expect(yes.document.zoomRanges.length).toBe(0);
		expect(listTitleAnnotations(yes.document).length).toBe(1);
		expect(listCalloutAnnotations(yes.document).length).toBe(0);
	});

	it("ambiguous WHERE: no pending, no mutation, no confirmed time cite", async () => {
		const projectId = "disp-callout-ambiguous";
		const doc = disposableDoc(projectId);
		setSemanticBrainForTests(async (ctx) =>
			brainFor(ctx.userMessage, Boolean(ctx.pending), "callout"),
		);
		const r = await applyLocalEditorialControlWithBrain({
			projectId,
			document: doc,
			userMessage: "Would a short on-screen label help when the results show up?",
			visualChangeEvents: [
				{ startSec: 3, endSec: 4, level: "SIGNIFICANT" },
				{ startSec: 18, endSec: 19.5, level: "SIGNIFICANT" },
			],
			skipVisualAnalysis: true,
			presenceJudge: async () => ({
				present: true,
				confidence: "LOW",
				reason: "ambiguous both peaks",
				rawText: "{}",
				providerId: "injected",
				model: "unit",
			}),
			ocrRecognize: async () => ({ text: "", available: true }),
		});
		expect(r.mutated).toBe(false);
		expect(getLocalEditorialPendingProposal(projectId)).toBeNull();
		expect(r.outcomeKind === "AMBIGUOUS" || r.outcomeKind === "NOT_FOUND").toBe(true);
		expect(r.userFacingText.toLowerCase()).not.toMatch(
			/say “yes”|say "yes"|go ahead and i'll apply/,
		);
	});
});
