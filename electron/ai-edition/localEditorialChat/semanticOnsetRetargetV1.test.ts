/**
 * Realistic Connect-landing WHERE regression: late speech/visual seed (~15s)
 * must retarget to verified first-onset bracket (~14.4s), not NOT_FOUND
 * "candidate too late". Injected presence — mirrors live failure pattern without
 * hardcoding App Store Connect product strings into routing.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { documentSchema } from "../../../src/lib/ai-edition/schema";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import {
	applyLocalEditorialControlWithBrain,
	clearLocalEditorialSessionsForTests,
	getLocalEditorialPendingProposal,
	setLocalEditorialPendingProposal,
	setSemanticBrainForTests,
} from "./index";
import type { SemanticSkillRequestV1 } from "./semanticContract";
import { verifyRequestedEventIdentity } from "./semanticEventIdentity";
import { resolveSemanticEditEventAsync } from "./semanticEventResolve";

const ART = join(
	process.cwd(),
	"electron/ai-edition/localEditorialChat/_artifacts/semantic-brain-v1/onset-retarget",
);
const LIVE_PROJECT = join(
	process.env.HOME ?? "",
	"Library/Application Support/openscreen/projects/proj_codex_landing_qa_20260917.openscreen",
);

/** Injected: App Store Connect still up at 13.6; landing present by 14.4 (scrub-verified). */
const LANDING_ONSET = 14.4;
/** Far enough past onset that pre-fix code returned candidate_too_late. */
const LATE_SPEECH_SEED = 18.0;

function presenceLandingOnset({ programmeSec }: { programmeSec: number }) {
	return {
		present: programmeSec >= LANDING_ONSET,
		confidence: "HIGH" as const,
		reason: `landing_present>=${LANDING_ONSET}@${programmeSec}`,
		rawText: "{}",
		providerId: "injected",
		model: "unit",
	};
}

describe("onset retarget from late seed (Connect landing pattern)", () => {
	beforeEach(() => {
		clearLocalEditorialSessionsForTests();
		mkdirSync(ART, { recursive: true });
		setSemanticBrainForTests(null);
	});
	afterEach(() => {
		setSemanticBrainForTests(null);
		clearLocalEditorialSessionsForTests();
	});

	it("identity: late ~15s seed with clean bracket IDENTIFIES at ~14.4s", async () => {
		if (!existsSync(LIVE_PROJECT)) return;
		const doc = documentSchema.parse(JSON.parse(readFileSync(LIVE_PROJECT, "utf8")));
		const r = await verifyRequestedEventIdentity({
			document: doc,
			cue: "when I switch to the Connect landing page",
			programmeAnchorSec: LATE_SPEECH_SEED,
			visualChangeObserved: true,
			extractFrame: async () => true,
			ocrRecognize: async () => ({ text: "Connect", available: true }),
			presenceJudge: presenceLandingOnset,
		});
		expect(r.requestedEventIdentified).toBe(true);
		expect(r.earliestProgrammeSec).toBeCloseTo(LANDING_ONSET, 0);
		expect(r.evidenceRefs.some((e) => e.includes("retargeted_from_late_candidate"))).toBe(true);
		expect(r.evidenceRefs.some((e) => e.includes("candidate_too_late"))).toBe(false);
	});

	it("resolve async: late visual+speech candidates FOUND at first-onset, not NOT_FOUND", async () => {
		if (!existsSync(LIVE_PROJECT)) return;
		const doc = documentSchema.parse(JSON.parse(readFileSync(LIVE_PROJECT, "utf8")));
		const grounded = await resolveSemanticEditEventAsync({
			cue: "when I switch to the Connect landing page",
			document: doc,
			visualChangeEvents: [
				{ startSec: 14.8, endSec: 15.6, level: "SIGNIFICANT" },
				{ startSec: 21.5, endSec: 22.5, level: "SIGNIFICANT" },
			],
			skipVisualAnalysis: true,
			presenceJudge: presenceLandingOnset,
			ocrRecognize: async () => ({ text: "Connect", available: true }),
		});
		expect(grounded.status).toBe("FOUND");
		expect(grounded.best?.requestedEventIdentified).toBe(true);
		expect(grounded.best!.anchorSec).toBeLessThan(16);
		expect(grounded.best!.anchorSec).toBeGreaterThan(13.5);
		expect(grounded.best!.anchorSec).toBeLessThanOrEqual(LANDING_ONSET + 0.6);
		expect(grounded.userFacingReason.toLowerCase()).not.toMatch(/candidate too late/);
	});

	it("advisory→pending→yes on disposable copy; absent-event refuses; stronger path", async () => {
		if (!existsSync(LIVE_PROJECT)) return;
		const dest = join(ART, "disposable-landing-working.openscreen");
		copyFileSync(LIVE_PROJECT, dest);
		const origSha = readFileSync(LIVE_PROJECT);
		let doc = documentSchema.parse(JSON.parse(readFileSync(dest, "utf8")));
		const projectId = "disp-onset-retarget-v1";
		expect(doc.zoomRanges?.length ?? 0).toBe(0);

		const brain = async (ctx: {
			userMessage: string;
			pending: unknown;
		}): Promise<SemanticSkillRequestV1> => {
			const msg = ctx.userMessage;
			if (/stronger/i.test(msg) && ctx.pending) {
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
					providerId: "injected",
					providerCalls: 0,
					cloudCalls: 0,
					latencyMs: 0,
				};
			}
			if (/^(yes|go ahead)\b/i.test(msg.trim()) && ctx.pending) {
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
					providerId: "injected",
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
					semanticEvent: "when I switch to the Connect landing page",
					editRef: null,
				},
				modification: null,
				confidence: "HIGH",
				unresolvedReason: null,
				providerId: "injected",
				providerCalls: 1,
				cloudCalls: 0,
				latencyMs: 1,
			};
		};
		setSemanticBrainForTests(async (ctx) => brain(ctx));

		const beforeFp = fingerprintDocument(doc).value;
		const advisory = await applyLocalEditorialControlWithBrain({
			projectId,
			document: doc,
			userMessage:
				"Would it help viewers if the moment I switch to the Connect landing page stood out more? Recommend only — don’t change the video yet.",
			visualChangeEvents: [
				{ startSec: 14.8, endSec: 15.6, level: "SIGNIFICANT" },
				{ startSec: 21.5, endSec: 22.5, level: "SIGNIFICANT" },
			],
			skipVisualAnalysis: true,
			presenceJudge: presenceLandingOnset,
			ocrRecognize: async () => ({ text: "Connect", available: true }),
		});
		expect(advisory.mutated).toBe(false);
		expect(fingerprintDocument(advisory.document).value).toBe(beforeFp);
		expect(advisory.outcomeKind).toBe("ADVISORY");
		expect(advisory.userFacingText.toLowerCase()).toMatch(/zoom|stood|stand|i'd/);
		expect(advisory.userFacingText.toLowerCase()).not.toMatch(
			/candidate too late|couldn't identify/,
		);
		const pending = getLocalEditorialPendingProposal(projectId);
		expect(pending?.kind).toBe("advice_zoom");
		expect(pending?.range).toBeTruthy();

		doc = advisory.document;
		const yes = await applyLocalEditorialControlWithBrain({
			projectId,
			document: doc,
			userMessage: "yes",
			skipVisualAnalysis: true,
			presenceJudge: async () => {
				throw new Error("presence must not run on confirm");
			},
		});
		expect(yes.mutated).toBe(true);
		expect(yes.document.zoomRanges.length).toBe(1);
		const z0 = yes.document.zoomRanges[0]!;
		const depth0 = z0.depth ?? 3;

		writeFileSync(dest, JSON.stringify(yes.document, null, 2));
		const reopened = documentSchema.parse(JSON.parse(readFileSync(dest, "utf8")));
		expect(reopened.zoomRanges.length).toBe(1);

		const reopenFp = fingerprintDocument(reopened).value;
		setLocalEditorialPendingProposal(projectId, {
			kind: "advice_zoom",
			summary: "stronger",
			documentFingerprint: reopenFp,
			createdAtIso: new Date().toISOString(),
			range: {
				startSec: z0.startMs / 1000,
				endSec: z0.endMs / 1000,
			},
			zoomDepth: depth0 as 1 | 2 | 3 | 4 | 5 | 6,
			evidenceRefs: ["retarget"],
			planFingerprint: null,
			families: ["zoom"],
			semanticEventCue: "when I switch to the Connect landing page",
			requiresConfirmation: true,
			status: "PROPOSED",
			parameters: {
				zoomDepth: depth0 as 1 | 2 | 3 | 4 | 5 | 6,
				executeIntent: "ADD_ZOOM",
				rangeClock: "raw",
			},
		});
		const stronger = await applyLocalEditorialControlWithBrain({
			projectId,
			document: reopened,
			userMessage: "yes, but make it a little stronger",
			skipVisualAnalysis: true,
		});
		expect(stronger.mutated).toBe(true);
		expect((stronger.document.zoomRanges[0]?.depth ?? 0) > depth0).toBe(true);

		// Absent-event refusal on a fresh project id
		clearLocalEditorialSessionsForTests();
		setSemanticBrainForTests(async (ctx) => brain({ ...ctx, pending: null }));
		const absentDoc = documentSchema.parse(JSON.parse(readFileSync(LIVE_PROJECT, "utf8")));
		const absent = await applyLocalEditorialControlWithBrain({
			projectId: "disp-onset-absent",
			document: absentDoc,
			userMessage:
				"Would it help if the moment I switch to the Connect landing page stood out more?",
			visualChangeEvents: [{ startSec: 14.8, endSec: 15.6, level: "SIGNIFICANT" }],
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
		expect(absent.outcomeKind === "NOT_FOUND" || absent.outcomeKind === "AMBIGUOUS").toBe(true);
		expect(getLocalEditorialPendingProposal("disp-onset-absent")).toBeNull();
		expect(Buffer.compare(readFileSync(LIVE_PROJECT), origSha)).toBe(0);

		writeFileSync(
			join(ART, "onset-retarget-proof.json"),
			JSON.stringify(
				{
					proofKind: "injected_presence_retarget",
					liveProject: LIVE_PROJECT,
					landingOnset: LANDING_ONSET,
					lateSeed: LATE_SPEECH_SEED,
					advisoryOutcome: advisory.outcomeKind,
					advisoryText: advisory.userFacingText,
					pendingKind: pending?.kind,
					pendingEvidence: pending?.evidenceRefs?.slice(0, 8),
					yesZoomCount: yes.document.zoomRanges.length,
					yesFpAfter: fingerprintDocument(yes.document).value,
					absentOutcome: absent.outcomeKind,
					originalProjectUntouched: true,
				},
				null,
				2,
			),
		);
	});
});
