/**
 * Disposable Zoom RAW clock proof — **injected brain + injected presence**.
 * Integration proof of programme→RAW Zoom confirm/save/reopen/stronger/stale.
 * NOT an unseeded live selected-provider Chat chain.
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AxcutDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import { programmeDurationSec, rawTimelineDurationSec } from "./directTrim";
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
	"electron/ai-edition/localEditorialChat/_artifacts/semantic-brain-v1/disposable-zoom",
);
const ORIG = join(
	process.env.HOME ?? "",
	"Library/Application Support/openscreen/projects/proj_e50620fc-423c-43b0-aa67-52aa308343a9.openscreen",
);
const DISPOSABLE = join(ART, "disposable-working.openscreen");

function sha(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function loadDoc(path: string): AxcutDocument {
	return documentSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

function brainFor(msg: string, pending: boolean): SemanticSkillRequestV1 {
	if (/stronger/i.test(msg) && pending) {
		return {
			version: 1,
			rawText: msg,
			parseStatus: "HIGH_CONFIDENCE",
			goal: "MODIFY_PENDING",
			authority: "USER_CONFIRMED",
			skills: ["zoom"],
			operation: "adjust",
			target: {
				type: "PENDING_PROPOSAL",
				range: null,
				semanticEvent: null,
				editRef: "pending",
			},
			modification: { intensity: "stronger" },
			confidence: "HIGH",
			unresolvedReason: null,
			providerId: "disposable-injected",
			providerCalls: 0,
			cloudCalls: 0,
			latencyMs: 0,
		};
	}
	if (/^(yes|go ahead|ok)\b/i.test(msg.trim()) && pending) {
		return {
			version: 1,
			rawText: msg,
			parseStatus: "HIGH_CONFIDENCE",
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
		skills: ["zoom"],
		operation: "add",
		target: {
			type: "SEMANTIC_EVENT",
			range: null,
			semanticEvent: "landing page appearance",
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

describe("disposable Zoom RAW proof (injected brain/vision integration — copy only)", () => {
	beforeEach(() => {
		clearLocalEditorialSessionsForTests();
		mkdirSync(ART, { recursive: true });
		if (!existsSync(ORIG)) return;
		copyFileSync(ORIG, DISPOSABLE);
	});
	afterEach(() => {
		setSemanticBrainForTests(null);
		clearLocalEditorialSessionsForTests();
	});

	it("advisory no-mutate → yes applies Zoom in RAW → stronger → stale; original untouched", async () => {
		if (!existsSync(ORIG)) return;
		const origShaBefore = sha(ORIG);
		let doc = loadDoc(DISPOSABLE);
		const projectId = "disp-zoom-v1";
		const progDur = programmeDurationSec(doc);
		const rawDur = rawTimelineDurationSec(doc);
		expect(rawDur).toBeCloseTo(23.72, 1);
		expect(progDur).toBeCloseTo(17.33, 1);
		expect(progDur).toBeLessThan(rawDur - 5);

		setSemanticBrainForTests(async (ctx) => brainFor(ctx.userMessage, Boolean(ctx.pending)));

		const presenceJudge = async ({ programmeSec }: { programmeSec: number }) => ({
			present: programmeSec >= 8.9,
			confidence: "HIGH" as const,
			reason: `present>=8.9 @${programmeSec}`,
			rawText: "{}",
			providerId: "injected",
			model: "unit",
		});

		const advisoryMsg = "Would it help viewers if the landing page appearance stood out more?";
		const beforeFp = fingerprintDocument(doc).value;
		const advisory = await applyLocalEditorialControlWithBrain({
			projectId,
			document: doc,
			userMessage: advisoryMsg,
			visualChangeEvents: [{ startSec: 8.5, endSec: 10.5, level: "SIGNIFICANT" }],
			skipVisualAnalysis: true,
			presenceJudge,
			ocrRecognize: async () => ({ text: "page", available: true }),
		});
		expect(advisory.mutated).toBe(false);
		expect(fingerprintDocument(advisory.document).value).toBe(beforeFp);
		expect(advisory.request.authority).toBe("ADVISORY");
		const pending = getLocalEditorialPendingProposal(projectId);
		expect(pending).not.toBeNull();
		expect(pending!.range).toBeTruthy();

		// Pending range is already Zoom RAW (converted at proposal time).
		const rawPending = pending!.range!;
		// Injected onset ≈ programme 8.9 → RAW ≈ 15.6 with this document's trims.
		expect(rawPending.startSec).toBeGreaterThan(12);
		expect(Math.abs(rawPending.startSec - 8.9)).toBeGreaterThan(3);

		doc = advisory.document;
		const yes = await applyLocalEditorialControlWithBrain({
			projectId,
			document: doc,
			userMessage: "yes",
			skipVisualAnalysis: true,
		});
		expect(yes.mutated).toBe(true);
		expect(yes.document.zoomRanges.length).toBe(1);
		const z = yes.document.zoomRanges[0]!;
		expect(z.startMs / 1000).toBeCloseTo(rawPending.startSec, 0);
		expect(Math.abs(z.startMs / 1000 - 8.9)).toBeGreaterThan(3);

		writeFileSync(DISPOSABLE, JSON.stringify(yes.document, null, 2));
		const reopened = loadDoc(DISPOSABLE);
		expect(reopened.zoomRanges.length).toBe(1);

		// Stronger on a fresh pending seeded at RAW zoom range
		const reopenFp = fingerprintDocument(reopened).value;
		setLocalEditorialPendingProposal(projectId, {
			kind: "semantic_edit",
			summary: "Zoom stronger",
			documentFingerprint: reopenFp,
			createdAtIso: new Date().toISOString(),
			range: {
				startSec: z.startMs / 1000,
				endSec: z.endMs / 1000,
			},
			zoomDepth: z.depth ?? 3,
			evidenceRefs: ["disposable"],
			planFingerprint: null,
			families: ["zoom"],
			semanticEventCue: "landing page appearance",
			requiresConfirmation: true,
			status: "PROPOSED",
			parameters: { zoomDepth: z.depth ?? 3 },
		});
		const stronger = await applyLocalEditorialControlWithBrain({
			projectId,
			document: reopened,
			userMessage: "yes, but make it a little stronger",
			skipVisualAnalysis: true,
		});
		expect(stronger.mutated).toBe(true);
		expect(stronger.document.zoomRanges[0]!.depth).toBeGreaterThan(z.depth ?? 3);

		setLocalEditorialPendingProposal(projectId, {
			kind: "semantic_edit",
			summary: "stale test",
			documentFingerprint: "stale-fingerprint-not-matching",
			createdAtIso: new Date().toISOString(),
			range: {
				startSec: z.startMs / 1000,
				endSec: z.endMs / 1000,
			},
			zoomDepth: 3,
			evidenceRefs: ["disposable"],
			planFingerprint: null,
			families: ["zoom"],
			semanticEventCue: "landing page",
			requiresConfirmation: true,
			status: "PROPOSED",
			parameters: { zoomDepth: 3 },
		});
		setSemanticBrainForTests(null);
		const stale = await applyLocalEditorialControlWithBrain({
			projectId,
			document: stronger.document,
			userMessage: "yes",
			skipVisualAnalysis: true,
		});
		expect(stale.mutated).toBe(false);
		expect(stale.userFacingText.toLowerCase()).toMatch(/stale|changed|ask me again/);
		expect(stale.outcomeKind).toBe("STALE_PENDING");

		expect(sha(ORIG)).toBe(origShaBefore);

		writeFileSync(
			join(ART, "disposable-zoom-proof.json"),
			JSON.stringify(
				{
					advisoryMsg,
					advisoryMutated: advisory.mutated,
					advisoryAuthority: advisory.request.authority,
					userFacingAdvisory: advisory.userFacingText,
					pendingRawRange: rawPending,
					zoomRaw: {
						startSec: z.startMs / 1000,
						endSec: z.endMs / 1000,
						depth: z.depth,
					},
					programmeDurationSec: progDur,
					rawTimelineDurationSec: rawDur,
					strongerDepth: stronger.document.zoomRanges[0]?.depth,
					staleMutated: stale.mutated,
					staleText: stale.userFacingText,
					originalShaUnchanged: sha(ORIG) === origShaBefore,
				},
				null,
				2,
			),
		);
	});
});
