/**
 * In-process fixture proof for semantic brain → ground → zoom.
 * Uses a fake media path, injected brain, and supplied visualChangeEvents.
 * Label: WIRING FIXTURE — not real selected-provider; not real-recording visual proof.
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
} from "./index";
import type { SemanticSkillRequestV1 } from "./semanticContract";

const OUT = join(
	process.cwd(),
	"electron/ai-edition/localEditorialChat/_artifacts/semantic-brain-v1",
);

const EMPHASIZE_MSG = "When I leave the code and the site comes into view, bring attention to it.";
const STRONGER_MSG = "yes, but make it a little stronger";

function doc(): AxcutDocument {
	const base = createEmptyDocument({ projectId: "sb-live", title: "semantic-brain-live" });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1", allowAgentEdits: true },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "rec",
				originalPath: "/tmp/semantic-brain-live.mp4",
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
						startSec: 10,
						endSec: 16,
						text: "now the site comes into view on screen",
						kind: "speech",
					},
					{
						id: "seg_2",
						startSec: 22,
						endSec: 28,
						text: "results page appears with the numbers",
						kind: "speech",
					},
				],
				words: [],
			},
		],
	});
}

describe("semanticBrainV1.live.runtime", () => {
	beforeEach(() => {
		clearLocalEditorialSessionsForTests();
		mkdirSync(OUT, { recursive: true });
		setSemanticBrainForTests(async (ctx) => {
			const msg = ctx.userMessage;
			const common = {
				version: 1 as const,
				rawText: msg,
				parseStatus: "REASONED" as const,
				confidence: "HIGH" as const,
				unresolvedReason: null,
				providerId: "injected-live-proof",
				providerCalls: 1,
				cloudCalls: 0,
				latencyMs: 3,
				modification: null as SemanticSkillRequestV1["modification"],
				operation: "add" as const,
			};
			if (msg.includes("bring attention") || msg.includes("leave the code")) {
				return {
					...common,
					goal: "EMPHASIZE",
					authority: "USER_EXPLICIT",
					skills: ["zoom"],
					target: {
						type: "SEMANTIC_EVENT",
						range: null,
						semanticEvent: "when the site comes into view",
						editRef: null,
					},
				};
			}
			if (msg.includes("polished product demo")) {
				return {
					...common,
					goal: "PROFESSIONALIZE",
					authority: "AUTONOMOUS",
					skills: ["trim", "zoom", "speed", "captions"],
					operation: null,
					target: {
						type: "WHOLE_PROGRAMME",
						range: null,
						semanticEvent: null,
						editRef: null,
					},
				};
			}
			return {
				...common,
				goal: "UNKNOWN",
				authority: "ADVISORY",
				skills: [],
				operation: null,
				parseStatus: "UNRESOLVED",
				confidence: "LOW",
				unresolvedReason: "unmapped",
				target: { type: "UNKNOWN", range: null, semanticEvent: null, editRef: null },
			};
		});
	});
	afterEach(() => {
		setSemanticBrainForTests(null);
		clearLocalEditorialSessionsForTests();
	});

	it("A: semantic emphasize → ground → zoom apply with fingerprints", async () => {
		const document = doc();
		const before = fingerprintDocument(document).value;
		const t0 = Date.now();
		const r = await applyLocalEditorialControlWithBrain({
			projectId: "sb-live",
			document,
			userMessage: EMPHASIZE_MSG,
			cursorSamples: [{ atSec: 10.2, cx: 0.55, cy: 0.48, visible: true, interactionType: "click" }],
			visualChangeEvents: [{ startSec: 9.8, endSec: 11.2, level: "SIGNIFICANT" }],
			skipVisualAnalysis: true,
			skipIdentity: false,
			ocrRecognize: async (imagePath: string) => {
				if (imagePath.includes("before")) {
					return { text: "code editor terminal", available: true };
				}
				return { text: "the site comes into view", available: true };
			},
		});
		const totalMs = Date.now() - t0;
		const after = fingerprintDocument(r.document).value;
		const evidence = {
			userMessage: EMPHASIZE_MSG,
			authority: r.request.authority,
			skillFamilies: r.request.requestedFamilies,
			semanticEventCue: r.request.semanticEventCue,
			range: r.request.range,
			mutated: r.mutated,
			beforeFp: before,
			afterFp: after,
			zoomCount: r.document.zoomRanges.length,
			providerCalls: r.providerCalls ?? 0,
			cloudCalls: r.cloudCalls,
			understandingProviderId: r.understandingProviderId,
			understandingLatencyMs: r.understandingLatencyMs ?? null,
			totalMs,
			outcomeKind: r.outcomeKind,
			userFacingText: r.userFacingText,
			parseStatus: r.request.parseStatus,
			goal: r.request.semanticGoal,
		};
		writeFileSync(join(OUT, "semantic-zoom-trace.json"), JSON.stringify(evidence, null, 2));
		expect(r.request.authority).toBe("USER_EXPLICIT");
		expect(r.request.requestedFamilies).toContain("zoom");
		expect(r.providerCalls).toBe(1);
		expect(r.cloudCalls).toBe(0);
		expect(r.mutated).toBe(true);
		expect(after).not.toBe(before);
		expect(r.document.zoomRanges.length).toBeGreaterThan(0);
		expect(r.userFacingText.toLowerCase()).not.toMatch(/no safe recording-specific/);
	});

	it("B: pending + yes but stronger", async () => {
		const document = doc();
		const beforeFp = fingerprintDocument(document).value;
		setLocalEditorialPendingProposal("sb-live", {
			kind: "semantic_edit",
			summary: "pending zoom",
			documentFingerprint: beforeFp,
			createdAtIso: new Date().toISOString(),
			range: { startSec: 10, endSec: 14 },
			zoomDepth: 3,
			evidenceRefs: ["transcript:site"],
			planFingerprint: null,
			families: ["zoom"],
			semanticEventCue: "when the site comes into view",
			status: "PROPOSED",
			requiresConfirmation: true,
			parameters: { zoomDepth: 3 },
		});
		setSemanticBrainForTests(null);
		const t0 = Date.now();
		const r = await applyLocalEditorialControlWithBrain({
			projectId: "sb-live",
			document,
			userMessage: STRONGER_MSG,
		});
		writeFileSync(
			join(OUT, "pending-stronger-trace.json"),
			JSON.stringify(
				{
					authority: r.request.authority,
					mutated: r.mutated,
					depth: r.document.zoomRanges[0]?.depth,
					providerCalls: r.providerCalls ?? 0,
					cloudCalls: r.cloudCalls,
					totalMs: Date.now() - t0,
					text: r.userFacingText,
				},
				null,
				2,
			),
		);
		expect(r.mutated).toBe(true);
		expect(r.request.authority).toBe("USER_CONFIRMED");
		expect((r.document.zoomRanges[0]?.depth ?? 0) >= 4).toBe(true);
		expect(r.providerCalls ?? 0).toBe(0);
	});

	it("C: timed zoom zero provider latency", async () => {
		setSemanticBrainForTests(async () => {
			throw new Error("must not call brain");
		});
		const t0 = Date.now();
		const r = await applyLocalEditorialControlWithBrain({
			projectId: "sb-live-timed",
			document: doc(),
			userMessage: "zoom from 5 to 10 seconds",
		});
		const totalMs = Date.now() - t0;
		writeFileSync(
			join(OUT, "timed-zero-provider.json"),
			JSON.stringify(
				{
					mutated: r.mutated,
					providerCalls: r.providerCalls ?? 0,
					cloudCalls: r.cloudCalls,
					totalMs,
					parseStatus: r.request.parseStatus,
				},
				null,
				2,
			),
		);
		expect(r.mutated).toBe(true);
		expect(r.providerCalls ?? 0).toBe(0);
		expect(totalMs).toBeLessThan(200);
	});
});
