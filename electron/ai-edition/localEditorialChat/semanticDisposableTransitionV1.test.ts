/**
 * Disposable two-clip transition — advisory→yes must consume stored join,
 * not re-run WHERE when evidence is unavailable on confirm.
 * Injected brain/presence only — not live OpenAI Chat.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join as pathJoin } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import { listTransitionJoins } from "./directTransition";
import {
	applyLocalEditorialControlWithBrain,
	clearLocalEditorialSessionsForTests,
	getLocalEditorialPendingProposal,
	setLocalEditorialPendingProposal,
	setSemanticBrainForTests,
} from "./index";
import type { SemanticSkillRequestV1 } from "./semanticContract";

const ART = pathJoin(
	process.cwd(),
	"electron/ai-edition/localEditorialChat/_artifacts/semantic-brain-v1/disposable-transition",
);

function twoClipDoc(id: string): AxcutDocument {
	const base = createEmptyDocument({ projectId: id, title: id });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "a1", allowAgentEdits: true },
		assets: [
			{
				id: "a1",
				kind: "video",
				label: "a",
				originalPath: "/tmp/disposable-transition.mp4",
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
					sourceEndSec: 15,
					timelineStartSec: 0,
					timelineEndSec: 15,
					origin: "system",
					reason: "primary",
				},
				{
					id: "c2",
					assetId: "a1",
					sourceStartSec: 15,
					sourceEndSec: 30,
					timelineStartSec: 15,
					timelineEndSec: 30,
					origin: "system",
					reason: "split",
					incomingTransition: { kind: "cut", durationSec: 0 },
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
						startSec: 13,
						endSec: 16,
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
	mode: "advise" | "explicit",
): SemanticSkillRequestV1 {
	if (/^(yes|go ahead|ok)\b/i.test(msg.trim()) && pending) {
		return {
			version: 1,
			rawText: msg,
			parseStatus: "HIGH_CONFIDENCE",
			goal: "CONFIRM_PENDING",
			authority: "USER_CONFIRMED",
			skills: ["transitions"],
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
	if (mode === "explicit") {
		return {
			version: 1,
			rawText: msg,
			parseStatus: "REASONED",
			goal: "EXPLICIT_EDIT",
			authority: "USER_EXPLICIT",
			skills: ["transitions"],
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
			providerId: "disposable-injected",
			providerCalls: 1,
			cloudCalls: 0,
			latencyMs: 1,
		};
	}
	return {
		version: 1,
		rawText: msg,
		parseStatus: "REASONED",
		goal: "RECOMMEND",
		authority: "ADVISORY",
		skills: ["transitions"],
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
		providerId: "disposable-injected",
		providerCalls: 1,
		cloudCalls: 0,
		latencyMs: 1,
	};
}

const presenceFound = async ({ programmeSec }: { programmeSec: number }) => ({
	present: programmeSec >= 14.5,
	confidence: "HIGH" as const,
	reason: `present>=14.5 @${programmeSec}`,
	rawText: "{}",
	providerId: "injected",
	model: "unit",
});

/** Evidence unavailable / changed on confirm — must not be consulted. */
const presenceBroken = async () => {
	throw new Error("presence must not be called on confirm");
};

function transitionOnSecondClip(doc: AxcutDocument): boolean {
	const c2 = doc.timeline.clips.find((c) => c.id === "c2");
	const t = c2?.incomingTransition;
	if (!t) return false;
	const id = typeof t === "object" && t && "id" in t ? String((t as { id?: string }).id ?? "") : "";
	const kind =
		typeof t === "object" && t && "kind" in t ? String((t as { kind?: string }).kind) : "";
	return id.includes("dissolve") || kind === "dissolve" || id.includes("fade") || kind === "fade";
}

describe("disposable transition join confirm (injected — not live Chat)", () => {
	beforeEach(() => {
		clearLocalEditorialSessionsForTests();
		mkdirSync(ART, { recursive: true });
	});
	afterEach(() => {
		setSemanticBrainForTests(null);
		clearLocalEditorialSessionsForTests();
	});

	it("advisory→yes consumes stored join with evidence unavailable on confirm; save/reopen", async () => {
		const projectId = "disp-transition-yes";
		let doc = twoClipDoc(projectId);
		expect(listTransitionJoins(doc)).toHaveLength(1);
		expect(listTransitionJoins(doc)[0]!.programmeJoinSec).toBeCloseTo(15, 1);

		let presenceCalls = 0;
		setSemanticBrainForTests(async (ctx) =>
			brainFor(ctx.userMessage, Boolean(ctx.pending), "advise"),
		);

		const advisory = await applyLocalEditorialControlWithBrain({
			projectId,
			document: doc,
			userMessage: "Would a dissolve help when the site appears?",
			visualChangeEvents: [{ startSec: 14, endSec: 16, level: "SIGNIFICANT" }],
			skipVisualAnalysis: true,
			presenceJudge: async (args) => {
				presenceCalls += 1;
				return presenceFound(args);
			},
			ocrRecognize: async () => ({ text: "page", available: true }),
		});
		expect(advisory.mutated).toBe(false);
		expect(advisory.outcomeKind).toBe("ADVISORY");
		expect(advisory.userFacingText.toLowerCase()).toMatch(/transition|join/);
		const pending = getLocalEditorialPendingProposal(projectId);
		expect(pending?.kind).toBe("advice_transition");
		expect(pending?.parameters?.nearTimestamp).toBe(true);
		expect(pending?.parameters?.joinProgrammeSec).toBeCloseTo(15, 1);
		expect(pending?.parameters?.transitionClipId).toBe("c2");
		expect(pending?.range?.startSec).toBe(pending?.range?.endSec);
		const presenceAtAdvise = presenceCalls;

		doc = advisory.document;
		const yes = await applyLocalEditorialControlWithBrain({
			projectId,
			document: doc,
			userMessage: "yes",
			skipVisualAnalysis: true,
			skipIdentity: true,
			presenceJudge: presenceBroken,
			ocrRecognize: async () => {
				throw new Error("ocr must not be called on confirm");
			},
		});
		expect(yes.mutated).toBe(true);
		expect(yes.request.intent).toBe("TRANSITION");
		expect(yes.request.range?.nearTimestamp).toBe(true);
		expect(yes.request.range?.startSec).toBeCloseTo(15, 1);
		expect(presenceCalls).toBe(presenceAtAdvise);
		expect(
			transitionOnSecondClip(yes.document) || listTransitionJoins(yes.document)[0]!.kind !== "cut",
		).toBe(true);

		const path = pathJoin(ART, "disposable-transition-working.openscreen");
		writeFileSync(path, JSON.stringify(yes.document, null, 2));
		const reopened = documentSchema.parse(JSON.parse(readFileSync(path, "utf8")));
		const savedJoin = listTransitionJoins(reopened)[0]!;
		expect(savedJoin.programmeJoinSec).toBeCloseTo(15, 1);
		expect(
			savedJoin.kind === "dissolve" ||
				savedJoin.transitionId.includes("dissolve") ||
				savedJoin.transitionId.includes("fade"),
		).toBe(true);

		writeFileSync(
			pathJoin(ART, "disposable-transition-proof.json"),
			JSON.stringify(
				{
					proofKind: "injected_brain_presence",
					notLiveSelectedProviderChat: true,
					presenceCallsAtAdvise: presenceAtAdvise,
					presenceCallsAfterYes: presenceCalls,
					joinSec: pending?.parameters?.joinProgrammeSec,
					yesMutated: yes.mutated,
					reopenedKind: savedJoin.kind,
					reopenedTransitionId: savedJoin.transitionId,
				},
				null,
				2,
			),
		);
	});

	it("stale fingerprint: yes refuses without mutation", async () => {
		const projectId = "disp-transition-stale";
		const doc = twoClipDoc(projectId);
		setLocalEditorialPendingProposal(projectId, {
			kind: "advice_transition",
			summary: "stale",
			documentFingerprint: "stale-fingerprint-not-matching",
			createdAtIso: new Date().toISOString(),
			range: { startSec: 15, endSec: 15 },
			zoomDepth: null,
			evidenceRefs: ["stale"],
			planFingerprint: null,
			families: ["transitions"],
			semanticEventCue: "when the site appears",
			requiresConfirmation: true,
			status: "PROPOSED",
			parameters: {
				executeIntent: "TRANSITION",
				nearTimestamp: true,
				transitionClipId: "c2",
				joinProgrammeSec: 15,
				rangeClock: "programme",
			},
		});
		setSemanticBrainForTests(null);
		const stale = await applyLocalEditorialControlWithBrain({
			projectId,
			document: doc,
			userMessage: "yes",
			skipVisualAnalysis: true,
		});
		expect(stale.mutated).toBe(false);
		expect(stale.outcomeKind).toBe("STALE_PENDING");
		expect(listTransitionJoins(stale.document)[0]!.kind).toBe("cut");
	});

	it("invalid join after propose: yes refuses truthfully", async () => {
		const projectId = "disp-transition-invalid-join";
		let doc = twoClipDoc(projectId);
		setSemanticBrainForTests(async (ctx) =>
			brainFor(ctx.userMessage, Boolean(ctx.pending), "advise"),
		);
		const advisory = await applyLocalEditorialControlWithBrain({
			projectId,
			document: doc,
			userMessage: "Would a dissolve help when the site appears?",
			visualChangeEvents: [{ startSec: 14, endSec: 16, level: "SIGNIFICANT" }],
			skipVisualAnalysis: true,
			presenceJudge: presenceFound,
			ocrRecognize: async () => ({ text: "page", available: true }),
		});
		expect(getLocalEditorialPendingProposal(projectId)?.kind).toBe("advice_transition");

		// Collapse to single clip — stored join structurally gone.
		doc = documentSchema.parse({
			...advisory.document,
			timeline: {
				...advisory.document.timeline,
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
		});
		// Keep pending fingerprint matching collapsed doc so we hit join validation, not stale fp.
		const fp = fingerprintDocument(doc).value;
		const pending = getLocalEditorialPendingProposal(projectId)!;
		setLocalEditorialPendingProposal(projectId, {
			...pending,
			documentFingerprint: fp,
		});

		const yes = await applyLocalEditorialControlWithBrain({
			projectId,
			document: doc,
			userMessage: "yes",
			skipVisualAnalysis: true,
			presenceJudge: presenceBroken,
		});
		expect(yes.mutated).toBe(false);
		expect(yes.userFacingText.toLowerCase()).toMatch(/join|valid|gone|no longer/);
		expect(listTransitionJoins(yes.document)).toHaveLength(0);
	});

	it("explicit transition SEMANTIC_EVENT grounds join without advisory pending", async () => {
		const projectId = "disp-transition-explicit";
		const doc = twoClipDoc(projectId);
		setSemanticBrainForTests(async (ctx) =>
			brainFor(ctx.userMessage, Boolean(ctx.pending), "explicit"),
		);
		const r = await applyLocalEditorialControlWithBrain({
			projectId,
			document: doc,
			userMessage: "Add a dissolve when the site appears",
			visualChangeEvents: [{ startSec: 14, endSec: 16, level: "SIGNIFICANT" }],
			skipVisualAnalysis: true,
			presenceJudge: presenceFound,
			ocrRecognize: async () => ({ text: "page", available: true }),
		});
		expect(r.mutated).toBe(true);
		expect(r.request.intent).toBe("TRANSITION");
		expect(r.request.range?.nearTimestamp).toBe(true);
		expect(r.request.range?.startSec).toBeCloseTo(15, 1);
		expect(getLocalEditorialPendingProposal(projectId)).toBeNull();
		const join = listTransitionJoins(r.document)[0]!;
		expect(
			join.kind === "dissolve" ||
				join.transitionId.includes("dissolve") ||
				join.transitionId.includes("fade"),
		).toBe(true);
	});
});
